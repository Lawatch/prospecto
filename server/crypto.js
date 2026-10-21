import crypto from 'node:crypto';
import fs from 'node:fs';
import { KEY_PATH } from './config.js';
import { get, run, now } from './db.js';

// Clé AES-256 propre à cette installation, générée au premier lancement et stockée hors base.
// Les jetons OAuth, clés d'API et mots de passe SMTP sont chiffrés avec elle (AES-256-GCM) :
// une copie de la base seule ne permet pas de les relire.
let key;
function getKey() {
  if (key) return key;
  if (!fs.existsSync(KEY_PATH)) {
    fs.writeFileSync(KEY_PATH, crypto.randomBytes(32).toString('base64'), { mode: 0o600 });
  }
  key = Buffer.from(fs.readFileSync(KEY_PATH, 'utf8').trim(), 'base64');
  return key;
}

export function encrypt(plain) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getKey(), iv);
  const data = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map((b) => b.toString('base64')).join('.');
}

export function decrypt(payload) {
  const [iv, tag, data] = payload.split('.').map((s) => Buffer.from(s, 'base64'));
  const decipher = crypto.createDecipheriv('aes-256-gcm', getKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

export function setSecret(name, value) {
  if (value == null || value === '') {
    run('DELETE FROM secrets WHERE key = ?', name);
    return;
  }
  const stored = encrypt(typeof value === 'string' ? value : JSON.stringify(value));
  run('INSERT INTO secrets (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at',
    name, stored, now());
}

export function getSecret(name, { json = false } = {}) {
  const row = get('SELECT value FROM secrets WHERE key = ?', name);
  if (!row) return null;
  try {
    const plain = decrypt(row.value);
    return json ? JSON.parse(plain) : plain;
  } catch {
    return null;
  }
}

export function hasSecret(name) {
  return !!get('SELECT 1 AS x FROM secrets WHERE key = ?', name);
}

export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function verifyPassword(password, stored) {
  const [algo, salt, hash] = String(stored || '').split('$');
  if (algo !== 'scrypt') return false;
  const expected = Buffer.from(hash, 'base64');
  const actual = crypto.scryptSync(password, Buffer.from(salt, 'base64'), expected.length);
  return crypto.timingSafeEqual(expected, actual);
}

export const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
export const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');
