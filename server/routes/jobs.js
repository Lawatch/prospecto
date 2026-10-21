import { randomToken } from '../crypto.js';

// Tâches longues (enrichissement en lot) exécutées en arrière-plan, avec suivi de progression.
const jobs = new Map();

export function startJob(label, items, worker) {
  const id = randomToken(8);
  const job = { id, label, total: items.length, done: 0, errors: [], results: [], status: 'en_cours', started_at: new Date().toISOString(), cancelled: false };
  jobs.set(id, job);
  (async () => {
    for (const item of items) {
      if (job.cancelled) break;
      try {
        job.results.push(await worker(item));
      } catch (err) {
        job.errors.push({ item, message: err.message });
      }
      job.done++;
    }
    job.status = job.cancelled ? 'annule' : 'termine';
    job.finished_at = new Date().toISOString();
  })();
  return job;
}

export function getJob(id) {
  return jobs.get(id) || null;
}

export function cancelJob(id) {
  const j = jobs.get(id);
  if (j) j.cancelled = true;
  return j;
}

export function jobRoutes(app) {
  app.get('/api/jobs/:id', (req, res) => {
    const j = getJob(req.params.id);
    if (!j) return res.status(404).json({ error: 'Tâche inconnue' });
    res.json({ ...j, results: j.results.slice(-50) });
  });
  app.post('/api/jobs/:id/cancel', (req, res) => res.json(cancelJob(req.params.id)));
}
