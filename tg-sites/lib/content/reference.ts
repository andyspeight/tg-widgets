/**
 * The facts half of a destination.
 *
 * WHY A DESTINATION IS TWO THINGS AT ONCE. Travelgenix maintains a researched,
 * two-source-verified corpus: 108 countries, 284 cities and regions, 495 resorts,
 * 46 attractions and a growing airport table. A client site that publishes Greece
 * should get those facts and keep getting them, because a visa rule changes and
 * every site carrying it should change with it. But the WORDS on that page have
 * to be the client's own, or forty agencies publish the same overview and compete
 * with each other for it.
 *
 * So an adopted destination is stored as an ordinary collection item, and it
 * carries two kinds of value that live in two different places:
 *
 *   PROSE   the item's own `data`. Seeded once when the client adopts the
 *           destination, then theirs. Never overwritten by a sync.
 *   FACTS   the corpus row the item points at, through the ref_kind and
 *           ref_source_id columns added in migration 0029. Refreshed by the
 *           sync, never editable, never authored by hand. This module
 *           validates that payload on the way out.
 *
 * That split is the whole design. It is what lets the corpus stay current and the
 * page still sound like the agency that published it.
 *
 * AN EARLIER VERSION PUT THE FACTS INSIDE `data` UNDER A RESERVED `__ref` KEY,
 * and it is worth saying why that is gone rather than leaving somebody to
 * reinvent it. `data` is parsed through CollectionItemSchema on every save, and
 * that is a plain zod object, so it strips keys it does not know about. The
 * facts would have been deleted the first time a client fixed a typo in their
 * own copy: no error, no warning, just a destination page that quietly stopped
 * having any facts on it. Nothing had been written in that shape yet, so nothing
 * was lost, but the lesson generalises. One blob with two writers is also how
 * the four jsonb double-encode failures happened. The client writes `data`, the
 * corpus owns its own columns, and neither can reach the other.
 *
 * A POINTER RATHER THAN A COPY, so there is exactly one of every fact. A visa
 * rule that changes is live on every site the moment the sync writes it, with no
 * pass over adopted items and no window where two copies disagree.
 *
 * EVERYTHING HERE TREATS ITS INPUT AS HOSTILE. This payload is read back out of
 * a jsonb column, which means it is a value from the database rather than a value
 * from this process, and the rule in CLAUDE.md is that anything read off the
 * network or the page is validated before it renders. A sync writing nonsense, a
 * row edited by hand, or a snapshot restored from an older shape must all produce
 * a page that renders a little less rather than a page that throws.
 */

/** The five kinds of record the corpus holds. A closed set, so a kind can only ever be one of these. */
export const REFERENCE_KINDS = ['country', 'city', 'resort', 'airport', 'attraction'] as const;
export type ReferenceKind = (typeof REFERENCE_KINDS)[number];

/** How a month reads for a UK traveller, from the corpus's own Climate Season field. */
export const SEASONS = ['best', 'shoulder', 'off'] as const;
export type Season = (typeof SEASONS)[number];

export interface ReferenceClimate {
  /** Average daytime high in Celsius, January to December. Always twelve. */
  temps: number[];
  /** Average monthly rainfall in millimetres, January to December. Always twelve. */
  rainfall: number[];
  /** How each month reads for a UK traveller, January to December. Always twelve. */
  season: Season[];
}

export interface ReferenceFacts {
  kind: ReferenceKind;
  /** The corpus record this came from, so a sync can find it again. */
  sourceId: string;
  /** "Greek Islands · Mediterranean", shown as the eyebrow above the title. */
  region?: string;
  flightTime?: string;
  timeZone?: string;
  currency?: string;
  language?: string;
  voltage?: string;
  visaStatus?: string;
  climate?: ReferenceClimate;
  /** "Families", "Couples", "Foodies". Short audience tags from the corpus. */
  bestFor?: string[];
  /** When the sync last wrote this, ISO. Absent on a payload written before it existed. */
  syncedAt?: string;
}

/* --------------------------------------------------------------------------
 * Reading one back
 * ----------------------------------------------------------------------- */

/**
 * A short label, or undefined.
 *
 * Undefined rather than '' so an absent fact and an empty one are the same thing
 * to every caller, and a fact with nothing in it never draws an empty row.
 */
function text(value: unknown, max = 80): string | undefined {
  if (typeof value !== 'string') return undefined;
  const clean = value.replace(/\s+/g, ' ').trim().slice(0, max);
  return clean || undefined;
}

/**
 * Twelve numbers, one per month, each inside a range that is physically possible.
 *
 * OUT OF RANGE IS DROPPED, NOT CLAMPED, and the whole series goes with it. A
 * single 400°C August is not a hot month, it is a broken record, and pinning it
 * to 60 would draw a chart that looks deliberate. The same argument the size
 * sanitiser makes about an rgb() channel past 255.
 *
 * Exactly twelve, because the chart has twelve columns and a series of eleven
 * would silently draw the wrong month under every bar after the gap.
 */
function months(value: unknown, low: number, high: number): number[] | null {
  if (!Array.isArray(value) || value.length !== 12) return null;
  const out: number[] = [];
  for (const entry of value) {
    const n = typeof entry === 'number' ? entry : Number(entry);
    if (!Number.isFinite(n) || n < low || n > high) return null;
    out.push(Math.round(n * 10) / 10);
  }
  return out;
}

function seasons(value: unknown): Season[] | null {
  if (!Array.isArray(value) || value.length !== 12) return null;
  const out: Season[] = [];
  for (const entry of value) {
    const token = typeof entry === 'string' ? entry.trim().toLowerCase() : '';
    if (!(SEASONS as readonly string[]).includes(token)) return null;
    out.push(token as Season);
  }
  return out;
}

/**
 * The climate year, or undefined.
 *
 * ALL THREE SERIES OR NONE. The chart reads them together: a bar's height is the
 * temperature, its tint is the season, and the rainfall sits under it. Two out of
 * three would draw a chart that is confidently wrong about the third, which is
 * worse than not drawing one.
 */
function climate(value: unknown): ReferenceClimate | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const raw = value as Record<string, unknown>;
  const temps = months(raw.temps, -60, 60);
  const rainfall = months(raw.rainfall, 0, 2000);
  const season = seasons(raw.season);
  if (!temps || !rainfall || !season) return undefined;
  return { temps, rainfall, season };
}

function tags(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out: string[] = [];
  for (const entry of value) {
    const clean = text(entry, 40);
    // Six is what the corpus asks its authors for, and a row of pills past six
    // wraps into a second line that reads as a list rather than a summary.
    if (clean && !out.includes(clean) && out.length < 6) out.push(clean);
  }
  return out.length ? out : undefined;
}

/**
 * The corpus facts for an item, or null when there are none.
 *
 * Null for an ordinary item, which is most of them: a blog post points at no
 * corpus record, so the join returns nothing and every caller reads that as
 * "this is not a destination" rather than having to ask first. Null also for a
 * payload that arrives malformed, which is the same answer for the same reason:
 * draw the page without a panel rather than throw on the way to a visitor.
 */
export function referenceFacts(payload: unknown): ReferenceFacts | null {
  if (!payload || typeof payload !== 'object') return null;
  const raw = payload as Record<string, unknown>;
  const kind = typeof raw.kind === 'string' ? raw.kind : '';
  if (!(REFERENCE_KINDS as readonly string[]).includes(kind)) return null;

  // No source id means a sync could never match this row again, so it is not a
  // corpus record however much of the rest of it looks like one.
  const sourceId = text(raw.sourceId, 40);
  if (!sourceId) return null;

  return {
    kind: kind as ReferenceKind,
    sourceId,
    region: text(raw.region, 400),
    flightTime: text(raw.flightTime, 400),
    timeZone: text(raw.timeZone, 400),
    currency: text(raw.currency, 400),
    language: text(raw.language, 400),
    voltage: text(raw.voltage, 400),
    visaStatus: text(raw.visaStatus, 400),
    climate: climate(raw.climate),
    bestFor: tags(raw.bestFor),
    syncedAt: text(raw.syncedAt, 40),
  };
}

/* --------------------------------------------------------------------------
 * Presenting it
 * ----------------------------------------------------------------------- */

export interface ReferenceRow {
  key: string;
  label: string;
  value: string;
  /**
   * True when the corpus holds a sentence here rather than a datum.
   *
   * The tables are not consistent about it and both are legitimate: Greece's
   * flight time is "3h 30m", Mexico City's is "11h 30m direct from the UK to
   * Mexico City Benito Juárez (MEX). The new Felipe Ángeles airport (NLU)
   * handles some routes." The second is the better answer and it is not a
   * heading-sized value, so the renderer sets it as prose and lets it span.
   */
  long: boolean;
}

/**
 * The practical facts, in the order a traveller asks them.
 *
 * FLIGHT TIME FIRST, because on a UK outbound site it is the question. Then the
 * ones that decide whether a place is easy: the time difference, what you spend,
 * what you speak, whether your plugs work. The visa position last of the six and
 * only when the corpus has one, since it is the fact most likely to be blank and
 * a heading with nothing under it reads as an oversight.
 *
 * Absent facts are simply not rows. A resort with no recorded voltage draws five,
 * not five and a gap.
 */
export function referenceRows(facts: ReferenceFacts): ReferenceRow[] {
  const rows: Array<[string, string, string | undefined]> = [
    ['flightTime', 'Flight time', facts.flightTime],
    ['timeZone', 'Time zone', facts.timeZone],
    ['currency', 'Currency', facts.currency],
    ['language', 'Language', facts.language],
    ['voltage', 'Plugs', facts.voltage],
    ['visaStatus', 'Visa', facts.visaStatus],
  ];
  return rows
    .filter((row): row is [string, string, string] => Boolean(row[2]))
    /*
     * Forty is a LAYOUT threshold, not a fact about the corpus.
     *
     * An earlier version of this comment claimed the corpus splits cleanly
     * either side of it, every datum under and every sentence over. It does
     * not, and it is worth writing down because it was checked: the lengths
     * are one continuous tail. About 3,300 values sit under 25 characters,
     * then it thins out and keeps going past 100 with no gap anywhere, 107
     * values landing in 36-40 and 95 in 41-45.
     *
     * So this line runs through the middle of a continuum rather than between
     * two populations, and the only thing it can honestly mean is "wider than
     * a grid cell reads at a glance". Both sides have to look deliberate,
     * because there is no threshold that would put every awkward value on one
     * side of it. Move it if the layout changes; do not expect the data to
     * justify a particular number.
     */
    .map(([key, label, value]) => ({ key, label, value, long: value.length > 40 }));
}

/** January to December, short, for the chart's axis. */
export const MONTH_LABELS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
] as const;

/** What a season token means in words, for the chart's key and its screen-reader text. */
export const SEASON_LABEL: Record<Season, string> = {
  best: 'Best time to go',
  shoulder: 'Shoulder season',
  off: 'Out of season',
};

export interface ClimateMonth {
  label: string;
  temp: number;
  rainfall: number;
  season: Season;
  /** The bar's height as a percentage of the warmest month, 8 to 100. */
  height: number;
}

/**
 * The climate year, ready to draw.
 *
 * SCALED TO THE PLACE, NOT TO A FIXED CEILING. A chart pinned to 40°C would draw
 * Reykjavik as twelve stubs and say nothing about its year; scaled to its own
 * warmest month, the shape of the year is legible everywhere. The shape is what
 * the reader is after, and the number is printed on the bar for the value.
 *
 * The floor of 8 per cent is so a cold month is still a bar somebody can see and
 * hover, rather than a line on the axis.
 */
export function climateMonths(climate: ReferenceClimate): ClimateMonth[] {
  const warmest = Math.max(...climate.temps);
  const coldest = Math.min(...climate.temps);
  // A flat year (every month identical) would divide by zero. It draws full bars,
  // which is honest: every month is the warmest month.
  const span = warmest - Math.min(coldest, 0) || 1;

  return climate.temps.map((temp, i) => ({
    label: MONTH_LABELS[i],
    temp,
    rainfall: climate.rainfall[i],
    season: climate.season[i],
    height: Math.max(8, Math.round(((temp - Math.min(coldest, 0)) / span) * 100)),
  }));
}
