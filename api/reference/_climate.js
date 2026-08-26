/**
 * Climate series fill (two-independent-source model).
 *
 * The Countries, Cities and Resorts tables each carry three climate fields that
 * the Spotlight widget reads as data, not prose:
 *
 *   Climate Temps     12 comma-separated daytime highs in Celsius, Jan to Dec
 *   Climate Rainfall  12 comma-separated monthly totals in millimetres
 *   Climate Season    12 comma-separated tokens, each best, shoulder or off
 *
 * Break any of those rules and the widget drops the value silently, which is
 * the worst kind of failure: the page still renders, just without the chart.
 * An audit on 26 Aug 2026 found 118 of 284 city records still holding the
 * written climate summary these fields replaced, so every one of them was
 * failing silently. Those summaries are archived at
 * docs/climate-archive/cities-climate-prose.json before anything overwrites them.
 *
 * TWO SOURCES, corroborated month by month:
 *   1. Open-Meteo archive API, ERA5 reanalysis, daily values aggregated here
 *   2. NASA POWER climatology, which is MERRA-2 based and independent of ERA5
 *
 * They are separate reanalyses from separate agencies built on separate models,
 * so agreement is real corroboration rather than one source quoting the other.
 * A month is written only when both saw it and they agree inside tolerance. If
 * any month fails, the WHOLE record is left alone and reported: a half-filled
 * series is worse than none, because 11 values still parse as valid input.
 *
 * SEASON IS NOT SOURCED AND IS NOT DERIVED. It is supplied, per record, by a
 * human, and the fill refuses to write a record without one.
 *
 * That is a change of position and the evidence is worth keeping. The first
 * version of this module derived Season from the corroborated numbers with a
 * warm-and-dry rule. Checking that rule against the 166 city records a human
 * had already filled gave 59.7% month-level agreement and only 5 of 166 records
 * matching in full, so roughly five months in twelve would have been wrong. The
 * failures were systematic rather than noisy: Amsterdam, Bruges, Dublin and
 * Copenhagen have 15 to 20 degree springs the human marks best because they are
 * city breaks and the rule marked off for not being beach-warm; the Caribbean
 * coast went entirely off on rainfall; Andorra and Bansko came out exactly
 * inverted because for a ski resort the cold IS the season.
 *
 * Season encodes destination type, school holidays and crowds. No weather rule
 * reaches that, so deriveSeason survives below only as a SUGGESTION shown in
 * the run report to speed up the human writing them. It is never written.
 *
 * Network note: the same restriction as the airport fill applies. A Claude Code
 * container cannot reach either source, so the fetch adapters are validated on
 * a deploy. The aggregation, corroboration and validation logic below is pure
 * and unit-tested. Writes are OFF unless `write:true` is passed.
 */

import { listAll } from './_ref.js';

const OPEN_METEO_ARCHIVE = 'https://archive-api.open-meteo.com/v1/archive';
const NASA_POWER_CLIMATOLOGY = 'https://power.larc.nasa.gov/api/temporal/climatology/point';

/** WMO standard normal period. */
export const NORMAL_START = '1991-01-01';
export const NORMAL_END = '2020-12-31';

/** Days per month, non-leap. Used to turn NASA POWER's mm/day into a month total. */
export const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const POWER_MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

/**
 * The three climate fields on each table, plus the coordinate fields to read.
 * Cities and Resorts each carry two coordinate pairs from earlier migrations,
 * so both are listed and the first valid pair wins.
 */
export const CLIMATE_TABLES = {
  cities: {
    label: 'Cities and Regions',
    tableId: 'tblTkKujdVZgWPAQe',
    name: 'fld2VkY61c1JKUWKB',
    temps: 'fldxjOSYkYRPOZQgx',
    rainfall: 'fldl296lX37f8stws',
    season: 'fldHwvHjSwkpEgFa2',
    coords: [['fldLDQj6e1K4lq3tT', 'fld2pa6AKkU6dIq7O'], ['fldjk3yUCbVQRuxx8', 'fldNSlAA0Qb1akknz']],
  },
  countries: {
    label: 'Countries',
    tableId: 'tblsxbqbyhTDoWhbo',
    name: 'flddJJrpwcXOwWIow',
    temps: 'flda8AY7qIO5BQJyI',
    rainfall: 'fldJNzwIVJEHrHZZr',
    season: 'fldqx5p1U0siNtvYy',
    coords: [['fldlxsWrbmU6ELUPW', 'fldz3whFdzKsZ66hg']],
  },
  resorts: {
    label: 'Resorts and Areas',
    tableId: 'tblwV9gnbVEyZ99gI',
    name: 'fldnvOipaWpG3W1rx',
    temps: 'fld7m7s8LXamDaKzP',
    rainfall: 'fldCuW6FzzetUe0tV',
    season: 'fld5RyPuxYdFFIFhb',
    coords: [['flda4Fa7bBj6Nf850', 'fldpXXwrWplV7DiKN'], ['fld4INRwIKWCG21RV', 'fldd8CwfdzCDhW68w']],
  },
};

// ---- pure: the field contract --------------------------------------------
/** Split a series cell into its raw parts. Pure. Never trims: padding is a fault. */
export function splitSeries(value) {
  if (value == null) return [];
  return String(value).split(',');
}

/** True when the cell is exactly 12 bare integers inside [min,max]. Pure. */
export function isValidNumberSeries(value, min, max) {
  const parts = splitSeries(value);
  if (parts.length !== 12) return false;
  return parts.every(p => {
    if (p !== p.trim() || p === '') return false;
    if (!/^-?\d+$/.test(p)) return false;
    const n = Number(p);
    return n >= min && n <= max;
  });
}

export const SEASON_TOKENS = Object.freeze(['best', 'shoulder', 'off']);

/** True when the cell is exactly 12 bare lowercase season tokens. Pure. */
export function isValidSeasonSeries(value) {
  const parts = splitSeries(value);
  if (parts.length !== 12) return false;
  return parts.every(p => SEASON_TOKENS.includes(p));
}

/**
 * Does this record still need filling? Pure.
 * True when ANY of the three fields is not a valid series, which is what makes
 * the pass self-selecting: it repairs broken records and never touches good ones.
 */
export function needsClimateFill(fields, map) {
  return !isValidNumberSeries(fields[map.temps], -60, 60)
    || !isValidNumberSeries(fields[map.rainfall], 0, 2000)
    || !isValidSeasonSeries(fields[map.season]);
}

/** First coordinate pair on the record that is actually usable. Pure. */
export function readCoords(fields, map) {
  for (const [latId, lonId] of map.coords) {
    const lat = fields[latId];
    const lon = fields[lonId];
    if (typeof lat === 'number' && typeof lon === 'number'
      && Number.isFinite(lat) && Number.isFinite(lon)
      && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180
      && !(lat === 0 && lon === 0)) {
      return { lat, lon };
    }
  }
  return null;
}

// ---- pure: source aggregation --------------------------------------------
/**
 * Turn Open-Meteo's daily archive into monthly normals. Pure.
 *
 * Temperature is the mean of the daily maxima falling in that calendar month
 * across every year. Rainfall is the mean ACROSS YEARS of each year's monthly
 * total, which is not the same as the mean daily value times the month length
 * and is the figure a "monthly rainfall" chart is expected to show.
 *
 * @returns { tempMax: number[12], rainTotal: number[12] } or null
 */
export function monthlyFromOpenMeteo(json) {
  const daily = json && json.daily;
  if (!daily || !Array.isArray(daily.time)) return null;
  const times = daily.time;
  const temps = daily.temperature_2m_max;
  const rain = daily.precipitation_sum;
  if (!Array.isArray(temps) || !Array.isArray(rain)) return null;
  if (times.length < 365) return null;

  const tSum = Array(12).fill(0), tCount = Array(12).fill(0);
  // rain is accumulated per (year, month) first, then averaged over the years.
  const rByYearMonth = new Map();

  for (let i = 0; i < times.length; i++) {
    const t = times[i];
    let year, month;
    if (typeof t === 'number') {
      const d = new Date(t * 1000);
      year = d.getUTCFullYear();
      month = d.getUTCMonth();
    } else {
      const s = String(t);
      year = Number(s.slice(0, 4));
      month = Number(s.slice(5, 7)) - 1;
    }
    if (!(month >= 0 && month <= 11) || !Number.isFinite(year)) continue;

    const tv = temps[i];
    if (typeof tv === 'number' && Number.isFinite(tv)) { tSum[month] += tv; tCount[month]++; }

    const rv = rain[i];
    if (typeof rv === 'number' && Number.isFinite(rv)) {
      const key = year * 12 + month;
      rByYearMonth.set(key, (rByYearMonth.get(key) || 0) + rv);
    }
  }

  const tempMax = [], rainTotal = [];
  for (let m = 0; m < 12; m++) {
    if (!tCount[m]) return null;
    tempMax.push(tSum[m] / tCount[m]);
    let sum = 0, years = 0;
    for (const [key, total] of rByYearMonth) {
      if (key % 12 === m) { sum += total; years++; }
    }
    if (!years) return null;
    rainTotal.push(sum / years);
  }
  return { tempMax, rainTotal };
}

/**
 * Turn a NASA POWER climatology response into the same shape. Pure.
 *
 * POWER reports PRECTOTCORR as a mean DAILY rate in mm/day, so it has to be
 * multiplied by the month length to compare with a monthly total. Getting this
 * wrong understates rainfall roughly thirtyfold, which is exactly the sort of
 * unit error a second source exists to catch, so it is asserted in the tests.
 * Missing values come back as -999.
 */
export function monthlyFromPower(json) {
  const p = json && json.properties && json.properties.parameter;
  if (!p || !p.T2M_MAX || !p.PRECTOTCORR) return null;
  const tempMax = [], rainTotal = [];
  for (let m = 0; m < 12; m++) {
    const key = POWER_MONTHS[m];
    const t = p.T2M_MAX[key];
    const r = p.PRECTOTCORR[key];
    if (typeof t !== 'number' || typeof r !== 'number') return null;
    if (t <= -900 || r <= -900) return null;
    tempMax.push(t);
    rainTotal.push(r * DAYS_IN_MONTH[m]);
  }
  return { tempMax, rainTotal };
}

// ---- pure: corroboration --------------------------------------------------
/** Tolerances. Loose enough that two reanalyses can agree, tight enough to
 *  catch the errors that matter: wrong grid cell, wrong hemisphere, wrong unit. */
export const TEMP_TOLERANCE_C = 3;
export const RAIN_TOLERANCE_FRACTION = 0.4;
export const RAIN_TOLERANCE_FLOOR_MM = 12;

/**
 * Compare the two sources month by month. Pure.
 *
 * Returns the rounded values only when both agree, plus a list of every month
 * that did not. The caller writes nothing unless all 24 comparisons passed:
 * an 11-month series is silently wrong rather than visibly missing.
 */
export function corroborateMonthly(a, b) {
  const disagreements = [];
  const temps = [], rainfall = [];
  for (let m = 0; m < 12; m++) {
    const at = a.tempMax[m], bt = b.tempMax[m];
    if (Math.abs(at - bt) > TEMP_TOLERANCE_C) {
      disagreements.push(`temp month ${m + 1}: ${at.toFixed(1)} vs ${bt.toFixed(1)}`);
    }
    temps.push(Math.round(at));

    const ar = a.rainTotal[m], br = b.rainTotal[m];
    const allowed = Math.max(RAIN_TOLERANCE_FLOOR_MM, RAIN_TOLERANCE_FRACTION * ((ar + br) / 2));
    if (Math.abs(ar - br) > allowed) {
      disagreements.push(`rain month ${m + 1}: ${Math.round(ar)} vs ${Math.round(br)}`);
    }
    rainfall.push(Math.max(0, Math.round(ar)));
  }
  return { temps, rainfall, disagreements, agreed: disagreements.length === 0 };
}

/**
 * Suggest a Season from corroborated numbers. Pure. NEVER WRITTEN.
 *
 * Measured against 166 human-filled city records this rule agrees on 59.7% of
 * months and matches only 5 records in full, so it is not fit to write. It is
 * kept because a wrong-but-close starting point is still faster to correct than
 * a blank line, and the run report shows it next to the real numbers for
 * whoever is authoring the seasons. Treat every output as a prompt, not an
 * answer, and read the archived prose alongside it: that prose usually states
 * the season outright, which is where the authored value should come from.
 */
export function deriveSeason(temps, rainfall) {
  const season = [];
  for (let m = 0; m < 12; m++) {
    const t = temps[m], r = rainfall[m];
    if (t >= 22 && t <= 33 && r <= 90) season.push('best');
    else if (t < 16 || t > 36 || r > 200) season.push('off');
    else season.push('shoulder');
  }
  const best = season.filter(s => s === 'best').length;
  const confident = best >= 1 && best <= 11;
  const reason = best === 0
    ? 'no month scores best, so the warm-and-dry rule does not describe this place (often a winter or ski destination)'
    : best === 12
      ? 'every month scores best, so the rule is not discriminating (often equatorial)'
      : '';
  return { season, confident, reason };
}

/** Render a series for Airtable. Bare values, no spaces. Pure. */
export function formatSeries(values) {
  return values.join(',');
}

// ---- network adapters (validated on a deploy) -----------------------------
async function getJson(url, timeoutMs = 45000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, {
      signal: ctrl.signal,
      headers: { 'User-Agent': 'LunaBrain/1.0 (+https://travelify.io)', Accept: 'application/json' },
    });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchOpenMeteo(lat, lon) {
  const qs = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    start_date: NORMAL_START,
    end_date: NORMAL_END,
    daily: 'temperature_2m_max,precipitation_sum',
    timezone: 'UTC',
    timeformat: 'unixtime',
  });
  const json = await getJson(`${OPEN_METEO_ARCHIVE}?${qs}`);
  return json ? monthlyFromOpenMeteo(json) : null;
}

async function fetchPower(lat, lon) {
  const qs = new URLSearchParams({
    parameters: 'T2M_MAX,PRECTOTCORR',
    community: 'AG',
    latitude: String(lat),
    longitude: String(lon),
    format: 'JSON',
  });
  const json = await getJson(`${NASA_POWER_CLIMATOLOGY}?${qs}`);
  return json ? monthlyFromPower(json) : null;
}

async function patchRecord(tableId, recordId, fields) {
  const PAT = process.env.AIRTABLE_DESTINATION_CONTENT_PAT || process.env.AIRTABLE_PAT;
  const BASE = process.env.REFERENCE_BASE_ID || 'appuZdlMJ7HKUt6qS';
  const r = await fetch(`https://api.airtable.com/v0/${BASE}/${tableId}/${recordId}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${PAT}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields, typecast: true }),
  });
  if (!r.ok) throw new Error(`airtable ${r.status}`);
  return r.json();
}

// ---- orchestrator ---------------------------------------------------------
/**
 * @param opts.table   key of CLIMATE_TABLES, default 'cities'
 * @param opts.limit   max records to process this run
 * @param opts.write   if true, patch the records (default false: dry run)
 * @param opts.authoredSeasons map of record name to a valid 12-token season
 *        string. A record without one is reported as awaiting-season and left
 *        untouched, because Season cannot be derived (see deriveSeason).
 * @param opts.fetchers test seam: { openMeteo, power, listRows, patch }
 * @returns { due, processed, filled, failed, skipped, awaitingSeason, items[] }
 *          `filled` counts records actually written. `failed` counts records
 *          whose write threw. They are separate on purpose, and neither is
 *          allowed to be reported as the other.
 */
export async function runClimateFill({ table = 'cities', limit = 20, write = false, authoredSeasons = {}, fetchers } = {}) {
  const map = CLIMATE_TABLES[table];
  if (!map) throw new Error(`unknown climate table: ${table}`);

  const getOM = (fetchers && fetchers.openMeteo) || fetchOpenMeteo;
  const getPW = (fetchers && fetchers.power) || fetchPower;
  const patch = (fetchers && fetchers.patch) || ((id, fields) => patchRecord(map.tableId, id, fields));
  const coordFields = map.coords.flat();
  const readRows = (fetchers && fetchers.listRows)
    || (() => listAll(map.tableId, [map.name, map.temps, map.rainfall, map.season, ...coordFields]));

  const rows = await readRows();
  const due = rows.filter(r => needsClimateFill(r.fields || {}, map));

  const items = [];
  let filled = 0, failed = 0, skipped = 0, awaitingSeason = 0;

  for (const row of due.slice(0, limit)) {
    const fields = row.fields || {};
    const name = fields[map.name] || row.id;
    const coords = readCoords(fields, map);
    if (!coords) {
      items.push({ name, verdict: 'skipped', reason: 'no usable coordinates' });
      skipped++;
      continue;
    }

    const [om, pw] = await Promise.all([getOM(coords.lat, coords.lon), getPW(coords.lat, coords.lon)]);
    if (!om || !pw) {
      items.push({
        name,
        verdict: 'skipped',
        reason: !om && !pw ? 'neither source answered' : !om ? 'Open-Meteo did not answer' : 'NASA POWER did not answer',
      });
      skipped++;
      continue;
    }

    const cross = corroborateMonthly(om, pw);
    if (!cross.agreed) {
      // Never write a partial series. Eleven good months and one guess reads as
      // a complete answer and is impossible to spot later.
      items.push({ name, verdict: 'conflict', disagreements: cross.disagreements.slice(0, 6) });
      skipped++;
      continue;
    }

    // Season is authored, never derived. Without one the record is left exactly
    // as it is: writing two of the three fields would leave a half-converted
    // record, which is the state the 26 Aug audit specifically found to be
    // worse than an untouched one.
    const authored = authoredSeasons[name];
    if (!isValidSeasonSeries(authored)) {
      items.push({
        name,
        verdict: 'awaiting-season',
        reason: authored ? 'authored season is not 12 valid tokens' : 'no authored season for this record',
        // Shown to help whoever writes it, and explicitly not a value we trust.
        suggestion: formatSeries(deriveSeason(cross.temps, cross.rainfall).season),
        temps: formatSeries(cross.temps),
        rainfall: formatSeries(cross.rainfall),
      });
      awaitingSeason++;
      continue;
    }

    const out = {
      [map.temps]: formatSeries(cross.temps),
      [map.rainfall]: formatSeries(cross.rainfall),
      [map.season]: authored,
    };

    // Refuse to write anything that would not survive our own validator.
    if (!isValidNumberSeries(out[map.temps], -60, 60)
      || !isValidNumberSeries(out[map.rainfall], 0, 2000)
      || !isValidSeasonSeries(out[map.season])) {
      items.push({ name, verdict: 'conflict', disagreements: ['derived series failed validation'] });
      skipped++;
      continue;
    }

    let applied = false;
    let writeError = null;
    if (write) {
      try {
        await patch(row.id, out);
        applied = true;
        filled++;
      } catch (err) {
        writeError = (err && err.message) || String(err);
        failed++;
      }
    }

    items.push({
      name,
      verdict: 'filled',
      applied,
      ...(writeError ? { writeError } : {}),
    });
  }

  return {
    table,
    due: due.length,
    processed: items.length,
    filled,
    failed,
    skipped,
    awaitingSeason,
    items,
  };
}
