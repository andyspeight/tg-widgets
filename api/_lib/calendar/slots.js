/**
 * Server-side availability maths for the Appointment Scheduler.
 *
 * Mirrors the widget's client-side generator exactly (host-timezone wall hours
 * → real DST-aware instants) so the two never disagree, then subtracts busy
 * intervals returned by the calendar provider's free/busy query.
 */

function clampNum(v, min, max, fb) { const n = parseInt(v, 10); return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fb; }
function pad2(n) { return String(n).padStart(2, '0'); }

function tzOffset(date, tz) {
  try {
    const dtf = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const p = dtf.formatToParts(date).reduce((a, x) => { a[x.type] = x.value; return a; }, {});
    const asUTC = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
    return Math.round((asUTC - date.getTime()) / 60000);
  } catch (e) { return 0; }
}
function wallToInstant(y, m0, d, hh, mm, tz) {
  const guess = Date.UTC(y, m0, d, hh, mm, 0);
  let off = tzOffset(new Date(guess), tz);
  let inst = guess - off * 60000;
  off = tzOffset(new Date(inst), tz);
  inst = guess - off * 60000;
  return new Date(inst);
}
function todayYmdInTz(tz) {
  try {
    const p = new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date()).reduce((a, x) => { a[x.type] = x.value; return a; }, {});
    return { y: +p.year, m: +p.month, d: +p.day };
  } catch (e) { const n = new Date(); return { y: n.getUTCFullYear(), m: n.getUTCMonth() + 1, d: n.getUTCDate() }; }
}
function dateKey(y, m0, d) { return y + '-' + pad2(m0 + 1) + '-' + pad2(d); }
function weekdayOf(y, m0, d) { return new Date(Date.UTC(y, m0, d)).getUTCDay(); }
function parseHM(s) { const m = /^(\d{1,2}):(\d{2})$/.exec(String(s || '').trim()); return m ? { h: clampNum(m[1], 0, 23, 9), m: clampNum(m[2], 0, 59, 0) } : null; }

/**
 * Availability counts as SET only when at least one weekday carries at least
 * one parseable time range. Anything less is a scheduler nobody can ever
 * book — never intentional — so it is rebuilt from the legacy fields or the
 * Mon-Fri 9-5 default. Mirrors the widget's migrate() exactly: an
 * availability of {} previously produced zero slots from every server
 * consumer (availability endpoint, share flow, booking validation).
 */
export function ensureAvailability(config) {
  const av = config && config.availability;
  const usable = av && typeof av === 'object' && Object.keys(av).some(k =>
    Array.isArray(av[k]) && av[k].some(r => Array.isArray(r) && parseHM(r[0]) && parseHM(r[1])));
  if (usable) return config;
  const wd = Array.isArray(config.workingDays) && config.workingDays.length ? config.workingDays.map(Number) : [1, 2, 3, 4, 5];
  const start = pad2(clampNum(config.startHour, 0, 23, 9)) + ':00';
  const endRaw = pad2(clampNum(config.endHour, 1, 24, 17) % 24) + ':00';
  const end = endRaw === '00:00' ? '23:59' : endRaw;
  const built = {};
  wd.forEach(d => { built[d] = [[start, end]]; });
  return Object.assign({}, config, { availability: built });
}

/**
 * Generate candidate slots for an event type across the booking window.
 * Returns [{ startISO, endISO, key }] sorted ascending.
 */
export function generateSlots(config, ev, opts) {
  opts = opts || {};
  const hostTz = config.timezone || 'Europe/London';
  const dur = clampNum(ev.mins, 5, 480, 30);
  const step = clampNum(config.slotInterval, 0, 240, 0) || dur;
  const rangeDays = clampNum(config.dateRangeDays, 1, 120, 30);
  const notice = Math.max(0, Number(config.minNoticeHours) || 0);
  const earliest = Date.now() + notice * 3600 * 1000;
  const fromMs = opts.from ? Date.parse(opts.from) : -Infinity;
  const toMs = opts.to ? Date.parse(opts.to) : Infinity;
  const blackout = new Set(Array.isArray(config.blackoutDates) ? config.blackoutDates : []);
  const av = config.availability || {};

  const out = [];
  const t = todayYmdInTz(hostTz);
  let cur = new Date(Date.UTC(t.y, t.m - 1, t.d));
  for (let off = 0; off <= rangeDays; off++) {
    const y = cur.getUTCFullYear(), m0 = cur.getUTCMonth(), d = cur.getUTCDate();
    const wd = weekdayOf(y, m0, d);
    const key = dateKey(y, m0, d);
    cur.setUTCDate(cur.getUTCDate() + 1);
    if (blackout.has(key)) continue;
    const ranges = av[wd] || av[String(wd)] || [];
    if (!ranges.length) continue;
    ranges.forEach(r => {
      const a = parseHM(r[0]), b = parseHM(r[1]);
      if (!a || !b) return;
      const startMin = a.h * 60 + a.m, endMin = b.h * 60 + b.m;
      for (let mins = startMin; mins + dur <= endMin; mins += step) {
        const inst = wallToInstant(y, m0, d, Math.floor(mins / 60), mins % 60, hostTz);
        const ms = inst.getTime();
        if (ms < earliest || ms < fromMs || ms > toMs) continue;
        out.push({ startISO: inst.toISOString(), endISO: new Date(ms + dur * 60000).toISOString(), key });
      }
    });
  }
  out.sort((x, y2) => x.startISO < y2.startISO ? -1 : 1);
  return out;
}

/**
 * Remove slots that overlap any busy interval [{start,end} ISO]. Optional
 * buffers (minutes) keep a gap before/after each meeting: the candidate slot is
 * widened by the buffers before testing the overlap.
 */
export function subtractBusy(slots, busy, buffers) {
  if (!Array.isArray(busy) || !busy.length) return slots;
  const before = Math.max(0, (buffers && Number(buffers.before)) || 0) * 60000;
  const after = Math.max(0, (buffers && Number(buffers.after)) || 0) * 60000;
  const intervals = busy.map(b => [Date.parse(b.start), Date.parse(b.end)]).filter(p => Number.isFinite(p[0]) && Number.isFinite(p[1]));
  return slots.filter(s => {
    const a = Date.parse(s.startISO) - before, b = Date.parse(s.endISO) + after;
    return !intervals.some(([bs, be]) => a < be && b > bs);   // overlap test
  });
}

/** The host-timezone calendar date (YYYY-MM-DD) of an instant. */
export function hostDateKey(iso, tz) {
  try { return new Intl.DateTimeFormat('en-CA', { timeZone: tz || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso)); }
  catch (e) { return ''; }
}

/** True if `startISO` (for `ev`) is a legitimate generatable slot. */
export function isValidSlot(config, ev, startISO) {
  const ms = Date.parse(startISO);
  if (!Number.isFinite(ms)) return false;
  const slots = generateSlots(config, ev, { from: new Date(ms - 60000).toISOString(), to: new Date(ms + 60000).toISOString() });
  return slots.some(s => Date.parse(s.startISO) === ms);
}
