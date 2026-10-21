import { DatabaseSync } from 'node:sqlite';
import { DB_PATH } from './config.js';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS secrets (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS searches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  params TEXT NOT NULL,
  result_count INTEGER DEFAULT 0,
  new_count INTEGER DEFAULT 0,
  errors TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS search_results (
  search_id INTEGER NOT NULL,
  establishment_id INTEGER NOT NULL REFERENCES establishments(id) ON DELETE CASCADE,
  distance_km REAL,
  is_new INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (search_id, establishment_id)
);

CREATE TABLE IF NOT EXISTS establishments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  name_key TEXT NOT NULL,
  type TEXT,
  sector TEXT,
  address TEXT,
  postcode TEXT,
  city TEXT,
  lat REAL,
  lon REAL,
  distance_km REAL,
  website TEXT,
  domain TEXT,
  phone TEXT,
  generic_email TEXT,
  contact_form_url TEXT,
  group_name TEXT,
  brand TEXT,
  stars INTEGER,
  rooms INTEGER,
  siren TEXT,
  siret TEXT,
  legal_name TEXT,
  naf TEXT,
  headcount_range TEXT,
  sites_count INTEGER,
  company_category TEXT,
  osm_ref TEXT,
  google_place_id TEXT,
  sources TEXT NOT NULL DEFAULT '[]',
  signals TEXT NOT NULL DEFAULT '[]',
  hook TEXT,
  hook_source TEXT,
  notes TEXT,
  in_list INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'identifie',
  do_not_contact INTEGER NOT NULL DEFAULT 0,
  score INTEGER,
  score_details TEXT,
  next_action TEXT,
  next_action_at TEXT,
  first_search_id INTEGER,
  last_search_id INTEGER,
  enriched_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_est_namekey ON establishments(name_key, postcode);
CREATE UNIQUE INDEX IF NOT EXISTS idx_est_osm ON establishments(osm_ref) WHERE osm_ref IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_est_gplace ON establishments(google_place_id) WHERE google_place_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_est_siret ON establishments(siret);
CREATE INDEX IF NOT EXISTS idx_est_domain ON establishments(domain);
CREATE INDEX IF NOT EXISTS idx_est_list ON establishments(in_list, status);

CREATE TABLE IF NOT EXISTS contacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  establishment_id INTEGER NOT NULL REFERENCES establishments(id) ON DELETE CASCADE,
  civility TEXT,
  first_name TEXT,
  last_name TEXT,
  role TEXT,
  role_category TEXT,
  email TEXT,
  email_kind TEXT,
  email_status TEXT NOT NULL DEFAULT 'non_verifiee',
  phone TEXT,
  source TEXT,
  source_url TEXT,
  collected_at TEXT,
  mx_ok INTEGER,
  reliability INTEGER NOT NULL DEFAULT 0,
  is_primary INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_contacts_est ON contacts(establishment_id);
CREATE INDEX IF NOT EXISTS idx_contacts_email ON contacts(email);

CREATE TABLE IF NOT EXISTS attachments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  label TEXT NOT NULL,
  filename TEXT NOT NULL,
  stored_name TEXT NOT NULL,
  mime TEXT,
  size INTEGER,
  is_default INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'initial',
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  target_types TEXT NOT NULL DEFAULT '[]',
  attachment_ids TEXT NOT NULL DEFAULT '[]',
  use_signature INTEGER NOT NULL DEFAULT 1,
  archived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS campaigns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  target_category TEXT,
  template_id INTEGER,
  auto_template INTEGER NOT NULL DEFAULT 1,
  min_score INTEGER NOT NULL DEFAULT 0,
  max_messages INTEGER,
  role_priority TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'active',
  pause_reason TEXT,
  consecutive_errors INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_id INTEGER REFERENCES campaigns(id) ON DELETE SET NULL,
  establishment_id INTEGER NOT NULL REFERENCES establishments(id) ON DELETE CASCADE,
  contact_id INTEGER REFERENCES contacts(id) ON DELETE SET NULL,
  template_id INTEGER,
  template_name TEXT,
  template_category TEXT,
  kind TEXT NOT NULL DEFAULT 'initial',
  parent_message_id INTEGER,
  to_email TEXT,
  to_name TEXT,
  to_role TEXT,
  subject TEXT,
  body TEXT,
  signature TEXT,
  attachment_ids TEXT NOT NULL DEFAULT '[]',
  personalization TEXT NOT NULL DEFAULT '{}',
  warnings TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'a_valider',
  queued INTEGER NOT NULL DEFAULT 0,
  validated_at TEXT,
  sent_at TEXT,
  provider TEXT,
  provider_message_id TEXT,
  provider_thread_id TEXT,
  rfc_message_id TEXT,
  delivery_status TEXT NOT NULL DEFAULT 'inconnu',
  error TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  outcome TEXT NOT NULL DEFAULT 'aucune',
  reply_at TEXT,
  reply_excerpt TEXT,
  next_action TEXT,
  next_action_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_msg_status ON messages(status);
CREATE INDEX IF NOT EXISTS idx_msg_campaign ON messages(campaign_id, status);
CREATE INDEX IF NOT EXISTS idx_msg_est ON messages(establishment_id);
CREATE INDEX IF NOT EXISTS idx_msg_email ON messages(to_email);

CREATE TABLE IF NOT EXISTS send_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id INTEGER,
  provider TEXT,
  ok INTEGER NOT NULL,
  error TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sendlog_date ON send_log(created_at);

CREATE TABLE IF NOT EXISTS opposition (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT,
  domain TEXT,
  establishment_id INTEGER,
  reason TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_opp_email ON opposition(email);
CREATE INDEX IF NOT EXISTS idx_opp_domain ON opposition(domain);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type TEXT NOT NULL,
  entity_id INTEGER NOT NULL,
  establishment_id INTEGER,
  action TEXT NOT NULL,
  details TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_entity ON events(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_events_est ON events(establishment_id);
`;

let db;

export function openDb(file = DB_PATH) {
  db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  db.exec(SCHEMA);
  return db;
}

export function getDb() {
  if (!db) openDb();
  return db;
}

export function closeDb() {
  if (db) { db.close(); db = undefined; }
}

export const now = () => new Date().toISOString();

// node:sqlite refuse `undefined` et les booléens : on normalise les paramètres.
function clean(params) {
  if (Array.isArray(params)) return params.map(cleanValue);
  const out = {};
  for (const [k, v] of Object.entries(params || {})) out[k] = cleanValue(v);
  return out;
}
function cleanValue(v) {
  if (v === undefined) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (v !== null && typeof v === 'object') return JSON.stringify(v);
  return v;
}

export function all(sql, ...params) {
  return getDb().prepare(sql).all(...normalizeArgs(params));
}
export function get(sql, ...params) {
  return getDb().prepare(sql).get(...normalizeArgs(params));
}
export function run(sql, ...params) {
  return getDb().prepare(sql).run(...normalizeArgs(params));
}
function normalizeArgs(params) {
  if (params.length === 1 && params[0] && typeof params[0] === 'object' && !Array.isArray(params[0])) {
    return [clean(params[0])];
  }
  return clean(params);
}

export function tx(fn) {
  const d = getDb();
  d.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    d.exec('COMMIT');
    return result;
  } catch (err) {
    d.exec('ROLLBACK');
    throw err;
  }
}

export function insert(table, row) {
  const keys = Object.keys(row);
  const sql = `INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map((k) => '$' + k).join(',')})`;
  const params = {};
  for (const k of keys) params['$' + k] = row[k];
  return Number(run(sql, params).lastInsertRowid);
}

export function update(table, id, fields) {
  const keys = Object.keys(fields);
  if (!keys.length) return 0;
  const params = { $id: id };
  for (const k of keys) params['$' + k] = fields[k];
  const sql = `UPDATE ${table} SET ${keys.map((k) => `${k} = $${k}`).join(', ')} WHERE id = $id`;
  return Number(run(sql, params).changes);
}

export function parseJson(value, fallback) {
  if (value == null || value === '') return fallback;
  try { return JSON.parse(value); } catch { return fallback; }
}

export function logEvent(entityType, entityId, action, details = null, establishmentId = null) {
  insert('events', {
    entity_type: entityType,
    entity_id: entityId,
    establishment_id: establishmentId ?? (entityType === 'establishment' ? entityId : null),
    action,
    details: details ? JSON.stringify(details) : null,
    created_at: now(),
  });
}
