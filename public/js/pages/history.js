import { api, meta } from '../api.js';
import { badge, esc, fmtDate, modal, on, options, toast, toastError, warningsList } from '../ui.js';

const EVENT_LABELS = { prepare: 'Préparé', modifie: 'Modifié', valide: 'Validé', envoye: 'Envoyé', erreur_envoi: "Erreur d'envoi", brouillon: 'Brouillon', ignore: 'Ignoré', resultat: 'Résultat enregistré', regenere: 'Régénéré', relance_preparee: 'Relance préparée', reponse_detectee: 'Réponse détectée', rejet_detecte: 'Rejet détecté', retire_de_la_file: "Retiré de la file" };

export default async function history(el, { query, refreshCounts }) {
  const m = await meta();
  const st = await api.get('/api/meta/statuses');
  const campaigns = await api.get('/api/campaigns');
  const filters = { status: query.status || '', outcome: query.outcome || '', campaign_id: query.campaign || '', kind: '', q: '' };

  el.innerHTML = `
    <div class="page-head"><div><h1>Historique des candidatures</h1><div class="sub">Chaque action est tracée. Qualifiez ici les réponses reçues.</div></div>
      <div class="actions"><button id="sync">Vérifier les réponses (Gmail)</button></div></div>
    <div class="card flat" style="padding:12px"><form id="f" class="row">
      <select name="status" style="width:auto">${options(st.messages, filters.status, { empty: 'Tous statuts' })}</select>
      <select name="outcome" style="width:auto">${options(st.outcomes, filters.outcome, { empty: 'Tous résultats' })}</select>
      <select name="campaign_id" style="width:auto">${options(Object.fromEntries(campaigns.map((c) => [c.id, c.name])), filters.campaign_id, { empty: 'Toutes campagnes' })}</select>
      <select name="kind" style="width:auto">${options({ initial: 'Candidatures', relance: 'Relances' }, '', { empty: 'Tous types' })}</select>
      <input type="search" name="q" placeholder="Entreprise, adresse, objet…" style="width:240px">
    </form></div>
    <div id="list"></div>`;

  const listEl = el.querySelector('#list');
  let rows = [];
  async function load() {
    const qs = new URLSearchParams(Object.entries(filters).filter(([, v]) => v));
    rows = await api.get(`/api/messages?${qs}`);
    listEl.innerHTML = rows.length ? `<div class="table-wrap"><table><thead><tr><th>Préparé</th><th>Envoyé</th><th>Entreprise</th><th>Destinataire</th><th>Modèle</th><th>Statut</th><th>Résultat</th><th>Prochaine action</th></tr></thead><tbody>
      ${rows.map((r) => `<tr data-open="${r.id}" style="cursor:pointer"><td class="small nowrap">${fmtDate(r.created_at)}</td><td class="small nowrap">${fmtDate(r.sent_at, true)}</td>
        <td class="name-cell"><a href="#/prospects/${r.establishment_id}">${esc(r.establishment_name)}</a><div class="sub">${esc(m.types[r.establishment_type] || '')} · ${esc(r.city || '')}</div></td>
        <td class="small">${esc(r.to_email || '—')}<div class="muted">${esc(r.to_name || r.to_role || '')}</div></td>
        <td class="small">${r.kind === 'relance' ? '<span class="badge primary">Relance</span> ' : ''}${esc(r.template_name || '')}</td>
        <td>${badge(r.status, st.messages)}${r.delivery_status === 'rejete' ? ' <span class="badge danger">rejeté</span>' : ''}${r.error && r.status === 'erreur' ? `<div class="small" style="color:var(--danger)">${esc(r.error.slice(0, 80))}</div>` : ''}</td>
        <td>${badge(r.outcome, st.outcomes)}</td><td class="small">${esc(r.next_action || '')}${r.next_action_at ? `<div class="muted">${fmtDate(r.next_action_at)}</div>` : ''}</td></tr>`).join('')}
      </tbody></table></div>` : '<div class="card empty"><h3>Aucun message</h3></div>';
  }

  async function open(id) {
    const d = await api.get(`/api/messages/${id}`);
    const msg = d.message;
    modal({
      title: `${d.establishment.name} — ${msg.kind === 'relance' ? 'relance' : 'candidature'}`,
      wide: true,
      body: `<div class="grid cols-2">
        <div><div class="kv"><div>À</div><div>${esc(msg.to_email || '—')} ${msg.to_name ? `(${esc(msg.to_name)})` : ''}</div><div>Fonction</div><div>${esc(msg.to_role || '—')}</div>
          <div>Statut</div><div>${badge(msg.status, st.messages)}</div><div>Préparé le</div><div>${fmtDate(msg.created_at, true)}</div><div>Validé le</div><div>${fmtDate(msg.validated_at, true)}</div>
          <div>Envoyé le</div><div>${fmtDate(msg.sent_at, true)} ${msg.provider ? `via ${esc(msg.provider)}` : ''}</div>
          <div>Distribution</div><div>${msg.delivery_status === 'accepte' ? 'Accepté par la messagerie (la remise finale n\'est pas garantie)' : msg.delivery_status === 'rejete' ? '<span style="color:var(--danger)">Rejeté (adresse invalide)</span>' : 'Inconnue'}</div>
          <div>Modèle</div><div>${esc(msg.template_name || '—')}</div><div>Tentatives</div><div>${msg.attempts}</div></div>
          ${msg.error ? `<div class="alert bloquant" style="margin-top:10px">${esc(msg.error)}</div>` : ''}
          <div class="hr"></div><h3>Objet : ${esc(msg.subject)}</h3><div class="pre small" style="max-height:300px;overflow:auto;border:1px solid var(--border);padding:10px;border-radius:8px">${esc(msg.body)}${msg.signature ? `\n\n--\n${esc(msg.signature)}` : ''}</div>
          ${d.attachments.length ? `<div class="small" style="margin-top:6px">Pièces jointes : ${d.attachments.map((a) => esc(a.label)).join(', ')}</div>` : ''}
        </div>
        <div>
          ${msg.status === 'envoyee' ? `<h3>Réponse et suivi</h3>
          <div class="field"><label>Résultat</label><select id="outcome">${options(st.outcomes, msg.outcome)}</select>
            <div class="help">« Réponse reçue » n'est pas une réponse positive : qualifiez-la après lecture.</div></div>
          <div class="field"><label>Notes sur la réponse</label><textarea id="note" rows="3">${esc(msg.reply_excerpt || '')}</textarea></div>
          <div class="field"><label>Prochaine action</label><input type="text" id="na" value="${esc(msg.next_action || '')}"></div>
          <div class="field"><label>Date</label><input type="date" id="nad" value="${esc((msg.next_action_at || '').slice(0, 10))}"></div>
          <button class="primary" id="save-outcome">Enregistrer</button>` : `<h3>Contrôles</h3>${warningsList(msg.warnings)}${['a_valider', 'brouillon', 'erreur', 'validee'].includes(msg.status) ? `<a class="btn primary" href="#/validation?id=${msg.id}">Ouvrir dans l'écran de validation</a>` : ''}`}
          <div class="hr"></div><h3>Historique</h3>
          <ul class="timeline">${d.events.map((ev) => `<li><span class="muted small">${fmtDate(ev.created_at, true)}</span> — ${esc(EVENT_LABELS[ev.action] || ev.action)}${ev.details?.champs ? ` (${esc(ev.details.champs.join(', '))})` : ''}${ev.details?.error ? ` : ${esc(ev.details.error)}` : ''}${ev.details?.outcome ? ` : ${esc(st.outcomes[ev.details.outcome] || ev.details.outcome)}` : ''}</li>`).join('')}</ul>
        </div></div>`,
      onMount: (mEl, close) => {
        mEl.querySelector('#save-outcome')?.addEventListener('click', async () => {
          try {
            await api.post(`/api/messages/${id}/outcome`, { outcome: mEl.querySelector('#outcome').value, note: mEl.querySelector('#note').value, next_action: mEl.querySelector('#na').value, next_action_at: mEl.querySelector('#nad').value });
            toast('Suivi enregistré', 'success');
            close(); load(); refreshCounts();
          } catch (err) { toastError(err); }
        });
        mEl.querySelectorAll('a').forEach((a) => a.addEventListener('click', close));
      },
    });
  }

  let t;
  el.querySelector('#f').addEventListener('input', () => {
    clearTimeout(t);
    t = setTimeout(() => { for (const elx of el.querySelectorAll('#f [name]')) filters[elx.name] = elx.value; load().catch(toastError); }, 250);
  });
  on(listEl, 'click', '[data-open]', (e, tr) => { if (!e.target.closest('a')) open(Number(tr.dataset.open)).catch(toastError); });
  el.querySelector('#sync').addEventListener('click', async (e) => {
    try {
      e.target.disabled = true;
      const r = await api.post('/api/mail/sync-replies');
      toast(`${r.checked} fil(s) vérifié(s) : ${r.replies} réponse(s), ${r.bounces} rejet(s) détecté(s).`, 'success', 7000);
      load(); refreshCounts();
    } catch (err) { toastError(err); } finally { e.target.disabled = false; }
  });
  await load();
  if (query.id) open(Number(query.id)).catch(toastError);
}
