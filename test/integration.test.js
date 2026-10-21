import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startFakeServices } from './fixtures/fake-services.js';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prospecto-test-'));
let fake;
let server;
let base;
let cookie = '';
let db;
let mailer;
let crypto;
let settings;
const sentMails = [];
let transportBehaviour = 'ok';

async function call(method, url, body, { csrf = true, raw = false } = {}) {
  const headers = { Cookie: cookie };
  if (csrf && method !== 'GET') headers['X-Prospecto'] = '1';
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(base + url, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  const setCookie = res.headers.get('set-cookie');
  if (setCookie) cookie = setCookie.split(';')[0];
  const data = raw ? await res.text() : await res.json().catch(() => null);
  return { status: res.status, data };
}

// Les envois manuels sont espacés d'au moins 5 s : on vieillit le journal pour enchaîner les tests.
// (on garde la date du jour pour que les plafonds quotidiens restent comptés).
const ageSendLog = () => db.run('UPDATE send_log SET created_at = ?', new Date(new Date().setHours(0, 0, 1, 0)).toISOString());

before(async () => {
  fake = await startFakeServices();
  process.env.PROSPECTO_DATA = dataDir;
  process.env.PROSPECTO_GEOCODE_URL = `${fake.base}/geocode`;
  process.env.PROSPECTO_OVERPASS_URL = `${fake.base}/overpass`;
  process.env.PROSPECTO_SIRENE_URL = `${fake.base}/sirene`;
  db = await import('../server/db.js');
  db.openDb();
  const { createApp, seedTemplates } = await import('../server/app.js');
  seedTemplates();
  mailer = await import('../server/services/mailer.js');
  crypto = await import('../server/crypto.js');
  settings = await import('../server/settings.js');
  mailer.setTransportForTests('gmail', async (raw, opts) => {
    if (transportBehaviour === 'error') throw Object.assign(new Error('Erreur serveur Gmail'), { status: 500 });
    if (transportBehaviour === 'timeout') throw Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });
    sentMails.push({ raw: raw.toString(), ...opts });
    return { provider_message_id: `gm-${sentMails.length}`, provider_thread_id: opts.threadId || `th-${sentMails.length}` };
  });
  server = createApp().listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  server?.close();
  await fake?.close();
  db?.closeDb();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('authentification et protection CSRF', async () => {
  assert.equal((await call('GET', '/api/establishments')).status, 401);
  assert.equal((await call('POST', '/api/auth/setup', { password: 'motdepasse123' }, { csrf: false })).status, 403);
  assert.equal((await call('POST', '/api/auth/setup', { password: 'court' })).status, 400);
  assert.equal((await call('POST', '/api/auth/setup', { password: 'motdepasse123' })).status, 200);
  assert.equal((await call('POST', '/api/auth/setup', { password: 'autre-mot-de-passe' })).status, 400);
  assert.equal((await call('GET', '/api/establishments')).status, 200);
  const saved = cookie;
  cookie = '';
  assert.equal((await call('POST', '/api/auth/login', { password: 'faux' })).status, 401);
  assert.equal((await call('POST', '/api/auth/login', { password: 'motdepasse123' })).status, 200);
  assert.notEqual(cookie, saved);
});

test('profil central', async () => {
  const r = await call('PUT', '/api/settings/profile', { full_name: 'Alex Martin', presentation: 'Huit ans en exploitation hôtelière.', email: 'alex@gmail.com', achievements: '– Hausse du RevPAR de 12 %' });
  assert.equal(r.status, 200);
  assert.equal(r.data.full_name, 'Alex Martin');
});

let lacId;
let cimesId;
test('recherche multi-sources avec fusion des doublons', async () => {
  const r = await call('POST', '/api/search', { location: 'Annecy', radiusKm: 10, types: ['hotel', 'apart_hotel', 'residence_tourisme'], sources: ['osm', 'sirene'] });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.deepEqual(r.data.errors, []);
  const names = r.data.results.map((x) => x.name).sort();
  // 3 hôtels OSM (sans l'élément sans nom) + 1 résidence SIRENE ; l'Hôtel du Lac OSM et SIRENE est fusionné ; l'entreprise fermée est exclue.
  assert.deepEqual(names, ["Appart'City Annecy", 'Hôtel Beau Site', 'Hôtel du Lac', 'RESIDENCE LES CIMES']);
  assert.equal(r.data.created, 4);
  const lac = r.data.results.find((x) => x.name === 'Hôtel du Lac');
  lacId = lac.id;
  cimesId = r.data.results.find((x) => x.name === 'RESIDENCE LES CIMES').id;
  assert.equal(lac.siret, '81234567800015');
  assert.equal(lac.headcount_range, '12');
  assert.equal(lac.group_name, 'GROUPE ALPES HOTELS');
  assert.deepEqual(lac.sources.map((s) => s.source).sort(), ['OpenStreetMap', 'SIRENE / RNE (recherche-entreprises.api.gouv.fr)']);
  assert.ok(lac.sources.every((s) => s.collected_at));
  assert.equal(r.data.results.find((x) => x.name === "Appart'City Annecy").type, 'apart_hotel');
  const query = fake.calls.find((c) => c.startsWith('overpass-query:'));
  assert.match(query, /around:10000,45.8992,6.1294/);

  const again = await call('POST', '/api/search', { location: 'Annecy', radiusKm: 10, types: ['hotel', 'apart_hotel', 'residence_tourisme'], sources: ['osm', 'sirene'] });
  assert.equal(again.data.created, 0);
  assert.equal(again.data.total, 4);
  assert.equal((await call('GET', '/api/establishments?in_list=')).data.total, 4);

  const detail = await call('GET', `/api/establishments/${lacId}`);
  const dupont = detail.data.contacts.find((c) => c.last_name === 'Dupont');
  assert.equal(dupont.first_name, 'Jean');
  assert.equal(dupont.email, null, 'aucune adresse inventée pour un dirigeant');
  assert.ok(detail.data.establishment.score > 0);
  assert.ok(detail.data.establishment.score_details.length === 7);

  assert.equal((await call('POST', '/api/search', { location: 'Lieu introuvable', types: ['hotel'] })).status >= 400, true);
});

test('ajout à la liste et enrichissement depuis le site officiel', async () => {
  const add = await call('POST', '/api/establishments/bulk', { ids: [lacId, cimesId], action: 'add_to_list' });
  assert.equal(add.data.count, 2);
  const r = await call('POST', `/api/establishments/${lacId}/enrich`, { steps: ['sirene', 'website'] });
  assert.equal(r.status, 200);
  assert.ok(r.data.steps.website.ok, r.data.steps.website.message);
  assert.ok(!fake.calls.includes('/site-lac/prive'), 'robots.txt doit être respecté');
  const d = (await call('GET', `/api/establishments/${lacId}`)).data;
  const emails = d.contacts.map((c) => c.email).filter(Boolean).sort();
  assert.deepEqual(emails, ['contact@hoteldulac-annecy.fr', 'direction@hoteldulac-annecy.fr', 'reservation@hoteldulac-annecy.fr', 'rh@hoteldulac-annecy.fr']);
  assert.ok(!emails.includes('noreply@tracker.com'));
  const martin = d.contacts.find((c) => c.last_name === 'Martin');
  assert.equal(martin.role, 'Directeur de la publication');
  assert.ok(martin.source_url.endsWith('/site-lac/mentions-legales'));
  const kinds = d.establishment.signals.map((s) => s.kind);
  for (const k of ['recrutement', 'renovation', 'capacite', 'mice']) assert.ok(kinds.includes(k), `signal ${k}`);
  assert.ok(d.establishment.contact_form_url.endsWith('/site-lac/contact'));
  assert.equal(d.establishment.status, 'contact_a_verifier');
  assert.ok(d.contacts.every((c) => !c.email || c.email_status !== 'verifiee'), 'rien n\'est marqué vérifié automatiquement');
});

let campaignId;
let msgId;
test('génération de campagne : jamais d\'envoi automatique, contrôles affichés', async () => {
  const before = sentMails.length;
  await call('PATCH', `/api/establishments/${lacId}`, { hook: 'Vos 85 chambres viennent d\'être entièrement rénovées.' });
  const r = await call('POST', '/api/campaigns', { name: 'Annecy', target_category: 'direction_adjointe', establishment_ids: [lacId, cimesId] });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  campaignId = r.data.campaign.id;
  assert.equal(r.data.created.length, 1);
  assert.equal(r.data.skipped[0].reason, 'Aucune adresse e-mail exploitable');
  assert.equal(sentMails.length, before, 'la génération ne déclenche aucun envoi');
  msgId = r.data.created[0];
  const m = (await call('GET', `/api/messages/${msgId}`)).data.message;
  assert.equal(m.status, 'a_valider');
  assert.equal(m.to_email, 'direction@hoteldulac-annecy.fr');
  assert.equal(m.template_name, 'Direction adjointe – hôtel');
  assert.match(m.subject, /Hôtel du Lac/);
  assert.match(m.body, /^Madame, Monsieur,/);
  assert.match(m.body, /Vos 85 chambres viennent d'être entièrement rénovées\./);
  assert.match(m.body, /Huit ans en exploitation hôtelière\./);
  assert.ok(!/\{\{/.test(m.body));
  assert.match(m.signature, /Alex Martin/);
  assert.match(m.signature, /STOP/);
  const codes = m.warnings.map((w) => w.code);
  assert.ok(codes.includes('unverified'));
  assert.ok(!m.warnings.some((w) => w.level === 'bloquant'));
  const dup = await call('POST', `/api/campaigns/${campaignId}/generate`, { establishment_ids: [lacId] });
  assert.equal(dup.data.created.length, 0);
});

test('modification à la validation et contrôles bloquants', async () => {
  let r = await call('PATCH', `/api/messages/${msgId}`, { body: 'Bonjour {{entreprise}}' });
  assert.ok(r.data.message.warnings.some((w) => w.code === 'unresolved' && w.level === 'bloquant'));
  assert.equal((await call('POST', `/api/messages/${msgId}/validate`)).status, 409);
  r = await call('PATCH', `/api/messages/${msgId}`, { to_email: 'pas-une-adresse' });
  assert.equal(r.status, 400);
  r = await call('POST', `/api/messages/${msgId}/regenerate`);
  assert.ok(!r.data.message.warnings.some((w) => w.level === 'bloquant'));
  r = await call('PATCH', `/api/messages/${msgId}`, { subject: 'Candidature – Direction adjointe', body: r.data.message.body + '\n\nP.-S. : disponible dès mars.' });
  assert.equal(r.data.message.subject, 'Candidature – Direction adjointe');
  const ev = r.data.events.map((e) => e.action);
  assert.ok(ev.includes('modifie') && ev.includes('regenere') && ev.includes('prepare'));
});

test('envoi : refusé sans messagerie, puis envoyé une seule fois après action explicite', async () => {
  let r = await call('POST', `/api/messages/${msgId}/send`);
  assert.equal(r.status, 409);
  assert.match(r.data.error, /messagerie/i);
  crypto.setSecret('oauth_tokens_gmail', JSON.stringify({ email: 'alex@gmail.com', access_token: 'x', expires_at: Date.now() + 3600e3 }));
  settings.patchSetting('sending', { provider: 'gmail' });
  r = await call('POST', `/api/messages/${msgId}/send`);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.message.status, 'envoyee');
  assert.equal(r.data.message.delivery_status, 'accepte');
  const mail = sentMails.at(-1);
  assert.match(mail.raw, /To: direction@hoteldulac-annecy\.fr/);
  assert.match(mail.raw, /From: Alex Martin <alex@gmail\.com>/);
  assert.match(mail.raw, /List-Unsubscribe: <mailto:alex@gmail\.com\?subject=STOP>/);
  const count = sentMails.length;
  r = await call('POST', `/api/messages/${msgId}/send`);
  assert.equal(r.status, 409);
  assert.equal(sentMails.length, count, 'pas de double envoi');
  assert.equal((await call('GET', `/api/establishments/${lacId}`)).data.establishment.status, 'envoyee');
  const again = await call('POST', '/api/campaigns', { name: 'Bis', target_category: 'generale', establishment_ids: [lacId] });
  assert.equal(again.data.created.length, 0);
  assert.equal(again.data.skipped[0].reason, 'Candidature déjà préparée ou envoyée');
});

async function newProspect(name, email, campaign) {
  const e = await call('POST', '/api/establishments', { name, type: 'hotel', city: 'Annecy', postcode: '74000', website: `https://${name.toLowerCase().replace(/\W+/g, '')}.fr` });
  await call('POST', `/api/establishments/${e.data.id}/contacts`, { email, first_name: 'Claude', last_name: 'Test', role: 'Directeur', civility: 'M.' });
  const g = campaign
    ? await call('POST', `/api/campaigns/${campaign}/generate`, { establishment_ids: [e.data.id] })
    : await call('POST', '/api/campaigns', { name: `C-${name}`, target_category: 'generale', establishment_ids: [e.data.id] });
  return { estId: e.data.id, msgId: g.data.created[0], campaignId: g.data.campaign?.id };
}

test('envois concurrents : un seul part', async () => {
  ageSendLog();
  const p = await newProspect('Hotel Concurrent', 'dir@hotelconcurrent.fr');
  const m = (await call('GET', `/api/messages/${p.msgId}`)).data.message;
  assert.match(m.body, /^Monsieur Test,/);
  const before = sentMails.length;
  const [a, b] = await Promise.all([call('POST', `/api/messages/${p.msgId}/send`), call('POST', `/api/messages/${p.msgId}/send`)]);
  assert.deepEqual([a.status, b.status].sort(), [200, 409]);
  assert.equal(sentMails.length, before + 1);
});

test('liste d\'opposition : messages en attente annulés et envoi impossible', async () => {
  const p = await newProspect('Hotel Opposant', 'gm@hotelopposant.fr');
  await call('POST', '/api/opposition', { domain: 'hotelopposant.fr', reason: 'STOP' });
  const m = (await call('GET', `/api/messages/${p.msgId}`)).data.message;
  assert.equal(m.status, 'ignoree');
  assert.equal((await call('POST', `/api/messages/${p.msgId}/send`)).status, 409);
  const regen = await call('POST', '/api/campaigns', { name: 'X', target_category: 'generale', establishment_ids: [p.estId], allow_recontact: true });
  assert.equal(regen.data.created.length, 0);
});

test('erreurs répétées : la campagne se met en pause', async () => {
  ageSendLog();
  const first = await newProspect('Hotel Erreur Un', 'a@hotelerreurun.fr');
  const c = first.campaignId;
  const second = await newProspect('Hotel Erreur Deux', 'a@hotelerreurdeux.fr', c);
  const third = await newProspect('Hotel Erreur Trois', 'a@hotelerreurtrois.fr', c);
  const fourth = await newProspect('Hotel Erreur Quatre', 'a@hotelerreurquatre.fr', c);
  transportBehaviour = 'error';
  for (const p of [first, second, third]) {
    const r = await call('POST', `/api/messages/${p.msgId}/send`);
    assert.equal(r.status, 502);
    assert.equal(r.data.message.status, 'erreur');
  }
  const camp = (await call('GET', `/api/campaigns/${c}`)).data;
  assert.equal(camp.status, 'en_pause');
  assert.match(camp.pause_reason, /3 erreurs/);
  transportBehaviour = 'ok';
  const blocked = await call('POST', `/api/messages/${fourth.msgId}/send`);
  assert.equal(blocked.status, 409);
  assert.match(blocked.data.error, /pause/);
  await call('PATCH', `/api/campaigns/${c}`, { status: 'active' });
  const retry = await call('POST', `/api/messages/${first.msgId}/send`);
  assert.equal(retry.status, 200, JSON.stringify(retry.data));
});

test('résultat incertain : renvoi seulement après confirmation', async () => {
  ageSendLog();
  const p = await newProspect('Hotel Incertain', 'a@hotelincertain.fr');
  transportBehaviour = 'timeout';
  let r = await call('POST', `/api/messages/${p.msgId}/send`);
  assert.match(r.data.message.error, /incertain/);
  transportBehaviour = 'ok';
  r = await call('POST', `/api/messages/${p.msgId}/send`);
  assert.equal(r.status, 409);
  assert.equal(r.data.needs_confirmation, true);
  r = await call('POST', `/api/messages/${p.msgId}/send`, { confirm_uncertain: true });
  assert.equal(r.status, 200);
});

test('file d\'envoi : seuls les messages validés un par un partent', async () => {
  ageSendLog();
  const a = await newProspect('Hotel File A', 'a@hotelfilea.fr');
  const b = await newProspect('Hotel File B', 'a@hotelfileb.fr');
  assert.equal((await call('POST', `/api/messages/${a.msgId}/validate`)).status, 200);
  settings.patchSetting('sending', { min_interval_seconds: 10 });
  assert.equal((await call('POST', '/api/queue/start')).status, 200);
  for (let i = 0; i < 20 && (await call('GET', `/api/messages/${a.msgId}`)).data.message.status !== 'envoyee'; i++) {
    ageSendLog();
    await mailer.queueTick();
  }
  assert.equal((await call('GET', `/api/messages/${a.msgId}`)).data.message.status, 'envoyee');
  await mailer.queueTick();
  assert.equal((await call('GET', `/api/messages/${b.msgId}`)).data.message.status, 'a_valider', 'non validé => jamais envoyé');
  assert.equal((await call('GET', '/api/queue')).data.queue_running, false);
});

test('plafond quotidien', async () => {
  ageSendLog();
  const p = await newProspect('Hotel Plafond', 'a@hotelplafond.fr');
  const sent = (await call('GET', '/api/queue')).data.sent_today;
  await call('PUT', '/api/settings/sending', { daily_cap: sent });
  const r = await call('POST', `/api/messages/${p.msgId}/send`);
  assert.equal(r.status, 409);
  assert.match(r.data.error, /Plafond quotidien/);
  await call('PUT', '/api/settings/sending', { daily_cap: 40 });
});

test('relances : dues après le délai, dans le même fil, exclues après réponse', async () => {
  ageSendLog();
  db.run("UPDATE messages SET sent_at = ? WHERE id = ?", new Date(Date.now() - 10 * 86400e3).toISOString(), msgId);
  let due = (await call('GET', '/api/followups')).data;
  const item = due.find((d) => d.id === msgId);
  assert.ok(item?.is_due);
  const prep = await call('POST', `/api/followups/${msgId}/prepare`);
  const f = prep.data.message;
  assert.equal(f.kind, 'relance');
  assert.equal(f.status, 'a_valider');
  assert.match(f.subject, /^Re: Candidature – Direction adjointe/);
  assert.match(f.body, /envoyée le \d{2}\/\d{2}\/\d{4}/);
  const r = await call('POST', `/api/messages/${f.id}/send`);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const parent = (await call('GET', `/api/messages/${msgId}`)).data.message;
  assert.equal(sentMails.at(-1).threadId, parent.provider_thread_id);
  assert.match(sentMails.at(-1).raw, new RegExp(`In-Reply-To: ${parent.rfc_message_id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
  await call('POST', `/api/messages/${msgId}/outcome`, { outcome: 'entretien', note: 'Entretien le 12' });
  due = (await call('GET', '/api/followups')).data;
  assert.ok(!due.some((d) => d.id === msgId));
  assert.equal((await call('GET', `/api/establishments/${lacId}`)).data.establishment.status, 'entretien');
});

test('statistiques : envoyé ≠ délivré, réponse ≠ positive', async () => {
  const s = (await call('GET', '/api/stats')).data;
  assert.ok(s.funnel.sent >= 5);
  assert.equal(s.funnel.delivered_known, null);
  assert.equal(s.funnel.interviews, 1);
  assert.equal(s.funnel.positive, 1);
  assert.ok(s.by_template.length >= 1);
  const d = (await call('GET', '/api/dashboard')).data;
  assert.equal(d.setup.mail_ok, true);
});

test('export sans secrets, sauvegarde, persistance', async () => {
  const r = await call('GET', '/api/export.json', undefined, { raw: true });
  assert.ok(!r.data.includes('access_token'));
  assert.ok(!r.data.includes('password_hash'));
  assert.ok(r.data.includes('Hôtel du Lac'));
  const b = await call('POST', '/api/backup');
  assert.ok(fs.existsSync(b.data.file));
  const raw = fs.readFileSync(path.join(dataDir, 'prospecto.sqlite'));
  assert.ok(!raw.includes(Buffer.from('access_token')), 'jetons chiffrés en base');
  const purge = await call('POST', '/api/data/purge', { scope: 'non_listed', confirm: 'non' });
  assert.equal(purge.status, 400);
  const ok = await call('POST', '/api/data/purge', { scope: 'non_listed', confirm: 'SUPPRIMER' });
  assert.ok(ok.data.deleted >= 2);
});
