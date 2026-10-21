import dns from 'node:dns/promises';
import { all, get, insert, logEvent, now, run, update } from '../db.js';
import { classifyEmail, domainOf, isValidEmail } from '../util.js';
import { roleCategory } from './catalog.js';

export const EMAIL_STATUSES = {
  verifiee: 'Vérifiée',
  publiee: 'Publiée par une source publique',
  non_verifiee: 'Non vérifiée',
  invalide: 'Invalide',
};

const SOURCE_BASE = {
  site_officiel: 60,
  hunter: 50,
  osm: 50,
  manuel: 55,
  rne: 0,
};

// Indicateur de fiabilité (0-100) d'un contact : source, cohérence du domaine, existence d'un serveur de messagerie.
export function computeReliability(contact, establishment) {
  if (!contact.email) return 0;
  if (contact.email_status === 'invalide') return 0;
  if (contact.email_status === 'verifiee') return 95;
  let score = SOURCE_BASE[contact.source_kind] ?? 45;
  if (contact.source_kind === 'hunter' && contact.confidence != null) score = Math.round(30 + contact.confidence * 0.4);
  const d = domainOf(contact.email);
  if (establishment?.domain && d && (d === establishment.domain || d.endsWith('.' + establishment.domain) || establishment.domain.endsWith('.' + d))) score += 15;
  if (contact.mx_ok === 1) score += 10;
  if (contact.mx_ok === 0) score = Math.min(score, 10);
  if (['generique'].includes(contact.email_kind)) score = Math.min(score, 75);
  return Math.max(0, Math.min(90, score));
}

// Un domaine n'est déclaré « sans messagerie » que si la résolution DNS fonctionne par ailleurs :
// derrière un proxy ou hors ligne, tout échoue, et rien ne doit alors être marqué invalide.
let dnsCheck = { ok: null, at: 0 };
async function dnsWorks() {
  if (dnsCheck.ok !== null && Date.now() - dnsCheck.at < 10 * 60_000) return dnsCheck.ok;
  const ok = await dns.resolveMx('gmail.com').then((r) => r.length > 0, () => false);
  dnsCheck = { ok, at: Date.now() };
  return ok;
}

export async function checkMx(email) {
  const domain = domainOf(email);
  if (!domain) return 0;
  try {
    const mx = await dns.resolveMx(domain);
    return mx.length ? 1 : 0;
  } catch (err) {
    if (['ENOTFOUND', 'ENODATA', 'NXDOMAIN'].includes(err.code)) return (await dnsWorks()) ? 0 : null;
    return null; // erreur réseau : inconnu
  }
}

function sourceKind(source = '') {
  const s = source.toLowerCase();
  if (s.includes('site officiel')) return 'site_officiel';
  if (s.includes('hunter')) return 'hunter';
  if (s.includes('openstreetmap')) return 'osm';
  if (s.includes('registre') || s.includes('rne')) return 'rne';
  return 'manuel';
}

export function upsertContact(establishment, data, { actor = 'systeme' } = {}) {
  const email = data.email ? String(data.email).trim().toLowerCase() : null;
  if (email && !isValidEmail(email)) throw Object.assign(new Error(`Adresse e-mail invalide : ${email}`), { status: 400 });
  const existing = email
    ? get('SELECT * FROM contacts WHERE establishment_id = ? AND email = ?', establishment.id, email)
    : (data.last_name ? get('SELECT * FROM contacts WHERE establishment_id = ? AND lower(last_name) = lower(?) AND coalesce(lower(first_name),\'\') = coalesce(lower(?),\'\')', establishment.id, data.last_name, data.first_name || null) : null);
  const role = data.role ?? existing?.role ?? null;
  const fields = {
    civility: data.civility ?? existing?.civility ?? null,
    first_name: data.first_name ?? existing?.first_name ?? null,
    last_name: data.last_name ?? existing?.last_name ?? null,
    role,
    role_category: data.role_category || existing?.role_category || (email && classifyEmail(email) === 'generique' && !data.last_name ? 'generique' : roleCategory(role || '')),
    email: email ?? existing?.email ?? null,
    email_kind: email ? classifyEmail(email) : existing?.email_kind ?? null,
    email_status: data.email_status || existing?.email_status || (email ? 'non_verifiee' : 'non_verifiee'),
    phone: data.phone ?? existing?.phone ?? null,
    source: existing?.source && actor === 'systeme' ? existing.source : (data.source || existing?.source || 'Saisie manuelle'),
    source_url: data.source_url ?? existing?.source_url ?? null,
    collected_at: data.collected_at || existing?.collected_at || now(),
    mx_ok: data.mx_ok ?? existing?.mx_ok ?? null,
    notes: data.notes ?? existing?.notes ?? null,
    updated_at: now(),
  };
  if (existing && actor === 'systeme') {
    // Une donnée collectée automatiquement ne remplace jamais une donnée corrigée à la main.
    for (const k of ['civility', 'first_name', 'last_name', 'role', 'role_category', 'email_status', 'notes']) if (existing[k] != null) fields[k] = existing[k];
    if (existing.email_status === 'verifiee') fields.email_status = 'verifiee';
  }
  fields.reliability = computeReliability({ ...fields, source_kind: sourceKind(fields.source), confidence: data.confidence }, establishment);
  if (existing) {
    update('contacts', existing.id, fields);
    if (actor !== 'systeme') logEvent('contact', existing.id, 'modifie', { email: fields.email }, establishment.id);
    return existing.id;
  }
  const id = insert('contacts', { establishment_id: establishment.id, created_at: now(), ...fields });
  logEvent('contact', id, 'ajoute', { email: fields.email, source: fields.source }, establishment.id);
  const hasPrimary = get('SELECT 1 AS x FROM contacts WHERE establishment_id = ? AND is_primary = 1', establishment.id);
  if (!hasPrimary && fields.email) update('contacts', id, { is_primary: 1 });
  return id;
}

export function refreshReliability(establishment) {
  for (const c of all('SELECT * FROM contacts WHERE establishment_id = ?', establishment.id)) {
    update('contacts', c.id, { reliability: computeReliability({ ...c, source_kind: sourceKind(c.source) }, establishment) });
  }
}

export function setPrimary(contactId) {
  const c = get('SELECT * FROM contacts WHERE id = ?', contactId);
  if (!c) return;
  run('UPDATE contacts SET is_primary = 0 WHERE establishment_id = ?', c.establishment_id);
  run('UPDATE contacts SET is_primary = 1 WHERE id = ?', contactId);
}

export function isOpposed(email, establishmentId = null) {
  const e = String(email || '').toLowerCase();
  const domain = domainOf(e);
  const row = get(`SELECT * FROM opposition WHERE (email IS NOT NULL AND email = ?) OR (domain IS NOT NULL AND domain = ?) OR (establishment_id IS NOT NULL AND establishment_id = ?) LIMIT 1`,
    e || '__none__', domain || '__none__', establishmentId ?? -1);
  return row || null;
}

export function addOpposition({ email, domain, establishment_id, reason }) {
  const e = email ? String(email).toLowerCase().trim() : null;
  const d = domain ? String(domain).toLowerCase().trim() : null;
  if (!e && !d && !establishment_id) throw Object.assign(new Error('Indiquez une adresse, un domaine ou un établissement.'), { status: 400 });
  const existing = get('SELECT id FROM opposition WHERE coalesce(email,\'\') = coalesce(?,\'\') AND coalesce(domain,\'\') = coalesce(?,\'\') AND coalesce(establishment_id,-1) = coalesce(?,-1)', e, d, establishment_id ?? null);
  if (existing) return existing.id;
  const id = insert('opposition', { email: e, domain: d, establishment_id: establishment_id ?? null, reason: reason || null, created_at: now() });
  if (establishment_id) logEvent('establishment', establishment_id, 'opposition', { email: e, domain: d, reason });
  // Les messages non encore envoyés vers une cible opposée sont retirés de la file.
  run(`UPDATE messages SET status = 'ignoree', queued = 0, updated_at = ? WHERE status IN ('a_valider','brouillon','validee','erreur')
       AND ((? IS NOT NULL AND lower(to_email) = ?) OR (? IS NOT NULL AND lower(to_email) LIKE '%@' || ?) OR (? IS NOT NULL AND establishment_id = ?))`,
  now(), e, e, d, d, establishment_id ?? null, establishment_id ?? null);
  return id;
}
