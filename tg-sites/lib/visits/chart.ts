/**
 * The charts' view model: everything a chart on the visibility screen draws,
 * worked out here as plain numbers and strings so it is tested without a DOM.
 * The component in components/seo/VisitCharts.tsx only lays these out.
 *
 * THE RULES THE NUMBERS FOLLOW are the tool's data-visualisation rules: one
 * axis with clean ticks; a legend for anything with more than one series;
 * labels chosen, never one on every point; a table for every chart; text in
 * the text tokens, never the series colour. A quiet day is a zero column, so
 * the chart's width is the window's width and not the site's luck.
 */

import { AI_ENGINES } from './classify';
import { change, type DayPoint, type PathCount, type SourceCount, type Totals, type VisitSummary } from './summary';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** '2026-09-14' as '14 Sep'. UK order, no locale in play. */
export function formatDay(day: string): string {
  const [, m, d] = day.split('-').map(Number);
  if (!m || !d) return day;
  return `${d} ${MONTHS[m - 1] ?? ''}`.trim();
}

/** '2026-09-14' as '14 September 2026'. */
export function formatDayLong(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  if (!y || !m || !d) return day;
  return `${d} ${MONTHS_LONG[m - 1] ?? ''} ${y}`;
}

/**
 * A clean top for a scale: the smallest of 1, 2, 2.5, 5 or 10 times a power of
 * ten that is at least the largest value. Zero data gets a scale of four, so an
 * empty chart still draws a grid rather than nothing.
 */
export function niceMax(max: number): number {
  if (!Number.isFinite(max) || max <= 0) return 4;
  const power = 10 ** Math.floor(Math.log10(max));
  for (const step of [1, 2, 2.5, 5, 10]) {
    const candidate = step * power;
    if (candidate >= max) return candidate;
  }
  return 10 * power;
}

/**
 * Evenly spaced ticks from 0 to a clean max, the max included, as many as give
 * whole numbers: four where the max divides by four, else five, else two. A
 * count axis never reads 6.25.
 */
export function niceTicks(max: number): number[] {
  const top = niceMax(max);
  const count = [4, 5, 2, 1].find((n) => Number.isInteger(top / n)) ?? 4;
  const ticks: number[] = [];
  for (let i = 0; i <= count; i += 1) {
    const value = (top * i) / count;
    ticks.push(Number.isInteger(value) ? value : Math.round(value * 100) / 100);
  }
  return ticks;
}

/** A value as a percentage of the scale, two decimals, never above 100. */
export function pct(value: number, max: number): number {
  if (!(max > 0) || !(value > 0)) return 0;
  return Math.min(100, Math.round((value / max) * 10000) / 100);
}

/**
 * Which x labels to show: the first day, then every `every`th day counted
 * back from the last, and the last. Thirty days gets five labels, not thirty.
 */
export function axisPicks(count: number, every = 7): boolean[] {
  const picks: boolean[] = new Array(Math.max(0, count)).fill(false);
  if (count <= 0) return picks;
  picks[0] = true;
  for (let i = count - 1; i > 0; i -= every) picks[i] = true;
  // A label right next to the first one is clutter; drop it.
  for (let i = 1; i < Math.min(count, 3); i += 1) {
    if (picks[i]) picks[i] = false;
  }
  return picks;
}

export interface ColumnView {
  day: string;
  label: string;
  showLabel: boolean;
  visitor: number;
  ai: number;
  crawler: number;
  total: number;
  /** Segment heights as percentages of the scale, bottom first. */
  heights: { visitor: number; ai: number; crawler: number };
  /** The hover text, also the row of the table. */
  tip: string;
}

export interface DailyView {
  max: number;
  ticks: number[];
  columns: ColumnView[];
  /** Whether anything at all was counted in the window. */
  any: boolean;
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

export function dailyView(daily: readonly DayPoint[]): DailyView {
  const totals = daily.map((point) => point.visitor + point.ai + point.crawler);
  const max = niceMax(Math.max(0, ...totals));
  const picks = axisPicks(daily.length);
  const columns = daily.map((point, index) => ({
    day: point.day,
    label: formatDay(point.day),
    showLabel: picks[index],
    visitor: point.visitor,
    ai: point.ai,
    crawler: point.crawler,
    total: totals[index],
    heights: {
      visitor: pct(point.visitor, max),
      ai: pct(point.ai, max),
      crawler: pct(point.crawler, max),
    },
    tip: `${formatDay(point.day)}: ${plural(point.visitor, 'person', 'people')}, ${point.ai} from an AI assistant, ${plural(point.crawler, 'crawler visit', 'crawler visits')}`,
  }));
  return { max, ticks: niceTicks(max), columns, any: totals.some((total) => total > 0) };
}

export interface BarView {
  label: string;
  count: number;
  /** Width as a percentage of the longest bar. */
  width: number;
  /** A small word beside the label: 'AI', 'Search', or the day last seen. */
  tag: string;
  family: 'ai' | 'search' | null;
}

export function sourceBars(items: readonly SourceCount[], limit = 8): BarView[] {
  const shown = items.slice(0, limit);
  const max = Math.max(0, ...shown.map((item) => item.count));
  return shown.map((item) => ({
    label: item.label,
    count: item.count,
    width: pct(item.count, max),
    tag: `last seen ${formatDay(item.lastSeen)}`,
    family: item.family,
  }));
}

export function pathBars(items: readonly PathCount[]): BarView[] {
  const max = Math.max(0, ...items.map((item) => item.count));
  return items.map((item) => ({
    label: item.path,
    count: item.count,
    width: pct(item.count, max),
    tag: '',
    family: null,
  }));
}

/**
 * A sparkline: the last N days of one series as an SVG path, no axis, no
 * labels. The trend is the message; the tile's number is the label.
 */
export interface SparkView {
  width: number;
  height: number;
  line: string;
  area: string;
  /** Whether there is anything to see; a flat zero line is drawn faintly. */
  any: boolean;
}

export function sparkline(values: readonly number[], width = 120, height = 32): SparkView {
  const pad = 2;
  const n = values.length;
  const max = Math.max(0, ...values);
  const any = max > 0;
  const x = (i: number) => (n <= 1 ? width / 2 : pad + (i / (n - 1)) * (width - pad * 2));
  const y = (v: number) => height - pad - (any ? (Math.max(0, v) / max) * (height - pad * 2) : 0);
  const f = (value: number) => String(Math.round(value * 100) / 100);
  if (n === 0) return { width, height, line: '', area: '', any: false };
  const points = values.map((v, i) => `${f(x(i))} ${f(y(v))}`);
  const line = `M${points.join(' L')}`;
  const area = `${line} L${f(x(n - 1))} ${f(height - pad)} L${f(x(0))} ${f(height - pad)} Z`;
  return { width, height, line, area, any };
}

export interface TileView {
  key: 'people' | 'assistant' | 'aiCrawler' | 'searchCrawler';
  label: string;
  value: number;
  /** Which series colour the tile's mark wears. */
  series: 1 | 2 | 3;
  /** Null until a whole previous window exists to compare with. */
  delta: { label: string; direction: 'up' | 'down' | 'flat'; note: string } | null;
  note: string;
  /** The tile's own series, day by day, for the sparkline. */
  spark: SparkView;
}

/**
 * The donut: who read the pages, as three slices of one ring. Part of a whole,
 * three parts, which is the one job a donut does well. Slices sit two pixels
 * apart on the ring, and a slice with nothing in it is not drawn.
 */
export interface SliceView {
  series: 1 | 2 | 3;
  label: string;
  value: number;
  /** Whole-number share of the total. */
  share: number;
  /** stroke-dasharray for the slice, on a ring of `circumference`. */
  dash: string;
  /** stroke-dashoffset: where on the ring the slice starts. */
  offset: number;
}

export interface DonutView {
  radius: number;
  circumference: number;
  total: number;
  slices: SliceView[];
}

export function donutView(totals: Totals, radius = 54, gap = 2): DonutView {
  const circumference = Math.round(2 * Math.PI * radius * 100) / 100;
  const parts: Array<{ series: 1 | 2 | 3; label: string; value: number }> = [
    { series: 1, label: 'People', value: Math.max(0, totals.visitor) },
    { series: 2, label: 'From an AI assistant', value: Math.max(0, totals.ai) },
    { series: 3, label: 'Crawlers', value: Math.max(0, totals.crawler) },
  ];
  const total = parts.reduce((sum, part) => sum + part.value, 0);
  const drawn = parts.filter((part) => part.value > 0);
  // No gap when one slice is the whole ring: there is nothing to separate.
  const g = drawn.length > 1 ? gap : 0;
  let start = 0;
  const slices: SliceView[] = [];
  for (const part of parts) {
    const share = total > 0 ? Math.round((part.value / total) * 100) : 0;
    if (part.value <= 0) continue;
    const length = (part.value / total) * circumference;
    const visible = Math.max(0.5, length - g);
    const dash = `${Math.round(visible * 100) / 100} ${Math.round((circumference - visible) * 100) / 100}`;
    // A dashoffset moves the pattern backwards, hence the minus; the half gap
    // centres the space between neighbours.
    const offset = Math.round(-(start + g / 2) * 100) / 100;
    slices.push({ series: part.series, label: part.label, value: part.value, share, dash, offset });
    start += length;
  }
  return { radius, circumference, total, slices };
}

/** One AI engine on the roster: found the site, or not yet. */
export interface EngineView {
  label: string;
  seen: boolean;
  count: number;
  /** 'last 12 Sep', or '' when not seen. */
  lastSeen: string;
}

/**
 * The roster: every AI engine we can name, the ones that have found the site
 * first (busiest first), then the ones still to come in their usual order. The
 * question a client asks is "has ChatGPT found me yet", and this answers it for
 * each of them at a glance.
 */
export function engineRoster(crawlers: readonly SourceCount[]): EngineView[] {
  const seen = new Map(crawlers.filter((c) => c.family === 'ai').map((c) => [c.label, c]));
  const found = AI_ENGINES.filter((label) => seen.has(label))
    .map((label) => seen.get(label)!)
    .sort((a, b) => b.count - a.count || AI_ENGINES.indexOf(a.label) - AI_ENGINES.indexOf(b.label))
    .map((c) => ({ label: c.label, seen: true, count: c.count, lastSeen: `last ${formatDay(c.lastSeen)}` }));
  const waiting = AI_ENGINES.filter((label) => !seen.has(label)).map((label) => ({ label, seen: false, count: 0, lastSeen: '' }));
  return [...found, ...waiting];
}

/**
 * The four headline numbers. A delta is only shown once counting has run for
 * longer than the window, because "+40 on last month" when last month was
 * before counting began is a lie with a plus sign.
 */
export function readerTiles(summary: VisitSummary): TileView[] {
  const compare = summary.firstDay !== null && summary.firstDay < summary.from;
  const delta = (current: number, previous: number) => {
    if (!compare) return null;
    const c = change(current, previous);
    const note =
      c.direction === 'flat'
        ? `same as the ${summary.days} days before`
        : `${c.direction === 'up' ? 'up' : 'down'} on the ${summary.days} days before`;
    return { label: c.label, direction: c.direction, note };
  };
  const people = summary.totals.visitor + summary.totals.ai;
  const peopleBefore = summary.previous.visitor + summary.previous.ai;
  const spark = (pick: (point: DayPoint) => number) => sparkline(summary.daily.map(pick));
  return [
    {
      key: 'people',
      label: 'People reading',
      value: people,
      series: 1,
      delta: delta(people, peopleBefore),
      note: 'Pages read by a person, however they arrived.',
      spark: spark((point) => point.visitor + point.ai),
    },
    {
      key: 'assistant',
      label: 'Sent by an AI assistant',
      value: summary.totals.ai,
      series: 2,
      delta: delta(summary.totals.ai, summary.previous.ai),
      note: 'People who clicked through from ChatGPT, Perplexity, Gemini and the like.',
      spark: spark((point) => point.ai),
    },
    {
      key: 'aiCrawler',
      label: 'AI crawler visits',
      value: summary.families.ai,
      series: 3,
      delta: delta(summary.families.ai, summary.previousFamilies.ai),
      note: 'The AI engines reading your pages, which is what gets you recommended.',
      spark: spark((point) => point.crawlerAi),
    },
    {
      key: 'searchCrawler',
      label: 'Search crawler visits',
      value: summary.families.search,
      series: 3,
      delta: delta(summary.families.search, summary.previousFamilies.search),
      note: 'Google, Bing and the other search engines keeping their index fresh.',
      spark: spark((point) => point.crawlerSearch),
    },
  ];
}

export interface ReadersView {
  /** 'Counting since 3 September 2026', or '' once the window is full. */
  since: string;
  range: string;
  tiles: TileView[];
  daily: DailyView;
  donut: DonutView;
  engines: EngineView[];
  /** How many of the roster have found the site. */
  enginesSeen: number;
  crawlers: BarView[];
  assistants: BarView[];
  topVisited: BarView[];
  topCrawled: BarView[];
}

export function readersView(summary: VisitSummary): ReadersView {
  const since =
    summary.firstDay !== null && summary.firstDay >= summary.from
      ? `Counting since ${formatDayLong(summary.firstDay)}`
      : '';
  return {
    since,
    range: `${formatDay(summary.from)} to ${formatDay(summary.to)}`,
    tiles: readerTiles(summary),
    daily: dailyView(summary.daily),
    donut: donutView(summary.totals),
    engines: engineRoster(summary.crawlers),
    enginesSeen: engineRoster(summary.crawlers).filter((engine) => engine.seen).length,
    crawlers: sourceBars(summary.crawlers),
    assistants: sourceBars(summary.assistants),
    topVisited: pathBars(summary.topVisited),
    topCrawled: pathBars(summary.topCrawled),
  };
}
