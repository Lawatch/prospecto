// « Serveur » de la version en ligne : le même code que la version installée (routes, services, SQL),
// exécuté dans la page. La base SQLite (WebAssembly) est enregistrée dans le navigateur.
import { configureSqlite } from './shims/sqlite.js';
import { createRouter } from './shims/express.js';
import { readFileSync } from './shims/fs.js';
import { openDb, getDb, run } from '../server/db.js';
import { seedTemplates } from '../server/seed.js';
import { prospectRoutes } from '../server/routes/prospects.js';
import { messagingRoutes } from '../server/routes/messaging.js';
import { adminRoutes } from '../server/routes/admin.js';
import { jobRoutes } from '../server/routes/jobs.js';
import { startQueueWorker } from '../server/services/mailer.js';
import { getSetting, patchSetting } from '../server/settings.js';
import { dailyBackupIfNeeded, setBackupIndex, listBackups } from './backup.js';
import { loadBytes, saveBytes, listKeys } from './storage.js';
import { storeGmailToken } from './oauth.js';

let saveTimer = null;
let dirty = false;
let frozen = false;
let chain = Promise.resolve();
let lastSavedAt = null;

function scheduleSave() {
  if (frozen) return;
  dirty = true;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flush, 300);
}

export function flush() {
  if (!dirty || frozen) return chain;
  dirty = false;
  const bytes = getDb().export();
  chain = chain.then(() => saveBytes(bytes)).then(() => { lastSavedAt = new Date().toISOString(); }).catch((e) => console.error('Enregistrement impossible', e));
  return chain;
}

export const ready = (async () => {
  if (typeof globalThis.initSqlJs !== 'function') throw new Error('Le moteur de base de données ne s\'est pas chargé (fichier vendor/sqljs/sql-wasm.js).');
  const base = new URL('vendor/sqljs/', document.baseURI).href;
  const SQL = await globalThis.initSqlJs({ locateFile: (f) => base + f });
  const bytes = await loadBytes();
  configureSqlite({ sqlModule: SQL, bytes, onChange: scheduleSave });
  openDb();
  seedTemplates();
  if (getSetting('sending').provider === 'aucun') patchSetting('sending', { provider: 'gmail_web' });
  run("UPDATE messages SET status = 'erreur', error = 'Envoi interrompu (page fermée) : résultat incertain, vérifiez le dossier « Envoyés » avant tout nouvel essai.' WHERE status = 'envoi_en_cours' AND coalesce(provider, '') NOT IN ('gmail_web','outlook_web','outlook_pro_web','mailto')");
  setBackupIndex(await listKeys());
  dailyBackupIfNeeded();
  startQueueWorker();
  addEventListener('pagehide', () => flush());
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });
  await flush();
})();

const app = createRouter();
app.get('/api/health', (req, res) => res.json({ ok: true, app: 'prospecto', local: true }));
app.get('/api/auth/state', (req, res) => res.json({ setup_needed: false, authenticated: true, local: true }));
app.post('/api/auth/logout', (req, res) => res.json({ ok: true }));
app.post('/api/oauth/gmail/token', (req, res) => { storeGmailToken(req.body || {}); res.json({ ok: true }); });
app.get('/api/local/info', async (req, res) => {
  let persisted = null;
  let estimate = null;
  try { persisted = await navigator.storage?.persisted?.(); estimate = await navigator.storage?.estimate?.(); } catch { /* indisponible */ }
  res.json({ persisted, usage: estimate?.usage ?? null, quota: estimate?.quota ?? null, last_saved_at: lastSavedAt, last_download: getSetting('_local')?.last_download || null, backups: listBackups() });
});
prospectRoutes(app);
messagingRoutes(app);
adminRoutes(app);
jobRoutes(app);

const MIME = { pdf: 'application/pdf', doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', odt: 'application/vnd.oasis.opendocument.text', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg' };

export async function handle(method, url, body, headers = {}) {
  await ready;
  if (body instanceof Blob) body = new Uint8Array(await body.arrayBuffer());
  const r = await app.handle(method, url, body, headers);
  if (r.file) {
    const bytes = readFileSync(r.file);
    r.body = new Blob([bytes], { type: MIME[r.file.split('.').pop().toLowerCase()] || 'application/octet-stream' });
  }
  return r;
}

// Sauvegarde complète téléchargeable (fichier .sqlite) et restauration.
export async function exportDatabaseFile() {
  await ready;
  await flush();
  patchSetting('_local', { last_download: new Date().toISOString() });
  await flush();
  return getDb().export();
}

export async function importDatabaseFile(bytes) {
  await ready;
  const head = new TextDecoder().decode(bytes.subarray(0, 15));
  if (head !== 'SQLite format 3') throw new Error('Ce fichier n\'est pas une sauvegarde Prospecto.');
  frozen = true;
  clearTimeout(saveTimer);
  await chain;
  await saveBytes(bytes);
}
