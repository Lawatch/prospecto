import { get, run, all } from './db.js';

export const DEFAULT_SETTINGS = {
  profile: {
    full_name: '',
    title: 'Responsable d\'exploitation hôtelière',
    target_position: 'un poste de responsable d\'exploitation ou de directeur adjoint',
    email: '',
    phone: '',
    city: '',
    linkedin_url: '',
    cv_url: '',
    presentation: '',
    skills: '',
    achievements: '',
    availability: '',
    keywords: 'hôtel, séminaires, 4 étoiles, centre de profit',
    signature: '',
  },
  sending: {
    provider: 'aucun',
    daily_cap: 40,
    campaign_cap: 200,
    min_interval_seconds: 45,
    pause_after_errors: 3,
    opt_out_footer: true,
    opt_out_text: 'Si vous ne souhaitez pas être recontacté(e), il vous suffit de me répondre « STOP ».',
    gmail_detect_replies: false,
  },
  followup: {
    delay_days: 8,
    max_followups: 1,
  },
  search: {
    contact_email: '',
    default_radius_km: 20,
    respect_robots: true,
  },
  scoring: {
    target_types: ['hotel', 'apart_hotel', 'residence_tourisme', 'groupe_hotelier'],
    preferred_radius_km: 25,
    weights: { fit: 25, size: 20, position: 10, signals: 15, contact: 15, distance: 10, profile: 5 },
  },
};

export function getSetting(key) {
  const row = get('SELECT value FROM settings WHERE key = ?', key);
  const base = DEFAULT_SETTINGS[key];
  if (!row) return structuredClone(base ?? null);
  const value = JSON.parse(row.value);
  if (base && typeof base === 'object' && !Array.isArray(base)) return { ...structuredClone(base), ...value };
  return value;
}

export function setSetting(key, value) {
  run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    key, JSON.stringify(value));
}

export function patchSetting(key, partial) {
  const current = getSetting(key) || {};
  const next = { ...current, ...partial };
  setSetting(key, next);
  return next;
}

export function allSettings() {
  const out = {};
  for (const key of Object.keys(DEFAULT_SETTINGS)) out[key] = getSetting(key);
  for (const row of all('SELECT key FROM settings')) if (!(row.key in out) && !row.key.startsWith('_')) out[row.key] = getSetting(row.key);
  return out;
}
