import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import express from 'express';
import { all, get, insert, logEvent, now, parseJson, run, update } from '../db.js';
import { UPLOAD_DIR } from '../config.js';
import { getSetting } from '../settings.js';
import { isValidEmail } from '../util.js';
import { getEstablishment, listContacts, setStatus } from '../services/establishments.js';
import { addOpposition } from '../services/contacts.js';
import { buildVariables, render, VARIABLES, buildSignature } from '../services/templates.js';
import { createCampaign, generateMessages, hydrateMessage, hydrateTemplate, prepareFollowup, refreshWarnings, regenerateMessage } from '../services/campaigns.js';
import { sendMessage, SendBlocked, sendingStats, startQueue, stopQueue, queueTick, openCompose, confirmComposeSent, cancelCompose, composeUrl, isComposeProvider, COMPOSE_PROVIDERS } from '../services/mailer.js';
import { dueFollowups } from '../services/followups.js';
import { OUTCOMES, MESSAGE_STATUSES } from '../services/catalog.js';

function messageDetail(id) {
  const m = hydrateMessage(get('SELECT * FROM messages WHERE id = ?', id));
  if (!m) return null;
  return {
    message: m,
    establishment: getEstablishment(m.establishment_id),
    contact: m.contact_id ? get('SELECT * FROM contacts WHERE id = ?', m.contact_id) : null,
    contacts: listContacts(m.establishment_id),
    campaign: m.campaign_id ? get('SELECT * FROM campaigns WHERE id = ?', m.campaign_id) : null,
    attachments: m.attachment_ids.map((aid) => get('SELECT id, label, filename, size, mime FROM attachments WHERE id = ?', aid)).filter(Boolean),
    parent: m.parent_message_id ? hydrateMessage(get('SELECT * FROM messages WHERE id = ?', m.parent_message_id)) : null,
    events: all("SELECT * FROM events WHERE entity_type = 'message' AND entity_id = ? ORDER BY id DESC", id).map((e) => ({ ...e, details: parseJson(e.details, null) })),
  };
}

function campaignWithCounts(c) {
  const counts = Object.fromEntries(all('SELECT status, count(*) AS n FROM messages WHERE campaign_id = ? GROUP BY status', c.id).map((r) => [r.status, r.n]));
  return { ...c, role_priority: parseJson(c.role_priority, []), counts, total: Object.values(counts).reduce((a, b) => a + b, 0) };
}

export function messagingRoutes(app) {
  // ---- Templates ----
  app.get('/api/variables', (req, res) => res.json(VARIABLES));

  app.get('/api/templates', (req, res) => {
    const rows = all(`SELECT t.*, (SELECT count(*) FROM messages m WHERE m.template_id = t.id AND m.status = 'envoyee') AS sent_count,
      (SELECT count(*) FROM messages m WHERE m.template_id = t.id AND m.status = 'envoyee' AND m.outcome NOT IN ('aucune','adresse_invalide')) AS reply_count
      FROM templates t WHERE t.archived = 0 OR $all = 1 ORDER BY t.kind, t.category, t.name`, { $all: req.query.all ? 1 : 0 });
    res.json(rows.map(hydrateTemplate));
  });

  app.post('/api/templates', (req, res) => {
    const b = req.body || {};
    if (!b.name || !b.subject || !b.body) return res.status(400).json({ error: 'Nom, objet et corps sont obligatoires' });
    const ts = now();
    const id = insert('templates', { name: b.name, category: b.category || 'generale', kind: b.kind === 'relance' ? 'relance' : 'initial', subject: b.subject, body: b.body, target_types: b.target_types || [], attachment_ids: b.attachment_ids || [], use_signature: b.use_signature !== false, created_at: ts, updated_at: ts });
    res.json(hydrateTemplate(get('SELECT * FROM templates WHERE id = ?', id)));
  });

  app.patch('/api/templates/:id', (req, res) => {
    const t = get('SELECT * FROM templates WHERE id = ?', Number(req.params.id));
    if (!t) return res.status(404).json({ error: 'Modèle introuvable' });
    const fields = {};
    for (const k of ['name', 'category', 'kind', 'subject', 'body', 'target_types', 'attachment_ids', 'use_signature', 'archived']) if (k in req.body) fields[k] = req.body[k];
    fields.updated_at = now();
    update('templates', t.id, fields);
    res.json(hydrateTemplate(get('SELECT * FROM templates WHERE id = ?', t.id)));
  });

  app.delete('/api/templates/:id', (req, res) => {
    const id = Number(req.params.id);
    // Un modèle déjà utilisé est archivé (l'historique garde son nom), sinon supprimé.
    if (get('SELECT 1 AS x FROM messages WHERE template_id = ?', id)) update('templates', id, { archived: 1 });
    else run('DELETE FROM templates WHERE id = ?', id);
    res.json({ ok: true });
  });

  app.post('/api/templates/preview', (req, res) => {
    const { subject = '', body = '', establishment_id, use_signature = true } = req.body || {};
    const est = establishment_id ? getEstablishment(Number(establishment_id)) : get('SELECT * FROM establishments WHERE in_list = 1 ORDER BY score DESC LIMIT 1');
    const contacts = est ? listContacts(est.id) : [];
    const contact = contacts.find((c) => c.email && c.role_category !== 'generique' && c.last_name) || null;
    const profile = getSetting('profile');
    const vars = buildVariables({ establishment: est || { name: 'Hôtel Exemple', city: 'Annecy', type: 'hotel' }, contact, profile, extra: { date_message_initial: new Date().toLocaleDateString('fr-FR'), objet_initial: 'Candidature spontanée' } });
    const s = render(subject, vars);
    const b = render(body, vars);
    res.json({ subject: s.text, body: b.text, signature: use_signature ? buildSignature(profile) : '', missing: [...new Set([...s.missing, ...b.missing])], unknown: [...new Set([...s.unknown, ...b.unknown])], establishment: est ? { id: est.id, name: est.name } : null, sample: !est });
  });

  // ---- Pièces jointes ----
  app.get('/api/attachments', (req, res) => res.json(all('SELECT * FROM attachments ORDER BY id DESC')));

  app.post('/api/attachments', express.raw({ type: '*/*', limit: '12mb' }), (req, res) => {
    const filename = decodeURIComponent(String(req.headers['x-filename'] || 'document')).replace(/[\\/:*?"<>|]+/g, '_').slice(0, 120);
    if (!req.body?.length) return res.status(400).json({ error: 'Fichier vide' });
    const ext = path.extname(filename).toLowerCase();
    if (!['.pdf', '.doc', '.docx', '.odt', '.png', '.jpg', '.jpeg'].includes(ext)) return res.status(400).json({ error: 'Formats acceptés : PDF, Word, ODT, PNG, JPG' });
    const stored = `${crypto.randomUUID()}${ext}`;
    fs.writeFileSync(path.join(UPLOAD_DIR, stored), req.body);
    const id = insert('attachments', { label: decodeURIComponent(String(req.headers['x-label'] || filename)), filename, stored_name: stored, mime: req.headers['content-type'] || null, size: req.body.length, is_default: all('SELECT id FROM attachments').length ? 0 : 1, created_at: now() });
    res.json(get('SELECT * FROM attachments WHERE id = ?', id));
  });

  app.patch('/api/attachments/:id', (req, res) => {
    const id = Number(req.params.id);
    const fields = {};
    if ('label' in req.body) fields.label = req.body.label;
    if ('is_default' in req.body) fields.is_default = req.body.is_default ? 1 : 0;
    update('attachments', id, fields);
    res.json(get('SELECT * FROM attachments WHERE id = ?', id));
  });

  app.delete('/api/attachments/:id', (req, res) => {
    const a = get('SELECT * FROM attachments WHERE id = ?', Number(req.params.id));
    if (!a) return res.status(404).json({ error: 'Pièce jointe introuvable' });
    if (get("SELECT 1 AS x FROM messages WHERE status IN ('a_valider','validee','brouillon') AND attachment_ids LIKE ?", `%${a.id}%`)) {
      return res.status(400).json({ error: 'Pièce jointe utilisée par des messages en attente : retirez-la d\'abord de ces messages.' });
    }
    fs.rmSync(path.join(UPLOAD_DIR, a.stored_name), { force: true });
    run('DELETE FROM attachments WHERE id = ?', a.id);
    res.json({ ok: true });
  });

  app.get('/api/attachments/:id/file', (req, res) => {
    const a = get('SELECT * FROM attachments WHERE id = ?', Number(req.params.id));
    if (!a) return res.status(404).json({ error: 'Pièce jointe introuvable' });
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(a.filename)}"`);
    res.sendFile(path.join(UPLOAD_DIR, a.stored_name));
  });

  // ---- Campagnes ----
  app.get('/api/campaigns', (req, res) => res.json(all('SELECT * FROM campaigns ORDER BY id DESC').map(campaignWithCounts)));

  app.post('/api/campaigns', (req, res) => {
    const b = req.body || {};
    const ids = (b.establishment_ids || []).map(Number).filter(Boolean);
    if (!ids.length) return res.status(400).json({ error: 'Sélectionnez au moins un prospect' });
    const id = createCampaign(b);
    const result = generateMessages(id, { establishmentIds: ids, includeWithoutEmail: !!b.include_without_email, allowRecontact: !!b.allow_recontact });
    res.json({ campaign: campaignWithCounts(get('SELECT * FROM campaigns WHERE id = ?', id)), ...result });
  });

  app.get('/api/campaigns/:id', (req, res) => {
    const c = get('SELECT * FROM campaigns WHERE id = ?', Number(req.params.id));
    if (!c) return res.status(404).json({ error: 'Campagne introuvable' });
    res.json(campaignWithCounts(c));
  });

  app.patch('/api/campaigns/:id', (req, res) => {
    const id = Number(req.params.id);
    const fields = {};
    for (const k of ['name', 'min_score', 'max_messages', 'status', 'target_category', 'role_priority']) if (k in req.body) fields[k] = req.body[k];
    if (fields.status === 'active') { fields.pause_reason = null; fields.consecutive_errors = 0; }
    fields.updated_at = now();
    update('campaigns', id, fields);
    logEvent('campaign', id, 'modifiee', fields);
    res.json(campaignWithCounts(get('SELECT * FROM campaigns WHERE id = ?', id)));
  });

  app.post('/api/campaigns/:id/generate', (req, res) => {
    const ids = (req.body?.establishment_ids || []).map(Number).filter(Boolean);
    if (!ids.length) return res.status(400).json({ error: 'Sélectionnez au moins un prospect' });
    res.json(generateMessages(Number(req.params.id), { establishmentIds: ids, includeWithoutEmail: !!req.body.include_without_email, allowRecontact: !!req.body.allow_recontact }));
  });

  // ---- Messages ----
  app.get('/api/messages', (req, res) => {
    const where = [];
    const p = {};
    if (req.query.status) { where.push(`m.status IN (${String(req.query.status).split(',').map((s, i) => { p['$s' + i] = s; return '$s' + i; }).join(',')})`); }
    if (req.query.campaign_id) { where.push('m.campaign_id = $cid'); p.$cid = Number(req.query.campaign_id); }
    if (req.query.kind) { where.push('m.kind = $kind'); p.$kind = req.query.kind; }
    if (req.query.outcome) { where.push('m.outcome = $outcome'); p.$outcome = req.query.outcome; }
    if (req.query.q) { where.push('(lower(e.name) LIKE $q OR lower(coalesce(m.to_email,\'\')) LIKE $q OR lower(coalesce(m.subject,\'\')) LIKE $q)'); p.$q = `%${String(req.query.q).toLowerCase()}%`; }
    const rows = all(`SELECT m.id, m.campaign_id, m.establishment_id, m.kind, m.parent_message_id, m.to_email, m.to_name, m.to_role, m.subject, m.status, m.queued, m.validated_at, m.sent_at,
        m.created_at, m.updated_at, m.template_name, m.template_category, m.outcome, m.reply_at, m.delivery_status, m.error, m.warnings, m.next_action, m.next_action_at,
        e.name AS establishment_name, e.city, e.type AS establishment_type, e.score, c.name AS campaign_name
      FROM messages m JOIN establishments e ON e.id = m.establishment_id LEFT JOIN campaigns c ON c.id = m.campaign_id
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY coalesce(m.sent_at, m.updated_at) DESC LIMIT 1000`, p);
    res.json(rows.map((r) => ({ ...r, warnings: parseJson(r.warnings, []), queued: !!r.queued })));
  });

  app.get('/api/messages/:id', (req, res) => {
    const d = messageDetail(Number(req.params.id));
    if (!d) return res.status(404).json({ error: 'Message introuvable' });
    res.json(d);
  });

  // Prochain message à valider (mode validation en série).
  app.get('/api/review/queue', (req, res) => {
    const p = {};
    const pendingCompose = "(m.status = 'envoi_en_cours' AND m.provider IN ('gmail_web','outlook_web','outlook_pro_web','mailto'))";
    let where = `(m.status IN ('a_valider') OR ${pendingCompose})`;
    if (req.query.include_drafts === '1') where = `(m.status IN ('a_valider','brouillon') OR ${pendingCompose})`;
    if (req.query.campaign_id) { where += ' AND m.campaign_id = $cid'; p.$cid = Number(req.query.campaign_id); }
    const ids = all(`SELECT m.id FROM messages m JOIN establishments e ON e.id = m.establishment_id WHERE ${where} ORDER BY e.score DESC NULLS LAST, m.id`, p).map((r) => r.id);
    res.json({ ids });
  });

  app.patch('/api/messages/:id', (req, res) => {
    const id = Number(req.params.id);
    const m = hydrateMessage(get('SELECT * FROM messages WHERE id = ?', id));
    if (!m) return res.status(404).json({ error: 'Message introuvable' });
    if (['envoyee', 'envoi_en_cours'].includes(m.status)) return res.status(400).json({ error: 'Un message envoyé ne peut plus être modifié' });
    const fields = {};
    const changed = [];
    for (const k of ['to_email', 'to_name', 'to_role', 'subject', 'body', 'signature', 'attachment_ids', 'contact_id']) {
      if (k in req.body) {
        let v = req.body[k];
        if (k === 'to_email') v = v ? String(v).trim().toLowerCase() : null;
        if (JSON.stringify(v ?? null) !== JSON.stringify(m[k] ?? null)) { fields[k] = v; changed.push(k); }
      }
    }
    if (fields.to_email && !isValidEmail(fields.to_email)) return res.status(400).json({ error: 'Adresse e-mail invalide' });
    if ('contact_id' in fields && fields.contact_id) {
      const c = get('SELECT * FROM contacts WHERE id = ? AND establishment_id = ?', fields.contact_id, m.establishment_id);
      if (!c) return res.status(400).json({ error: 'Contact inconnu pour cet établissement' });
      if (!('to_email' in req.body)) fields.to_email = c.email;
      if (!('to_role' in req.body)) fields.to_role = c.role;
    }
    if (changed.length) {
      // Toute modification d'un message validé le remet en attente : il devra être revalidé.
      if (m.status === 'validee') { fields.status = 'a_valider'; fields.queued = 0; }
      fields.updated_at = now();
      update('messages', id, fields);
      logEvent('message', id, 'modifie', { champs: changed }, m.establishment_id);
    }
    refreshWarnings(id);
    res.json(messageDetail(id));
  });

  app.post('/api/messages/:id/send', async (req, res) => {
    const id = Number(req.params.id);
    try {
      const result = await sendMessage(id, { origin: 'manuel', confirmUncertain: !!req.body?.confirm_uncertain });
      res.status(result.ok ? 200 : 502).json(result);
    } catch (err) {
      if (err instanceof SendBlocked) return res.status(409).json({ error: err.message, ...err.details });
      throw err;
    }
  });

  // Envoi par la messagerie web : ouverture du brouillon pré-rempli, puis confirmation par l'utilisateur.
  app.post('/api/messages/:id/compose', (req, res) => {
    const id = Number(req.params.id);
    const m = hydrateMessage(get('SELECT * FROM messages WHERE id = ?', id));
    try {
      if (m?.status === 'envoi_en_cours' && isComposeProvider(m.provider)) {
        return res.json({ url: composeUrl(m.provider, m, { authuser: getSetting('profile').email || undefined }), message: m, reopened: true });
      }
      res.json(openCompose(id));
    } catch (err) {
      if (err instanceof SendBlocked) return res.status(409).json({ error: err.message, ...err.details });
      throw err;
    }
  });
  app.post('/api/messages/:id/confirm-sent', (req, res) => {
    try { res.json({ ok: true, message: confirmComposeSent(Number(req.params.id)) }); } catch (err) {
      if (err instanceof SendBlocked) return res.status(409).json({ error: err.message });
      throw err;
    }
  });
  app.post('/api/messages/:id/cancel-compose', (req, res) => {
    try { res.json({ ok: true, message: cancelCompose(Number(req.params.id)) }); } catch (err) {
      if (err instanceof SendBlocked) return res.status(409).json({ error: err.message });
      throw err;
    }
  });
  app.get('/api/compose-providers', (req, res) => res.json(COMPOSE_PROVIDERS));

  app.post('/api/messages/:id/validate', (req, res) => {
    const id = Number(req.params.id);
    const m = hydrateMessage(get('SELECT * FROM messages WHERE id = ?', id));
    if (!m || !['a_valider', 'brouillon', 'erreur'].includes(m.status)) return res.status(400).json({ error: 'Ce message ne peut pas être validé' });
    const warnings = refreshWarnings(id);
    const blocking = warnings.filter((w) => w.level === 'bloquant');
    if (blocking.length) return res.status(409).json({ error: `Validation impossible : ${blocking.map((w) => w.text).join(' ; ')}`, warnings });
    update('messages', id, { status: 'validee', queued: 1, validated_at: now(), updated_at: now() });
    logEvent('message', id, 'valide', null, m.establishment_id);
    setStatus(m.establishment_id, 'validee');
    res.json(messageDetail(id));
  });

  app.post('/api/messages/:id/unvalidate', (req, res) => {
    const id = Number(req.params.id);
    const m = get('SELECT * FROM messages WHERE id = ?', id);
    if (m?.status !== 'validee') return res.status(400).json({ error: 'Ce message n\'est pas dans la file d\'envoi' });
    update('messages', id, { status: 'a_valider', queued: 0, updated_at: now() });
    logEvent('message', id, 'retire_de_la_file', null, m.establishment_id);
    setStatus(m.establishment_id, 'en_attente');
    res.json(messageDetail(id));
  });

  app.post('/api/messages/:id/draft', (req, res) => {
    const id = Number(req.params.id);
    const m = get('SELECT * FROM messages WHERE id = ?', id);
    if (!m || ['envoyee', 'envoi_en_cours'].includes(m.status)) return res.status(400).json({ error: 'Action impossible' });
    update('messages', id, { status: 'brouillon', queued: 0, updated_at: now() });
    logEvent('message', id, 'brouillon', null, m.establishment_id);
    res.json(messageDetail(id));
  });

  app.post('/api/messages/:id/ignore', (req, res) => {
    const id = Number(req.params.id);
    const m = get('SELECT * FROM messages WHERE id = ?', id);
    if (!m || ['envoyee', 'envoi_en_cours'].includes(m.status)) return res.status(400).json({ error: 'Action impossible' });
    update('messages', id, { status: 'ignoree', queued: 0, updated_at: now() });
    logEvent('message', id, 'ignore', { reason: req.body?.reason || null }, m.establishment_id);
    const others = get("SELECT 1 AS x FROM messages WHERE establishment_id = ? AND id != ? AND status NOT IN ('ignoree')", m.establishment_id, id);
    if (!others) setStatus(m.establishment_id, 'identifie');
    if (req.body?.do_not_contact) {
      update('establishments', m.establishment_id, { do_not_contact: 1 });
      setStatus(m.establishment_id, 'ne_plus_contacter', { manual: true });
      addOpposition({ establishment_id: m.establishment_id, reason: 'Ignoré et exclu depuis l\'écran de validation' });
    }
    res.json(messageDetail(id));
  });

  app.post('/api/messages/:id/regenerate', (req, res) => {
    const id = Number(req.params.id);
    regenerateMessage(id, req.body?.template_id ? Number(req.body.template_id) : null);
    res.json(messageDetail(id));
  });

  app.post('/api/messages/:id/outcome', (req, res) => {
    const id = Number(req.params.id);
    const m = get('SELECT * FROM messages WHERE id = ?', id);
    if (!m) return res.status(404).json({ error: 'Message introuvable' });
    const { outcome, note, next_action, next_action_at } = req.body || {};
    const fields = { updated_at: now() };
    if (outcome) {
      if (!OUTCOMES[outcome]) return res.status(400).json({ error: 'Résultat inconnu' });
      fields.outcome = outcome;
      if (outcome !== 'aucune' && !m.reply_at) fields.reply_at = now();
      if (outcome === 'adresse_invalide') { fields.delivery_status = 'rejete'; run("UPDATE contacts SET email_status = 'invalide', reliability = 0 WHERE lower(email) = lower(?)", m.to_email); }
    }
    if (note !== undefined) fields.reply_excerpt = note;
    if (next_action !== undefined) fields.next_action = next_action || null;
    if (next_action_at !== undefined) fields.next_action_at = next_action_at || null;
    update('messages', id, fields);
    logEvent('message', id, 'resultat', { outcome, note, next_action }, m.establishment_id);
    const statusMap = { reponse_a_qualifier: 'reponse', reponse_positive: 'reponse', reponse_neutre: 'reponse', reponse_negative: 'reponse', entretien: 'entretien', refus: 'refus', ne_plus_contacter: 'ne_plus_contacter' };
    if (statusMap[outcome]) setStatus(m.establishment_id, statusMap[outcome], { manual: true });
    if (outcome === 'ne_plus_contacter') {
      update('establishments', m.establishment_id, { do_not_contact: 1 });
      addOpposition({ email: m.to_email, establishment_id: m.establishment_id, reason: 'Demande de ne plus être contacté' });
    }
    res.json(messageDetail(id));
  });

  // ---- File d'envoi ----
  app.get('/api/queue', (req, res) => res.json(sendingStats()));
  app.post('/api/queue/start', (req, res) => {
    const stats = sendingStats();
    if (!stats.queued) return res.status(400).json({ error: 'Aucun message validé dans la file' });
    try { startQueue(); } catch (err) {
      if (err instanceof SendBlocked) return res.status(409).json({ error: err.message });
      throw err;
    }
    queueTick().catch(() => {});
    res.json(sendingStats());
  });
  app.post('/api/queue/stop', (req, res) => { stopQueue('Arrêt manuel'); res.json(sendingStats()); });

  // ---- Relances ----
  app.get('/api/followups', (req, res) => res.json(dueFollowups()));
  app.post('/api/followups/:messageId/prepare', (req, res) => {
    const id = prepareFollowup(Number(req.params.messageId), { templateId: req.body?.template_id ? Number(req.body.template_id) : null });
    res.json(messageDetail(id));
  });

  app.get('/api/meta/statuses', (req, res) => res.json({ messages: MESSAGE_STATUSES, outcomes: OUTCOMES }));
}
