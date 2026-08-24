/* Phone-width bleed check: no sideways scroll, no text within 8px of the edge. */
import { chromium } from 'playwright';
import { readdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';

const dir = new URL('./coastwise-preview/', import.meta.url).pathname;
const files = readdirSync(dir).filter((f) => f.endsWith('.html'));
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
let bad = 0;
for (const f of files) {
  await page.goto(pathToFileURL(join(dir, f)).href);
  await page.waitForTimeout(250);
  const r = await page.evaluate(() => {
    const overflow = document.documentElement.scrollWidth - window.innerWidth;
    const hits = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = walker.nextNode())) {
      if (!n.textContent.trim()) continue;
      const range = document.createRange();
      range.selectNodeContents(n);
      for (const b of range.getClientRects()) {
        if (b.width === 0) continue;
        // Ignore boxes parked off-canvas by a rail/slider or a closed menu.
        if (b.right <= 0 || b.left >= window.innerWidth) continue;
        if (b.left < 8 || b.right > window.innerWidth - 8) {
          const el = n.parentElement;
          // Invisible text (a closed dropdown panel) has geometry but no pixels.
          if (getComputedStyle(el).visibility !== 'visible') continue;
          // Closed <details> content keeps layout boxes in Chromium but never
          // paints; only the summary is really on screen.
          if (el.closest('details:not([open])') && !el.closest('summary')) continue;
          // Screen-reader-only text is clipped from paint but keeps geometry.
          if (el.closest('.tgs-sr-only')) continue;
          // Skip if any ancestor scrolls horizontally: content inside its own
          // rail is allowed to touch the rail's edge.
          let a = el, scrolls = false;
          while (a && a !== document.body) {
            const s = getComputedStyle(a);
            if ((s.overflowX === 'auto' || s.overflowX === 'scroll') && a.scrollWidth > a.clientWidth) { scrolls = true; break; }
            a = a.parentElement;
          }
          if (!scrolls) hits.push(`${n.textContent.trim().slice(0, 40)} @ ${Math.round(b.left)}..${Math.round(b.right)}`);
        }
      }
    }
    return { overflow, hits: hits.slice(0, 4) };
  });
  const ok = r.overflow === 0 && r.hits.length === 0;
  if (!ok) bad++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${f.padEnd(28)} overflow=${r.overflow}${r.hits.length ? ' ' + JSON.stringify(r.hits) : ''}`);
}
await browser.close();
process.exit(bad ? 1 : 0);
