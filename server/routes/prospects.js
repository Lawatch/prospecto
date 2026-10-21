import { all, get, insert, logEvent, now, parseJson, run, update } from '../db.js';
import { domainOf, nameKey, normalizeUrl, parseCsv, toCsv, isValidEmail, parseIntSafe } from '../util.js';
import { runSearch, searchResults } from '../services/search.js';
import { deleteEstablishment, getEstablishment, hydrate, listContacts, recomputeScore, setStatus, upsertEstablishment } from '../services/establishments.js';
import { enrichEstablishment } from '../services/enrich.js';
import { addOpposition, checkMx, refreshReliability, setPrimary, upsertContact } from '../services/contacts.js';
import { hunterVerify, hasHunterKey } from '../services/hunter.js';
import { hydrateMessage } from '../services/campaigns.js';
import { ESTABLISHMENT_STATUSES, TYPE_LABELS } from '../services/catalog.js';
import { startJob } from './jobs.js';

const SORTS = { score: 'e.score', name: 'e.name', distance: 'e.distance_km', city: 'e.city', updated: 'e.updated_at', created: 'e.created_at', status: 'e.status' };
const EDITABLE = ['name', 'type', 'sector', 'address', 'postcode', 'city', 'website', 'phone', 'generic_email', 'contact_form_url', 'group_name', 'brand',
  'stars', 'rooms', 'siren', 'siret', 'headcount_range', 'sites_count', 'hook', 'hook_source', 'notes', 'next_action', 'next_action_at'];

function listEstablishments(q) {
  const where = [];
  const params = {};
  if (q.in_list === '1') where.push('e.in_list = 1');
  if (q.in_list === '0') where.push('e.in_list = 0');
  if (q.status) { where.push('e.status = $status'); params.$status = q.status; }
  if (q.type) { where.push('e.type = $type'); params.$type = q.type; }
  if (q.min_score) { where.push('coalesce(e.score,0) >= $min'); params.$min = Number(q.min_score); }
  if (q.city) { where.push('lower(e.city) LIKE $city'); params.$city = `%${q.city.toLowerCase()}%`; }
  if (q.has_email === '1') where.push("EXISTS (SELECT 1 FROM contacts c WHERE c.establishment_id = e.id AND c.email IS NOT NULL AND c.email_status != 'invalide')");
  if (q.has_email === '0') where.push("NOT EXISTS (SELECT 1 FROM contacts c WHERE c.establishment_id = e.id AND c.email IS NOT NULL AND c.email_status != 'invalide')");
  if (q.search_id) { where.push('e.id IN (SELECT establishment_id FROM search_results WHERE search_id = $sid)'); params.$sid = Number(q.search_id); }
  if (q.q) {
    where.push('(lower(e.name) LIKE $q OR lower(coalesce(e.city,\'\')) LIKE $q OR lower(coalesce(e.group_name,\'\')) LIKE $q OR e.name_key LIKE $qk)');
    params.$q = `%${q.q.toLowerCase()}%`;
    params.$qk = `%${nameKey(q.q)}%`;
  }
  const sort = SORTS[q.sort] || 'e.score';
  const order = q.order === 'asc' ? 'ASC' : 'DESC';
  const limit = Math.min(Number(q.limit) || 200, 2000);
  const offset = Number(q.offset) || 0;
  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const total = get(`SELECT count(*) AS n FROM establishments e ${whereSql}`, params).n;
  const rows = all(`SELECT e.*,
      (SELECT count(*) FROM contacts c WHERE c.establishment_id = e.id AND c.email IS NOT NULL AND c.email_status != 'invalide') AS email_count,
      (SELECT max(c.reliability) FROM contacts c WHERE c.establishment_id = e.id AND c.email IS NOT NULL) AS best_reliability,
      (SELECT count(*) FROM messages m WHERE m.establishment_id = e.id AND m.status = 'envoyee') AS sent_count
    FROM establishments e ${whereSql} ORDER BY ${sort} ${order} NULLS LAST, e.id DESC LIMIT ${limit} OFFSET ${offset}`, params);
  return { total, rows: rows.map(hydrate) };
}

export function prospectRoutes(app) {
  app.post('/api/search', async (req, res) => {
    res.json(await runSearch(req.body || {}));
  });

  app.get('/api/searches', (req, res) => {
    res.json(all('SELECT * FROM searches ORDER BY id DESC LIMIT 30').map((s) => ({ ...s, params: parseJson(s.params, {}), errors: parseJson(s.errors, []) })));
  });

  app.get('/api/searches/:id/results', (req, res) => {
    const s = get('SELECT * FROM searches WHERE id = ?', Number(req.params.id));
    if (!s) return res.status(404).json({ error: 'Recherche introuvable' });
    res.json({ search: { ...s, params: parseJson(s.params, {}), errors: parseJson(s.errors, []) }, results: searchResults(s.id) });
  });

  app.get('/api/establishments', (req, res) => res.json(listEstablishments(req.query)));

  app.get('/api/establishments/export.csv', (req, res) => {
    const { rows } = listEstablishments({ ...req.query, limit: 2000 });
    const contacts = new Map();
    for (const c of all("SELECT * FROM contacts WHERE email IS NOT NULL AND is_primary = 1")) contacts.set(c.establishment_id, c);
    const csv = toCsv(rows, [
      { label: 'Nom', key: 'name' }, { label: 'Type', get: (r) => TYPE_LABELS[r.type] || r.type }, { label: 'Adresse', key: 'address' },
      { label: 'Code postal', key: 'postcode' }, { label: 'Ville', key: 'city' }, { label: 'Site web', key: 'website' }, { label: 'Téléphone', key: 'phone' },
      { label: 'Groupe', key: 'group_name' }, { label: 'SIRET', key: 'siret' }, { label: 'Score', key: 'score' },
      { label: 'Statut', get: (r) => ESTABLISHMENT_STATUSES[r.status] || r.status },
      { label: 'Contact principal', get: (r) => contacts.get(r.id)?.email || '' },
      { label: 'Fiabilité contact', get: (r) => contacts.get(r.id)?.reliability ?? '' },
      { label: 'Sources', get: (r) => r.sources.map((s) => `${s.source} (${(s.collected_at || '').slice(0, 10)})`).join(' | ') },
    ]);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="prospects-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.send(csv);
  });

  app.post('/api/establishments/import', (req, res) => {
    const rows = parseCsv(String(req.body?.csv || ''));
    if (!rows.length) return res.status(400).json({ error: 'Fichier vide ou illisible. Colonnes attendues : nom, adresse, code_postal, ville, site_web, telephone, email, type…' });
    const pick = (r, ...keys) => { for (const k of keys) if (r[k]) return r[k]; return null; };
    let created = 0; let merged = 0; const errors = [];
    rows.forEach((r, i) => {
      const name = pick(r, 'nom', 'name', 'etablissement', 'entreprise', 'raison_sociale');
      if (!name) { errors.push(`Ligne ${i + 2} : nom manquant`); return; }
      const typeRaw = (pick(r, 'type') || '').toLowerCase();
      const type = Object.entries(TYPE_LABELS).find(([k, l]) => k === typeRaw || l.toLowerCase() === typeRaw)?.[0] || (typeRaw.includes('hôtel') || typeRaw.includes('hotel') ? 'hotel' : null);
      const { id, created: isNew } = upsertEstablishment({
        name, type, address: pick(r, 'adresse', 'address'), postcode: pick(r, 'code_postal', 'cp', 'postcode'), city: pick(r, 'ville', 'city', 'commune'),
        website: pick(r, 'site_web', 'site', 'website', 'url'), phone: pick(r, 'telephone', 'tel', 'phone'), group_name: pick(r, 'groupe', 'group'),
        siret: pick(r, 'siret'), rooms: parseIntSafe(pick(r, 'chambres', 'rooms')),
        source: { source: 'Import CSV', ref: `ligne ${i + 2}`, url: null },
      });
      update('establishments', id, { in_list: 1 });
      const email = pick(r, 'email', 'e_mail', 'mail', 'courriel');
      if (email && isValidEmail(email)) {
        try {
          upsertContact(getEstablishment(id), { email, first_name: pick(r, 'prenom', 'first_name'), last_name: pick(r, 'nom_contact', 'last_name', 'contact'), role: pick(r, 'fonction', 'role', 'poste'), source: 'Import CSV' }, { actor: 'utilisateur' });
        } catch (e) { errors.push(`Ligne ${i + 2} : ${e.message}`); }
      }
      recomputeScore(id);
      if (isNew) created++; else merged++;
    });
    res.json({ created, merged, errors });
  });

  app.post('/api/establishments', (req, res) => {
    const b = req.body || {};
    if (!b.name) return res.status(400).json({ error: 'Le nom est obligatoire' });
    const { id, created } = upsertEstablishment({ ...b, website: normalizeUrl(b.website), source: { source: 'Saisie manuelle', ref: null } });
    update('establishments', id, { in_list: 1 });
    recomputeScore(id);
    res.json({ id, created });
  });

  app.get('/api/establishments/:id', (req, res) => {
    const id = Number(req.params.id);
    const est = getEstablishment(id);
    if (!est) return res.status(404).json({ error: 'Établissement introuvable' });
    res.json({
      establishment: est,
      contacts: listContacts(id),
      messages: all('SELECT * FROM messages WHERE establishment_id = ? ORDER BY id DESC', id).map(hydrateMessage),
      events: all('SELECT * FROM events WHERE establishment_id = ? ORDER BY id DESC LIMIT 200', id).map((e) => ({ ...e, details: parseJson(e.details, null) })),
      opposition: all('SELECT * FROM opposition WHERE establishment_id = ? OR domain = ?', id, est.domain || '__none__'),
    });
  });

  app.patch('/api/establishments/:id', (req, res) => {
    const id = Number(req.params.id);
    const est = getEstablishment(id);
    if (!est) return res.status(404).json({ error: 'Établissement introuvable' });
    const fields = {};
    const changed = [];
    for (const k of EDITABLE) {
      if (k in req.body) {
        let v = req.body[k] === '' ? null : req.body[k];
        if (k === 'website') v = normalizeUrl(v);
        if (['stars', 'rooms', 'sites_count'].includes(k)) v = parseIntSafe(v);
        if (v !== est[k]) { fields[k] = v; changed.push(k); }
      }
    }
    if ('website' in fields) fields.domain = fields.website ? domainOf(fields.website) : null;
    if ('name' in fields) fields.name_key = nameKey(fields.name);
    if ('in_list' in req.body) fields.in_list = req.body.in_list ? 1 : 0;
    if (Object.keys(fields).length) {
      fields.updated_at = now();
      update('establishments', id, fields);
      logEvent('establishment', id, 'modifie', { champs: changed });
    }
    if (req.body.status && req.body.status !== est.status) {
      setStatus(id, req.body.status, { manual: true });
      if (req.body.status === 'ne_plus_contacter') {
        update('establishments', id, { do_not_contact: 1 });
        addOpposition({ establishment_id: id, reason: req.body.reason || 'Marqué « Ne plus contacter »' });
      }
    }
    if ('do_not_contact' in req.body) {
      update('establishments', id, { do_not_contact: req.body.do_not_contact ? 1 : 0 });
      if (req.body.do_not_contact) addOpposition({ establishment_id: id, reason: req.body.reason || 'Ne plus contacter' });
      else run('DELETE FROM opposition WHERE establishment_id = ? AND email IS NULL AND domain IS NULL', id);
    }
    if ('website' in fields) refreshReliability(getEstablishment(id));
    recomputeScore(id);
    res.json(getEstablishment(id));
  });

  app.delete('/api/establishments/:id', (req, res) => {
    deleteEstablishment(Number(req.params.id));
    res.json({ ok: true });
  });

  app.post('/api/establishments/bulk', (req, res) => {
    const ids = (req.body?.ids || []).map(Number).filter(Boolean);
    const { action, value } = req.body || {};
    if (!ids.length) return res.status(400).json({ error: 'Aucun établissement sélectionné' });
    switch (action) {
      case 'add_to_list':
        for (const id of ids) { update('establishments', id, { in_list: 1, updated_at: now() }); logEvent('establishment', id, 'ajoute_liste'); }
        return res.json({ ok: true, count: ids.length });
      case 'remove_from_list':
        for (const id of ids) update('establishments', id, { in_list: 0, updated_at: now() });
        return res.json({ ok: true, count: ids.length });
      case 'status':
        if (!ESTABLISHMENT_STATUSES[value]) return res.status(400).json({ error: 'Statut inconnu' });
        for (const id of ids) {
          setStatus(id, value, { manual: true });
          if (value === 'ne_plus_contacter') { update('establishments', id, { do_not_contact: 1 }); addOpposition({ establishment_id: id, reason: 'Ne plus contacter (action groupée)' }); }
        }
        return res.json({ ok: true, count: ids.length });
      case 'rescore':
        for (const id of ids) recomputeScore(id);
        return res.json({ ok: true, count: ids.length });
      case 'delete':
        for (const id of ids) deleteEstablishment(id);
        return res.json({ ok: true, count: ids.length });
      case 'enrich': {
        const steps = Array.isArray(value) && value.length ? value : ['sirene', 'website', 'mx'];
        const job = startJob(`Enrichissement de ${ids.length} établissement(s)`, ids, async (id) => {
          const r = await enrichEstablishment(id, { steps });
          return { id, name: get('SELECT name FROM establishments WHERE id = ?', id)?.name, ...r };
        });
        return res.json({ job_id: job.id });
      }
      default:
        return res.status(400).json({ error: 'Action inconnue' });
    }
  });

  app.post('/api/establishments/:id/enrich', async (req, res) => {
    res.json(await enrichEstablishment(Number(req.params.id), { steps: req.body?.steps }));
  });

  app.post('/api/establishments/:id/signals', (req, res) => {
    const id = Number(req.params.id);
    const est = getEstablishment(id);
    if (!est) return res.status(404).json({ error: 'Établissement introuvable' });
    const { kind = 'manuel', label = 'Information vérifiée manuellement', snippet, url } = req.body || {};
    if (!snippet) return res.status(400).json({ error: 'Texte du signal obligatoire' });
    const signals = [...est.signals, { kind, label, snippet, url: url || null, collected_at: now(), manual: true }];
    update('establishments', id, { signals });
    recomputeScore(id);
    res.json(getEstablishment(id));
  });

  app.delete('/api/establishments/:id/signals/:index', (req, res) => {
    const id = Number(req.params.id);
    const est = getEstablishment(id);
    const signals = est.signals.filter((_, i) => i !== Number(req.params.index));
    update('establishments', id, { signals });
    recomputeScore(id);
    res.json(getEstablishment(id));
  });

  // ---- Contacts ----
  app.post('/api/establishments/:id/contacts', (req, res) => {
    const est = getEstablishment(Number(req.params.id));
    if (!est) return res.status(404).json({ error: 'Établissement introuvable' });
    const id = upsertContact(est, { ...req.body, source: req.body.source || 'Saisie manuelle' }, { actor: 'utilisateur' });
    recomputeScore(est.id);
    if (est.status === 'identifie') setStatus(est.id, 'contact_a_verifier');
    res.json(get('SELECT * FROM contacts WHERE id = ?', id));
  });

  app.patch('/api/contacts/:id', (req, res) => {
    const c = get('SELECT * FROM contacts WHERE id = ?', Number(req.params.id));
    if (!c) return res.status(404).json({ error: 'Contact introuvable' });
    const est = getEstablishment(c.establishment_id);
    const allowed = ['civility', 'first_name', 'last_name', 'role', 'role_category', 'email', 'email_status', 'phone', 'notes', 'source_url'];
    const data = {};
    for (const k of allowed) if (k in req.body) data[k] = req.body[k] === '' ? null : req.body[k];
    if (data.email && !isValidEmail(data.email)) return res.status(400).json({ error: 'Adresse e-mail invalide' });
    if ('email' in data && data.email !== c.email) { data.mx_ok = null; if (!('email_status' in data)) data.email_status = 'non_verifiee'; }
    data.updated_at = now();
    update('contacts', c.id, data);
    logEvent('contact', c.id, 'modifie', { champs: Object.keys(data).filter((k) => k !== 'updated_at') }, c.establishment_id);
    refreshReliability(est);
    if (data.email_status === 'invalide') run("UPDATE contacts SET is_primary = 0 WHERE id = ?", c.id);
    recomputeScore(est.id);
    res.json(get('SELECT * FROM contacts WHERE id = ?', c.id));
  });

  app.delete('/api/contacts/:id', (req, res) => {
    const c = get('SELECT * FROM contacts WHERE id = ?', Number(req.params.id));
    if (!c) return res.status(404).json({ error: 'Contact introuvable' });
    run('DELETE FROM contacts WHERE id = ?', c.id);
    logEvent('contact', c.id, 'supprime', { email: c.email }, c.establishment_id);
    recomputeScore(c.establishment_id);
    res.json({ ok: true });
  });

  app.post('/api/contacts/:id/primary', (req, res) => {
    setPrimary(Number(req.params.id));
    res.json({ ok: true });
  });

  app.post('/api/contacts/:id/check', async (req, res) => {
    const c = get('SELECT * FROM contacts WHERE id = ?', Number(req.params.id));
    if (!c?.email) return res.status(400).json({ error: 'Ce contact n\'a pas d\'adresse e-mail' });
    const mx = await checkMx(c.email);
    const fields = { mx_ok: mx, updated_at: now() };
    let hunter = null;
    if (req.body?.hunter && hasHunterKey()) {
      hunter = await hunterVerify(c.email);
      if (hunter.status === 'valid') fields.email_status = 'verifiee';
      if (hunter.status === 'invalid') fields.email_status = 'invalide';
    }
    if (mx === 0) fields.email_status = 'invalide';
    update('contacts', c.id, fields);
    refreshReliability(getEstablishment(c.establishment_id));
    recomputeScore(c.establishment_id);
    logEvent('contact', c.id, 'verifie', { mx, hunter }, c.establishment_id);
    res.json({ mx, hunter, contact: get('SELECT * FROM contacts WHERE id = ?', c.id) });
  });
}
