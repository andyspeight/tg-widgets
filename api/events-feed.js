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
import { setCors, applyRateLimit, RATE_LIMITS } from './_auth.js';
import { buildEventDeeplink, DEEPLINK_STATUS_TEXT, SPEC_VERIFIED } from './_lib/events/event-deeplink.js';

// The published Travelgenix demo Travelify application. Travelify document it
// themselves, so it is safe to ship as the prototype default. A real embed
// passes the client's own AppID.
const DEMO_APP_ID = '250';

const PUBLIC_CACHE = 'public, max-age=300, s-maxage=3600, stale-while-revalidate=604800';
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
function expand(snap, ev, appId, currency, adults) {
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

  const link = buildEventDeeplink({ sources, startDate: ev.dt, title }, { appId, currency, adults });
  out.booking = {
    url: link.url,
    status: link.status,
    supplier: link.supplier,
    supplierId: link.supplierId,
    reference: link.reference,
    note: DEEPLINK_STATUS_TEXT[link.status] || null,
  };
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

/** Page a sorted list and expand only the slice being returned. */
function page(snap, rows, q, appId, opts = {}) {
  const size = intIn(q.limit, 1, MAX_PAGE_SIZE, DEFAULT_PAGE_SIZE);
  const offset = intIn(q.offset, 0, 100000, 0);
  const sorted = [...rows].sort(chronological);
  return {
    total: sorted.length,
    offset,
    limit: size,
    events: sorted.slice(offset, offset + size).map((e) => expand(snap, e, appId, opts.currency, opts.adults)),
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

  const limited = applyRateLimit(res, `eventsfeed:${getClientIp(req)}`, RATE_LIMITS.widgetRead);
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
    const linkOpts = { currency, adults };

    const meta = {
      generatedAt: snap.generatedAt,
      counts: snap.counts,
      deeplinkVerified: SPEC_VERIFIED,
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
      const rows = snap.byCompetition.get(slug) || [];
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
      res.status(200).json({ meta, venue, ...page(snap, snap.byVenue.get(key) || [], q, appId, linkOpts) });
      return;
    }

    // ── performer ────────────────────────────────────────────────────────────
    if (view === 'performer') {
      const key = str(q.key, 80).toLowerCase();
      if (!KEY_RE.test(key)) { res.status(400).json({ error: 'Invalid performer' }); return; }
      const performer = snap.performerByKey.get(key);
      if (!performer) { res.status(404).json({ error: 'Unknown performer' }); return; }
      res.status(200).json({ meta, performer, ...page(snap, snap.byPerformer.get(key) || [], q, appId, linkOpts) });
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
