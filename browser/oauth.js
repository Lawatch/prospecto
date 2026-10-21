// Version navigateur de server/services/oauth.js.
// Gmail : jeton d'accès obtenu dans la page par Google Identity Services (voir public/js/gmail-connect.js),
// valable une heure, jamais de jeton de longue durée stocké. Outlook : envoi par la messagerie web uniquement.
import { getSecret, setSecret } from './secrets.js';
import { getSetting, patchSetting } from '../server/settings.js';

export const PROVIDERS = {
  gmail: { label: 'Gmail (connexion directe)' },
};

export function redirectUri() {
  return typeof location !== 'undefined' ? location.origin : '';
}

export function getClient(provider) {
  return getSecret(`oauth_client_${provider}`, { json: true });
}

export function startAuth() {
  throw Object.assign(new Error('Utilisez le bouton « Connecter Gmail » de la page Paramètres.'), { status: 400 });
}

export async function finishAuth() {
  throw new Error('indisponible');
}

export function storeGmailToken({ access_token, expires_in, scope, email, name }) {
  setSecret('oauth_tokens_gmail', JSON.stringify({ access_token, expires_at: Date.now() + (Number(expires_in) || 3600) * 1000, scope, email, name, connected_at: new Date().toISOString() }));
  patchSetting('sending', { provider: 'gmail' });
}

export async function getAccessToken(provider) {
  const stored = getSecret(`oauth_tokens_${provider}`, { json: true });
  if (!stored) throw Object.assign(new Error('Gmail non connecté (Paramètres > Messagerie).'), { code: 'not_connected' });
  if (stored.expires_at > Date.now() + 60_000) return { token: stored.access_token, account: stored };
  throw Object.assign(new Error('Session Gmail expirée (elle dure une heure) : cliquez sur « Reconnecter Gmail » dans Paramètres > Messagerie.'), { code: 'auth' });
}

export function connectionStatus() {
  const t = getSecret('oauth_tokens_gmail', { json: true });
  const c = getClient('gmail');
  return {
    gmail: { configured: !!c?.client_id, connected: !!t, expired: !!t && t.expires_at <= Date.now(), email: t?.email || null, connected_at: t?.connected_at || null, redirect_uri: redirectUri(), scope: t?.scope || null },
    outlook: { configured: false, connected: false, unsupported: true, redirect_uri: '' },
    smtp: { configured: false, connected: false, unsupported: true, email: null },
  };
}

export function disconnect(provider) {
  setSecret(`oauth_tokens_${provider}`, null);
  if (getSetting('sending').provider === provider) patchSetting('sending', { provider: 'gmail_web' });
}
