/* grab.mjs through a real browser, for sites that refuse plain requests (403).

   Usage: node grabb.mjs <IATA> <label> <url> [regex]

   Same output as grab.mjs: the page's visible text saved to
   $SWEEP_EVIDENCE/<IATA>/<label>.txt with URL, fetch time and status, then the
   matching lines. It reads what a visitor would see (document.body.innerText),
   waits for the page to settle, and gives up after 60 seconds. It does not log
   in, solve challenges or get round paywalls: a page that still refuses a
   browser is recorded as refused, and the auditor finds another publisher. */
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const EVIDENCE = process.env.SWEEP_EVIDENCE ||
  '/tmp/claude-0/-home-user-tg-widgets/aa74082d-0375-5ea9-97e1-bfee8cc3073d/scratchpad/sweep/evidence';
const [iata, label, url, re] = process.argv.slice(2);
if (!iata || !label || !url) { console.error('usage: node grabb.mjs <IATA> <label> <url> [regex]'); process.exit(2); }

const proxy = process.env.HTTPS_PROXY || process.env.https_proxy;
const browser = await chromium.launch({
  // The repo pins a newer Playwright than the pre-installed browser; use that browser directly.
  executablePath: fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined,
  proxy: proxy ? { server: proxy } : undefined,
});
const ctx = await browser.newContext({
  locale: 'en-GB',
  userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36',
  ignoreHTTPSErrors: false,
});
const page = await ctx.newPage();
let status = 0, text = '', err = '';
try {
  const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  status = resp ? resp.status() : 0;
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  text = await page.evaluate(() => document.body ? document.body.innerText : '');
} catch (e) { err = String(e.message || e).split('\n')[0]; }
await browser.close();

const dir = path.join(EVIDENCE, iata.toUpperCase());
fs.mkdirSync(dir, { recursive: true });
const file = path.join(dir, label + '.txt');
fs.writeFileSync(file, `URL: ${url}\nFETCHED: ${new Date().toISOString()}\nHTTP: ${status || 'ERR ' + err}\nKIND: browser\n----\n${text}`);
console.log(`HTTP ${status || 'ERR ' + err}  browser  -> ${file} (${text.length} chars)`);
if (re) {
  const rx = new RegExp(re, 'i'); let n = 0;
  for (const [i, l] of text.split('\n').map(s => s.trim()).filter(Boolean).entries()) {
    if (rx.test(l)) { console.log(String(i).padStart(5) + ': ' + l.slice(0, 400)); if (++n >= 40) break; }
  }
  if (!n) console.log('  (no lines match /' + re + '/)');
}
