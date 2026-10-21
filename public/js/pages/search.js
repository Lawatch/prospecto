import { api, meta, isLocal } from '../api.js';
import { esc, link, on, scoreBadge, toast, toastError, withBusy, fmtDate, formData } from '../ui.js';

const DEFAULT_TYPES = ['hotel', 'apart_hotel', 'residence_tourisme'];
const SEARCH_TYPES = ['hotel', 'apart_hotel', 'residence_tourisme', 'chambres_hotes', 'auberge', 'motel', 'village_vacances', 'camping', 'restaurant'];

export default async function search(el, { query }) {
  const [m, settingsRes, history] = await Promise.all([meta(), api.get('/api/settings'), api.get('/api/searches')]);
  const hasGoogle = settingsRes.secrets.google_places_key;
  const defRadius = settingsRes.settings.search.default_radius_km || 20;
  let results = [];
  let selected = new Set();
  let map = null;

  el.innerHTML = `
    <div class="page-head"><div><h1>Recherche d'établissements</h1><div class="sub">Sources : OpenStreetMap, répertoire SIRENE de l'INSEE${hasGoogle ? ', Google Places' : ''}. Chaque résultat garde sa source et sa date de collecte.</div></div></div>
    <form class="card" id="search-form">
      <div class="grid cols-3">
        <div class="field"><label>Ville ou adresse de départ</label><input type="text" name="location" required placeholder="ex. Annecy, Lyon 2e, 12 rue de la Paix Paris" value="${esc(query.location || '')}"></div>
        <div class="field"><label>Rayon (km)</label><input type="number" name="radiusKm" min="1" max="100" value="${esc(query.radius || defRadius)}"><div class="help">50 km au maximum pour SIRENE</div></div>
        <div class="field"><label>Enseignes</label><select name="chainFilter"><option value="tous">Toutes</option><option value="independants">Indépendants uniquement (sans enseigne connue)</option><option value="chaines">Chaînes / enseignes uniquement</option></select></div>
      </div>
      <div class="field"><label>Types d'établissement</label><div class="checks">
        ${SEARCH_TYPES.map((t) => `<label><input type="checkbox" name="types" data-multi value="${t}" ${DEFAULT_TYPES.includes(t) ? 'checked' : ''}> ${esc(m.types[t])}</label>`).join('')}
      </div></div>
      <div class="grid cols-2">
        <div class="field"><label>Mots-clés dans le nom <span class="muted">(facultatif)</span></label><input type="text" name="nameKeywords" placeholder="ex. spa, resort, suites — séparés par des virgules"><div class="help">Filtre les résultats dont le nom contient l'un de ces mots.</div></div>
        <div class="field"><label>Mots-clés de recherche Google <span class="muted">(facultatif)</span></label><input type="text" name="keywords" placeholder="ex. hôtel séminaire, groupe hôtelier" ${hasGoogle ? '' : 'disabled'}><div class="help">${hasGoogle ? 'Requêtes textuelles supplémentaires envoyées à Google Places.' : 'Disponible avec une clé Google Places (Paramètres).'}</div></div>
      </div>
      <details style="margin-bottom:12px"><summary class="small" style="cursor:pointer">Autres secteurs et options avancées</summary>
        <div class="grid cols-2" style="margin-top:10px">
          <div class="field"><label>Codes NAF supplémentaires (SIRENE)</label><input type="text" name="nafCodes" placeholder="ex. 93.29Z, 68.20B"><div class="help">Pour cibler d'autres secteurs d'activité.</div></div>
          <div class="field"><label>Étiquettes OpenStreetMap supplémentaires</label><input type="text" name="customTags" placeholder="ex. leisure=sports_centre, amenity=cinema"></div>
        </div>
      </details>
      <div class="row between">
        <div class="checks"><span class="muted small">Sources :</span>
          <label><input type="checkbox" name="sources" data-multi value="osm" checked> OpenStreetMap</label>
          <label><input type="checkbox" name="sources" data-multi value="sirene" checked> SIRENE (entreprises)</label>
          <label><input type="checkbox" name="sources" data-multi value="google" ${hasGoogle ? 'checked' : 'disabled'}> Google Places ${hasGoogle ? '' : '(non configuré)'}</label>
        </div>
        <button class="primary lg" id="go" data-busy="Recherche en cours…">Rechercher</button>
      </div>
    </form>
    <div id="results"></div>
    ${history.length ? `<div class="card"><h2>Recherches récentes</h2><table><thead><tr><th>Date</th><th>Lieu</th><th>Rayon</th><th>Types</th><th>Résultats</th><th></th></tr></thead><tbody>
      ${history.slice(0, 10).map((h) => `<tr><td class="nowrap">${fmtDate(h.created_at, true)}</td><td>${esc(h.params.location)}</td><td>${h.params.radiusKm} km</td><td class="small">${esc((h.params.types || []).map((t) => m.types[t] || t).join(', '))}</td><td>${h.result_count} <span class="muted small">(${h.new_count} nouveaux)</span></td><td><button class="sm" data-load="${h.id}">Revoir</button></td></tr>`).join('')}
    </tbody></table></div>` : ''}`;

  const resultsEl = el.querySelector('#results');

  function renderResults(meta2) {
    if (map) { map.remove(); map = null; }
    if (!results.length) {
      resultsEl.innerHTML = `<div class="card empty"><h3>Aucun établissement trouvé</h3><p>Élargissez le rayon ou ajoutez des types d'établissement.</p>${meta2?.errors?.length ? meta2.errors.map((e) => `<div class="alert attention">${esc(e.source)} : ${esc(e.message)}</div>`).join('') : ''}</div>`;
      return;
    }
    const notInList = results.filter((r) => !r.in_list).length;
    resultsEl.innerHTML = `
      ${meta2?.errors?.length ? meta2.errors.map((e) => `<div class="alert attention"><b>${esc(e.source)}</b> : ${esc(e.message)}</div>`).join('') : ''}
      <div class="card">
        <div class="card-head"><h2>${results.length} établissement(s)${meta2?.created != null ? ` · <span class="muted">${meta2.created} nouveau(x), les autres étaient déjà connus (doublons fusionnés)</span>` : ''}</h2>
          <div class="actions"><button class="sm" id="sel-all">Tout sélectionner (${notInList} hors liste)</button><button class="sm" id="sel-none">Aucun</button></div></div>
        ${window.L ? '<div id="map"></div>' : ''}
        <div class="table-wrap"><table><thead><tr><th class="check"></th><th>Score</th><th>Établissement</th><th>Type</th><th>Distance</th><th>Site / téléphone</th><th>Taille</th><th>Sources</th><th></th></tr></thead><tbody>
        ${results.map((r) => `<tr data-id="${r.id}" class="${selected.has(r.id) ? 'selected' : ''}">
          <td class="check"><input type="checkbox" data-sel="${r.id}" ${selected.has(r.id) ? 'checked' : ''}></td>
          <td>${scoreBadge(r.score)}</td>
          <td class="name-cell"><a href="#/prospects/${r.id}">${esc(r.name)}</a>${r.is_new ? ' <span class="badge primary">nouveau</span>' : ''}${r.in_list ? ' <span class="badge success">dans la liste</span>' : ''}
            <div class="sub">${esc([r.address, r.postcode, r.city].filter(Boolean).join(' '))}</div>${r.group_name ? `<div class="sub">Groupe / enseigne : ${esc(r.group_name)}</div>` : ''}</td>
          <td class="small">${esc(m.types[r.type] || '—')}${r.stars ? `<div class="muted">${'★'.repeat(r.stars)}</div>` : ''}</td>
          <td class="nowrap">${r.search_distance_km ?? r.distance_km ?? '—'} km</td>
          <td class="small">${r.website ? link(r.website) : '<span class="muted">pas de site</span>'}<div>${esc(r.phone || '')}</div></td>
          <td class="small">${[r.rooms ? `${r.rooms} ch.` : '', r.headcount_range && m.headcount[r.headcount_range] ? m.headcount[r.headcount_range] : '', r.sites_count > 1 ? `${r.sites_count} sites` : ''].filter(Boolean).map(esc).join('<br>') || '<span class="muted">—</span>'}</td>
          <td class="small">${r.sources.map((s) => esc(s.source.split(' ')[0])).join(', ')}</td>
          <td>${r.in_list ? '' : `<button class="sm" data-add="${r.id}">Ajouter</button>`}</td></tr>`).join('')}
        </tbody></table></div>
      </div>
      <div class="bulkbar" id="bulk" ${selected.size ? '' : 'hidden'}><b id="bulk-count"></b><button class="primary" id="bulk-add">Ajouter à la liste de prospection</button><button id="bulk-add-enrich">${isLocal ? 'Ajouter et enrichir (SIRENE)' : 'Ajouter et enrichir (contacts, SIRENE)'}</button></div>
      <p class="muted small">Données cartographiques © contributeurs OpenStreetMap (ODbL) · Données entreprises : INSEE / INPI via recherche-entreprises.api.gouv.fr</p>`;
    updateBulk();
    if (window.L) {
      const pts = results.filter((r) => r.lat != null);
      map = window.L.map('map');
      window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18, attribution: '© contributeurs OpenStreetMap' }).addTo(map);
      const markers = pts.map((r) => window.L.circleMarker([r.lat, r.lon], { radius: 7, color: r.in_list ? '#0a7a4b' : '#2d5bd7', weight: 2, fillOpacity: 0.6 }).bindPopup(`<b>${esc(r.name)}</b><br>${esc(m.types[r.type] || '')}<br><a href="#/prospects/${r.id}">Ouvrir la fiche</a>`).addTo(map));
      if (meta2?.origin) window.L.marker([meta2.origin.lat, meta2.origin.lon]).bindPopup(esc(meta2.origin.label)).addTo(map);
      if (markers.length) map.fitBounds(window.L.featureGroup(markers).getBounds().pad(0.1));
      else if (meta2?.origin) map.setView([meta2.origin.lat, meta2.origin.lon], 12);
    }
  }

  function updateBulk() {
    const bar = resultsEl.querySelector('#bulk');
    if (!bar) return;
    bar.hidden = !selected.size;
    bar.querySelector('#bulk-count').textContent = `${selected.size} sélectionné(s)`;
  }

  async function addToList(ids, enrich = false) {
    await api.post('/api/establishments/bulk', { ids, action: 'add_to_list' });
    for (const r of results) if (ids.includes(r.id)) r.in_list = true;
    if (enrich) {
      const { job_id } = await api.post('/api/establishments/bulk', { ids, action: 'enrich' });
      toast(`${ids.length} établissement(s) ajouté(s). Enrichissement lancé en arrière-plan.`, 'success');
      location.hash = `#/prospects?job=${job_id}`;
      return;
    }
    toast(`${ids.length} établissement(s) ajouté(s) à la liste`, 'success');
    selected = new Set();
    renderResults(lastMeta);
  }

  let lastMeta = null;
  el.querySelector('#search-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = formData(e.target);
    if (!data.types.length && !data.nafCodes && !data.customTags && !data.keywords) return toastError(new Error('Choisissez au moins un type d\'établissement.'));
    await withBusy(el.querySelector('#go'), async () => {
      try {
        const res = await api.post('/api/search', data);
        results = res.results;
        selected = new Set();
        lastMeta = res;
        renderResults(res);
        resultsEl.scrollIntoView({ behavior: 'smooth' });
      } catch (err) { toastError(err); }
    });
  });

  on(el, 'click', '[data-load]', async (e, b) => {
    const r = await api.get(`/api/searches/${b.dataset.load}/results`);
    results = r.results;
    selected = new Set();
    lastMeta = { origin: r.search.params.origin, errors: r.search.errors };
    renderResults(lastMeta);
    resultsEl.scrollIntoView({ behavior: 'smooth' });
  });
  on(resultsEl, 'change', '[data-sel]', (e, cb) => {
    const id = Number(cb.dataset.sel);
    if (cb.checked) selected.add(id); else selected.delete(id);
    cb.closest('tr').classList.toggle('selected', cb.checked);
    updateBulk();
  });
  on(resultsEl, 'click', '#sel-all', () => { selected = new Set(results.filter((r) => !r.in_list).map((r) => r.id)); renderResults(lastMeta); });
  on(resultsEl, 'click', '#sel-none', () => { selected = new Set(); renderResults(lastMeta); });
  on(resultsEl, 'click', '[data-add]', (e, b) => addToList([Number(b.dataset.add)]).catch(toastError));
  on(resultsEl, 'click', '#bulk-add', () => addToList([...selected]).catch(toastError));
  on(resultsEl, 'click', '#bulk-add-enrich', () => addToList([...selected], true).catch(toastError));

  if (query.search) el.querySelector(`[data-load="${query.search}"]`)?.click();
  return () => { if (map) map.remove(); };
}
