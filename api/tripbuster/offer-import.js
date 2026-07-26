/**
 * Tripbuster live offer cache import (ingestion route 3 of 3).
 *
 *   GET  /api/tripbuster/offer-import   → browse matching offers (writes nothing)
 *   POST /api/tripbuster/offer-import   → import the chosen offers
 *   POST /api/tripbuster/offer-import  { resync: true } → refresh prices on
 *                                        deals already imported this way
 *
 * Only available to agents who are also Travelgenix clients, which is what
 * agents.tg_client_email records. Everyone else gets a 403 carrying
 * `connected: false`, which is what the dashboard turns into the "connect your
 * Travelgenix account" panel rather than an error.
 *
 * THE CLIENT NEVER SENDS DEAL DATA. It sends the ids of offers it wants, and
 * this endpoint re-reads those offers from the cache and builds the deals
 * server-side. So a hand-edited request can choose WHICH offers to import but
 * never WHAT they say — no forged price, no injected booking link.
 *
 * Provenance is set here: source is always 'live_cache' and agent_id always
 * comes from the bearer token.
 *
 * No CORS headers deliberately: authenticated surface, same-origin only.
 */

import { requireAgent } from '../_lib/tripbuster/auth.js';
import { validateDeal, DEAL_ENUMS } from '../_lib/tripbuster/deal-schema.js';
import { tbConfigured, tbSelect, tbInsert, tbUpdate } from '../_lib/tripbuster/db.js';
import {
  loadAgent, dealCounts, applyAgentDefaults, publishBlockers, publishHeadroom, allowanceFor,
} from '../_lib/tripbuster/deal-write.js';
import {
  queryOfferCache, cachedCountries, offerCacheConfigured, offerToDeal, offerRef,
  countryName, RESYNC_FIELDS,
} from '../_lib/tripbuster/offer-cache.js';

/** Most offers importable in one request. Keeps the function well inside its time budget. */
const MAX_IMPORT = 100;
const BROWSE_LIMIT = 60;
const WRITE_CONCURRENCY = 6;
const STORED_PROBLEMS = 20;

/** Run `worker` over `items` with a bounded number in flight. */
async function pooled(items, size, worker) {
  const out = new Array(items.length);
  let i = 0;
  const runners = Array.from({ length: Math.min(size, items.length || 1) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await worker(items[idx], idx);
    }
  });
  await Promise.all(runners);
  return out;
}

/** Read the browse filters off a query string or a JSON body, clamped. */
function readFilters(src) {
  const list = (v) => {
    if (Array.isArray(v)) return v.map(String);
    if (typeof v === 'string' && v) return v.split(',');
    return [];
  };
  const int = (v, min, max) => {
    const n = parseInt(v, 10);
    return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : null;
  };
  return {
    countries: list(src.countries).map((c) => c.trim().toUpperCase())
      .filter((c) => /^[A-Z]{2}$/.test(c)).slice(0, 20),
    // Only real board values, so an unknown string cannot silently mean "no filter".
    boards: list(src.boards).map((b) => b.trim())
      .filter((b) => DEAL_ENUMS.BOARDS.includes(b)).slice(0, 8),
    budgetMax: int(src.budgetMax, 1, 100000),
    nightsMin: int(src.nightsMin, 1, 60),
    nightsMax: int(src.nightsMax, 1, 60),
    withinDays: int(src.withinDays, 1, 730),
  };
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  const gate = requireAgent(req);
  if (!gate.ok) return res.status(gate.status).json({ error: gate.error });
  if (!tbConfigured()) return res.status(503).json({ error: 'Deals service is not configured yet' });

  const agentId = gate.agent.agentId;

  try {
    const agent = await loadAgent(agentId);
    if (!agent) return res.status(401).json({ error: 'Sign in again to continue' });

    // ── the gate ────────────────────────────────────────────────────────────
    // Not an error state, a state the UI has a panel for. `connected: false`
    // tells the dashboard to show the upsell rather than a red banner.
    if (!agent.tg_client_email) {
      return res.status(403).json({
        connected: false,
        error: 'This is for Travelgenix clients. Connect your Travelgenix account to pull your live offers in automatically.',
      });
    }

    // The offer cache lives in the Travelgenix Redis. If that is not wired up in
    // this deploy, say so plainly instead of showing an agent an empty list and
    // letting them conclude they have no offers.
    if (!offerCacheConfigured()) {
      return res.status(503).json({
        connected: true,
        error: 'The live offer feed is not available right now. Please try again shortly.',
      });
    }

    const body = (req.body && typeof req.body === 'object' && !Array.isArray(req.body)) ? req.body : {};

    // ── browse ──────────────────────────────────────────────────────────────
    if (req.method === 'GET') {
      const filters = readFilters(req.query || {});
      const [{ offers, totalMatched, refreshedAt }, countries, existingRefs] = await Promise.all([
        queryOfferCache({ ...filters, limit: BROWSE_LIMIT }),
        cachedCountries(),
        tbSelect('deals', {
          select: 'external_ref',
          agent_id: `eq.${agentId}`,
          source: 'eq.live_cache',
          limit: 1000,
        }),
      ]);

      const already = new Set(
        (Array.isArray(existingRefs) ? existingRefs : []).map((r) => r.external_ref).filter(Boolean),
      );

      return res.status(200).json({
        connected: true,
        clientEmail: agent.tg_client_email,
        refreshedAt,
        totalMatched,
        // Countries are offered as codes plus names so the picker reads as places.
        countries: countries.map((cc) => ({ code: cc, name: countryName(cc) })),
        boards: DEAL_ENUMS.BOARDS,
        offers: offers.map((o) => {
          const ref = offerRef(o);
          const deal = offerToDeal(o);
          return {
            ref,
            imported: already.has(ref),
            title: deal.title,
            resort: deal.resort,
            country: deal.country,
            accommodation: deal.accommodation_name,
            stars: deal.star_rating,
            guestScore: deal.guest_score,
            board: deal.board_basis,
            nights: deal.nights,
            price: deal.price_from,
            wasPrice: deal.was_price,
            currency: deal.currency,
            departs: (deal.departure_airports || [])[0] || null,
            airline: deal.airline,
            travelFrom: deal.travel_from,
            image: deal.hero_image_url,
            hasLink: !!deal.clickout_url,
          };
        }),
      });
    }

    if (req.method !== 'POST') {
      res.setHeader('Allow', 'GET, POST');
      return res.status(405).json({ error: 'Method not allowed' });
    }

    if (agent.status !== 'active') return res.status(403).json({ error: 'This account is not active' });

    const counts = await dealCounts(agentId);
    const planLimit = allowanceFor(agent.plan);
    let headroom = publishHeadroom(agent.plan, counts.live);
    const problems = [];

    // ── resync: refresh what is already imported ────────────────────────────
    // Only the volatile commercial fields move. An agent who rewrote a title or
    // added selling points keeps that work — a price refresh must never
    // overwrite their copy. This is why RESYNC_FIELDS is short.
    if (body.resync === true) {
      const mine = await tbSelect('deals', {
        select: 'id,external_ref,status',
        agent_id: `eq.${agentId}`,
        source: 'eq.live_cache',
        limit: 1000,
      });
      const rows = Array.isArray(mine) ? mine.filter((r) => r.external_ref) : [];
      if (!rows.length) {
        return res.status(200).json({ connected: true, resynced: 0, gone: 0, checked: 0 });
      }

      // Re-read the whole cache once and index it, rather than querying per deal.
      const { offers } = await queryOfferCache({ limit: 10000 });
      const byRef = new Map(offers.map((o) => [offerRef(o), o]));

      const now = new Date().toISOString();
      const present = rows.filter((r) => byRef.has(r.external_ref));
      const missing = rows.filter((r) => !byRef.has(r.external_ref));

      const results = await pooled(present, WRITE_CONCURRENCY, async (r) => {
        const fresh = offerToDeal(byRef.get(r.external_ref), { resyncOnly: true });
        const patch = { synced_at: now };
        for (const f of RESYNC_FIELDS) {
          if (fresh[f] !== undefined && fresh[f] !== null) patch[f] = fresh[f];
        }
        // Validate even though the data is ours: the enums and cross-field rules
        // live in one place and should be enforced on every path into the table.
        const { ok, deal } = validateDeal(patch, { partial: true });
        if (!ok) return false;
        deal.synced_at = now;
        try {
          const out = await tbUpdate('deals', { id: `eq.${r.id}`, agent_id: `eq.${agentId}` }, deal);
          return Array.isArray(out) && out.length > 0;
        } catch (e) {
          return false;
        }
      });

      // Offers that have left the cache are paused rather than deleted: the
      // holiday is no longer on sale, but the agent's own edits are worth
      // keeping, and deleting a deal out from under them would be rude.
      const pausedResults = await pooled(
        missing.filter((r) => r.status === 'live'), WRITE_CONCURRENCY,
        async (r) => {
          try {
            await tbUpdate('deals', { id: `eq.${r.id}`, agent_id: `eq.${agentId}` },
              { status: 'paused' }, { returning: false });
            return true;
          } catch (e) { return false; }
        },
      );

      const resynced = results.filter(Boolean).length;
      const paused = pausedResults.filter(Boolean).length;
      if (paused) {
        problems.push({
          message: `${paused} deal${paused === 1 ? '' : 's'} paused because the offer is no longer in your live feed.`,
        });
      }

      try {
        await tbInsert('import_runs', [{
          agent_id: agentId,
          source: 'live_cache',
          filename: 'resync',
          rows_total: rows.length,
          created_count: 0,
          updated_count: resynced,
          skipped_count: missing.length - paused,
          failed_count: present.length - resynced,
          problems: problems.slice(0, STORED_PROBLEMS),
        }], { returning: false });
      } catch (e) {
        console.warn('[tripbuster/offer-import] could not record the resync', e && e.code);
      }

      return res.status(200).json({
        connected: true,
        checked: rows.length,
        resynced,
        paused,
        gone: missing.length,
        problems,
      });
    }

    // ── import the chosen offers ────────────────────────────────────────────
    const wanted = Array.isArray(body.refs) ? body.refs.filter((r) => typeof r === 'string') : [];
    if (!wanted.length) {
      return res.status(400).json({ error: 'Choose at least one offer to import' });
    }
    if (wanted.length > MAX_IMPORT) {
      return res.status(413).json({
        error: `Please import up to ${MAX_IMPORT} offers at a time. Choose fewer and repeat.`,
      });
    }
    const publish = body.publish === true;
    const wantedSet = new Set(wanted);

    // Re-read the cache and keep only the chosen refs. Deliberately UNFILTERED:
    // the reference is the selector, and re-applying the browse filters would
    // drop an offer whose price had drifted past the budget since the agent
    // ticked it, reporting "no longer in the feed" when it plainly is.
    const { offers } = await queryOfferCache({ limit: 10000 });
    const found = new Map();
    for (const o of offers) {
      const ref = offerRef(o);
      if (wantedSet.has(ref) && !found.has(ref)) found.set(ref, o);
    }

    const notFound = wanted.filter((r) => !found.has(r));
    if (notFound.length) {
      problems.push({
        message: `${notFound.length} offer${notFound.length === 1 ? '' : 's'} could not be imported `
          + 'because they are no longer in the live feed. Refresh and try those again.',
      });
    }

    // Which of these we already hold, so a second import updates rather than
    // failing on the unique (agent_id, external_ref) index.
    const existing = await tbSelect('deals', {
      select: 'id,external_ref,status,price_from,clickout_url',
      agent_id: `eq.${agentId}`,
      source: 'eq.live_cache',
      limit: 1000,
    });
    const existingByRef = new Map(
      (Array.isArray(existing) ? existing : []).filter((r) => r.external_ref)
        .map((r) => [r.external_ref, r]),
    );

    const now = new Date().toISOString();
    const creates = [];
    const updates = [];

    for (const [ref, offer] of found) {
      const built = offerToDeal(offer);
      const { ok, deal, errors } = validateDeal(built, { partial: false });
      if (!ok) {
        // Our own mapping produced something the schema refuses. Worth logging
        // loudly: it means the cache holds a shape we are not reading correctly.
        console.warn('[tripbuster/offer-import] mapped offer failed validation', ref, errors);
        problems.push({ message: `Skipped "${built.title || ref}": ${errors.map((e) => e.message).join('; ')}` });
        continue;
      }

      const prior = existingByRef.get(ref);
      // The agent's protection and fallback website apply either way: the
      // traveller books with the agent, so the deal must carry the agent's
      // details rather than the operator's.
      applyAgentDefaults(deal, agent);

      if (publish) {
        const blockers = publishBlockers(deal);
        const needsSlot = !(prior && prior.status === 'live');
        if (blockers.length) {
          if (!prior) deal.status = 'draft';
          problems.push({ message: `"${deal.title}" stayed a draft: ${blockers.map((b) => b.message).join('; ')}` });
        } else if (planLimit === 0) {
          if (!prior) deal.status = 'draft';
          problems.push({ message: `Your ${agent.plan} plan does not include live deals yet.` });
        } else if (needsSlot && headroom <= 0) {
          if (!prior) deal.status = 'draft';
          problems.push({
            message: `"${deal.title}" stayed a draft: you are using all ${planLimit} live deals on ${agent.plan}.`,
          });
        } else {
          if (needsSlot) { headroom -= 1; deal.published_at = now; }
          deal.status = 'live';
        }
      } else if (!prior) {
        deal.status = 'draft';
      }

      if (prior) {
        // A re-import of something we hold behaves like a resync: refresh the
        // commercial facts and leave the agent's editorial work alone.
        const patch = { synced_at: now };
        for (const f of RESYNC_FIELDS) {
          if (deal[f] !== undefined && deal[f] !== null) patch[f] = deal[f];
        }
        if (deal.status) patch.status = deal.status;
        if (deal.published_at) patch.published_at = deal.published_at;
        updates.push({ id: prior.id, patch, ref });
      } else {
        creates.push({
          ...deal,
          agent_id: agentId,
          source: 'live_cache',
          external_ref: ref,
          synced_at: now,
        });
      }
    }

    let created = 0;
    let failed = 0;

    // Insert one at a time: PostgREST unions the keys of a bulk insert and sends
    // NULL for any object missing one, which would break a NOT NULL column with
    // a default. Offer counts here are bounded by MAX_IMPORT, so the cost is fine.
    const createResults = await pooled(creates, WRITE_CONCURRENCY, async (row) => {
      try {
        await tbInsert('deals', [row], { returning: false });
        return true;
      } catch (e) {
        problems.push({
          message: e && e.status === 409
            ? `"${row.title}" is already imported.`
            : `Could not save "${row.title}".`,
        });
        return false;
      }
    });
    created = createResults.filter(Boolean).length;
    failed += createResults.filter((okRow) => !okRow).length;

    const updateResults = await pooled(updates, WRITE_CONCURRENCY, async (u) => {
      try {
        const out = await tbUpdate('deals', { id: `eq.${u.id}`, agent_id: `eq.${agentId}` }, u.patch);
        return Array.isArray(out) && out.length > 0;
      } catch (e) {
        problems.push({ message: 'Could not refresh one of the offers you already had.' });
        return false;
      }
    });
    const updated = updateResults.filter(Boolean).length;
    failed += updateResults.filter((okRow) => !okRow).length;

    try {
      await tbInsert('import_runs', [{
        agent_id: agentId,
        source: 'live_cache',
        filename: null,
        rows_total: wanted.length,
        created_count: created,
        updated_count: updated,
        skipped_count: notFound.length,
        failed_count: failed,
        problems: problems.slice(0, STORED_PROBLEMS),
      }], { returning: false });
    } catch (e) {
      console.warn('[tripbuster/offer-import] could not record the run', e && e.code);
    }

    return res.status(200).json({
      connected: true,
      created,
      updated,
      skipped: notFound.length,
      failed,
      problems: problems.slice(0, STORED_PROBLEMS),
    });
  } catch (e) {
    console.error('[tripbuster/offer-import] failed', req.method, e && e.code, e && e.message);
    return res.status(502).json({ error: 'Could not reach the live offer feed just now. Try again.' });
  }
}
