import { all, get, insert, now, run, update } from '../db.js';
import { geocode } from './geocode.js';
import { searchOsm } from './osm.js';
import { searchSireneNear, dirigeantsToContacts } from './sirene.js';
import { hasPlacesKey, searchPlaces } from './places.js';
import { getEstablishment, hydrate, recomputeScore, upsertEstablishment } from './establishments.js';
import { upsertContact } from './contacts.js';

function splitList(v) {
  if (Array.isArray(v)) return v.map((s) => String(s).trim()).filter(Boolean);
  return String(v || '').split(/[,;\n]/).map((s) => s.trim()).filter(Boolean);
}

export async function runSearch(input) {
  const params = {
    location: String(input.location || '').trim(),
    radiusKm: Math.min(Math.max(Number(input.radiusKm) || 20, 1), 100),
    types: splitList(input.types),
    keywords: splitList(input.keywords),
    nameKeywords: splitList(input.nameKeywords),
    customTags: splitList(input.customTags),
    nafCodes: splitList(input.nafCodes),
    chainFilter: input.chainFilter || 'tous',
    sources: splitList(input.sources).length ? splitList(input.sources) : ['osm', 'sirene'],
    sector: input.sector || null,
    minHeadcount: input.minHeadcount || null,
  };
  const origin = await geocode(params.location);
  const errors = [];
  const found = [];
  const tasks = [];
  if (params.sources.includes('osm')) {
    tasks.push(searchOsm({ ...params, lat: origin.lat, lon: origin.lon }).then((r) => found.push(...r)).catch((e) => errors.push({ source: 'OpenStreetMap', message: e.message })));
  }
  if (params.sources.includes('sirene')) {
    tasks.push(searchSireneNear({ ...params, lat: origin.lat, lon: origin.lon }).then((r) => found.push(...r)).catch((e) => errors.push({ source: 'SIRENE', message: e.message })));
  }
  if (params.sources.includes('google')) {
    if (!hasPlacesKey()) errors.push({ source: 'Google Places', message: 'Aucune clé API configurée (Paramètres > Sources de données)' });
    else tasks.push(searchPlaces({ ...params, lat: origin.lat, lon: origin.lon }).then((r) => found.push(...r)).catch((e) => errors.push({ source: 'Google Places', message: e.message })));
  }
  await Promise.all(tasks);

  const searchId = insert('searches', { params: { ...params, origin }, created_at: now() });
  const ids = new Set();
  let created = 0;
  // Les résultats OSM/Google (avec site web) d'abord, puis SIRENE qui complète les données légales.
  found.sort((a, b) => (a.source.source.startsWith('SIRENE') ? 1 : 0) - (b.source.source.startsWith('SIRENE') ? 1 : 0));
  for (const c of found) {
    if (!c.name || c.distance_km > params.radiusKm * 1.05) continue;
    if (params.nameKeywords.length && !params.nameKeywords.some((k) => c.name.toLowerCase().includes(k.toLowerCase()))) continue;
    if (params.chainFilter === 'independants' && (c.brand)) continue;
    const { id, created: isNew } = upsertEstablishment(c, searchId);
    if (isNew) created++;
    if (!ids.has(id)) run('INSERT OR IGNORE INTO search_results (search_id, establishment_id, distance_km, is_new) VALUES (?, ?, ?, ?)', searchId, id, c.distance_km ?? null, isNew ? 1 : 0);
    ids.add(id);
    if (c.dirigeants?.length) {
      const est = getEstablishment(id);
      for (const d of dirigeantsToContacts(c.dirigeants, c.source.url)) upsertContact(est, d);
    }
  }
  for (const id of ids) recomputeScore(id);
  update('searches', searchId, { result_count: ids.size, new_count: created, errors: errors.length ? errors : null });
  return { searchId, origin, total: ids.size, created, errors, results: searchResults(searchId) };
}

export function searchResults(searchId) {
  return all(`SELECT e.*, sr.distance_km AS search_distance_km, sr.is_new,
                (SELECT count(*) FROM contacts c WHERE c.establishment_id = e.id AND c.email IS NOT NULL AND c.email_status != 'invalide') AS email_count
              FROM search_results sr JOIN establishments e ON e.id = sr.establishment_id
              WHERE sr.search_id = ? ORDER BY e.score DESC, sr.distance_km`, searchId).map(hydrate);
}
