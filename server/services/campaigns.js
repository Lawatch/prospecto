import fs from 'node:fs';
import path from 'node:path';
import { all, get, insert, logEvent, now, parseJson, tx, update } from '../db.js';
import { getSetting } from '../settings.js';
import { domainOf, isValidEmail } from '../util.js';
import { UPLOAD_DIR } from '../config.js';
import { DEFAULT_ROLE_PRIORITY } from './catalog.js';
import { getEstablishment, listContacts, setStatus } from './establishments.js';
import { isOpposed } from './contacts.js';
import { buildSignature, buildVariables, findUnresolved, render } from './templates.js';

export function hydrateMessage(m) {
  if (!m) return m;
  return { ...m, attachment_ids: parseJson(m.attachment_ids, []), personalization: parseJson(m.personalization, {}), warnings: parseJson(m.warnings, []), queued: !!m.queued };
}

export function hydrateTemplate(t) {
  if (!t) return t;
  return { ...t, target_types: parseJson(t.target_types, []), attachment_ids: parseJson(t.attachment_ids, []), use_signature: !!t.use_signature, archived: !!t.archived };
}

export function pickTemplate(est, { category, templateId, kind = 'initial' }) {
  if (templateId) {
    const t = get('SELECT * FROM templates WHERE id = ? AND archived = 0', templateId);
    if (t) return hydrateTemplate(t);
  }
  const templates = all('SELECT * FROM templates WHERE archived = 0 AND kind = ? ORDER BY id', kind).map(hydrateTemplate);
  const isGroup = !!est.group_name || (est.sites_count || 0) > 1;
  const matchesType = (t) => t.target_types.includes(est.type) || (isGroup && t.target_types.includes('groupe_hotelier'));
  const inCat = templates.filter((t) => !category || t.category === category);
  return inCat.find(matchesType) || inCat.find((t) => !t.target_types.length) || inCat[0]
    || templates.find((t) => t.category === 'generale') || templates[0] || null;
}

export function pickContact(est, contacts, priority) {
  const usable = contacts.filter((c) => c.email && c.email_status !== 'invalide' && !isOpposed(c.email, est.id));
  if (!usable.length) return null;
  const order = priority?.length ? priority : DEFAULT_ROLE_PRIORITY.generale;
  const rank = (c) => {
    const i = order.indexOf(c.role_category);
    return i === -1 ? order.length : i;
  };
  return [...usable].sort((a, b) => rank(a) - rank(b) || (b.is_primary - a.is_primary) || (b.reliability - a.reliability))[0];
}

// Contrôles d'un message : « bloquant » empêche tout envoi, « attention » demande un regard, « info » est indicatif.
export function computeWarnings(msg) {
  const warnings = [];
  const add = (level, code, text) => warnings.push({ level, code, text });
  const est = get('SELECT * FROM establishments WHERE id = ?', msg.establishment_id);
  const contact = msg.contact_id ? get('SELECT * FROM contacts WHERE id = ?', msg.contact_id) : null;
  const email = String(msg.to_email || '').trim().toLowerCase();
  if (!email) add('bloquant', 'no_email', 'Aucune adresse e-mail de destinataire');
  else if (!isValidEmail(email)) add('bloquant', 'invalid_email', `Adresse e-mail invalide : ${email}`);
  if (!String(msg.subject || '').trim()) add('bloquant', 'no_subject', 'Objet vide');
  if (!String(msg.body || '').trim()) add('bloquant', 'no_body', 'Corps du message vide');
  const unresolved = [...findUnresolved(msg.subject), ...findUnresolved(msg.body), ...findUnresolved(msg.signature)];
  if (unresolved.length) add('bloquant', 'unresolved', `Variables non remplacées : ${[...new Set(unresolved)].join(', ')}`);
  if (email) {
    const opp = isOpposed(email, msg.establishment_id);
    if (opp) add('bloquant', 'opposition', `Destinataire présent dans la liste d'opposition${opp.reason ? ' (' + opp.reason + ')' : ''}`);
  }
  if (est?.do_not_contact || est?.status === 'ne_plus_contacter') add('bloquant', 'do_not_contact', 'Établissement marqué « Ne plus contacter »');
  if (contact?.email_status === 'invalide' && contact.email === email) add('bloquant', 'contact_invalid', 'Adresse marquée invalide (rejet ou domaine sans messagerie)');
  if (email) {
    const dupe = get(`SELECT id, sent_at FROM messages WHERE id != ? AND lower(to_email) = ? AND status IN ('envoyee','envoi_en_cours') AND kind = 'initial' LIMIT 1`, msg.id ?? -1, email);
    if (dupe && msg.kind === 'initial') add('bloquant', 'duplicate', `Une candidature a déjà été envoyée à cette adresse (${(dupe.sent_at || '').slice(0, 10)})`);
    const estDupe = get(`SELECT id, to_email FROM messages WHERE id != ? AND establishment_id = ? AND status IN ('envoyee','envoi_en_cours') AND kind = 'initial' AND lower(to_email) != ? LIMIT 1`, msg.id ?? -1, msg.establishment_id, email);
    if (estDupe && msg.kind === 'initial') add('attention', 'duplicate_est', `Une candidature a déjà été envoyée à cet établissement (${estDupe.to_email})`);
    const pending = get(`SELECT id FROM messages WHERE id != ? AND lower(to_email) = ? AND status IN ('a_valider','validee','brouillon') LIMIT 1`, msg.id ?? -1, email);
    if (pending) add('attention', 'duplicate_pending', `Un autre message préparé vise la même adresse (n° ${pending.id})`);
    const d = domainOf(email);
    if (est?.domain && d && d !== est.domain && !d.endsWith('.' + est.domain) && !['gmail.com', 'orange.fr', 'wanadoo.fr', 'hotmail.com', 'outlook.com', 'yahoo.fr', 'free.fr', 'sfr.fr', 'laposte.net'].includes(d)) {
      add('attention', 'domain_mismatch', `Le domaine ${d} ne correspond pas au site de l'établissement (${est.domain})`);
    }
    if (['gmail.com', 'orange.fr', 'wanadoo.fr', 'hotmail.com', 'outlook.com', 'yahoo.fr', 'free.fr', 'sfr.fr', 'laposte.net'].includes(d)) add('info', 'webmail', `Adresse de messagerie grand public (${d}) : vérifiez qu'elle est bien professionnelle`);
  }
  if (contact && contact.email === email) {
    if (contact.email_status === 'non_verifiee') add('attention', 'unverified', `Adresse non vérifiée (source : ${contact.source || 'inconnue'})`);
    if (contact.reliability < 55 && contact.email_status !== 'invalide') add('attention', 'low_reliability', `Fiabilité faible (${contact.reliability}/100)`);
    if (contact.role_category === 'generique' || contact.email_kind === 'generique') add('info', 'generic', 'Adresse générique : le message sera lu par l\'accueil ou le standard');
  } else if (email && !contact) {
    add('attention', 'manual_recipient', 'Destinataire saisi manuellement : aucune source enregistrée');
  }
  const p = msg.personalization || {};
  if (p.missing?.length) add('attention', 'missing_vars', `Variables vides : ${p.missing.join(', ')}`);
  if (msg.kind === 'initial' && !p.used?.accroche) add('info', 'no_hook', 'Aucun élément personnalisé sur l\'entreprise (accroche vide)');
  if (!p.profile_name) add('attention', 'profile', 'Votre nom n\'est pas renseigné dans le profil (Paramètres > Profil)');
  for (const attId of msg.attachment_ids || []) {
    const att = get('SELECT * FROM attachments WHERE id = ?', attId);
    if (!att) add('bloquant', 'attachment_missing', `Pièce jointe n° ${attId} introuvable`);
    else if (!fs.existsSync(path.join(UPLOAD_DIR, att.stored_name))) add('bloquant', 'attachment_file', `Fichier manquant : ${att.filename}`);
  }
  if ((msg.body || '').length > 2500) add('info', 'long', 'Message long : un e-mail concis est généralement mieux lu');
  return warnings;
}

export function refreshWarnings(id) {
  const m = hydrateMessage(get('SELECT * FROM messages WHERE id = ?', id));
  if (!m) return null;
  const warnings = computeWarnings(m);
  update('messages', id, { warnings });
  return warnings;
}

function composeMessage(est, contact, template, { profile, extra = {} }) {
  const vars = buildVariables({ establishment: est, contact, profile, extra });
  const subject = render(template.subject, vars);
  const body = render(template.body, vars);
  const optOut = getSetting('sending');
  let signature = template.use_signature ? buildSignature(profile) : '';
  if (optOut.opt_out_footer && optOut.opt_out_text) signature = [signature, '', optOut.opt_out_text].join('\n').trim();
  const missing = [...new Set([...subject.missing, ...body.missing])];
  const unknown = [...new Set([...subject.unknown, ...body.unknown])];
  return {
    subject: subject.text,
    body: body.text,
    signature,
    personalization: {
      used: { ...subject.used, ...body.used },
      missing,
      unknown,
      hook_source: est.hook_source || null,
      profile_name: profile.full_name || null,
    },
  };
}

export function createCampaign(data) {
  const ts = now();
  const id = insert('campaigns', {
    name: data.name || `Campagne du ${new Date().toLocaleDateString('fr-FR')}`,
    target_category: data.target_category || 'generale',
    template_id: data.template_id || null,
    auto_template: data.template_id ? 0 : 1,
    min_score: Number(data.min_score) || 0,
    max_messages: data.max_messages ? Number(data.max_messages) : null,
    role_priority: data.role_priority?.length ? data.role_priority : DEFAULT_ROLE_PRIORITY[data.target_category] || DEFAULT_ROLE_PRIORITY.generale,
    status: 'active',
    created_at: ts,
    updated_at: ts,
  });
  logEvent('campaign', id, 'creee', { name: data.name });
  return id;
}

// Prépare les messages d'une campagne. Ne déclenche JAMAIS d'envoi : tout message créé est « En attente de validation ».
export function generateMessages(campaignId, { establishmentIds = [], includeWithoutEmail = false, allowRecontact = false } = {}) {
  const campaign = get('SELECT * FROM campaigns WHERE id = ?', campaignId);
  if (!campaign) throw Object.assign(new Error('Campagne introuvable'), { status: 404 });
  const profile = getSetting('profile');
  const priority = parseJson(campaign.role_priority, []);
  const defaultAttachments = all('SELECT id FROM attachments WHERE is_default = 1').map((a) => a.id);
  const created = [];
  const skipped = [];
  const ids = establishmentIds.length ? establishmentIds : all('SELECT id FROM establishments WHERE in_list = 1').map((r) => r.id);
  tx(() => {
    for (const estId of ids) {
      const est = getEstablishment(estId);
      if (!est) continue;
      const skip = (reason) => skipped.push({ establishment_id: estId, name: est.name, reason });
      if (est.do_not_contact || est.status === 'ne_plus_contacter') { skip('Ne plus contacter'); continue; }
      if (['refus', 'entretien'].includes(est.status)) { skip(`Statut « ${est.status} »`); continue; }
      if ((est.score ?? 0) < campaign.min_score) { skip(`Score ${est.score ?? 0} < ${campaign.min_score}`); continue; }
      if (get('SELECT 1 AS x FROM messages WHERE campaign_id = ? AND establishment_id = ? AND kind = \'initial\' AND status != \'ignoree\'', campaignId, estId)) { skip('Déjà dans cette campagne'); continue; }
      if (!allowRecontact && get("SELECT 1 AS x FROM messages WHERE establishment_id = ? AND kind = 'initial' AND status IN ('envoyee','envoi_en_cours','validee','a_valider','brouillon')", estId)) { skip('Candidature déjà préparée ou envoyée'); continue; }
      if (campaign.max_messages && created.length >= campaign.max_messages) { skip('Plafond de la campagne atteint'); continue; }
      const contacts = listContacts(estId);
      const contact = pickContact(est, contacts, priority);
      let toEmail = contact?.email || null;
      if (!toEmail && est.generic_email && !isOpposed(est.generic_email, estId)) toEmail = est.generic_email;
      if (!toEmail && !includeWithoutEmail) { skip('Aucune adresse e-mail exploitable'); continue; }
      // Le nom du destinataire n'est utilisé que si l'adresse lui appartient (pas « Bonjour M. X » sur reception@).
      const personal = contact && contact.role_category !== 'generique' && contact.last_name ? contact : null;
      const template = pickTemplate(est, { category: campaign.target_category, templateId: campaign.auto_template ? null : campaign.template_id });
      if (!template) { skip('Aucun modèle disponible'); continue; }
      const composed = composeMessage(est, personal, template, { profile });
      const ts = now();
      const msg = {
        campaign_id: campaignId,
        establishment_id: estId,
        contact_id: contact?.id || null,
        template_id: template.id,
        template_name: template.name,
        template_category: template.category,
        kind: 'initial',
        to_email: toEmail,
        to_name: personal ? [personal.first_name, personal.last_name].filter(Boolean).join(' ') : null,
        to_role: contact?.role || null,
        subject: composed.subject,
        body: composed.body,
        signature: composed.signature,
        attachment_ids: template.attachment_ids.length ? template.attachment_ids : defaultAttachments,
        personalization: composed.personalization,
        status: 'a_valider',
        created_at: ts,
        updated_at: ts,
      };
      const id = insert('messages', msg);
      update('messages', id, { warnings: computeWarnings({ ...msg, id }) });
      logEvent('message', id, 'prepare', { template: template.name, to: toEmail }, estId);
      setStatus(estId, 'en_attente');
      created.push(id);
    }
  });
  return { created, skipped };
}

export function prepareFollowup(parentId, { templateId } = {}) {
  const parent = hydrateMessage(get('SELECT * FROM messages WHERE id = ?', parentId));
  if (!parent || parent.status !== 'envoyee') throw Object.assign(new Error('Seul un message envoyé peut être relancé'), { status: 400 });
  const existing = get("SELECT id FROM messages WHERE parent_message_id = ? AND status IN ('a_valider','brouillon','validee')", parentId);
  if (existing) return existing.id;
  const est = getEstablishment(parent.establishment_id);
  const contact = parent.contact_id ? get('SELECT * FROM contacts WHERE id = ?', parent.contact_id) : null;
  const template = pickTemplate(est, { category: 'relance', templateId, kind: 'relance' }) || pickTemplate(est, { category: 'relance' });
  if (!template) throw Object.assign(new Error('Aucun modèle de relance : créez-en un dans Templates (type « Relance »)'), { status: 400 });
  const personal = contact && contact.role_category !== 'generique' && contact.last_name ? contact : null;
  const composed = composeMessage(est, personal, template, {
    profile: getSetting('profile'),
    extra: { date_message_initial: new Date(parent.sent_at).toLocaleDateString('fr-FR'), objet_initial: parent.subject.replace(/^(re|tr|fwd?)\s*:\s*/i, '') },
  });
  const ts = now();
  const msg = {
    campaign_id: parent.campaign_id,
    establishment_id: parent.establishment_id,
    contact_id: parent.contact_id,
    template_id: template.id,
    template_name: template.name,
    template_category: template.category,
    kind: 'relance',
    parent_message_id: parent.id,
    to_email: parent.to_email,
    to_name: parent.to_name,
    to_role: parent.to_role,
    subject: composed.subject,
    body: composed.body,
    signature: composed.signature,
    attachment_ids: [],
    personalization: composed.personalization,
    status: 'a_valider',
    created_at: ts,
    updated_at: ts,
  };
  const id = insert('messages', msg);
  update('messages', id, { warnings: computeWarnings({ ...msg, id }) });
  logEvent('message', id, 'relance_preparee', { parent: parent.id }, parent.establishment_id);
  setStatus(parent.establishment_id, 'en_attente');
  return id;
}

export function regenerateMessage(id, templateId) {
  const m = hydrateMessage(get('SELECT * FROM messages WHERE id = ?', id));
  if (!m || !['a_valider', 'brouillon', 'erreur'].includes(m.status)) throw Object.assign(new Error('Ce message ne peut plus être régénéré'), { status: 400 });
  const est = getEstablishment(m.establishment_id);
  const contact = m.contact_id ? get('SELECT * FROM contacts WHERE id = ?', m.contact_id) : null;
  const personal = contact && contact.role_category !== 'generique' && contact.last_name && contact.email === m.to_email ? contact : null;
  const template = pickTemplate(est, { templateId: templateId || m.template_id, category: m.template_category, kind: m.kind });
  const parent = m.parent_message_id ? get('SELECT * FROM messages WHERE id = ?', m.parent_message_id) : null;
  const composed = composeMessage(est, personal, template, {
    profile: getSetting('profile'),
    extra: parent ? { date_message_initial: new Date(parent.sent_at).toLocaleDateString('fr-FR'), objet_initial: parent.subject } : {},
  });
  update('messages', id, {
    template_id: template.id, template_name: template.name, template_category: template.category,
    subject: composed.subject, body: composed.body, signature: composed.signature,
    personalization: composed.personalization, to_name: personal ? [personal.first_name, personal.last_name].filter(Boolean).join(' ') : m.to_name,
    status: 'a_valider', queued: 0, updated_at: now(),
  });
  logEvent('message', id, 'regenere', { template: template.name }, m.establishment_id);
  return refreshWarnings(id);
}
