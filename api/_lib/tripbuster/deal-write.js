/**
 * Shared write-path rules for Tripbuster deals.
 *
 * All three ingestion routes — the manual form, the spreadsheet importer and the
 * live offer cache — must answer the same three questions identically:
 *
 *   1. What may this agent's plan publish?
 *   2. What does a deal inherit from its agent when the deal itself is silent?
 *   3. Is this deal complete enough to go live?
 *
 * These lived in api/tripbuster/my-deals.js while the manual form was the only
 * route. They moved here when the importers arrived, so a rule can never be
 * enforced on one route and quietly skipped on another.
 */

import { tbSelect, tbRpc } from './db.js';

/**
 * Provisional live-deal allowance per plan. -1 is unlimited, 0 locks the plan
 * out of publishing entirely.
 *
 * Deliberately NOT in the database: the pricing model is still an open decision,
 * and changing a number must not need a migration. These mirror the mockups;
 * treat them as placeholders until pricing is settled.
 */
export const LIVE_DEAL_LIMITS = { Spark: 1, Boost: 5, Ignite: -1, Bespoke: -1 };

/** Live allowance for a plan. An unknown plan gets 0 — fail closed. */
export function allowanceFor(plan) {
  return Object.prototype.hasOwnProperty.call(LIVE_DEAL_LIMITS, plan) ? LIVE_DEAL_LIMITS[plan] : 0;
}

/** The agent fields the write path needs. Explicit, so no column leaks by accident. */
export const AGENT_WRITE_COLUMNS =
  'id,slug,name,plan,status,default_clickout_url,atol_number,abta_number,protection_type,tg_client_email';

/** Load an agent's own settings and fallbacks. Returns null when not found. */
export async function loadAgent(agentId) {
  const rows = await tbSelect('agents', {
    select: AGENT_WRITE_COLUMNS,
    id: `eq.${agentId}`,
    limit: 1,
  });
  return Array.isArray(rows) && rows[0] ? rows[0] : null;
}

/** Deal counts by status for one agent. */
export async function dealCounts(agentId) {
  const data = await tbRpc('tb_agent_deal_counts', { p_agent_id: agentId });
  return data || { live: 0, draft: 0, paused: 0, expired: 0, total: 0 };
}

/**
 * Fill the blanks a deal can inherit from its agent.
 *
 * The database refuses a live deal without a price and a link. Doing the
 * inheritance HERE, at write time, is what makes the importers' promise true —
 * "we will use your default website" — and keeps that database constraint
 * meaningful rather than something the read path papers over.
 *
 * Mutates and returns `deal`.
 */
export function applyAgentDefaults(deal, agent) {
  if (!agent) return deal;
  if (!deal.clickout_url && agent.default_clickout_url) deal.clickout_url = agent.default_clickout_url;
  if (!deal.atol_number && agent.atol_number) deal.atol_number = agent.atol_number;
  if (!deal.abta_number && agent.abta_number) deal.abta_number = agent.abta_number;
  if (!deal.protection_type && agent.protection_type) deal.protection_type = agent.protection_type;
  return deal;
}

/**
 * Why this deal cannot go live yet, as sentences an agent can act on.
 * Empty array means it is publishable.
 */
export function publishBlockers(merged) {
  const problems = [];
  if (merged.price_from === null || merged.price_from === undefined) {
    problems.push({ field: 'price_from', message: 'Add a price before this deal can go live' });
  }
  if (!merged.clickout_url) {
    problems.push({
      field: 'clickout_url',
      message: 'Add a booking link, or set a default website on your account, before this deal can go live',
    });
  }
  return problems;
}

/**
 * How many MORE deals this agent may publish right now.
 *
 * Returns Infinity for an unlimited plan so callers can compare without
 * special-casing -1. Used by the importers to publish what fits and leave the
 * rest as drafts, rather than failing a 200-row upload on row 6.
 */
export function publishHeadroom(plan, liveCount) {
  const limit = allowanceFor(plan);
  if (limit === -1) return Infinity;
  return Math.max(0, limit - Number(liveCount || 0));
}
