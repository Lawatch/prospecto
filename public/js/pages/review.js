import { api, meta } from '../api.js';
import { badge, confirmDialog, esc, fmtDate, link, on, reliability, scoreBadge, toast, toastError, warningsList, EMAIL_STATUS } from '../ui.js';

// Écran central de validation : un message à la fois, entièrement modifiable.
// Aucun envoi sans clic explicite sur « Envoyer cet e-mail » (ou validation individuelle pour la file).
export default async function review(el, { query, refreshCounts }) {
  const m = await meta();
  const statuses = await api.get('/api/meta/statuses');
  const [templates, allAttachments, campaigns, queue, composeProviders] = await Promise.all([api.get('/api/templates'), api.get('/api/attachments'), api.get('/api/campaigns'), api.get('/api/queue'), api.get('/api/compose-providers')]);
  // Mode « messagerie web » : l'e-mail s'ouvre pré-rempli dans Gmail/Outlook et c'est vous qui cliquez sur Envoyer.
  const composeMode = Object.hasOwn(composeProviders, queue.provider || '');
  const composeLabel = composeProviders[queue.provider] || '';
  let ids = [];
  let index = 0;
  let detail = null;
  let dirty = false;
  let lastResult = null;
  const campaignId = query.campaign || '';
  const includeDrafts = query.drafts === '1';

  async function loadQueue() {
    if (query.id) { ids = [Number(query.id)]; return; }
    const r = await api.get(`/api/review/queue?${new URLSearchParams({ ...(campaignId ? { campaign_id: campaignId } : {}), ...(includeDrafts ? { include_drafts: '1' } : {}) })}`);
    ids = r.ids;
  }

  async function show(i) {
    index = Math.max(0, Math.min(i, ids.length - 1));
    if (!ids.length) return drawEmpty();
    detail = await api.get(`/api/messages/${ids[index]}`);
    dirty = false;
    draw();
  }

  function drawEmpty() {
    el.innerHTML = `${header()}
      ${lastResult ? `<div class="alert ${lastResult.kind}">${esc(lastResult.text)}</div>` : ''}
      <div class="card empty"><h3>Aucun message en attente de validation</h3>
      <p>${campaignId ? 'Tous les messages de cette campagne ont été traités.' : 'Préparez une campagne pour générer des candidatures.'}</p>
      <div class="actions" style="justify-content:center"><a class="btn primary" href="#/campagnes?new=1">Préparer une campagne</a><a class="btn" href="#/historique">Voir l'historique</a>${queue.queued ? `<a class="btn" href="#/campagnes">${queue.queued} message(s) validé(s) dans la file d'envoi</a>` : ''}</div></div>`;
    bindHeader();
  }

  function header() {
    return `<div class="page-head"><div><h1>Validation des e-mails</h1><div class="sub">Relisez, corrigez puis envoyez chaque candidature. Rien n'est envoyé sans votre action.</div></div>
      <div class="actions">
        <select id="camp" style="width:auto"><option value="">Toutes les campagnes</option>${campaigns.map((c) => `<option value="${c.id}" ${String(c.id) === String(campaignId) ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select>
        <label class="inline small"><input type="checkbox" id="drafts" ${includeDrafts ? 'checked' : ''}> inclure les brouillons</label>
      </div></div>`;
  }

  function bindHeader() {
    el.querySelector('#camp')?.addEventListener('change', (e) => { location.hash = `#/validation?${new URLSearchParams({ ...(e.target.value ? { campaign: e.target.value } : {}), ...(includeDrafts ? { drafts: '1' } : {}) })}`; });
    el.querySelector('#drafts')?.addEventListener('change', (e) => { location.hash = `#/validation?${new URLSearchParams({ ...(campaignId ? { campaign: campaignId } : {}), ...(e.target.checked ? { drafts: '1' } : {}) })}`; });
  }

  function draw() {
    const { message: msg, establishment: e, contact, contacts, attachments, parent, campaign } = detail;
    const editable = ['a_valider', 'brouillon', 'validee', 'erreur'].includes(msg.status);
    const pendingCompose = msg.status === 'envoi_en_cours' && Object.hasOwn(composeProviders, msg.provider || '');
    const blocking = msg.warnings.filter((w) => w.level === 'bloquant');
    const used = msg.personalization?.used || {};
    const emailContacts = contacts.filter((c) => c.email);
    el.innerHTML = `${header()}
      ${lastResult ? `<div class="alert ${lastResult.kind}">${esc(lastResult.text)}</div>` : ''}
      <div class="row between" style="margin-bottom:10px">
        <div class="small"><b>Message ${index + 1} / ${ids.length}</b> · ${badge(msg.status, statuses.messages)} ${msg.kind === 'relance' ? '<span class="badge primary">Relance</span>' : ''} ${campaign ? `· ${esc(campaign.name)}` : ''}</div>
        <div class="actions"><button class="sm" id="prev" ${index === 0 ? 'disabled' : ''}>← Précédent</button><button class="sm" id="next" ${index >= ids.length - 1 ? 'disabled' : ''}>Passer au suivant →</button></div>
      </div>
      <div class="progress" style="margin-bottom:14px"><div style="width:${((index + 1) / ids.length) * 100}%"></div></div>
      <div class="review">
        <div class="mail">
          <div class="mail-head">
            <div class="mail-line"><span>Entreprise</span><div><a href="#/prospects/${e.id}"><b>${esc(e.name)}</b></a> ${scoreBadge(e.score)} <span class="muted small">${esc(m.types[e.type] || '')} · ${esc(e.city || '')}</span></div></div>
            <div class="mail-line"><span>Destinataire</span><div class="row" style="gap:6px">
              ${emailContacts.length ? `<select id="contact" style="max-width:300px" ${editable ? '' : 'disabled'}><option value="">— Saisie libre —</option>${emailContacts.map((c) => `<option value="${c.id}" ${c.id === msg.contact_id ? 'selected' : ''}>${esc([c.first_name, c.last_name].filter(Boolean).join(' ') || m.roles[c.role_category] || 'Contact')} · ${esc(c.email)}</option>`).join('')}</select>` : ''}
              <input type="email" id="to_email" value="${esc(msg.to_email || '')}" placeholder="adresse@etablissement.fr" style="flex:1;min-width:220px" ${editable ? '' : 'disabled'}></div></div>
            <div class="mail-line"><span>Nom / fonction</span><div class="row" style="gap:6px"><input type="text" id="to_name" value="${esc(msg.to_name || '')}" placeholder="Nom du destinataire (facultatif)" style="flex:1" ${editable ? '' : 'disabled'}><input type="text" id="to_role" value="${esc(msg.to_role || '')}" placeholder="Fonction" style="flex:1" ${editable ? '' : 'disabled'}></div></div>
            <div class="mail-line"><span>Objet</span><input type="text" id="subject" value="${esc(msg.subject || '')}" ${editable ? '' : 'disabled'}></div>
          </div>
          <div class="mail-body">
            <textarea id="body" class="body-editor" ${editable ? '' : 'disabled'}>${esc(msg.body || '')}</textarea>
            <details style="margin-top:10px" open><summary class="small" style="cursor:pointer">Signature</summary>
              <textarea id="signature" rows="5" style="margin-top:6px" ${editable ? '' : 'disabled'}>${esc(msg.signature || '')}</textarea></details>
            <div style="margin-top:12px"><div class="small muted" style="margin-bottom:4px">Pièces jointes</div><div class="checks">
              ${allAttachments.map((a) => `<label><input type="checkbox" data-att="${a.id}" ${msg.attachment_ids.includes(a.id) ? 'checked' : ''} ${editable ? '' : 'disabled'}> ${esc(a.label)} <span class="muted small">(${Math.round(a.size / 1024)} Ko)</span></label>`).join('') || '<span class="small muted">Aucune pièce jointe enregistrée. <a href="#/parametres?tab=pieces">Ajouter mon CV</a></span>'}
            </div></div>
          </div>
          ${composeMode && editable && attachments.length ? `<div class="alert attention" style="margin:0 18px 12px"><b>Pièces jointes :</b> votre messagerie ne peut pas les recevoir automatiquement. Après ouverture du brouillon, joignez-y ${attachments.map((a) => `<a href="/api/attachments/${a.id}/file" data-filename="${esc(a.filename)}">${esc(a.filename)}</a>`).join(', ')} (cliquez pour l'enregistrer d'abord), ou mettez plutôt un lien vers votre CV dans votre profil.</div>` : ''}
          <div class="review-bar">
            ${pendingCompose ? `
              <div style="flex:1;min-width:260px"><b>Brouillon ouvert dans ${esc(composeProviders[msg.provider])}.</b><div class="small">Vérifiez-le, cliquez sur « Envoyer » dans votre messagerie, puis confirmez ici.</div></div>
              <button class="success lg" id="confirm-sent">J'ai envoyé cet e-mail</button>
              <button id="reopen">Rouvrir le brouillon</button>
              <button class="danger" id="cancel-compose">Je ne l'ai pas envoyé</button>` : editable ? `
              <button class="success lg" id="send" ${blocking.length ? 'disabled title="Corrigez les points bloquants"' : ''} ${composeMode ? `title="S'ouvre pré-rempli dans ${esc(composeLabel)}"` : ''}>Envoyer cet e-mail</button>
              ${composeMode ? '' : msg.status === 'validee' ? '<button id="unvalidate">Retirer de la file</button>' : `<button id="validate" ${blocking.length ? 'disabled' : ''} title="Le message partira avec la file d'envoi, que vous lancez depuis Campagnes">Valider pour la file</button>`}
              <button id="edit">Modifier</button>
              <button id="save" ${dirty ? '' : 'disabled'}>Enregistrer</button>
              <button id="draft">Enregistrer comme brouillon</button>
              <button class="danger" id="ignore">Ignorer ce prospect</button>
              <span class="spacer" style="flex:1"></span>
              <button id="skip">Passer au suivant →</button>
              ${composeMode ? `<div class="small muted" style="width:100%">« Envoyer » ouvre l'e-mail pré-rempli dans ${esc(composeLabel)} : c'est vous qui cliquez sur Envoyer, puis vous confirmez ici.</div>` : ''}` : `<div class="small">Ce message est « ${esc(statuses.messages[msg.status])} » et ne peut plus être modifié.</div><span style="flex:1"></span><button id="skip">Passer au suivant →</button>`}
          </div>
        </div>
        <div>
          <div class="card"><h2>Contrôles</h2><div id="warnings">${warningsList(msg.warnings)}</div>${msg.error ? `<div class="alert bloquant"><b>Dernière erreur :</b> ${esc(msg.error)}</div>` : ''}</div>
          <div class="card"><h2>Destinataire</h2>
            ${contact ? `<div class="kv"><div>Contact</div><div>${esc([contact.civility, contact.first_name, contact.last_name].filter(Boolean).join(' ') || '—')}</div>
              <div>Fonction</div><div>${esc(contact.role || m.roles[contact.role_category] || '—')}</div>
              <div>Adresse</div><div>${badge(contact.email_status, EMAIL_STATUS)}</div>
              <div>Fiabilité</div><div>${reliability(contact.reliability)}</div>
              <div>Source</div><div class="small">${esc(contact.source || '—')}${contact.source_url ? ` · ${link(contact.source_url, 'voir')}` : ''}<div class="muted">${fmtDate(contact.collected_at)}</div></div></div>`
              : '<p class="small muted">Adresse sans contact associé (saisie libre ou adresse générique de la fiche).</p>'}
            <div class="small" style="margin-top:8px"><a href="#/prospects/${e.id}">Corriger les contacts sur la fiche →</a></div>
          </div>
          <div class="card"><h2>Personnalisation</h2>
            <div class="field"><label>Modèle utilisé</label><div class="row" style="gap:6px"><select id="tpl" style="flex:1" ${editable ? '' : 'disabled'}>${templates.filter((t) => t.kind === msg.kind).map((t) => `<option value="${t.id}" ${t.id === msg.template_id ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select>${editable ? '<button class="sm" id="regen" title="Recompose le message à partir du modèle et des données à jour (vos modifications seront remplacées)">Régénérer</button>' : ''}</div></div>
            <div class="small muted" style="margin-bottom:6px">Informations insérées :</div>
            ${Object.entries(used).filter(([k]) => !['ma_presentation', 'mes_realisations', 'mes_competences'].includes(k)).map(([k, v]) => `<div class="used-var"><b>${esc(k)}</b> : ${esc(String(v).slice(0, 160))}</div>`).join('') || '<div class="small muted">—</div>'}
            ${used.accroche && e.hook_source ? `<div class="small" style="margin-top:6px">Source de l'accroche : ${link(e.hook_source, 'voir')}</div>` : ''}
            ${msg.personalization?.missing?.length ? `<div class="small" style="margin-top:6px;color:var(--warning)">Vides : ${msg.personalization.missing.map(esc).join(', ')}</div>` : ''}
          </div>
          ${parent ? `<div class="card"><h2>Message initial</h2><div class="small muted">Envoyé le ${fmtDate(parent.sent_at, true)}</div><div class="small"><b>${esc(parent.subject)}</b></div><div class="small pre" style="max-height:180px;overflow:auto">${esc(parent.body)}</div></div>` : ''}
          <div class="card"><h2>Établissement</h2><div class="kv"><div>Site</div><div>${e.website ? link(e.website) : '—'}</div><div>Groupe</div><div>${esc(e.group_name || '—')}</div><div>Taille</div><div>${esc([e.rooms ? `${e.rooms} chambres` : '', m.headcount[e.headcount_range] || ''].filter(Boolean).join(' · ') || '—')}</div></div>
            ${(e.signals || []).slice(0, 3).map((s) => `<div class="signal small"><b>${esc(s.label)}</b> — « ${esc(s.snippet.slice(0, 140))} »</div>`).join('')}</div>
        </div>
      </div>`;
    bindHeader();
    bind();
  }

  function collect() {
    return {
      to_email: el.querySelector('#to_email').value.trim(),
      to_name: el.querySelector('#to_name').value.trim() || null,
      to_role: el.querySelector('#to_role').value.trim() || null,
      subject: el.querySelector('#subject').value,
      body: el.querySelector('#body').value,
      signature: el.querySelector('#signature').value,
      attachment_ids: [...el.querySelectorAll('[data-att]:checked')].map((c) => Number(c.dataset.att)),
    };
  }

  async function saveIfDirty() {
    if (!dirty) return detail;
    detail = await api.patch(`/api/messages/${detail.message.id}`, collect());
    dirty = false;
    return detail;
  }

  function advance(result) {
    lastResult = result;
    ids.splice(index, 1);
    refreshCounts();
    if (!ids.length) return drawEmpty();
    show(Math.min(index, ids.length - 1));
  }

  function bind() {
    const $ = (s) => el.querySelector(s);
    $('#prev')?.addEventListener('click', async () => { await saveIfDirty().catch(toastError); lastResult = null; show(index - 1); });
    const next = async () => { await saveIfDirty().catch(toastError); lastResult = null; if (index < ids.length - 1) show(index + 1); else toast('Dernier message de la liste'); };
    $('#next')?.addEventListener('click', next);
    $('#skip')?.addEventListener('click', next);
    for (const sel of ['#to_email', '#to_name', '#to_role', '#subject', '#body', '#signature']) {
      $(sel)?.addEventListener('input', () => { dirty = true; const s = $('#save'); if (s) s.disabled = false; });
    }
    el.querySelectorAll('[data-att]').forEach((cb) => cb.addEventListener('change', () => { dirty = true; $('#save').disabled = false; }));
    $('#to_email')?.addEventListener('change', async () => { await saveIfDirty().catch(toastError); draw(); });
    $('#contact')?.addEventListener('change', async (ev) => {
      try {
        const c = detail.contacts.find((x) => x.id === Number(ev.target.value));
        await saveIfDirty();
        detail = await api.patch(`/api/messages/${detail.message.id}`, c ? { contact_id: c.id, to_email: c.email, to_role: c.role || null, to_name: c.role_category !== 'generique' ? [c.first_name, c.last_name].filter(Boolean).join(' ') || null : null } : { contact_id: null });
        draw();
        toast('Destinataire modifié. Pensez à « Régénérer » si la formule d\'appel doit changer.', 'info', 6000);
      } catch (err) { toastError(err); }
    });
    $('#save')?.addEventListener('click', async () => { try { await saveIfDirty(); draw(); toast('Modifications enregistrées', 'success'); } catch (err) { toastError(err); } });
    $('#edit')?.addEventListener('click', () => { const b = $('#body'); b.focus(); b.setSelectionRange(0, 0); b.scrollIntoView({ behavior: 'smooth', block: 'center' }); });
    $('#regen')?.addEventListener('click', async () => {
      if (dirty && !(await confirmDialog('Régénérer', 'Vos modifications manuelles seront remplacées par le contenu du modèle. Continuer ?'))) return;
      try { detail = await api.post(`/api/messages/${detail.message.id}/regenerate`, { template_id: Number($('#tpl').value) }); dirty = false; draw(); } catch (err) { toastError(err); }
    });
    const openDraft = (url) => {
      if (url.startsWith('mailto:')) { location.href = url; return true; }
      const w = window.open(url, '_blank');
      if (w) { try { w.opener = null; } catch { /* sans effet */ } return true; }
      lastResult = { kind: 'attention', text: 'Votre navigateur a bloqué l\'ouverture d\'un nouvel onglet. Cliquez sur « Rouvrir le brouillon ».' };
      return false;
    };
    $('#send')?.addEventListener('click', async (ev) => {
      if (composeMode) {
        try {
          await saveIfDirty();
          if (detail.message.warnings.some((w) => w.level === 'bloquant')) { draw(); return toastError(new Error('Corrigez d\'abord les points bloquants.')); }
          const r = await api.post(`/api/messages/${detail.message.id}/compose`);
          lastResult = null;
          openDraft(r.url);
          await show(index);
        } catch (err) { lastResult = { kind: 'bloquant', text: err.message }; show(index); }
        return;
      }
      try {
        await saveIfDirty();
        const blocking = detail.message.warnings.filter((w) => w.level === 'bloquant');
        if (blocking.length) { draw(); return toastError(new Error('Corrigez d\'abord les points bloquants.')); }
        const msg = detail.message;
        const warn = detail.message.warnings.filter((w) => w.level === 'attention');
        const ok = await confirmDialog('Envoyer cette candidature ?', `À <b>${esc(msg.to_email)}</b>${msg.to_name ? ` (${esc(msg.to_name)})` : ''}<br>Objet : « ${esc(msg.subject)} »<br>${msg.attachment_ids.length} pièce(s) jointe(s)${warn.length ? `<br><br><span style="color:var(--warning)">${warn.length} point(s) à vérifier : ${warn.map((w) => esc(w.text)).join(' ; ')}</span>` : ''}`, { okLabel: 'Envoyer maintenant' });
        if (!ok) return;
        ev.target.disabled = true;
        ev.target.innerHTML = '<span class="spinner"></span> Envoi…';
        try {
          await api.post(`/api/messages/${msg.id}/send`);
        } catch (err) {
          if (err.data?.needs_confirmation && (await confirmDialog('Résultat précédent incertain', 'Le précédent essai a peut-être abouti. Avez-vous vérifié dans votre dossier « Envoyés » que ce message n\'est pas déjà parti ?', { okLabel: 'Oui, renvoyer' }))) {
            await api.post(`/api/messages/${msg.id}/send`, { confirm_uncertain: true });
          } else throw err;
        }
        advance({ kind: 'success', text: `✓ Envoyé à ${msg.to_email} (${detail.establishment.name}).` });
      } catch (err) {
        if (err.status === 502 && err.data?.message) {
          detail.message = err.data.message;
          lastResult = { kind: 'bloquant', text: `Échec de l'envoi : ${err.data.error}` };
          draw();
        } else {
          lastResult = { kind: 'bloquant', text: err.message };
          show(index);
        }
      }
    });
    $('#confirm-sent')?.addEventListener('click', async () => {
      try { await api.post(`/api/messages/${detail.message.id}/confirm-sent`); advance({ kind: 'success', text: `✓ Envoi confirmé pour ${detail.establishment.name} (${detail.message.to_email}).` }); } catch (err) { toastError(err); }
    });
    $('#reopen')?.addEventListener('click', async () => {
      try { const r = await api.post(`/api/messages/${detail.message.id}/compose`); lastResult = null; openDraft(r.url); draw(); } catch (err) { toastError(err); }
    });
    $('#cancel-compose')?.addEventListener('click', async () => {
      try { await api.post(`/api/messages/${detail.message.id}/cancel-compose`); lastResult = { kind: 'info', text: 'Envoi annulé : le message reste à valider.' }; show(index); } catch (err) { toastError(err); }
    });
    $('#validate')?.addEventListener('click', async () => {
      try { await saveIfDirty(); await api.post(`/api/messages/${detail.message.id}/validate`); advance({ kind: 'success', text: `✓ « ${detail.establishment.name} » validé : il partira avec la file d'envoi (à lancer depuis Campagnes).` }); } catch (err) { toastError(err); show(index); }
    });
    $('#unvalidate')?.addEventListener('click', async () => { detail = await api.post(`/api/messages/${detail.message.id}/unvalidate`); draw(); });
    $('#draft')?.addEventListener('click', async () => {
      try { await saveIfDirty(); await api.post(`/api/messages/${detail.message.id}/draft`); advance({ kind: 'info', text: `Brouillon enregistré pour ${detail.establishment.name}.` }); } catch (err) { toastError(err); }
    });
    $('#ignore')?.addEventListener('click', async () => {
      let dnc = false;
      const track = (ev) => { if (ev.target.id === 'ign-dnc') dnc = ev.target.checked; };
      document.addEventListener('change', track);
      const ok = await confirmDialog('Ignorer ce prospect', `Le message pour « ${esc(detail.establishment.name)} » ne sera pas envoyé.<br><br><label class="inline"><input type="checkbox" id="ign-dnc"> Ne plus jamais contacter cet établissement (liste d'opposition)</label>`, { okLabel: 'Ignorer' });
      document.removeEventListener('change', track);
      if (!ok) return;
      try { await api.post(`/api/messages/${detail.message.id}/ignore`, { do_not_contact: !!dnc }); advance({ kind: 'info', text: `Prospect « ${detail.establishment.name} » ignoré.` }); } catch (err) { toastError(err); }
    });
  }

  const onKey = (e) => {
    if (e.target.matches('input, textarea, select')) return;
    if (e.key === 'ArrowRight') el.querySelector('#next')?.click();
    if (e.key === 'ArrowLeft') el.querySelector('#prev')?.click();
  };
  document.addEventListener('keydown', onKey);
  const beforeUnload = (e) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } };
  window.addEventListener('beforeunload', beforeUnload);

  await loadQueue();
  await show(0);
  return () => { document.removeEventListener('keydown', onKey); window.removeEventListener('beforeunload', beforeUnload); };
}
