import { all, get, now, parseJson, run } from '../db.js';
import { allSettings, getSetting, setSetting, DEFAULT_SETTINGS } from '../settings.js';
import { getSecret, hasSecret, setSecret } from '../crypto.js';
import { connectionStatus, disconnect, finishAuth, startAuth, PROVIDERS } from '../services/oauth.js';
import { addOpposition } from '../services/contacts.js';
import { recomputeAllScores } from '../services/establishments.js';
import { computeStats } from '../services/stats.js';
import { dueFollowups } from '../services/followups.js';
import { backupNow, listBackups } from '../services/backup.js';
import { currentAccount, sendingStats, sendTest, syncGmailReplies } from '../services/mailer.js';
import { ESTABLISHMENT_STATUSES, ESTABLISHMENT_TYPES, ROLE_CATEGORIES, TEMPLATE_CATEGORIES, HEADCOUNT_RANGES, MESSAGE_STATUSES, OUTCOMES, DEFAULT_ROLE_PRIORITY } from '../services/catalog.js';
import { isValidEmail } from '../util.js';
import nodemailer from 'nodemailer';

const PUBLIC_SETTINGS = Object.keys(DEFAULT_SETTINGS);
const SECRET_NAMES = ['google_places_key', 'hunter_key', 'oauth_client_gmail', 'oauth_client_outlook', 'smtp'];

function oauthPage(title, text, ok) {
  return `<!doctype html><html lang="fr"><meta charset="utf-8"><title>${title}</title>
  <body style="font-family:system-ui;background:#f6f7f9;display:grid;place-items:center;height:100vh;margin:0">
  <div style="background:#fff;padding:32px 40px;border-radius:12px;box-shadow:0 2px 12px #0001;max-width:520px">
  <h2 style="margin-top:0;color:${ok ? '#0a7a4b' : '#b42318'}">${title}</h2><p>${text}</p>
  <a href="/#/parametres" style="color:#2d5bd7">Revenir aux paramètres</a></div></body></html>`;
}

export function adminRoutes(app) {
  app.get('/api/meta', (req, res) => res.json({
    types: Object.fromEntries(Object.entries(ESTABLISHMENT_TYPES).map(([k, v]) => [k, v.label])),
    statuses: ESTABLISHMENT_STATUSES, roles: ROLE_CATEGORIES, categories: TEMPLATE_CATEGORIES,
    headcount: Object.fromEntries(Object.entries(HEADCOUNT_RANGES).map(([k, v]) => [k, v.label])),
    message_statuses: MESSAGE_STATUSES, outcomes: OUTCOMES, role_priority: DEFAULT_ROLE_PRIORITY,
  }));

  app.get('/api/settings', (req, res) => {
    const settings = allSettings();
    const secrets = Object.fromEntries(SECRET_NAMES.map((n) => [n, hasSecret(n)]));
    const clients = {};
    for (const p of Object.keys(PROVIDERS)) { const c = getSecret(`oauth_client_${p}`, { json: true }); clients[p] = c ? { client_id: c.client_id, has_secret: !!c.client_secret } : null; }
    const smtp = getSecret('smtp', { json: true });
    res.json({ settings, secrets, clients, smtp: smtp ? { host: smtp.host, port: smtp.port, user: smtp.user, from: smtp.from } : null, connections: connectionStatus(), sending: sendingStats() });
  });

  app.put('/api/settings/:key', (req, res) => {
    const key = req.params.key;
    if (!PUBLIC_SETTINGS.includes(key)) return res.status(400).json({ error: 'Paramètre inconnu' });
    const value = { ...getSetting(key), ...(req.body || {}) };
    if (key === 'sending') {
      for (const k of ['daily_cap', 'campaign_cap', 'min_interval_seconds', 'pause_after_errors']) value[k] = Math.max(0, Number(value[k]) || 0);
      if (value.min_interval_seconds < 10) value.min_interval_seconds = 10;
      if (value.pause_after_errors < 1) value.pause_after_errors = 1;
    }
    setSetting(key, value);
    if (key === 'scoring' || key === 'profile') recomputeAllScores();
    res.json(value);
  });

  app.put('/api/secrets/:name', (req, res) => {
    const name = req.params.name;
    if (!SECRET_NAMES.includes(name)) return res.status(400).json({ error: 'Secret inconnu' });
    const v = req.body?.value;
    if (name === 'smtp' && v) {
      const prev = getSecret('smtp', { json: true }) || {};
      const next = { ...prev, ...v };
      if (!v.password) next.password = prev.password;
      setSecret(name, JSON.stringify(next));
    } else if (name.startsWith('oauth_client_') && v) {
      const prev = getSecret(name, { json: true }) || {};
      setSecret(name, JSON.stringify({ client_id: v.client_id || prev.client_id, client_secret: v.client_secret === undefined || v.client_secret === '' ? prev.client_secret : v.client_secret }));
    } else {
      setSecret(name, v || null);
    }
    res.json({ ok: true, set: hasSecret(name) });
  });

  // ---- Messagerie ----
  app.post('/api/oauth/:provider/start', (req, res) => res.json({ url: startAuth(req.params.provider) }));
  app.post('/api/oauth/:provider/disconnect', (req, res) => { disconnect(req.params.provider); res.json(connectionStatus()); });

  for (const [path, name] of [['/oauth/google/callback', 'google'], ['/oauth/microsoft/callback', 'microsoft']]) {
    app.get(path, async (req, res) => {
      try {
        const r = await finishAuth(name, req.query);
        res.send(oauthPage('Messagerie connectée', `Les envois partiront de <b>${r.email}</b>. Vous pouvez fermer cet onglet.`, true));
      } catch (err) {
        res.status(400).send(oauthPage('Connexion impossible', String(err.message).replace(/</g, '&lt;'), false));
      }
    });
  }

  app.post('/api/mail/smtp-test', async (req, res) => {
    const s = getSecret('smtp', { json: true });
    if (!s?.host) return res.status(400).json({ error: 'SMTP non configuré' });
    const t = nodemailer.createTransport({ host: s.host, port: Number(s.port) || 587, secure: Number(s.port) === 465, auth: { user: s.user, pass: s.password }, connectionTimeout: 15000 });
    await t.verify();
    res.json({ ok: true });
  });

  // Envoi d'un e-mail de test à sa propre adresse : valide la connexion de bout en bout.
  app.post('/api/mail/test', async (req, res) => {
    const account = currentAccount();
    if (!account) return res.status(400).json({ error: 'Aucune messagerie connectée' });
    const to = String(req.body?.to || account.email).trim();
    if (!isValidEmail(to)) return res.status(400).json({ error: 'Adresse invalide' });
    res.json(await sendTest(account, to));
  });

  app.post('/api/mail/sync-replies', async (req, res) => res.json(await syncGmailReplies()));

  // ---- Liste d'opposition ----
  app.get('/api/opposition', (req, res) => res.json(all(`SELECT o.*, e.name AS establishment_name FROM opposition o LEFT JOIN establishments e ON e.id = o.establishment_id ORDER BY o.id DESC`)));
  app.post('/api/opposition', (req, res) => res.json({ id: addOpposition(req.body || {}) }));
  app.delete('/api/opposition/:id', (req, res) => { run('DELETE FROM opposition WHERE id = ?', Number(req.params.id)); res.json({ ok: true }); });

  // ---- Tableau de bord & statistiques ----
  app.get('/api/stats', (req, res) => res.json(computeStats()));

  app.get('/api/dashboard', (req, res) => {
    const stats = computeStats();
    const followups = dueFollowups();
    const profile = getSetting('profile');
    res.json({
      stats: stats.funnel,
      sending: sendingStats(),
      todo: {
        to_validate: get("SELECT count(*) AS n FROM messages WHERE status = 'a_valider'").n,
        drafts: get("SELECT count(*) AS n FROM messages WHERE status = 'brouillon'").n,
        errors: get("SELECT count(*) AS n FROM messages WHERE status = 'erreur'").n,
        followups_due: followups.filter((f) => f.is_due && !f.pending_followup_id).length,
        replies_to_qualify: get("SELECT count(*) AS n FROM messages WHERE outcome = 'reponse_a_qualifier'").n,
        contacts_to_check: get("SELECT count(*) AS n FROM establishments WHERE in_list = 1 AND status IN ('identifie','contact_a_verifier')").n,
        paused_campaigns: all("SELECT id, name, pause_reason FROM campaigns WHERE status = 'en_pause'"),
        next_actions: all("SELECT id, name, next_action, next_action_at FROM establishments WHERE next_action IS NOT NULL AND next_action != '' ORDER BY next_action_at NULLS LAST LIMIT 10"),
      },
      setup: {
        profile_ok: !!(profile.full_name && profile.presentation),
        mail_ok: !!currentAccount(),
        cv_ok: !!get('SELECT 1 AS x FROM attachments') || !!profile.cv_url,
        templates_ok: !!get('SELECT 1 AS x FROM templates WHERE archived = 0'),
      },
      recent: all(`SELECT m.id, m.to_email, m.subject, m.status, m.sent_at, m.outcome, e.name AS establishment_name FROM messages m JOIN establishments e ON e.id = m.establishment_id
        WHERE m.status = 'envoyee' ORDER BY m.sent_at DESC LIMIT 8`),
    });
  });

  // ---- Données : export, sauvegarde, suppression ----
  app.get('/api/export.json', (req, res) => {
    const data = {
      exported_at: now(),
      note: 'Export complet hors secrets (jetons, clés API, mots de passe).',
      settings: allSettings(),
      establishments: all('SELECT * FROM establishments').map((e) => ({ ...e, sources: parseJson(e.sources, []), signals: parseJson(e.signals, []), score_details: parseJson(e.score_details, null) })),
      contacts: all('SELECT * FROM contacts'),
      templates: all('SELECT * FROM templates'),
      campaigns: all('SELECT * FROM campaigns'),
      messages: all('SELECT * FROM messages'),
      opposition: all('SELECT * FROM opposition'),
      events: all('SELECT * FROM events'),
      attachments: all('SELECT id, label, filename, size, created_at FROM attachments'),
    };
    res.setHeader('Content-Disposition', `attachment; filename="prospecto-export-${now().slice(0, 10)}.json"`);
    res.json(data);
  });

  app.post('/api/backup', (req, res) => res.json({ file: backupNow('manuel'), backups: listBackups() }));
  app.get('/api/backups', (req, res) => res.json(listBackups()));

  app.post('/api/data/purge', (req, res) => {
    const { scope, confirm } = req.body || {};
    if (confirm !== 'SUPPRIMER') return res.status(400).json({ error: 'Tapez SUPPRIMER pour confirmer.' });
    backupNow('avant-suppression');
    if (scope === 'non_listed') {
      const r = run("DELETE FROM establishments WHERE in_list = 0 AND id NOT IN (SELECT establishment_id FROM messages)");
      return res.json({ ok: true, deleted: Number(r.changes) });
    }
    if (scope === 'older_than') {
      const days = Math.max(1, Number(req.body.days) || 365);
      const cutoff = new Date(Date.now() - days * 86400_000).toISOString();
      const r = run("DELETE FROM establishments WHERE updated_at < ? AND id NOT IN (SELECT establishment_id FROM messages WHERE sent_at >= ?)", cutoff, cutoff);
      return res.json({ ok: true, deleted: Number(r.changes) });
    }
    if (scope === 'all') {
      // La liste d'opposition est conservée : elle sert justement à ne plus recontacter ces personnes.
      for (const t of ['messages', 'contacts', 'search_results', 'searches', 'events', 'campaigns', 'send_log', 'establishments']) run(`DELETE FROM ${t}`);
      return res.json({ ok: true });
    }
    res.status(400).json({ error: 'Portée inconnue' });
  });
}
