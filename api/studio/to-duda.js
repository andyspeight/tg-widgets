/**
 * TG Studio — Send to Duda (AUTHENTICATED, Ignite/Bespoke)
 * POST /api/studio/to-duda   body: { html, css, source? }
 *
 * Turns the current (possibly refined) section into a Duda Custom Widget build
 * sheet. It does NOT reimplement the emit: it forwards to the existing, proven
 * slice-emit endpoint server-to-server, attaching the shared secret here so the
 * browser never holds it. One source of truth for the Duda prompt (slice-emit),
 * reused as-is.
 *
 * Security (travelgenix-security):
 *   1. Auth — signed-in user, then the Ignite/Bespoke gate (_gate.js).
 *   2. Rate limit — per-user; emit is a heavy model call.
 *   3. The html/css is UNTRUSTED third-party data. slice-emit already treats it
 *      as such and sanitises the returned build sheet.
 *   4. The shared secret is read from the server env and never returned.
 *   5. Fail closed on env / auth / parse.
 *
 * Env: TGS_SHARED_SECRET (required — same secret slice-emit verifies);
 *      SLICE_EMIT_URL (optional, defaults to the production slice-emit).
 * Vercel config (vercel.json): maxDuration 300 (matches slice-emit).
 */

import { requireAuth, setCors, applyRateLimit } from '../_auth.js';
import { requireStudioAccess } from './_gate.js';

const SLICE_EMIT_URL = process.env.SLICE_EMIT_URL || 'https://widgets.travelify.io/api/slice-emit';
const MAX_SECTION_BYTES = 400 * 1024;       // matches slice-emit's own cap
const FETCH_TIMEOUT_MS = 290_000;           // sits under vercel.json maxDuration:300
const TO_DUDA_RATE_LIMIT = { max: 20, windowMs: 15 * 60 * 1000 };

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // 1. Auth + plan gate
  const auth = requireAuth(req);
  if (auth.error) return res.status(auth.status).json({ error: auth.error });
  const gate = await requireStudioAccess(auth.user);
  if (!gate.ok) return res.status(gate.status).json({ error: gate.error });
  const identity = resolveIdentity(auth.user);
  if (!identity) return res.status(500).json({ error: 'Session error' });

  // 2. Rate limit
  if (!applyRateLimit(res, `studio:duda:${identity}`, TO_DUDA_RATE_LIMIT)) return; // 429 sent

  // 3. Env
  const secret = process.env.TGS_SHARED_SECRET;
  if (!secret) { console.error('[studio-to-duda] missing TGS_SHARED_SECRET'); return res.status(500).json({ error: 'Send to Duda is not configured' }); }

  // 4. Validate input
  const parsed = parseBody(req.body);
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  const { html, css, source } = parsed;

  // 5. Forward to slice-emit with the shared secret
  let upstream;
  try {
    const r = await fetchWithTimeout(SLICE_EMIT_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-tgs-secret': secret },
      body: JSON.stringify({ html, css, meta: { source } }),
    }, FETCH_TIMEOUT_MS);
    upstream = { status: r.status, body: await r.json().catch(() => ({})) };
  } catch (err) {
    if (err.name === 'AbortError' || err.name === 'TimeoutError') return res.status(504).json({ error: 'The Duda build took too long. Try a smaller section.' });
    console.error('[studio-to-duda] slice-emit fetch threw', String(err));
    return res.status(502).json({ error: 'Could not reach the Duda build step.' });
  }

  if (upstream.status !== 200 || !upstream.body || upstream.body.ok !== true || !upstream.body.buildSheet) {
    const msg = (upstream.body && upstream.body.error) ? String(upstream.body.error) : 'The Duda build step failed.';
    // Pass through the client-friendly message; upstream already sanitises detail.
    const code = upstream.status === 413 ? 413 : upstream.status === 429 ? 429 : 502;
    return res.status(code).json({ error: msg });
  }

  return res.status(200).json({ ok: true, buildSheet: upstream.body.buildSheet });
}

// ─── Input parsing ──────────────────────────────────────────────────
export function parseBody(body) {
  let b = body;
  if (typeof b === 'string') { try { b = JSON.parse(b); } catch { return { error: 'Invalid request body' }; } }
  if (!b || typeof b !== 'object') return { error: 'Invalid request body' };

  const html = typeof b.html === 'string' ? b.html : '';
  if (!html.trim()) return { error: 'Nothing to send yet. Capture a section first.' };
  const css = typeof b.css === 'string' ? b.css : '';

  const bytes = Buffer.byteLength(html, 'utf8') + Buffer.byteLength(css, 'utf8');
  if (bytes > MAX_SECTION_BYTES) return { error: 'That section is too large to build. Capture a smaller part.' };

  const source = typeof b.source === 'string' ? b.source.slice(0, 300) : '';
  return { html, css, source };
}

function resolveIdentity(user) {
  if (!user || typeof user !== 'object') return null;
  const id = (user.email || user.recordId || user.userId || user.clientId || '').toString().trim().toLowerCase();
  return id || null;
}

function fetchWithTimeout(url, options, timeoutMs) {
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    return fetch(url, { ...options, signal: AbortSignal.timeout(timeoutMs) });
  }
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  return fetch(url, { ...options, signal: ctrl.signal }).finally(() => clearTimeout(t));
}
