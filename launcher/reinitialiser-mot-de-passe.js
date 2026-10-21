// Supprime le mot de passe de l'application (les données sont conservées) :
// au prochain lancement, Prospecto proposera d'en choisir un nouveau.
import { openDb, run } from '../server/db.js';

openDb();
run("DELETE FROM settings WHERE key = '_auth'");
run('DELETE FROM sessions');
console.log('Mot de passe réinitialisé. Ouvrez Prospecto pour en choisir un nouveau.');
