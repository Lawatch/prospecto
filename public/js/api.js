export class ApiError extends Error {
  constructor(message, status, data) { super(message); this.status = status; this.data = data; }
}

// Version en ligne : le « serveur » s'exécute dans la page (backend.js), sans aucune installation.
export const isLocal = document.querySelector('meta[name="prospecto-mode"]')?.content === 'local';
let backendPromise = null;
export function backend() {
  if (!backendPromise) backendPromise = import('../backend.js').then(async (m) => { await m.ready; return m; });
  return backendPromise;
}

async function request(method, url, body, { raw = false, headers = {} } = {}) {
  if (isLocal) {
    const b = await backend();
    const r = await b.handle(method, url, body, headers);
    if (r.status >= 400) throw new ApiError(r.body?.error || `Erreur ${r.status}`, r.status, r.body);
    return r.body;
  }
  const opts = { method, headers: { ...headers }, credentials: 'same-origin' };
  if (method !== 'GET') opts.headers['X-Prospecto'] = '1';
  if (body !== undefined) {
    if (raw) opts.body = body;
    else { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
  }
  const res = await fetch(url, opts);
  const type = res.headers.get('content-type') || '';
  const data = type.includes('json') ? await res.json() : await res.text();
  if (res.status === 401 && !url.startsWith('/api/auth')) {
    window.dispatchEvent(new CustomEvent('auth-required'));
  }
  if (!res.ok) throw new ApiError((data && data.error) || `Erreur ${res.status}`, res.status, data);
  return data;
}

export const api = {
  get: (url) => request('GET', url),
  post: (url, body = {}) => request('POST', url, body),
  patch: (url, body = {}) => request('PATCH', url, body),
  put: (url, body = {}) => request('PUT', url, body),
  del: (url) => request('DELETE', url),
  upload: (url, file, headers) => request('POST', url, file, { raw: true, headers: { 'Content-Type': file.type || 'application/octet-stream', ...headers } }),
};

export function saveBlob(blob, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
}

// Téléchargement d'une ressource /api/... (export CSV/JSON, pièce jointe) dans les deux modes.
export async function downloadApi(url, fallbackName = 'export') {
  if (!isLocal) { window.open(url, '_blank'); return; }
  const b = await backend();
  const r = await b.handle('GET', url);
  if (r.status >= 400) throw new ApiError(r.body?.error || `Erreur ${r.status}`, r.status, r.body);
  const disposition = r.headers['content-disposition'] || '';
  const name = decodeURIComponent((disposition.match(/filename="?([^";]+)"?/) || [])[1] || fallbackName);
  let blob = r.body;
  if (!(blob instanceof Blob)) {
    const isText = typeof blob === 'string';
    blob = new Blob([isText ? blob : JSON.stringify(blob, null, 2)], { type: isText ? (name.endsWith('.csv') ? 'text/csv;charset=utf-8' : 'text/plain;charset=utf-8') : 'application/json' });
  }
  saveBlob(blob, name);
}

let metaCache = null;
export async function meta() {
  if (!metaCache) metaCache = await api.get('/api/meta');
  return metaCache;
}
