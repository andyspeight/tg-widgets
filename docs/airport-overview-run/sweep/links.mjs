/* List the links on a page, through a real browser, to find a source without a
   search engine.

   Usage: node links.mjs <url> [regex]

   Prints each distinct link whose address or text matches the regex, as
   "address | text". It only helps FIND a page: nothing it prints is evidence.
   Save the page itself with grab.mjs or grabb.mjs before quoting it. */
import fs from 'node:fs';
import { chromium } from 'playwright';

const [url, re = '.'] = process.argv.slice(2);
if (!url) { console.error('usage: node links.mjs <url> [regex]'); process.exit(2); }

const proxy = process.env.HTTPS_PROXY || process.env.https_proxy;
const browser = await chromium.launch({
  executablePath: fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined,
  proxy: proxy ? { server: proxy } : undefined,
});
try {
  const page = await browser.newPage({ locale: 'en-GB' });
  const res = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(2500);
  const links = await page.$$eval('a[href]', as => as.map(a => [a.href, (a.innerText || '').trim().replace(/\s+/g, ' ')]));
  const rx = new RegExp(re, 'i');
  const seen = new Set();
  console.log(`HTTP ${res ? res.status() : '?'}  ${links.length} links`);
  for (const [href, text] of links) {
    if (seen.has(href) || !(rx.test(href) || rx.test(text))) continue;
    seen.add(href);
    console.log(`${href} | ${text.slice(0, 90)}`);
  }
} finally {
  await browser.close();
}
