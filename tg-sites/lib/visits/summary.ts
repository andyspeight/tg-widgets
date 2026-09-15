/**
 * The tally, shaped for the dashboard: a day-by-day series, the totals and how
 * they compare with the window before, the crawlers by name, the assistants that
 * sent people, and the pages each group read most.
 *
 * PURE. Rows in (as the table stores them), a summary out, so the whole shape a
 * chart draws is tested without a database. The database module only fetches
 * rows; every decision about what a number means lives here.
 *
 * THE WINDOW IS THE LAST N UTC DAYS INCLUDING TODAY, zero-filled, so a quiet day
 * is a zero column rather than a missing one and the chart's width never
 * depends on how busy a site was. The previous window is the N days before that,
 * for the "since last month" chips, the same comparison /reports makes.
 */

import { crawlerFamily, type CrawlerFamily, type VisitKind } from './classify';

/** One row as stored: a count for a day, a path, a kind and a source. */
export interface VisitRow {
  /** YYYY-MM-DD, the UTC day. */
  day: string;
  path: string;
  kind: VisitKind;
  source: string;
  count: number;
}

export interface DayPoint {
  day: string;
  visitor: number;
  ai: number;
  /** All crawlers, AI and search together. */
  crawler: number;
  crawlerAi: number;
  crawlerSearch: number;
}

export interface Totals {
  visitor: number;
  ai: number;
  crawler: number;
  bot: number;
}

/** Crawler visits by what the crawler is for. */
export interface Families {
  ai: number;
  search: number;
  other: number;
}

export interface SourceCount {
  label: string;
  count: number;
  /** The last UTC day this source was seen, YYYY-MM-DD. */
  lastSeen: string;
  family: CrawlerFamily | null;
}

export interface PathCount {
  path: string;
  count: number;
}

export interface VisitSummary {
  days: number;
  /** The first and last day of the window, YYYY-MM-DD. */
  from: string;
  to: string;
  daily: DayPoint[];
  totals: Totals;
  /** The same totals for the window before this one. */
  previous: Totals;
  /** Crawler visits split into AI, search and unnamed, this window and the one before. */
  families: Families;
  previousFamilies: Families;
  /** Every named crawler seen, most visits first, AI and search alike. */
  crawlers: SourceCount[];
  /** The assistants people arrived from, most first. */
  assistants: SourceCount[];
  /** Pages the crawlers read most, and pages people read most. */
  topCrawled: PathCount[];
  topVisited: PathCount[];
  /** The earliest day with any count at all, or null when nothing has been counted. */
  firstDay: string | null;
}

/** A UTC day as YYYY-MM-DD. */
export function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** The day `offset` days before (negative) or after a YYYY-MM-DD key. */
export function shiftDay(day: string, offset: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return dayKey(date);
}

function emptyTotals(): Totals {
  return { visitor: 0, ai: 0, crawler: 0, bot: 0 };
}

function topPaths(counts: Map<string, number>, limit: number): PathCount[] {
  return [...counts.entries()]
    .map(([path, count]) => ({ path, count }))
    .sort((a, b) => b.count - a.count || a.path.localeCompare(b.path))
    .slice(0, limit);
}

function sources(counts: Map<string, { count: number; lastSeen: string }>, limit: number): SourceCount[] {
  return [...counts.entries()]
    .map(([label, entry]) => ({ label, count: entry.count, lastSeen: entry.lastSeen, family: crawlerFamily(label) }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
    .slice(0, limit);
}

/**
 * Summarise rows for the window ending today. Rows outside both windows are
 * ignored, so the caller may hand over whatever the table holds.
 */
export function summariseVisits(rows: readonly VisitRow[], today: Date, days = 30): VisitSummary {
  const span = Math.max(1, Math.min(365, Math.floor(days)));
  const to = dayKey(today);
  const from = shiftDay(to, -(span - 1));
  const previousFrom = shiftDay(from, -span);

  const daily = new Map<string, DayPoint>();
  for (let i = 0; i < span; i += 1) {
    const day = shiftDay(from, i);
    daily.set(day, { day, visitor: 0, ai: 0, crawler: 0, crawlerAi: 0, crawlerSearch: 0 });
  }

  const totals = emptyTotals();
  const previous = emptyTotals();
  const families: Families = { ai: 0, search: 0, other: 0 };
  const previousFamilies: Families = { ai: 0, search: 0, other: 0 };
  const crawlers = new Map<string, { count: number; lastSeen: string }>();
  const assistants = new Map<string, { count: number; lastSeen: string }>();
  const crawled = new Map<string, number>();
  const visited = new Map<string, number>();
  let firstDay: string | null = null;

  for (const row of rows) {
    const count = Number.isFinite(row.count) ? Math.max(0, Math.floor(row.count)) : 0;
    if (count === 0) continue;
    if (firstDay === null || row.day < firstDay) firstDay = row.day;

    const inWindow = row.day >= from && row.day <= to;
    const inPrevious = row.day >= previousFrom && row.day < from;
    if (!inWindow && !inPrevious) continue;

    const bucket = inWindow ? totals : previous;
    bucket[row.kind] += count;
    if (row.kind === 'crawler') {
      const family = crawlerFamily(row.source) ?? 'other';
      (inWindow ? families : previousFamilies)[family] += count;
    }
    if (!inWindow) continue;

    const point = daily.get(row.day);
    if (point && row.kind !== 'bot') point[row.kind] += count;

    if (row.kind === 'crawler') {
      if (point) {
        const family = crawlerFamily(row.source);
        if (family === 'ai') point.crawlerAi += count;
        else if (family === 'search') point.crawlerSearch += count;
      }
      const label = row.source || 'Unknown crawler';
      const entry = crawlers.get(label) ?? { count: 0, lastSeen: row.day };
      entry.count += count;
      if (row.day > entry.lastSeen) entry.lastSeen = row.day;
      crawlers.set(label, entry);
      crawled.set(row.path, (crawled.get(row.path) ?? 0) + count);
    } else if (row.kind === 'ai') {
      const label = row.source || 'An AI assistant';
      const entry = assistants.get(label) ?? { count: 0, lastSeen: row.day };
      entry.count += count;
      if (row.day > entry.lastSeen) entry.lastSeen = row.day;
      assistants.set(label, entry);
      visited.set(row.path, (visited.get(row.path) ?? 0) + count);
    } else if (row.kind === 'visitor') {
      visited.set(row.path, (visited.get(row.path) ?? 0) + count);
    }
  }

  return {
    days: span,
    from,
    to,
    daily: [...daily.values()],
    totals,
    previous,
    families,
    previousFamilies,
    crawlers: sources(crawlers, 40),
    assistants: sources(assistants, 8),
    topCrawled: topPaths(crawled, 6),
    topVisited: topPaths(visited, 6),
    firstDay,
  };
}

/** The change from the previous window, as the chips read it. */
export function change(current: number, previous: number): { delta: number; direction: 'up' | 'down' | 'flat'; label: string } {
  const delta = current - previous;
  const direction = delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat';
  const label = delta > 0 ? `+${delta}` : String(delta);
  return { delta, direction, label };
}
