// Version navigateur de server/crypto.js. Les clés d'API éventuelles sont rangées dans la base locale du
// navigateur (profil de l'utilisateur) ; elles ne figurent jamais dans les exports JSON.
import { get, run, now } from '../server/db.js';

export function setSecret(name, value) {
  if (value == null || value === '') {
    run('DELETE FROM secrets WHERE key = ?', name);
    return;
  }
  const stored = typeof value === 'string' ? value : JSON.stringify(value);
  run('INSERT INTO secrets (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at', name, stored, now());
}

export function getSecret(name, { json = false } = {}) {
  const row = get('SELECT value FROM secrets WHERE key = ?', name);
  if (!row) return null;
  try { return json ? JSON.parse(row.value) : row.value; } catch { return null; }
}

export function hasSecret(name) {
  return !!get('SELECT 1 AS x FROM secrets WHERE key = ?', name);
}

export const encrypt = (s) => s;
export const decrypt = (s) => s;
export const randomToken = (bytes = 32) => {
  const a = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...a)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
export const sha256 = () => { throw new Error('indisponible'); };
export const hashPassword = () => { throw new Error('indisponible'); };
export const verifyPassword = () => false;
