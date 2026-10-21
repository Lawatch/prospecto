export function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Les liens issus de sources externes ne sont rendus cliquables que s'ils sont en http(s).
export function safeUrl(url) {
  return /^https?:\/\//i.test(String(url || '')) ? esc(url) : '#';
}

export function link(url, text) {
  if (!url) return '';
  return `<a href="${safeUrl(url)}" target="_blank" rel="noopener noreferrer">${esc(text || url.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, ''))}</a>`;
}

export function toast(message, kind = 'info', ms = 4500) {
  const box = document.getElementById('toasts');
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = message;
  box.appendChild(el);
  setTimeout(() => el.remove(), ms);
}

export function toastError(err) {
  toast(err?.message || String(err), 'error', 7000);
}

export function fmtDate(iso, withTime = false) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return withTime ? d.toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : d.toLocaleDateString('fr-FR');
}

export function scoreBadge(score) {
  if (score == null) return '<span class="score low">—</span>';
  const cls = score >= 65 ? 'high' : score >= 45 ? 'mid' : 'low';
  return `<span class="score ${cls}" title="Score de priorité">${score}</span>`;
}

export function reliability(r) {
  if (r == null || r === 0) return '<span class="rel low">—</span>';
  const cls = r >= 80 ? 'high' : r >= 55 ? 'mid' : 'low';
  const label = r >= 80 ? 'Élevée' : r >= 55 ? 'Moyenne' : 'Faible';
  return `<span class="rel ${cls}" title="Fiabilité ${r}/100">${label} · ${r}</span>`;
}

const STATUS_KIND = {
  identifie: '', contact_a_verifier: 'warning', a_preparer: 'primary', en_attente: 'warning', validee: 'primary', envoyee: 'success',
  erreur: 'danger', reponse: 'success', entretien: 'success', refus: 'danger', relance: 'warning', ne_plus_contacter: 'danger',
  a_valider: 'warning', brouillon: '', envoi_en_cours: 'primary', ignoree: '',
  aucune: '', reponse_a_qualifier: 'warning', reponse_positive: 'success', reponse_neutre: '', reponse_negative: 'danger', adresse_invalide: 'danger',
  verifiee: 'success', publiee: 'primary', non_verifiee: 'warning', invalide: 'danger',
};

export function badge(code, labels) {
  return `<span class="badge ${STATUS_KIND[code] ?? ''}">${esc(labels?.[code] || code)}</span>`;
}

export const EMAIL_STATUS = { verifiee: 'Vérifiée', publiee: 'Publiée (source publique)', non_verifiee: 'Non vérifiée', invalide: 'Invalide' };

export function modal({ title, body, foot = '', wide = false, onMount }) {
  const back = document.createElement('div');
  back.className = 'modal-back';
  back.innerHTML = `<div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true">
    <div class="modal-head"><h2 style="margin:0">${esc(title)}</h2><button class="ghost sm" data-close aria-label="Fermer">✕</button></div>
    <div class="modal-body">${body}</div>${foot ? `<div class="modal-foot">${foot}</div>` : ''}</div>`;
  const close = () => { back.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  back.addEventListener('click', (e) => { if (e.target === back || e.target.closest('[data-close]')) close(); });
  document.addEventListener('keydown', onKey);
  document.body.appendChild(back);
  onMount?.(back.querySelector('.modal'), close);
  return { el: back.querySelector('.modal'), close };
}

export function confirmDialog(title, text, { okLabel = 'Confirmer', danger = false } = {}) {
  return new Promise((resolve) => {
    let done = false;
    const m = modal({
      title,
      body: `<p>${text}</p>`,
      foot: `<button data-close>Annuler</button><button class="${danger ? 'danger' : 'primary'}" data-ok>${esc(okLabel)}</button>`,
      onMount: (el, close) => {
        el.querySelector('[data-ok]').addEventListener('click', () => { done = true; close(); resolve(true); });
        el.querySelector('[data-ok]').focus();
      },
    });
    const obs = new MutationObserver(() => { if (!document.body.contains(m.el)) { obs.disconnect(); if (!done) resolve(false); } });
    obs.observe(document.body, { childList: true });
  });
}

export function formData(form) {
  const out = {};
  for (const el of form.querySelectorAll('[name]')) {
    if (el.type === 'checkbox') {
      if (el.dataset.multi !== undefined) { out[el.name] = out[el.name] || []; if (el.checked) out[el.name].push(el.value); }
      else out[el.name] = el.checked;
    } else if (el.type === 'radio') { if (el.checked) out[el.name] = el.value; }
    else out[el.name] = el.value;
  }
  return out;
}

export function options(map, selected, { empty } = {}) {
  return (empty !== undefined ? `<option value="">${esc(empty)}</option>` : '') +
    Object.entries(map).map(([k, v]) => `<option value="${esc(k)}" ${String(k) === String(selected ?? '') ? 'selected' : ''}>${esc(v)}</option>`).join('');
}

export async function withBusy(button, fn) {
  if (!button) return fn();
  const html = button.innerHTML;
  button.disabled = true;
  button.innerHTML = `<span class="spinner"></span> ${button.dataset.busy || 'Patientez…'}`;
  try { return await fn(); } finally { button.disabled = false; button.innerHTML = html; }
}

export function on(root, event, selector, handler) {
  root.addEventListener(event, (e) => {
    const target = e.target.closest(selector);
    if (target && root.contains(target)) handler(e, target);
  });
}

export function warningsList(warnings = []) {
  if (!warnings.length) return '<div class="alert success">Aucun avertissement : tous les contrôles sont passés.</div>';
  const order = { bloquant: 0, attention: 1, info: 2 };
  const label = { bloquant: 'Bloquant', attention: 'À vérifier', info: 'Info' };
  return [...warnings].sort((a, b) => order[a.level] - order[b.level])
    .map((w) => `<div class="alert ${w.level}"><b>${label[w.level]} ·</b> ${esc(w.text)}</div>`).join('');
}
