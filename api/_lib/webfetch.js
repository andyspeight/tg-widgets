/**
 * Shared web-fetch helpers used by the crawl and freshness engines.
 *
 * Single tested copy of the SSRF guard and HTML-to-text strip so the security
 * boundary can't drift between callers.
 */

/**
 * Return a safe, normalised http(s) URL or null. Refuses non-http(s) schemes
 * and private / loopback / link-local / cloud-metadata hosts, even when the
 * URL comes from owner-configured data.
 */
export function safeUrl(u) {
  let url;
  try { url = new URL(u); } catch { return null; }
  if (!/^https?:$/.test(url.protocol)) return null;
  let h = url.hostname.toLowerCase();
  // IPv6 literals arrive bracketed (e.g. "[::1]"); unwrap before checks.
  if (h.startsWith('[') && h.endsWith(']')) h = h.slice(1, -1);
  if (h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal')) return null;
  if (h === '169.254.169.254' || h === 'metadata.google.internal') return null;
  if (/^(127\.|10\.|0\.|169\.254\.|192\.168\.)/.test(h)) return null;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return null;
  // IPv6 loopback / unspecified / unique-local / link-local.
  if (h === '::1' || h === '::' || /^(fc|fd|fe80|::ffff:)/.test(h)) return null;
  return url.toString();
}

/** Strip HTML to readable text. */
export function htmlToText(html) {
  return String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Fetch a URL and return readable text, or '' on any failure. SSRF-guarded,
 * timed out, size-capped, and content-type filtered.
 */
export async function fetchText(u, { timeoutMs = 12000, maxBytes = 200000 } = {}) {
  const safe = safeUrl(u);
  if (!safe) return '';
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(safe, { signal: ctrl.signal, redirect: 'follow', headers: { 'User-Agent': 'LunaBrain/1.0 (+https://travelify.io)' } });
    if (!r.ok) return '';
    const ct = (r.headers.get('content-type') || '').toLowerCase();
    if (ct && !/text|html|xml/.test(ct)) return '';
    return htmlToText((await r.text()).slice(0, maxBytes));
  } catch { return ''; } finally { clearTimeout(t); }
}
