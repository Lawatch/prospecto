import { api } from '../api.js';
import { esc, fmtDate, on, toast, toastError } from '../ui.js';

export default async function followups(el, { refreshCounts }) {
  const settings = (await api.get('/api/settings')).settings.followup;
  async function load() {
    const rows = await api.get('/api/followups');
    const due = rows.filter((r) => r.is_due);
    const later = rows.filter((r) => !r.is_due);
    const table = (list, showAction) => `<div class="table-wrap"><table><thead><tr><th>Entreprise</th><th>Destinataire</th><th>Envoyé le</th><th>Relances</th><th>Relance prévue</th><th></th></tr></thead><tbody>
      ${list.map((r) => `<tr><td class="name-cell"><a href="#/prospects/${r.establishment_id}">${esc(r.establishment_name)}</a><div class="sub">${esc(r.city || '')}</div></td>
        <td class="small">${esc(r.to_email)}<div class="muted">${esc(r.to_name || '')}</div></td><td class="small">${fmtDate(r.sent_at)}</td><td>${r.followups_sent}</td><td class="small">${fmtDate(r.due_at)}</td>
        <td class="nowrap">${r.pending_followup_id ? `<a class="btn sm" href="#/validation?id=${r.pending_followup_id}">Relance à valider</a>` : showAction ? `<button class="sm primary" data-prep="${r.id}">Préparer la relance</button>` : `<button class="sm" data-prep="${r.id}">Préparer maintenant</button>`}
          <button class="sm ghost" data-reply="${r.id}">A répondu</button></td></tr>`).join('')}</tbody></table></div>`;
    el.innerHTML = `
      <div class="page-head"><div><h1>Relances</h1><div class="sub">Délai : ${settings.delay_days} jours après l'envoi · ${settings.max_followups} relance(s) maximum · chaque relance passe par l'écran de validation.</div></div>
        <div class="actions">${due.filter((r) => !r.pending_followup_id).length ? `<button class="primary" id="prep-all">Préparer les ${due.filter((r) => !r.pending_followup_id).length} relance(s) dues</button>` : ''}<a class="btn" href="#/parametres?tab=envoi">Régler le délai</a></div></div>
      <div class="alert info">Sont exclus automatiquement : les personnes ayant répondu, refusé, demandé à ne plus être contactées, les adresses rejetées et la liste d'opposition.</div>
      <div class="card"><h2>À relancer maintenant (${due.length})</h2>${due.length ? table(due, true) : '<p class="muted">Aucune relance due.</p>'}</div>
      <div class="card"><h2>Prochaines relances (${later.length})</h2>${later.length ? table(later, false) : '<p class="muted">—</p>'}</div>`;
    el.querySelector('#prep-all')?.addEventListener('click', async (e) => {
      e.target.disabled = true;
      let n = 0;
      for (const r of due.filter((x) => !x.pending_followup_id)) { try { await api.post(`/api/followups/${r.id}/prepare`); n++; } catch (err) { toastError(err); } }
      toast(`${n} relance(s) préparée(s), en attente de validation`, 'success');
      refreshCounts();
      location.hash = '#/validation';
    });
  }
  on(el, 'click', '[data-prep]', async (e, b) => {
    try { const d = await api.post(`/api/followups/${b.dataset.prep}/prepare`); refreshCounts(); location.hash = `#/validation?id=${d.message.id}`; } catch (err) { toastError(err); }
  });
  on(el, 'click', '[data-reply]', async (e, b) => {
    await api.post(`/api/messages/${b.dataset.reply}/outcome`, { outcome: 'reponse_a_qualifier' }).catch(toastError);
    toast('Marqué comme « réponse reçue » : qualifiez-la dans l\'historique.', 'success');
    load(); refreshCounts();
  });
  await load();
}
