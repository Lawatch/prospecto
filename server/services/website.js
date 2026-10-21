import { EMAIL_RE, classifyEmail, domainOf, isValidEmail, sleep, stripAccents } from '../util.js';
import { UA_HEADERS } from '../config.js';
import { roleCategory } from './catalog.js';

// Analyse du site officiel d'un établissement : quelques pages publiques seulement (accueil, contact,
// mentions légales, recrutement…), robots.txt respecté, une requête par seconde, aucune protection contournée.
const MAX_PAGES = 6;
const MAX_BYTES = 1_500_000;
const LINK_HINTS = /(contact|nous-contacter|mentions|legal|l[ée]gales|imprint|impressum|a-propos|about|qui-sommes|equipe|team|recrut|carri|emploi|jobs|join|presse|actualit|news)/i;

const robotsCache = new Map();

export function parseRobots(text) {
  const groups = [];
  let current = null;
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim();
    const m = line.match(/^([a-z-]+)\s*:\s*(.*)$/i);
    if (!m) continue;
    const [, field, value] = m;
    const f = field.toLowerCase();
    if (f === 'user-agent') {
      if (!current || current.rules.length) { current = { agents: [], rules: [] }; groups.push(current); }
      current.agents.push(value.toLowerCase());
    } else if (current && (f === 'disallow' || f === 'allow')) {
      current.rules.push({ allow: f === 'allow', path: value });
    }
  }
  const pick = groups.find((g) => g.agents.some((a) => a.includes('prospecto'))) || groups.find((g) => g.agents.includes('*'));
  return pick ? pick.rules.filter((r) => r.path !== '') : [];
}

export function isAllowedByRobots(rules, pathname) {
  let best = null;
  for (const r of rules) {
    const pattern = '^' + r.path.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\\\$$/, '$');
    if (new RegExp(pattern).test(pathname) && (!best || r.path.length > best.path.length || (r.path.length === best.path.length && r.allow))) best = r;
  }
  return !best || best.allow;
}

async function robotsFor(origin) {
  if (robotsCache.has(origin)) return robotsCache.get(origin);
  let rules = [];
  try {
    const res = await fetch(origin + '/robots.txt', { headers: { ...UA_HEADERS }, signal: AbortSignal.timeout(8000) });
    if (res.ok) rules = parseRobots(await res.text());
  } catch { /* robots.txt absent : pas de restriction déclarée */ }
  robotsCache.set(origin, rules);
  return rules;
}

async function fetchPage(url, respectRobots) {
  const u = new URL(url);
  if (respectRobots) {
    const rules = await robotsFor(u.origin);
    if (!isAllowedByRobots(rules, u.pathname)) return { url, skipped: 'robots.txt' };
  }
  const res = await fetch(url, { headers: { ...UA_HEADERS, Accept: 'text/html', 'Accept-Language': 'fr' }, redirect: 'follow', signal: AbortSignal.timeout(15000) });
  if (!res.ok) return { url, error: `HTTP ${res.status}` };
  const type = res.headers.get('content-type') || '';
  if (!type.includes('html')) return { url, error: 'contenu non HTML' };
  const buf = new Uint8Array(await res.arrayBuffer());
  return { url: res.url || url, html: new TextDecoder('utf-8').decode(buf.subarray(0, MAX_BYTES)) };
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', eacute: 'é', egrave: 'è', ecirc: 'ê', agrave: 'à', ccedil: 'ç', ocirc: 'ô', ucirc: 'û', icirc: 'î', laquo: '«', raquo: '»', rsquo: '’' };
export function htmlToText(html) {
  return String(html)
    .replace(/<(script|style|noscript|svg)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>|<\/(p|div|li|h\d|tr|section|article|footer|header)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#(\d+);/g, (m, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (m, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m)
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim();
}

export function extractLinks(html, baseUrl) {
  const out = [];
  const re = /<a\b[^>]*href\s*=\s*["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html))) {
    try {
      const abs = new URL(m[1], baseUrl);
      out.push({ href: abs.toString(), text: htmlToText(m[2]).slice(0, 80), protocol: abs.protocol, host: abs.hostname });
    } catch { /* lien invalide */ }
  }
  return out;
}

const IGNORED_EMAIL = /(\.(png|jpe?g|gif|webp|svg)$)|sentry|wixpress|example\.|domain\.|email\.com$|yourdomain|votre-?domaine|@2x/i;

export function extractEmails(html, text) {
  const found = new Set();
  for (const m of html.matchAll(/mailto:([^"'?>\s]+)/gi)) found.add(decodeURIComponent(m[1]).toLowerCase());
  const deobfuscated = text.replace(/\s*[[(]\s*(at|arobase)\s*[\])]\s*/gi, '@').replace(/\s*[[(]\s*(dot|point)\s*[\])]\s*/gi, '.');
  for (const m of deobfuscated.matchAll(EMAIL_RE)) found.add(m[0].toLowerCase());
  return [...found].map((e) => e.replace(/^[.]+|[.]+$/g, '')).filter((e) => isValidEmail(e) && !IGNORED_EMAIL.test(e));
}

// Noms propres : majuscule initiale obligatoire (pas d'option « i » ici), sur une seule ligne.
const NAME = "((?:[A-ZÉÈÀÂÎÔÛÇ][\\p{L}'’-]+)(?:[ \\t]+(?:[A-ZÉÈÀÂÎÔÛÇ][\\p{L}'’-]+|[A-Z]{2,})){1,3})";
const CIV = "(?:M\\.|Mme|Mr|Monsieur|Madame)?[ \\t]*";
const PERSON_PATTERNS = [
  { re: new RegExp(`([Dd]irect(?:eur|rice)|[Rr]esponsable)[ \\t]+de[ \\t]+(?:la[ \\t]+)?publication[ \\t]*[:：-]?[ \\t]*${CIV}${NAME}`, 'gu'), role: 'Directeur de la publication' },
  { re: new RegExp(`([Gg][ée]rant(?:e)?|[Pp]r[ée]sident(?:e)?|[Dd]irecteur g[ée]n[ée]ral|[Dd]irectrice g[ée]n[ée]rale|[Gg]eneral [Mm]anager|[Dd]irecteur|[Dd]irectrice)[ \\t]*[:：-][ \\t]*${CIV}${NAME}`, 'gu'), role: null },
];

export function extractPeople(text) {
  const people = [];
  for (const { re, role } of PERSON_PATTERNS) {
    for (const m of text.matchAll(re)) {
      const full = m[2].trim();
      if (/^(Le|La|Les|De|Du|Des|Hôtel|Hotel|Société|Groupe|SAS|SARL)\b/.test(full)) continue;
      const parts = full.split(/\s+/);
      const r = role || m[1].replace(/^\w/, (c) => c.toUpperCase());
      people.push({ first_name: parts.slice(0, -1).join(' '), last_name: parts.at(-1), role: r, role_category: roleCategory(r), snippet: m[0].slice(0, 160) });
    }
  }
  const seen = new Set();
  return people.filter((p) => { const k = `${p.first_name} ${p.last_name}`.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
}

const SIGNAL_RULES = [
  { kind: 'recrutement', label: 'Recrutement en cours', re: /(nous recrutons|on recrute|rejoignez[- ]nous|offres? d['’]emploi|postes? (?:à pourvoir|ouverts?)|recrute(?:ment)?\s)/i },
  { kind: 'ouverture', label: 'Ouverture / nouvel établissement', re: /(ouverture (?:prochaine|en \d{4}|le \d)|nouvel (?:hôtel|établissement)|vient d['’]ouvrir|inaugur|bientôt ouvert|prochainement)/i },
  { kind: 'renovation', label: 'Rénovation / réouverture', re: /(r[ée]nov[ée]|r[ée]novation|r[ée]ouverture|enti[èe]rement repens[ée]|agrandissement)/i },
  { kind: 'groupe', label: "Appartenance à un groupe", re: /(groupe [A-Z][\w&'’ -]{2,40}|membre (?:du|de la) [A-Z][\w&'’ -]{2,40}|collection [A-Z][\w&'’ -]{2,30})/ },
  { kind: 'capacite', label: 'Capacité', re: /(\b\d{2,4}\s+(?:chambres|suites|appartements|lits|couverts)\b)/i },
  { kind: 'mice', label: 'Séminaires / événementiel', re: /(s[ée]minaires?|salles? de r[ée]union|[ée]v[ée]nementiel|mice\b|banquets?)/i },
  { kind: 'restauration', label: 'Restauration / bar', re: /(notre restaurant|restaurant gastronomique|brasserie|rooftop|bar à cocktails)/i },
  { kind: 'spa', label: 'Spa / bien-être', re: /(\bspa\b|piscine|espace bien[- ]être|hammam)/i },
];

export function extractSignals(text, url) {
  const out = [];
  const sentences = text.split(/(?<=[.!?])\s+|\n/).map((s) => s.trim()).filter((s) => s.length > 15 && s.length < 400);
  for (const rule of SIGNAL_RULES) {
    const sentence = sentences.find((s) => rule.re.test(s));
    if (sentence) out.push({ kind: rule.kind, label: rule.label, snippet: sentence.slice(0, 260), url });
  }
  return out;
}

export function extractSirets(text) {
  const out = new Set();
  for (const m of text.matchAll(/\b(?:siret|siren|rcs)[^0-9]{0,30}((?:\d[\s.]?){9}(?:(?:\d[\s.]?){5})?)/gi)) {
    const digits = m[1].replace(/\D/g, '');
    if (digits.length === 14 || digits.length === 9) out.add(digits);
  }
  return [...out];
}

export function hasContactForm(html) {
  return /<form\b[\s\S]*?(<textarea|type=["']email)/i.test(html);
}

// Analyse d'un texte copié depuis le site officiel (version navigateur, ou site illisible automatiquement).
export function analyzeText(rawText, { url = null, website = null } = {}) {
  const isHtml = /<[a-z][\s\S]*>/i.test(rawText);
  const html = isHtml ? rawText : '';
  const text = isHtml ? htmlToText(rawText) : String(rawText);
  const domain = domainOf(website || url);
  const sameDomain = (email) => { const d = domainOf(email); return !!domain && !!d && (d === domain || d.endsWith('.' + domain)); };
  return {
    emails: extractEmails(html, text).map((email) => ({ email, kind: classifyEmail(email), source_url: url, same_domain: sameDomain(email) })).filter((e) => e.kind !== 'technique'),
    people: extractPeople(text).map((p) => ({ ...p, source_url: url })),
    signals: extractSignals(text, url),
    sirets: extractSirets(text),
    contact_form_url: null,
    pages: [{ url, ok: true, note: 'texte copié' }],
    collected_at: new Date().toISOString(),
    domain,
  };
}

export async function analyzeWebsite(website, { respectRobots = true } = {}) {
  const start = new URL(website);
  const domain = domainOf(website);
  const visited = new Set();
  const pages = [];
  const result = { emails: [], people: [], signals: [], sirets: [], contact_form_url: null, pages, collected_at: new Date().toISOString(), domain };
  const queue = [start.toString()];
  while (queue.length && pages.length < MAX_PAGES) {
    const url = queue.shift();
    const key = url.replace(/[#?].*$/, '').replace(/\/$/, '');
    if (visited.has(key)) continue;
    visited.add(key);
    let page;
    try {
      page = await fetchPage(url, respectRobots);
    } catch (err) {
      page = { url, error: err.name === 'TimeoutError' ? 'délai dépassé' : err.message };
    }
    pages.push({ url: page.url, ok: !!page.html, note: page.error || page.skipped || null });
    if (!page.html) { if (pages.length === 1 && page.error) result.error = page.error; continue; }
    const text = htmlToText(page.html);
    for (const email of extractEmails(page.html, text)) {
      if (!result.emails.some((e) => e.email === email)) {
        result.emails.push({ email, kind: classifyEmail(email), source_url: page.url, same_domain: domainOf(email) === domain || domainOf(email)?.endsWith('.' + domain) || domain?.endsWith('.' + domainOf(email)) });
      }
    }
    for (const p of extractPeople(text)) if (!result.people.some((x) => x.last_name === p.last_name && x.first_name === p.first_name)) result.people.push({ ...p, source_url: page.url });
    for (const s of extractSignals(text, page.url)) if (!result.signals.some((x) => x.kind === s.kind)) result.signals.push(s);
    for (const s of extractSirets(text)) if (!result.sirets.includes(s)) result.sirets.push(s);
    if (!result.contact_form_url && /contact/i.test(page.url) && hasContactForm(page.html)) result.contact_form_url = page.url;
    if (pages.length === 1) {
      const links = extractLinks(page.html, page.url)
        .filter((l) => l.protocol.startsWith('http') && domainOf(l.href) === domainOf(page.url) && (LINK_HINTS.test(l.href) || LINK_HINTS.test(stripAccents(l.text))));
      for (const l of links) queue.push(l.href);
    }
    if (queue.length) await sleep(1000);
  }
  result.emails = result.emails.filter((e) => e.kind !== 'technique');
  return result;
}
