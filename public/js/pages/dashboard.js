import { api } from '../api.js';
import { esc, fmtDate, badge } from '../ui.js';

const kpi = (label, value, hint = '') => `<div class="kpi"><div class="label">${label}</div><div class="value">${value ?? '—'}</div>${hint ? `<div class="hint">${hint}</div>` : ''}</div>`;
const pct = (v) => (v == null ? '—' : `${String(v).replace('.', ',')} %`);

export default async function dashboard(el) {
  const [d, statuses] = await Promise.all([api.get('/api/dashboard'), api.get('/api/meta/statuses')]);
  const s = d.stats;
  const t = d.todo;
  const setupSteps = [
    { ok: d.setup.profile_ok, text: 'Compléter votre profil (nom, présentation, réalisations)', href: '#/parametres?tab=profil' },
    { ok: d.setup.cv_ok, text: 'Ajouter votre CV (pièce jointe ou lien)', href: '#/parametres?tab=pieces' },
    { ok: d.setup.mail_ok, text: 'Connecter votre messagerie (Gmail, Outlook ou SMTP)', href: '#/parametres?tab=messagerie' },
    { ok: s.in_list > 0, text: 'Lancer une première recherche et constituer une liste', href: '#/recherche' },
  ];
  const setupLeft = setupSteps.filter((x) => !x.ok);
  const todo = [
    t.to_validate && `<a href="#/validation"><b>${t.to_validate}</b> e-mail(s) à valider</a>`,
    t.drafts && `<a href="#/historique?status=brouillon"><b>${t.drafts}</b> brouillon(s)</a>`,
    t.errors && `<a href="#/historique?status=erreur"><b>${t.errors}</b> erreur(s) d'envoi à traiter</a>`,
    t.followups_due && `<a href="#/relances"><b>${t.followups_due}</b> relance(s) à préparer</a>`,
    t.replies_to_qualify && `<a href="#/historique?outcome=reponse_a_qualifier"><b>${t.replies_to_qualify}</b> réponse(s) à qualifier</a>`,
    t.contacts_to_check && `<a href="#/prospects?status=contact_a_verifier"><b>${t.contacts_to_check}</b> prospect(s) dont les contacts sont à vérifier</a>`,
    ...t.paused_campaigns.map((c) => `<a href="#/campagnes"><span class="badge danger">En pause</span> ${esc(c.name)} — ${esc(c.pause_reason || '')}</a>`),
  ].filter(Boolean);

  el.innerHTML = `
    <div class="page-head"><div><h1>Tableau de bord</h1><div class="sub">Vue d'ensemble de votre prospection</div></div>
      <div class="actions"><a class="btn" href="#/recherche">Rechercher des établissements</a><a class="btn primary" href="#/campagnes?new=1">Préparer une campagne</a></div></div>
    ${setupLeft.length ? `<div class="card"><h2>Pour bien démarrer</h2>${setupSteps.map((x) => `<div class="row" style="margin-bottom:6px">${x.ok ? '<span class="badge success">Fait</span>' : '<span class="badge warning">À faire</span>'} <a href="${x.href}">${x.text}</a></div>`).join('')}</div>` : ''}
    <div class="grid cols-4" style="margin-bottom:16px">
      ${kpi('Établissements identifiés', s.identified, `${s.in_list} dans la liste de prospection`)}
      ${kpi('Prospects qualifiés', s.qualified, 'Dans la liste et score ≥ 50')}
      ${kpi('Contacts exploitables', s.usable_contacts, 'Établissements avec une adresse non invalide')}
      ${kpi('E-mails à valider', s.pending_validation, `${s.prepared} préparés au total`)}
      ${kpi('Candidatures envoyées', s.sent, `${s.followups_sent} relance(s) en plus`)}
      ${kpi('Taux de réponse', pct(s.reply_rate), `${s.replied} réponse(s), toutes natures`)}
      ${kpi('Réponses positives', pct(s.positive_rate), `${s.positive} réponse(s) positive(s)`)}
      ${kpi('Entretiens obtenus', s.interviews, `Conversion : ${pct(s.interview_rate)}`)}
    </div>
    <div class="grid cols-2">
      <div class="card"><h2>À faire</h2>${todo.length ? `<div class="stack">${todo.map((x) => `<div>${x}</div>`).join('')}</div>` : '<p class="muted">Rien en attente.</p>'}
        ${t.next_actions.length ? `<div class="hr"></div><h3>Prochaines actions planifiées</h3>${t.next_actions.map((a) => `<div class="small"><a href="#/prospects/${a.id}">${esc(a.name)}</a> — ${esc(a.next_action)} <span class="muted">${a.next_action_at ? fmtDate(a.next_action_at) : ''}</span></div>`).join('')}` : ''}
      </div>
      <div class="card"><h2>Envoi</h2>
        <div class="kv">
          <div>Messagerie</div><div>${d.sending.account ? esc(d.sending.account) : '<a href="#/parametres?tab=messagerie">Non connectée</a>'}</div>
          <div>Aujourd'hui</div><div>${d.sending.sent_today} / ${d.sending.daily_cap} (plafond quotidien)</div>
          <div>File d'envoi</div><div>${d.sending.queued} validé(s) en attente · ${d.sending.queue_running ? '<span class="badge success">active</span>' : '<span class="badge">arrêtée</span>'}</div>
        </div>
        <div class="hr"></div><h3>Derniers envois</h3>
        ${d.recent.length ? `<table><tbody>${d.recent.map((m) => `<tr><td>${esc(m.establishment_name)}<div class="muted small">${esc(m.to_email)}</div></td><td class="nowrap small">${fmtDate(m.sent_at)}</td><td>${badge(m.outcome, statuses.outcomes)}</td></tr>`).join('')}</tbody></table>` : '<p class="muted small">Aucun envoi pour l\'instant.</p>'}
      </div>
    </div>`;
}
