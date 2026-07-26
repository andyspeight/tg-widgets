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
  'id,slug,name,plan,status,default_clickout_url,phone,atol_number,abta_number,'
  + 'protection_type,tg_client_email,billing_mode,call_min_seconds';

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
 * Doing the inheritance HERE, at write time, is what makes the importers'
 * promise true — "we will use your default website" — rather than something the
 * read path papers over.
 *
 * THE PHONE IS DELIBERATELY NOT INHERITED HERE, and it used to be. Once an
 * agency can hold several numbers and route them by opening hours, copying one
 * onto the deal pins it to whichever number happened to be primary that day, and
 * no amount of routing will ever reach it. booking_phone now means "this deal
 * rings somewhere different"; null means "use whichever of the agency's numbers
 * applies right now", which is what the read path already resolved anyway.
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
 * What this deal charges for: click, call, or both.
 *
 * Resolved on READ, deliberately unlike the content defaults above. Those are
 * copied onto the deal when it is written, because they are part of the advert.
 * Billing mode is a commercial setting, so switching an agency from click to
 * call has to take effect across every one of their deals at once rather than
 * needing hundreds of rows rewritten. A null on the deal means "inherit".
 *
 * Mirrors the coalesce in tb_search_deals and tb_record_click. If this changes,
 * change those too.
 */
export function resolveBillingMode(deal, agent) {
  const mode = (deal && deal.billing_mode) || (agent && agent.billing_mode) || 'click';
  return ['click', 'call', 'both'].includes(mode) ? mode : 'click';
}

/**
 * Why this deal cannot go live yet, as sentences an agent can act on.
 * Empty array means it is publishable.
 *
 * What counts as publishable depends on what the deal charges for. A click-first
 * deal is useless without somewhere to send the traveller; a call-first one is
 * useless without a number to ring. On `both` either route will do, and the deal
 * simply shows whichever it has: a missing link makes the card call-only rather
 * than blocking it.
 *
 * THIS IS NOW THE ONLY PLACE THE ROUTE IS CHECKED. It always was the only place
 * that could check it correctly, because the resolved mode and the agency's
 * numbers both live on the agents row and a CHECK constraint cannot see them.
 * Migration 009 dropped the database's route backstop for exactly that reason:
 * once the phone is inherited rather than copied, a valid call-only deal has
 * neither route column set on its own row, and the constraint refused it. The
 * database keeps the half it can verify, which is that a live deal needs a price.
 */
export function publishBlockers(merged, agent) {
  const problems = [];
  if (merged.price_from === null || merged.price_from === undefined) {
    problems.push({ field: 'price_from', message: 'Add a price before this deal can go live' });
  }

  const mode = resolveBillingMode(merged, agent);
  const hasLink = !!merged.clickout_url;
  const hasPhone = !!merged.booking_phone || !!(agent && agent.phone);

  if (mode === 'click' && !hasLink) {
    problems.push({
      field: 'clickout_url',
      message: 'Add a booking link, or set a default website on your account, before this deal can go live',
    });
  }
  if (mode === 'call' && !hasPhone) {
    problems.push({
      field: 'booking_phone',
      message: 'Add a phone number, or set one on your account, before this call-only deal can go live',
    });
  }
  if (mode === 'both' && !hasLink && !hasPhone) {
    problems.push({
      field: 'clickout_url',
      message: 'Add a booking link or a phone number before this deal can go live',
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
