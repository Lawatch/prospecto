// Construit la version en ligne (dossier web/) : interface + « serveur » compilé pour le navigateur.
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'web');
const b = (p) => path.join(root, 'browser', p);

const builtins = {
  'node:sqlite': b('shims/sqlite.js'),
  'node:fs': b('shims/fs.js'),
  'node:path': b('shims/path.js'),
  'node:crypto': b('shims/crypto.js'),
  'node:dns/promises': b('shims/dns.js'),
  nodemailer: b('shims/nodemailer-root.js'),
  'nodemailer/lib/mail-composer': b('shims/nodemailer.js'),
  express: b('shims/express.js'),
};
const replaced = {
  [path.join(root, 'server/config.js')]: b('config.js'),
  [path.join(root, 'server/crypto.js')]: b('secrets.js'),
  [path.join(root, 'server/services/oauth.js')]: b('oauth.js'),
  [path.join(root, 'server/services/backup.js')]: b('backup.js'),
};

const alias = {
  name: 'prospecto-browser',
  setup(bld) {
    bld.onResolve({ filter: /.*/ }, (args) => {
      if (builtins[args.path]) return { path: builtins[args.path] };
      if (args.path.startsWith('node:')) return { errors: [{ text: `Module Node non disponible dans le navigateur : ${args.path} (importé par ${args.importer})` }] };
      if (args.path.startsWith('.')) {
        const abs = path.resolve(args.resolveDir, args.path);
        if (replaced[abs]) return { path: replaced[abs] };
      }
      return undefined;
    });
  },
};

fs.rmSync(out, { recursive: true, force: true });
fs.cpSync(path.join(root, 'public'), out, { recursive: true });
fs.copyFileSync(b('index.html'), path.join(out, 'index.html'));
fs.copyFileSync(b('manifest.webmanifest'), path.join(out, 'manifest.webmanifest'));
fs.writeFileSync(path.join(out, '.nojekyll'), '');
fs.mkdirSync(path.join(out, 'vendor/sqljs'), { recursive: true });
for (const f of ['sql-wasm.js', 'sql-wasm.wasm']) fs.copyFileSync(path.join(root, 'node_modules/sql.js/dist', f), path.join(out, 'vendor/sqljs', f));
fs.cpSync(path.join(root, 'node_modules/leaflet/dist'), path.join(out, 'vendor/leaflet'), { recursive: true });

await build({
  entryPoints: [b('backend.js')],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: ['chrome110', 'firefox115', 'safari16', 'edge110'],
  outfile: path.join(out, 'backend.js'),
  plugins: [alias],
  define: { 'process.env': '{}' },
  legalComments: 'none',
  logLevel: 'warning',
});
const size = fs.statSync(path.join(out, 'backend.js')).size;
console.log(`Version en ligne construite dans web/ (backend.js : ${Math.round(size / 1024)} Ko)`);
