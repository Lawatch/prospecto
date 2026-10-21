// Version navigateur : construction d'un message MIME (pour l'API Gmail) sans dépendance Node.
const enc = new TextEncoder();

function b64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
const wrap = (s) => s.replace(/.{1,76}/g, '$&\r\n').trimEnd();
const encodeWord = (s) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${b64(enc.encode(s))}?=`);
function addr(a) {
  if (!a) return '';
  if (typeof a === 'string') return a;
  return a.name ? `${encodeWord(a.name.replace(/"/g, ''))} <${a.address}>` : a.address;
}

class RawMessage {
  constructor(bytes) { this.bytes = bytes; }
  toString(encoding) {
    if (encoding === 'base64') return b64(this.bytes);
    if (encoding === 'base64url') return b64(this.bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    return new TextDecoder().decode(this.bytes);
  }
}

export function buildMime(mail) {
  const boundary = (n) => `=_prospecto_${n}_${crypto.randomUUID().replace(/-/g, '')}`;
  const mixed = boundary('m');
  const alt = boundary('a');
  const headers = [
    `From: ${addr(mail.from)}`,
    `To: ${addr(mail.to)}`,
    `Subject: ${encodeWord(mail.subject || '')}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: ${mail.messageId}`,
    ...(mail.inReplyTo ? [`In-Reply-To: ${mail.inReplyTo}`, `References: ${(mail.references || [mail.inReplyTo]).join(' ')}`] : []),
    ...Object.entries(mail.headers || {}).map(([k, v]) => `${k}: ${v}`),
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${mixed}"`,
  ];
  const parts = [
    `--${mixed}`,
    `Content-Type: multipart/alternative; boundary="${alt}"`,
    '',
    `--${alt}`,
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    '',
    wrap(b64(enc.encode(mail.text || ''))),
    `--${alt}`,
    'Content-Type: text/html; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    '',
    wrap(b64(enc.encode(mail.html || ''))),
    `--${alt}--`,
  ];
  for (const a of mail.attachments || []) {
    const name = encodeURIComponent(a.filename);
    parts.push(`--${mixed}`, `Content-Type: ${a.contentType || 'application/octet-stream'}; name="${encodeWord(a.filename)}"`, 'Content-Transfer-Encoding: base64',
      `Content-Disposition: attachment; filename*=UTF-8''${name}`, '', wrap(b64(a.content instanceof Uint8Array ? a.content : enc.encode(String(a.content)))));
  }
  parts.push(`--${mixed}--`, '');
  return new RawMessage(enc.encode([...headers, '', ...parts].join('\r\n')));
}

export default class MailComposer {
  constructor(mail) { this.mail = mail; }
  compile() { return { build: async () => buildMime(this.mail) }; }
}

export const nodemailer = {
  createTransport() {
    throw Object.assign(new Error("L'envoi SMTP n'est pas disponible dans la version en ligne : utilisez votre messagerie web ou Gmail."), { status: 400 });
  },
};
