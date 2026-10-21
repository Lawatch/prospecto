import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

export const APP_ROOT = path.resolve(here, '..');
export const DATA_DIR = path.resolve(process.env.PROSPECTO_DATA || path.join(APP_ROOT, 'data'));
export const DB_PATH = path.join(DATA_DIR, 'prospecto.sqlite');
export const UPLOAD_DIR = path.join(DATA_DIR, 'pieces-jointes');
export const BACKUP_DIR = path.join(DATA_DIR, 'sauvegardes');
export const KEY_PATH = path.join(DATA_DIR, 'cle-locale.key');
export const PORT = Number(process.env.PROSPECTO_PORT || 3737);
// Le serveur n'écoute que sur la machine locale : il n'est pas joignable depuis le réseau.
export const HOST = '127.0.0.1';
export const BASE_URL = `http://${HOST}:${PORT}`;
export const USER_AGENT = 'Prospecto/0.1 (outil personnel de candidature; contact: voir parametres)';

for (const dir of [DATA_DIR, UPLOAD_DIR, BACKUP_DIR]) fs.mkdirSync(dir, { recursive: true });
