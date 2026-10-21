// Référentiel des types d'établissements, de leurs correspondances OpenStreetMap / NAF,
// et des catégories de fonctions des décideurs.

export const ESTABLISHMENT_TYPES = {
  hotel: { label: 'Hôtel', osm: [['tourism', 'hotel']], naf: ['55.10Z'], google: 'hôtel' },
  apart_hotel: { label: "Appart'hôtel", osm: [['tourism', 'apartment']], naf: ['55.20Z'], google: "appart'hôtel" },
  residence_tourisme: { label: 'Résidence de tourisme', osm: [['tourism', 'apartment']], naf: ['55.20Z'], google: 'résidence de tourisme' },
  chambres_hotes: { label: "Chambres d'hôtes", osm: [['tourism', 'guest_house']], naf: ['55.20Z'], google: "chambres d'hôtes" },
  auberge: { label: 'Auberge de jeunesse', osm: [['tourism', 'hostel']], naf: ['55.20Z'], google: 'auberge de jeunesse' },
  motel: { label: 'Motel', osm: [['tourism', 'motel']], naf: ['55.10Z'], google: 'motel' },
  village_vacances: { label: 'Village vacances / resort', osm: [['leisure', 'resort']], naf: ['55.20Z'], google: 'village vacances' },
  camping: { label: 'Camping', osm: [['tourism', 'camp_site']], naf: ['55.30Z'], google: 'camping' },
  restaurant: { label: 'Restaurant', osm: [['amenity', 'restaurant']], naf: ['56.10A'], google: 'restaurant' },
  groupe_hotelier: { label: 'Groupe hôtelier', osm: [], naf: [], google: 'groupe hôtelier' },
  autre: { label: 'Autre', osm: [], naf: [], google: null },
};

export const TYPE_LABELS = Object.fromEntries(Object.entries(ESTABLISHMENT_TYPES).map(([k, v]) => [k, v.label]));

const APART_RE = /appart|apart'?h|aparthotel|apparthotel|adagio|citadines|appart city|odalys city|séjours\s*&\s*affaires|staycity|suite\s?home|residhome|nemea/i;
const RESIDENCE_RE = /r[ée]sidence|pierre\s*&\s*vacances|odalys|lagrange|goelia|vacancéole/i;

export function typeFromOsm(tags = {}) {
  const name = tags.name || '';
  if (tags.tourism === 'hotel') return APART_RE.test(name) ? 'apart_hotel' : 'hotel';
  if (tags.tourism === 'apartment') return APART_RE.test(name) ? 'apart_hotel' : (RESIDENCE_RE.test(name) ? 'residence_tourisme' : 'residence_tourisme');
  if (tags.tourism === 'guest_house') return 'chambres_hotes';
  if (tags.tourism === 'hostel') return 'auberge';
  if (tags.tourism === 'motel') return 'motel';
  if (tags.tourism === 'camp_site') return 'camping';
  if (tags.leisure === 'resort') return 'village_vacances';
  if (tags.amenity === 'restaurant') return 'restaurant';
  return 'autre';
}

export function typeFromNaf(naf, name = '') {
  if (!naf) return 'autre';
  if (naf.startsWith('55.10')) return APART_RE.test(name) ? 'apart_hotel' : 'hotel';
  if (naf.startsWith('55.20')) return APART_RE.test(name) ? 'apart_hotel' : 'residence_tourisme';
  if (naf.startsWith('55.30')) return 'camping';
  if (naf.startsWith('56.10')) return 'restaurant';
  return 'autre';
}

export function typeFromGoogle(primaryType, types = [], name = '') {
  const all = [primaryType, ...types].filter(Boolean);
  if (all.includes('hotel') || all.includes('resort_hotel')) return APART_RE.test(name) ? 'apart_hotel' : 'hotel';
  if (all.includes('extended_stay_hotel')) return 'apart_hotel';
  if (all.includes('motel')) return 'motel';
  if (all.includes('bed_and_breakfast') || all.includes('guest_house')) return 'chambres_hotes';
  if (all.includes('hostel')) return 'auberge';
  if (all.includes('campground') || all.includes('rv_park')) return 'camping';
  if (all.includes('restaurant')) return 'restaurant';
  if (all.includes('lodging')) return APART_RE.test(name) ? 'apart_hotel' : 'hotel';
  return 'autre';
}

// Tranches d'effectif INSEE (code -> libellé et valeur médiane indicative).
export const HEADCOUNT_RANGES = {
  NN: { label: 'Non renseigné', mid: null },
  '00': { label: '0 salarié', mid: 0 },
  '01': { label: '1 à 2 salariés', mid: 1.5 },
  '02': { label: '3 à 5 salariés', mid: 4 },
  '03': { label: '6 à 9 salariés', mid: 7.5 },
  11: { label: '10 à 19 salariés', mid: 15 },
  12: { label: '20 à 49 salariés', mid: 35 },
  21: { label: '50 à 99 salariés', mid: 75 },
  22: { label: '100 à 199 salariés', mid: 150 },
  31: { label: '200 à 249 salariés', mid: 225 },
  32: { label: '250 à 499 salariés', mid: 375 },
  41: { label: '500 à 999 salariés', mid: 750 },
  42: { label: '1 000 à 1 999 salariés', mid: 1500 },
  51: { label: '2 000 à 4 999 salariés', mid: 3500 },
  52: { label: '5 000 à 9 999 salariés', mid: 7500 },
  53: { label: '10 000 salariés et plus', mid: 10000 },
};

export const ROLE_CATEGORIES = {
  proprietaire: 'Propriétaire / exploitant',
  direction_generale: 'Direction générale',
  direction_etablissement: "Direction d'établissement",
  direction_operations: 'Direction des opérations',
  rh: 'Ressources humaines',
  commercial: 'Développement / commercial',
  generique: 'Adresse générique',
  autre: 'Autre',
};

export function roleCategory(role = '') {
  const r = role.toLowerCase();
  if (/(ressources humaines|\brh\b|recrut|talent|human resources|\bhr\b|people)/.test(r)) return 'rh';
  if (/(op[ée]rations?|exploitation|\bcoo\b)/.test(r)) return 'direction_operations';
  if (/(commercial|d[ée]veloppement|ventes|sales|revenue|marketing)/.test(r)) return 'commercial';
  if (/(directeur|directrice|director|manager|responsable).*(h[ôo]tel|[ée]tablissement|site|r[ée]sidence|general manager)|general manager|\bgm\b/.test(r)) return 'direction_etablissement';
  if (/(pr[ée]sident|directeur g[ée]n[ée]ral|directrice g[ée]n[ée]rale|\bdg\b|\bceo\b|directeur de la publication|directrice de la publication)/.test(r)) return 'direction_generale';
  if (/(g[ée]rant|propri[ée]taire|fondat|associ[ée]|exploitant|owner)/.test(r)) return 'proprietaire';
  if (/(directeur|directrice|director)/.test(r)) return 'direction_etablissement';
  return 'autre';
}

// Ordre de priorité des interlocuteurs par catégorie de poste visée.
export const DEFAULT_ROLE_PRIORITY = {
  direction_etablissement: ['direction_operations', 'direction_generale', 'proprietaire', 'direction_etablissement', 'rh', 'generique'],
  direction_adjointe: ['direction_etablissement', 'direction_generale', 'proprietaire', 'rh', 'direction_operations', 'generique'],
  gestion_operationnelle: ['direction_etablissement', 'direction_operations', 'direction_generale', 'proprietaire', 'rh', 'generique'],
  responsable_exploitation: ['direction_etablissement', 'direction_operations', 'direction_generale', 'proprietaire', 'rh', 'generique'],
  centre_de_profit: ['direction_generale', 'proprietaire', 'direction_operations', 'direction_etablissement', 'rh', 'generique'],
  developpement_commercial: ['commercial', 'direction_generale', 'proprietaire', 'direction_etablissement', 'generique'],
  generale: ['direction_etablissement', 'direction_generale', 'proprietaire', 'rh', 'direction_operations', 'commercial', 'generique'],
  relance: ['direction_etablissement', 'direction_generale', 'proprietaire', 'rh', 'generique'],
};

export const TEMPLATE_CATEGORIES = {
  direction_etablissement: "Direction d'établissement",
  direction_adjointe: 'Direction adjointe',
  gestion_operationnelle: 'Gestion opérationnelle',
  responsable_exploitation: "Responsable d'exploitation",
  centre_de_profit: 'Gestion de centre de profit',
  developpement_commercial: 'Développement commercial',
  generale: 'Candidature spontanée générale',
  relance: 'Relance',
};

export const ESTABLISHMENT_STATUSES = {
  identifie: 'Prospect identifié',
  contact_a_verifier: 'Contact à vérifier',
  a_preparer: 'Candidature à préparer',
  en_attente: 'En attente de validation',
  validee: 'Validée',
  envoyee: 'Envoyée',
  erreur: "Erreur d'envoi",
  reponse: 'Réponse reçue',
  entretien: 'Entretien obtenu',
  refus: 'Refus',
  relance: 'Relance à effectuer',
  ne_plus_contacter: 'Ne plus contacter',
};

export const MESSAGE_STATUSES = {
  a_valider: 'En attente de validation',
  brouillon: 'Brouillon',
  validee: "Validée (file d'envoi)",
  envoi_en_cours: 'Envoi en cours',
  envoyee: 'Envoyée',
  erreur: "Erreur d'envoi",
  ignoree: 'Ignorée',
};

export const OUTCOMES = {
  aucune: 'Pas de réponse',
  reponse_a_qualifier: 'Réponse reçue (à qualifier)',
  reponse_positive: 'Réponse positive',
  reponse_neutre: 'Réponse neutre',
  reponse_negative: 'Réponse négative',
  entretien: 'Entretien obtenu',
  refus: 'Refus',
  ne_plus_contacter: 'Demande à ne plus être contacté',
  adresse_invalide: 'Adresse invalide (rejet)',
};
