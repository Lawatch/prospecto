import { api, meta } from '../api.js';
import { badge, confirmDialog, esc, link, modal, on, options, reliability, scoreBadge, toast, toastError, withBusy, formData } from '../ui.js';

export function jobWatcher(container, jobId, onDone) {
  let timer;
  const tick = async () => {
    try {
      const j = await api.get(`/api/jobs/${jobId}`);
      const pctDone = j.total ? Math.round((j.done / j.total) * 100) : 100;
      container.innerHTML = `<div class="card"><div class="row between"><b>${esc(j.label)}</b><span class="small muted">${j.done}/${j.total}${j.errors.length ? ` · ${j.errors.length} erreur(s)` : ''}</span></div>
        <div class="progress" style="margin:8px 0"><div style="width:${pctDone}%"></div></div>
        ${j.status === 'en_cours' ? '<button class="sm" data-cancel>Arrêter</button>' : `<div class="small">${j.results.slice(-8).map((r) => `<div><b>${esc(r.name || '')}</b> — ${Object.values(r.steps || {}).map((s) => esc(s.message)).join(' · ')}</div>`).join('')}</div>`}</div>`;
      container.querySelector('[data-cancel]')?.addEventListener('click', () => api.post(`/api/jobs/${jobId}/cancel`));
      if (j.status === 'en_cours') timer = setTimeout(tick, 1500);
      else onDone?.(j);
    } catch { container.innerHTML = ''; }
  };
  tick();
  return () => clearTimeout(timer);
}

export default async function prospects(el, { query }) {
  const m = await meta();
  const state = { in_list: query.in_list ?? '1', status: query.status || '', type: '', min_score: '', has_email: '', q: '', sort: 'score', order: 'desc' };
  let rows = [];
  let total = 0;
  let selected = new Set();
  let stopJob = null;

  el.innerHTML = `
    <div class="page-head"><div><h1>Liste des prospects</h1><div class="sub" id="count"></div></div>
      <div class="actions"><button id="import">Importer un CSV</button><button id="add">+ Ajouter manuellement</button><a class="btn" id="export" href="#">Exporter (CSV)</a></div></div>
    <div id="job"></div>
    <div class="card flat" style="padding:12px">
      <form id="filters" class="row">
        <select name="in_list" style="width:auto">${options({ 1: 'Liste de prospection', 0: 'Hors liste (résultats de recherche)', '': 'Tous les établissements' }, state.in_list)}</select>
        <select name="status" style="width:auto">${options(m.statuses, state.status, { empty: 'Tous statuts' })}</select>
        <select name="type" style="width:auto">${options(m.types, '', { empty: 'Tous types' })}</select>
        <select name="has_email" style="width:auto">${options({ 1: 'Avec e-mail', 0: 'Sans e-mail' }, '', { empty: 'E-mail : tous' })}</select>
        <input type="number" name="min_score" placeholder="Score min." min="0" max="100" style="width:110px">
        <input type="search" name="q" placeholder="Filtrer par nom, ville, groupe…" style="width:240px">
      </form>
    </div>
    <div id="table"></div>
    <div class="bulkbar" id="bulk" hidden>
      <b id="bulk-count"></b>
      <button class="primary" data-bulk="campaign">Préparer une campagne</button>
      <button data-bulk="enrich">Enrichir (SIRENE, site, e-mails)</button>
      <select id="bulk-status" style="width:auto;background:#22293d;color:#fff;border-color:#3a425a">${options(m.statuses, '', { empty: 'Changer le statut…' })}</select>
      <button data-bulk="add_to_list">Ajouter à la liste</button>
      <button data-bulk="remove_from_list">Retirer de la liste</button>
      <button data-bulk="delete">Supprimer</button>
    </div>`;

  const tableEl = el.querySelector('#table');
  const qs = () => new URLSearchParams(Object.entries(state).filter(([, v]) => v !== '')).toString();

  async function load() {
    const res = await api.get(`/api/establishments?${qs()}&limit=1000`);
    rows = res.rows;
    total = res.total;
    selected = new Set([...selected].filter((id) => rows.some((r) => r.id === id)));
    el.querySelector('#count').textContent = `${total} établissement(s)${total > rows.length ? ` — ${rows.length} affichés` : ''}`;
    el.querySelector('#export').href = `/api/establishments/export.csv?${qs()}`;
    draw();
  }

  const th = (key, label) => `<th class="sortable" data-sort="${key}">${label}${state.sort === key ? (state.order === 'asc' ? ' ▲' : ' ▼') : ''}</th>`;
  function draw() {
    if (!rows.length) {
      tableEl.innerHTML = `<div class="card empty"><h3>Aucun prospect</h3><p>Lancez une <a href="#/recherche">recherche</a>, importez un fichier CSV ou ajoutez un établissement manuellement.</p></div>`;
      updateBulk();
      return;
    }
    tableEl.innerHTML = `<div class="table-wrap"><table><thead><tr><th class="check"><input type="checkbox" id="all" ${selected.size === rows.length ? 'checked' : ''}></th>
      ${th('score', 'Score')}${th('name', 'Établissement')}<th>Type</th>${th('city', 'Ville')}${th('distance', 'Dist.')}<th>Contact</th>${th('status', 'Statut')}<th>Prochaine action</th></tr></thead><tbody>
      ${rows.map((r) => `<tr class="${selected.has(r.id) ? 'selected' : ''}">
        <td class="check"><input type="checkbox" data-sel="${r.id}" ${selected.has(r.id) ? 'checked' : ''}></td>
        <td title="${esc((r.score_details || []).map((x) => `${x.text} (+${x.points})`).join('\n'))}">${scoreBadge(r.score)}</td>
        <td class="name-cell"><a href="#/prospects/${r.id}">${esc(r.name)}</a>${r.group_name ? `<div class="sub">${esc(r.group_name)}</div>` : ''}${r.website ? `<div class="sub">${link(r.website)}</div>` : ''}</td>
        <td class="small">${esc(m.types[r.type] || '—')}</td>
        <td class="small">${esc(r.city || '—')}</td>
        <td class="small nowrap">${r.distance_km != null ? `${r.distance_km} km` : '—'}</td>
        <td class="small">${r.email_count ? `${r.email_count} e-mail(s)<br>${reliability(r.best_reliability)}` : '<span class="muted">aucun e-mail</span>'}</td>
        <td>${badge(r.status, m.statuses)}${r.do_not_contact ? ' <span class="badge danger">opposition</span>' : ''}</td>
        <td class="small">${esc(r.next_action || '')}</td></tr>`).join('')}
      </tbody></table></div>`;
    updateBulk();
  }

  function updateBulk() {
    const bar = el.querySelector('#bulk');
    bar.hidden = !selected.size;
    bar.querySelector('#bulk-count').textContent = `${selected.size} sélectionné(s)`;
  }

  let t;
  el.querySelector('#filters').addEventListener('input', (e) => {
    clearTimeout(t);
    t = setTimeout(() => { Object.assign(state, formData(el.querySelector('#filters'))); load().catch(toastError); }, e.target.type === 'search' || e.target.type === 'number' ? 300 : 0);
  });
  on(tableEl, 'click', '[data-sort]', (e, h) => {
    const k = h.dataset.sort;
    state.order = state.sort === k && state.order === 'desc' ? 'asc' : 'desc';
    state.sort = k;
    load().catch(toastError);
  });
  on(tableEl, 'change', '[data-sel]', (e, cb) => {
    const id = Number(cb.dataset.sel);
    if (cb.checked) selected.add(id); else selected.delete(id);
    cb.closest('tr').classList.toggle('selected', cb.checked);
    updateBulk();
  });
  on(tableEl, 'change', '#all', (e, cb) => { selected = cb.checked ? new Set(rows.map((r) => r.id)) : new Set(); draw(); });

  on(el, 'click', '[data-bulk]', async (e, b) => {
    const ids = [...selected];
    const action = b.dataset.bulk;
    try {
      if (action === 'campaign') { sessionStorage.setItem('campaign_ids', JSON.stringify(ids)); location.hash = '#/campagnes?new=1'; return; }
      if (action === 'delete' && !(await confirmDialog('Supprimer', `Supprimer définitivement ${ids.length} établissement(s), leurs contacts et leur historique ?`, { okLabel: 'Supprimer', danger: true }))) return;
      const res = await api.post('/api/establishments/bulk', { ids, action });
      if (res.job_id) { startJob(res.job_id); toast('Enrichissement lancé en arrière-plan'); return; }
      toast(`${res.count} établissement(s) mis à jour`, 'success');
      if (action === 'delete') selected = new Set();
      load();
    } catch (err) { toastError(err); }
  });
  el.querySelector('#bulk-status').addEventListener('change', async (e) => {
    if (!e.target.value) return;
    await api.post('/api/establishments/bulk', { ids: [...selected], action: 'status', value: e.target.value }).catch(toastError);
    e.target.value = '';
    load();
  });

  function startJob(id) {
    stopJob?.();
    stopJob = jobWatcher(el.querySelector('#job'), id, () => load());
  }

  el.querySelector('#add').addEventListener('click', () => {
    modal({
      title: 'Ajouter un établissement',
      body: `<form id="add-form" class="form-grid">
        <div class="field full"><label>Nom *</label><input type="text" name="name" required></div>
        <div class="field"><label>Type</label><select name="type">${options(m.types, 'hotel')}</select></div>
        <div class="field"><label>Site web</label><input type="url" name="website" placeholder="https://"></div>
        <div class="field full"><label>Adresse</label><input type="text" name="address"></div>
        <div class="field"><label>Code postal</label><input type="text" name="postcode"></div>
        <div class="field"><label>Ville</label><input type="text" name="city"></div>
        <div class="field"><label>Téléphone</label><input type="text" name="phone"></div>
        <div class="field"><label>Groupe</label><input type="text" name="group_name"></div>
      </form>`,
      foot: '<button data-close>Annuler</button><button class="primary" id="save-add">Ajouter</button>',
      onMount: (mEl, close) => mEl.querySelector('#save-add').addEventListener('click', async () => {
        const f = mEl.querySelector('#add-form');
        if (!f.reportValidity()) return;
        try {
          const r = await api.post('/api/establishments', formData(f));
          close();
          toast(r.created ? 'Établissement ajouté' : 'Établissement déjà connu : fiche fusionnée', 'success');
          location.hash = `#/prospects/${r.id}`;
        } catch (err) { toastError(err); }
      }),
    });
  });

  el.querySelector('#import').addEventListener('click', () => {
    modal({
      title: 'Importer des prospects (CSV)',
      body: `<p class="small">Colonnes reconnues (séparateur ; ou ,) : <code>nom</code>, <code>type</code>, <code>adresse</code>, <code>code_postal</code>, <code>ville</code>, <code>site_web</code>, <code>telephone</code>, <code>groupe</code>, <code>siret</code>, <code>chambres</code>, <code>email</code>, <code>prenom</code>, <code>nom_contact</code>, <code>fonction</code>.</p>
        <p class="small muted">Les doublons avec les établissements existants sont fusionnés automatiquement. Source enregistrée : « Import CSV ».</p>
        <input type="file" id="csv-file" accept=".csv,text/csv"><div id="import-result" style="margin-top:12px"></div>`,
      foot: '<button data-close>Fermer</button><button class="primary" id="do-import" data-busy="Import…">Importer</button>',
      onMount: (mEl) => mEl.querySelector('#do-import').addEventListener('click', (ev) => withBusy(ev.currentTarget, async () => {
        const file = mEl.querySelector('#csv-file').files[0];
        if (!file) return toastError(new Error('Choisissez un fichier'));
        const buf = await file.arrayBuffer();
        let text = new TextDecoder('utf-8').decode(buf);
        if (text.includes('�')) text = new TextDecoder('windows-1252').decode(buf);
        try {
          const r = await api.post('/api/establishments/import', { csv: text });
          mEl.querySelector('#import-result').innerHTML = `<div class="alert success">${r.created} créé(s), ${r.merged} fusionné(s) avec des fiches existantes.</div>${r.errors.map((x) => `<div class="alert attention">${esc(x)}</div>`).join('')}`;
          load();
        } catch (err) { toastError(err); }
      })),
    });
  });

  await load();
  if (query.job) startJob(query.job);
  return () => stopJob?.();
}
