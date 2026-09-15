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
//
// FULL NAMES ONLY, because this reads prose rather than tags. A scan of all
// 2,589 events found seven short forms in the descriptions and every one was
// the Spanish or Portuguese word for sea: Avenida do Mar, Semana del Mar, Viña
// del Mar. Not one was a month. Reading them as March is what had Carnaval da
// Madeira, whose description names no month at all, reported as disagreeing
// with itself. Tags still accept short forms; that is tagCovers, below.
const MONTH_RE = new RegExp(
  '(?<![\\p{L}\\p{N}])(' + MONTHS.join('|') + ')(?![\\p{L}\\p{N}])',
  'gu'
);

// Feasts on a fixed date. These say which month as plainly as the month name
// does, and the copy leans on them constantly: a dozen Christmas markets say
// "from late November through Christmas Eve" and name no second month at all.
// Only the Gregorian ones are here, and only where the date does not move.
// Anything that moves is MOVABLE_FEAST, further down, and still waits for a
// person.
const FIXED_FEASTS = [
  { re: "New Year(?:'s)? Day", month: 0 },
  { re: 'Twelfth Night|Epiphany|Three Kings', month: 0 },
  // Bare "New Year" could be the 31st or the 1st. December is the half that is
  // certain, and under-claiming by a day beats over-claiming a month.
  { re: "Christmas(?: Eve| Day)?|Christmastide|Boxing Day|Hogmanay|New Year(?:'s)?(?: Eve)?", month: 11 },
];

// Somebody else's new year. A capitalised word in front of "New Year" means it
// belongs to another calendar: Chinese New Year, Lunar New Year, Mwaka Kogwa
// New Year, Sinhala and Tamil New Year. So it is not December and it does not
// sit still. This reads a signal in the writing rather than keeping a list of
// cultures, which is the only version of this that stays right.
const OTHER_NEW_YEAR = /[\p{Lu}][\p{L}]*(?:[-'\u2019][\p{L}]+)*\s+New Year/u;

// A feast only says WHEN if the sentence is using it to say when. "on Boxing
// Day" and "through Christmas Eve" are dates. "Orthodox Christmas", "Bali's New
// Year" and "a Persian-origin New Year festival" are names, and three records
// proved it: Tbilisi's Orthodox Christmas is 7 January, Nyepi is in March and
// Mwaka Kogwa is in July. All three would have been overwritten with December
// by a rule that took the feast word on its own. So a feast needs a cue or a
// range word in front of it, where a plain month does not.
// A date with a start and no finish. See the note in monthTagFromText.
const OPEN_START = /\b(?:from|starting|starts?|opens?|opening|begins?|beginning|since|runs? from)\b\W*(?:early|mid|late|the)?\W*$/i;

const FEAST_CUE = /(?:\b(?:in|on|at|of|from|to|through|thru|until|till|into|over|across|before|after|around|by|each|every|runs?|held|begins?|starts?|ends?|falls?|celebrat\w*|marks?)\b\W*(?:the|a|an)?\W*)$/i;

const FIXED_FEAST_RE = new RegExp(
  '(?<![\\p{L}\\p{N}])(' + FIXED_FEASTS.map(f => f.re).join('|') + ')(?![\\p{L}\\p{N}])', 'gu');

/** Every month a piece of prose points at, in the order it points at them. */
function monthHits(s) {
  const hits = [];
  let m;
  MONTH_RE.lastIndex = 0;
  while ((m = MONTH_RE.exec(s))) {
    const i = monthIndex(m[1]);
    if (i >= 0) hits.push({ i, start: m.index, end: m.index + m[0].length, feast: false });
  }
  FIXED_FEAST_RE.lastIndex = 0;
  while ((m = FIXED_FEAST_RE.exec(s))) {
    const before = s.slice(Math.max(0, m.index - 30), m.index);
    if (!FEAST_CUE.test(before)) continue;
    if (/New Year/.test(m[1]) &&
        OTHER_NEW_YEAR.test(before.slice(-24) + m[0])) continue;
    const f = FIXED_FEASTS.find(x => new RegExp('^(?:' + x.re + ')$').test(m[1]));
    if (f) hits.push({ i: f.month, start: m.index, end: m.index + m[0].length, feast: true });
  }
  return hits.sort((a, b) => a.start - b.start);
}

// The words that turn two month names into a span. "late June through early
// September" covers July, so an entry tagged Jul is not in disagreement.
// The trailing hyphen matters. Without it "late November to mid-January" reads
// as two unrelated dates, because the gap being tested is " to mid-".
const RANGE_JOIN = /^[\s,]*(?:-|–|—|to|through|thru|until|till|into)[\s,]*(?:early|mid|late|the)?[-\s,]*$/i;

/**
 * The months a piece of prose can be read as covering, and the ones it names
 * outright. Two names joined by range language cover everything between them.
 */
export function monthsNamedIn(text) {
  const s = String(text || '');
  const hits = monthHits(s);
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
  // Split into groups first, then read each group. A season with two halves is
  // written "Jun-Aug, Dec-Feb", and splitting on the comma and the hyphen at the
  // same time turned that into four loose months, quietly dropping July and
  // January: the Rwenzori trekking record claimed neither of its peak months.
  // "Mid-December to February" is one date, not a span from Mid to December.
  const flat = raw.replace(/\b(early|mid|late)[-–]/gi, '$1 ');
  const groups = flat.split(/\s*(?:,|\band\b|\bor\b|\/)\s*/i).filter(Boolean);
  const out = new Set();
  for (const g of groups) {
    const parts = g.split(/\s*(?:[-–—]|\bto\b|\bthrough\b|\buntil\b)\s*/i)
      // "23 to 25 June" is a day range inside one month, so the bare 23 is not
      // a missing month name, it is a day.
      .filter(x => /[A-Za-z]/.test(x));
      // The first WORD is not always the month: a Highlights entry writes its date
    // as "Late October", and reading "Late" as the month threw the whole tag away.
    const idx = parts.map(p => {
      for (const w of String(p).match(/[A-Za-z]+/g) || []) { const i = monthIndex(w); if (i >= 0) return i; }
      return -1;
    });
    if (!idx.length || idx.some(i => i < 0)) return null;
    if (idx.length === 1) out.add(idx[0]);
    else if (idx.length === 2) for (const i of through(idx[0], idx[1])) out.add(i);
    else for (const i of idx) out.add(i);
  }
  return out.size ? out : null;
}

// A Highlights-shaped entry carries no month key, but it was written with the
// date in front of its description ("17 January. The patron saint of Menorca").
// Only a date at the FRONT counts: a month in the middle of a sentence is
// prose, and reading it as the event's date would be a guess.
const QUAL = '(?:early|mid|late|the)[-\\s]+';
const ONE_DATE = '(?:' + QUAL + ')?(?:\\d{1,2}(?:\\s*(?:to|-|–)\\s*\\d{1,2})?\\s+)?(?:' +
  MONTHS.join('|') + ')';
const LEADING_DATE = new RegExp(
  '^\\s*(' + ONE_DATE + '(?:\\s*(?:to|-|–|and|or|/)\\s*(?:' + ONE_DATE + '))?)' +
  '(?:\\s*\\([^)]{0,40}\\))?\\s*[.,–-]', 'i'
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

// A year sitting ON A DATE rather than a year something was founded in. The
// library is full of the second kind ("marking Pakistan's 1947 independence",
// "every May since 1913") and those are fine forever. The first kind rots: the
// Milano Cortina Games were described in the present tense seven months after
// the closing ceremony, the Dubai Air Show pointed at a November that had been,
// and Pakistan's two Eids carried 2026 dates that had passed.
const DATED_YEAR = new RegExp(
  '(?:(' + MONTHS.join('|') + ')(?:\\s+\\d{1,2})?(?:\\s+(?:in|of))?\\s+(20\\d\\d))' +
  '|(?:\\b(?:next|currently|upcoming|due|scheduled|through|until|till)\\b[^.]{0,36}?(20\\d\\d))', 'gi');

// The year a thing STARTED is not a claim about when it happens next.
const ORIGIN_YEAR = /\b(?:anniversar\w+|inscrib\w+|inscription|founded|established|since|first held|first staged|debut|launched|marking|commemorat\w+)\b/i;

// Nor is a year the writing already puts in the past. "Cortina hosted the
// February 2026 Games" and "most recently 12 December 2025" are both saying the
// right thing, and a checker that cannot hear the tense would send a person to
// fix copy that is already correct.
const PAST_TENSE = /\b(?:hosted|ran|took place|was|were|closed|ended|finished|staged|won|drew|most recently|last held|last staged|previous\w*|until)\b/i;

/** Every date this text pins to a year, as {year, month}. month is -1 if none. */
function datedYears(text) {
  const s = String(text || '');
  const out = [];
  let m;
  DATED_YEAR.lastIndex = 0;
  while ((m = DATED_YEAR.exec(s))) {
    if (ORIGIN_YEAR.test(s.slice(Math.max(0, m.index - 40), m.index + m[0].length))) continue;
    // The sentence the year sits in, so the tense can be heard.
    const from = s.lastIndexOf('.', m.index) + 1;
    const to = s.indexOf('.', m.index + m[0].length);
    if (PAST_TENSE.test(s.slice(from, to < 0 ? s.length : to))) continue;
    out.push({ year: Number(m[2] || m[3]), month: m[1] ? monthIndex(m[1]) : -1 });
  }
  return out;
}

/**
 * The years in this text that have already been. A year before this one has
 * gone whatever month it named. This year has gone only if the month it named
 * has: in September, "the February 2026 Games" is over and "through 2026" is
 * not. A date with no month is given the benefit of the doubt until the year
 * turns, which is the reading that never cries wolf.
 */
function yearsGone(text, thisYear, thisMonth) {
  const gone = datedYears(text).filter(d =>
    d.year < thisYear || (d.year === thisYear && d.month >= 0 && d.month < thisMonth));
  return [...new Set(gone.map(d => d.year))];
}

/**
 * What is wrong with this events array, in plain words, worst first.
 * An empty list means every entry reaches a traveller saying the same thing
 * twice. It does NOT mean the dates are right: only that the record agrees
 * with itself, which is the most a record can prove on its own.
 */
export function eventProblems(str, thisYear = new Date().getUTCFullYear(),
                              thisMonth = new Date().getUTCMonth()) {
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

    const blob = name + '. ' + String(e.description || '');
    const stale = yearsGone(blob, thisYear, thisMonth);
    if (stale.length) {
      problems.push(name + ' is written around ' + stale.join(' and ') +
        ', which has been and gone, so it needs the next date or the past tense');
    }

    const tag = tagCovers(month);
    if (!tag) return; // "Variable (Islamic calendar)" is an honest answer, not an error
    const { covered, named } = monthsNamedIn(blob);
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

// A month can also be the event's date by sitting in front of it: "Hokitika's
// March Wildfoods Festival", "The September Berber tribal festival", "the
// November full moon". Reading all 2,589 descriptions turned up 336 months
// with no cue word in front and almost every one was a date written this way.
// The single exception in the whole library is Trinidad's Road March, a music
// competition rather than a month, and it survives this because the word in
// front of it is neither "the" nor a possessive nor the start of a sentence.
const OWNED_BY = /(?:^|[.!?:;—–]\s+|\b(?:the|this|that|its|their|his|her|our|annual|traditional|biennial|biannual|yearly|peak|famous)\s+|['’]s\s+)$/i;

// A wider join than the one the audit uses. "late March or early April" is a
// fair Mar-Apr, and "across October and November" is a fair Oct-Nov, so both
// span when we are BUILDING a tag rather than checking one. The whole gap
// between the two month names has to match, so prose in between ("October,
// with the smaller version each September") is still two separate dates.
const SPAN_JOIN = /^[\s,&]*(?:-|–|—|to|through|thru|until|till|into|or|and|&|,)(?:\s+(?:to|into))?[\s,&]*(?:early|mid|late|the|into)?[-\s,&]*$/i;

// Feasts that land on a different month depending on the year. A description
// that leans on one of these is dating one year rather than the event, so the
// record keeps the tag it has and waits for a person. Diwali is the clearest
// case in the library: Chamarel's text says late October, which was true in
// 2025, and the tag says November, which is true in 2026. Neither half is
// wrong enough to overwrite the other from here.
//
// Christmas and the Gregorian New Year used to sit in this list and no longer
// do. They do not move, so they are read as the months they are, in
// FIXED_FEASTS above. OTHER_NEW_YEAR keeps everybody else's new year here.
const MOVABLE_FEAST = /\b(?:Easter|Holy Week|Semana Santa|Lent|Ash Wednesday|Shrove|Pentecost|Ascension|Ramadan|Eid|Hajj|Diwali|Deepavali|Hanukkah|Chanukah|Yom Kippur|Rosh Hashanah|Passover|Thanksgiving|Islamic calendar|lunar calendar|lunar month)\b/i;

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
  const hits = monthHits(s);
  if (!hits.length) return null;

  // A month written as one half of "April-June" is a date by construction, so
  // it needs no cue in front of it. Nor does Christmas Eve, which is a date and
  // nothing else.
  const inRange = new Set();
  for (let k = 0; k + 1 < hits.length; k++) {
    if (SPAN_JOIN.test(s.slice(hits[k].end, hits[k + 1].start))) { inRange.add(k); inRange.add(k + 1); }
  }
  const dated = hits.filter((h, k) => {
    if (h.feast || inRange.has(k)) return true;   // feasts were cued in monthHits
    const before = s.slice(Math.max(0, h.start - 30), h.start);
    return DATE_CUE.test(before.slice(-26)) || OWNED_BY.test(before);
  });
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

  // "Christmas markets from late November" says when the thing STARTS and
  // nothing about when it stops. Read as a single month that is November, and
  // three country records tagged December would have been narrowed to November,
  // losing the month the market is most famous for. An open start cannot
  // justify taking a month away, so it waits for a person instead.
  if (g.length === 1 && OPEN_START.test(s.slice(Math.max(0, g[0].start - 30), g[0].start))) return null;

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

  // The text dates a feast that moves, so it dates one year and not the event.
  if (MOVABLE_FEAST.test(blob) || OTHER_NEW_YEAR.test(blob)) return null;

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
