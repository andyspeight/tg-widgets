/**
 * The destination corpus, in bulk, for the CMS to keep a copy of.
 *
 * WHY THIS EXISTS RATHER THAN tg-sites READING AIRTABLE ITSELF. Two reasons, and
 * the second is the important one.
 *
 * The Destination Content PAT is server-only and lives in exactly one place. A
 * second product holding it is a second place it can leak from, and a second
 * reader to keep in step with a schema that has changed five times this year.
 *
 * And the reading is not trivial. The corpus has three status vocabularies
 * across five tables (see _lib/reference-status.js), country facts that walk
 * DOWN the hierarchy when a resort leaves them blank, JSON columns that are
 * sometimes malformed, and image URLs that have to be checked before anything
 * renders them. All of that is already written and hardened here. Exporting is
 * cheaper than reproducing it.
 *
 * A VISITOR NEVER REACHES THIS. It is a scheduled server-to-server pull, the
 * same shape as the offers cache: tg-sites keeps its own copy in Postgres and
 * every page renders from that. The rule in CLAUDE.md is that a visitor's browser
 * must never trigger a supplier call, and a page view that waited on Airtable
 * would be the same mistake wearing a different hat.
 *
 * AUTH is a dedicated secret rather than CRON_SECRET. Vercel's cron secret opens
 * eight endpoints that can write; this one only reads the corpus, so it gets its
 * own and the blast radius of sharing it with another deployment stays small.
 *
 *   GET /api/reference/export?kind=country
 *   Authorization: Bearer ${REFERENCE_EXPORT_SECRET}
 *
 * Answers { kind, seen, served, records: [...] }. `seen` and `served` are both
 * reported on purpose: a gate that matches nothing looks identical to a table
 * that is empty, and the difference is the whole of whether the sync is working.
 */

import { listAll, refConfigured } from './_ref.js';
import { isServable, REFERENCE_KINDS, servableFormula } from '../_lib/reference-status.js';

/*
 * Where each kind's values live. Field IDs rather than names, because listAll
 * asks for returnFieldsByFieldId and a field somebody renames in the Airtable UI
 * would otherwise take the export down without anything changing in this repo.
 *
 * Absent keys are absent facts, not errors: a city has no visa position of its
 * own and an airport has no climate year, and both are complete records.
 */
const TABLES = {
  country: {
    tableId: 'tblsxbqbyhTDoWhbo',
    fields: {
      name: 'flddJJrpwcXOwWIow', slug: 'fldDwZVR1C63K4HGT', status: 'fldCpclokepeFkQZ2',
      tagline: 'fldjpYZsvAdMt1KlW', heroIntro: 'fldv3l23pOs8Yj3px', overview: 'fldyyz5YdAhdFILdn',
      region: 'fldADwbC9R6R6jr35', flightTime: 'fldGPxNRuf9xao0He', timeZone: 'fldOqkxbOYfxL1Qxt',
      currency: 'fldoe2LemU2kZS3EP', language: 'fldypaRO1PZgwom22', voltage: 'fld5gv8Q7I0VrYib5',
      visaStatus: 'fldmKvRkDDRjj7PT2', bestFor: 'fldC5ZvX1hitoxWY6',
      temps: 'flda8AY7qIO5BQJyI', rainfall: 'fldJNzwIVJEHrHZZr', season: 'fldqx5p1U0siNtvYy',
    },
  },
  city: {
    tableId: 'tblTkKujdVZgWPAQe',
    fields: {
      name: 'fld2VkY61c1JKUWKB', slug: 'fldL6MlFZgZMW25Vp', status: 'fld8GKaD5SPycD4Ld',
      tagline: 'fldIu4zaqZZ7XUHZn', heroIntro: 'fldijlzHjf9BvhPJI', overview: 'fldLhvqoaLAED69OU',
      region: 'fld1pD6llYo3Q8WlJ', flightTime: 'fldjhp4H3MHcjLQbG', timeZone: 'fldftMgM4Z3XQYNcf',
      currency: 'fldyVpNjyezPfVeRM', language: 'fldFUbivACHoLzGkO', voltage: 'fldebFrJI6MHeRJsZ',
      bestFor: 'fldZQTVNuqRXHileW',
      temps: 'fldxjOSYkYRPOZQgx', rainfall: 'fldl296lX37f8stws', season: 'fldHwvHjSwkpEgFa2',
    },
  },
  resort: {
    tableId: 'tblwV9gnbVEyZ99gI',
    fields: {
      name: 'fldnvOipaWpG3W1rx', slug: 'fldwVxLg8V4CBi90B', status: 'fldTQcZWJ21MahuCF',
      tagline: 'fldwMqygnNpKvf9KO', heroIntro: 'fld9NFRPv1MVRL4G9', overview: 'fldrBplqTg6q2Kr0B',
      region: 'fldF9hitGwa75MYBa', flightTime: 'fldMlw191r1T3lFXe', timeZone: 'fldyV0RY9yxqDEJvR',
      currency: 'fldGNJTsJWk7VnUWf', language: 'fldX1CJSFmL8NKu3w', voltage: 'fldnjJpthgX61yp47',
      bestFor: 'fldTmH3gT1wT48PLn',
      temps: 'fld7m7s8LXamDaKzP', rainfall: 'fldCuW6FzzetUe0tV', season: 'fld5RyPuxYdFFIFhb',
    },
  },
  airport: {
    tableId: 'tblI2iVAbIGCtsGa7',
    fields: {
      name: 'fldlT6eApAdQHGYED', status: 'fldjvujj14Q9QNLLq', iata: 'fldcS9uu4NWMVaIVP',
      tagline: 'fldxsl1xMOzqVZ73f', overview: 'fldmRELkLWrUGL5Ss', flightTime: 'fldnqWFQ5fykmZ5Ci',
    },
  },
  attraction: {
    tableId: 'tblhVDUdpwaLabDmQ',
    fields: {
      name: 'fldboK0kstNohXgqJ', status: 'fldSMqzRfIwIcodgS', tagline: 'fldYpnpQzBV01Ogoa',
      overview: 'fldipL05iT6Kxryfb', bestFor: 'fld2RxBaZGkt9yfa8',
    },
  },
};

/** A trimmed string, or ''. Handles the {name} shape a singleSelect comes back as. */
function txt(value, max = 4000) {
  const raw = value && typeof value === 'object' && !Array.isArray(value) ? value.name : value;
  if (typeof raw !== 'string') return '';
  return raw.replace(/\s+/g, ' ').trim().slice(0, max);
}

/**
 * A short labelled fact: the whole value, or nothing at all.
 *
 * TRUNCATING A FACT IS WORSE THAN LOSING IT, and this was learned the expensive
 * way. The first version of this file capped flightTime at twenty characters,
 * taken from the field's own description ("Format: 'Xh YYm'"). The data does not
 * keep to that description. Santorini's real value is
 * "4h to Santorini, 25min transfer", which arrived on a client's page as
 * "4h to Santorini, 25m" — a complete-looking sentence and the wrong answer.
 * 699 of 1,035 records were sitting at exactly that cap.
 *
 * A missing fact is honest and simply draws no row. A truncated one is a lie
 * that looks like an answer, and nothing downstream can tell it was cut. So the
 * cap is now a GUARD against a runaway value rather than a formatter, set well
 * above anything real, and a value past it is dropped.
 *
 * The same argument the climate series already made: an impossible temperature
 * is dropped rather than clamped, because a clamped one looks deliberate. That
 * rule was applied to the numbers and not to the strings, which is the gap.
 */
function fact(value, max) {
  const clean = txt(value, max + 1);
  if (!clean || clean.length > max) return '';
  return clean;
}

/** A URL-safe segment, for the tables that carry no slug of their own. */
function slugify(value) {
  return String(value ?? '')
    .toLowerCase()
    .normalize('NFD')
    // Combining diacritics, as an explicit range: written as literal characters
    // this is a line an editor can silently mangle.
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

/**
 * One of the twelve-number climate columns, as numbers.
 *
 * The column is a comma-separated string typed by an author, so a stray space, a
 * trailing comma or a missing month are all things that reach here. Anything that
 * is not exactly twelve finite numbers comes back null and the chart is simply
 * not drawn: tg-sites refuses a partial year for the same reason, and a chart
 * with eleven months would put every bar under the wrong label.
 */
function series(value) {
  if (typeof value !== 'string') return null;
  const parts = value.split(',').map((part) => Number(part.trim()));
  if (parts.length !== 12 || parts.some((n) => !Number.isFinite(n))) return null;
  return parts;
}

/** The season column, as the closed set of tokens tg-sites accepts. */
function seasons(value) {
  if (typeof value !== 'string') return null;
  const parts = value.split(',').map((part) => part.trim().toLowerCase());
  if (parts.length !== 12) return null;
  if (parts.some((token) => !['best', 'shoulder', 'off'].includes(token))) return null;
  return parts;
}

/** Turn one Airtable record into the shape tg-sites stores under `__ref`. */
function toRecord(kind, record, map) {
  const get = (key) => (map[key] ? record.fields?.[map[key]] : undefined);

  const name = txt(get('name'), 200);
  if (!name) return null;

  const temps = series(get('temps'));
  const rainfall = series(get('rainfall'));
  const season = seasons(get('season'));

  const bestForRaw = get('bestFor');
  const bestFor = Array.isArray(bestForRaw)
    ? bestForRaw.map((tag) => txt(tag, 60)).filter(Boolean).slice(0, 6)
    : [];

  return {
    kind,
    sourceId: record.id,
    name,
    // Airports and attractions carry no slug column, so one is derived. The IATA
    // code is the better handle for an airport: two airports can share a city
    // name and nobody searches for "london-heathrow-airport".
    slug: txt(get('slug'), 120) || slugify(kind === 'airport' ? txt(get('iata'), 10) || name : name),
    prose: {
      /*
       * Prose is the SEED a client edits, so a cap here is tolerable in a way it
       * is not for a fact: a person reads this before publishing it and would
       * notice a sentence that stopped. Still raised, because 23 taglines were
       * sitting on the old one and none of them should have been.
       */
      tagline: txt(get('tagline'), 300),
      heroIntro: txt(get('heroIntro'), 1200),
      overview: txt(get('overview'), 6000),
    },
    facts: {
      kind,
      sourceId: record.id,
      /*
       * The numbers are headroom, not formats. Each is far above the longest
       * real value, so a drop means genuinely odd data rather than a slightly
       * chatty author, and the facts row stays a row rather than a paragraph.
       */
      region: fact(get('region'), 100),
      flightTime: fact(get('flightTime'), 100),
      timeZone: fact(get('timeZone'), 60),
      currency: fact(get('currency'), 60),
      language: fact(get('language'), 60),
      voltage: fact(get('voltage'), 60),
      visaStatus: fact(get('visaStatus'), 120),
      // All three or none, the same rule the renderer applies.
      ...(temps && rainfall && season ? { climate: { temps, rainfall, season } } : {}),
      ...(bestFor.length ? { bestFor } : {}),
    },
  };
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'GET') {
    res.statusCode = 405;
    return res.end('Method not allowed');
  }

  const secret = process.env.REFERENCE_EXPORT_SECRET || '';
  const auth = req.headers.authorization || '';
  // No secret configured is a closed door, not an open one.
  if (!secret || auth !== `Bearer ${secret}`) {
    res.statusCode = 401;
    return res.end('Unauthorized');
  }

  if (!refConfigured()) {
    res.statusCode = 503;
    return res.end('The destination content credential is not configured.');
  }

  const kind = String(req.query?.kind ?? '');
  const table = TABLES[kind];
  if (!table) {
    res.statusCode = 400;
    return res.end(`kind must be one of: ${REFERENCE_KINDS.join(', ')}`);
  }

  const formula = servableFormula(kind);
  if (!formula) {
    res.statusCode = 500;
    return res.end('No servable status is defined for that kind.');
  }

  try {
    const wanted = Object.values(table.fields);
    // Everything, then the gate applied here as well as in the formula. Belt and
    // braces: the formula is what keeps the request small, and isServable is what
    // this file can be tested on without a network.
    const all = await listAll(table.tableId, wanted);
    const served = [];
    for (const record of all) {
      if (!isServable(kind, record.fields?.[table.fields.status])) continue;
      const mapped = toRecord(kind, record, table.fields);
      if (mapped) served.push(mapped);
    }

    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.end(
      JSON.stringify({
        kind,
        // Both numbers, because a gate that matches nothing and a table that is
        // empty look identical from the far end, and only one of them is a bug.
        seen: all.length,
        served: served.length,
        records: served,
      }),
    );
  } catch (error) {
    // Never the upstream message: it can carry the base id and the formula.
    console.error('[reference/export]', kind, error?.message);
    res.statusCode = 502;
    return res.end('The destination content could not be read.');
  }
}
