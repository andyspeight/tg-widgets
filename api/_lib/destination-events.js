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

/* ------------------------------------------------------------------ *
 * Rebuilding a month tag from the description that sits under it.
 * ------------------------------------------------------------------ */

// The words that mark a month as a DATE rather than a passing mention. "the
// third weekend of May" and "18 February" are dates; "the 1276 Reconquista"
// names no month at all, and a festival that merely mentions another event's
// season is not telling us when it runs.
const DATE_CUE = /(?:\b(?:in|on|of|at|each|every|from|through|thru|until|till|during|across|over|runs?|ran|held|begins?|starts?|ends?|opens?|closes?|takes? place|returns?|falls?|late|early|mid|first|second|third|fourth|fifth|last|penultimate|weekend|weekends|week|weeks|days?|nights?|month|months|season)\b\W*|\d{1,2}\s*(?:(?:to|-|–|and)\s*\d{1,2}\s*)?)$/i;

// A wider join than the one the audit uses. "late March or early April" is a
// fair Mar-Apr, and "across October and November" is a fair Oct-Nov, so both
// span when we are BUILDING a tag rather than checking one. The whole gap
// between the two month names has to match, so prose in between ("October,
// with the smaller version each September") is still two separate dates.
const SPAN_JOIN = /^[\s,&]*(?:-|–|—|to|through|thru|until|till|into|or|and|&|,)[\s,&]*(?:early|mid|late|the|into)?[\s,&]*$/i;

// Feasts that name no month, or name a different one each year. A description
// that leans on one of these is not telling us when the thing happens, so the
// record keeps the tag it has and waits for a person. This is what stops
// Berlin's "late November through Christmas Eve" being retagged to November,
// which would be a worse answer than the December it already carries.
const MOVABLE_FEAST = /\b(?:Christmas|Christmastide|New Year(?:'s)?|Hogmanay|Easter|Holy Week|Lent|Ash Wednesday|Pentecost|Ramadan|Eid|Hajj|Diwali|Deepavali|Hanukkah|Chanukah|Yom Kippur|Rosh Hashanah|Passover|Thanksgiving|Lunar New Year|Islamic calendar|lunar calendar)\b/i;

/**
 * The month tag a description supports, or null where it does not support one.
 *
 * WHY THIS EXISTS. 227 events carry a month tag that contradicts their own
 * description, and on the sample that could be settled independently the
 * description was right every time. Andy's call, on 15 Sep 2026, was to rebuild
 * the tags from the descriptions.
 *
 * SO THIS INVENTS NOTHING. Every month it returns was already written into the
 * record by a person. Where the text does not clearly say when the thing
 * happens, it returns null and the record keeps the tag it has, because a
 * confident wrong answer is worse than an obvious disagreement. That covers
 * three cases: no month in a date position at all, a description naming two
 * unrelated dates (a festival in October with a smaller version each
 * September), and anything the cue list does not recognise.
 */
export function monthTagFromText(text) {
  const s = String(text || '');
  const hits = [];
  let m;
  MONTH_RE.lastIndex = 0;
  while ((m = MONTH_RE.exec(s))) {
    const i = monthIndex(m[1]);
    if (i >= 0) hits.push({ i, start: m.index, end: m.index + m[0].length });
  }
  if (!hits.length) return null;

  // A month written as one half of "April-June" is a date by construction, so
  // it needs no cue in front of it.
  const inRange = new Set();
  for (let k = 0; k + 1 < hits.length; k++) {
    if (SPAN_JOIN.test(s.slice(hits[k].end, hits[k + 1].start))) { inRange.add(k); inRange.add(k + 1); }
  }
  const dated = hits.filter((h, k) => inRange.has(k) || DATE_CUE.test(s.slice(Math.max(0, h.start - 26), h.start)));
  if (!dated.length) return null;

  // Group the dated mentions into spans, then require exactly one group. Two
  // separate dates in one description is a question for a person.
  const groups = [];
  for (const h of dated) {
    const last = groups[groups.length - 1];
    const prev = last && last[last.length - 1];
    if (prev && SPAN_JOIN.test(s.slice(prev.end, h.start))) last.push(h);
    else groups.push([h]);
  }
  const distinct = [...new Set(groups.map(g => g.map(h => h.i).join('>')))];
  if (distinct.length !== 1) return null;

  const g = groups[0];
  const months = [...new Set(g.map(h => h.i))];
  if (months.length === 1) return ABBR[months[0]];
  return ABBR[months[0]] + '-' + ABBR[months[months.length - 1]];
}

/**
 * The retag one event needs, or null where it needs none or we cannot tell.
 * Only ever proposes a change for an entry the audit already calls wrong, so a
 * record that agrees with itself is never touched.
 */
export function proposedRetag(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const name = nameOf(entry);
  if (!name) return null;
  const was = monthOf(entry);
  const tag = tagCovers(was);
  if (!tag) return null;                       // no month, or not a month at all

  const blob = name + '. ' + String(entry.description || '');
  const { covered, named } = monthsNamedIn(blob);
  if (!named.length) return null;              // nothing to rebuild from
  if ([...covered].some(i => tag.has(i))) return null;  // already agrees

  if (MOVABLE_FEAST.test(blob)) return null;   // the text names a feast, not a month

  const next = monthTagFromText(blob);
  if (!next || next === was) return null;
  // The rebuilt tag has to agree with the text it came from. It always should;
  // this is here so a future change to either side cannot write a tag that
  // disagrees with its own description all over again.
  const check = tagCovers(next);
  if (!check || ![...covered].some(i => check.has(i))) return null;

  const key = ['month', 'period', 'date'].find(k => typeof entry[k] === 'string' && entry[k].trim())
           || 'month';
  return { key, was, next, name };
}
