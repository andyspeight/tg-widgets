/**
 * Supplier event feed — browsable indexes.
 *
 * `supplier-normalise.js` gives one clean record per real-world event. That is
 * the right shape for a list and the wrong shape for a page about Arsenal, a
 * page about Wembley, or a page about Olivia Rodrigo. This module builds the
 * registries those pages need.
 *
 * The reason it exists at all is that the feed has no team, artist or
 * competition entity. Everything is embedded in a display string, and the
 * strings are not stable. The Premier League alone carries 28 distinct name
 * spellings for its clubs:
 *
 *   Arsenal / Arsenal FC          Chelsea / Chelsea FC
 *   Fulham / Fulham FC            Liverpool / Liverpool FC
 *   Sunderland / Sunderland AFC   Ipswich / Ipswich Town
 *   AFC Bournemouth / A.F.C. Bournemouth
 *
 * Rendering that as a list of clubs gives you Arsenal twice. So each registry
 * collapses on the same comparison key the deduper already trusts, keeps every
 * spelling it saw as an alias, and picks the most-used one to display.
 *
 * Pure, like the pass it builds on: no network, no clock, no secrets.
 */

import { normaliseTeamName, slugify, isPlaceholderTeam } from './supplier-normalise.js';

/** Most-used spelling wins, longest breaks the tie. */
function pickDisplayName(counts) {
  let best = '';
  let bestCount = -1;
  for (const [name, count] of counts) {
    if (count > bestCount || (count === bestCount && name.length > best.length)) {
      best = name;
      bestCount = count;
    }
  }
  return best;
}

function bump(map, key) {
  map.set(key, (map.get(key) || 0) + 1);
}

/**
 * Initials for a generated crest.
 *
 * Real club badges are licensed artwork we do not have, so these pages draw a
 * monogram instead. Two letters from two or more words, three from a single
 * long word, so Arsenal reads AR and Manchester United reads MU.
 */
function initialsFor(name) {
  const words = String(name || '')
    .replace(/\([^)]*\)/g, ' ')
    .split(/[\s.]+/)
    .filter((w) => w && !/^(fc|afc|cf|sc|ac|the|of|and|&)$/i.test(w));
  if (!words.length) return '??';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

/**
 * A stable hue per entity, so a badge keeps its colour between deploys.
 * FNV-1a over the key: cheap, well spread, and deterministic across runtimes.
 */
function hueFor(key) {
  let h = 0x811c9dc5;
  const s = String(key);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h % 360;
}

function dateRange(dates) {
  let from = null;
  let to = null;
  for (const d of dates) {
    if (from === null || d < from) from = d;
    if (to === null || d > to) to = d;
  }
  return { from, to };
}

/**
 * Build every registry in one pass over the events.
 *
 * @param {object[]} events Output of normaliseSupplierEvents().events
 * @returns {{ competitions: object[], teams: object[], performers: object[],
 *             venues: object[], categories: object[] }}
 */
export function buildEventIndexes(events) {
  const list = Array.isArray(events) ? events : [];

  const competitions = new Map();
  const teams = new Map();
  const performers = new Map();
  const venues = new Map();
  const categories = new Map();

  for (const e of list) {
    const catSlug = e.category || 'unclassified';

    // ── Categories ──────────────────────────────────────────────────────────
    let cat = categories.get(catSlug);
    if (!cat) {
      cat = { slug: catSlug, label: e.categoryLabel || 'Unclassified', events: 0, competitions: new Set() };
      categories.set(catSlug, cat);
    }
    cat.events++;
    if (e.competition) cat.competitions.add(e.competition);

    // ── Competitions ────────────────────────────────────────────────────────
    if (e.competition) {
      let comp = competitions.get(e.competition);
      if (!comp) {
        comp = {
          slug: e.competition,
          label: e.competitionLabel || e.competition,
          category: catSlug,
          categoryLabel: e.categoryLabel || null,
          events: 0,
          teamKeys: new Set(),
          venueKeys: new Set(),
          dates: [],
        };
        competitions.set(e.competition, comp);
      }
      comp.events++;
      comp.dates.push(e.startDate);
      if (e.venue.key) comp.venueKeys.add(e.venue.key);
    }

    // ── Venues ──────────────────────────────────────────────────────────────
    if (e.venue.key) {
      let v = venues.get(e.venue.key);
      if (!v) {
        v = { key: e.venue.key, names: new Map(), events: 0, categories: new Set(), competitions: new Set(), dates: [] };
        venues.set(e.venue.key, v);
      }
      v.events++;
      bump(v.names, e.venue.name);
      v.categories.add(catSlug);
      if (e.competition) v.competitions.add(e.competition);
      v.dates.push(e.startDate);
    }

    // ── Teams ───────────────────────────────────────────────────────────────
    // Placeholder sides are not clubs and must never become a badge.
    if (e.kind === 'fixture' && !e.hasPlaceholderTeams) {
      for (const side of ['homeTeam', 'awayTeam']) {
        const raw = e[side];
        if (!raw || isPlaceholderTeam(raw)) continue;
        // The key the pass already resolved, so an alias it collapsed
        // ("Ipswich Town" onto "Ipswich") stays collapsed here too.
        const key = (side === 'homeTeam' ? e.homeTeamKey : e.awayTeamKey) || normaliseTeamName(raw);
        if (!key) continue;
        let t = teams.get(key);
        if (!t) {
          t = {
            key,
            names: new Map(),
            events: 0,
            home: 0,
            away: 0,
            categories: new Set(),
            competitions: new Set(),
            homeVenues: new Map(),
            dates: [],
          };
          teams.set(key, t);
        }
        t.events++;
        bump(t.names, raw);
        t.categories.add(catSlug);
        if (e.competition) {
          t.competitions.add(e.competition);
          const comp = competitions.get(e.competition);
          if (comp) comp.teamKeys.add(key);
        }
        t.dates.push(e.startDate);
        if (side === 'homeTeam') {
          t.home++;
          if (e.venue.key) {
            const hv = t.homeVenues.get(e.venue.key) || { name: e.venue.name, count: 0 };
            hv.count++;
            t.homeVenues.set(e.venue.key, hv);
          }
        } else {
          t.away++;
        }
      }
    }

    // ── Performers ──────────────────────────────────────────────────────────
    if (e.kind === 'performance' && e.performer) {
      const key = e.performerKey || slugify(e.performer);
      if (key) {
        let p = performers.get(key);
        if (!p) {
          p = { key, names: new Map(), events: 0, venueKeys: new Set(), locations: new Map(), dates: [] };
          performers.set(key, p);
        }
        p.events++;
        bump(p.names, e.performer);
        if (e.venue.key) p.venueKeys.add(e.venue.key);
        if (e.locationText) bump(p.locations, e.locationText);
        p.dates.push(e.startDate);
      }
    }
  }

  const compOut = [...competitions.values()]
    .map((c) => ({
      slug: c.slug,
      label: c.label,
      category: c.category,
      categoryLabel: c.categoryLabel,
      events: c.events,
      teams: c.teamKeys.size,
      venues: c.venueKeys.size,
      ...dateRange(c.dates),
    }))
    .sort((a, b) => b.events - a.events || (a.label < b.label ? -1 : 1));

  const teamOut = [...teams.values()]
    .map((t) => {
      const name = pickDisplayName(t.names);
      // Their home ground is simply the venue they host at most often.
      let homeVenueKey = null;
      let homeVenueName = null;
      let bestHome = -1;
      for (const [vk, hv] of t.homeVenues) {
        if (hv.count > bestHome) { bestHome = hv.count; homeVenueKey = vk; homeVenueName = hv.name; }
      }
      return {
        key: t.key,
        name,
        aliases: [...t.names.keys()].filter((n) => n !== name).sort(),
        initials: initialsFor(name),
        hue: hueFor(t.key),
        events: t.events,
        home: t.home,
        away: t.away,
        categories: [...t.categories].sort(),
        competitions: [...t.competitions].sort(),
        homeVenueKey: homeVenueKey || null,
        homeVenueName: homeVenueName || null,
        ...dateRange(t.dates),
      };
    })
    .sort((a, b) => b.events - a.events || (a.name < b.name ? -1 : 1));

  const performerOut = [...performers.values()]
    .map((p) => {
      const name = pickDisplayName(p.names);
      return {
        key: p.key,
        name,
        aliases: [...p.names.keys()].filter((n) => n !== name).sort(),
        initials: initialsFor(name),
        hue: hueFor(p.key),
        events: p.events,
        venues: p.venueKeys.size,
        cities: p.locations.size,
        topLocation: pickDisplayName(p.locations) || null,
        ...dateRange(p.dates),
      };
    })
    .sort((a, b) => b.events - a.events || (a.name < b.name ? -1 : 1));

  const venueOut = [...venues.values()]
    .map((v) => {
      const name = pickDisplayName(v.names);
      return {
        key: v.key,
        name,
        aliases: [...v.names.keys()].filter((n) => n !== name).sort(),
        initials: initialsFor(name),
        hue: hueFor(v.key),
        events: v.events,
        categories: [...v.categories].sort(),
        competitions: [...v.competitions].sort(),
        ...dateRange(v.dates),
      };
    })
    .sort((a, b) => b.events - a.events || (a.name < b.name ? -1 : 1));

  const categoryOut = [...categories.values()]
    .map((c) => ({ slug: c.slug, label: c.label, events: c.events, competitions: c.competitions.size }))
    .sort((a, b) => b.events - a.events);

  return { competitions: compOut, teams: teamOut, performers: performerOut, venues: venueOut, categories: categoryOut };
}
