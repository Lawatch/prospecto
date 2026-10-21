import fs from 'node:fs';
import path from 'node:path';
import { openDb } from './db.js';
import { HOST, PORT, BASE_URL, DATA_DIR } from './config.js';
import { createApp, seedTemplates } from './app.js';
import { startQueueWorker } from './services/mailer.js';
import { dailyBackupIfNeeded } from './services/backup.js';
import { run } from './db.js';

openDb();
seedTemplates();
// Un envoi interrompu par un arrêt brutal ne doit jamais être relancé automatiquement.
run("UPDATE messages SET status = 'erreur', error = 'Envoi interrompu (arrêt de l''application) : résultat incertain, vérifiez le dossier « Envoyés » avant tout nouvel essai.' WHERE status = 'envoi_en_cours'");
try { dailyBackupIfNeeded(); } catch (err) { console.error('Sauvegarde automatique impossible :', err.message); }
setInterval(() => { try { dailyBackupIfNeeded(); } catch { /* réessai à l'heure suivante */ } }, 3600_000).unref();

const app = createApp();
const server = app.listen(PORT, HOST, () => {
  console.log(`Prospecto est prêt : ${BASE_URL}`);
  console.log(`Données : ${DATA_DIR}`);
  startQueueWorker();
  fs.writeFileSync(path.join(DATA_DIR, 'prospecto.pid'), String(process.pid));
});
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') console.error(`Le port ${PORT} est déjà utilisé : Prospecto est peut-être déjà lancé (${BASE_URL}).`);
  else console.error(err);
  process.exit(1);
});
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => server.close(() => process.exit(0)));
