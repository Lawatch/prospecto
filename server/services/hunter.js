import { fetchJson } from '../util.js';
import { getSecret } from '../crypto.js';
import { roleCategory } from './catalog.js';

// Hunter.io (optionnel, clé API requise ; offre gratuite limitée à quelques dizaines de recherches/mois).
// Retourne les adresses publiques rattachées à un domaine, avec leurs sources et un indice de confiance.
export function hasHunterKey() {
  return !!getSecret('hunter_key');
}

export async function hunterDomainSearch(domain) {
  const key = getSecret('hunter_key');
  if (!key) throw new Error('Aucune clé Hunter.io configurée (Paramètres > Sources de données).');
  const data = await fetchJson(`https://api.hunter.io/v2/domain-search?domain=${encodeURIComponent(domain)}&limit=10&api_key=${encodeURIComponent(key)}`);
  return (data?.data?.emails || []).map((e) => ({
    email: e.value,
    first_name: e.first_name || null,
    last_name: e.last_name || null,
    role: e.position || (e.type === 'generic' ? 'Adresse générique' : null),
    role_category: e.type === 'generic' ? 'generique' : roleCategory(e.position || e.department || ''),
    confidence: e.confidence ?? null,
    verified: e.verification?.status === 'valid',
    source_url: e.sources?.[0]?.uri || `https://hunter.io/search/${domain}`,
  }));
}

export async function hunterVerify(email) {
  const key = getSecret('hunter_key');
  if (!key) throw new Error('Aucune clé Hunter.io configurée.');
  const data = await fetchJson(`https://api.hunter.io/v2/email-verifier?email=${encodeURIComponent(email)}&api_key=${encodeURIComponent(key)}`);
  return { status: data?.data?.status, score: data?.data?.score };
}
