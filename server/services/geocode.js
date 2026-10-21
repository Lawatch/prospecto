import { fetchJson, throttle } from '../util.js';
import { UA_HEADERS } from '../config.js';
import { getSetting } from '../settings.js';

// Géocodage d'une ville ou adresse de départ.
// 1) Géoplateforme IGN (Base Adresse Nationale), gratuite et sans clé, pour la France.
// 2) Ancienne API adresse.data.gouv.fr (même format) en secours.
// 3) Nominatim (OpenStreetMap) pour l'international : 1 requête/seconde maximum, User-Agent identifiant.
const BAN_ENDPOINTS = process.env.PROSPECTO_GEOCODE_URL
  ? [process.env.PROSPECTO_GEOCODE_URL]
  : ['https://data.geopf.fr/geocodage/search', 'https://api-adresse.data.gouv.fr/search/'];

export async function geocode(query) {
  const q = String(query || '').trim();
  if (!q) throw new Error('Indiquez une ville ou une adresse de départ.');
  const errors = [];
  for (const endpoint of BAN_ENDPOINTS) {
    try {
      const data = await fetchJson(`${endpoint}?q=${encodeURIComponent(q)}&limit=1`, { timeoutMs: 10000 });
      const f = data?.features?.[0];
      if (f && (f.properties?.score ?? 1) >= 0.4) {
        const [lon, lat] = f.geometry.coordinates;
        return { lat, lon, label: f.properties.label, city: f.properties.city, postcode: f.properties.postcode, source: 'Base Adresse Nationale (IGN)' };
      }
    } catch (err) {
      errors.push(err.message);
    }
  }
  try {
    await throttle('nominatim', 1100);
    const email = getSetting('search').contact_email;
    const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&addressdetails=1&q=${encodeURIComponent(q)}${email ? '&email=' + encodeURIComponent(email) : ''}`;
    const data = await fetchJson(url, { headers: { ...UA_HEADERS, 'Accept-Language': 'fr' }, timeoutMs: 15000 });
    const r = data?.[0];
    if (r) {
      return {
        lat: Number(r.lat), lon: Number(r.lon), label: r.display_name,
        city: r.address?.city || r.address?.town || r.address?.village || null,
        postcode: r.address?.postcode || null, source: 'Nominatim (OpenStreetMap)',
      };
    }
  } catch (err) {
    errors.push(err.message);
  }
  const e = new Error(`Lieu introuvable : « ${q} »${errors.length ? ' (' + errors.join(' ; ') + ')' : ''}`);
  e.status = 400;
  throw e;
}
