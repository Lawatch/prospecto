// Résolution MX depuis le navigateur via DNS-over-HTTPS (Google Public DNS, accessible en CORS).
export async function resolveMx(domain) {
  let data;
  try {
    const res = await fetch(`https://dns.google/resolve?name=${encodeURIComponent(domain)}&type=MX`, { headers: { Accept: 'application/dns-json' }, signal: AbortSignal.timeout(8000) });
    data = await res.json();
  } catch {
    throw Object.assign(new Error('DNS injoignable'), { code: 'ECONNREFUSED' });
  }
  if (data.Status === 3) throw Object.assign(new Error('Domaine inexistant'), { code: 'ENOTFOUND' });
  const mx = (data.Answer || []).filter((a) => a.type === 15).map((a) => {
    const [priority, exchange] = String(a.data).split(' ');
    return { priority: Number(priority), exchange };
  });
  if (!mx.length) throw Object.assign(new Error('Aucun MX'), { code: 'ENODATA' });
  return mx;
}
export default { resolveMx };
