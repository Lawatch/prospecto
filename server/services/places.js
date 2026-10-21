import { fetchJson, haversineKm, normalizeUrl } from '../util.js';
import { ESTABLISHMENT_TYPES, typeFromGoogle } from './catalog.js';
import { getSecret } from '../crypto.js';

// Google Places API (New) — Text Search. Optionnel : nécessite une clé API et un compte de facturation Google Cloud.
// Les champs site web / téléphone relèvent du niveau tarifaire « Enterprise ».
// Conditions Google : seul l'identifiant place_id peut être conservé sans limite ; les autres contenus
// ne doivent pas être mis en cache plus de 30 jours (voir docs/ARCHITECTURE.md).
const FIELDS = ['places.id', 'places.displayName', 'places.formattedAddress', 'places.location', 'places.websiteUri',
  'places.nationalPhoneNumber', 'places.primaryType', 'places.types', 'places.addressComponents', 'nextPageToken'].join(',');

export function hasPlacesKey() {
  return !!getSecret('google_places_key');
}

export function mapPlace(p, origin) {
  const comp = (type) => p.addressComponents?.find((c) => c.types?.includes(type))?.longText || null;
  const name = p.displayName?.text || '';
  const lat = p.location?.latitude;
  const lon = p.location?.longitude;
  return {
    name,
    type: typeFromGoogle(p.primaryType, p.types, name),
    sector: 'hebergement',
    address: [comp('street_number'), comp('route')].filter(Boolean).join(' ') || p.formattedAddress || null,
    postcode: comp('postal_code'),
    city: comp('locality'),
    lat, lon,
    distance_km: origin ? haversineKm(origin.lat, origin.lon, lat, lon) : null,
    website: normalizeUrl(p.websiteUri),
    phone: p.nationalPhoneNumber || null,
    google_place_id: p.id,
    source: { source: 'Google Places', ref: p.id, url: `https://www.google.com/maps/place/?q=place_id:${p.id}` },
  };
}

export async function searchPlaces({ lat, lon, radiusKm, types = [], keywords = [], maxPages = 3 }) {
  const key = getSecret('google_places_key');
  if (!key) return [];
  const queries = new Set(keywords.filter(Boolean));
  for (const t of types) if (ESTABLISHMENT_TYPES[t]?.google) queries.add(ESTABLISHMENT_TYPES[t].google);
  const out = [];
  for (const textQuery of queries) {
    let pageToken;
    for (let page = 0; page < maxPages; page++) {
      const body = {
        textQuery,
        languageCode: 'fr',
        pageSize: 20,
        locationBias: { circle: { center: { latitude: lat, longitude: lon }, radius: Math.min(radiusKm * 1000, 50000) } },
        ...(pageToken ? { pageToken } : {}),
      };
      const data = await fetchJson('https://places.googleapis.com/v1/places:searchText', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': FIELDS },
        body: JSON.stringify(body),
      });
      for (const p of data?.places || []) {
        const mapped = mapPlace(p, { lat, lon });
        // locationBias n'est qu'une préférence : on écarte ce qui sort du rayon demandé.
        if (mapped.distance_km == null || mapped.distance_km <= radiusKm) out.push(mapped);
      }
      pageToken = data?.nextPageToken;
      if (!pageToken) break;
    }
  }
  return out;
}
