// Version navigateur de server/services/backup.js : instantanés de la base gardés dans le navigateur.
import { saveBytes, deleteKey } from './storage.js';
import { exportBytes } from './runtime.js';

const KEEP = 7;
let index = [];

export function setBackupIndex(keys) {
  index = keys.filter((k) => String(k).startsWith('sauvegarde-')).sort().reverse().map((k) => ({ file: k, size: null }));
}

export function backupNow(label = 'auto') {
  const name = `sauvegarde-${new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19)}-${label}`;
  const bytes = exportBytes();
  index.unshift({ file: name, size: bytes.length });
  saveBytes(bytes, name).catch((e) => console.error('Sauvegarde impossible', e));
  for (const old of index.splice(KEEP)) deleteKey(old.file).catch(() => {});
  return name;
}

export function listBackups() {
  return index;
}

export function dailyBackupIfNeeded() {
  const today = new Date().toISOString().slice(0, 10);
  if (!index.some((b) => b.file.includes(today))) return backupNow('auto');
  return null;
}
