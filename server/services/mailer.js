import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import MailComposer from 'nodemailer/lib/mail-composer';
import nodemailer from 'nodemailer';
import { all, get, insert, logEvent, now, run, update } from '../db.js';
import { UPLOAD_DIR } from '../config.js';
import { getSecret } from '../crypto.js';
import { getSetting, patchSetting, setSetting } from '../settings.js';
import { fetchJson, domainOf } from '../util.js';
import { getAccessToken } from './oauth.js';
import { computeWarnings, hydrateMessage } from './campaigns.js';
import { setStatus } from './establishments.js';

const SENDABLE = ['a_valider', 'brouillon', 'validee', 'erreur'];

// Envoi « par la messagerie web » : l'application ouvre un brouillon pré-rempli dans Gmail ou Outlook,
// l'utilisateur clique lui-même sur Envoyer, puis confirme. Aucune configuration ni autorisation requise.
export const COMPOSE_PROVIDERS = {
  gmail_web: 'Gmail (dans le navigateur)',
  outlook_pro_web: 'Outlook / Microsoft 365 (dans le navigateur)',
  outlook_web: 'Outlook.com / Hotmail (dans le navigateur)',
  mailto: "Logiciel de messagerie de l'ordinateur",
};
export const isComposeProvider = (p) => Object.hasOwn(COMPOSE_PROVIDERS, p || '');

export function composeUrl(provider, msg, { authuser } = {}) {
  const body = [msg.body, msg.signature].filter((x) => x && String(x).trim()).join('\n\n');
  const q = (o) => Object.entries(o).filter(([, v]) => v).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
  if (provider === 'gmail_web') return `https://mail.google.com/mail/?${q({ view: 'cm', fs: '1', authuser, to: msg.to_email, su: msg.subject, body })}`;
  if (provider === 'outlook_web') return `https://outlook.live.com/mail/0/deeplink/compose?${q({ to: msg.to_email, subject: msg.subject, body })}`;
  if (provider === 'outlook_pro_web') return `https://outlook.office.com/mail/deeplink/compose?${q({ to: msg.to_email, subject: msg.subject, body })}`;
  return `mailto:${encodeURIComponent(msg.to_email)}?${q({ subject: msg.subject, body: body.replace(/\n/g, '\r\n') })}`;
}

// Plafonds quotidiens publiés par les fournisseurs (marges de sécurité incluses).
export function providerHardCap(provider, email = '') {
  const d = domainOf(email) || '';
  if (provider === 'gmail_web') return 400;
  if (provider === 'outlook_web') return 250;
  if (provider === 'outlook_pro_web' || provider === 'mailto') return 500;
  if (provider === 'gmail') return d === 'gmail.com' || d === 'googlemail.com' ? 400 : 1500;
  if (provider === 'outlook') return ['outlook.com', 'outlook.fr', 'hotmail.com', 'hotmail.fr', 'live.com', 'live.fr'].includes(d) ? 250 : 2000;
  return 500;
}

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

export function sendingStats() {
  const sending = getSetting('sending');
  const account = currentAccount();
  const sentToday = get('SELECT count(*) AS n FROM send_log WHERE ok = 1 AND created_at >= ?', startOfToday()).n;
  const cap = Math.min(Number(sending.daily_cap) || 0, providerHardCap(sending.provider, account?.email));
  const last = get('SELECT created_at FROM send_log WHERE ok = 1 ORDER BY id DESC LIMIT 1');
  const queue = getSetting('_queue') || {};
  const queued = get("SELECT count(*) AS n FROM messages WHERE status = 'validee' AND queued = 1").n;
  return { provider: sending.provider, account: account?.email || null, sent_today: sentToday, daily_cap: cap, remaining_today: Math.max(0, cap - sentToday), last_sent_at: last?.created_at || null, queue_running: !!queue.running, queue_reason: queue.reason || null, queued };
}

export function currentAccount() {
  const provider = getSetting('sending').provider;
  if (isComposeProvider(provider)) return { provider, email: getSetting('profile').email || null, compose: true };
  if (provider === 'gmail' || provider === 'outlook') {
    const t = getSecret(`oauth_tokens_${provider}`, { json: true });
    return t ? { provider, email: t.email, name: t.name } : null;
  }
  if (provider === 'smtp') {
    const s = getSecret('smtp', { json: true });
    return s ? { provider, email: s.from || s.user } : null;
  }
  return null;
}

function textToHtml(text) {
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return esc(text).split(/\n{2,}/).map((p) => `<p style="margin:0 0 12px">${p.replace(/\n/g, '<br>').replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>')}</p>`).join('');
}

export async function buildMime(msg, from, { parent } = {}) {
  const profile = getSetting('profile');
  const fullText = [msg.body, msg.signature ? '\n--\n' + msg.signature : ''].join('\n').trim();
  const attachments = (msg.attachment_ids || []).map((id) => {
    const a = get('SELECT * FROM attachments WHERE id = ?', id);
    if (!a) throw new Error(`Pièce jointe n° ${id} introuvable`);
    const file = path.join(UPLOAD_DIR, a.stored_name);
    if (!fs.existsSync(file)) throw new Error(`Fichier manquant : ${a.filename}`);
    return { filename: a.filename, content: fs.readFileSync(file), contentType: a.mime || undefined };
  });
  const domain = domainOf(from.email) || 'prospecto.local';
  const messageId = `<${crypto.randomUUID()}@${domain}>`;
  const headers = {};
  if (getSetting('sending').opt_out_footer) headers['List-Unsubscribe'] = `<mailto:${from.email}?subject=STOP>`;
  const mail = {
    from: { name: profile.full_name || from.name || '', address: from.email },
    to: msg.to_name ? { name: msg.to_name, address: msg.to_email } : msg.to_email,
    subject: msg.subject,
    text: fullText,
    html: `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#222">${textToHtml(fullText)}</div>`,
    attachments,
    messageId,
    headers,
  };
  if (parent?.rfc_message_id) { mail.inReplyTo = parent.rfc_message_id; mail.references = [parent.rfc_message_id]; }
  const raw = await new MailComposer(mail).compile().build();
  return { raw, messageId };
}

const transports = {
  async gmail(raw, { threadId }) {
    const { token } = await getAccessToken('gmail');
    const body = { raw: raw.toString('base64url'), ...(threadId ? { threadId } : {}) };
    const res = await fetchJson('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body), timeoutMs: 60000,
    });
    return { provider_message_id: res.id, provider_thread_id: res.threadId };
  },
  async outlook(raw) {
    const { token } = await getAccessToken('outlook');
    // Microsoft Graph accepte un message MIME encodé en base64 (copie conservée dans « Éléments envoyés »).
    const res = await fetch('https://graph.microsoft.com/v1.0/me/sendMail', {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'text/plain' }, body: raw.toString('base64'), signal: AbortSignal.timeout(60000),
    });
    if (res.status !== 202) {
      const text = await res.text();
      const err = new Error(`HTTP ${res.status} Microsoft Graph : ${text.slice(0, 300)}`);
      err.status = res.status;
      throw err;
    }
    return { provider_message_id: null, provider_thread_id: null };
  },
  async smtp(raw, { to, from }) {
    const s = getSecret('smtp', { json: true });
    if (!s?.host) throw Object.assign(new Error('Serveur SMTP non configuré'), { code: 'not_connected' });
    const transporter = nodemailer.createTransport({ host: s.host, port: Number(s.port) || 587, secure: Number(s.port) === 465, auth: { user: s.user, pass: s.password }, connectionTimeout: 20000 });
    const info = await transporter.sendMail({ envelope: { from, to }, raw });
    return { provider_message_id: info.messageId || null, provider_thread_id: null };
  },
};

// Permet aux tests de substituer un transport fictif.
export function setTransportForTests(name, fn) { transports[name] = fn; }

function classifyError(err) {
  const status = err.status;
  if (err.code === 'not_connected' || err.code === 'auth' || status === 401 || status === 403 || err.code === 'EAUTH') return 'auth';
  if (status === 429 || /quota|rate limit|limit exceeded|too many/i.test(err.message)) return 'quota';
  if (err.name === 'TimeoutError' || err.code === 'ETIMEDOUT' || err.code === 'ECONNRESET' || /fetch failed|socket/i.test(err.message)) return 'incertain';
  if (status >= 400 && status < 500) return 'rejet';
  return 'technique';
}

function finalizeSent(msg, provider, result, origin) {
  const ts = now();
  update('messages', msg.id, {
    status: 'envoyee', sent_at: ts, validated_at: msg.validated_at || ts, queued: 0, error: null,
    provider, provider_message_id: result.provider_message_id || null, provider_thread_id: result.provider_thread_id || null, rfc_message_id: result.rfc_message_id || null,
    delivery_status: result.delivery_status, updated_at: ts,
  });
  insert('send_log', { message_id: msg.id, provider, ok: 1, created_at: ts });
  if (msg.campaign_id) update('campaigns', msg.campaign_id, { consecutive_errors: 0, updated_at: ts });
  logEvent('message', msg.id, 'envoye', { origin, provider, to: msg.to_email }, msg.establishment_id);
  setStatus(msg.establishment_id, 'envoyee');
}

export class SendBlocked extends Error {
  constructor(message, details = {}) { super(message); this.status = 409; this.details = details; }
}

// Envoi d'un message. Appelée uniquement depuis une action explicite de l'utilisateur
// (« Envoyer cet e-mail ») ou depuis la file des messages qu'il a lui-même validés un par un.
function preflight(id, { origin = 'manuel', confirmUncertain = false, compose = false } = {}) {
  const msg = hydrateMessage(get('SELECT * FROM messages WHERE id = ?', id));
  if (!msg) throw Object.assign(new Error('Message introuvable'), { status: 404 });
  if (msg.status === 'envoyee') throw new SendBlocked('Ce message a déjà été envoyé.');
  if (msg.status === 'envoi_en_cours') throw new SendBlocked('Envoi déjà en cours pour ce message.');
  if (!SENDABLE.includes(msg.status)) throw new SendBlocked(`Statut « ${msg.status} » : envoi impossible.`);
  if (msg.status === 'erreur' && /incertain/i.test(msg.error || '') && !confirmUncertain) {
    throw new SendBlocked('Le précédent envoi a un résultat incertain : vérifiez votre dossier « Envoyés » avant de renvoyer.', { needs_confirmation: true });
  }
  const warnings = computeWarnings(msg);
  update('messages', id, { warnings });
  const blocking = warnings.filter((w) => w.level === 'bloquant');
  if (blocking.length) throw new SendBlocked(`Envoi bloqué : ${blocking.map((w) => w.text).join(' ; ')}`, { warnings });

  const sending = getSetting('sending');
  const provider = sending.provider;
  if (compose) {
    if (!isComposeProvider(provider)) throw new SendBlocked('Choisissez « Ma messagerie dans le navigateur » dans Paramètres > Messagerie.');
  } else {
    if (isComposeProvider(provider)) throw new SendBlocked('Envoi direct indisponible : utilisez « Ouvrir dans ma messagerie ».');
    if (!transports[provider]) throw new SendBlocked('Aucune messagerie connectée (Paramètres > Messagerie).');
  }
  const account = currentAccount();
  if (!compose && !account?.email) throw new SendBlocked('Messagerie non connectée ou adresse d\'expédition inconnue.');

  const stats = sendingStats();
  if (stats.remaining_today <= 0) throw new SendBlocked(`Plafond quotidien atteint (${stats.daily_cap} messages). Reprise possible demain.`);
  if (msg.campaign_id) {
    const c = get('SELECT * FROM campaigns WHERE id = ?', msg.campaign_id);
    if (c?.status === 'en_pause') throw new SendBlocked(`Campagne en pause${c.pause_reason ? ' : ' + c.pause_reason : ''}. Reprenez-la depuis la page Campagnes.`);
    const sentInCampaign = get("SELECT count(*) AS n FROM messages WHERE campaign_id = ? AND status = 'envoyee'", msg.campaign_id).n;
    const campaignCap = Math.min(c?.max_messages || Infinity, Number(sending.campaign_cap) || Infinity);
    if (sentInCampaign >= campaignCap) throw new SendBlocked(`Plafond de la campagne atteint (${campaignCap} messages).`);
  }
  const minGap = origin === 'file' ? Number(sending.min_interval_seconds) || 30 : 5;
  // En messagerie web, c'est l'utilisateur qui envoie : pas d'intervalle imposé.
  if (!compose && stats.last_sent_at) {
    const wait = Math.ceil(minGap - (Date.now() - Date.parse(stats.last_sent_at)) / 1000);
    if (wait > 0) throw new SendBlocked(`Intervalle minimal entre deux envois : réessayez dans ${wait} s.`, { retry_in: wait });
  }

  return { msg, sending, provider, account };
}

export async function sendMessage(id, { origin = 'manuel', confirmUncertain = false } = {}) {
  const { msg, sending, provider, account } = preflight(id, { origin, confirmUncertain });
  // Verrouillage atomique : un double clic ou deux onglets ne peuvent pas envoyer deux fois.
  const claimed = run(`UPDATE messages SET status = 'envoi_en_cours', attempts = attempts + 1, updated_at = ?
    WHERE id = ? AND status IN ('a_valider','brouillon','validee','erreur')
    AND NOT EXISTS (SELECT 1 FROM messages o WHERE o.id != messages.id AND lower(o.to_email) = lower(messages.to_email) AND o.kind = 'initial' AND messages.kind = 'initial' AND o.status IN ('envoyee','envoi_en_cours'))`,
  now(), id).changes;
  if (claimed !== 1) throw new SendBlocked('Envoi refusé : message déjà en cours d\'envoi, déjà envoyé, ou adresse déjà sollicitée.');

  const parent = msg.parent_message_id ? get('SELECT * FROM messages WHERE id = ?', msg.parent_message_id) : null;
  try {
    const { raw, messageId } = await buildMime(msg, account, { parent });
    const result = await transports[provider](raw, { to: msg.to_email, from: account.email, threadId: parent?.provider_thread_id });
    finalizeSent(msg, provider, { ...result, rfc_message_id: messageId, delivery_status: 'accepte' }, origin);
    return { ok: true, message: hydrateMessage(get('SELECT * FROM messages WHERE id = ?', id)) };
  } catch (err) {
    const kind = classifyError(err);
    const ts = now();
    const text = kind === 'incertain'
      ? `Résultat incertain (${err.message}) : vérifiez le dossier « Envoyés » avant tout nouvel essai.`
      : err.message;
    update('messages', id, { status: 'erreur', error: text, queued: 0, updated_at: ts });
    insert('send_log', { message_id: id, provider, ok: 0, error: `${kind}: ${err.message}`.slice(0, 500), created_at: ts });
    logEvent('message', id, 'erreur_envoi', { kind, error: err.message }, msg.establishment_id);
    setStatus(msg.establishment_id, 'erreur');
    if (msg.campaign_id) {
      const c = get('SELECT consecutive_errors FROM campaigns WHERE id = ?', msg.campaign_id);
      const n = (c?.consecutive_errors || 0) + 1;
      const pauseAfter = Number(sending.pause_after_errors) || 3;
      update('campaigns', msg.campaign_id, { consecutive_errors: n, updated_at: ts, ...(n >= pauseAfter ? { status: 'en_pause', pause_reason: `${n} erreurs d'envoi consécutives (dernière : ${err.message.slice(0, 120)})` } : {}) });
    }
    if (kind === 'auth' || kind === 'quota') stopQueue(kind === 'auth' ? 'Autorisation de la messagerie à renouveler' : 'Limite du fournisseur atteinte : envoi suspendu');
    return { ok: false, kind, error: text, message: hydrateMessage(get('SELECT * FROM messages WHERE id = ?', id)) };
  }
}

// Étape 1 : contrôles complets puis ouverture du brouillon pré-rempli dans la messagerie.
export function openCompose(id) {
  const { msg, provider } = preflight(id, { compose: true, confirmUncertain: true });
  const claimed = run(`UPDATE messages SET status = 'envoi_en_cours', provider = ?, attempts = attempts + 1, error = NULL, updated_at = ?
    WHERE id = ? AND status IN ('a_valider','brouillon','validee','erreur')
    AND NOT EXISTS (SELECT 1 FROM messages o WHERE o.id != messages.id AND lower(o.to_email) = lower(messages.to_email) AND o.kind = 'initial' AND messages.kind = 'initial' AND o.status IN ('envoyee','envoi_en_cours'))`,
  provider, now(), id).changes;
  if (claimed !== 1) throw new SendBlocked('Ouverture refusée : message déjà en cours, déjà envoyé, ou adresse déjà sollicitée.');
  logEvent('message', id, 'ouvert_messagerie', { provider, to: msg.to_email }, msg.establishment_id);
  return { url: composeUrl(provider, msg, { authuser: getSetting('profile').email || undefined }), message: hydrateMessage(get('SELECT * FROM messages WHERE id = ?', id)) };
}

// Étape 2 : l'utilisateur confirme avoir cliqué sur « Envoyer » dans sa messagerie.
export function confirmComposeSent(id) {
  const msg = hydrateMessage(get('SELECT * FROM messages WHERE id = ?', id));
  if (!msg || msg.status !== 'envoi_en_cours' || !isComposeProvider(msg.provider)) throw new SendBlocked('Aucun brouillon ouvert pour ce message.');
  finalizeSent(msg, msg.provider, { delivery_status: 'inconnu' }, 'messagerie_web');
  return hydrateMessage(get('SELECT * FROM messages WHERE id = ?', id));
}

export function cancelCompose(id) {
  const msg = get('SELECT * FROM messages WHERE id = ?', id);
  if (!msg || msg.status !== 'envoi_en_cours' || !isComposeProvider(msg.provider)) throw new SendBlocked('Aucun brouillon ouvert pour ce message.');
  update('messages', id, { status: 'a_valider', provider: null, updated_at: now() });
  logEvent('message', id, 'envoi_annule', null, msg.establishment_id);
  return hydrateMessage(get('SELECT * FROM messages WHERE id = ?', id));
}

// ---- File d'envoi des messages validés individuellement ----
let timer = null;
let busy = false;

export function startQueue() {
  if (isComposeProvider(getSetting('sending').provider)) throw new SendBlocked("L'envoi groupé nécessite une connexion directe (Gmail API). Avec la messagerie web, envoyez les messages un par un depuis l'écran de validation.");
  setSetting('_queue', { running: true, started_at: now(), reason: null });
  logEvent('queue', 0, 'demarree');
}

export function stopQueue(reason = null) {
  setSetting('_queue', { running: false, reason, stopped_at: now() });
  if (reason) logEvent('queue', 0, 'arretee', { reason });
}

export async function queueTick() {
  if (busy) return;
  const q = getSetting('_queue');
  if (!q?.running) return;
  busy = true;
  try {
    const next = get(`SELECT m.id FROM messages m LEFT JOIN campaigns c ON c.id = m.campaign_id
      WHERE m.status = 'validee' AND m.queued = 1 AND (c.id IS NULL OR c.status != 'en_pause') ORDER BY m.validated_at, m.id LIMIT 1`);
    if (!next) { stopQueue('File vide : tous les messages validés ont été traités'); return; }
    const stats = sendingStats();
    if (stats.remaining_today <= 0) { stopQueue('Plafond quotidien atteint'); return; }
    const gap = Number(getSetting('sending').min_interval_seconds) || 30;
    if (stats.last_sent_at && Date.now() - Date.parse(stats.last_sent_at) < gap * 1000) return;
    try {
      await sendMessage(next.id, { origin: 'file' });
    } catch (err) {
      if (err instanceof SendBlocked) {
        if (err.details?.retry_in) return;
        update('messages', next.id, { queued: 0, status: 'a_valider', error: err.message, updated_at: now() });
        logEvent('message', next.id, 'retire_de_la_file', { reason: err.message });
      } else throw err;
    }
  } finally {
    busy = false;
  }
}

export function startQueueWorker() {
  if (timer) return;
  timer = setInterval(() => queueTick().catch((e) => console.error('[file d\'envoi]', e)), 5000);
  timer.unref?.();
}

export function stopQueueWorker() {
  if (timer) clearInterval(timer);
  timer = null;
}

// ---- Détection des réponses et rejets (Gmail, autorisation « métadonnées » facultative) ----
export async function syncGmailReplies() {
  const sending = getSetting('sending');
  if (!sending.gmail_detect_replies) throw Object.assign(new Error('Activez « Détecter les réponses » dans Paramètres > Messagerie puis reconnectez Gmail.'), { status: 400 });
  const { token, account } = await getAccessToken('gmail');
  if (!String(account.scope || '').includes('gmail.metadata')) throw Object.assign(new Error('Reconnectez Gmail pour accorder la lecture des métadonnées.'), { status: 400 });
  const sent = all("SELECT * FROM messages WHERE status = 'envoyee' AND provider = 'gmail' AND provider_thread_id IS NOT NULL AND sent_at >= ? ORDER BY sent_at DESC LIMIT 300",
    new Date(Date.now() - 90 * 86400_000).toISOString());
  const me = String(account.email || '').toLowerCase();
  let replies = 0;
  let bounces = 0;
  for (const m of sent) {
    let thread;
    try {
      thread = await fetchJson(`https://gmail.googleapis.com/gmail/v1/users/me/threads/${m.provider_thread_id}?format=metadata&metadataHeaders=From&metadataHeaders=Date`, { headers: { Authorization: `Bearer ${token}` } });
    } catch { continue; }
    for (const tm of thread?.messages || []) {
      if (tm.id === m.provider_message_id || Number(tm.internalDate) <= Date.parse(m.sent_at)) continue;
      const from = (tm.payload?.headers || []).find((h) => h.name.toLowerCase() === 'from')?.value?.toLowerCase() || '';
      if (from.includes(me)) continue;
      const ts = new Date(Number(tm.internalDate)).toISOString();
      if (/mailer-daemon|postmaster|mail delivery/i.test(from)) {
        if (m.delivery_status !== 'rejete') {
          update('messages', m.id, { delivery_status: 'rejete', outcome: 'adresse_invalide', reply_at: ts, reply_excerpt: tm.snippet?.slice(0, 300), updated_at: now() });
          run("UPDATE contacts SET email_status = 'invalide', reliability = 0 WHERE lower(email) = lower(?)", m.to_email);
          logEvent('message', m.id, 'rejet_detecte', { from }, m.establishment_id);
          bounces++;
        }
      } else if (m.outcome === 'aucune') {
        update('messages', m.id, { outcome: 'reponse_a_qualifier', reply_at: ts, reply_excerpt: tm.snippet?.slice(0, 300), updated_at: now() });
        logEvent('message', m.id, 'reponse_detectee', { from }, m.establishment_id);
        setStatus(m.establishment_id, 'reponse');
        replies++;
      }
    }
  }
  patchSetting('sending', { last_reply_sync: now() });
  return { checked: sent.length, replies, bounces };
}

// E-mail de test vers sa propre adresse : vérifie la connexion de bout en bout avec le même transport que les vrais envois.
export async function sendTest(account, to) {
  const provider = getSetting('sending').provider;
  if (!transports[provider]) throw Object.assign(new Error('Aucune messagerie sélectionnée'), { status: 400 });
  const { raw } = await buildMime({
    to_email: to,
    subject: 'Prospecto – e-mail de test',
    body: 'Ceci est un e-mail de test envoyé depuis Prospecto pour vérifier la connexion à votre messagerie.\n\nSi vous le recevez, la configuration fonctionne.',
    signature: '',
    attachment_ids: [],
  }, account);
  await transports[provider](raw, { to, from: account.email });
  insert('send_log', { message_id: null, provider, ok: 1, error: 'test', created_at: now() });
  return { ok: true, to };
}
