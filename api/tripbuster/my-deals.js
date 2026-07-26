/**
 * Tripbuster agent deal management (the write path)
 *
 *   GET    /api/tripbuster/my-deals            → this agent's deals + counts + allowance
 *   POST   /api/tripbuster/my-deals            → create a deal
 *   PATCH  /api/tripbuster/my-deals?id=<uuid>  → update a deal
 *   DELETE /api/tripbuster/my-deals?id=<uuid>  → delete a deal
 *
 * Every operation is scoped to the agent in the bearer token. `agent_id` is taken
 * from the token and never from the body, and updates and deletes filter on
 * agent_id as well as id, so one agent cannot touch another's deals even with a
 * valid session and a guessed id.
 *
 * No CORS headers deliberately: authenticated surface, same-origin only.
 */
import { requireAgent } from '../_lib/tripbuster/auth.js';
import { validateDeal } from '../_lib/tripbuster/deal-schema.js';
import { tbConfigured, tbSelect, tbInsert, tbUpdate, tbDelete, tbRpc } from '../_lib/tripbuster/db.js';
// The publish rules and agent-default inheritance are shared with the two bulk
// importers, so all three ingestion routes behave identically.
import {
  allowanceFor, loadAgent, dealCounts as counts, applyAgentDefaults, publishBlockers,
} from '../_lib/tripbuster/deal-write.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Columns returned to the dashboard. Chosen explicitly so a future column cannot
// leak by accident.
const DEAL_COLUMNS = [
  'id', 'status', 'title', 'strapline', 'holiday_type', 'reference',
  'country', 'region', 'resort', 'accommodation_name', 'star_rating', 'guest_score',
  'distance_to_beach', 'distance_to_airport', 'overview',
  'board_basis', 'room_type', 'adults', 'children', 'infants', 'facilities',
  'departure_airports', 'airline', 'flight_duration', 'cabin_bag', 'hold_luggage', 'transfers',
  'availability_type', 'nights', 'travel_from', 'travel_until', 'booking_deadline',
  'availability_status', 'spaces_left',
  'price_from', 'price_basis', 'was_price', 'deposit_from', 'child_price_from',
  'single_supplement', 'currency', 'price_includes', 'local_charges',
  'offer_badges', 'selling_points', 'hero_image_url', 'gallery', 'video_url',
  'clickout_url', 'booking_phone', 'protection_type', 'atol_number', 'abta_number', 'terms_url',
  'source', 'external_ref', 'billing_mode', 'discount_pct', 'created_at', 'updated_at', 'published_at',
].join(',');

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  const gate = requireAgent(req);
  if (!gate.ok) return res.status(gate.status).json({ error: gate.error });
  if (!tbConfigured()) return res.status(503).json({ error: 'Deals service is not configured yet' });

  const agentId = gate.agent.agentId;
  if (!UUID_RE.test(String(agentId))) return res.status(401).json({ error: 'Sign in again to continue' });

  const id = typeof req.query?.id === 'string' ? req.query.id : '';
  const body = (req.body && typeof req.body === 'object' && !Array.isArray(req.body)) ? req.body : {};

  try {
    // ── list ────────────────────────────────────────────────────
    if (req.method === 'GET') {
      // Window for the performance figures. Defaults to 30 days.
      const days = Math.max(1, Math.min(365, parseInt(req.query?.days, 10) || 30));
      const [deals, stats, agent, perf] = await Promise.all([
        tbSelect('deals', {
          select: DEAL_COLUMNS,
          agent_id: `eq.${agentId}`,
          order: 'updated_at.desc',
          limit: 200,
        }),
        counts(agentId),
        loadAgent(agentId),
        // Performance is best-effort: an agent must still be able to manage their
        // deals if the stats rollup is unavailable for any reason.
        tbRpc('tb_agent_stats', { p_agent_id: agentId, p_days: days }).catch((e) => {
          console.warn('[tripbuster/my-deals] stats unavailable', e && e.code);
          return null;
        }),
      ]);
      const limit = allowanceFor(agent?.plan || gate.agent.plan);
      return res.status(200).json({
        deals: Array.isArray(deals) ? deals : [],
        counts: stats,
        plan: agent?.plan || gate.agent.plan,
        liveAllowance: limit,
        liveRemaining: limit === -1 ? -1 : Math.max(0, limit - Number(stats.live || 0)),
        stats: perf,
        agent: agent
          ? {
            slug: agent.slug,
            name: agent.name,
            defaultClickoutUrl: agent.default_clickout_url || null,
            phone: agent.phone || null,
            // The agency default a deal falls back to when its own mode is null.
            billingMode: agent.billing_mode || 'click',
            callMinSeconds: agent.call_min_seconds ?? 60,
          }
          : null,
      });
    }

    // ── create ──────────────────────────────────────────────────
    if (req.method === 'POST') {
      const { ok, deal, errors } = validateDeal(body, { partial: false });
      if (!ok) return res.status(422).json({ error: 'Some details need fixing', errors });

      const agent = await loadAgent(agentId);
      if (!agent) return res.status(401).json({ error: 'Sign in again to continue' });
      if (agent.status !== 'active') return res.status(403).json({ error: 'This account is not active' });

      applyAgentDefaults(deal, agent);

      const wantsLive = deal.status === 'live';
      if (wantsLive) {
        const blockers = publishBlockers(deal, agent);
        if (blockers.length) {
          return res.status(422).json({ error: 'This deal is not ready to go live', errors: blockers });
        }
        const limit = allowanceFor(agent.plan);
        if (limit === 0) {
          return res.status(403).json({ error: `Your ${agent.plan} plan does not include live deals yet` });
        }
        if (limit > 0) {
          const stats = await counts(agentId);
          if (Number(stats.live || 0) >= limit) {
            return res.status(403).json({
              error: `You are using all ${limit} live deals on ${agent.plan}. Pause one, or upgrade for more.`,
              liveAllowance: limit,
            });
          }
        }
        deal.published_at = new Date().toISOString();
      }

      // Ownership and provenance are set here, never accepted from the body.
      deal.agent_id = agentId;
      deal.source = 'manual';

      const created = await tbInsert('deals', [deal], { returning: true });
      const row = Array.isArray(created) && created[0] ? created[0] : null;
      return res.status(201).json({ deal: row, id: row?.id });
    }

    // ── update ──────────────────────────────────────────────────
    if (req.method === 'PATCH') {
      if (!UUID_RE.test(id)) return res.status(400).json({ error: 'Which deal? A valid deal id is required' });

      const { ok, deal, errors } = validateDeal(body, { partial: true });
      if (!ok) return res.status(422).json({ error: 'Some details need fixing', errors });
      if (!Object.keys(deal).length) return res.status(400).json({ error: 'Nothing to update' });

      const existingRows = await tbSelect('deals', {
        // booking_phone and billing_mode come along because whether this deal is
        // publishable now depends on what it charges for, not just on having a link.
        select: 'id,status,price_from,clickout_url,booking_phone,billing_mode',
        id: `eq.${id}`,
        agent_id: `eq.${agentId}`,
        limit: 1,
      });
      const existing = Array.isArray(existingRows) && existingRows[0] ? existingRows[0] : null;
      // Same response whether the deal is missing or someone else's — no probing.
      if (!existing) return res.status(404).json({ error: 'Deal not found' });

      const agent = await loadAgent(agentId);
      if (!agent) return res.status(401).json({ error: 'Sign in again to continue' });

      const goingLive = deal.status === 'live' && existing.status !== 'live';
      if (goingLive) {
        const merged = applyAgentDefaults({
          price_from: deal.price_from !== undefined ? deal.price_from : existing.price_from,
          clickout_url: deal.clickout_url !== undefined ? deal.clickout_url : existing.clickout_url,
          booking_phone: deal.booking_phone !== undefined ? deal.booking_phone : existing.booking_phone,
          billing_mode: deal.billing_mode !== undefined ? deal.billing_mode : existing.billing_mode,
        }, agent);
        const blockers = publishBlockers(merged, agent);
        if (blockers.length) {
          return res.status(422).json({ error: 'This deal is not ready to go live', errors: blockers });
        }
        if (merged.clickout_url && !deal.clickout_url) deal.clickout_url = merged.clickout_url;
        if (merged.booking_phone && !deal.booking_phone) deal.booking_phone = merged.booking_phone;

        const limit = allowanceFor(agent.plan);
        if (limit === 0) {
          return res.status(403).json({ error: `Your ${agent.plan} plan does not include live deals yet` });
        }
        if (limit > 0) {
          const stats = await counts(agentId);
          if (Number(stats.live || 0) >= limit) {
            return res.status(403).json({
              error: `You are using all ${limit} live deals on ${agent.plan}. Pause one, or upgrade for more.`,
              liveAllowance: limit,
            });
          }
        }
        deal.published_at = new Date().toISOString();
      }

      const updated = await tbUpdate('deals', { id: `eq.${id}`, agent_id: `eq.${agentId}` }, deal);
      const row = Array.isArray(updated) && updated[0] ? updated[0] : null;
      if (!row) return res.status(404).json({ error: 'Deal not found' });
      return res.status(200).json({ deal: row });
    }

    // ── delete ──────────────────────────────────────────────────
    if (req.method === 'DELETE') {
      if (!UUID_RE.test(id)) return res.status(400).json({ error: 'Which deal? A valid deal id is required' });
      const removed = await tbDelete('deals', { id: `eq.${id}`, agent_id: `eq.${agentId}` });
      if (!Array.isArray(removed) || !removed.length) {
        return res.status(404).json({ error: 'Deal not found' });
      }
      return res.status(200).json({ deleted: removed[0].id });
    }

    res.setHeader('Allow', 'GET, POST, PATCH, DELETE');
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    console.error('[tripbuster/my-deals] failed', req.method, e && e.code, e && e.message);
    return res.status(502).json({ error: 'Could not save that just now. Try again.' });
  }
}
