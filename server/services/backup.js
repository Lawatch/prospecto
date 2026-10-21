import fs from 'node:fs';
import path from 'node:path';
import { BACKUP_DIR } from '../config.js';
import { getDb } from '../db.js';

const KEEP = 14;

// Sauvegarde cohérente de la base (VACUUM INTO) : une par jour au démarrage, plus à la demande.
export function backupNow(label = 'auto') {
  const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
  const file = path.join(BACKUP_DIR, `prospecto-${stamp}-${label}.sqlite`);
  getDb().exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  prune();
  return file;
}

export function listBackups() {
  return fs.readdirSync(BACKUP_DIR).filter((f) => f.endsWith('.sqlite')).sort().reverse()
    .map((f) => ({ file: f, size: fs.statSync(path.join(BACKUP_DIR, f)).size }));
}

function prune() {
  const files = fs.readdirSync(BACKUP_DIR).filter((f) => f.endsWith('.sqlite')).sort();
  for (const f of files.slice(0, Math.max(0, files.length - KEEP))) fs.unlinkSync(path.join(BACKUP_DIR, f));
}

export function dailyBackupIfNeeded() {
  const today = new Date().toISOString().slice(0, 10);
  if (!listBackups().some((b) => b.file.includes(today))) return backupNow('auto');
  return null;
}
