// Mini-routeur compatible avec l'usage qu'en font les routes du serveur (app.get/post…, req/res).
export function createRouter() {
  const routes = [];
  const add = (method) => (path, ...handlers) => {
    const keys = [];
    const re = new RegExp('^' + path.replace(/[.]/g, '\\.').replace(/:(\w+)/g, (m, k) => { keys.push(k); return '([^/]+)'; }) + '$');
    routes.push({ method, re, keys, handlers });
  };
  const app = { get: add('GET'), post: add('POST'), put: add('PUT'), patch: add('PATCH'), delete: add('DELETE'), use() {}, set() {}, disable() {} };

  app.handle = async (method, url, body, headers = {}) => {
    const u = new URL(url, 'http://local');
    const route = routes.find((r) => r.method === method && r.re.test(u.pathname));
    const out = { status: 200, headers: {}, body: null };
    if (!route) return { ...out, status: 404, body: { error: 'Route inconnue' } };
    const m = u.pathname.match(route.re);
    const req = {
      method, path: u.pathname, url, body: body ?? {}, headers: Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v])),
      params: Object.fromEntries(route.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])])),
      query: Object.fromEntries(u.searchParams), socket: { remoteAddress: 'local' },
    };
    let done = false;
    const res = {
      status(n) { out.status = n; return res; },
      setHeader(k, v) { out.headers[k.toLowerCase()] = v; return res; },
      json(o) { out.body = o; done = true; return res; },
      send(x) { out.body = x; done = true; return res; },
      redirect(to) { out.status = 302; out.headers.location = to; done = true; return res; },
      sendFile(p) { out.file = p; done = true; return res; },
    };
    try {
      for (const h of route.handlers) {
        let next = false;
        await h(req, res, () => { next = true; });
        if (done || !next) break;
      }
    } catch (err) {
      const status = err.status && err.status < 600 && err.status >= 400 && !err.body ? err.status : (err.status ? 502 : 500);
      if (status >= 500) console.error('[erreur]', method, u.pathname, err);
      return { status, headers: {}, body: { error: err.message || 'Erreur interne' } };
    }
    return out;
  };
  return app;
}

const passthrough = () => (req, res, next) => next();
export default Object.assign(() => createRouter(), { raw: passthrough, json: passthrough, static: passthrough });
