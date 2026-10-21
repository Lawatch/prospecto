import { all, insert, now } from './db.js';
import { DEFAULT_TEMPLATES } from './services/templates.js';

// Modèles fournis au premier lancement.
export function seedTemplates() {
  if (all('SELECT id FROM templates LIMIT 1').length) return;
  const ts = now();
  for (const t of DEFAULT_TEMPLATES) {
    insert('templates', { name: t.name, category: t.category, kind: t.kind || 'initial', subject: t.subject, body: t.body, target_types: t.target_types || [], attachment_ids: [], use_signature: 1, created_at: ts, updated_at: ts });
  }
}
