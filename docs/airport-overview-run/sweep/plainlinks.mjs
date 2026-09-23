/* List the links on a page from a plain fetch, the same request grab.mjs makes.

   Usage: node plainlinks.mjs <url> [regex]

   For sites that answer grab.mjs but refuse links.mjs's headless browser
   (Cologne Bonn's, 23 Sep evening). Prints "address | text" for each distinct
   link whose address or text matches the regex. Finding only: nothing it
   prints is evidence, and it never retries or falls back to another tool. */
const [url, re = '.'] = process.argv.slice(2);
if (!url) { console.error('usage: node plainlinks.mjs <url> [regex]'); process.exit(2); }

const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const res = await fetch(url, {
  redirect: 'follow',
  headers: { 'User-Agent': UA, 'Accept': 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8', 'Accept-Language': 'en-GB,en;q=0.9' },
  signal: AbortSignal.timeout(60000),
}).catch(e => ({ status: 0, error: String(e.cause?.code || e.message) }));
if (!res.status) { console.log('no answer: ' + res.error); process.exit(1); }
const html = res.status ? await res.text() : '';
const rx = new RegExp(re, 'i');
const seen = new Set();
const decode = s => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&nbsp;/g, ' ');
const links = [...html.replace(/<!--[\s\S]*?-->/g, ' ').matchAll(/<a\b[^>]*?href\s*=\s*["']([^"'#][^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi)]
  .map(m => [new URL(decode(m[1]), res.url || url).href, decode(m[2].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim()]);
console.log(`HTTP ${res.status}  ${links.length} links`);
for (const [href, text] of links) {
  if (seen.has(href) || !(rx.test(href) || rx.test(text))) continue;
  seen.add(href);
  console.log(`${href} | ${text.slice(0, 120)}`);
}
