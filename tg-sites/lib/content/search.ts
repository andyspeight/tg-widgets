/**
 * Searching a site's own pages, as plain ranking over plain text.
 *
 * NO INDEX, NO SERVICE, NO JAVASCRIPT. A travel site is tens of pages, not
 * thousands, so the whole corpus is read on the request and scored in memory.
 * That is the same trade lib/db/pages.ts makes for the sitemap, and it is what
 * lets search work with nothing on the visitor's page: the box is a plain form,
 * the server does the reading, and the answer is HTML.
 *
 * PURE, so it can be tested with strings rather than a database. The caller
 * hands in a SearchDoc per page, already reduced to its title and its visible
 * text (lib/seo/audit.ts pageText does the reducing), and this ranks them and
 * cuts a snippet around the first match. Nothing here reads the network or the
 * clock.
 */

/** One page, reduced to the two things a search reads. */
export interface SearchDoc {
  /** The URL path, without a leading slash. Empty string is the home page. */
  path: string;
  title: string;
  /** The visible words on the page, in reading order. See pageText. */
  text: string;
}

/** A run of snippet text, marked when it is one of the words searched for. */
export interface SearchSegment {
  text: string;
  hit: boolean;
}

/** A page that matched, with a snippet cut around the first word found. */
export interface SearchHit {
  path: string;
  title: string;
  snippet: SearchSegment[];
}

const MAX_TERMS = 8;
const TERM_MAX = 40;
const SNIPPET_RADIUS = 90;
/** Past this a single word stops adding to the score, so length cannot rank a
 *  page that merely repeats a term above one that actually answers the query. */
const OCCURRENCE_CAP = 5;

/** The words to look for: lowercased, split on whitespace, bounded in both
 *  directions so a pasted paragraph cannot turn into a thousand-term query. */
function queryTerms(query: string): string[] {
  return query
    .toLowerCase()
    .split(/\s+/)
    .map((term) => term.trim())
    .filter(Boolean)
    .slice(0, MAX_TERMS)
    .map((term) => term.slice(0, TERM_MAX));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** How many times `needle` appears in `haystack`, both already lowercased. */
function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let from = 0;
  for (;;) {
    const at = haystack.indexOf(needle, from);
    if (at === -1) return count;
    count += 1;
    from = at + needle.length;
  }
}

/** The earliest position any term appears at, or -1 if none do. */
function firstMatch(lowerText: string, terms: string[]): number {
  let best = -1;
  for (const term of terms) {
    const at = lowerText.indexOf(term);
    if (at !== -1 && (best === -1 || at < best)) best = at;
  }
  return best;
}

/**
 * The words shown under a result, cut around the first match and marked.
 *
 * A window either side of the first match, nudged out to whole words so it
 * never begins or ends mid-word, with an ellipsis where it was cut. The window
 * is then split on the search terms so the caller can render each match in a
 * <mark> without any HTML ever being built here.
 */
function snippetFor(text: string, terms: string[], radius = SNIPPET_RADIUS): SearchSegment[] {
  if (!text) return [];

  const centre = Math.max(0, firstMatch(text.toLowerCase(), terms));
  let start = Math.max(0, centre - radius);
  let end = Math.min(text.length, centre + radius);

  // Out to word boundaries, so a snippet reads as words rather than fragments.
  if (start > 0) {
    const space = text.indexOf(' ', start);
    if (space !== -1 && space < centre) start = space + 1;
  }
  if (end < text.length) {
    const space = text.lastIndexOf(' ', end);
    if (space > centre) end = space;
  }

  let slice = text.slice(start, end).trim();
  if (start > 0) slice = `… ${slice}`;
  if (end < text.length) slice = `${slice} …`;

  return markTerms(slice, terms);
}

/** Split `text` into runs, the ones that are a search term marked hit. */
function markTerms(text: string, terms: string[]): SearchSegment[] {
  // Longest first, so "greek islands" wins over "greek" when both are present
  // and the mark covers the whole phrase rather than half of it.
  const parts = [...new Set(terms.filter(Boolean))]
    .sort((a, b) => b.length - a.length)
    .map(escapeRegExp);
  if (parts.length === 0) return [{ text, hit: false }];

  const re = new RegExp(`(${parts.join('|')})`, 'gi');
  const segments: SearchSegment[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    if (match.index > last) segments.push({ text: text.slice(last, match.index), hit: false });
    segments.push({ text: match[0], hit: true });
    last = match.index + match[0].length;
    // A zero-length match would loop forever; nudge past it. Cannot happen with
    // the patterns above, but the guard is cheaper than the reasoning.
    if (match.index === re.lastIndex) re.lastIndex += 1;
  }
  if (last < text.length) segments.push({ text: text.slice(last), hit: false });
  return segments;
}

/**
 * Rank the pages that match a query, best first, each with a snippet.
 *
 * A title match is worth far more than a body match, because a page titled
 * "Greece" is what somebody typing "greece" wants ahead of a page that mentions
 * it once in a footer. The whole phrase matching earns a further bonus, so
 * "greek islands" favours the page about exactly that over two pages that each
 * hold one of the words. An empty query returns nothing rather than everything.
 */
export function searchDocs(docs: readonly SearchDoc[], query: string, max = 20): SearchHit[] {
  const terms = queryTerms(query);
  if (terms.length === 0) return [];
  const phrase = query.trim().toLowerCase();

  const scored = docs
    .map((doc) => {
      const title = doc.title.toLowerCase();
      const text = doc.text.toLowerCase();
      let score = 0;
      for (const term of terms) {
        if (title.includes(term)) score += 10;
        score += Math.min(OCCURRENCE_CAP, countOccurrences(text, term));
      }
      if (phrase && title.includes(phrase)) score += 25;
      if (phrase && terms.length > 1 && text.includes(phrase)) score += 8;
      return { doc, score };
    })
    .filter((row) => row.score > 0);

  scored.sort((a, b) => b.score - a.score || a.doc.title.localeCompare(b.doc.title));

  return scored.slice(0, max).map(({ doc }) => ({
    path: doc.path,
    title: doc.title,
    snippet: snippetFor(doc.text, terms),
  }));
}
