// Accès partagé à la base courante (export binaire) sans dépendance circulaire.
import { getDb } from '../server/db.js';

export function exportBytes() {
  return getDb().export();
}
