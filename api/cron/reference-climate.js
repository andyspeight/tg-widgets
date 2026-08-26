/**
 * POST /api/cron/reference-climate
 *
 * Fills the three climate series fields on the Countries, Cities and Resorts
 * tables from two independent reanalyses, a batch at a time. Added 26 Aug 2026,
 * after an audit found 118 of 284 city records still holding the written
 * climate summary these fields replaced, every one of them failing silently in
 * the widget because it is not twelve comma-separated values.
 *
 * WHY A CRON AND NOT A SESSION. The same restriction as the airport identity
 * fill: a Claude Code container cannot reach Open-Meteo, NASA POWER, Wikipedia
 * or any other climate source, so the numbers cannot be sourced from a session
 * and must not be written from memory. On a deploy both sources are reachable.
 *
 * WHAT IT WILL NOT DO:
 *   - write a record unless BOTH sources agree on all 24 values
 *   - write a partial series, because 11 good months and one guess still reads
 *     as a complete answer and cannot be spotted later
 *   - touch a record whose three fields are already valid
 *   - claim a write succeeded when it threw
 *
 * SEASON IS AUTHORED, NOT DERIVED, and a record without one is left alone. The
 * field means "when should a UK customer go", which is demand as much as
 * weather. A derived rule was tried and measured against the 166 city records a
 * human had already filled: 59.7% month agreement, 5 of 166 matching in full,
 * failing systematically on city breaks, tropics and ski resorts. So the
 * authored values live in api/_data/climate-seasons.json, keyed by record name,
 * and anything missing is reported as awaiting-season with the corroborated
 * numbers next to it so it can be written. The prose those records used to hold
 * is in docs/climate-archive/cities-climate-prose.json and usually states the
 * season outright, which is the right input for authoring one.
 *
 * TURN IT OFF once the three tables are clean. It scans a table in full on
 * every run to find what is due, which is waste when nothing is. When due
 * reaches 0 for all three, drop the entry from vercel.json crons.
 * REFERENCE_CLIMATE_WRITE=false stops the writes without removing the schedule.
 *
 * AUTH: Authorization: Bearer ${CRON_SECRET}.
 */

import { readFileSync } from 'node:fs';
import { runClimateFill } from '../reference/_climate.js';

/**
 * Authored Season values, keyed by record name. Read via `new URL(...)` so
 * Vercel's file tracer follows it, the same way the airport target list is
 * loaded. A missing or unreadable file means nothing is written rather than
 * something is guessed, which is the safe direction here.
 */
function authoredSeasons() {
  try {
    const url = new URL('../_data/climate-seasons.json', import.meta.url);
    const raw = JSON.parse(readFileSync(url, 'utf8'));
    return (raw && raw.seasons) || {};
  } catch (err) {
    console.error('[cron/reference-climate] authored seasons unreadable:', err && err.message);
    return {};
  }
}

// Cities first: that is where the 118 broken records are. The other two tables
// carry the identical fields and are picked up once cities is clean.
const TABLE_ORDER = ['cities', 'countries', 'resorts'];

export default async function handler(req, res) {
  const auth = req.headers['authorization'] || '';
  const secret = process.env.CRON_SECRET || '';
  if (!secret || auth !== `Bearer ${secret}`) { res.statusCode = 401; return res.end('Unauthorized'); }

  // Sized against the 300s maxDuration in vercel.json. Each record costs two
  // round trips and one of them pulls thirty years of daily values, so this is
  // deliberately modest. A run killed by the timeout is not dangerous, since
  // records already written stay written and the next run recomputes what is
  // due, but it is wasted work.
  // Both sources now pull thirty years of DAILY values, and there is a pause
  // between records to stay under Open-Meteo's per-minute limit, so a record
  // costs roughly ten seconds of the 300 available. Twelve leaves room for a
  // couple of slow responses without the run being killed mid-batch.
  const limit = parseInt(process.env.REFERENCE_CLIMATE_LIMIT || '12', 10);
  const write = process.env.REFERENCE_CLIMATE_WRITE !== 'false';

  try {
    const results = [];
    const seasons = authoredSeasons();
    let budget = limit;

    for (const table of TABLE_ORDER) {
      if (budget <= 0) break;
      const run = await runClimateFill({ table, limit: budget, write, authoredSeasons: seasons });
      results.push({
        table,
        due: run.due,
        processed: run.processed,
        filled: run.filled,
        failed: run.failed,
        skipped: run.skipped,
        awaitingSeason: run.awaitingSeason,
      });
      budget -= run.processed;

      // Anything that could not be written is a human's call, never a guess.
      const needsHuman = run.items
        .filter(i => i.verdict === 'conflict' || i.verdict === 'skipped')
        .map(i => ({ name: i.name, why: i.verdict, detail: i.disagreements || i.reason }));
      const writeFailures = run.items
        .filter(i => i.writeError)
        .map(i => ({ name: i.name, error: i.writeError }));

      // Records that verified cleanly and are only missing an authored Season.
      // Listed with the corroborated numbers and a suggestion so the values can
      // be written without re-running anything.
      const toAuthor = run.items
        .filter(i => i.verdict === 'awaiting-season')
        .map(i => ({ name: i.name, temps: i.temps, rainfall: i.rainfall, suggestion: i.suggestion }));

      if (needsHuman.length) results[results.length - 1].needsHuman = needsHuman;
      if (writeFailures.length) results[results.length - 1].writeFailures = writeFailures;
      if (toAuthor.length) results[results.length - 1].toAuthor = toAuthor;
    }

    const summary = {
      ok: true,
      writeEnabled: write,
      totals: {
        filled: results.reduce((n, r) => n + r.filled, 0),
        failed: results.reduce((n, r) => n + r.failed, 0),
        skipped: results.reduce((n, r) => n + r.skipped, 0),
        awaitingSeason: results.reduce((n, r) => n + r.awaitingSeason, 0),
        stillDue: results.reduce((n, r) => n + Math.max(0, r.due - r.processed), 0),
      },
      tables: results,
    };
    // A fill that fills nothing while work is outstanding is a failure wearing
    // a 200. The first live run did exactly that, and finding out why cost an
    // hour because the only trace was a success line among thousands. Error
    // level is the one log query that reliably completes on this project, so
    // that is where a no-op run belongs, with the reasons attached.
    const outstanding = results.reduce((n, r) => n + r.due, 0);
    if (outstanding > 0 && summary.totals.filled === 0) {
      const why = results.flatMap(r => (r.needsHuman || []).map(h => `${h.name}: ${h.detail}`)).slice(0, 5);
      console.error('[cron/reference-climate] WROTE NOTHING with', outstanding, 'records due.',
        JSON.stringify({ totals: summary.totals, writeEnabled: write, firstReasons: why }));
    } else {
      console.log('[cron/reference-climate]', JSON.stringify(summary));
    }
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify(summary));
  } catch (err) {
    console.error('[cron/reference-climate] error:', err && err.message);
    res.statusCode = 500;
    return res.end('error');
  }
}
