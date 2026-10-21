import crypto from 'node:crypto';
import { BASE_URL } from '../config.js';
import { getSecret, setSecret, randomToken } from '../crypto.js';
import { fetchJson } from '../util.js';
import { getSetting, patchSetting } from '../settings.js';

// Connexion OAuth 2.0 (avec PKCE) aux messageries : aucun mot de passe n'est demandé ni stocké.
// Seuls les jetons sont conservés, chiffrés (voir crypto.js).
export const PROVIDERS = {
  gmail: {
    label: 'Gmail / Google Workspace',
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    scopes: () => ['openid', 'email', 'https://www.googleapis.com/auth/gmail.send',
      ...(getSetting('sending').gmail_detect_replies ? ['https://www.googleapis.com/auth/gmail.metadata'] : [])],
    extraAuthParams: { access_type: 'offline', prompt: 'consent' },
    redirectPath: '/oauth/google/callback',
  },
  outlook: {
    label: 'Outlook / Microsoft 365',
    authUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    scopes: () => ['offline_access', 'User.Read', 'Mail.Send'],
    extraAuthParams: { prompt: 'select_account' },
    redirectPath: '/oauth/microsoft/callback',
  },
};

const pending = new Map();

export function redirectUri(provider) {
  // Google et Microsoft acceptent les redirections « loopback » pour les applications de bureau.
  return provider === 'outlook' ? BASE_URL.replace('127.0.0.1', 'localhost') + PROVIDERS.outlook.redirectPath : BASE_URL + PROVIDERS.gmail.redirectPath;
}

export function getClient(provider) {
  return getSecret(`oauth_client_${provider}`, { json: true });
}

export function startAuth(provider) {
  const p = PROVIDERS[provider];
  const client = getClient(provider);
  if (!p) throw Object.assign(new Error('Fournisseur inconnu'), { status: 400 });
  if (!client?.client_id) throw Object.assign(new Error(`Renseignez d'abord l'identifiant client OAuth ${p.label} (Paramètres > Messagerie).`), { status: 400 });
  const state = randomToken(16);
  const verifier = randomToken(48);
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  pending.set(state, { provider, verifier, created: Date.now() });
  for (const [k, v] of pending) if (Date.now() - v.created > 15 * 60_000) pending.delete(k);
  const params = new URLSearchParams({
    client_id: client.client_id,
    redirect_uri: redirectUri(provider),
    response_type: 'code',
    scope: p.scopes().join(' '),
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    ...p.extraAuthParams,
  });
  return `${p.authUrl}?${params}`;
}

async function tokenRequest(provider, body) {
  const p = PROVIDERS[provider];
  const client = getClient(provider);
  const form = new URLSearchParams({ client_id: client.client_id, ...body });
  if (client.client_secret) form.set('client_secret', client.client_secret);
  return fetchJson(p.tokenUrl, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form.toString() });
}

export async function finishAuth(providerPath, { code, state, error }) {
  if (error) throw new Error(`Autorisation refusée : ${error}`);
  const entry = pending.get(state);
  if (!entry) throw new Error('Session d\'autorisation expirée ou invalide. Recommencez depuis Paramètres > Messagerie.');
  pending.delete(state);
  const { provider, verifier } = entry;
  if ((providerPath === 'google') !== (provider === 'gmail')) throw new Error('Fournisseur inattendu');
  const tokens = await tokenRequest(provider, { grant_type: 'authorization_code', code, redirect_uri: redirectUri(provider), code_verifier: verifier });
  const account = await fetchAccountEmail(provider, tokens.access_token);
  setSecret(`oauth_tokens_${provider}`, JSON.stringify({
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    expires_at: Date.now() + (tokens.expires_in || 3600) * 1000,
    scope: tokens.scope,
    email: account.email,
    name: account.name,
    connected_at: new Date().toISOString(),
  }));
  patchSetting('sending', { provider });
  return { provider, email: account.email };
}

async function fetchAccountEmail(provider, accessToken) {
  const headers = { Authorization: `Bearer ${accessToken}` };
  if (provider === 'gmail') {
    const info = await fetchJson('https://openidconnect.googleapis.com/v1/userinfo', { headers });
    return { email: info.email, name: info.name };
  }
  const me = await fetchJson('https://graph.microsoft.com/v1.0/me', { headers });
  return { email: me.mail || me.userPrincipalName, name: me.displayName };
}

export async function getAccessToken(provider) {
  const stored = getSecret(`oauth_tokens_${provider}`, { json: true });
  if (!stored) throw Object.assign(new Error(`Messagerie ${PROVIDERS[provider].label} non connectée`), { code: 'not_connected' });
  if (stored.access_token && stored.expires_at > Date.now() + 60_000) return { token: stored.access_token, account: stored };
  if (!stored.refresh_token) throw Object.assign(new Error('Jeton expiré : reconnectez la messagerie'), { code: 'auth' });
  try {
    const t = await tokenRequest(provider, { grant_type: 'refresh_token', refresh_token: stored.refresh_token });
    const next = { ...stored, access_token: t.access_token, expires_at: Date.now() + (t.expires_in || 3600) * 1000, refresh_token: t.refresh_token || stored.refresh_token };
    setSecret(`oauth_tokens_${provider}`, JSON.stringify(next));
    return { token: next.access_token, account: next };
  } catch (err) {
    throw Object.assign(new Error(`Renouvellement de l'autorisation impossible (${err.message}) : reconnectez la messagerie`), { code: 'auth' });
  }
}

export function connectionStatus() {
  const out = {};
  for (const provider of Object.keys(PROVIDERS)) {
    const t = getSecret(`oauth_tokens_${provider}`, { json: true });
    const c = getClient(provider);
    out[provider] = { configured: !!c?.client_id, connected: !!t, email: t?.email || null, connected_at: t?.connected_at || null, redirect_uri: redirectUri(provider), scope: t?.scope || null };
  }
  const smtp = getSecret('smtp', { json: true });
  out.smtp = { configured: !!smtp?.host, connected: !!smtp?.host, email: smtp?.from || smtp?.user || null };
  return out;
}

export function disconnect(provider) {
  setSecret(`oauth_tokens_${provider}`, null);
  if (getSetting('sending').provider === provider) patchSetting('sending', { provider: 'aucun' });
}
