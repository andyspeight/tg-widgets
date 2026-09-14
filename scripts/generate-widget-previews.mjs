/**
 * Pre-render a preview image for every widget in the registry.
 *
 * The Travelify directory contract requires an absolute HTTPS imageUrl per
 * widget. The dashboard already renders a live 700x340 mini preview of each
 * one (loadMiniPreview in public/index.html), so rather than commission art we
 * screenshot those and commit the results to public/previews/.
 *
 * Rendering happens against the deployed dashboard by default, so the
 * previews that pull live data (offers, spotlight, weather) capture real
 * content rather than an empty state. Pass --base http://localhost:3000 to
 * shoot a local build instead.
 *
 * Each preview is lifted into a clean fixed-position stage before capture:
 * on the dashboard the preview is scaled to 0.55 inside a clipped card, and
 * we want the full-resolution frame, not the thumbnail.
 *
 * Run: node scripts/generate-widget-previews.mjs   (npm run build:widget-previews)
 * Flags:
 *   --base <url>   origin to shoot (default https://tg-widgets.vercel.app)
 *   --only a,b,c   re-shoot just these widget ids
 *   --settle <ms>  how long to let widgets fetch and draw (default 18000)
 *   --fallback a,b force the branded card for these ids instead of a capture
 *   --probe        report what would be captured, write nothing
 *   --chromium <p> browser binary to use (default: TG_CHROMIUM_PATH, else the
 *                  sandbox's preinstalled /opt/pw-browsers/chromium, else
 *                  whichever build Playwright resolves for itself)
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { WIDGET_REGISTRY } from '../api/_lib/widget-registry.js';

const arg = (flag, fallback) => {
  const i = process.argv.indexOf(flag);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const BASE = arg('--base', 'https://tg-widgets.vercel.app').replace(/\/$/, '');
const ONLY = arg('--only', '').split(',').map((s) => s.trim()).filter(Boolean);
const FORCED = arg('--fallback', '').split(',').map((s) => s.trim()).filter(Boolean);
const PROBE = process.argv.includes('--probe');

const WIDTH = 700;
const HEIGHT = 340;
const SCALE = 2;                       // retina-sharp tiles
const MIN_SCALE = 0.5;                 // floor for shrink-to-fit, see below
const INK_FLOOR = 0.012;               // below this a tile counts as blank
const OUT_DIR = new URL('../public/previews/', import.meta.url);

const targets = WIDGET_REGISTRY.filter((w) => !ONLY.length || ONLY.includes(w.id));
if (!PROBE) mkdirSync(OUT_DIR, { recursive: true });

// Prefer an already-present browser over downloading one: CI images commonly
// ship a Chromium that does not match the build this Playwright expects.
const PINNED = arg('--chromium', process.env.TG_CHROMIUM_PATH || '/opt/pw-browsers/chromium');
// Honour an outbound HTTPS proxy if the environment sets one. Chromium does
// not read HTTPS_PROXY by itself, and sandboxed CI runners usually require it.
const PROXY = process.env.HTTPS_PROXY || process.env.https_proxy || '';
const browser = await chromium.launch({
  ...(existsSync(PINNED) ? { executablePath: PINNED } : {}),
  ...(PROXY ? { proxy: { server: PROXY, bypass: 'localhost,127.0.0.1' } } : {}),
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--font-render-hinting=none'],
});
const page = await browser.newPage({
  viewport: { width: 1600, height: 1200 },
  deviceScaleFactor: SCALE,
});

const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 160)));

console.log(`Shooting ${targets.length} previews from ${BASE}`);
await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 120000 });

// The catalogue instantiates every live widget on render. Give the engines and
// their network-backed content time to settle before capturing anything.
await page.waitForSelector('#prev_pricing', { timeout: 60000 });
await page.waitForTimeout(Number(arg('--settle', '18000')));

// One reusable stage. Taking the preview out of its clipped, scaled card is
// what lets us capture the full 700x340 frame.
await page.evaluate(({ w, h }) => {
  const stage = document.createElement('div');
  stage.id = 'tg-capture-stage';
  stage.style.cssText = `position:fixed;left:0;top:0;z-index:2147483647;background:#fff;`
    + `width:${w}px;height:${h}px;overflow:hidden;display:flex;align-items:flex-start;justify-content:center`;
  document.body.appendChild(stage);
}, { w: WIDTH, h: HEIGHT });


/** Fraction of non-white pixels in a captured tile, sampled at low resolution. */
async function measureInk(page, buf) {
  return page.evaluate(async (dataUrl) => {
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = dataUrl; });
    const c = document.createElement('canvas');
    c.width = 175; c.height = 85;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(img, 0, 0, c.width, c.height);
    const px = ctx.getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 0; i < px.length; i += 4) {
      if (px[i] < 240 || px[i + 1] < 240 || px[i + 2] < 240) n++;
    }
    return n / (c.width * c.height);
  }, 'data:image/png;base64,' + buf.toString('base64'));
}

/**
 * Branded card for a widget that will not photograph: its icon and name on a
 * tint of its own brand colour. Mirrors the dashboard's existing "Coming Soon"
 * placeholder, so a fallback tile still looks like part of the suite.
 */
async function drawFallback(page, widget, w, h) {
  await page.evaluate(({ name, color, viewBox, paths, w, h }) => {
    const stage = document.getElementById('tg-capture-stage');
    stage.style.alignItems = 'center';
    stage.replaceChildren();

    const card = document.createElement('div');
    card.style.cssText = `width:${w}px;height:${h}px;box-sizing:border-box;display:flex;`
      + `flex-direction:column;align-items:center;justify-content:center;gap:20px;`
      + `background:color-mix(in srgb, ${color} 7%, #fff);`
      + `border:1px solid color-mix(in srgb, ${color} 16%, #fff)`;

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', viewBox);
    svg.setAttribute('width', '76');
    svg.setAttribute('height', '76');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', color);
    svg.setAttribute('stroke-width', '1.4');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.innerHTML = paths;

    const label = document.createElement('div');
    label.style.cssText = "font:600 27px/1.25 'DM Sans',system-ui,-apple-system,'Segoe UI',sans-serif;"
      + 'color:#0F172A;letter-spacing:-.01em';
    label.textContent = name;

    card.append(svg, label);
    stage.appendChild(card);
  }, { name: widget.name, color: widget.color || '#0F172A', viewBox: widget.icon.viewBox, paths: widget.icon.paths, w, h });
}

const empty = [];
const written = [];
const fellBack = [];

for (const widget of targets) {
  // Move the preview into the stage, drop the thumbnail transform, and let it
  // reflow at full width before the shot.
  const state = await page.evaluate(({ id, w, h, minScale }) => {
    const el = document.getElementById('prev_' + id);
    const stage = document.getElementById('tg-capture-stage');
    if (!el) return { ok: false, reason: 'no container' };

    stage.replaceChildren(el);
    el.style.cssText = `transform:none;width:${w}px;flex:none;pointer-events:none`;

    // Most widgets are taller than the tile. Shrink to fit so the whole widget
    // is visible, but never below minScale: a 2000px-tall widget squeezed into
    // 340px is unreadable, and an unreadable tile is worse than a cropped one.
    // Anchor to the top either way, so a cropped tile keeps the heading rather
    // than showing a slice out of the middle.
    const natural = Math.max(el.scrollHeight, el.getBoundingClientRect().height, 1);
    const scale = Math.min(1, Math.max(minScale, h / natural));
    el.style.transform = `scale(${scale})`;
    el.style.transformOrigin = 'top center';
    // Centre vertically only when the widget genuinely fits, so short widgets
    // sit in the middle of the tile instead of floating at the top.
    stage.style.alignItems = natural <= h ? 'center' : 'flex-start';

    const host = el.firstElementChild;
    const shadow = host && host.shadowRoot ? host.shadowRoot.innerHTML.length : 0;
    return { ok: true, light: el.innerHTML.length, shadow, natural: Math.round(natural), scale: +scale.toFixed(2) };
  }, { id: widget.id, w: WIDTH, h: HEIGHT, minScale: MIN_SCALE });

  if (!state.ok) { empty.push(`${widget.id} (${state.reason})`); continue; }

  // A widget that drew nothing is worse than no preview at all, so flag it
  // rather than committing a blank tile.
  if (state.light < 120 && state.shadow < 120) {
    empty.push(`${widget.id} (rendered empty)`);
    continue;
  }

  await page.waitForTimeout(450);
  if (PROBE) {
    written.push(`${widget.id} (${state.natural}px @ ${state.scale}x)`);
    continue;
  }

  let buf = await page.locator('#tg-capture-stage').screenshot({ type: 'png' });

  // Some widgets cannot be photographed: an animation caught between frames,
  // an overlay that only exists on interaction, or one whose content comes
  // from a third-party API we cannot reach at build time. A near-blank tile
  // looks broken in the directory, so draw the branded card instead.
  const ink = await measureInk(page, buf);
  if (FORCED.includes(widget.id) || ink < INK_FLOOR) {
    await drawFallback(page, widget, WIDTH, HEIGHT);
    buf = await page.locator('#tg-capture-stage').screenshot({ type: 'png' });
    fellBack.push(`${widget.id} (${(ink * 100).toFixed(1)}% ink)`);
  }

  writeFileSync(new URL(`${widget.id}.png`, OUT_DIR), buf);
  written.push(widget.id);
}

await browser.close();

console.log('');
console.log(`${PROBE ? 'would capture' : 'captured'}: ${written.length}/${targets.length}`);
if (fellBack.length) {
  console.log(`branded card instead of a capture (${fellBack.length}):`);
  for (const f of fellBack) console.log('  · ' + f);
}
if (empty.length) {
  console.log(`no preview (${empty.length}):`);
  for (const e of empty) console.log('  ⚠ ' + e);
}
if (pageErrors.length) {
  console.log(`page errors (${pageErrors.length}), first 5:`);
  for (const e of pageErrors.slice(0, 5)) console.log('  · ' + e);
}
if (!PROBE && !existsSync(new URL('pricing.png', OUT_DIR))) {
  console.error('✗ expected at least pricing.png to be written');
  process.exit(1);
}
