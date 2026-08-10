/**
 * Prayer Times — instant on-device computation (Andy, 10 Aug 2026).
 *
 * The widget was slow on the first view of the day because the first paint
 * waited on a live api.aladhan.com round trip. Prayer times are pure astronomy,
 * so the widget now computes the day on-device and paints instantly with no
 * network, keeping Aladhan as a silent background reconcile (source of truth +
 * cache). Coordinates + timezone are learned once from Aladhan and persisted, so
 * every day after the first-ever view of a place is instant.
 *
 * The maths was validated before shipping: sunrise/solar-noon/sunset agree with
 * an independent NOAA/Meeus model to within a minute at low/mid/high latitude
 * and both DST states, and the real widget was rendered end-to-end with the
 * network disabled, matching the validated calculator to the minute.
 *
 * These are source guards over the wiring (jsdom is a CI-only devDep; the
 * behavioural path is exercised in test/prayer-times-smoke.mjs).
 *
 * Run: node test/prayer-instant-local-smoke.mjs  (also: npm run test:prayer-instant)
 */
import { readFileSync } from 'node:fs';

const SRC = readFileSync(new URL('../public/widget-prayer.js', import.meta.url), 'utf8');

let passed = 0, failed = 0;
const ok = (name, cond) => { if (cond) { passed++; console.log('  ✓ ' + name); } else { failed++; console.error('  ✗ ' + name); } };

console.log('The local astronomy engine is present');
{
  ok('julianDay + sunPosition + astroTimes defined',
    /function julianDay\(/.test(SRC) && /function sunPosition\(/.test(SRC) && /function astroTimes\(/.test(SRC));
  ok('PRAYER_METHODS maps the default MWL method (3)', /const PRAYER_METHODS = \{[\s\S]*?3:\s*\{\s*fajr:\s*18,\s*isha:\s*17\s*\}/.test(SRC));
  ok('supports high-latitude modes (Angle/OneSeventh/NightMiddle)', /NightMiddle[\s\S]*OneSeventh[\s\S]*AngleBased/.test(SRC));
  ok('Hanafi vs Shafi Asr factor', /opts\.school === 1 \? 2 : 1/.test(SRC));
  ok('minute-based Isha (e.g. Umm al-Qura 90 min)', /isMinStr\(method\.isha\)[\s\S]{0,80}t\.maghrib \+ numOf\(method\.isha\)/.test(SRC));
}

console.log('It builds an Aladhan-shaped object so the existing render path is reused');
{
  ok('computeLocalData returns timings + date + meta',
    /function computeLocalData\([\s\S]*?timings:\s*timings[\s\S]*?date:\s*\{ hijri:[\s\S]*?meta:\s*\{ latitude:/.test(SRC));
  ok('Hijri via Intl islamic-umalqura', /islamic-umalqura/.test(SRC));
  ok('timezone offset via Intl (DST-correct)', /function tzOffsetHours\(/.test(SRC) && /formatToParts/.test(SRC));
  ok('nearest-minute rounding with per-prayer tune', /function hhmm\(hoursFloat, tuneMin\)/.test(SRC) && /\+ 0\.5 \/ 60/.test(SRC));
}

console.log('Load flow paints locally first, then reconciles with Aladhan');
{
  const lt = SRC.slice(SRC.indexOf('_loadTimings() {'), SRC.indexOf('_fetchTimings(key, dateKey, silent)'));
  ok('resolves local meta and picks today in the location zone',
    /const meta = this\._localMeta\(\);/.test(lt) && /zonedNow\(\(meta && meta\.tz\) \|\| this\._tz\)\.dateKey/.test(lt));
  ok('computes locally and ingests before any network',
    /computeLocalData\(meta\.lat, meta\.lng, dateKey, meta\.tz/.test(lt) && /this\._ingest\(local\);/.test(lt));
  ok('kicks off a silent background reconcile after the instant paint',
    /this\._fetchTimings\(key, dateKey, true\);\s*\/\/ silent reconcile/.test(lt));
  ok('still fetches (fallback) when it cannot compute locally',
    /this\._fetchTimings\(key, dateKey, false\);/.test(lt));
}

console.log('Reconcile is silent, learns coords+zone, and never disturbs the visitor');
{
  ok('silent path only re-renders when the exact times differ',
    /if \(this\._timingsChanged\(json\.data\) && !searchOpen\) this\._ingest\(json\.data\);/.test(SRC));
  ok('learns + persists coordinates and timezone from Aladhan meta',
    /this\._writeLocMeta\(this\._resolvedLoc, Number\(mo\.latitude\), Number\(mo\.longitude\), mo\.timezone\);/.test(SRC));
  ok('silent fetch failure keeps the instant local render', /if \(silent\) return;\s*\/\/ keep the instant local render/.test(SRC));
}

console.log('Persistence + own-location fast path');
{
  ok('per-location coords+zone store (read/write)', /_readLocMeta\(loc\)/.test(SRC) && /_writeLocMeta\(loc, lat, lng, tz\)/.test(SRC));
  ok('visitor own location uses the device timezone (no lookup)', /loc\.own \? localTz\(\) : ''/.test(SRC));
  ok('geolocation result is flagged own:true', /name: 'Your location', own: true/.test(SRC));
}

console.log('Version bumped for the feature');
{
  const vm = SRC.match(/const VERSION = '(\d+)\.(\d+)\.(\d+)'/);
  const atLeast = vm && (+vm[1] > 1 || (+vm[1] === 1 && +vm[2] >= 1));
  ok('VERSION is at or beyond 1.1.0', !!atLeast);
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
