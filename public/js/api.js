export class ApiError extends Error {
  constructor(message, status, data) { super(message); this.status = status; this.data = data; }
}

async function request(method, url, body, { raw = false, headers = {} } = {}) {
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

let metaCache = null;
export async function meta() {
  if (!metaCache) metaCache = await api.get('/api/meta');
  return metaCache;
}
