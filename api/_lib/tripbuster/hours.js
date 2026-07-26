/**
 * Opening hours: validation, and working out whether an agency is open.
 *
 * WHY THIS IS SHARED, AND WHICH COPY WINS
 *
 * The same question gets asked in two places for two different reasons:
 *
 *   THE PAGE asks it to decide what to SHOW. It has to, because
 *   /api/tripbuster/deals is CDN-cached and therefore cannot carry a computed
 *   "open right now" — a cached yes would still read yes an hour after closing
 *   time. So the response carries the schedule and the page evaluates it.
 *
 *   THE DATABASE asks it again, from its own clock, to decide what to CHARGE
 *   (tb_agent_is_open in migration 009). That copy is the authority. A page that
 *   was cached, left open overnight or edited by hand cannot make a closed
 *   agency look open, because nothing the page says about hours is trusted.
 *
 * This file is the JavaScript half. `isOpenAt` here and `tb_agent_is_open` there
 * MUST agree, and the rules they implement are deliberately few enough to hold
 * in your head: a special day replaces the weekly pattern for that date, a day
 * with no periods is closed, and a period runs from `opens` inclusive to
 * `closes` exclusive.
 *
 * TIMES ARE LOCAL WALL-CLOCK TIMES against the agency's own zone, never offsets
 * from UTC. That is the whole reason British Summer Time needs no thought: nine
 * in the morning is nine in the morning in January and in July.
 *
 * Pure and dependency-free, so it unit tests without a database or a browser.
 */

import { cleanPhone } from './lead-schema.js';

/** 0 is Sunday, matching Postgres `extract(dow)` and JavaScript `getDay()`. */
export const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday',
  'Friday', 'Saturday'];

export const HOURS_MODES = ['always', 'scheduled'];
export const CLOSED_BEHAVIOURS = ['callback', 'show', 'hide'];
export const PHONE_WHEN_SHOWN = ['always', 'open', 'closed'];

/** A shop with more breaks than this is not a shop we need to model. */
const MAX_PERIODS_PER_DAY = 3;
const MAX_SPECIAL_DAYS = 60;
const MAX_EXTRA_PHONES = 6;

/**
 * 'HH:MM' to minutes past midnight.
 *
 * '24:00' is 1440 rather than 0, because Postgres `time '24:00'` means end of
 * day and a genuinely 24-hour Saturday is stored as 00:00 to 24:00. Treating it
 * as 0 would silently turn that into a zero-length day.
 */
export function toMinutes(value) {
  if (typeof value !== 'string') return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (min > 59) return null;
  if (h > 24 || (h === 24 && min > 0)) return null;
  return h * 60 + min;
}

/** Minutes past midnight back to 'HH:MM'. */
export function fromMinutes(total) {
  if (typeof total !== 'number' || !isFinite(total) || total < 0 || total > 1440) return null;
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * The agency's own wall clock at a given instant.
 *
 * Intl does the zone arithmetic, which is the only way to get this right without
 * shipping a timezone database. hourCycle 'h23' matters: with hour12:false some
 * runtimes render midnight as 24 rather than 00.
 */
export function localParts(at, timeZone) {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: timeZone || 'Europe/London',
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const p = {};
  for (const part of fmt.formatToParts(at)) p[part.type] = part.value;
  const shortDays = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    date: `${p.year}-${p.month}-${p.day}`,
    day: shortDays[p.weekday],
    minutes: Number(p.hour) * 60 + Number(p.minute),
  };
}

/** True when `minutes` falls inside a period. Start inclusive, end exclusive. */
function inPeriod(minutes, opens, closes) {
  const from = toMinutes(opens);
  const to = toMinutes(closes);
  if (from === null || to === null) return false;
  return minutes >= from && minutes < to;
}

/**
 * Is this agency open at `at`?
 *
 * `contact` is the object tb_agent_contact builds: timeZone, hoursMode, hours,
 * specialDays. An agency with no schedule is never closed, which is what keeps
 * every pre-009 agency behaving exactly as it did.
 */
export function isOpenAt(contact, at) {
  const c = contact || {};
  if (c.hoursMode !== 'scheduled') return true;

  const now = at instanceof Date ? at : new Date(at);
  const { date, day, minutes } = localParts(now, c.timeZone);

  // A special day REPLACES the weekly pattern, so it is checked first and
  // answered from whatever it says — including "closed all day".
  const special = (Array.isArray(c.specialDays) ? c.specialDays : [])
    .find((s) => s && s.date === date);
  if (special) {
    if (!special.opens || !special.closes) return false;
    return inPeriod(minutes, special.opens, special.closes);
  }

  return (Array.isArray(c.hours) ? c.hours : [])
    .some((h) => h && h.day === day && inPeriod(minutes, h.opens, h.closes));
}

/** Every period that applies on a given local date, in order. */
function periodsForDate(contact, dateStr, dayOfWeek) {
  const c = contact || {};
  const special = (Array.isArray(c.specialDays) ? c.specialDays : [])
    .find((s) => s && s.date === dateStr);
  if (special) {
    return special.opens && special.closes ? [{ opens: special.opens, closes: special.closes }] : [];
  }
  return (Array.isArray(c.hours) ? c.hours : [])
    .filter((h) => h && h.day === dayOfWeek)
    .map((h) => ({ opens: h.opens, closes: h.closes }))
    .sort((a, b) => toMinutes(a.opens) - toMinutes(b.opens));
}

/** Add whole days to a 'YYYY-MM-DD' string without tripping over month ends. */
function addDays(dateStr, n) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * Open or closed, and when that next changes.
 *
 * The "when" is what makes the closed state bearable to a traveller: "Closed,
 * opens 9am tomorrow" tells them what to do, where a bare "Closed" just stops
 * them. Looks a fortnight ahead, which is enough to cross a Christmas shutdown
 * and short enough to stay cheap.
 *
 * @returns {{open: boolean, scheduled: boolean, closesAt: string|null,
 *            opensAt: string|null, opensDay: number|null, opensDate: string|null}}
 */
export function openState(contact, at) {
  const c = contact || {};
  const now = at instanceof Date ? at : new Date(at);
  if (c.hoursMode !== 'scheduled') {
    return { open: true, scheduled: false, closesAt: null, opensAt: null, opensDay: null, opensDate: null };
  }

  const { date, day, minutes } = localParts(now, c.timeZone);
  const today = periodsForDate(c, date, day);

  const current = today.find((p) => inPeriod(minutes, p.opens, p.closes));
  if (current) {
    return {
      open: true,
      scheduled: true,
      closesAt: current.closes,
      opensAt: null,
      opensDay: null,
      opensDate: null,
    };
  }

  // Later today first, then forward day by day.
  const laterToday = today.find((p) => toMinutes(p.opens) > minutes);
  if (laterToday) {
    return {
      open: false,
      scheduled: true,
      closesAt: null,
      opensAt: laterToday.opens,
      opensDay: day,
      opensDate: date,
    };
  }

  for (let i = 1; i <= 14; i += 1) {
    const d = addDays(date, i);
    const dow = (day + i) % 7;
    const periods = periodsForDate(c, d, dow);
    if (periods.length) {
      return {
        open: false,
        scheduled: true,
        closesAt: null,
        opensAt: periods[0].opens,
        opensDay: dow,
        opensDate: d,
      };
    }
  }

  // Scheduled but nothing open in the next fortnight. Validation refuses an
  // empty schedule, so this means a long shutdown rather than a mistake.
  return { open: false, scheduled: true, closesAt: null, opensAt: null, opensDay: null, opensDate: null };
}

/** Which of an agency's numbers to show right now. */
export function phonesFor(contact, open) {
  const list = Array.isArray(contact && contact.phones) ? contact.phones : [];
  return list.filter((p) => {
    if (!p || !p.phone) return false;
    if (p.whenShown === 'open') return open;
    if (p.whenShown === 'closed') return !open;
    return true;
  });
}

/** Strip control characters, collapse whitespace, trim and cap. */
function text(value, max) {
  if (typeof value !== 'string') return null;
  const s = value
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return s ? s.slice(0, max) : null;
}

/**
 * Is this a time zone this runtime understands?
 *
 * Asked of Intl rather than checked against a list, because a hand-maintained
 * list of zones goes stale. The value is only ever stored in a column and passed
 * to `at time zone` as a value, never concatenated into SQL, so this is about
 * catching typos rather than about injection.
 */
function knownTimeZone(tz) {
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: tz }).format(new Date(0));
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * Validate a submitted schedule.
 *
 * REPLACE-ALL SEMANTICS. What comes back is the complete new set of hours,
 * special days and numbers, because that is how a settings form works: the agent
 * edits the whole week and saves it. Per-row CRUD would need ids in the client
 * and would let a half-applied save leave a day in a state the agent never
 * chose.
 *
 * @returns {{ok: boolean, errors: Array<{field, message}>, clean: object}}
 */
export function validateSchedule(input) {
  const errors = [];
  const body = input && typeof input === 'object' ? input : {};
  const clean = {};

  if (Object.prototype.hasOwnProperty.call(body, 'timeZone')) {
    const tz = text(body.timeZone, 64);
    if (!tz || !knownTimeZone(tz)) {
      errors.push({ field: 'timeZone', message: 'That is not a time zone we recognise' });
    } else {
      clean.timeZone = tz;
    }
  }

  if (Object.prototype.hasOwnProperty.call(body, 'hoursMode')) {
    if (!HOURS_MODES.includes(body.hoursMode)) {
      errors.push({ field: 'hoursMode', message: 'Choose either always open or set opening hours' });
    } else {
      clean.hoursMode = body.hoursMode;
    }
  }

  if (Object.prototype.hasOwnProperty.call(body, 'closedBehaviour')) {
    if (!CLOSED_BEHAVIOURS.includes(body.closedBehaviour)) {
      errors.push({ field: 'closedBehaviour', message: 'Choose what to show while you are closed' });
    } else {
      clean.closedBehaviour = body.closedBehaviour;
    }
  }

  if (Object.prototype.hasOwnProperty.call(body, 'hours')) {
    clean.hours = validatePeriods(body.hours, errors);
  }

  if (Object.prototype.hasOwnProperty.call(body, 'specialDays')) {
    clean.specialDays = validateSpecialDays(body.specialDays, errors);
  }

  if (Object.prototype.hasOwnProperty.call(body, 'phones')) {
    clean.phones = validatePhones(body.phones, errors);
  }

  // Scheduled with nothing open is permanently shut, which is almost always a
  // half-finished form rather than a decision. An agency genuinely closing down
  // has a status for that.
  const mode = clean.hoursMode !== undefined ? clean.hoursMode : body.currentHoursMode;
  if (mode === 'scheduled' && Array.isArray(clean.hours) && clean.hours.length === 0) {
    errors.push({
      field: 'hours',
      message: 'Add at least one day you are open, or switch back to always open',
    });
  }

  return { ok: errors.length === 0, errors, clean };
}

function validatePeriods(value, errors) {
  if (!Array.isArray(value)) {
    errors.push({ field: 'hours', message: 'Opening hours should be a list' });
    return [];
  }
  const out = [];
  const perDay = new Map();

  value.slice(0, 40).forEach((row, i) => {
    const r = row && typeof row === 'object' ? row : {};
    const day = Number(r.day);
    if (!Number.isInteger(day) || day < 0 || day > 6) {
      errors.push({ field: `hours[${i}].day`, message: 'That is not a day of the week' });
      return;
    }
    const opens = toMinutes(r.opens);
    const closes = toMinutes(r.closes);
    if (opens === null || closes === null) {
      errors.push({
        field: `hours[${i}]`,
        message: `${DAY_NAMES[day]}: use times like 09:00 and 17:30`,
      });
      return;
    }
    if (closes <= opens) {
      errors.push({
        field: `hours[${i}]`,
        message: `${DAY_NAMES[day]}: the closing time needs to be after the opening time`,
      });
      return;
    }
    const list = perDay.get(day) || [];
    // Overlaps are refused rather than merged. Merging would silently change
    // what the agent typed, and an agent who meant 09:00-17:00 but typed two
    // overlapping shifts wants telling, not correcting.
    if (list.some((p) => opens < p.closes && closes > p.opens)) {
      errors.push({
        field: `hours[${i}]`,
        message: `${DAY_NAMES[day]}: those two periods overlap`,
      });
      return;
    }
    if (list.length >= MAX_PERIODS_PER_DAY) {
      errors.push({
        field: `hours[${i}]`,
        message: `${DAY_NAMES[day]}: ${MAX_PERIODS_PER_DAY} periods in a day is the most we hold`,
      });
      return;
    }
    list.push({ opens, closes });
    perDay.set(day, list);
    out.push({ day, opens: fromMinutes(opens), closes: fromMinutes(closes) });
  });

  return out.sort((a, b) => (a.day - b.day) || (toMinutes(a.opens) - toMinutes(b.opens)));
}

function validateSpecialDays(value, errors) {
  if (!Array.isArray(value)) {
    errors.push({ field: 'specialDays', message: 'Special days should be a list' });
    return [];
  }
  const out = [];
  const seen = new Set();

  value.slice(0, MAX_SPECIAL_DAYS).forEach((row, i) => {
    const r = row && typeof row === 'object' ? row : {};
    const date = text(r.date, 10);
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) {
      errors.push({ field: `specialDays[${i}].date`, message: 'Use a date like 2026-12-25' });
      return;
    }
    // Round-tripping catches 31 February, which Date.parse accepts and rolls
    // forward rather than rejecting.
    if (new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date) {
      errors.push({ field: `specialDays[${i}].date`, message: 'That date does not exist' });
      return;
    }
    if (seen.has(date)) {
      errors.push({ field: `specialDays[${i}].date`, message: `${date} is listed twice` });
      return;
    }
    seen.add(date);

    const note = text(r.note, 80);
    const hasTimes = r.opens || r.closes;
    if (!hasTimes) {
      out.push({ date, opens: null, closes: null, note });
      return;
    }
    const opens = toMinutes(r.opens);
    const closes = toMinutes(r.closes);
    if (opens === null || closes === null || closes <= opens) {
      errors.push({
        field: `specialDays[${i}]`,
        message: `${date}: either leave both times blank for a full day closed, or give an opening and a later closing time`,
      });
      return;
    }
    out.push({ date, opens: fromMinutes(opens), closes: fromMinutes(closes), note });
  });

  return out.sort((a, b) => a.date.localeCompare(b.date));
}

function validatePhones(value, errors) {
  if (!Array.isArray(value)) {
    errors.push({ field: 'phones', message: 'Numbers should be a list' });
    return [];
  }
  const out = [];

  value.slice(0, MAX_EXTRA_PHONES).forEach((row, i) => {
    const r = row && typeof row === 'object' ? row : {};
    const label = text(r.label, 40);
    const phone = cleanPhone(r.phone);
    if (!label) {
      errors.push({ field: `phones[${i}].label`, message: 'Give this number a label, like "Out of hours"' });
      return;
    }
    if (!phone) {
      errors.push({ field: `phones[${i}].phone`, message: `${label}: that does not look like a phone number` });
      return;
    }
    const whenShown = PHONE_WHEN_SHOWN.includes(r.whenShown) ? r.whenShown : 'always';
    out.push({ label, phone, whenShown, sortOrder: out.length });
  });

  if (Array.isArray(value) && value.length > MAX_EXTRA_PHONES) {
    errors.push({
      field: 'phones',
      message: `${MAX_EXTRA_PHONES} extra numbers is the most we hold alongside your main one`,
    });
  }

  return out;
}
