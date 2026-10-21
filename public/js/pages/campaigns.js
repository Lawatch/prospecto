import { api, meta } from '../api.js';
import { esc, fmtDate, on, options, scoreBadge, toast, toastError, withBusy, badge } from '../ui.js';

export default async function campaigns(el, { query, refreshCounts }) {
  const m = await meta();
  const statuses = await api.get('/api/meta/statuses');

  async function drawList() {
    const [list, queue, composeProviders] = await Promise.all([api.get('/api/campaigns'), api.get('/api/queue'), api.get('/api/compose-providers')]);
    const composeMode = Object.hasOwn(composeProviders, queue.provider || '');
    el.innerHTML = `
      <div class="page-head"><div><h1>Campagnes</h1><div class="sub">La préparation d'une campagne ne déclenche jamais d'envoi : chaque message attend votre validation.</div></div>
        <div class="actions"><a class="btn primary" href="#/campagnes?new=1">+ Nouvelle campagne</a></div></div>
      ${composeMode ? `<div class="alert info">Envoi par ${esc(composeProviders[queue.provider])} : chaque e-mail s'ouvre pré-rempli depuis l'écran <a href="#/validation">Validation</a>, et c'est vous qui cliquez sur Envoyer. ${queue.sent_today}/${queue.daily_cap} envoyés aujourd'hui.</div>` : `<div class="card"><div class="row between"><div><h2 style="margin-bottom:4px">File d'envoi des messages validés</h2>
        <div class="small muted">${queue.queued} message(s) validé(s) un par un en attente · ${queue.sent_today}/${queue.daily_cap} envoyés aujourd'hui · intervalle minimal entre deux envois respecté automatiquement${queue.queue_reason ? ` · Dernier arrêt : ${esc(queue.queue_reason)}` : ''}</div></div>
        <div class="actions">${queue.queue_running ? '<span class="badge success">En cours</span><button id="q-stop">Arrêter la file</button>' : `<button class="primary" id="q-start" ${queue.queued ? '' : 'disabled'}>Envoyer les ${queue.queued} message(s) validé(s)</button>`}</div></div></div>`}
      ${list.length ? `<div class="table-wrap"><table><thead><tr><th>Campagne</th><th>Poste visé</th><th>Créée le</th><th>À valider</th><th>Validés</th><th>Envoyés</th><th>Erreurs</th><th>Statut</th><th></th></tr></thead><tbody>
        ${list.map((c) => `<tr><td><b>${esc(c.name)}</b>${c.pause_reason ? `<div class="small" style="color:var(--danger)">${esc(c.pause_reason)}</div>` : ''}</td>
          <td class="small">${esc(m.categories[c.target_category] || '')}<div class="muted">Score min. ${c.min_score}${c.max_messages ? ` · plafond ${c.max_messages}` : ''}</div></td>
          <td class="small">${fmtDate(c.created_at)}</td><td>${(c.counts.a_valider || 0) + (c.counts.brouillon || 0)}</td><td>${c.counts.validee || 0}</td><td>${c.counts.envoyee || 0}</td><td>${c.counts.erreur || 0}</td>
          <td>${c.status === 'en_pause' ? '<span class="badge danger">En pause</span>' : c.status === 'terminee' ? '<span class="badge">Terminée</span>' : '<span class="badge success">Active</span>'}</td>
          <td class="nowrap"><a class="btn sm primary" href="#/validation?campaign=${c.id}">Valider</a> <a class="btn sm" href="#/historique?campaign=${c.id}">Messages</a>
            ${c.status === 'en_pause' ? `<button class="sm" data-resume="${c.id}">Reprendre</button>` : c.status === 'active' ? `<button class="sm ghost" data-pause="${c.id}">Pause</button><button class="sm ghost" data-finish="${c.id}">Clore</button>` : ''}</td></tr>`).join('')}
      </tbody></table></div>` : '<div class="card empty"><h3>Aucune campagne</h3><p>Sélectionnez des prospects puis préparez une campagne.</p></div>'}`;
  }

  async function drawNew() {
    const preset = JSON.parse(sessionStorage.getItem('campaign_ids') || '[]');
    sessionStorage.removeItem('campaign_ids');
    const [templates, prospects] = await Promise.all([api.get('/api/templates'), api.get('/api/establishments?in_list=1&limit=1000&sort=score')]);
    const rows = prospects.rows;
    const selected = new Set(preset.length ? preset : rows.filter((r) => r.email_count > 0 && !['envoyee', 'refus', 'entretien', 'ne_plus_contacter', 'en_attente', 'validee'].includes(r.status)).map((r) => r.id));
    el.innerHTML = `
      <div class="page-head"><div><div class="small"><a href="#/campagnes">← Campagnes</a></div><h1>Préparer une campagne</h1><div class="sub">Les messages sont générés puis placés « En attente de validation ». Rien n'est envoyé à cette étape.</div></div></div>
      <div class="split">
        <div class="card"><div class="card-head"><h2>Prospects</h2><div class="actions"><input type="number" id="min-score" placeholder="Score min." min="0" max="100" style="width:110px"><label class="inline small"><input type="checkbox" id="only-email" checked> avec e-mail</label><button class="sm" id="sel-all">Tout</button><button class="sm" id="sel-none">Aucun</button></div></div>
          <div class="table-wrap" style="max-height:560px;overflow:auto"><table><thead><tr><th class="check"></th><th>Score</th><th>Établissement</th><th>Type</th><th>Contact</th><th>Statut</th></tr></thead><tbody id="rows"></tbody></table></div></div>
        <div class="card"><h2>Paramètres</h2>
          <form id="camp-form">
            <div class="field"><label>Nom</label><input type="text" name="name" value="Campagne du ${new Date().toLocaleDateString('fr-FR')}"></div>
            <div class="field"><label>Poste visé</label><select name="target_category">${options(Object.fromEntries(Object.entries(m.categories).filter(([k]) => k !== 'relance')), 'direction_adjointe')}</select><div class="help">Détermine la catégorie de modèle et l'ordre de priorité des interlocuteurs.</div></div>
            <div class="field"><label>Modèle</label><select name="template_id"><option value="">Sélection automatique (catégorie + type d'établissement)</option>${templates.filter((t) => t.kind === 'initial').map((t) => `<option value="${t.id}">${esc(t.name)}</option>`).join('')}</select></div>
            <div class="field"><label>Score minimal</label><input type="number" name="min_score" value="0" min="0" max="100"></div>
            <div class="field"><label>Plafond de messages pour cette campagne</label><input type="number" name="max_messages" min="1" placeholder="Illimité (dans la limite des plafonds globaux)"></div>
            <div class="field"><label class="inline"><input type="checkbox" name="include_without_email"> Inclure les prospects sans e-mail (destinataire à saisir à la validation)</label></div>
            <div class="field"><label class="inline"><input type="checkbox" name="allow_recontact"> Autoriser un prospect déjà sollicité (nouvelle candidature)</label></div>
            <div id="interlocuteurs" class="small muted"></div>
            <div class="hr"></div>
            <div class="small" id="sel-count"></div>
            <button class="primary lg" style="width:100%;margin-top:8px" id="go" data-busy="Préparation…">Préparer les messages</button>
          </form>
          <div id="result" style="margin-top:12px"></div>
        </div>
      </div>`;
    const tbody = el.querySelector('#rows');
    const drawRows = () => {
      const min = Number(el.querySelector('#min-score').value) || 0;
      const onlyEmail = el.querySelector('#only-email').checked;
      const visible = rows.filter((r) => (r.score ?? 0) >= min && (!onlyEmail || r.email_count > 0 || selected.has(r.id)));
      tbody.innerHTML = visible.map((r) => `<tr class="${selected.has(r.id) ? 'selected' : ''}"><td class="check"><input type="checkbox" data-sel="${r.id}" ${selected.has(r.id) ? 'checked' : ''}></td><td>${scoreBadge(r.score)}</td>
        <td class="name-cell"><a href="#/prospects/${r.id}">${esc(r.name)}</a><div class="sub">${esc(r.city || '')}</div></td><td class="small">${esc(m.types[r.type] || '')}</td>
        <td class="small">${r.email_count ? `${r.email_count} e-mail(s)` : '<span class="muted">aucun</span>'}</td><td>${badge(r.status, m.statuses)}</td></tr>`).join('') || '<tr><td colspan="6" class="muted">Aucun prospect ne correspond. <a href="#/recherche">Lancer une recherche</a></td></tr>';
      el.querySelector('#sel-count').textContent = `${selected.size} prospect(s) sélectionné(s)`;
      tbody.dataset.visible = visible.map((r) => r.id).join(',');
    };
    const drawPriority = () => {
      const cat = el.querySelector('[name=target_category]').value;
      el.querySelector('#interlocuteurs').innerHTML = `Interlocuteurs privilégiés, dans l'ordre : ${(m.role_priority[cat] || []).map((r) => esc(m.roles[r])).join(' → ')}`;
    };
    drawRows();
    drawPriority();
    el.querySelector('[name=target_category]').addEventListener('change', drawPriority);
    el.querySelector('#min-score').addEventListener('input', drawRows);
    el.querySelector('#only-email').addEventListener('change', drawRows);
    on(tbody, 'change', '[data-sel]', (e, cb) => { const id = Number(cb.dataset.sel); if (cb.checked) selected.add(id); else selected.delete(id); drawRows(); });
    el.querySelector('#sel-all').addEventListener('click', () => { for (const id of (tbody.dataset.visible || '').split(',').filter(Boolean)) selected.add(Number(id)); drawRows(); });
    el.querySelector('#sel-none').addEventListener('click', () => { selected.clear(); drawRows(); });
    el.querySelector('#camp-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const f = e.target;
      withBusy(el.querySelector('#go'), async () => {
        try {
          const res = await api.post('/api/campaigns', {
            name: f.name.value, target_category: f.target_category.value, template_id: f.template_id.value ? Number(f.template_id.value) : null,
            min_score: Number(f.min_score.value) || 0, max_messages: f.max_messages.value ? Number(f.max_messages.value) : null,
            include_without_email: f.include_without_email.checked, allow_recontact: f.allow_recontact.checked, establishment_ids: [...selected],
          });
          refreshCounts();
          el.querySelector('#result').innerHTML = `<div class="alert success"><b>${res.created.length} message(s) préparé(s)</b>, en attente de votre validation. Aucun n'a été envoyé.</div>
            ${res.skipped.length ? `<details><summary class="small">${res.skipped.length} prospect(s) écarté(s)</summary>${res.skipped.map((s) => `<div class="small">${esc(s.name)} — ${esc(s.reason)}</div>`).join('')}</details>` : ''}
            ${res.created.length ? `<a class="btn primary lg" style="width:100%;margin-top:10px" href="#/validation?campaign=${res.campaign.id}">Valider les messages un par un →</a>` : ''}`;
        } catch (err) { toastError(err); }
      });
    });
  }

  on(el, 'click', '#q-start', async (e, b) => {
    try { await api.post('/api/queue/start'); toast('Envoi des messages validés lancé (un message à la fois, intervalle minimal respecté).', 'success'); drawList(); refreshCounts(); } catch (err) { toastError(err); }
  });
  on(el, 'click', '#q-stop', async () => { await api.post('/api/queue/stop'); drawList(); refreshCounts(); });
  on(el, 'click', '[data-resume]', async (e, b) => { await api.patch(`/api/campaigns/${b.dataset.resume}`, { status: 'active' }); toast('Campagne reprise', 'success'); drawList(); });
  on(el, 'click', '[data-pause]', async (e, b) => { await api.patch(`/api/campaigns/${b.dataset.pause}`, { status: 'en_pause' }); drawList(); });
  on(el, 'click', '[data-finish]', async (e, b) => { await api.patch(`/api/campaigns/${b.dataset.finish}`, { status: 'terminee' }); drawList(); });

  if (query.new) await drawNew();
  else await drawList();
  const t = setInterval(() => { if (!query.new && el.isConnected) drawList().catch(() => {}); }, 15000);
  return () => clearInterval(t);
}
