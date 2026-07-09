/**
 * Regression smoke test for the QA-audit high-severity fixes (2026-07-09).
 * Mounts the real widget scripts in jsdom with malicious / edge configs and
 * asserts each fix holds. Run: node test/qa-highs-smoke.mjs
 *
 * Covers:
 *   - reviews     : ctaUrl javascript: blocked, colour attribute-breakout blocked
 *   - offers-grid : columns cannot inject into the class attribute
 *   - prism       : bare-domain href repaired to https://, javascript: dropped
 *   - countdown   : missing targetDate renders nothing (not "offer ended");
 *                   a genuinely past date still shows the expired message
 *   - popup       : Vimeo autoplay produces a valid ?autoplay=1 embed URL
 */
import { readFileSync } from 'node:fs';

let JSDOM;
try { ({ JSDOM } = await import('jsdom')); }
catch { console.log('jsdom not installed — skipping QA-highs smoke (run: npm install jsdom)'); process.exit(0); }

let passed = 0, failed = 0;
const ok = (c, label) => { if (c) { passed++; } else { failed++; console.error('  FAIL:', label); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function mount(tag, scriptFile, configObj) {
  const attr = JSON.stringify(configObj).replace(/'/g, '&#39;');
  const dom = new JSDOM(
    `<!doctype html><html><body><div data-tg-widget="${tag}" data-tg-config='${attr}'></div></body></html>`,
    { runScripts: 'dangerously', url: 'https://agency.example.com/' }
  );
  const { window } = dom;
  window.fetch = async () => ({ ok: true, json: async () => ({}) });
  // jsdom has no rAF; several widgets use it for their entrance animation.
  window.requestAnimationFrame = (cb) => window.setTimeout(() => cb(0), 0);
  window.cancelAnimationFrame = (id) => window.clearTimeout(id);
  const code = readFileSync(new URL(`../public/${scriptFile}`, import.meta.url), 'utf8');
  const s = window.document.createElement('script');
  s.textContent = code;
  window.document.body.appendChild(s);
  await sleep(80);
  const host = window.document.querySelector(`[data-tg-widget="${tag}"]`);
  return { dom, host, shadow: host && host.shadowRoot };
}

// ── reviews: javascript: CTA + colour attribute-breakout ──────────────────────
{
  const { dom, shadow } = await mount('reviews', 'widget-reviews.js', {
    place: { name: 'Biz', rating: 4.8, total: 50 }, layout: 'cards',
    showCTA: true, ctaText: 'Write', ctaUrl: 'javascript:alert(1)',
    brandColor: '#000" onmouseover="alert(1)', accentColor: '#6366F1',
    reviews: [{ id: '1', author: 'A', text: 'Great stay', rating: 5, date: '2024', hasPhoto: true, photoUrl: 'javascript:alert(2)' }],
  });
  ok(!!shadow, 'reviews: shadow attached');
  if (shadow) {
    const html = shadow.innerHTML;
    ok(!/javascript:/i.test(html), 'reviews: no javascript: url reaches the DOM');
    ok(!/onmouseover/i.test(html), 'reviews: colour breakout attribute not present');
    const cta = shadow.querySelector('.tgr-cta');
    ok(cta && cta.getAttribute('href') === '#', 'reviews: javascript: ctaUrl collapsed to #');
    const root = shadow.querySelector('.tgr-root');
    ok(root && /--tgr-brand:#0891B2/.test(root.getAttribute('style') || ''), 'reviews: bad brandColor fell back to default');
  }
  dom.window.close();
}

// ── offers-grid: columns injection into the class attribute ───────────────────
{
  const { dom, shadow } = await mount('offers-grid', 'widget-offers-grid.js', {
    layout: 'vertical', columns: '2"><img src=x onerror=alert(1)>',
    offers: [{ title: 'Deal', price: 100, currency: 'GBP', image: '', url: '#' }],
  });
  ok(!!shadow, 'offers-grid: shadow attached');
  if (shadow) {
    const html = shadow.innerHTML;
    ok(!/onerror/i.test(html), 'offers-grid: no injected onerror handler');
    ok(!/<img src=x/i.test(html), 'offers-grid: no injected img element');
    const items = shadow.querySelector('.tgog-items');
    ok(!items || !/cols-2"/.test(items.className), 'offers-grid: columns coerced, no payload in class');
  }
  dom.window.close();
}

// ── prism: bare-domain repair + javascript: drop ──────────────────────────────
{
  const { dom, shadow } = await mount('prism', 'widget-prism.js', {
    items: [
      { image: '', label: 'One', href: 'example.com' },
      { image: '', label: 'Two', href: 'javascript:alert(1)' },
    ],
  });
  ok(!!shadow, 'prism: shadow attached');
  if (shadow) {
    const html = shadow.innerHTML;
    ok(!/javascript:/i.test(html), 'prism: javascript: href dropped');
    const slices = shadow.querySelectorAll('.slice');
    const first = slices[0], second = slices[1];
    ok(first && first.tagName === 'A' && first.getAttribute('href') === 'https://example.com',
      'prism: bare domain repaired to https:// anchor');
    ok(second && second.tagName !== 'A', 'prism: javascript: slice is a non-interactive div');
  }
  dom.window.close();
}

// ── countdown: missing targetDate hidden; real expiry preserved ───────────────
{
  const a = await mount('countdown', 'widget-countdown.js', {});
  ok(!!a.shadow, 'countdown(no date): shadow attached');
  if (a.shadow) {
    ok(!a.shadow.querySelector('.tgcd-expired') && !a.shadow.querySelector('.tgcd-heading'),
      'countdown: no target renders no "offer ended" element');
  }
  a.dom.window.close();

  const b = await mount('countdown', 'widget-countdown.js', {
    targetDate: '2000-01-01T00:00:00Z',
    expiry: { behaviour: 'message', message: 'Ended!' },
  });
  const exp = b.shadow && b.shadow.querySelector('.tgcd-expired');
  ok(exp && /Ended!/.test(exp.textContent), 'countdown: a genuinely past date still shows the expired message');
  b.dom.window.close();
}

// ── popup: Vimeo autoplay embed URL ───────────────────────────────────────────
{
  const { dom, shadow } = await mount('popup', 'widget-popup.js', {
    contentType: 'video', videoUrl: 'https://vimeo.com/123', videoAutoplay: true,
    trigger: 'load', triggerDelay: 0, frequency: 'every-visit',
  });
  const iframe = shadow && shadow.querySelector('iframe');
  ok(iframe && iframe.getAttribute('src') === 'https://player.vimeo.com/video/123?autoplay=1',
    'popup: Vimeo autoplay embed is a valid ?autoplay=1 url (got: ' + (iframe && iframe.getAttribute('src')) + ')');
  dom.window.close();
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
