import { HEADCOUNT_RANGES, TYPE_LABELS } from './catalog.js';
import { stripAccents } from '../util.js';

// Score explicable sur 100 : chaque critère apporte des points et une justification lisible.
// Un signal (recrutement, ouverture…) est une opportunité possible, jamais la preuve qu'un poste est vacant.
export function scoreEstablishment(est, contacts, settings) {
  const w = settings.weights;
  const targetTypes = settings.target_types || [];
  const reasons = [];
  const add = (criterion, points, max, text) => reasons.push({ criterion, points: Math.round(points), max, text });

  // 1. Adéquation avec l'objectif (type d'établissement)
  const isGroup = !!est.group_name || (est.sites_count || 0) > 1;
  if (targetTypes.includes(est.type)) add('fit', w.fit, w.fit, `${TYPE_LABELS[est.type] || est.type} : type ciblé`);
  else if (isGroup && targetTypes.includes('groupe_hotelier')) add('fit', w.fit * 0.8, w.fit, 'Rattaché à un groupe (type ciblé : groupe hôtelier)');
  else if (['hotel', 'apart_hotel', 'residence_tourisme', 'village_vacances'].includes(est.type)) add('fit', w.fit * 0.5, w.fit, `${TYPE_LABELS[est.type]} : hébergement proche des types ciblés`);
  else add('fit', 0, w.fit, `${TYPE_LABELS[est.type] || 'Type inconnu'} : hors des types ciblés`);

  // 2. Taille et complexité opérationnelle
  const headcount = HEADCOUNT_RANGES[est.headcount_range]?.mid;
  let size = 0;
  const sizeNotes = [];
  if (est.rooms) { size = Math.max(size, est.rooms >= 120 ? 1 : est.rooms >= 60 ? 0.75 : est.rooms >= 30 ? 0.5 : 0.25); sizeNotes.push(`${est.rooms} chambres`); }
  if (headcount != null) { size = Math.max(size, headcount >= 50 ? 1 : headcount >= 20 ? 0.8 : headcount >= 10 ? 0.55 : headcount >= 3 ? 0.25 : 0.1); sizeNotes.push(HEADCOUNT_RANGES[est.headcount_range].label); }
  if (est.stars) { size = Math.max(size, est.stars >= 4 ? 0.7 : est.stars === 3 ? 0.45 : 0.2); sizeNotes.push(`${est.stars} étoiles`); }
  if ((est.sites_count || 0) > 1) { size = Math.min(1, size + 0.2); sizeNotes.push(`${est.sites_count} établissements`); }
  add('size', w.size * size, w.size, sizeNotes.length ? `Taille : ${sizeNotes.join(', ')}` : 'Taille inconnue (à compléter)');

  // 3. Poste potentiellement accessible (encadrement intermédiaire plausible)
  let position = 0.3;
  let positionText = 'Structure de taille inconnue : existence d\'un poste d\'encadrement incertaine';
  if ((headcount != null && headcount >= 20) || (est.rooms || 0) >= 60 || (est.sites_count || 0) >= 3) { position = 1; positionText = 'Structure assez grande pour un poste d\'adjoint / responsable d\'exploitation'; }
  else if ((headcount != null && headcount >= 6) || (est.rooms || 0) >= 30 || est.stars >= 4) { position = 0.6; positionText = 'Structure moyenne : poste d\'encadrement possible'; }
  else if (headcount != null && headcount < 3) { position = 0.1; positionText = 'Très petite structure : souvent gérée par l\'exploitant'; }
  add('position', w.position * position, w.position, positionText);

  // 4. Signaux publics d'opportunité
  const signals = est.signals || [];
  const strong = signals.filter((s) => ['recrutement', 'ouverture', 'renovation'].includes(s.kind));
  const sig = Math.min(1, strong.length * 0.6 + (signals.some((s) => s.kind === 'groupe') ? 0.2 : 0));
  add('signals', w.signals * sig, w.signals, strong.length
    ? `Signal à vérifier : ${strong.map((s) => s.label.toLowerCase()).join(', ')} (ne prouve pas un poste vacant)`
    : 'Aucun signal public d\'expansion ou de recrutement détecté');

  // 5. Qualité des coordonnées
  const usable = (contacts || []).filter((c) => c.email && c.email_status !== 'invalide');
  const best = usable.reduce((m, c) => Math.max(m, c.reliability || 0), 0);
  const nominative = usable.some((c) => c.email_kind === 'nominative' || c.email_kind === 'direction' || c.email_kind === 'rh');
  let contactPts = 0;
  let contactText = 'Aucune adresse e-mail exploitable';
  if (usable.length) {
    contactPts = nominative ? (best >= 80 ? 1 : 0.8) : best >= 70 ? 0.55 : 0.4;
    contactText = nominative ? `Contact ciblé disponible (fiabilité ${best}/100)` : `Adresse générique uniquement (fiabilité ${best}/100)`;
  } else if (est.contact_form_url) { contactPts = 0.15; contactText = 'Formulaire de contact uniquement'; }
  add('contact', w.contact * contactPts, w.contact, contactText);

  // 6. Distance
  const pref = settings.preferred_radius_km || 25;
  if (est.distance_km == null) add('distance', w.distance * 0.5, w.distance, 'Distance inconnue');
  else {
    const d = est.distance_km;
    const pts = d <= pref ? 1 : d >= pref * 3 ? 0 : 1 - (d - pref) / (pref * 2);
    add('distance', w.distance * pts, w.distance, `À ${d} km (rayon préféré : ${pref} km)`);
  }

  // 7. Compatibilité avec les mots-clés du profil
  const keywords = String(settings.profile_keywords || '').split(',').map((k) => stripAccents(k.trim().toLowerCase())).filter(Boolean);
  const haystack = stripAccents([est.name, est.group_name, est.brand, est.stars ? `${est.stars} etoiles` : '', ...signals.map((s) => s.snippet)].join(' ').toLowerCase());
  const matched = keywords.filter((k) => haystack.includes(k));
  add('profile', w.profile * Math.min(1, matched.length / 2), w.profile, matched.length ? `Mots-clés du profil retrouvés : ${matched.join(', ')}` : 'Aucun mot-clé du profil retrouvé');

  const total = reasons.reduce((s, r) => s + r.points, 0);
  const maxTotal = reasons.reduce((s, r) => s + r.max, 0) || 1;
  return { score: Math.round((total / maxTotal) * 100), reasons };
}
