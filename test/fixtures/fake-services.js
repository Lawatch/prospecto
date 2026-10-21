// Faux services externes (géocodage, Overpass, SIRENE, site d'hôtel) reproduisant le format
// des API réelles, pour tester toute la chaîne sans dépendre du réseau.
import http from 'node:http';

export const ORIGIN = { lat: 45.8992, lon: 6.1294 };

const overpass = (base) => ({
  elements: [
    { type: 'node', id: 1001, lat: 45.9001, lon: 6.1302, tags: { tourism: 'hotel', name: 'Hôtel du Lac', 'addr:housenumber': '3', 'addr:street': 'Quai Napoléon III', 'addr:postcode': '74000', 'addr:city': 'Annecy', website: `${base}/site-lac/`, phone: '+33 4 50 00 00 01', stars: '4', rooms: '85' } },
    { type: 'way', id: 2002, center: { lat: 45.905, lon: 6.12 }, tags: { tourism: 'hotel', name: "Appart'City Annecy", brand: "Appart'City", operator: 'Appart City SAS', 'addr:postcode': '74000', 'addr:city': 'Annecy' } },
    { type: 'node', id: 1003, lat: 45.93, lon: 6.1, tags: { tourism: 'hotel', name: 'Hôtel Beau Site', 'addr:postcode': '74940', 'addr:city': 'Annecy-le-Vieux' } },
    { type: 'node', id: 1004, lat: 45.9, lon: 6.13, tags: { tourism: 'guest_house' } },
  ],
});

const lacCompany = {
  siren: '812345678', nom_complet: 'SAS HOTEL DU LAC', nom_raison_sociale: 'SAS HOTEL DU LAC', activite_principale: '55.10Z', tranche_effectif_salarie: '12',
  nombre_etablissements: 3, nombre_etablissements_ouverts: 3, categorie_entreprise: 'PME', etat_administratif: 'A',
  dirigeants: [
    { nom: 'DUPONT', prenoms: 'JEAN PIERRE', qualite: 'Président de SAS', type_dirigeant: 'personne physique' },
    { denomination: 'GROUPE ALPES HOTELS', siren: '900000001', qualite: 'Directeur général', type_dirigeant: 'personne morale' },
  ],
  matching_etablissements: [{ siret: '81234567800015', adresse: '3 QUAI NAPOLEON III 74000 ANNECY', code_postal: '74000', libelle_commune: 'ANNECY', latitude: '45.90012', longitude: '6.13015', activite_principale: '55.10Z', liste_enseignes: ['HOTEL DU LAC'], etat_administratif: 'A', tranche_effectif_salarie: '12' }],
};
const cimesCompany = {
  siren: '823456789', nom_complet: 'RESIDENCE LES CIMES', activite_principale: '55.20Z', tranche_effectif_salarie: '03', nombre_etablissements_ouverts: 1, etat_administratif: 'A',
  dirigeants: [{ nom: 'BERNARD', prenoms: 'SOPHIE', qualite: 'Gérant', type_dirigeant: 'personne physique' }],
  matching_etablissements: [{ siret: '82345678900011', adresse: '12 RUE DES ALPES 74000 ANNECY', code_postal: '74000', libelle_commune: 'ANNECY', latitude: '45.895', longitude: '6.125', activite_principale: '55.20Z', liste_enseignes: null, etat_administratif: 'A' }],
};
const closedCompany = { ...cimesCompany, siren: '899999999', nom_complet: 'HOTEL FERME', etat_administratif: 'C', matching_etablissements: [{ ...cimesCompany.matching_etablissements[0], siret: '89999999900010', etat_administratif: 'F' }] };

const page = (title, body) => `<!doctype html><html><head><title>${title}</title><style>.x{}</style><script>var a='noreply@tracker.com';</script></head><body>${body}</body></html>`;

export function startFakeServices() {
  const calls = [];
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    calls.push(url.pathname);
    const base = `http://127.0.0.1:${server.address().port}`;
    const json = (o) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(o)); };
    const html = (h) => { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(h); };
    if (url.pathname === '/geocode') {
      if (/introuvable/i.test(url.searchParams.get('q'))) return json({ features: [] });
      return json({ features: [{ geometry: { coordinates: [ORIGIN.lon, ORIGIN.lat] }, properties: { label: 'Annecy', city: 'Annecy', postcode: '74000', score: 0.95 } }] });
    }
    if (url.pathname === '/overpass') {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => { calls.push('overpass-query:' + decodeURIComponent(body.slice(5))); json(overpass(base)); });
      return;
    }
    if (url.pathname === '/sirene/near_point') return json({ results: [lacCompany, cimesCompany, closedCompany], total_pages: 1 });
    if (url.pathname === '/sirene/search') {
      const q = (url.searchParams.get('q') || '').toLowerCase();
      if (q.includes('lac') || q.includes('81234567800015')) return json({ results: [lacCompany], total_pages: 1 });
      return json({ results: [], total_pages: 1 });
    }
    if (url.pathname === '/robots.txt') { res.setHeader('Content-Type', 'text/plain'); return res.end('User-agent: *\nDisallow: /site-lac/prive\n'); }
    if (url.pathname === '/site-lac/') {
      return html(page('Hôtel du Lac', `<nav><a href="/site-lac/contact">Contact</a> <a href="/site-lac/mentions-legales">Mentions légales</a> <a href="/site-lac/recrutement">Nous rejoindre</a> <a href="/site-lac/prive">Espace privé</a> <a href="https://booking.com/x">Réserver</a></nav>
        <h1>Hôtel du Lac ★★★★</h1><p>Nos 85 chambres face au lac ont été entièrement rénovées en 2025.</p><p>Salles de séminaires pour 120 personnes.</p>
        <footer>reservation@hoteldulac-annecy.fr · <img src="logo@2x.png"></footer>`));
    }
    if (url.pathname === '/site-lac/contact') {
      return html(page('Contact', `<p>Écrivez-nous : <a href="mailto:contact@hoteldulac-annecy.fr">contact@hoteldulac-annecy.fr</a></p><p>Direction : direction [at] hoteldulac-annecy [dot] fr</p>
        <form><input type="email" name="e"><textarea></textarea></form>`));
    }
    if (url.pathname === '/site-lac/mentions-legales') {
      return html(page('Mentions légales', '<p>SAS HOTEL DU LAC – SIRET 812 345 678 00015 – RCS Annecy.</p><p>Directeur de la publication : Marie Martin</p><p>Hébergeur : OVH</p>'));
    }
    if (url.pathname === '/site-lac/recrutement') {
      return html(page('Recrutement', '<p>Nous recrutons un responsable de réception pour la saison 2026.</p><p>Candidatures : rh@hoteldulac-annecy.fr</p>'));
    }
    if (url.pathname === '/site-lac/prive') { res.statusCode = 500; return res.end('ne devrait pas être visité'); }
    res.statusCode = 404;
    res.end('not found');
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => {
    const base = `http://127.0.0.1:${server.address().port}`;
    resolve({ server, base, calls, close: () => new Promise((r) => server.close(r)) });
  }));
}
