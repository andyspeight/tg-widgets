/**
 * Smoke test for the two-source climate series fill.
 *
 * The rules this guards, in order of how badly they bite:
 *   1. Both sources must compute the SAME STATISTIC. The first build compared
 *      Open-Meteo's mean daily maximum against NASA POWER's climatology
 *      T2M_MAX, which is an absolute maximum over the period and ran 5 to 9
 *      degrees hotter. Every record disagreed and nothing was ever written.
 *      Both now go through one shared aggregation, and a test asserts they
 *      return identical numbers from identical daily inputs.
 *   2. A record is written only when both agree on all 24 values. A partial
 *      series is worse than none, because 11 good months and one guess still
 *      parses as a complete answer.
 *   3. A failed write is never counted as a fill.
 *   4. Season is authored, never derived. The fill refuses to write a record it
 *      has no authored season for, rather than leaving it half converted.
 *   5. A skip says what the host actually said, so a run that writes nothing is
 *      diagnosable without reading a log that cannot be searched.
 *
 * Run: node test/climate-fill-smoke.mjs
 */
import {
  CLIMATE_TABLES, DAYS_IN_MONTH,
  isValidNumberSeries, isValidSeasonSeries, needsClimateFill, readCoords,
  monthlyFromOpenMeteo, monthlyFromPower, corroborateMonthly, deriveSeason,
  formatSeries, runClimateFill,
} from '../api/reference/_climate.js';

let pass = 0; const fails = [];
const ok = (label, cond) => { if (cond) pass++; else fails.push(label); };

const CITY = CLIMATE_TABLES.cities;

// --- the field contract ----------------------------------------------------
ok('a good temp series validates', isValidNumberSeries('14,16,20,24,27,31,32,32,29,24,19,15', -60, 60));
ok('11 values is rejected', !isValidNumberSeries('1,2,3,4,5,6,7,8,9,10,11', -60, 60));
ok('13 values is rejected', !isValidNumberSeries('1,2,3,4,5,6,7,8,9,10,11,12,13', -60, 60));
ok('whitespace padding is rejected', !isValidNumberSeries('14, 16,20,24,27,31,32,32,29,24,19,15', -60, 60));
ok('a decimal is rejected', !isValidNumberSeries('14.5,16,20,24,27,31,32,32,29,24,19,15', -60, 60));
ok('a unit suffix is rejected', !isValidNumberSeries('14C,16,20,24,27,31,32,32,29,24,19,15', -60, 60));
ok('out of range temp is rejected', !isValidNumberSeries('99,16,20,24,27,31,32,32,29,24,19,15', -60, 60));
ok('negative temps are allowed', isValidNumberSeries('-12,-8,0,6,12,18,20,19,14,7,-2,-9', -60, 60));
ok('negative rainfall is rejected', !isValidNumberSeries('-5,60,40,20,10,2,0,0,5,35,65,80', 0, 2000));
ok('a good season series validates', isValidSeasonSeries('off,off,shoulder,shoulder,best,best,best,best,best,shoulder,off,off'));
ok('capitalised season token is rejected', !isValidSeasonSeries('Off,off,shoulder,shoulder,best,best,best,best,best,shoulder,off,off'));
ok('an unknown season token is rejected', !isValidSeasonSeries('peak,off,shoulder,shoulder,best,best,best,best,best,shoulder,off,off'));

// The real prose from the Mexico City record, which was failing silently.
const PROSE = 'Around 700mm a year. Almost all of it falls May to October as afternoon thunderstorms. November to April is bone dry.';
ok('the archived prose is correctly seen as invalid', !isValidNumberSeries(PROSE, 0, 2000));

// --- self-selection --------------------------------------------------------
const goodRecord = {
  [CITY.temps]: '14,16,20,24,27,31,32,32,29,24,19,15',
  [CITY.rainfall]: '85,75,95,70,75,140,175,185,155,75,60,75',
  [CITY.season]: 'shoulder,shoulder,best,best,best,shoulder,shoulder,shoulder,shoulder,best,best,best',
};
ok('a valid record is not due', !needsClimateFill(goodRecord, CITY));
ok('a record with prose is due', needsClimateFill({ ...goodRecord, [CITY.rainfall]: PROSE }, CITY));
ok('a record with a broken season alone is due', needsClimateFill({ ...goodRecord, [CITY.season]: 'best' }, CITY));
ok('an empty record is due', needsClimateFill({}, CITY));

// --- coordinates -----------------------------------------------------------
ok('reads the first coordinate pair', readCoords({ [CITY.coords[0][0]]: 19.43, [CITY.coords[0][1]]: -99.13 }, CITY).lat === 19.43);
ok('falls back to the second pair', readCoords({ [CITY.coords[1][0]]: 51.5, [CITY.coords[1][1]]: -0.12 }, CITY).lon === -0.12);
ok('null island is rejected', readCoords({ [CITY.coords[0][0]]: 0, [CITY.coords[0][1]]: 0 }, CITY) === null);
ok('an out of range latitude is rejected', readCoords({ [CITY.coords[0][0]]: 120, [CITY.coords[0][1]]: 10 }, CITY) === null);
ok('a missing coordinate is rejected', readCoords({}, CITY) === null);

// --- Open-Meteo aggregation ------------------------------------------------
// Two years where every day in a month carries the same values, so the right
// answer is arithmetic rather than a fixture nobody can check by hand.
function buildDaily({ temp = 10, rainPerDay = 1, years = [1991, 1992], isoTime = true } = {}) {
  const time = [], temperature_2m_max = [], precipitation_sum = [];
  for (const y of years) {
    for (let m = 0; m < 12; m++) {
      for (let d = 1; d <= DAYS_IN_MONTH[m]; d++) {
        const stamp = Date.UTC(y, m, d) / 1000;
        time.push(isoTime ? new Date(stamp * 1000).toISOString().slice(0, 10) : stamp);
        temperature_2m_max.push(temp + m); // vary by month so the mapping is testable
        precipitation_sum.push(rainPerDay);
      }
    }
  }
  return { daily: { time, temperature_2m_max, precipitation_sum } };
}

const om = monthlyFromOpenMeteo(buildDaily());
ok('open-meteo returns 12 months', om && om.tempMax.length === 12 && om.rainTotal.length === 12);
ok('january temp is the monthly mean', Math.abs(om.tempMax[0] - 10) < 1e-9);
ok('july temp maps to the right month', Math.abs(om.tempMax[6] - 16) < 1e-9);
ok('january rain is a MONTHLY TOTAL, not a daily mean', Math.abs(om.rainTotal[0] - 31) < 1e-9);
ok('february rain uses the right month length', Math.abs(om.rainTotal[1] - 28) < 1e-9);
ok('rain is averaged across years, not summed over them', Math.abs(om.rainTotal[0] - 31) < 1e-9);

const omUnix = monthlyFromOpenMeteo(buildDaily({ isoTime: false }));
ok('unixtime timestamps parse the same as ISO', Math.abs(omUnix.tempMax[6] - om.tempMax[6]) < 1e-9);
ok('a truncated response is refused', monthlyFromOpenMeteo({ daily: { time: [1], temperature_2m_max: [1], precipitation_sum: [1] } }) === null);
ok('a malformed response is refused', monthlyFromOpenMeteo({}) === null);

// --- NASA POWER aggregation ------------------------------------------------
// POWER's DAILY product, keyed YYYYMMDD. The climatology product was tried
// first and its T2M_MAX ran 5 to 9 degrees hot because it is an ABSOLUTE
// maximum over the period, not the mean of daily maxima. Both sources now go
// through the same aggregation, which is the only way a comparison between them
// means anything.
function buildPower({ temp = 10, rainPerDay = 1, years = [1991, 1992], sentinel = false } = {}) {
  const T2M_MAX = {}, PRECTOTCORR = {};
  for (const y of years) {
    for (let m = 0; m < 12; m++) {
      for (let d = 1; d <= DAYS_IN_MONTH[m]; d++) {
        const key = `${y}${String(m + 1).padStart(2, '0')}${String(d).padStart(2, '0')}`;
        T2M_MAX[key] = sentinel && d === 1 ? -999 : temp + m;
        PRECTOTCORR[key] = sentinel && d === 1 ? -999 : rainPerDay;
      }
    }
  }
  T2M_MAX.ANN = 15; PRECTOTCORR.ANN = rainPerDay; // summary key that must be ignored
  return { properties: { parameter: { T2M_MAX, PRECTOTCORR } } };
}

const pw = monthlyFromPower(buildPower());
ok('power returns 12 months', pw && pw.tempMax.length === 12);
ok('power january temp is the mean of daily maxima', Math.abs(pw.tempMax[0] - 10) < 1e-9);
ok('power july maps to the right month', Math.abs(pw.tempMax[6] - 16) < 1e-9);
ok('power rainfall sums the days into a month total', Math.abs(pw.rainTotal[0] - 31) < 1e-9);
ok('power february sums 28 days', Math.abs(pw.rainTotal[1] - 28) < 1e-9);
ok('the ANN summary key is ignored', Math.abs(pw.tempMax[0] - 10) < 1e-9);

// The two sources must produce IDENTICAL numbers from identical daily inputs.
// If they ever diverge here, the corroboration step is comparing two different
// statistics and every disagreement it reports is meaningless.
const omSame = monthlyFromOpenMeteo(buildDaily());
const pwSame = monthlyFromPower(buildPower());
ok('both sources agree exactly on the same daily inputs',
  omSame.tempMax.every((t, i) => Math.abs(t - pwSame.tempMax[i]) < 1e-9)
  && omSame.rainTotal.every((r, i) => Math.abs(r - pwSame.rainTotal[i]) < 1e-9));

const sentinelled = monthlyFromPower(buildPower({ sentinel: true }));
ok('a -999 sentinel does not drag the mean down', sentinelled && Math.abs(sentinelled.tempMax[0] - 10) < 1e-9);
ok('a malformed power response is refused', monthlyFromPower({}) === null);
ok('a power response with too few days is refused', monthlyFromPower({ properties: { parameter: { T2M_MAX: { 19910101: 5 }, PRECTOTCORR: { 19910101: 1 } } } }) === null);

// --- corroboration ---------------------------------------------------------
const agree = corroborateMonthly(om, pw);
ok('two agreeing sources corroborate', agree.agreed === true && agree.disagreements.length === 0);
ok('corroborated temps are integers', agree.temps.every(Number.isInteger));
ok('corroborated rainfall is never negative', agree.rainfall.every(v => v >= 0));

// THE unit error: forgetting to multiply mm/day by the month length.
const unitBug = { tempMax: pw.tempMax, rainTotal: pw.rainTotal.map((_, m) => 1) };
const caught = corroborateMonthly(om, unitBug);
ok('a mm/day vs mm/month unit error is caught', caught.agreed === false);
ok('the unit error is reported per month', caught.disagreements.some(d => d.startsWith('rain month')));

// Wrong hemisphere: summer and winter swapped.
const flipped = { tempMax: [...om.tempMax].reverse(), rainTotal: om.rainTotal };
ok('a seasonally inverted source is caught', corroborateMonthly(om, flipped).agreed === false);

// A small honest difference between two reanalyses must NOT be rejected.
const nudged = { tempMax: om.tempMax.map(t => t + 1.5), rainTotal: om.rainTotal.map(r => r * 1.15) };
ok('a plausible reanalysis difference still corroborates', corroborateMonthly(om, nudged).agreed === true);

// --- season derivation -----------------------------------------------------
const med = deriveSeason([14, 15, 17, 20, 24, 29, 32, 32, 28, 23, 18, 15], [80, 70, 60, 40, 20, 5, 1, 2, 25, 70, 90, 95]);
ok('a mediterranean summer derives best months', med.season.filter(s => s === 'best').length >= 2);
ok('a mediterranean profile is confident', med.confident === true);
ok('derived season is a valid series', isValidSeasonSeries(formatSeries(med.season)));

const ski = deriveSeason([-4, -3, 0, 5, 10, 14, 17, 16, 12, 6, 0, -3], [90, 80, 75, 60, 55, 60, 70, 80, 85, 95, 100, 95]);
ok('a ski profile yields no best month', ski.season.every(s => s !== 'best'));
ok('and is therefore NOT reported as confident', ski.confident === false);
ok('and says why', /winter or ski/.test(ski.reason));

const equatorial = deriveSeason(Array(12).fill(28), Array(12).fill(30));
ok('an all-best profile is not confident either', equatorial.confident === false);

// --- the orchestrator ------------------------------------------------------
const row = {
  id: 'rec1',
  fields: {
    [CITY.name]: 'Mexico City',
    [CITY.temps]: PROSE,
    [CITY.rainfall]: PROSE,
    [CITY.season]: PROSE,
    [CITY.coords[0][0]]: 19.4326,
    [CITY.coords[0][1]]: -99.1332,
  },
};
const seam = {
  listRows: async () => [row, { id: 'rec2', fields: { [CITY.name]: 'Already Fine', ...goodRecord } }],
  openMeteo: async () => ({ data: om }),
  power: async () => ({ data: pw }),
};

const AUTHORED = { 'Mexico City': 'shoulder,shoulder,best,best,best,shoulder,shoulder,shoulder,shoulder,best,best,shoulder' };

const dry = await runClimateFill({ table: 'cities', limit: 10, write: false, pauseMs: 0, authoredSeasons: AUTHORED, fetchers: { ...seam, patch: async () => { throw new Error('should not write'); } } });
ok('only the broken record is due', dry.due === 1);
ok('a valid record is left alone', !dry.items.some(i => i.name === 'Already Fine'));
ok('a dry run writes nothing', dry.filled === 0 && dry.failed === 0);

// Season is authored, never derived. Without one, nothing is written at all,
// because two of three fields is the half-converted state the audit found worse
// than leaving the record alone.
let untouched = true;
const noSeason = await runClimateFill({
  table: 'cities', limit: 10, write: true, pauseMs: 0,
  fetchers: { ...seam, patch: async () => { untouched = false; } },
});
ok('a record with no authored season is not written', untouched === true && noSeason.filled === 0);
ok('it is reported as awaiting a season', noSeason.awaitingSeason === 1 && noSeason.items[0].verdict === 'awaiting-season');
ok('the report carries the corroborated numbers for the author', isValidNumberSeries(noSeason.items[0].temps, -60, 60));
ok('the report offers a suggestion, clearly separate from a value', isValidSeasonSeries(noSeason.items[0].suggestion));

const badSeason = await runClimateFill({
  table: 'cities', limit: 10, write: true, pauseMs: 0,
  authoredSeasons: { 'Mexico City': 'best,best,best' },
  fetchers: { ...seam, patch: async () => { untouched = false; } },
});
ok('a malformed authored season is refused', badSeason.filled === 0 && badSeason.awaitingSeason === 1);
ok('and says the authored value was the problem', /not 12 valid tokens/.test(badSeason.items[0].reason));

let wrote = null;
const good = await runClimateFill({ table: 'cities', limit: 10, write: true, pauseMs: 0, authoredSeasons: AUTHORED, fetchers: { ...seam, patch: async (id, f) => { wrote = f; } } });
ok('a successful write is counted', good.filled === 1 && good.failed === 0);
ok('all three fields are written together', !!wrote && Object.keys(wrote).length === 3);
// Read through a guard: when an upstream rule correctly refuses to write, this
// block must report which rule failed rather than dying on a null dereference.
const w = f => (wrote ? wrote[f] : null);
ok('temps written are valid', isValidNumberSeries(w(CITY.temps), -60, 60));
ok('rainfall written is valid', isValidNumberSeries(w(CITY.rainfall), 0, 2000));
ok('season written is valid', isValidSeasonSeries(w(CITY.season)));
ok('the AUTHORED season is written, not a derived one', w(CITY.season) === AUTHORED['Mexico City']);

const broke = await runClimateFill({ table: 'cities', limit: 10, write: true, pauseMs: 0, authoredSeasons: AUTHORED, fetchers: { ...seam, patch: async () => { throw new Error('airtable 422'); } } });
ok('a failed write is not counted as filled', broke.filled === 0);
ok('a failed write is counted as failed', broke.failed === 1);
ok('the item carries the write error', /422/.test(broke.items[0].writeError || ''));

let touched = false;
const conflict = await runClimateFill({
  table: 'cities', limit: 10, write: true, pauseMs: 0, authoredSeasons: AUTHORED,
  fetchers: { ...seam, power: async () => ({ data: unitBug }), patch: async () => { touched = true; } },
});
ok('a disagreeing record is never written', touched === false && conflict.filled === 0);
ok('a disagreeing record is reported as a conflict', conflict.items[0].verdict === 'conflict');
ok('the conflict names the months', (conflict.items[0].disagreements || []).length > 0);

const noCoords = await runClimateFill({
  table: 'cities', limit: 10, write: true, pauseMs: 0,
  fetchers: { ...seam, listRows: async () => [{ id: 'r', fields: { [CITY.name]: 'Nowhere', [CITY.temps]: PROSE } }], patch: async () => { touched = true; } },
});
ok('a record with no coordinates is skipped, not guessed', noCoords.skipped === 1 && noCoords.filled === 0);

const deadSource = await runClimateFill({
  table: 'cities', limit: 10, write: true, pauseMs: 0,
  fetchers: { ...seam, power: async () => ({ data: null, error: 'HTTP 429 rate limited' }), patch: async () => { throw new Error('should not write'); } },
});
ok('one source failing means no write', deadSource.filled === 0 && deadSource.skipped === 1);
ok('and it says which source failed', /POWER/.test(deadSource.items[0].reason || ''));
// The first live run returned 200 having written nothing, and "did not answer"
// was all it could say. A skip has to carry what the host actually told us.
ok('and repeats what the host actually said', /429/.test(deadSource.items[0].reason || ''));

const bothDead = await runClimateFill({
  table: 'cities', limit: 10, write: true, pauseMs: 0, authoredSeasons: AUTHORED,
  fetchers: {
    ...seam,
    openMeteo: async () => ({ data: null, error: 'timed out after 45000ms' }),
    power: async () => ({ data: null, error: 'HTTP 503' }),
    patch: async () => { throw new Error('should not write'); },
  },
});
ok('both sources failing is reported per source', /Open-Meteo/.test(bothDead.items[0].reason) && /POWER/.test(bothDead.items[0].reason));
ok('a timeout is distinguishable from a rejection', /timed out/.test(bothDead.items[0].reason) && /503/.test(bothDead.items[0].reason));

const unparseable = await runClimateFill({
  table: 'cities', limit: 10, write: true, pauseMs: 0, authoredSeasons: AUTHORED,
  fetchers: { ...seam, power: async () => ({ data: null, error: 'response did not parse into 12 months' }), patch: async () => { throw new Error('should not write'); } },
});
ok('a response that parsed to nothing says so', /did not parse/.test(unparseable.items[0].reason));

// --- the other two tables share the contract -------------------------------
ok('countries table is configured', !!CLIMATE_TABLES.countries.temps);
ok('resorts table is configured', !!CLIMATE_TABLES.resorts.temps);
ok('every table maps three distinct climate fields', Object.values(CLIMATE_TABLES).every(t => new Set([t.temps, t.rainfall, t.season]).size === 3));
ok('an unknown table is refused', await runClimateFill({ table: 'nope' }).then(() => false, () => true));

// --- the authored season file ---------------------------------------------
// Every authored value must be writable, and every key must name a record that
// actually needs one. A typo in a name is the dangerous case: nothing errors,
// the record is quietly reported as awaiting-season forever, and the file looks
// finished. The archive lists exactly the records that were broken, so it is
// the right thing to check the keys against.
const { readFileSync } = await import('node:fs');
const authoredFile = JSON.parse(readFileSync(new URL('../api/_data/climate-seasons.json', import.meta.url), 'utf8'));
const archive = JSON.parse(readFileSync(new URL('../docs/climate-archive/cities-climate-prose.json', import.meta.url), 'utf8'));
const archivedNames = new Set(archive.records.map(r => r.name));

ok('the authored season file has a seasons map', !!authoredFile.seasons);
const authoredEntries = Object.entries(authoredFile.seasons);
ok('it is not empty', authoredEntries.length > 0);

const invalidValues = authoredEntries.filter(([, v]) => !isValidSeasonSeries(v)).map(([k]) => k);
ok(`every authored season is 12 valid tokens (bad: ${invalidValues.join(', ') || 'none'})`, invalidValues.length === 0);

const unknownNames = authoredEntries.map(([k]) => k).filter(k => !archivedNames.has(k));
ok(`every authored name matches a record needing one (unknown: ${unknownNames.join(', ') || 'none'})`, unknownNames.length === 0);

ok('the archive still holds all 118 records', archive.records.length === 118);
ok('no authored season is a season of one token repeated 12 times by accident',
  authoredEntries.every(([, v]) => new Set(v.split(',')).size > 1));

console.log(`  authored seasons: ${authoredEntries.length} of ${archive.records.length} records`);
console.log(`climate-fill: ${pass} passed, ${fails.length} failed`);
if (fails.length) { for (const f of fails) console.error('  FAIL:', f); process.exit(1); }
