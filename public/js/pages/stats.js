import { api } from '../api.js';
import { esc } from '../ui.js';

const pct = (v) => (v == null ? '—' : `${String(v).replace('.', ',')} %`);
const kpi = (label, value, hint = '') => `<div class="kpi"><div class="label">${label}</div><div class="value">${value ?? '—'}</div>${hint ? `<div class="hint">${hint}</div>` : ''}</div>`;

// Tableau + barre de magnitude d'une seule teinte (taux de réponse) : la table reste la vue de référence.
function breakdown(title, rows) {
  if (!rows.length) return `<div class="card"><h2>${title}</h2><p class="muted small">Pas encore d'envois.</p></div>`;
  const max = Math.max(...rows.map((r) => r.reply_rate || 0), 1);
  return `<div class="card"><h2>${title}</h2><table><thead><tr><th></th><th class="right">Envoyés</th><th class="right">Réponses</th><th style="width:34%">Taux de réponse</th><th class="right">Positives</th><th class="right">Entretiens</th></tr></thead><tbody>
    ${rows.map((r) => `<tr><td>${esc(r.label)}</td><td class="right">${r.sent}</td><td class="right">${r.replied}</td>
      <td title="${esc(r.label)} : ${pct(r.reply_rate)} (${r.replied}/${r.sent})"><div class="row" style="gap:8px;flex-wrap:nowrap"><div class="bar" style="flex:1;margin:0"><div style="width:${((r.reply_rate || 0) / max) * 100}%;border-radius:0 4px 4px 0"></div></div><span class="small nowrap">${pct(r.reply_rate)}</span></div></td>
      <td class="right">${r.positive} <span class="muted small">(${pct(r.positive_rate)})</span></td><td class="right">${r.interviews}</td></tr>`).join('')}
  </tbody></table>${rows.some((r) => r.sent < 10) ? '<p class="small muted" style="margin-top:8px">Moins de 10 envois sur certaines lignes : les taux ne sont pas encore significatifs.</p>' : ''}</div>`;
}

export default async function stats(el) {
  const s = await api.get('/api/stats');
  const f = s.funnel;
  const maxDay = Math.max(1, ...s.daily.map((d) => d.ok + d.failed));
  el.innerHTML = `
    <div class="page-head"><div><h1>Statistiques</h1><div class="sub">Un e-mail envoyé n'est pas forcément délivré, et une réponse n'est pas forcément positive : les indicateurs sont distingués.</div></div></div>
    <div class="grid cols-4" style="margin-bottom:16px">
      ${kpi('Établissements identifiés', f.identified)}
      ${kpi('Prospects qualifiés', f.qualified, 'Liste de prospection, score ≥ 50')}
      ${kpi('Contacts exploitables', f.usable_contacts)}
      ${kpi('E-mails préparés', f.prepared, `${f.pending_validation} en attente de validation`)}
      ${kpi('E-mails validés', f.validated)}
      ${kpi('Envoyés (candidatures)', f.sent, `${f.followups_sent} relance(s) · ${f.errors} en erreur`)}
      ${kpi('Délivrés (sans rejet détecté)', f.delivered_known ?? 'Inconnu', f.delivered_known == null ? 'Activez la détection Gmail des rejets pour le mesurer' : `${f.bounced} rejet(s)`)}
      ${kpi('Taux de réponse', pct(f.reply_rate), `${f.replied} réponse(s)`)}
      ${kpi('Taux de réponses positives', pct(f.positive_rate), `${f.positive} positive(s)`)}
      ${kpi('Entretiens obtenus', f.interviews)}
      ${kpi('Conversion en entretien', pct(f.interview_rate), 'Entretiens / candidatures envoyées')}
    </div>
    <div class="card"><h2>Envois quotidiens (30 derniers jours)</h2>
      ${s.daily.length ? `<div style="display:flex;align-items:flex-end;gap:2px;height:120px;border-bottom:1px solid var(--border)">
        ${s.daily.map((d) => `<div title="${esc(d.day)} : ${d.ok} envoyé(s)${d.failed ? `, ${d.failed} erreur(s)` : ''}" style="flex:1;max-width:28px;height:${((d.ok + d.failed) / maxDay) * 100}%;min-height:2px;background:var(--primary);border-radius:4px 4px 0 0"></div>`).join('')}
      </div><div class="row between small muted"><span>${esc(s.daily[0].day)}</span><span>${esc(s.daily.at(-1).day)}</span></div>` : '<p class="muted small">Aucun envoi sur la période.</p>'}
    </div>
    <div class="grid cols-2">
      ${breakdown("Par type d'établissement", s.by_type)}
      ${breakdown('Par template', s.by_template)}
      ${breakdown('Par poste visé', s.by_category)}
      ${breakdown('Par fonction du destinataire', s.by_role)}
    </div>`;
}
