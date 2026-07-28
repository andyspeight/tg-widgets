/**
 * Tripbuster owner console
 *
 *   POST  /api/tripbuster/admin?action=login   { password } → { token }
 *   GET   /api/tripbuster/admin?days=30                     → every agency
 *   PATCH /api/tripbuster/admin  { agentId, freeUntil?, clearFree?, rateTier?, status? }
 *
 * The one screen that is ours rather than an agency's: who is advertising, what
 * they are generating, what it is worth, and the three commercial levers —
 * a free period, a rate tier, and whether they are trading.
 *
 * ── WHY A PASSWORD AND NOT AN ACCOUNT ──────────────────────────────────────
 *
 * There is one owner. A users table, invitations and roles would be real work in
 * service of a single person, and the thing that actually matters — that this
 * cannot be reached by an agency or by the public — is delivered by a separate
 * token scope either way. When there is a second person who needs it, this wants
 * turning into proper accounts rather than a shared password.
 *
 * The session is eight hours rather than an agent's twenty-four, because this
 * token can change what every agency on the platform is charged.
 *
 * NO CORS HEADERS. Same-origin only, deliberately.
 */
import { evaluatePublicRateLimit } from '../_lib/rate-limit-public.js';
import { tbConfigured, tbRpc } from '../_lib/tripbuster/db.js';
import {
  adminConfigured, adminPasswordOk, createAdminToken, requireAdmin,
} from '../_lib/tripbuster/auth.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIERS = ['standard', 'premium'];
const STATUSES = ['pending', 'active', 'paused', 'suspended'];

function body(req) {
  let b = req.body;
  if (typeof b === 'string') {
    try { b = JSON.parse(b); } catch { b = {}; }
  }
  return (b && typeof b === 'object' && !Array.isArray(b)) ? b : {};
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  // Nothing here should ever be framed or leak its URL onward.
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');

  if (!adminConfigured()) {
    return res.status(503).json({
      error: 'The owner console is not configured. Set TRIPBUSTER_ADMIN_PASSWORD.',
    });
  }
  if (!tbConfigured()) return res.status(503).json({ error: 'Database not configured' });

  const action = typeof (req.query || {}).action === 'string' ? req.query.action : '';

  // ── signing in ──────────────────────────────────────────────────────────
  if (req.method === 'POST' && action === 'login') {
    // As strict as the agent sign-in. One password guarded by rate limiting is
    // the whole defence here, so the ceiling matters more than usual.
    const rl = await evaluatePublicRateLimit(req, res, { event: 'tb-login', widgetId: 'admin' });
    if (!rl.allowed) {
      return res.status(429).json({ error: 'Too many attempts. Try again shortly.' });
    }
    if (!adminPasswordOk(body(req).password)) {
      // Deliberately the same generic wording as the agent sign-in.
      return res.status(401).json({ error: 'That password does not match' });
    }
    return res.status(200).json({ token: createAdminToken() });
  }

  const gate = requireAdmin(req);
  if (!gate.ok) return res.status(gate.status).json({ error: gate.error });

  try {
    if (req.method === 'GET') {
      const raw = parseInt((req.query || {}).days, 10);
      const days = Number.isFinite(raw) ? Math.max(1, Math.min(365, raw)) : 30;
      const agencies = await tbRpc('tb_admin_agencies', { p_days: days });
      return res.status(200).json({ days, agencies: agencies || [] });
    }

    if (req.method === 'PATCH') {
      const b = body(req);
      const agentId = typeof b.agentId === 'string' ? b.agentId.trim() : '';
      if (!agentId) return res.status(400).json({ error: 'Which agency?' });

      const errors = [];
      let freeUntil = null;
      const clearFree = b.clearFree === true;

      if (!clearFree && b.freeUntil !== undefined && b.freeUntil !== null && b.freeUntil !== '') {
        if (typeof b.freeUntil !== 'string' || !DATE_RE.test(b.freeUntil)) {
          errors.push({ field: 'freeUntil', message: 'Use a date like 2027-01-31' });
        } else if (Number.isNaN(new Date(`${b.freeUntil}T00:00:00Z`).getTime())) {
          errors.push({ field: 'freeUntil', message: 'That is not a real date' });
        } else {
          freeUntil = b.freeUntil;
        }
      }

      let rateTier = null;
      if (b.rateTier !== undefined && b.rateTier !== null && b.rateTier !== '') {
        if (!TIERS.includes(b.rateTier)) {
          errors.push({ field: 'rateTier', message: 'Choose standard or premium' });
        } else {
          rateTier = b.rateTier;
        }
      }

      let status = null;
      if (b.status !== undefined && b.status !== null && b.status !== '') {
        if (!STATUSES.includes(b.status)) {
          errors.push({ field: 'status', message: 'Not a status we recognise' });
        } else {
          status = b.status;
        }
      }

      if (errors.length) return res.status(422).json({ error: 'Some details need fixing', errors });
      if (!clearFree && !freeUntil && !rateTier && !status) {
        return res.status(400).json({ error: 'Nothing to change' });
      }

      const saved = await tbRpc('tb_admin_set_agency', {
        p_agent_id: agentId,
        p_free_until: freeUntil,
        p_clear_free: clearFree,
        p_rate_tier: rateTier,
        p_status: status,
      });
      if (!saved || !saved.ok) {
        return res.status(404).json({ error: 'Could not find that agency' });
      }
      return res.status(200).json(saved);
    }

    res.setHeader('Allow', 'GET, POST, PATCH');
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    console.error('[tripbuster/admin] failed', req.method, e && e.code, e && e.message);
    return res.status(502).json({ error: 'Could not do that just now. Try again.' });
  }
}
