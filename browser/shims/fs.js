// Système de fichiers minimal pour la version navigateur : les fichiers (pièces jointes)
// sont stockés dans la base SQLite elle-même, table `vfs`.
import { get, run, all, getDb } from '../../server/db.js';

let ready = false;
function ensure() {
  if (ready) return;
  getDb().exec('CREATE TABLE IF NOT EXISTS vfs (path TEXT PRIMARY KEY, data BLOB NOT NULL, mtime TEXT NOT NULL)');
  ready = true;
}

const norm = (p) => String(p).replace(/\\/g, '/').replace(/\/+/g, '/');
const toBytes = (data) => (data instanceof Uint8Array ? data : new TextEncoder().encode(String(data)));

function withText(bytes) {
  // Comme un Buffer : `toString()` rend le texte.
  bytes.toString = (enc) => (enc === 'base64' ? btoa(Array.from(bytes, (b) => String.fromCharCode(b)).join('')) : new TextDecoder().decode(bytes));
  return bytes;
}

export function existsSync(p) {
  ensure();
  const n = norm(p);
  return !!get('SELECT 1 AS x FROM vfs WHERE path = ? OR path LIKE ? LIMIT 1', n, n.replace(/\/$/, '') + '/%');
}

export function readFileSync(p, enc) {
  ensure();
  const row = get('SELECT data FROM vfs WHERE path = ?', norm(p));
  if (!row) throw Object.assign(new Error(`Fichier introuvable : ${p}`), { code: 'ENOENT' });
  const bytes = withText(new Uint8Array(row.data));
  return enc ? bytes.toString(enc) : bytes;
}

export function writeFileSync(p, data) {
  ensure();
  run('INSERT INTO vfs (path, data, mtime) VALUES (?, ?, ?) ON CONFLICT(path) DO UPDATE SET data = excluded.data, mtime = excluded.mtime', norm(p), toBytes(data), new Date().toISOString());
}

export function rmSync(p) {
  ensure();
  run('DELETE FROM vfs WHERE path = ?', norm(p));
}
export const unlinkSync = rmSync;

export function mkdirSync() {}

export function readdirSync(dir) {
  ensure();
  const prefix = norm(dir).replace(/\/$/, '') + '/';
  return all('SELECT path FROM vfs WHERE path LIKE ?', prefix + '%').map((r) => r.path.slice(prefix.length)).filter((n) => !n.includes('/'));
}

export function statSync(p) {
  ensure();
  const row = get('SELECT length(data) AS size, mtime FROM vfs WHERE path = ?', norm(p));
  if (!row) throw Object.assign(new Error(`Fichier introuvable : ${p}`), { code: 'ENOENT' });
  return { size: row.size, mtime: new Date(row.mtime), isFile: () => true };
}

export default { existsSync, readFileSync, writeFileSync, rmSync, unlinkSync, mkdirSync, readdirSync, statSync };
