import express from 'express';
import path from 'node:path';
import { APP_ROOT } from './config.js';
import { authRoutes, requireAuth } from './auth.js';
import { prospectRoutes } from './routes/prospects.js';
import { messagingRoutes } from './routes/messaging.js';
import { adminRoutes } from './routes/admin.js';
import { jobRoutes } from './routes/jobs.js';
import { seedTemplates } from './seed.js';

export { seedTemplates };

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('etag', false);
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data: https://*.tile.openstreetmap.org; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'");
    next();
  });
  app.use(express.json({ limit: '5mb' }));
  app.get('/api/health', (req, res) => res.json({ ok: true, app: 'prospecto' }));
  app.use(requireAuth);
  authRoutes(app);
  prospectRoutes(app);
  messagingRoutes(app);
  adminRoutes(app);
  jobRoutes(app);
  app.use('/vendor/leaflet', express.static(path.join(APP_ROOT, 'node_modules', 'leaflet', 'dist')));
  app.use(express.static(path.join(APP_ROOT, 'public'), { index: 'index.html' }));
  app.use('/api', (req, res) => res.status(404).json({ error: 'Route inconnue' }));
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    const status = err.status && err.status < 600 && err.status >= 400 && !err.body ? err.status : (err.status ? 502 : 500);
    if (status >= 500) console.error('[erreur]', req.method, req.path, err);
    res.status(status).json({ error: err.message || 'Erreur interne' });
  });
  return app;
}
