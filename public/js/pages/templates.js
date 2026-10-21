import { api, meta } from '../api.js';
import { confirmDialog, esc, on, options, toast, toastError } from '../ui.js';

export default async function templates(el) {
  const m = await meta();
  const [variables, attachments] = await Promise.all([api.get('/api/variables'), api.get('/api/attachments')]);
  let list = [];
  let current = null;
  const prospects = (await api.get('/api/establishments?in_list=1&limit=50&sort=score')).rows;

  async function load(selectId) {
    list = await api.get('/api/templates');
    current = list.find((t) => t.id === (selectId ?? current?.id)) || list[0] || null;
    draw();
  }

  function draw() {
    el.innerHTML = `
      <div class="page-head"><div><h1>Templates d'e-mails</h1><div class="sub">Variables remplacées automatiquement à partir de la fiche prospect et de votre profil central.</div></div>
        <div class="actions"><button id="new">+ Nouveau modèle</button></div></div>
      <div class="grid" style="grid-template-columns:280px minmax(0,1fr) 360px;align-items:start">
        <div class="card" style="padding:8px">
          ${list.map((t) => `<a href="#" data-pick="${t.id}" style="display:block;padding:8px 10px;border-radius:7px;color:var(--text);${current?.id === t.id ? 'background:var(--primary-soft)' : ''}">
            <b>${esc(t.name)}</b><div class="small muted">${esc(m.categories[t.category] || t.category)}${t.kind === 'relance' ? ' · relance' : ''} · ${t.sent_count} envoi(s)${t.sent_count ? `, ${Math.round((t.reply_count / t.sent_count) * 100)} % de réponses` : ''}</div></a>`).join('') || '<p class="muted small" style="padding:8px">Aucun modèle</p>'}
        </div>
        <div>${current ? editor(current) : '<div class="card empty">Créez votre premier modèle.</div>'}</div>
        <div>
          <div class="card"><h2>Aperçu</h2>
            <div class="field"><select id="preview-est">${options(Object.fromEntries(prospects.map((p) => [p.id, p.name])), prospects[0]?.id, { empty: prospects.length ? undefined : 'Exemple fictif' })}</select></div>
            <div id="preview" class="small"></div></div>
          <div class="card"><h2>Variables</h2><p class="small muted">Cliquez pour insérer. <code>{{#variable}}…{{/variable}}</code> n'affiche le bloc que si la variable est renseignée ; <code>{{^variable}}…{{/variable}}</code> seulement si elle est vide.</p>
            ${Object.entries(variables).map(([k, v]) => `<button class="var-chip" data-var="${k}" title="${esc(v)}">{{${k}}}</button>`).join('')}</div>
        </div>
      </div>`;
    if (current) preview();
  }

  function editor(t) {
    return `<div class="card"><form id="tpl-form">
      <div class="form-grid">
        <div class="field"><label>Nom</label><input type="text" name="name" value="${esc(t.name)}" required></div>
        <div class="field"><label>Catégorie (poste visé)</label><select name="category">${options(m.categories, t.category)}</select></div>
        <div class="field"><label>Usage</label><select name="kind">${options({ initial: 'Candidature initiale', relance: 'Relance' }, t.kind)}</select></div>
        <div class="field"><label class="inline" style="margin-top:26px"><input type="checkbox" name="use_signature" ${t.use_signature ? 'checked' : ''}> Ajouter ma signature</label></div>
      </div>
      <div class="field"><label>Types d'établissement ciblés <span class="muted">(aucun = tous)</span></label><div class="checks">
        ${Object.entries(m.types).filter(([k]) => k !== 'autre').map(([k, v]) => `<label><input type="checkbox" name="target_types" value="${k}" ${t.target_types.includes(k) ? 'checked' : ''}> ${esc(v)}</label>`).join('')}</div>
        <div class="help">Lors d'une campagne en sélection automatique, le modèle de la catégorie visée correspondant au type de l'établissement est choisi en priorité.</div></div>
      <div class="field"><label>Objet</label><input type="text" name="subject" value="${esc(t.subject)}" required data-target></div>
      <div class="field"><label>Corps du message</label><textarea name="body" class="body-editor" required data-target>${esc(t.body)}</textarea></div>
      <div class="field"><label>Pièces jointes de ce modèle <span class="muted">(aucune = pièces jointes par défaut)</span></label><div class="checks">
        ${attachments.map((a) => `<label><input type="checkbox" name="attachment_ids" value="${a.id}" ${t.attachment_ids.includes(a.id) ? 'checked' : ''}> ${esc(a.label)}${a.is_default ? ' <span class="muted small">(défaut)</span>' : ''}</label>`).join('') || '<span class="muted small">Aucune. <a href="#/parametres?tab=pieces">Ajouter mon CV</a></span>'}</div></div>
      <div class="row between"><button type="button" class="danger sm" id="del">Supprimer</button><div class="actions"><button type="button" id="dup">Dupliquer</button><button class="primary">Enregistrer</button></div></div>
    </form></div>`;
  }

  function collect() {
    const f = el.querySelector('#tpl-form');
    return {
      name: f.name.value, category: f.category.value, kind: f.kind.value, subject: f.subject.value, body: f.body.value, use_signature: f.use_signature.checked,
      target_types: [...f.querySelectorAll('[name=target_types]:checked')].map((c) => c.value),
      attachment_ids: [...f.querySelectorAll('[name=attachment_ids]:checked')].map((c) => Number(c.value)),
    };
  }

  let pt;
  async function preview() {
    const f = el.querySelector('#tpl-form');
    if (!f) return;
    const sel = el.querySelector('#preview-est');
    const r = await api.post('/api/templates/preview', { subject: f.subject.value, body: f.body.value, establishment_id: sel?.value || null, use_signature: f.use_signature.checked });
    el.querySelector('#preview').innerHTML = `
      ${r.sample ? '<div class="alert info">Aperçu avec un établissement fictif (aucun prospect dans la liste).</div>' : ''}
      ${r.unknown.length ? `<div class="alert bloquant">Variables inconnues : ${r.unknown.map(esc).join(', ')}</div>` : ''}
      ${r.missing.length ? `<div class="alert attention">Variables vides pour ce prospect : ${r.missing.map(esc).join(', ')}</div>` : ''}
      <div><b>Objet :</b> ${esc(r.subject)}</div><div class="hr"></div><div class="pre">${esc(r.body)}</div>
      ${r.signature ? `<div class="signature-preview">${esc(r.signature)}</div>` : ''}`;
  }

  let lastFocus = null;
  el.addEventListener('focusin', (e) => { if (e.target.matches('[data-target]')) lastFocus = e.target; });
  el.addEventListener('input', (e) => { if (e.target.closest('#tpl-form')) { clearTimeout(pt); pt = setTimeout(preview, 300); } });
  on(el, 'change', '#preview-est', preview);
  on(el, 'click', '[data-pick]', (e, a) => { e.preventDefault(); current = list.find((t) => t.id === Number(a.dataset.pick)); draw(); });
  on(el, 'click', '[data-var]', (e, b) => {
    const target = lastFocus || el.querySelector('#tpl-form [name=body]');
    if (!target) return;
    const tag = `{{${b.dataset.var}}}`;
    const s = target.selectionStart ?? target.value.length;
    target.value = target.value.slice(0, s) + tag + target.value.slice(target.selectionEnd ?? s);
    target.focus();
    target.selectionStart = target.selectionEnd = s + tag.length;
    preview();
  });
  on(el, 'submit', '#tpl-form', async (e) => {
    e.preventDefault();
    try { await api.patch(`/api/templates/${current.id}`, collect()); toast('Modèle enregistré', 'success'); load(); } catch (err) { toastError(err); }
  });
  on(el, 'click', '#dup', async () => {
    const t = await api.post('/api/templates', { ...collect(), name: `${current.name} (copie)` });
    load(t.id);
  });
  on(el, 'click', '#del', async () => {
    if (!(await confirmDialog('Supprimer le modèle', 'Un modèle déjà utilisé sera archivé (l\'historique reste lisible).', { danger: true, okLabel: 'Supprimer' }))) return;
    await api.del(`/api/templates/${current.id}`);
    current = null;
    load();
  });
  on(el, 'click', '#new', async () => {
    const t = await api.post('/api/templates', { name: 'Nouveau modèle', category: 'generale', subject: 'Candidature spontanée – {{entreprise}}', body: '{{salutation}}\n\n{{ma_presentation}}\n\nBien cordialement,' });
    load(t.id);
  });

  await load();
}
