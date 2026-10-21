export function stripAccents(s) {
  return String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '');
}

const NAME_STOPWORDS = new Set(['hotel', 'hotels', 'the', 'le', 'la', 'les', 'l', 'de', 'du', 'des', 'et', 'and', 'sas', 'sarl', 'sa', 'eurl', 'sci', 'snc']);

// Clé de comparaison des noms : sans accents, sans ponctuation ni mots génériques.
export function nameKey(name) {
  return stripAccents(name).toLowerCase()
    .replace(/[''`]/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((w) => w && !NAME_STOPWORDS.has(w))
    .join(' ')
    .trim();
}

export function nameSimilarity(a, b) {
  const ta = new Set(nameKey(a).split(' ').filter(Boolean));
  const tb = new Set(nameKey(b).split(' ').filter(Boolean));
  if (!ta.size || !tb.size) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return inter / Math.min(ta.size, tb.size);
}

export function haversineKm(lat1, lon1, lat2, lon2) {
  if ([lat1, lon1, lat2, lon2].some((v) => v == null || Number.isNaN(Number(v)))) return null;
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) * 10) / 10;
}

export function normalizeUrl(url) {
  if (!url) return null;
  let u = String(url).trim();
  if (!u) return null;
  if (!/^https?:\/\//i.test(u)) u = 'https://' + u.replace(/^\/+/, '');
  try {
    const parsed = new URL(u);
    if (!['http:', 'https:'].includes(parsed.protocol)) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

export function domainOf(urlOrEmail) {
  if (!urlOrEmail) return null;
  const s = String(urlOrEmail).trim().toLowerCase();
  if (s.includes('@') && !s.includes('/')) return s.split('@').pop() || null;
  try {
    const host = new URL(normalizeUrl(s)).hostname;
    return host.replace(/^www\./, '');
  } catch {
    return null;
  }
}

// Domaines de réservation / annuaires : ce ne sont pas des sites officiels d'établissement.
const NON_OFFICIAL_DOMAINS = ['booking.com', 'expedia', 'tripadvisor', 'hotels.com', 'facebook.com', 'instagram.com',
  'airbnb', 'pagesjaunes.fr', 'google.', 'trivago', 'agoda', 'linkedin.com', 'wikipedia.org'];
export function isOfficialDomain(domain) {
  if (!domain) return false;
  return !NON_OFFICIAL_DOMAINS.some((d) => domain.includes(d));
}

export const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,24}/gi;
export function isValidEmail(email) {
  return /^[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,24}$/i.test(String(email || '').trim());
}

const GENERIC_LOCALPARTS = ['contact', 'info', 'infos', 'information', 'hello', 'bonjour', 'accueil', 'reception', 'reservation',
  'reservations', 'booking', 'resa', 'sales', 'commercial', 'events', 'evenements', 'seminaires', 'groupes', 'admin',
  'office', 'mail', 'hotel', 'welcome', 'frontdesk', 'communication', 'presse', 'marketing', 'restaurant', 'spa'];
const HR_LOCALPARTS = ['rh', 'recrutement', 'recrutements', 'jobs', 'job', 'emploi', 'carriere', 'carrieres', 'careers', 'hr', 'candidature', 'candidatures', 'talents'];
const DIRECTION_LOCALPARTS = ['direction', 'directeur', 'director', 'gm', 'dg', 'management', 'gerant', 'gerance'];
const NOREPLY = /^(no-?reply|ne-?pas-?repondre|donotreply|mailer-daemon|postmaster|webmaster|abuse|privacy|rgpd|dpo|gdpr)/;

export function classifyEmail(email) {
  const local = stripAccents(String(email).split('@')[0].toLowerCase());
  if (NOREPLY.test(local)) return 'technique';
  const base = local.replace(/[0-9._-]+$/, '');
  if (HR_LOCALPARTS.some((p) => base === p || base.startsWith(p + '.') || base.startsWith(p + '-'))) return 'rh';
  if (DIRECTION_LOCALPARTS.some((p) => base === p || base.startsWith(p + '.') || base.startsWith(p + '-'))) return 'direction';
  if (GENERIC_LOCALPARTS.some((p) => base === p || base.startsWith(p + '.') || base.startsWith(p + '-') || base.startsWith(p))) return 'generique';
  if (/^[a-z]+[._-][a-z]+$/.test(local) || /^[a-z]\.?[a-z]{3,}$/.test(local)) return 'nominative';
  return 'generique';
}

export function parseIntSafe(v) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
}

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// Petit limiteur de débit par service externe (respect des politiques d'usage : ex. Nominatim 1 req/s).
const lastCall = new Map();
export async function throttle(key, minIntervalMs) {
  const prev = lastCall.get(key) || 0;
  const wait = prev + minIntervalMs - Date.now();
  lastCall.set(key, Math.max(Date.now(), prev + minIntervalMs));
  if (wait > 0) await sleep(wait);
}

export async function fetchJson(url, { timeoutMs = 25000, headers = {}, ...opts } = {}) {
  const res = await fetch(url, { ...opts, headers: { Accept: 'application/json', ...headers }, signal: AbortSignal.timeout(timeoutMs) });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status} sur ${new URL(url).hostname}${data?.error?.message ? ' : ' + data.error.message : ''}`);
    err.status = res.status;
    err.body = data ?? text.slice(0, 500);
    throw err;
  }
  return data;
}

export function csvEscape(v) {
  const s = v == null ? '' : String(v);
  return /[";\n\r,]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

export function toCsv(rows, columns) {
  const head = columns.map((c) => csvEscape(c.label)).join(';');
  const lines = rows.map((r) => columns.map((c) => csvEscape(typeof c.get === 'function' ? c.get(r) : r[c.key])).join(';'));
  return '﻿' + [head, ...lines].join('\r\n');
}

export function parseCsv(text) {
  const src = String(text).replace(/^﻿/, '');
  const firstLine = src.split(/\r?\n/, 1)[0] || '';
  const delim = (firstLine.match(/;/g) || []).length >= (firstLine.match(/,/g) || []).length ? ';' : ',';
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === delim) { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((f) => f.trim() !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f.trim() !== '')) rows.push(row);
  if (!rows.length) return [];
  const headers = rows[0].map((h) => stripAccents(h).toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, ''));
  return rows.slice(1).map((r) => Object.fromEntries(headers.map((h, i) => [h, (r[i] ?? '').trim()])));
}
