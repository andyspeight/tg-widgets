/**
 * Tripbuster agent sign-in
 * POST /api/tripbuster/login   { email, password }  → { token, agent }
 *
 * Separate from the Travelgenix client login: different user table, different
 * signing secret, different token scope. An agent signs in to Tripbuster.
 *
 * No CORS headers deliberately. This is an authenticated surface, so it is
 * same-origin only — a wildcard origin here would let any site drive it.
 */
import bcrypt from 'bcryptjs';
import { evaluatePublicRateLimit } from '../_lib/rate-limit-public.js';
import { tbConfigured, tbSelect, tbUpdate } from '../_lib/tripbuster/db.js';
import { authConfigured, createAgentToken } from '../_lib/tripbuster/auth.js';

// Compared against when no agent matches, so a missing email costs the same time
// as a wrong password and the response cannot be used to enumerate accounts.
const DUMMY_HASH = '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy';

const GENERIC = 'Those details do not match an account';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  res.setHeader('Cache-Control', 'no-store');

  const body = (req.body && typeof req.body === 'object') ? req.body : {};
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase().slice(0, 200) : '';
  const password = typeof body.password === 'string' ? body.password : '';

  // Rate limited per IP and per IP+email, so neither a single account nor the
  // whole endpoint can be ground down by guessing.
  const rl = await evaluatePublicRateLimit(req, res, { event: 'tb-login', widgetId: email });
  if (!rl.allowed) return res.status(429).json({ error: 'Too many sign-in attempts. Try again shortly.' });

  if (!email || !password) return res.status(400).json({ error: 'Enter your email and password' });
  if (!tbConfigured() || !authConfigured()) {
    return res.status(503).json({ error: 'Sign-in is not configured yet' });
  }

  try {
    const rows = await tbSelect('agents', {
      select: 'id,slug,name,email,plan,status,password_hash',
      email: `eq.${email}`,
      limit: 1,
    });
    const agent = Array.isArray(rows) && rows[0] ? rows[0] : null;

    // Always spend the bcrypt time, present account or not.
    const ok = await bcrypt.compare(password, (agent && agent.password_hash) || DUMMY_HASH);
    if (!agent || !ok) return res.status(401).json({ error: GENERIC });

    if (agent.status !== 'active') {
      const message = agent.status === 'pending'
        ? 'Your account is still being set up. We will email you when it is ready.'
        : 'This account is not active. Get in touch and we will sort it out.';
      return res.status(403).json({ error: message });
    }

    const token = createAgentToken({
      agentId: agent.id, slug: agent.slug, plan: agent.plan, email: agent.email,
    });

    // Best effort: a failed timestamp write must not fail the sign-in.
    tbUpdate('agents', { id: `eq.${agent.id}` }, { last_login_at: new Date().toISOString() },
      { returning: false }).catch(() => {});

    return res.status(200).json({
      token,
      agent: { id: agent.id, slug: agent.slug, name: agent.name, email: agent.email, plan: agent.plan },
    });
  } catch (e) {
    console.error('[tripbuster/login] failed', e && e.code, e && e.message);
    return res.status(502).json({ error: 'Could not sign you in just now. Try again.' });
  }
}
