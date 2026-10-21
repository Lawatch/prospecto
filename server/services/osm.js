import { fetchJson, haversineKm, normalizeUrl, throttle } from '../util.js';
import { UA_HEADERS } from '../config.js';
import { ESTABLISHMENT_TYPES, typeFromOsm } from './catalog.js';

// Recherche d'établissements dans OpenStreetMap via l'API Overpass (gratuite, données sous licence ODbL :
// attribution « © contributeurs OpenStreetMap » obligatoire, usage raisonnable des serveurs publics).
const OVERPASS_ENDPOINTS = process.env.PROSPECTO_OVERPASS_URL
  ? [process.env.PROSPECTO_OVERPASS_URL]
  : ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter'];

function escapeRegex(s) {
  return s.replace(/[\\^$.*+?()[\]{}|"]/g, '\\$&');
}

export function buildOverpassQuery({ lat, lon, radiusKm, types = [], customTags = [], nameKeywords = [], chainFilter = 'tous' }) {
  const radius = Math.round(Math.min(Math.max(radiusKm, 1), 100) * 1000);
  const tagPairs = new Map();
  for (const t of types) for (const [k, v] of ESTABLISHMENT_TYPES[t]?.osm || []) tagPairs.set(`${k}=${v}`, [k, v]);
  for (const raw of customTags) {
    const m = String(raw).trim().match(/^([a-z_:]+)\s*=\s*([\w:-]+)$/i);
    if (m) tagPairs.set(`${m[1]}=${m[2]}`, [m[1], m[2]]);
  }
  if (!tagPairs.size) return null;
  const nameFilter = nameKeywords.length ? `["name"~"${nameKeywords.map(escapeRegex).join('|')}",i]` : '';
  const chain = chainFilter === 'independants' ? '[!"brand"]' : chainFilter === 'chaines' ? '["brand"]' : '';
  const parts = [...tagPairs.values()].map(([k, v]) => `  nwr["${k}"="${v}"]["name"]${nameFilter}${chain}(around:${radius},${lat},${lon});`);
  return `[out:json][timeout:60];\n(\n${parts.join('\n')}\n);\nout center tags 1500;`;
}

export function mapOsmElement(el, origin) {
  const t = el.tags || {};
  const lat = el.lat ?? el.center?.lat;
  const lon = el.lon ?? el.center?.lon;
  const street = [t['addr:housenumber'], t['addr:street']].filter(Boolean).join(' ');
  const website = normalizeUrl(t.website || t['contact:website'] || t.url);
  const email = (t.email || t['contact:email'] || '').split(/[;,]/)[0].trim() || null;
  return {
    name: t.name,
    type: typeFromOsm(t),
    sector: t.amenity === 'restaurant' ? 'restauration' : 'hebergement',
    address: street || t['addr:full'] || null,
    postcode: t['addr:postcode'] || null,
    city: t['addr:city'] || null,
    lat, lon,
    distance_km: origin ? haversineKm(origin.lat, origin.lon, lat, lon) : null,
    website,
    phone: t.phone || t['contact:phone'] || null,
    generic_email: email,
    brand: t.brand || null,
    group_name: t.operator && t.operator !== t.name ? t.operator : (t.brand || null),
    stars: parseInt(t.stars, 10) || null,
    rooms: parseInt(t.rooms, 10) || null,
    osm_ref: `${el.type}/${el.id}`,
    source: { source: 'OpenStreetMap', ref: `${el.type}/${el.id}`, url: `https://www.openstreetmap.org/${el.type}/${el.id}`, license: 'ODbL © contributeurs OpenStreetMap' },
  };
}

export async function searchOsm(params) {
  const query = buildOverpassQuery(params);
  if (!query) return [];
  let lastErr;
  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      await throttle('overpass', 2000);
      const data = await fetchJson(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...UA_HEADERS },
        body: 'data=' + encodeURIComponent(query),
        timeoutMs: 90000,
      });
      return (data?.elements || []).filter((el) => el.tags?.name).map((el) => mapOsmElement(el, params));
    } catch (err) {
      lastErr = err;
    }
  }
  throw new Error(`OpenStreetMap indisponible : ${lastErr?.message || 'erreur inconnue'}`);
}
