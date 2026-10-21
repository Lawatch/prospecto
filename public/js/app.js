import { api } from './api.js';
import { esc, on, toastError } from './ui.js';

const ROUTES = [
  { path: '', label: 'Tableau de bord', icon: '◧', load: () => import('./pages/dashboard.js') },
  { path: 'recherche', label: 'Recherche', icon: '⌖', load: () => import('./pages/search.js') },
  { path: 'prospects', label: 'Prospects', icon: '☰', load: () => import('./pages/prospects.js') },
  { path: 'prospects/:id', nav: false, load: () => import('./pages/prospect.js') },
  { path: 'templates', label: 'Templates', icon: '✎', load: () => import('./pages/templates.js') },
  { path: 'campagnes', label: 'Campagnes', icon: '⚑', load: () => import('./pages/campaigns.js') },
  { path: 'validation', label: 'Validation', icon: '✓', count: 'to_validate', load: () => import('./pages/review.js') },
  { path: 'historique', label: 'Historique', icon: '⏱', load: () => import('./pages/history.js') },
  { path: 'relances', label: 'Relances', icon: '↻', count: 'followups_due', load: () => import('./pages/followups.js') },
  { path: 'statistiques', label: 'Statistiques', icon: '▤', load: () => import('./pages/stats.js') },
  { path: 'parametres', label: 'Paramètres', icon: '⚙', load: () => import('./pages/settings.js') },
];

const app = document.getElementById('app');
let cleanup = null;
let counts = {};

function parseHash() {
  const raw = location.hash.replace(/^#\/?/, '');
  const [pathPart, queryPart = ''] = raw.split('?');
  const query = Object.fromEntries(new URLSearchParams(queryPart));
  const segs = pathPart.split('/').filter(Boolean);
  for (const r of ROUTES) {
    const rs = r.path.split('/').filter(Boolean);
    if (rs.length !== segs.length) continue;
    const params = {};
    if (rs.every((s, i) => (s.startsWith(':') ? ((params[s.slice(1)] = decodeURIComponent(segs[i])), true) : s === segs[i]))) return { route: r, params, query };
  }
  return { route: ROUTES[0], params: {}, query };
}

export function navigate(hash) {
  if (location.hash === hash) render();
  else location.hash = hash;
}

function layout() {
  app.innerHTML = `
  <div class="layout">
    <aside class="sidebar">
      <div class="brand"><img src="/favicon.svg" alt=""> Prospecto</div>
      <nav class="nav" id="nav"></nav>
      <div class="sidebar-foot">
        <div id="send-status" class="small"></div>
        <button class="sm ghost" id="logout" style="color:#8a92a6">Se déconnecter</button>
      </div>
    </aside>
    <div class="main">
      <header class="topbar">
        <div class="quick"><input type="search" id="quick" placeholder="Rechercher un prospect (nom, ville, groupe)…" autocomplete="off"><div class="quick-results" id="quick-results" hidden></div></div>
        <div class="spacer"></div>
        <a class="btn sm" href="#/recherche">+ Nouvelle recherche</a>
        <a class="btn sm primary" href="#/validation">Valider les e-mails</a>
      </header>
      <main class="content" id="page"></main>
    </div>
  </div>`;
  document.getElementById('logout').addEventListener('click', async () => {
    await api.post('/api/auth/logout');
    location.hash = '';
    boot();
  });
  const quick = document.getElementById('quick');
  const results = document.getElementById('quick-results');
  let t;
  quick.addEventListener('input', () => {
    clearTimeout(t);
    t = setTimeout(async () => {
      const q = quick.value.trim();
      if (q.length < 2) { results.hidden = true; return; }
      const { rows } = await api.get(`/api/establishments?q=${encodeURIComponent(q)}&limit=12&sort=score`);
      results.innerHTML = rows.length ? rows.map((r) => `<a href="#/prospects/${r.id}"><b>${esc(r.name)}</b> <span class="muted small">${esc(r.city || '')}${r.in_list ? ' · dans la liste' : ''}</span></a>`).join('') : '<div class="muted small" style="padding:10px">Aucun résultat</div>';
      results.hidden = false;
    }, 200);
  });
  on(results, 'click', 'a', () => { results.hidden = true; quick.value = ''; });
  document.addEventListener('click', (e) => { if (!e.target.closest('.quick')) results.hidden = true; });
}

function renderNav(current) {
  const nav = document.getElementById('nav');
  if (!nav) return;
  nav.innerHTML = ROUTES.filter((r) => r.nav !== false).map((r, i) => {
    const active = current === r || (r.path === 'prospects' && current.path === 'prospects/:id');
    const c = r.count && counts[r.count] ? `<span class="count">${counts[r.count]}</span>` : '';
    const sep = i === 3 || i === 7 ? '<div class="sep"></div>' : '';
    return `${sep}<a href="#/${r.path}" class="${active ? 'active' : ''}"><span>${r.icon} &nbsp;${r.label}</span>${c}</a>`;
  }).join('');
}

export async function refreshCounts() {
  try {
    const d = await api.get('/api/dashboard');
    counts = d.todo;
    const s = d.sending;
    const el = document.getElementById('send-status');
    if (el) {
      el.innerHTML = s.account
        ? `Envoi : <b style="color:#fff">${esc(s.account)}</b><br>${s.sent_today}/${s.daily_cap} aujourd'hui${s.queue_running ? ` · <span style="color:#7ee2b8">file active (${s.queued})</span>` : ''}`
        : '<span style="color:#f7b267">Aucune messagerie connectée</span>';
    }
    renderNav(parseHash().route);
  } catch { /* hors ligne ou session expirée */ }
}

async function render() {
  if (cleanup) { try { cleanup(); } catch { /* ignore */ } cleanup = null; }
  const { route, params, query } = parseHash();
  renderNav(route);
  // Nouvel élément à chaque navigation : les écouteurs délégués d'une page ne survivent pas à la suivante.
  const old = document.getElementById('page');
  if (!old) return;
  const page = old.cloneNode(false);
  old.replaceWith(page);
  page.innerHTML = '<div class="loading"><span class="spinner"></span> Chargement…</div>';
  window.scrollTo(0, 0);
  try {
    const mod = await route.load();
    cleanup = (await mod.default(page, { params, query, refreshCounts })) || null;
  } catch (err) {
    page.innerHTML = `<div class="card"><h2>Erreur</h2><p>${esc(err.message)}</p></div>`;
    if (err.status !== 401) toastError(err);
  }
}

function authScreen(setupNeeded) {
  app.innerHTML = `
  <div class="auth"><div class="card">
    <div class="brand" style="color:var(--text);padding:0 0 12px"><img src="/favicon.svg" alt=""> Prospecto</div>
    <h2>${setupNeeded ? 'Bienvenue ! Créez votre mot de passe' : 'Connexion'}</h2>
    <p class="muted small">${setupNeeded ? 'Il protège l\'accès à vos données sur cet ordinateur. Vous resterez connecté 30 jours.' : 'Vos données restent sur cet ordinateur.'}</p>
    <form id="auth-form">
      <div class="field"><label for="pw">Mot de passe</label><input type="password" id="pw" required minlength="${setupNeeded ? 8 : 1}" autocomplete="${setupNeeded ? 'new-password' : 'current-password'}" autofocus></div>
      ${setupNeeded ? '<div class="field"><label for="pw2">Confirmation</label><input type="password" id="pw2" required minlength="8" autocomplete="new-password"></div>' : ''}
      <div id="auth-error" class="alert bloquant" hidden></div>
      <button class="primary lg" style="width:100%">${setupNeeded ? 'Créer et ouvrir' : 'Se connecter'}</button>
    </form>
  </div></div>`;
  document.getElementById('auth-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const pw = document.getElementById('pw').value;
    const err = document.getElementById('auth-error');
    try {
      if (setupNeeded) {
        if (pw !== document.getElementById('pw2').value) throw new Error('Les deux mots de passe ne correspondent pas.');
        await api.post('/api/auth/setup', { password: pw });
      } else {
        await api.post('/api/auth/login', { password: pw });
      }
      boot();
    } catch (ex) {
      err.textContent = ex.message;
      err.hidden = false;
    }
  });
}

let booted = false;
async function boot() {
  const state = await api.get('/api/auth/state');
  if (!state.authenticated) return authScreen(state.setup_needed);
  layout();
  if (!booted) {
    window.addEventListener('hashchange', render);
    window.addEventListener('auth-required', () => boot());
    setInterval(refreshCounts, 30000);
    booted = true;
  }
  await refreshCounts();
  render();
}

boot().catch((err) => { app.innerHTML = `<div class="auth"><div class="card"><h2>Prospecto ne répond pas</h2><p>${esc(err.message)}</p></div></div>`; });
