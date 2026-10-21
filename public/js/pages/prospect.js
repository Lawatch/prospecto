import { api, meta, isLocal } from '../api.js';
import { badge, confirmDialog, esc, fmtDate, link, modal, on, options, reliability, scoreBadge, toast, toastError, withBusy, formData, EMAIL_STATUS } from '../ui.js';

const ACTION_LABELS = {
  identifie: 'Établissement identifié', statut: 'Changement de statut', enrichi: 'Enrichissement', modifie: 'Modification', ajoute: 'Contact ajouté',
  supprime: 'Contact supprimé', verifie: 'Vérification', prepare: 'Candidature préparée', envoye: 'E-mail envoyé', erreur_envoi: "Erreur d'envoi",
  valide: 'Validé pour envoi', ignore: 'Ignoré', brouillon: 'Enregistré en brouillon', resultat: 'Résultat enregistré', opposition: "Ajout à la liste d'opposition",
  ajoute_liste: 'Ajouté à la liste', relance_preparee: 'Relance préparée', reponse_detectee: 'Réponse détectée', rejet_detecte: 'Rejet détecté', regenere: 'Message régénéré', retire_de_la_file: "Retiré de la file d'envoi",
};

function contactForm(c = {}, roles) {
  return `<form class="form-grid" id="contact-form">
    <div class="field"><label>Civilité</label><select name="civility">${options({ '': '—', 'Mme': 'Mme', 'M.': 'M.' }, c.civility || '')}</select><div class="help">Utilisée pour « Madame Dupont, ». Jamais déduite automatiquement.</div></div>
    <div class="field"><label>Catégorie de fonction</label><select name="role_category">${options(roles, c.role_category || 'autre')}</select></div>
    <div class="field"><label>Prénom</label><input type="text" name="first_name" value="${esc(c.first_name || '')}"></div>
    <div class="field"><label>Nom</label><input type="text" name="last_name" value="${esc(c.last_name || '')}"></div>
    <div class="field full"><label>Fonction exacte</label><input type="text" name="role" value="${esc(c.role || '')}" placeholder="ex. Directeur général, Responsable RH"></div>
    <div class="field"><label>E-mail professionnel</label><input type="email" name="email" value="${esc(c.email || '')}"></div>
    <div class="field"><label>Statut de l'adresse</label><select name="email_status">${options(EMAIL_STATUS, c.email_status || 'non_verifiee')}</select><div class="help">« Vérifiée » uniquement si vous l'avez confirmée vous-même.</div></div>
    <div class="field"><label>Téléphone</label><input type="text" name="phone" value="${esc(c.phone || '')}"></div>
    <div class="field"><label>Source (URL)</label><input type="url" name="source_url" value="${esc(c.source_url || '')}" placeholder="Page où l'information a été trouvée"></div>
    <div class="field full"><label>Notes</label><textarea name="notes" rows="2">${esc(c.notes || '')}</textarea></div>
  </form>`;
}

export default async function prospect(el, { params }) {
  const m = await meta();
  const statuses = await api.get('/api/meta/statuses');
  const id = Number(params.id);

  let current = { e: null, contacts: [] };
  let openContact;

  async function load() {
    const d = await api.get(`/api/establishments/${id}`);
    draw(d);
  }

  function draw({ establishment: e, contacts, messages, events, opposition }) {
    const sources = e.sources || [];
    el.innerHTML = `
      <div class="page-head">
        <div><div class="small"><a href="#/prospects">← Prospects</a></div><h1>${esc(e.name)} ${scoreBadge(e.score)}</h1>
          <div class="sub">${esc(m.types[e.type] || '')}${e.group_name ? ` · ${esc(e.group_name)}` : ''} · ${esc([e.address, e.postcode, e.city].filter(Boolean).join(' '))}</div></div>
        <div class="actions">
          <select id="status" style="width:auto">${options(m.statuses, e.status)}</select>
          ${e.in_list ? '<button id="toggle-list">Retirer de la liste</button>' : '<button class="primary" id="toggle-list">Ajouter à la liste</button>'}
          <button class="primary" id="prepare">Préparer une candidature</button>
        </div>
      </div>
      ${e.do_not_contact ? `<div class="alert bloquant"><b>Ne plus contacter.</b> Cet établissement est dans la liste d'opposition : aucun message ne peut lui être envoyé. <button class="sm" id="lift-opp">Lever l'opposition</button></div>` : ''}
      <div class="split">
        <div>
          <div class="card">
            <div class="card-head"><h2>Contacts et décideurs</h2>
              <div class="actions"><button class="sm" id="enrich" data-busy="Recherche…">${isLocal ? 'Rechercher les dirigeants (SIRENE)' : 'Rechercher les contacts (SIRENE + site officiel)'}</button><button class="sm" id="paste-site">Coller le texte du site</button><button class="sm" id="add-contact">+ Ajouter</button></div></div>
            <div id="enrich-report"></div>
            ${contacts.length ? `<div class="table-wrap"><table><thead><tr><th>Nom / fonction</th><th>E-mail</th><th>Fiabilité</th><th>Source</th><th></th></tr></thead><tbody>
              ${contacts.map((c) => `<tr>
                <td>${c.is_primary ? '<span class="badge primary" title="Contact principal">★</span> ' : ''}<b>${esc([c.civility, c.first_name, c.last_name].filter(Boolean).join(' ') || '—')}</b><div class="small muted">${esc(c.role || m.roles[c.role_category] || '')}</div></td>
                <td class="small">${c.email ? `${esc(c.email)}<div>${badge(c.email_status, EMAIL_STATUS)}${c.mx_ok === 1 ? ' <span class="badge" title="Le domaine possède un serveur de messagerie">MX ✓</span>' : c.mx_ok === 0 ? ' <span class="badge danger">sans MX</span>' : ''}</div>` : '<span class="muted">pas d\'e-mail</span>'}</td>
                <td>${c.email ? reliability(c.reliability) : '—'}</td>
                <td class="small">${esc(c.source || '')}${c.source_url ? `<div>${link(c.source_url, 'voir la source')}</div>` : ''}<div class="muted">${fmtDate(c.collected_at)}</div>${c.notes ? `<div class="muted" title="${esc(c.notes)}">${esc(c.notes.slice(0, 80))}${c.notes.length > 80 ? '…' : ''}</div>` : ''}</td>
                <td class="nowrap"><button class="sm ghost" data-edit="${c.id}">Modifier</button>${c.email ? `<button class="sm ghost" data-check="${c.id}" title="Contrôler le domaine de messagerie">Contrôler</button>` : ''}${!c.is_primary && c.email ? `<button class="sm ghost" data-primary="${c.id}">Principal</button>` : ''}<button class="sm ghost" data-del-contact="${c.id}">✕</button></td></tr>`).join('')}
            </tbody></table></div>` : '<p class="muted">Aucun contact. Lancez la recherche de contacts ou ajoutez-en un manuellement.</p>'}
            ${e.generic_email || e.contact_form_url ? `<div class="small" style="margin-top:10px">${e.generic_email ? `Adresse générique : <b>${esc(e.generic_email)}</b>` : ''}${e.contact_form_url ? ` · Formulaire officiel : ${link(e.contact_form_url, 'ouvrir')}` : ''}</div>` : ''}
            <p class="small muted" style="margin-top:10px">Aucune adresse n'est devinée ou inventée : seules les adresses publiées par une source identifiée ou saisies par vous apparaissent ici.</p>
          </div>

          <div class="card">
            <div class="card-head"><h2>Accroche personnalisée</h2></div>
            <p class="small muted">Phrase insérée via la variable <code>{{accroche}}</code>. Elle doit reposer sur un fait vérifiable (sélectionnez un signal ci-dessous ou rédigez-la vous-même).</p>
            <div class="field"><textarea id="hook" rows="2" placeholder="ex. J'ai vu que votre hôtel de 85 chambres vient d'achever sa rénovation et développe son activité séminaires.">${esc(e.hook || '')}</textarea></div>
            <div class="row between"><input type="url" id="hook-source" placeholder="Source de l'information (URL)" value="${esc(e.hook_source || '')}" style="max-width:420px"><button class="sm primary" id="save-hook">Enregistrer l'accroche</button></div>
            <div class="hr"></div>
            <h3>Signaux publics détectés</h3>
            <p class="small muted">Un signal (recrutement, ouverture, rénovation…) indique une opportunité possible, <b>pas</b> la preuve qu'un poste est vacant.</p>
            ${(e.signals || []).length ? e.signals.map((s, i) => `<div class="signal"><div class="row between"><b>${esc(s.label)}</b><span><button class="sm ghost" data-use-signal="${i}">Utiliser comme base</button><button class="sm ghost" data-del-signal="${i}">✕</button></span></div>
              <div>« ${esc(s.snippet)} »</div><div class="small muted">${s.url ? link(s.url, 'source') : 'saisie manuelle'} · ${fmtDate(s.collected_at)}</div></div>`).join('') : '<p class="muted small">Aucun signal. L\'analyse du site officiel en détecte automatiquement.</p>'}
            <button class="sm" id="add-signal">+ Ajouter une information vérifiée</button>
          </div>

          <div class="card"><h2>Candidatures</h2>
            ${messages.length ? `<table><thead><tr><th>Date</th><th>Type</th><th>Destinataire</th><th>Statut</th><th>Résultat</th><th></th></tr></thead><tbody>
              ${messages.map((x) => `<tr><td class="small nowrap">${fmtDate(x.sent_at || x.created_at, true)}</td><td class="small">${x.kind === 'relance' ? 'Relance' : 'Initiale'}<div class="muted">${esc(x.template_name || '')}</div></td><td class="small">${esc(x.to_email || '—')}</td><td>${badge(x.status, statuses.messages)}</td><td>${badge(x.outcome, statuses.outcomes)}</td>
                <td>${['a_valider', 'brouillon', 'erreur', 'validee'].includes(x.status) ? `<a class="btn sm" href="#/validation?id=${x.id}">Ouvrir</a>` : `<a class="btn sm" href="#/historique?id=${x.id}">Détails</a>`}</td></tr>`).join('')}
            </tbody></table>` : '<p class="muted small">Aucune candidature pour cet établissement.</p>'}
          </div>

          <div class="card"><h2>Historique des actions</h2>
            <ul class="timeline">${events.map((ev) => `<li><span class="muted small">${fmtDate(ev.created_at, true)}</span> — ${esc(ACTION_LABELS[ev.action] || ev.action)}${ev.details?.to ? ` → ${esc(ev.details.to)}` : ''}${ev.details?.from && ev.action === 'statut' ? ` : ${esc(m.statuses[ev.details.from] || ev.details.from)} → ${esc(m.statuses[ev.details.to] || ev.details.to)}` : ''}${ev.details?.champs ? ` (${esc(ev.details.champs.join(', '))})` : ''}</li>`).join('') || '<li class="muted">—</li>'}</ul>
          </div>
        </div>

        <div>
          <div class="card"><div class="card-head"><h2>Score : ${e.score ?? '—'}/100</h2><button class="sm ghost" id="rescore">Recalculer</button></div>
            ${(e.score_details || []).map((r) => `<div class="reason"><div>${esc(r.text)}<div class="bar"><div style="width:${r.max ? (r.points / r.max) * 100 : 0}%"></div></div></div><div class="pts">${r.points}/${r.max}</div></div>`).join('')}
          </div>
          <div class="card"><div class="card-head"><h2>Informations</h2><button class="sm" id="edit-info">Modifier</button></div>
            <div class="kv">
              <div>Site web</div><div>${e.website ? link(e.website) : '<span class="muted">inconnu</span>'}</div>
              <div>Téléphone</div><div>${esc(e.phone || '—')}</div>
              <div>Type</div><div>${esc(m.types[e.type] || '—')}</div>
              <div>Groupe / enseigne</div><div>${esc(e.group_name || e.brand || '—')}</div>
              <div>Étoiles</div><div>${e.stars ? '★'.repeat(e.stars) : '—'}</div>
              <div>Chambres</div><div>${e.rooms ?? '—'}</div>
              <div>Effectif</div><div>${esc(m.headcount[e.headcount_range] || '—')}</div>
              <div>Établissements</div><div>${e.sites_count ?? '—'}</div>
              <div>Raison sociale</div><div>${esc(e.legal_name || '—')}</div>
              <div>SIRET</div><div>${e.siret ? `<a href="https://annuaire-entreprises.data.gouv.fr/etablissement/${esc(e.siret)}" target="_blank" rel="noopener">${esc(e.siret)}</a>` : '—'}</div>
              <div>Code NAF</div><div>${esc(e.naf || '—')}</div>
              <div>Distance</div><div>${e.distance_km != null ? `${e.distance_km} km` : '—'}</div>
            </div></div>
          <div class="card"><h2>Suivi</h2>
            <div class="field"><label>Prochaine action</label><input type="text" id="next-action" value="${esc(e.next_action || '')}" placeholder="ex. Appeler le standard"></div>
            <div class="field"><label>Date</label><input type="date" id="next-action-at" value="${esc((e.next_action_at || '').slice(0, 10))}"></div>
            <div class="field"><label>Notes</label><textarea id="notes" rows="4">${esc(e.notes || '')}</textarea></div>
            <button class="sm primary" id="save-follow">Enregistrer</button>
          </div>
          <div class="card"><h2>Sources</h2>
            ${sources.map((s) => `<div class="small" style="margin-bottom:6px"><b>${esc(s.source)}</b>${s.url ? ` · ${link(s.url, 'voir')}` : ''}<div class="muted">Collecté le ${fmtDate(s.collected_at, true)}${s.license ? ` · ${esc(s.license)}` : ''}${s.match_confidence ? ` · rapprochement ${Math.round(s.match_confidence * 100)} %` : ''}</div></div>`).join('') || '<p class="muted small">—</p>'}
            ${opposition.length ? `<div class="hr"></div><h3>Opposition</h3>${opposition.map((o) => `<div class="small">${esc(o.email || o.domain || 'Établissement')} — ${esc(o.reason || '')}</div>`).join('')}` : ''}
          </div>
          <div class="card"><h2>Données</h2>
            <div class="stack"><button class="sm danger" id="dnc">${e.do_not_contact ? 'Opposition active' : 'Ne plus contacter (opposition)'}</button>
            <button class="sm danger" id="delete">Supprimer cet établissement et ses données</button></div></div>
        </div>
      </div>`;
    bind(e, contacts);
  }

  function bind(e, contacts) {
    current = { e, contacts };
    const $ = (s) => el.querySelector(s);
    $('#status').addEventListener('change', async (ev) => {
      try { await api.patch(`/api/establishments/${id}`, { status: ev.target.value }); toast('Statut mis à jour', 'success'); load(); } catch (err) { toastError(err); }
    });
    $('#toggle-list').addEventListener('click', async () => { await api.patch(`/api/establishments/${id}`, { in_list: !e.in_list }); load(); });
    $('#prepare').addEventListener('click', () => { sessionStorage.setItem('campaign_ids', JSON.stringify([id])); location.hash = '#/campagnes?new=1'; });
    $('#lift-opp')?.addEventListener('click', async () => {
      if (!(await confirmDialog('Lever l\'opposition', 'Confirmez-vous que cet établissement peut à nouveau être contacté ? Ne le faites que si la personne concernée l\'a explicitement accepté.'))) return;
      await api.patch(`/api/establishments/${id}`, { do_not_contact: false, status: 'identifie' }); load();
    });
    $('#enrich').addEventListener('click', (ev) => withBusy(ev.currentTarget, async () => {
      try {
        const r = await api.post(`/api/establishments/${id}/enrich`, { steps: ['sirene', 'website', 'hunter', 'mx'] });
        await load();
        el.querySelector('#enrich-report').innerHTML = Object.entries(r.steps).filter(([, s]) => !(isLocal && s.manual)).map(([k, s]) => `<div class="alert ${s.ok ? 'info' : 'attention'}"><b>${{ sirene: 'SIRENE / RNE', website: 'Site officiel', hunter: 'Hunter.io', mx: 'Contrôle MX' }[k]}</b> : ${esc(s.message)}</div>`).join('');
      } catch (err) { toastError(err); }
    }));
    openContact = (c) => modal({
      title: c ? 'Modifier le contact' : 'Ajouter un contact',
      body: contactForm(c || {}, m.roles),
      foot: '<button data-close>Annuler</button><button class="primary" id="save-contact">Enregistrer</button>',
      onMount: (mEl, close) => mEl.querySelector('#save-contact').addEventListener('click', async () => {
        const data = formData(mEl.querySelector('#contact-form'));
        try {
          if (c) await api.patch(`/api/contacts/${c.id}`, data);
          else await api.post(`/api/establishments/${id}/contacts`, { ...data, source: 'Saisie manuelle' });
          close(); load();
        } catch (err) { toastError(err); }
      }),
    });
    $('#add-contact').addEventListener('click', () => openContact(null));
    $('#paste-site').addEventListener('click', () => modal({
      title: 'Coller le texte du site officiel',
      wide: true,
      body: `<ol class="small" style="padding-left:18px;margin-top:0">
          <li>Ouvrez le site${e.website ? ` (${link(e.website)})` : ''} et allez sur la page <b>Contact</b>, <b>Mentions légales</b> ou <b>Recrutement</b>.</li>
          <li>Sélectionnez tout le texte de la page (Ctrl + A), copiez-le (Ctrl + C) et collez-le ci-dessous (Ctrl + V).</li>
          <li>Prospecto en extrait les adresses e-mail, les noms cités (directeur de la publication, gérant…) et les signaux (recrutement, rénovation…).</li></ol>
        <div class="field"><label for="paste-url">Adresse de la page copiée</label><input type="url" id="paste-url" placeholder="https://…/mentions-legales" value="${esc(e.website || '')}"></div>
        <div class="field"><label for="paste-text">Texte de la page</label><textarea id="paste-text" rows="10" placeholder="Collez ici le texte de la page…"></textarea></div>
        <div id="paste-result"></div>`,
      foot: '<button data-close>Fermer</button><button class="primary" id="paste-go">Analyser le texte</button>',
      onMount: (mEl) => mEl.querySelector('#paste-go').addEventListener('click', async () => {
        try {
          const r = await api.post(`/api/establishments/${id}/paste-site`, { text: mEl.querySelector('#paste-text').value, url: mEl.querySelector('#paste-url').value.trim() });
          mEl.querySelector('#paste-result').innerHTML = `<div class="alert success">${r.emails} adresse(s), ${r.people} personne(s) citée(s), ${r.signals} signal(aux) trouvé(s). Vous pouvez coller une autre page ou fermer.</div>`;
          mEl.querySelector('#paste-text').value = '';
          load();
        } catch (err) { toastError(err); }
      }),
    }));
    $('#save-hook').addEventListener('click', async () => {
      await api.patch(`/api/establishments/${id}`, { hook: $('#hook').value.trim(), hook_source: $('#hook-source').value.trim() }).catch(toastError);
      toast('Accroche enregistrée. Les messages déjà préparés peuvent être régénérés depuis l\'écran de validation.', 'success');
    });
    $('#add-signal').addEventListener('click', () => modal({
      title: 'Ajouter une information vérifiée',
      body: `<div class="field"><label>Type</label><select id="sig-kind">${options({ manuel: 'Information générale', recrutement: 'Recrutement', ouverture: 'Ouverture', renovation: 'Rénovation', groupe: 'Groupe', capacite: 'Capacité' }, 'manuel')}</select></div>
        <div class="field"><label>Information</label><textarea id="sig-text" rows="3" placeholder="Fait vérifiable, tel que lu dans la source"></textarea></div>
        <div class="field"><label>Source (URL)</label><input type="url" id="sig-url"></div>`,
      foot: '<button data-close>Annuler</button><button class="primary" id="sig-save">Ajouter</button>',
      onMount: (mEl, close) => mEl.querySelector('#sig-save').addEventListener('click', async () => {
        const kind = mEl.querySelector('#sig-kind');
        await api.post(`/api/establishments/${id}/signals`, { kind: kind.value, label: kind.selectedOptions[0].text, snippet: mEl.querySelector('#sig-text').value.trim(), url: mEl.querySelector('#sig-url').value.trim() }).catch(toastError);
        close(); load();
      }),
    }));
    $('#rescore').addEventListener('click', async () => { await api.post('/api/establishments/bulk', { ids: [id], action: 'rescore' }); load(); });
    $('#save-follow').addEventListener('click', async () => {
      await api.patch(`/api/establishments/${id}`, { next_action: $('#next-action').value, next_action_at: $('#next-action-at').value, notes: $('#notes').value }).catch(toastError);
      toast('Enregistré', 'success');
    });
    $('#edit-info').addEventListener('click', () => modal({
      title: 'Modifier les informations',
      wide: true,
      body: `<form id="info-form" class="form-grid">
        <div class="field full"><label>Nom</label><input type="text" name="name" value="${esc(e.name)}"></div>
        <div class="field"><label>Type</label><select name="type">${options(m.types, e.type)}</select></div>
        <div class="field"><label>Site web officiel</label><input type="url" name="website" value="${esc(e.website || '')}"></div>
        <div class="field full"><label>Adresse</label><input type="text" name="address" value="${esc(e.address || '')}"></div>
        <div class="field"><label>Code postal</label><input type="text" name="postcode" value="${esc(e.postcode || '')}"></div>
        <div class="field"><label>Ville</label><input type="text" name="city" value="${esc(e.city || '')}"></div>
        <div class="field"><label>Téléphone</label><input type="text" name="phone" value="${esc(e.phone || '')}"></div>
        <div class="field"><label>Adresse e-mail générique</label><input type="email" name="generic_email" value="${esc(e.generic_email || '')}"></div>
        <div class="field"><label>Formulaire de contact (URL)</label><input type="url" name="contact_form_url" value="${esc(e.contact_form_url || '')}"></div>
        <div class="field"><label>Groupe</label><input type="text" name="group_name" value="${esc(e.group_name || '')}"></div>
        <div class="field"><label>Étoiles</label><input type="number" name="stars" min="0" max="5" value="${esc(e.stars ?? '')}"></div>
        <div class="field"><label>Chambres</label><input type="number" name="rooms" min="0" value="${esc(e.rooms ?? '')}"></div>
        <div class="field"><label>Nombre d'établissements</label><input type="number" name="sites_count" min="0" value="${esc(e.sites_count ?? '')}"></div>
        <div class="field"><label>Tranche d'effectif</label><select name="headcount_range">${options(m.headcount, e.headcount_range || '', { empty: '—' })}</select></div>
        <div class="field"><label>SIRET</label><input type="text" name="siret" value="${esc(e.siret || '')}"></div>
      </form>`,
      foot: '<button data-close>Annuler</button><button class="primary" id="save-info">Enregistrer</button>',
      onMount: (mEl, close) => mEl.querySelector('#save-info').addEventListener('click', async () => {
        try { await api.patch(`/api/establishments/${id}`, formData(mEl.querySelector('#info-form'))); close(); load(); } catch (err) { toastError(err); }
      }),
    }));
    $('#dnc').addEventListener('click', async () => {
      if (e.do_not_contact) return;
      if (!(await confirmDialog('Ne plus contacter', 'L\'établissement sera ajouté à la liste d\'opposition et tous ses messages non envoyés seront annulés.', { danger: true, okLabel: 'Confirmer' }))) return;
      await api.patch(`/api/establishments/${id}`, { status: 'ne_plus_contacter', reason: 'Décision manuelle' }); load();
    });
    $('#delete').addEventListener('click', async () => {
      if (!(await confirmDialog('Supprimer', 'Supprimer définitivement cet établissement, ses contacts, ses messages et son historique ? (La liste d\'opposition est conservée.)', { danger: true, okLabel: 'Supprimer' }))) return;
      await api.del(`/api/establishments/${id}`);
      location.hash = '#/prospects';
    });
  }

  function bindOnce() {
    const $ = (s) => el.querySelector(s);
    on(el, 'click', '[data-edit]', (ev, b) => openContact(current.contacts.find((c) => c.id === Number(b.dataset.edit))));
    on(el, 'click', '[data-check]', async (ev, b) => {
      try {
        const r = await api.post(`/api/contacts/${b.dataset.check}/check`, { hunter: true });
        toast(r.mx === 1 ? 'Le domaine accepte les e-mails (enregistrement MX présent). Cela ne garantit pas que la boîte existe.' : r.mx === 0 ? 'Aucun serveur de messagerie pour ce domaine : adresse marquée invalide.' : 'Contrôle impossible (réseau).', r.mx === 0 ? 'error' : 'info', 7000);
        load();
      } catch (err) { toastError(err); }
    });
    on(el, 'click', '[data-primary]', async (ev, b) => { await api.post(`/api/contacts/${b.dataset.primary}/primary`); load(); });
    on(el, 'click', '[data-del-contact]', async (ev, b) => {
      if (await confirmDialog('Supprimer le contact', 'Supprimer ce contact ?', { danger: true, okLabel: 'Supprimer' })) { await api.del(`/api/contacts/${b.dataset.delContact}`); load(); }
    });
    on(el, 'click', '[data-use-signal]', (ev, b) => {
      const s = current.e.signals[Number(b.dataset.useSignal)];
      $('#hook').value = `J'ai lu sur votre site : « ${s.snippet.slice(0, 180)} »`;
      $('#hook-source').value = s.url || '';
      $('#hook').focus();
      toast('Reformulez la phrase avec vos mots avant de l\'enregistrer.', 'info');
    });
    on(el, 'click', '[data-del-signal]', async (ev, b) => { await api.del(`/api/establishments/${id}/signals/${b.dataset.delSignal}`); load(); });
  }

  bindOnce();
  await load();
}
