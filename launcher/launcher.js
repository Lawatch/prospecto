// Lanceur : démarre Prospecto en arrière-plan s'il ne tourne pas déjà, puis ouvre le navigateur.
// Utilisation : node launcher/launcher.js         (ouvrir)
//               node launcher/launcher.js --stop  (arrêter le service)
import { spawn, execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = path.resolve(process.env.PROSPECTO_DATA || path.join(root, 'data'));
const port = Number(process.env.PROSPECTO_PORT || 3737);
const url = `http://127.0.0.1:${port}`;
const pidFile = path.join(dataDir, 'prospecto.pid');
fs.mkdirSync(dataDir, { recursive: true });

async function healthy() {
  try {
    const r = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(1500) });
    return r.ok && (await r.json()).app === 'prospecto';
  } catch {
    return false;
  }
}

function openBrowser() {
  if (process.platform === 'win32') execFile('cmd', ['/c', 'start', '', url], { windowsHide: true });
  else if (process.platform === 'darwin') execFile('open', [url]);
  else execFile('xdg-open', [url], () => {});
}

async function start() {
  if (!(await healthy())) {
    const log = fs.openSync(path.join(dataDir, 'prospecto.log'), 'a');
    const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', path.join(root, 'server', 'index.js')], {
      cwd: root, detached: true, stdio: ['ignore', log, log], windowsHide: true, env: process.env,
    });
    fs.writeFileSync(pidFile, String(child.pid));
    child.unref();
    for (let i = 0; i < 60 && !(await healthy()); i++) await new Promise((r) => setTimeout(r, 500));
    if (!(await healthy())) {
      console.error(`Prospecto n'a pas pu démarrer. Consultez ${path.join(dataDir, 'prospecto.log')}`);
      process.exit(1);
    }
  }
  if (!process.argv.includes('--silencieux')) openBrowser();
}

function stop() {
  if (!fs.existsSync(pidFile)) return console.log('Prospecto ne semble pas lancé.');
  const pid = Number(fs.readFileSync(pidFile, 'utf8'));
  try { process.kill(pid); console.log('Prospecto arrêté.'); } catch { console.log('Processus déjà arrêté.'); }
  fs.rmSync(pidFile, { force: true });
}

if (process.argv.includes('--stop')) stop();
else start();
