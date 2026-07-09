/**
 * TG Studio — website capture endpoint (AUTHENTICATED)
 * POST /api/studio/capture   body: { url, selector? }
 *
 * Loads a public URL in a headless browser and runs the TG Slicer capture +
 * local emit engine IN THE PAGE — the exact same capture.js + emit-local.js the
 * Chrome extension and the smoke harness use. Returns a faithful slice
 * ({ html, css, meta }) plus a Duda build sheet. This is the "paste a link"
 * front door for TG Studio. The Slicer extension stays the way to grab a
 * precise element, or a page that sits behind a login.
 *
 * Reuse map — nothing here is new engine code:
 *   - Capture + emit : tg-slicer/capture.js, tg-slicer/emit-local.js (read from disk,
 *                      injected with addScriptTag, exactly like test/run-smoke.mjs)
 *   - Headless Chrome: the same @sparticuz/chromium + puppeteer-core path as booking-pdf.js
 *   - SSRF guard     : safeUrl() from _lib/webfetch.js (single tested copy)
 *   - Auth + limits  : requireAuth / applyRateLimit from _auth.js
 *
 * Security (travelgenix-security):
 *   1. Auth — any signed-in Travelgenix user. This is a user-facing product, not
 *      internal-only like screenshot-to-code. Plan-tier gating is a TODO (see the
 *      handover); today the gate is a valid session.
 *   2. SSRF — safeUrl() refuses non-http(s) and private / loopback / link-local /
 *      cloud-metadata hosts, and request interception re-checks every http(s)
 *      request the page makes (so a redirect or sub-resource cannot reach an
 *      internal host either). Residual: a public domain that RESOLVES to a private
 *      IP (DNS rebinding) still passes the string check — see handover follow-ups.
 *   3. Rate limit — tight per-user cap. A headless browser is expensive.
 *   4. The captured HTML/CSS is UNTRUSTED third-party data. It is returned to the
 *      client and previewed inside a sandboxed iframe. It is never executed here.
 *   5. Fail closed on env / auth / parse. Generic client errors, detail in logs.
 *
 * Vercel config (vercel.json): memory 1024, maxDuration 60, includeFiles must
 * bundle @sparticuz/chromium AND the two tg-slicer engine files.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { requireAuth, setCors, applyRateLimit } from '../_auth.js';
import { safeUrl } from '../_lib/webfetch.js';
import { requireStudioAccess } from './_gate.js';

// ─── Constants ──────────────────────────────────────────────────────
const NAV_TIMEOUT_MS = 22_000;   // page-load cap, sits under vercel maxDuration:60
const IDLE_TIMEOUT_MS = 5_000;   // brief, bounded wait for late fonts/lazy images
const SETTLE_MS = 400;           // final paint settle
const CAPTURE_EVAL_TIMEOUT_MS = 25_000; // guard the in-page walk on pathological pages
const MAX_SLICE_BYTES = 1_500_000; // raw capture can be bigger than the 400KB AI-emit cap
const VIEWPORT = { width: 1440, height: 900 };
// A normal desktop UA. Best effort at not tripping trivial bot walls; not a disguise.
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

// Capture is expensive (a whole headless browser per call), so keep the cap tight.
const CAPTURE_RATE_LIMIT = { max: 10, windowMs: 15 * 60 * 1000 };

// ─── Engine source (read once, cached for the life of the warm function) ──
let _engine = null;
function engine() {
  if (_engine) return _engine;
  // Prefer the repo root (process.cwd() on Vercel); fall back to module-relative.
  const roots = [
    path.join(process.cwd(), 'tg-slicer'),
    path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'tg-slicer'),
  ];
  for (const dir of roots) {
    try {
      const captureJs = fs.readFileSync(path.join(dir, 'capture.js'), 'utf8');
      const emitJs = fs.readFileSync(path.join(dir, 'emit-local.js'), 'utf8');
      _engine = { captureJs, emitJs };
      return _engine;
    } catch { /* try next root */ }
  }
  throw new Error('capture engine files not bundled (check vercel.json includeFiles)');
}

// ─── Headless Chrome (lazy so cold start stays cheap) — mirrors booking-pdf.js ──
let _chromium, _puppeteer;
async function getBrowser() {
  if (!_chromium) {
    _chromium = (await import('@sparticuz/chromium')).default;
    _puppeteer = (await import('puppeteer-core')).default;
  }
  return _puppeteer.launch({
    args: [..._chromium.args, '--font-render-hinting=none'],
    defaultViewport: VIEWPORT,
    executablePath: await _chromium.executablePath(),
    headless: _chromium.headless,
  });
}

// ─── Main handler ───────────────────────────────────────────────────
export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // 1. Auth — any signed-in Travelgenix user
  const auth = requireAuth(req);
  if (auth.error) return res.status(auth.status).json({ error: auth.error });
  const identity = resolveIdentity(auth.user);
  if (!identity) {
    console.error('[studio-capture] auth returned no usable identity');
    return res.status(500).json({ error: 'Session error' });
  }

  // 2. Rate limit (in-memory, always on) — protects the plan lookup below too
  if (!applyRateLimit(res, `studio:cap:${identity}`, CAPTURE_RATE_LIMIT)) return; // 429 already sent

  // 2b. Plan gate — TG Studio is Ignite/Bespoke (staff bypass). Server-side only.
  const gate = await requireStudioAccess(auth.user);
  if (!gate.ok) return res.status(gate.status).json({ error: gate.error });

  // 3. Validate input
  const parsed = parseBody(req.body);
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  const { url, selector } = parsed;

  // 4. Capture
  let browser;
  try {
    browser = await getBrowser();
    const page = await browser.newPage();
    await page.setUserAgent(UA);
    await page.setViewport(VIEWPORT);
    page.setDefaultNavigationTimeout(NAV_TIMEOUT_MS);

    // Re-check every http(s) request the page makes: blocks redirects and
    // sub-resources that try to reach an internal host. data:/blob:/about: pass.
    await page.setRequestInterception(true);
    page.on('request', (r) => {
      const u = r.url();
      if (/^https?:/i.test(u) && !safeUrl(u)) return r.abort();
      return r.continue();
    });

    // Load to DOM ready (fast and reliable), then give late fonts/lazy images a
    // brief, BOUNDED chance to settle. Chatty sites (trackers, long-poll, sockets)
    // never reach full network idle, so we do not wait for it — we cap the wait.
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
    } catch {
      await browser.close();
      return res.status(502).json({ error: 'That page took too long to load. Try a simpler page, or narrow to one section with the selector box.' });
    }
    try { await page.waitForNetworkIdle({ idleTime: 500, timeout: IDLE_TIMEOUT_MS }); } catch { /* proceed anyway */ }
    await sleep(SETTLE_MS);

    const { captureJs, emitJs } = engine();
    await page.addScriptTag({ content: captureJs });
    await page.addScriptTag({ content: emitJs });

    const out = await Promise.race([
      page.evaluate(async (sel) => {
      const pick = () => {
        if (sel) { const el = document.querySelector(sel); if (el) return el; }
        // No selector: grab the first "section-sized" block near the top
        // (usually the hero), not the whole page. A whole-page computed-style
        // capture is huge, messy, and not the point of Studio (capture a
        // section you love). The selector field and the Slicer extension are
        // the precise paths when this heuristic picks the wrong thing.
        const root = document.querySelector('main') || document.body;
        const vh = window.innerHeight || 900;
        const blocks = root.querySelectorAll('section, header, article, div');
        for (const c of blocks) {
          const r = c.getBoundingClientRect();
          // tall enough to matter, but not basically the whole page, and it
          // starts within the first screen (skips the giant page wrapper,
          // sticky navs and cookie bars).
          if (r.top >= 0 && r.top < vh && r.height >= 240 && r.height <= vh * 2.2 && r.width >= 320) return c;
        }
        return root.querySelector('section, header, article') || root;
      };
      const root = pick();
      if (!root) return { error: 'Nothing to capture on that page.' };
      try {
        const slice = await window.TGSCapture.capture(root);
        let buildSheet = null;
        try { buildSheet = window.TGSEmit.buildSheet(slice); } catch (e) { /* preview still works without it */ }
        return { slice, buildSheet };
      } catch (e) {
        return { error: 'capture-threw:' + (e && e.message ? e.message : 'unknown') };
      }
      }, selector || null),
      new Promise((resolve) => setTimeout(() => resolve({ error: 'capture-timeout' }), CAPTURE_EVAL_TIMEOUT_MS)),
    ]);

    await browser.close();
    browser = null;

    if (!out || out.error) {
      console.error('[studio-capture] in-page error:', out && out.error);
      return res.status(502).json({ error: 'That section could not be captured. Try a different page, or grab a precise element with the Slicer extension.' });
    }

    const html = (out.slice && out.slice.html) || '';
    const css = (out.slice && out.slice.css) || '';
    if (!html.trim()) return res.status(502).json({ error: 'The capture came back empty. Try a different page or element.' });

    const bytes = Buffer.byteLength(html, 'utf8') + Buffer.byteLength(css, 'utf8');
    if (bytes > MAX_SLICE_BYTES) {
      return res.status(413).json({ error: 'That section is very large. Point at one part with the selector box (try header, .hero or main), or use the Slicer extension to pick a single element.' });
    }

    return res.status(200).json({
      ok: true,
      source: url,
      slice: { html, css, meta: (out.slice && out.slice.meta) || { source: url } },
      buildSheet: out.buildSheet || null,
    });
  } catch (err) {
    console.error('[studio-capture] fatal:', err && err.message);
    if (browser) { try { await browser.close(); } catch { /* noop */ } }
    return res.status(502).json({ error: 'The capture service hit a problem. Please try again.' });
  }
}

// ─── Input parsing + validation ─────────────────────────────────────
export function parseBody(body) {
  let b = body;
  if (typeof b === 'string') { try { b = JSON.parse(b); } catch { return { error: 'Invalid request body' }; } }
  if (!b || typeof b !== 'object') return { error: 'Invalid request body' };

  const raw = typeof b.url === 'string' ? b.url.trim() : '';
  if (!raw) return { error: 'Please paste a web address to capture.' };
  const url = safeUrl(raw);
  if (!url) return { error: 'That link cannot be captured. Use a public http(s) address.' };

  // Optional CSS selector to narrow the capture to one section. Kept short and
  // simple; it runs through querySelector in-page so it cannot execute code, but
  // we still bound it and reject the obviously silly.
  let selector = '';
  if (b.selector != null) {
    if (typeof b.selector !== 'string') return { error: 'Selector must be text' };
    selector = b.selector.trim().slice(0, 200);
    if (/[<>{}]/.test(selector)) return { error: 'That selector is not valid.' };
  }
  return { url, selector };
}

// Rate-limit identity: the legacy Bearer token carries email; the unified cookie
// carries userId/clientId. Use whatever stable id is present. (Mirrors s2c.)
function resolveIdentity(user) {
  if (!user || typeof user !== 'object') return null;
  const id = (user.email || user.recordId || user.userId || user.clientId || '').toString().trim().toLowerCase();
  return id || null;
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
