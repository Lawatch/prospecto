import { fetchJson, haversineKm, nameSimilarity, throttle } from '../util.js';
import { ESTABLISHMENT_TYPES, roleCategory, typeFromNaf } from './catalog.js';

// API « Recherche d'entreprises » de l'État (recherche-entreprises.api.gouv.fr) : gratuite, sans clé,
// données publiques SIRENE (INSEE) et RNE (INPI) — dirigeants, effectifs, nombre d'établissements.
// Limite publiée : 7 requêtes par seconde. Rayon maximal pour la recherche géographique : 50 km.
const BASE = process.env.PROSPECTO_SIRENE_URL || 'https://recherche-entreprises.api.gouv.fr';

async function call(path) {
  await throttle('sirene', 160);
  return fetchJson(BASE + path, { timeoutMs: 20000 });
}

function establishmentName(company, etab) {
  const enseigne = etab?.liste_enseignes?.find(Boolean);
  return enseigne || etab?.nom_commercial || company.nom_complet || company.nom_raison_sociale;
}

export function companyFacts(company) {
  const dirigeants = (company.dirigeants || []).map((d) => {
    if (d.type_dirigeant === 'personne morale') {
      return { kind: 'personne_morale', name: d.denomination, siren: d.siren, role: d.qualite || 'Dirigeant (personne morale)' };
    }
    return { kind: 'personne_physique', first_name: titleCase(d.prenoms?.split(' ')[0] || ''), last_name: titleCase(d.nom || ''), role: d.qualite || 'Dirigeant' };
  });
  const holding = dirigeants.find((d) => d.kind === 'personne_morale');
  return {
    siren: company.siren,
    legal_name: company.nom_raison_sociale || company.nom_complet,
    naf: company.activite_principale,
    headcount_range: company.tranche_effectif_salarie || null,
    sites_count: company.nombre_etablissements_ouverts ?? company.nombre_etablissements ?? null,
    company_category: company.categorie_entreprise || null,
    group_hint: holding?.name || null,
    dirigeants,
  };
}

function titleCase(s) {
  return String(s).toLowerCase().replace(/(^|[\s-])(\p{L})/gu, (m, p, c) => p + c.toUpperCase());
}

export function mapSireneResult(company, etab, origin) {
  const facts = companyFacts(company);
  const name = establishmentName(company, etab);
  const lat = etab?.latitude != null ? Number(etab.latitude) : null;
  const lon = etab?.longitude != null ? Number(etab.longitude) : null;
  return {
    name,
    type: typeFromNaf(etab?.activite_principale || company.activite_principale, name),
    sector: 'hebergement',
    address: etab?.adresse ? etab.adresse.replace(/\s+\d{5}\s+.*$/, '') : null,
    postcode: etab?.code_postal || null,
    city: etab?.libelle_commune || null,
    lat, lon,
    distance_km: origin && lat != null ? haversineKm(origin.lat, origin.lon, lat, lon) : null,
    siren: company.siren,
    siret: etab?.siret || null,
    legal_name: facts.legal_name,
    naf: etab?.activite_principale || facts.naf,
    headcount_range: etab?.tranche_effectif_salarie || facts.headcount_range,
    sites_count: facts.sites_count,
    company_category: facts.company_category,
    group_name: facts.group_hint,
    dirigeants: facts.dirigeants,
    source: { source: 'SIRENE / RNE (recherche-entreprises.api.gouv.fr)', ref: etab?.siret || company.siren, url: `https://annuaire-entreprises.data.gouv.fr/entreprise/${company.siren}` },
  };
}

export async function searchSireneNear({ lat, lon, radiusKm, types = [], nafCodes = [], maxPages = 4 }) {
  const codes = new Set(nafCodes.map((c) => c.trim().toUpperCase()).filter((c) => /^\d{2}\.\d{2}[A-Z]$/.test(c)));
  for (const t of types) for (const c of ESTABLISHMENT_TYPES[t]?.naf || []) codes.add(c);
  if (!codes.size) return [];
  const radius = Math.min(Math.max(radiusKm, 0.5), 50);
  const out = [];
  for (let page = 1; page <= maxPages; page++) {
    const data = await call(`/near_point?lat=${lat}&long=${lon}&radius=${radius}&activite_principale=${[...codes].join(',')}&per_page=25&page=${page}`);
    for (const company of data?.results || []) {
      if (company.etat_administratif && company.etat_administratif !== 'A') continue;
      const etabs = (company.matching_etablissements || []).filter((e) => !e.etat_administratif || e.etat_administratif === 'A');
      for (const etab of etabs.length ? etabs : []) out.push(mapSireneResult(company, etab, { lat, lon }));
    }
    if (!data || page >= (data.total_pages || 1)) break;
  }
  return out;
}

// Rapproche un établissement (souvent issu d'OSM) de son entité légale.
export async function matchCompany(est) {
  const queries = [];
  if (est.siret) queries.push(`/search?q=${est.siret}&per_page=5`);
  if (est.name && est.postcode) queries.push(`/search?q=${encodeURIComponent(est.name)}&code_postal=${est.postcode}&per_page=10`);
  if (est.name && est.lat != null) queries.push(`/near_point?lat=${est.lat}&long=${est.lon}&radius=0.3&per_page=25`);
  for (const q of queries) {
    const data = await call(q);
    let best = null;
    for (const company of data?.results || []) {
      for (const etab of company.matching_etablissements || [company.siege].filter(Boolean)) {
        if (est.siret && etab.siret === est.siret) return { company, etab, confidence: 1 };
        const sim = Math.max(nameSimilarity(est.name, establishmentName(company, etab) || ''), nameSimilarity(est.name, company.nom_complet || ''));
        const dist = est.lat != null && etab.latitude != null ? haversineKm(est.lat, est.lon, Number(etab.latitude), Number(etab.longitude)) : null;
        const near = dist != null ? dist < 0.4 : etab.code_postal === est.postcode;
        const conf = sim * (near ? 1 : 0.6);
        if (sim >= 0.6 && conf > (best?.confidence || 0)) best = { company, etab, confidence: Math.round(conf * 100) / 100 };
      }
    }
    if (best && best.confidence >= 0.6) return best;
  }
  return null;
}

export function dirigeantsToContacts(dirigeants, sourceUrl) {
  return (dirigeants || []).filter((d) => d.kind === 'personne_physique' && d.last_name).map((d) => ({
    first_name: d.first_name || null,
    last_name: d.last_name,
    role: d.role,
    role_category: roleCategory(d.role) === 'autre' ? 'proprietaire' : roleCategory(d.role),
    email: null,
    source: 'Registre national des entreprises (via recherche-entreprises.api.gouv.fr)',
    source_url: sourceUrl,
  }));
}
