/**
 * Events Feed API — the read side of the supplier ticket inventory.
 *
 *   GET /api/events-feed                         index: categories, competitions, counts
 *   GET /api/events-feed?view=competition&slug=english-premier-league
 *   GET /api/events-feed?view=team&key=arsenal
 *   GET /api/events-feed?view=venue&key=wembleystadium
 *   GET /api/events-feed?view=performer&key=olivia-rodrigo
 *   GET /api/events-feed?view=browse&from=2026-09-01&to=2026-09-30&category=football&q=arsenal
 *   GET /api/events-feed?view=venues&q=arena     venue directory, searchable
 *   GET /api/events-feed?view=performers
 *   GET /api/events-feed?view=search&q=wembley  everything matching, grouped
 *   GET /api/events-feed?view=diagnostics        what the normalisation pass found
 *
 * Optional on any view that returns events: &appId=<TravelifyAppID> to get
 * booking deeplinks built in. Defaults to the published Travelgenix demo app.
 *
 * WHERE THE DATA COMES FROM
 * A snapshot built by scripts/build-events-snapshot.mjs and committed at
 * api/_data/events-snapshot.json. The supplier feed is a periodic spreadsheet
 * export, not a live API, so a snapshot is the honest shape for it. It loads
 * once per cold start and every request is a slice of the in-memory copy.
 *
 * The snapshot stores short keys and drops anything the registries already
 * hold. This file is the only reader, and it rehydrates each event from the
 * team, performer, venue and competition registries on the way out. That is
 * also what makes club naming consistent: the feed writes "Arsenal" on one row
 * and "Arsenal FC" on the next, and every page here shows one of them.
 *
 * SECURITY
 * - Read-only. Public, no auth, so nothing here can mutate anything.
 * - Every query parameter is validated and length-capped before use.
 * - Page size is capped, so no request can ask for the whole feed at once.
 * - Rate limited per IP on the shared widgetRead bucket.
 * - Errors are generic to the client and detailed in the server log.
 */

import { readFileSync } from 'node:fs';
import { setCors, applyRateLimit } from './_auth.js';
import { buildEventDeeplink, buildBookingOptions, readyBookingKinds, BOOKING_KINDS, DEEPLINK_STATUS_TEXT, SPEC_VERIFIED } from './_lib/events/event-deeplink.js';

// The published Travelgenix demo Travelify application. Travelify document it
// themselves, so it is safe to ship as the prototype default. A real embed
// passes the client's own AppID.
const DEMO_APP_ID = '250';

const PUBLIC_CACHE = 'public, max-age=300, s-maxage=3600, stale-while-revalidate=604800';

/**
 * This endpoint's own bucket, wider than the shared widgetRead one.
 *
 * A browsing UI is chattier than a widget boot: each page is an index call plus
 * a view call, and the search box fires one per debounced burst of typing. The
 * shared 120-per-15-minutes limit is a browse-and-search session, not an abuse
 * signal. 300 per 15 minutes is 20 a minute sustained, still well under the
 * 60-a-minute the widget-config routes allow, and responses are CDN-cached for
 * an hour so in production most requests never reach the function at all.
 */
const FEED_RATE_LIMIT = { max: 300, windowMs: 15 * 60 * 1000 };
const MAX_PAGE_SIZE = 100;
const DEFAULT_PAGE_SIZE = 50;
const APPID_RE = /^[A-Za-z0-9_-]{1,32}$/;
const KEY_RE = /^[a-z0-9-]{1,80}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// ── Snapshot, loaded once per cold start ─────────────────────────────────────

let SNAP = null;
let SNAP_ERROR = null;

function snapshot() {
  if (SNAP || SNAP_ERROR) return SNAP;
  try {
    const url = new URL('./_data/events-snapshot.json', import.meta.url);
    const raw = JSON.parse(readFileSync(url, 'utf8'));
    raw.byCompetition = new Map();
    raw.byTeam = new Map();
    raw.byVenue = new Map();
    raw.byPerformer = new Map();
    raw.teamByKey = new Map(raw.teams.map((t) => [t.key, t]));
    raw.venueByKey = new Map(raw.venues.map((v) => [v.key, v]));
    raw.performerByKey = new Map(raw.performers.map((p) => [p.key, p]));
    raw.competitionBySlug = new Map(raw.competitions.map((c) => [c.slug, c]));
    raw.categoryBySlug = new Map(raw.categories.map((c) => [c.slug, c]));

    const push = (map, key, ev) => {
      if (!key) return;
      let arr = map.get(key);
      if (!arr) { arr = []; map.set(key, arr); }
      arr.push(ev);
    };
    for (const ev of raw.events) {
      push(raw.byCompetition, ev.o, ev);
      push(raw.byVenue, ev.vk, ev);
      push(raw.byPerformer, ev.pk, ev);
      push(raw.byTeam, ev.hk, ev);
      if (ev.ak && ev.ak !== ev.hk) push(raw.byTeam, ev.ak, ev);
    }
    SNAP = raw;
    return SNAP;
  } catch (err) {
    console.error('[api/events-feed] snapshot load failed:', err && err.message);
    SNAP_ERROR = err;
    return null;
  }
}

// ── Rehydration ──────────────────────────────────────────────────────────────

function teamName(snap, key) {
  const t = key && snap.teamByKey.get(key);
  return t ? t.name : null;
}

/**
 * Expand a short snapshot row into a full event, filling in every display name
 * from the registries and attaching a booking deeplink.
 */
function expand(snap, ev, appId, currency, adults, bookingKinds) {
  const home = teamName(snap, ev.hk);
  const away = teamName(snap, ev.ak);
  const performer = ev.pk ? (snap.performerByKey.get(ev.pk) || {}).name || null : null;
  const venue = snap.venueByKey.get(ev.vk) || null;
  const comp = ev.o ? snap.competitionBySlug.get(ev.o) || null : null;
  const cat = ev.c ? snap.categoryBySlug.get(ev.c) || null : null;

  let title = ev.t || null;
  if (!title && home && away) title = `${home} vs ${away}`;
  if (!title && performer) title = performer;
  if (!title) title = 'Event';

  const sources = (ev.s || []).map(([supplier, searchboxId, filterId, rawName]) => ({
    supplier, searchboxId, filterId, rawName,
  }));

  const out = {
    id: ev.i,
    title,
    phase: ev.p || null,
    kind: ev.k,
    category: ev.c || null,
    categoryLabel: cat ? cat.label : null,
    competition: ev.o || null,
    competitionLabel: comp ? comp.label : null,
    homeTeam: home,
    homeTeamKey: ev.hk || null,
    awayTeam: away,
    awayTeamKey: ev.ak || null,
    performer,
    performerKey: ev.pk || null,
    locationText: ev.lo || null,
    startDate: ev.dt,
    startTime: ev.tm || null,
    startsAtLocal: ev.d,
    timeKnown: ev.tk !== 0,
    venue: venue ? { key: venue.key, name: venue.name } : { key: ev.vk, name: ev.vk },
    hasPlaceholderTeams: ev.ph === 1,
    truncated: ev.tr === 1,
    // Both suppliers' times when they disagree. Kept visible rather than
    // resolved, because neither feed is known to be venue-local.
    startTimeConflict: ev.x || null,
    suppliers: sources.map((s) => s.supplier),
    sources,
  };

  const target = { sources, startDate: ev.dt, title };
  const link = buildEventDeeplink(target, { appId, currency, adults });
  out.booking = {
    url: link.url,
    status: link.status,
    supplier: link.supplier,
    supplierId: link.supplierId,
    reference: link.reference,
    note: DEEPLINK_STATUS_TEXT[link.status] || null,
  };
  // Every way this event can be bought, in the order the caller asked for.
  // A ticket sold with a hotel is worth more to an agent than a ticket, so the
  // surfaces need all of them rather than one Book button.
  out.bookingOptions = buildBookingOptions(target, { appId, currency, adults, kinds: bookingKinds });
  return out;
}

// ── Query helpers ────────────────────────────────────────────────────────────

const str = (v, max = 80) => (typeof v === 'string' ? v.slice(0, max).trim() : '');

function intIn(v, min, max, fallback) {
  const n = Number.parseInt(v, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function getClientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.length) return fwd.split(',')[0].trim();
  return req.socket?.remoteAddress || 'unknown';
}

function chronological(a, b) {
  return a.d < b.d ? -1 : a.d > b.d ? 1 : a.i < b.i ? -1 : 1;
}

/**
 * Narrow a set of rows to a date window. Applied to the entity views as well as
 * browse, because a club widget on a client's site wants "the next six games",
 * not every game in the snapshot.
 */
function windowRows(rows, from, to) {
  let out = rows;
  if (DATE_RE.test(from)) out = out.filter((e) => e.dt >= from);
  if (DATE_RE.test(to)) out = out.filter((e) => e.dt <= to);
  return out;
}

/** Page a sorted list and expand only the slice being returned. */
function page(snap, rows, q, appId, opts = {}) {
  const size = intIn(q.limit, 1, MAX_PAGE_SIZE, DEFAULT_PAGE_SIZE);
  const offset = intIn(q.offset, 0, 100000, 0);
  const sorted = [...rows].sort(chronological);
  return {
    total: sorted.length,
    offset,
    limit: size,
    events: sorted.slice(offset, offset + size).map((e) => expand(snap, e, appId, opts.currency, opts.adults, opts.bookingKinds)),
  };
}

/** Case- and accent-insensitive contains, for the search boxes. */
function matcher(term) {
  const needle = term.normalize('NFD').replace(/[\u0300-\u036F]/g, '').toLowerCase();
  return (value) => String(value || '').normalize('NFD').replace(/[\u0300-\u036F]/g, '').toLowerCase().includes(needle);
}

// ── Handler ──────────────────────────────────────────────────────────────────

export default function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'GET') {
    res.setHeader('Cache-Control', 'no-store');
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const limited = applyRateLimit(res, `eventsfeed:${getClientIp(req)}`, FEED_RATE_LIMIT);
  if (!limited) return;

  try {
    const snap = snapshot();
    if (!snap) {
      res.setHeader('Cache-Control', 'no-store');
      res.status(503).json({ error: 'Events data unavailable' });
      return;
    }

    const q = req.query || {};
    const view = str(q.view, 24) || 'index';
    const rawAppId = str(q.appId, 32);
    const appId = APPID_RE.test(rawAppId) ? rawAppId : DEMO_APP_ID;
    // Currency and party size ride the query string so a surface can ask for
    // the right prices without a rebuild. Both revalidated in the builder.
    const currency = /^[A-Za-z]{3}$/.test(str(q.currency, 3)) ? str(q.currency, 3).toUpperCase() : undefined;
    const adults = q.adults !== undefined ? intIn(q.adults, 1, 20, undefined) : undefined;
    // Which booking combinations to build per event. Unknown names are dropped
    // by the builder, and anything without a verified spec yields no url, so a
    // caller can ask for all three today and get more back later for free.
    const kindsRaw = str(q.booking, 120);
    const bookingKinds = kindsRaw
      ? kindsRaw.split(',').map((k) => k.trim()).filter(Boolean).slice(0, 6)
      : readyBookingKinds();
    const linkOpts = { currency, adults, bookingKinds };

    const meta = {
      generatedAt: snap.generatedAt,
      counts: snap.counts,
      deeplinkVerified: SPEC_VERIFIED,
      bookingKinds: BOOKING_KINDS.map((k) => ({ kind: k.kind, label: k.label, short: k.short, ready: k.ready })),
    };

    res.setHeader('Cache-Control', PUBLIC_CACHE);

    // ── index ────────────────────────────────────────────────────────────────
    if (view === 'index') {
      res.status(200).json({
        meta,
        categories: snap.categories,
        // Only competitions with a roster are worth a hub page.
        competitions: snap.competitions,
        topTeams: snap.teams.slice(0, 24),
        topVenues: snap.venues.slice(0, 24),
        topPerformers: snap.performers.slice(0, 24),
      });
      return;
    }

    // ── diagnostics ──────────────────────────────────────────────────────────
    if (view === 'diagnostics') {
      res.status(200).json({ meta, report: snap.report });
      return;
    }

    // ── competition ──────────────────────────────────────────────────────────
    if (view === 'competition') {
      const slug = str(q.slug, 80).toLowerCase();
      if (!KEY_RE.test(slug)) { res.status(400).json({ error: 'Invalid competition' }); return; }
      const comp = snap.competitionBySlug.get(slug);
      if (!comp) { res.status(404).json({ error: 'Unknown competition' }); return; }
      const rows = windowRows(snap.byCompetition.get(slug) || [], str(q.from, 10), str(q.to, 10));
      const teams = snap.teams
        .filter((t) => t.competitions.includes(slug))
        .sort((a, b) => (a.name < b.name ? -1 : 1));
      res.status(200).json({ meta, competition: comp, teams, ...page(snap, rows, q, appId, linkOpts) });
      return;
    }

    // ── team ─────────────────────────────────────────────────────────────────
    if (view === 'team') {
      const key = str(q.key, 80).toLowerCase();
      if (!KEY_RE.test(key)) { res.status(400).json({ error: 'Invalid team' }); return; }
      const team = snap.teamByKey.get(key);
      if (!team) { res.status(404).json({ error: 'Unknown team' }); return; }
      let rows = snap.byTeam.get(key) || [];
      const compFilter = str(q.competition, 80).toLowerCase();
      if (KEY_RE.test(compFilter)) rows = rows.filter((e) => e.o === compFilter);
      // Home or away. A club widget on the club's own site usually wants home
      // games only, because those are the ones its customers travel to.
      const side = str(q.side, 8).toLowerCase();
      if (side === 'home') rows = rows.filter((e) => e.hk === key);
      else if (side === 'away') rows = rows.filter((e) => e.ak === key);
      rows = windowRows(rows, str(q.from, 10), str(q.to, 10));
      res.status(200).json({
        meta,
        team,
        competitions: team.competitions
          .map((s) => snap.competitionBySlug.get(s))
          .filter(Boolean),
        ...page(snap, rows, q, appId, linkOpts),
      });
      return;
    }

    // ── venue ────────────────────────────────────────────────────────────────
    if (view === 'venue') {
      const key = str(q.key, 80).toLowerCase();
      if (!KEY_RE.test(key)) { res.status(400).json({ error: 'Invalid venue' }); return; }
      const venue = snap.venueByKey.get(key);
      if (!venue) { res.status(404).json({ error: 'Unknown venue' }); return; }
      res.status(200).json({ meta, venue, ...page(snap, windowRows(snap.byVenue.get(key) || [], str(q.from, 10), str(q.to, 10)), q, appId, linkOpts) });
      return;
    }

    // ── performer ────────────────────────────────────────────────────────────
    if (view === 'performer') {
      const key = str(q.key, 80).toLowerCase();
      if (!KEY_RE.test(key)) { res.status(400).json({ error: 'Invalid performer' }); return; }
      const performer = snap.performerByKey.get(key);
      if (!performer) { res.status(404).json({ error: 'Unknown performer' }); return; }
      res.status(200).json({ meta, performer, ...page(snap, windowRows(snap.byPerformer.get(key) || [], str(q.from, 10), str(q.to, 10)), q, appId, linkOpts) });
      return;
    }

    // ── directories ──────────────────────────────────────────────────────────
    if (view === 'venues' || view === 'performers' || view === 'teams') {
      const list = view === 'venues' ? snap.venues : view === 'performers' ? snap.performers : snap.teams;
      const term = str(q.q, 60);
      let out = list;
      if (term) {
        const hit = matcher(term);
        out = list.filter((x) => hit(x.name) || (x.aliases || []).some(hit));
      }
      const compFilter = str(q.competition, 80).toLowerCase();
      if (view === 'teams' && KEY_RE.test(compFilter)) {
        out = out.filter((t) => t.competitions.includes(compFilter));
      }
      const size = intIn(q.limit, 1, 500, 200);
      res.status(200).json({ meta, total: out.length, limit: size, items: out.slice(0, size) });
      return;
    }

    // ── search ───────────────────────────────────────────────────────────────
    // One box over everything. "Wembley" should return the ground, the football
    // at it and the concerts at it; "Arsenal" should return the club and every
    // game home and away. So the same term is run against four registries AND
    // the events, and the caller gets them grouped rather than interleaved.
    //
    // Entities are matched on their canonical name and every alias, so "Arsenal
    // FC" finds the club the feed also writes as "Arsenal". Events are matched
    // on the REHYDRATED names for the same reason.
    if (view === 'search') {
      const term = str(q.q, 60);
      if (!term) {
        res.status(200).json({
          meta, query: '', competitions: [], teams: [], venues: [], performers: [],
          total: 0, offset: 0, limit: 0, events: [],
        });
        return;
      }
      const hit = matcher(term);
      const named = (x) => hit(x.name) || (x.aliases || []).some(hit);
      const ENTITY_CAP = 8;

      const competitions = snap.competitions
        .filter((c) => hit(c.label) || hit(c.country) || hit(c.categoryLabel));
      const teams = snap.teams.filter(named);
      const venues = snap.venues.filter(named);
      const performers = snap.performers.filter(named);

      // An exact-ish name match should outrank a substring buried in a longer
      // name, so "Arsenal" leads with Arsenal rather than a club that merely
      // contains it.
      const exact = matcher(term);
      const rank = (list) => list.slice().sort((a, b) => {
        const ax = exact(a.name) && a.name.length <= term.length + 4 ? 0 : 1;
        const bx = exact(b.name) && b.name.length <= term.length + 4 ? 0 : 1;
        return ax - bx || (b.events || 0) - (a.events || 0);
      });

      // A client can pin the whole search to one category or competition, so a
      // ski specialist's box never returns baseball. It has to narrow BEFORE
      // the page limit: filtering the returned page client-side would empty the
      // list whenever the first N matches happen to be the wrong category, even
      // though matching events exist further down.
      const scopeCat = str(q.category, 40).toLowerCase();
      const scopeComp = str(q.competition, 80).toLowerCase();
      let pool = snap.events;
      if (KEY_RE.test(scopeCat)) pool = pool.filter((e) => e.c === scopeCat);
      if (KEY_RE.test(scopeComp)) pool = pool.filter((e) => e.o === scopeComp);
      const from = str(q.from, 10);
      const to = str(q.to, 10);
      pool = windowRows(pool, from, to);

      const rows = pool.filter((e) => hit(e.t)
        || hit(teamName(snap, e.hk))
        || hit(teamName(snap, e.ak))
        || hit(e.pk && (snap.performerByKey.get(e.pk) || {}).name)
        || hit((snap.venueByKey.get(e.vk) || {}).name)
        || hit(e.lo)
        || hit(e.o && (snap.competitionBySlug.get(e.o) || {}).label));

      res.status(200).json({
        meta,
        query: term,
        competitions: competitions.slice(0, ENTITY_CAP),
        competitionsTotal: competitions.length,
        teams: rank(teams).slice(0, ENTITY_CAP),
        teamsTotal: teams.length,
        venues: rank(venues).slice(0, ENTITY_CAP),
        venuesTotal: venues.length,
        performers: rank(performers).slice(0, ENTITY_CAP),
        performersTotal: performers.length,
        ...page(snap, rows, q, appId, linkOpts),
      });
      return;
    }

    // ── browse ───────────────────────────────────────────────────────────────
    if (view === 'browse') {
      let rows = snap.events;

      const from = str(q.from, 10);
      if (DATE_RE.test(from)) rows = rows.filter((e) => e.dt >= from);
      const to = str(q.to, 10);
      if (DATE_RE.test(to)) rows = rows.filter((e) => e.dt <= to);

      const category = str(q.category, 40).toLowerCase();
      if (KEY_RE.test(category)) rows = rows.filter((e) => e.c === category);

      const competition = str(q.competition, 80).toLowerCase();
      if (KEY_RE.test(competition)) rows = rows.filter((e) => e.o === competition);

      const venueKey = str(q.venue, 80).toLowerCase();
      if (KEY_RE.test(venueKey)) rows = rows.filter((e) => e.vk === venueKey);

      const term = str(q.q, 60);
      if (term) {
        // Search the rehydrated names, not the stored row, so typing "Arsenal"
        // still finds a row the feed wrote as "Arsenal FC".
        const hit = matcher(term);
        rows = rows.filter((e) => hit(e.t)
          || hit(teamName(snap, e.hk))
          || hit(teamName(snap, e.ak))
          || hit(e.pk && (snap.performerByKey.get(e.pk) || {}).name)
          || hit((snap.venueByKey.get(e.vk) || {}).name)
          || hit(e.lo));
      }

      res.status(200).json({ meta, filters: { from, to, category, competition, venue: venueKey, q: term }, ...page(snap, rows, q, appId, linkOpts) });
      return;
    }

    res.status(400).json({ error: 'Unknown view' });
  } catch (err) {
    console.error('[api/events-feed] Error:', err);
    res.setHeader('Cache-Control', 'no-store');
    res.status(500).json({ error: 'Internal server error' });
  }
}
