/**
 * Building the copyright line.
 *
 * PURE, AND THE YEAR COMES IN AS AN ARGUMENT. That is the whole reason this is a
 * module rather than four lines inside the renderer: a function that reads the
 * clock itself can only be tested on the day somebody runs the tests, and the
 * one thing worth testing here is what happens at a year boundary and to a range
 * that does not make sense. The renderer passes the real year; a test passes
 * whichever year it wants to ask about.
 *
 * WHY THE YEAR IS COMPUTED AT ALL. A copyright typed into a paragraph is right
 * on the day somebody types it and wrong every January afterwards. Across a few
 * hundred client sites that is a few hundred footers quietly saying 2024, and
 * not one client notices their own. Working it out when the page is drawn means
 * it is right on 1 January with nobody touching anything.
 *
 * UTC, DELIBERATELY. The server's clock is UTC and that is what it reports. For
 * roughly one day a year a visitor in Auckland sees the old year for a few hours
 * after their own midnight, which is the smaller wrong of the two available:
 * guessing at a visitor's timezone would need a script, and a published page
 * ships none.
 */

/** The parts of the line a client actually chooses. */
export interface CopyrightParts {
  owner: string;
  /** Optional first year, for a range. Zero, or anything not sensible, is ignored. */
  startYear?: number;
  symbol: 'symbol' | 'word' | 'both' | 'none';
  suffix: string;
}

/**
 * The year, or a range of years, as it should read.
 *
 * A start year is used only when it is a real year AND earlier than now. A start
 * year in the future, or this same year, gives the year on its own rather than
 * "2026 to 2026" or a range drawn backwards.
 */
export function copyrightYears(currentYear: number, startYear?: number): string {
  const start = Number(startYear);
  if (!Number.isFinite(start) || start < 1000 || start >= currentYear) {
    return String(currentYear);
  }
  // An en dash, which is the punctuation for a span of years. A hyphen is for
  // joining words and a spaced dash is not house style.
  return `${start}–${currentYear}`;
}

/**
 * The whole line, assembled.
 *
 * Every part is optional except the year, and the joins cope with that: a client
 * who has filled in nothing but the owner gets "© 2026 Their Company", and one
 * who has cleared the owner too still gets a valid line rather than a stray
 * symbol with nothing after it.
 */
export function copyrightLine(parts: CopyrightParts, currentYear: number): string {
  const mark =
    parts.symbol === 'symbol'
      ? '©'
      : parts.symbol === 'word'
        ? 'Copyright'
        : parts.symbol === 'both'
          ? '© Copyright'
          : '';

  const years = copyrightYears(currentYear, parts.startYear);
  const owner = String(parts.owner ?? '').trim();
  const suffix = String(parts.suffix ?? '').trim();

  /*
   * The owner and the years are one phrase, so they join with a space; the
   * suffix is a separate sentence, so it joins with a full stop unless the owner
   * already ended in one. Without that check a company called "Travelgenix Ltd."
   * came out as "Travelgenix Ltd.. All rights reserved."
   */
  const head = [mark, years, owner].filter(Boolean).join(' ');
  if (!suffix) return head;
  return /[.!?]$/.test(head) ? `${head} ${suffix}` : `${head}. ${suffix}`;
}
