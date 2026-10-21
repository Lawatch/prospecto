import { get, run, now } from './db.js';
import { hashPassword, verifyPassword, randomToken, sha256 } from './crypto.js';
import { getSetting, setSetting } from './settings.js';

const COOKIE = 'prospecto_session';
const SESSION_DAYS = 30;
const attempts = new Map();

export function isSetupNeeded() {
  return !getSetting('_auth')?.password_hash;
}

function parseCookies(header = '') {
  return Object.fromEntries(header.split(';').map((c) => c.trim().split('=')).filter((p) => p[0]).map(([k, ...v]) => [k, decodeURIComponent(v.join('='))]));
}

export function sessionValid(req) {
  const token = parseCookies(req.headers.cookie)[COOKIE];
  if (!token) return false;
  const row = get('SELECT expires_at FROM sessions WHERE token_hash = ?', sha256(token));
  return !!row && row.expires_at > now();
}

function issueSession(res) {
  const token = randomToken();
  const expires = new Date(Date.now() + SESSION_DAYS * 86400_000);
  run('INSERT INTO sessions (token_hash, created_at, expires_at) VALUES (?, ?, ?)', sha256(token), now(), expires.toISOString());
  run('DELETE FROM sessions WHERE expires_at < ?', now());
  res.setHeader('Set-Cookie', `${COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_DAYS * 86400}`);
}

export function authRoutes(app) {
  app.get('/api/auth/state', (req, res) => {
    res.json({ setup_needed: isSetupNeeded(), authenticated: sessionValid(req) });
  });

  app.post('/api/auth/setup', (req, res) => {
    if (!isSetupNeeded()) return res.status(400).json({ error: 'Le mot de passe est déjà défini.' });
    const password = String(req.body?.password || '');
    if (password.length < 8) return res.status(400).json({ error: 'Choisissez un mot de passe d\'au moins 8 caractères.' });
    setSetting('_auth', { password_hash: hashPassword(password), created_at: now() });
    issueSession(res);
    res.json({ ok: true });
  });

  app.post('/api/auth/login', (req, res) => {
    const key = req.socket.remoteAddress || 'local';
    const a = attempts.get(key) || { n: 0, until: 0 };
    if (a.until > Date.now()) return res.status(429).json({ error: 'Trop de tentatives : patientez une minute.' });
    const auth = getSetting('_auth');
    if (!auth?.password_hash || !verifyPassword(String(req.body?.password || ''), auth.password_hash)) {
      a.n += 1;
      if (a.n >= 5) { a.until = Date.now() + 60_000; a.n = 0; }
      attempts.set(key, a);
      return res.status(401).json({ error: 'Mot de passe incorrect.' });
    }
    attempts.delete(key);
    issueSession(res);
    res.json({ ok: true });
  });

  app.post('/api/auth/logout', (req, res) => {
    const token = parseCookies(req.headers.cookie)[COOKIE];
    if (token) run('DELETE FROM sessions WHERE token_hash = ?', sha256(token));
    res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`);
    res.json({ ok: true });
  });

  app.post('/api/auth/password', (req, res) => {
    if (!sessionValid(req)) return res.status(401).json({ error: 'Non connecté' });
    const auth = getSetting('_auth');
    if (!verifyPassword(String(req.body?.current || ''), auth.password_hash)) return res.status(400).json({ error: 'Mot de passe actuel incorrect.' });
    const next = String(req.body?.password || '');
    if (next.length < 8) return res.status(400).json({ error: 'Au moins 8 caractères.' });
    setSetting('_auth', { ...auth, password_hash: hashPassword(next) });
    run('DELETE FROM sessions');
    issueSession(res);
    res.json({ ok: true });
  });
}

const OPEN_API = new Set(['/api/auth/state', '/api/auth/setup', '/api/auth/login', '/api/health']);

export function requireAuth(req, res, next) {
  const isApi = req.path.startsWith('/api/');
  const isOauth = req.path.startsWith('/oauth/');
  if (!isApi && !isOauth) return next();
  // Protection CSRF : toute requête de modification doit porter l'en-tête X-Prospecto,
  // qu'un site tiers ne peut pas ajouter sans autorisation CORS (jamais accordée ici).
  if (isApi && req.method !== 'GET' && req.headers['x-prospecto'] !== '1') return res.status(403).json({ error: 'Requête refusée (en-tête de sécurité manquant)' });
  if (OPEN_API.has(req.path)) return next();
  if (!sessionValid(req)) return isApi ? res.status(401).json({ error: 'Session expirée : reconnectez-vous.' }) : res.redirect('/');
  next();
}
