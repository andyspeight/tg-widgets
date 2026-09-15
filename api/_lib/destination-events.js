/**
 * Reading the Events JSON field, and saying when it cannot be trusted.
 *
 * WHY THIS IS A SHARED FILE. Two places need the same answer about an events
 * array and they were getting different ones. The content API read it to serve
 * a traveller, and the dashboard scored it to tell Andy whether the record was
 * done. The dashboard only asked "is this a non-empty JSON array", so 39
 * records read as FILLED while the app served either nothing or an undated
 * list. The tool said the work was finished and the product disagreed.
 *
 * THE FIELD HOLDS THREE SHAPES. The contract is {month, name, description} and
 * 2,460 entries follow it. Two batches do not: 15 resort records carry the
 * Highlights shape {icon, title, description} with the date written into the
 * front of the description, and 24 city records put the month under "period"
 * or "date". All of that content is real, researched and paid for, so it is
 * read rather than discarded.
 *
 * WHAT COUNTS AS A PROBLEM. Not "off contract" — unusable. An entry with no
 * name never reaches the app. An entry with no month anywhere shows up undated,
 * which is no use to somebody deciding when to travel. And an entry whose month
 * tag contradicts its own description is worse than either, because the tag is
 * what a traveller filters on and the description is what they read: tagging
 * Art Deco Weekend as February when its own text says mid-January sends a
 * February traveller to an event that finished six weeks earlier.
 *
 * Nothing here corrects anything. It reports what the record says about itself.
 */

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
                'July', 'August', 'September', 'October', 'November', 'December'];
const ABBR   = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** A month name or short name to its index, or -1. */
export function monthIndex(word) {
  const t = String(word || '').trim().replace(/\.$/, '');
  if (!t) return -1;
  const full = MONTHS.findIndex(m => m.toLowerCase() === t.toLowerCase());
  if (full >= 0) return full;
  if (/^sept$/i.test(t)) return 8;
  return ABBR.findIndex(m => m.toLowerCase() === t.toLowerCase());
}

/** Every month from a to b inclusive, wrapping the year end. Nov to Jan is 3. */
function through(a, b) {
  const out = [];
  let i = a;
  for (let k = 0; k < 12; k++) { out.push(i); if (i === b) break; i = (i + 1) % 12; }
  return out;
}

// Word boundaries here are Unicode-aware on purpose. The ASCII \b fires inside
// "Maré" and "Marbella", which read as March, and case matters because "may"
// and "march" are ordinary verbs while every real month in this copy is
// capitalised.
const MONTH_RE = new RegExp(
  '(?<![\\p{L}\\p{N}])(' + MONTHS.join('|') + '|' + ABBR.join('|') + '|Sept)(?![\\p{L}\\p{N}])',
  'gu'
);

// The words that turn two month names into a span. "late June through early
// September" covers July, so an entry tagged Jul is not in disagreement.
const RANGE_JOIN = /^[\s,]*(?:-|–|—|to|through|thru|until|till|into)[\s,]*(?:early|mid|late|the)?[\s,]*$/i;

/**
 * The months a piece of prose can be read as covering, and the ones it names
 * outright. Two names joined by range language cover everything between them.
 */
export function monthsNamedIn(text) {
  const s = String(text || '');
  const hits = [];
  let m;
  MONTH_RE.lastIndex = 0;
  while ((m = MONTH_RE.exec(s))) {
    const i = monthIndex(m[1]);
    if (i >= 0) hits.push({ i, start: m.index, end: m.index + m[0].length });
  }
  const covered = new Set(hits.map(h => h.i));
  for (let k = 0; k + 1 < hits.length; k++) {
    const between = s.slice(hits[k].end, hits[k + 1].start);
    if (between.length <= 18 && RANGE_JOIN.test(between)) {
      for (const i of through(hits[k].i, hits[k + 1].i)) covered.add(i);
    }
  }
  return { covered, named: [...new Set(hits.map(h => h.i))] };
}

/**
 * The months a tag covers, or null if it is not about months at all.
 * "Jul-Aug" is two, "Nov-Feb" is four, "Year-round" is all twelve, and
 * "Variable (Islamic calendar)" is honestly not a month and says so.
 */
export function tagCovers(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  if (/^(year[-\s]?round|monthly|varies|variable|various|all year|ongoing|any|seasonal)/i.test(raw)) {
    return new Set(through(0, 11));
  }
  const parts = raw.split(/\s*(?:[-–—/]|\bor\b|\band\b|,|\bto\b|\bthrough\b)\s*/i).filter(Boolean);
  const idx = parts.map(p => { const m = /([A-Za-z]+)/.exec(p); return m ? monthIndex(m[1]) : -1; });
  if (!idx.length || idx.some(i => i < 0)) return null;
  if (idx.length === 1) return new Set([idx[0]]);
  if (idx.length === 2 && /[-–—]|\bto\b|\bthrough\b/i.test(raw)) return new Set(through(idx[0], idx[1]));
  return new Set(idx);
}

// A Highlights-shaped entry carries no month key, but it was written with the
// date in front of its description ("17 January. The patron saint of Menorca").
// Only a date at the FRONT counts: a month in the middle of a sentence is
// prose, and reading it as the event's date would be a guess.
const LEADING_DATE = new RegExp(
  '^\\s*((?:\\d{1,2}(?:\\s*(?:to|-|–)\\s*\\d{1,2})?\\s+)?(?:' + MONTHS.join('|') + ')' +
  '(?:\\s*(?:to|-|–|and)\\s*(?:\\d{1,2}\\s+)?(?:' + MONTHS.join('|') + '))?)\\s*[.,–-]'
);

/** The month on an entry, from whichever key or sentence actually holds it. */
export function monthOf(entry) {
  if (!entry || typeof entry !== 'object') return '';
  for (const key of ['month', 'period', 'date']) {
    const v = entry[key];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  const lead = LEADING_DATE.exec(String(entry.description || ''));
  return lead ? lead[1].trim() : '';
}

/** The name on an entry, under either key. */
export function nameOf(entry) {
  if (!entry || typeof entry !== 'object') return '';
  for (const key of ['name', 'title']) {
    const v = entry[key];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return '';
}

/**
 * The events on a record as the app sees them: {month, name, description}.
 * Structure only. Callers that render this still escape and cap it themselves.
 */
export function readEvents(str, max = 6) {
  if (typeof str !== 'string' || !str.trim()) return [];
  let arr;
  try { arr = JSON.parse(str); } catch { return []; }
  if (!Array.isArray(arr)) return [];
  return arr.slice(0, max)
    .map(e => (e && typeof e === 'object')
      ? { month: monthOf(e), name: nameOf(e), description: String(e.description || '') }
      : null)
    .filter(e => e && e.name);
}

/**
 * What is wrong with this events array, in plain words, worst first.
 * An empty list means every entry reaches a traveller saying the same thing
 * twice. It does NOT mean the dates are right: only that the record agrees
 * with itself, which is the most a record can prove on its own.
 */
export function eventProblems(str) {
  if (typeof str !== 'string' || !str.trim()) return [];
  let arr;
  try { arr = JSON.parse(str); }
  catch { return ['the events are not valid JSON, so none of them reach the app']; }
  if (!Array.isArray(arr)) return ['the events are not a JSON array, so none of them reach the app'];
  if (!arr.length) return ['the events list is empty'];

  const problems = [];
  arr.forEach((e, i) => {
    const where = 'event ' + (i + 1);
    if (!e || typeof e !== 'object') { problems.push(where + ' is not an object, so it is dropped'); return; }
    const name = nameOf(e);
    if (!name) { problems.push(where + ' has no name, so it is dropped'); return; }

    const month = monthOf(e);
    if (!month) { problems.push(name + ' has no month, so it shows undated'); return; }

    const tag = tagCovers(month);
    if (!tag) return; // "Variable (Islamic calendar)" is an honest answer, not an error
    const { covered, named } = monthsNamedIn(name + '. ' + String(e.description || ''));
    if (named.length && ![...covered].some(m => tag.has(m))) {
      problems.push(name + ' is tagged ' + month + ' but its own description says ' +
        named.map(m => MONTHS[m]).join(' and '));
    }
  });
  return problems;
}
