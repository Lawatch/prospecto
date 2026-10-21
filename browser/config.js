// Configuration de la version navigateur (remplace server/config.js à la compilation).
export const APP_ROOT = '';
export const DATA_DIR = '/donnees';
export const DB_PATH = ':memory:';
export const UPLOAD_DIR = '/donnees/pieces-jointes';
export const BACKUP_DIR = '/donnees/sauvegardes';
export const KEY_PATH = '/donnees/cle';
export const PORT = 0;
export const HOST = typeof location !== 'undefined' ? location.host : 'local';
export const BASE_URL = typeof location !== 'undefined' ? location.origin + location.pathname.replace(/[^/]*$/, '') : '';
export const USER_AGENT = 'Prospecto';
// Un navigateur n'autorise pas à fixer l'en-tête User-Agent ; l'ajouter déclencherait des requêtes de contrôle CORS.
export const UA_HEADERS = {};
// Les sites des établissements n'autorisent pas leur lecture depuis une autre page (CORS) : texte à copier-coller.
export const CAN_FETCH_SITES = false;
export const IS_BROWSER = true;
