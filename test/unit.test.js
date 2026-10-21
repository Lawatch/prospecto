import { test } from 'node:test';
import assert from 'node:assert/strict';
import { render, buildVariables, findUnresolved, DEFAULT_TEMPLATES } from '../server/services/templates.js';
import { nameKey, nameSimilarity, classifyEmail, parseCsv, toCsv, domainOf, haversineKm, normalizeUrl } from '../server/util.js';
import { parseRobots, isAllowedByRobots, extractEmails, extractPeople, extractSignals, extractSirets, htmlToText } from '../server/services/website.js';
import { buildOverpassQuery, mapOsmElement } from '../server/services/osm.js';
import { mapSireneResult, dirigeantsToContacts } from '../server/services/sirene.js';
import { scoreEstablishment } from '../server/services/scoring.js';
import { roleCategory, typeFromOsm } from '../server/services/catalog.js';

test('rendu des templates : variables, sections, variables vides et inconnues', () => {
  const vars = { entreprise: 'Hôtel du Lac', accroche: '', ville: 'Annecy', salutation: 'Madame, Monsieur,' };
  const r = render('{{salutation}}\n\n{{#accroche}}{{accroche}}\n\n{{/accroche}}{{^accroche}}Candidature pour {{entreprise}}.{{/accroche}} {{ville}} {{inconnue}}', vars);
  assert.match(r.text, /^Madame, Monsieur,\n\nCandidature pour Hôtel du Lac\. Annecy \{\{inconnue\}\}$/);
  assert.deepEqual(r.unknown, ['inconnue']);
  assert.equal(r.used.entreprise, 'Hôtel du Lac');
  const r2 = render('Ville : {{ville}} / {{accroche}}', vars);
  assert.deepEqual(r2.missing, ['accroche']);
  assert.deepEqual(findUnresolved(r.text), ['{{inconnue}}']);
});

test('les modèles par défaut ne contiennent que des variables connues', () => {
  const vars = buildVariables({ establishment: { name: 'X', type: 'hotel' }, profile: {}, extra: { date_message_initial: '1/1/2026', objet_initial: 'Objet' } });
  for (const t of DEFAULT_TEMPLATES) {
    assert.deepEqual(render(t.subject, vars).unknown, [], t.name);
    assert.deepEqual(render(t.body, vars).unknown, [], t.name);
  }
});

test('formule d\'appel : jamais de civilité devinée', () => {
  assert.equal(buildVariables({ contact: { first_name: 'Camille', last_name: 'Durand' } }).salutation, 'Bonjour Camille Durand,');
  assert.equal(buildVariables({ contact: { last_name: 'Durand', civility: 'Mme' } }).salutation, 'Madame Durand,');
  assert.equal(buildVariables({ contact: null }).salutation, 'Madame, Monsieur,');
});

test('normalisation des noms et similarité', () => {
  assert.equal(nameKey("Hôtel L'Impérial Palace"), 'imperial palace');
  assert.ok(nameSimilarity('HOTEL DU LAC', 'Hôtel du Lac') === 1);
  assert.ok(nameSimilarity('Hôtel du Lac', 'Résidence Les Cimes') < 0.5);
});

test('classification des adresses e-mail', () => {
  assert.equal(classifyEmail('contact@hotel.fr'), 'generique');
  assert.equal(classifyEmail('reservation@hotel.fr'), 'generique');
  assert.equal(classifyEmail('rh@hotel.fr'), 'rh');
  assert.equal(classifyEmail('recrutement@hotel.fr'), 'rh');
  assert.equal(classifyEmail('direction@hotel.fr'), 'direction');
  assert.equal(classifyEmail('jean.dupont@hotel.fr'), 'nominative');
  assert.equal(classifyEmail('noreply@hotel.fr'), 'technique');
});

test('CSV : lecture avec ; et guillemets, écriture', () => {
  const rows = parseCsv('﻿Nom;Ville;Site web\n"Hôtel ""Le Lac""";Annecy;hoteldulac.fr\n\nAutre;Lyon;\n');
  assert.equal(rows.length, 2);
  assert.equal(rows[0].nom, 'Hôtel "Le Lac"');
  assert.equal(rows[0].site_web, 'hoteldulac.fr');
  const csv = toCsv([{ a: 'x;y' }], [{ label: 'A', key: 'a' }]);
  assert.ok(csv.includes('"x;y"'));
});

test('URL, domaine, distance', () => {
  assert.equal(normalizeUrl('www.hotel.fr'), 'https://www.hotel.fr/');
  assert.equal(normalizeUrl('javascript:alert(1)'), null);
  assert.equal(domainOf('https://www.hotel.fr/contact'), 'hotel.fr');
  assert.equal(domainOf('a@hotel.fr'), 'hotel.fr');
  assert.ok(Math.abs(haversineKm(45.8992, 6.1294, 45.7640, 4.8357) - 101) < 3);
});

test('robots.txt', () => {
  const rules = parseRobots('User-agent: Googlebot\nDisallow: /\n\nUser-agent: *\nDisallow: /prive\nAllow: /prive/public\n');
  assert.equal(isAllowedByRobots(rules, '/contact'), true);
  assert.equal(isAllowedByRobots(rules, '/prive/x'), false);
  assert.equal(isAllowedByRobots(rules, '/prive/public/y'), true);
});

test('extraction depuis un site : e-mails, personnes, signaux, SIRET', () => {
  const html = '<p>Contact : <a href="mailto:Contact@Hotel.fr">nous écrire</a> — rh [at] hotel [dot] fr</p><img src="a@2x.png"><p>Directeur de la publication : Jean-Marc Dupont</p><p>Nous recrutons un réceptionniste de nuit pour notre hôtel.</p><p>SIRET : 812 345 678 00015</p>';
  const text = htmlToText(html);
  assert.deepEqual(extractEmails(html, text).sort(), ['contact@hotel.fr', 'rh@hotel.fr']);
  const people = extractPeople(text);
  assert.equal(people[0].last_name, 'Dupont');
  assert.equal(people[0].first_name, 'Jean-Marc');
  assert.ok(extractSignals(text, 'u').some((s) => s.kind === 'recrutement'));
  assert.deepEqual(extractSirets(text), ['81234567800015']);
});

test('requête Overpass et correspondance OSM', () => {
  const q = buildOverpassQuery({ lat: 45.9, lon: 6.1, radiusKm: 10, types: ['hotel', 'apart_hotel'], chainFilter: 'independants', nameKeywords: ['spa'] });
  assert.match(q, /nwr\["tourism"="hotel"\]\["name"\]\["name"~"spa",i\]\[!"brand"\]\(around:10000,45.9,6.1\)/);
  assert.match(q, /tourism"="apartment"/);
  const e = mapOsmElement({ type: 'node', id: 5, lat: 45.9, lon: 6.1, tags: { tourism: 'hotel', name: 'Adagio Annecy', website: 'adagio.fr', stars: '3', brand: 'Adagio' } }, { lat: 45.9, lon: 6.1 });
  assert.equal(e.type, 'apart_hotel');
  assert.equal(e.website, 'https://adagio.fr/');
  assert.equal(e.group_name, 'Adagio');
  assert.equal(typeFromOsm({ tourism: 'guest_house' }), 'chambres_hotes');
});

test('correspondance SIRENE : dirigeants et holding', () => {
  const company = { siren: '1', nom_complet: 'SAS X', activite_principale: '55.10Z', tranche_effectif_salarie: '12', nombre_etablissements_ouverts: 2,
    dirigeants: [{ nom: 'MARTIN', prenoms: 'ANNE MARIE', qualite: 'Président', type_dirigeant: 'personne physique' }, { denomination: 'HOLDING Y', type_dirigeant: 'personne morale', qualite: 'DG' }] };
  const r = mapSireneResult(company, { siret: '11', liste_enseignes: ['HOTEL X'], latitude: '45', longitude: '6', code_postal: '74000' }, null);
  assert.equal(r.name, 'HOTEL X');
  assert.equal(r.group_name, 'HOLDING Y');
  const contacts = dirigeantsToContacts(r.dirigeants, 'u');
  assert.equal(contacts.length, 1);
  assert.equal(contacts[0].first_name, 'Anne');
  assert.equal(contacts[0].last_name, 'Martin');
  assert.equal(contacts[0].email, null);
});

test('catégorie de fonction', () => {
  assert.equal(roleCategory('Responsable des ressources humaines'), 'rh');
  assert.equal(roleCategory('Directeur des opérations'), 'direction_operations');
  assert.equal(roleCategory('Gérant'), 'proprietaire');
  assert.equal(roleCategory('Président de SAS'), 'direction_generale');
  assert.equal(roleCategory("Directrice d'hôtel"), 'direction_etablissement');
});

test('scoring explicable', () => {
  const settings = { target_types: ['hotel'], preferred_radius_km: 25, weights: { fit: 25, size: 20, position: 10, signals: 15, contact: 15, distance: 10, profile: 5 }, profile_keywords: 'séminaires' };
  const big = scoreEstablishment({ type: 'hotel', rooms: 120, stars: 4, headcount_range: '21', distance_km: 5, signals: [{ kind: 'recrutement', label: 'Recrutement en cours', snippet: 'salles de séminaires' }] },
    [{ email: 'rh@x.fr', email_kind: 'rh', reliability: 85, email_status: 'publiee' }], settings);
  const small = scoreEstablishment({ type: 'restaurant', headcount_range: '01', distance_km: 80, signals: [] }, [], settings);
  assert.ok(big.score >= 85, `score élevé attendu, obtenu ${big.score}`);
  assert.ok(small.score < 25, `score faible attendu, obtenu ${small.score}`);
  assert.equal(big.reasons.length, 7);
  assert.ok(big.reasons.find((r) => r.criterion === 'signals').text.includes('ne prouve pas'));
});
