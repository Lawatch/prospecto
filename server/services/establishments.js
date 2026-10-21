import { all, get, insert, logEvent, now, parseJson, run, tx, update } from '../db.js';
import { domainOf, haversineKm, isOfficialDomain, nameKey, nameSimilarity, normalizeUrl } from '../util.js';
import { getSetting } from '../settings.js';
import { scoreEstablishment } from './scoring.js';

const MERGEABLE = ['type', 'sector', 'address', 'postcode', 'city', 'lat', 'lon', 'distance_km', 'website', 'phone', 'generic_email',
  'group_name', 'brand', 'stars', 'rooms', 'siren', 'siret', 'legal_name', 'naf', 'headcount_range', 'sites_count', 'company_category',
  'osm_ref', 'google_place_id'];

export function hydrate(row) {
  if (!row) return row;
  return { ...row, sources: parseJson(row.sources, []), signals: parseJson(row.signals, []), score_details: parseJson(row.score_details, null), in_list: !!row.in_list, do_not_contact: !!row.do_not_contact };
}

export function findDuplicate(c) {
  if (c.osm_ref) { const r = get('SELECT * FROM establishments WHERE osm_ref = ?', c.osm_ref); if (r) return r; }
  if (c.google_place_id) { const r = get('SELECT * FROM establishments WHERE google_place_id = ?', c.google_place_id); if (r) return r; }
  if (c.siret) { const r = get('SELECT * FROM establishments WHERE siret = ?', c.siret); if (r) return r; }
  const key = nameKey(c.name);
  const domain = c.website ? domainOf(c.website) : null;
  if (domain && isOfficialDomain(domain)) {
    for (const r of all('SELECT * FROM establishments WHERE domain = ?', domain)) {
      const dist = haversineKm(c.lat, c.lon, r.lat, r.lon);
      if ((dist != null && dist < 1) || (c.postcode && c.postcode === r.postcode) || nameSimilarity(c.name, r.name) >= 0.8) return r;
    }
  }
  // Même nom (ou très proche) à moins de 300 m, ou même nom et même code postal.
  const candidates = c.lat != null
    ? all('SELECT * FROM establishments WHERE lat BETWEEN ? AND ? AND lon BETWEEN ? AND ?', c.lat - 0.01, c.lat + 0.01, c.lon - 0.015, c.lon + 0.015)
    : all('SELECT * FROM establishments WHERE postcode = ?', c.postcode || '');
  for (const r of candidates) {
    const sim = r.name_key === key ? 1 : nameSimilarity(c.name, r.name);
    const dist = haversineKm(c.lat, c.lon, r.lat, r.lon);
    if ((dist != null && dist < 0.3 && sim >= 0.5) || (sim >= 0.8 && dist == null && c.postcode && c.postcode === r.postcode)) return r;
  }
  return null;
}

function mergeSources(existing, incoming) {
  const list = parseJson(existing, []);
  if (incoming && !list.some((s) => s.source === incoming.source && s.ref === incoming.ref)) list.push(incoming);
  return list;
}

// Insère ou fusionne un établissement. Les valeurs déjà présentes (y compris corrections manuelles) ne sont jamais écrasées.
export function upsertEstablishment(candidate, searchId = null) {
  const collectedAt = now();
  const source = candidate.source ? { ...candidate.source, collected_at: collectedAt } : null;
  const website = normalizeUrl(candidate.website);
  const c = { ...candidate, website, domain: website ? domainOf(website) : null };
  const existing = findDuplicate(c);
  if (existing) {
    const fields = {};
    for (const k of MERGEABLE) if ((existing[k] == null || existing[k] === '') && c[k] != null && c[k] !== '') fields[k] = c[k];
    if (fields.website) fields.domain = c.domain;
    if (c.distance_km != null && existing.distance_km != null && c.distance_km < existing.distance_km) fields.distance_km = c.distance_km;
    fields.sources = mergeSources(existing.sources, source);
    if (searchId) fields.last_search_id = searchId;
    fields.updated_at = collectedAt;
    update('establishments', existing.id, fields);
    return { id: existing.id, created: false };
  }
  const row = { name: c.name, name_key: nameKey(c.name), created_at: collectedAt, updated_at: collectedAt, sources: source ? [source] : [], signals: [], first_search_id: searchId, last_search_id: searchId };
  for (const k of MERGEABLE) if (c[k] != null && c[k] !== '') row[k] = c[k];
  if (c.domain) row.domain = c.domain;
  const id = insert('establishments', row);
  logEvent('establishment', id, 'identifie', { source: source?.source });
  return { id, created: true };
}

export function getEstablishment(id) {
  return hydrate(get('SELECT * FROM establishments WHERE id = ?', id));
}

export function listContacts(establishmentId) {
  return all('SELECT * FROM contacts WHERE establishment_id = ? ORDER BY is_primary DESC, reliability DESC, id', establishmentId);
}

export function recomputeScore(id) {
  const est = getEstablishment(id);
  if (!est) return null;
  const scoring = getSetting('scoring');
  const profile = getSetting('profile');
  const { score, reasons } = scoreEstablishment(est, listContacts(id), { ...scoring, profile_keywords: profile.keywords });
  update('establishments', id, { score, score_details: reasons });
  return score;
}

export function recomputeAllScores() {
  for (const { id } of all('SELECT id FROM establishments')) recomputeScore(id);
}

export function setStatus(id, status, details = null) {
  const est = get('SELECT status FROM establishments WHERE id = ?', id);
  if (!est || est.status === status) return;
  // « Ne plus contacter » est définitif sauf action manuelle explicite sur la fiche.
  if (est.status === 'ne_plus_contacter' && !details?.manual) return;
  update('establishments', id, { status, updated_at: now() });
  logEvent('establishment', id, 'statut', { from: est.status, to: status, ...(details || {}) });
}

export function addSignals(id, signals) {
  const est = get('SELECT signals FROM establishments WHERE id = ?', id);
  const list = parseJson(est?.signals, []);
  for (const s of signals) {
    if (!list.some((x) => x.kind === s.kind && x.snippet === s.snippet)) list.push({ ...s, collected_at: s.collected_at || now() });
  }
  update('establishments', id, { signals: list });
  return list;
}

export function deleteEstablishment(id) {
  tx(() => {
    run('DELETE FROM events WHERE establishment_id = ?', id);
    run('DELETE FROM establishments WHERE id = ?', id);
  });
}
