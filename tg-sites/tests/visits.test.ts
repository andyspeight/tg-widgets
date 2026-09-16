/**
 * Who is reading the site: the classifier, the summary the charts are drawn
 * from, the chart arithmetic, and the pins that keep the tally's doctrine
 * (counts only, the public site write-only through one definer function, the
 * app role read-only, the count after the response) from drifting.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  AI_ENGINES,
  AI_REFERRERS,
  CRAWLERS,
  aiReferrer,
  classifyVisit,
  cleanVisitPath,
  crawlerFamily,
  namedCrawler,
} from '../lib/visits/classify';
import {
  axisPicks,
  dailyView,
  donutView,
  engineRoster,
  formatDay,
  formatDayLong,
  niceMax,
  niceTicks,
  pct,
  readerTiles,
  readersView,
  sourceBars,
  sparkline,
} from '../lib/visits/chart';
import { change, dayKey, shiftDay, summariseVisits, type VisitRow } from '../lib/visits/summary';

function source(...parts: string[]): string {
  return readFileSync(join(__dirname, '..', ...parts), 'utf8');
}

const CHROME =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';
const SAFARI_PHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';

// ---------------------------------------------------------------------------

describe('the classifier names the crawler a client would recognise', () => {
  it('reads the three OpenAI fetchers as ChatGPT', () => {
    expect(namedCrawler('Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; GPTBot/1.2; +https://openai.com/gptbot')?.label).toBe('ChatGPT');
    expect(namedCrawler('Mozilla/5.0 (compatible; OAI-SearchBot/1.0; +https://openai.com/searchbot)')?.label).toBe('ChatGPT');
    expect(namedCrawler('Mozilla/5.0 (compatible; ChatGPT-User/1.0; +https://openai.com/bot)')?.label).toBe('ChatGPT');
  });

  it('knows the other AI engines and the search engines apart', () => {
    expect(classifyVisit({ userAgent: 'Mozilla/5.0 (compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot)', referer: null })).toEqual({ kind: 'crawler', source: 'Perplexity' });
    expect(classifyVisit({ userAgent: 'Mozilla/5.0 (compatible; ClaudeBot/1.0; +claudebot@anthropic.com)', referer: null })).toEqual({ kind: 'crawler', source: 'Claude' });
    expect(classifyVisit({ userAgent: 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)', referer: null })).toEqual({ kind: 'crawler', source: 'Google' });
    expect(classifyVisit({ userAgent: 'Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)', referer: null })).toEqual({ kind: 'crawler', source: 'Bing' });
    expect(crawlerFamily('Perplexity')).toBe('ai');
    expect(crawlerFamily('Google')).toBe('search');
    expect(crawlerFamily('Nobody')).toBeNull();
  });

  it('lists only names that appear in a real user agent, in lower case', () => {
    for (const entry of CRAWLERS) {
      expect(entry.token).toBe(entry.token.toLowerCase());
      expect(entry.label.length).toBeLessThanOrEqual(40);
    }
    // robots.txt names with no fetcher of their own would label visits that never come.
    const tokens = CRAWLERS.map((entry) => entry.token);
    expect(tokens).not.toContain('google-extended');
    expect(tokens).not.toContain('applebot-extended');
  });

  it('a named crawler wins over any referer', () => {
    expect(classifyVisit({ userAgent: 'GPTBot/1.2', referer: 'https://chatgpt.com/c/1' }).kind).toBe('crawler');
  });

  it('a person sent by an assistant is counted as such, subdomains included, look-alikes not', () => {
    expect(classifyVisit({ userAgent: CHROME, referer: 'https://chatgpt.com/c/abc' })).toEqual({ kind: 'ai', source: 'ChatGPT' });
    expect(classifyVisit({ userAgent: SAFARI_PHONE, referer: 'https://www.perplexity.ai/search?q=x' })).toEqual({ kind: 'ai', source: 'Perplexity' });
    expect(classifyVisit({ userAgent: CHROME, referer: 'https://gemini.google.com/app' })).toEqual({ kind: 'ai', source: 'Gemini' });
    expect(classifyVisit({ userAgent: CHROME, referer: 'https://chatgpt.com.evil.example/' })).toEqual({ kind: 'visitor', source: '' });
    expect(aiReferrer('not a url')).toBeNull();
    expect(aiReferrer('')).toBeNull();
    for (const entry of AI_REFERRERS) expect(entry.host).toBe(entry.host.toLowerCase());
  });

  it('a person from search, social or nowhere is a visitor', () => {
    expect(classifyVisit({ userAgent: CHROME, referer: 'https://www.google.com/' })).toEqual({ kind: 'visitor', source: '' });
    expect(classifyVisit({ userAgent: SAFARI_PHONE, referer: null })).toEqual({ kind: 'visitor', source: '' });
    expect(classifyVisit({ userAgent: CHROME, referer: 'https://www.facebook.com/' })).toEqual({ kind: 'visitor', source: '' });
  });

  it('anything plainly not a person is a bot, and never named', () => {
    for (const ua of [
      '',
      null,
      undefined,
      'curl/8.4.0',
      'python-requests/2.31',
      'Mozilla/5.0 (X11; Linux x86_64) HeadlessChrome/120.0.0.0 Safari/537.36',
      'UptimeRobot/2.0; http://www.uptimerobot.com/',
      'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
      'Mozilla/5.0 (compatible; SemrushBot/7~bl; +http://www.semrush.com/bot.html)',
    ]) {
      expect(classifyVisit({ userAgent: ua, referer: 'https://chatgpt.com/' })).toEqual({ kind: 'bot', source: '' });
    }
  });

  it('keys the path the way the table does', () => {
    expect(cleanVisitPath(undefined)).toBe('/');
    expect(cleanVisitPath('')).toBe('/');
    expect(cleanVisitPath('/')).toBe('/');
    expect(cleanVisitPath('about/')).toBe('/about');
    expect(cleanVisitPath('/a//b?x=1#frag')).toBe('/a/b');
    expect(cleanVisitPath(`/${'x'.repeat(900)}`)).toHaveLength(400);
  });
});

// ---------------------------------------------------------------------------

const TODAY = new Date('2026-09-15T10:30:00Z');

const ROWS: VisitRow[] = [
  { day: '2026-09-15', path: '/', kind: 'visitor', source: '', count: 3 },
  { day: '2026-09-15', path: '/', kind: 'bot', source: '', count: 7 },
  { day: '2026-09-14', path: '/holidays', kind: 'ai', source: 'ChatGPT', count: 2 },
  { day: '2026-09-14', path: '/holidays', kind: 'visitor', source: '', count: 4 },
  { day: '2026-09-10', path: '/', kind: 'crawler', source: 'ChatGPT', count: 5 },
  { day: '2026-09-12', path: '/about', kind: 'crawler', source: 'Google', count: 4 },
  { day: '2026-09-13', path: '/about', kind: 'crawler', source: '', count: 1 },
  // The window before: 18 July to 16 August.
  { day: '2026-08-01', path: '/', kind: 'visitor', source: '', count: 10 },
  { day: '2026-07-30', path: '/', kind: 'crawler', source: 'Perplexity', count: 6 },
  // Before both windows: counted only as the first day.
  { day: '2026-07-01', path: '/', kind: 'visitor', source: '', count: 1 },
  // Nothing: ignored entirely.
  { day: '2026-09-15', path: '/', kind: 'visitor', source: '', count: 0 },
];

describe('the summary shapes the tally for the charts', () => {
  const summary = summariseVisits(ROWS, TODAY, 30);

  it('covers the last thirty UTC days including today, zero-filled', () => {
    expect(summary.from).toBe('2026-08-17');
    expect(summary.to).toBe('2026-09-15');
    expect(summary.daily).toHaveLength(30);
    expect(summary.daily[0].day).toBe('2026-08-17');
    expect(summary.daily[29]).toEqual({ day: '2026-09-15', visitor: 3, ai: 0, crawler: 0, crawlerAi: 0, crawlerSearch: 0 });
    expect(summary.daily[28]).toEqual({ day: '2026-09-14', visitor: 4, ai: 2, crawler: 0, crawlerAi: 0, crawlerSearch: 0 });
    expect(summary.daily[24]).toEqual({ day: '2026-09-10', visitor: 0, ai: 0, crawler: 5, crawlerAi: 5, crawlerSearch: 0 });
    expect(summary.daily[26]).toEqual({ day: '2026-09-12', visitor: 0, ai: 0, crawler: 4, crawlerAi: 0, crawlerSearch: 4 });
    expect(summary.daily.filter((point) => point.visitor + point.ai + point.crawler === 0)).toHaveLength(25);
  });

  it('totals this window and the one before, bots kept apart', () => {
    expect(summary.totals).toEqual({ visitor: 7, ai: 2, crawler: 10, bot: 7 });
    expect(summary.previous).toEqual({ visitor: 10, ai: 0, crawler: 6, bot: 0 });
    expect(summary.families).toEqual({ ai: 5, search: 4, other: 1 });
    expect(summary.previousFamilies).toEqual({ ai: 6, search: 0, other: 0 });
  });

  it('names the crawlers most first, with the day each was last seen', () => {
    expect(summary.crawlers.map((c) => [c.label, c.count, c.lastSeen, c.family])).toEqual([
      ['ChatGPT', 5, '2026-09-10', 'ai'],
      ['Google', 4, '2026-09-12', 'search'],
      ['Unknown crawler', 1, '2026-09-13', null],
    ]);
    expect(summary.assistants).toEqual([{ label: 'ChatGPT', count: 2, lastSeen: '2026-09-14', family: 'ai' }]);
  });

  it('ranks the pages people and crawlers read', () => {
    expect(summary.topVisited).toEqual([
      { path: '/holidays', count: 6 },
      { path: '/', count: 3 },
    ]);
    expect(summary.topCrawled).toEqual([
      { path: '/', count: 5 },
      { path: '/about', count: 5 },
    ]);
  });

  it('remembers the first day anything was counted, even outside both windows', () => {
    expect(summary.firstDay).toBe('2026-07-01');
    expect(summariseVisits([], TODAY).firstDay).toBeNull();
  });

  it('clamps the window and survives odd counts', () => {
    expect(summariseVisits([], TODAY, 0).days).toBe(1);
    expect(summariseVisits([], TODAY, 9999).days).toBe(365);
    const odd = summariseVisits([{ day: '2026-09-15', path: '/', kind: 'visitor', source: '', count: Number.NaN }], TODAY);
    expect(odd.totals.visitor).toBe(0);
  });

  it('shifts days across month ends in UTC', () => {
    expect(shiftDay('2026-09-01', -1)).toBe('2026-08-31');
    expect(shiftDay('2026-12-31', 1)).toBe('2027-01-01');
    expect(dayKey(new Date('2026-09-15T23:59:59Z'))).toBe('2026-09-15');
  });

  it('describes a change the way the chips read it', () => {
    expect(change(12, 9)).toEqual({ delta: 3, direction: 'up', label: '+3' });
    expect(change(5, 9)).toEqual({ delta: -4, direction: 'down', label: '-4' });
    expect(change(4, 4)).toEqual({ delta: 0, direction: 'flat', label: '0' });
  });
});

// ---------------------------------------------------------------------------

describe('the chart arithmetic', () => {
  it('picks a clean top for the scale and whole-number ticks', () => {
    expect(niceMax(0)).toBe(4);
    expect(niceMax(1)).toBe(1);
    expect(niceMax(3)).toBe(5);
    expect(niceMax(7)).toBe(10);
    expect(niceMax(23)).toBe(25);
    expect(niceMax(41)).toBe(50);
    expect(niceMax(100)).toBe(100);
    expect(niceMax(101)).toBe(200);
    expect(niceTicks(23)).toEqual([0, 5, 10, 15, 20, 25]);
    expect(niceTicks(7)).toEqual([0, 2, 4, 6, 8, 10]);
    expect(niceTicks(0)).toEqual([0, 1, 2, 3, 4]);
    expect(niceTicks(41)).toEqual([0, 10, 20, 30, 40, 50]);
    expect(niceTicks(1)).toEqual([0, 1]);
    for (const max of [1, 2, 4, 5, 10, 20, 25, 50, 100, 250, 500]) {
      for (const tick of niceTicks(max)) expect(Number.isInteger(tick)).toBe(true);
    }
  });

  it('turns a value into a share of the scale, capped', () => {
    expect(pct(5, 25)).toBe(20);
    expect(pct(0, 10)).toBe(0);
    expect(pct(30, 25)).toBe(100);
    expect(pct(1, 0)).toBe(0);
  });

  it('labels five of thirty days, never two side by side', () => {
    const picks = axisPicks(30);
    expect(picks.map((show, i) => (show ? i : -1)).filter((i) => i >= 0)).toEqual([0, 8, 15, 22, 29]);
    expect(axisPicks(0)).toEqual([]);
    expect(axisPicks(1)).toEqual([true]);
  });

  it('writes dates the British way', () => {
    expect(formatDay('2026-09-14')).toBe('14 Sep');
    expect(formatDayLong('2026-09-14')).toBe('14 September 2026');
    expect(formatDay('nonsense')).toBe('nonsense');
  });

  it('stacks the day into three heights that fit the scale', () => {
    const view = dailyView([
      { day: '2026-09-14', visitor: 4, ai: 2, crawler: 4, crawlerAi: 3, crawlerSearch: 1 },
      { day: '2026-09-15', visitor: 0, ai: 0, crawler: 0, crawlerAi: 0, crawlerSearch: 0 },
    ]);
    expect(view.max).toBe(10);
    expect(view.columns[0].heights).toEqual({ visitor: 40, ai: 20, crawler: 40 });
    expect(view.columns[0].tip).toBe('14 Sep: 4 people, 2 from an AI assistant, 4 crawler visits');
    expect(view.columns[1].total).toBe(0);
    expect(view.any).toBe(true);
    expect(dailyView([]).any).toBe(false);
  });

  it('draws bars against the longest one', () => {
    const bars = sourceBars([
      { label: 'ChatGPT', count: 8, lastSeen: '2026-09-10', family: 'ai' },
      { label: 'Google', count: 2, lastSeen: '2026-09-12', family: 'search' },
    ]);
    expect(bars.map((bar) => bar.width)).toEqual([100, 25]);
    expect(bars[1].tag).toBe('last seen 12 Sep');
  });

  it('draws a sparkline from a series, flat when there is nothing', () => {
    const spark = sparkline([0, 2, 4, 2], 120, 32);
    expect(spark.any).toBe(true);
    expect(spark.line).toBe('M2 30 L40.67 16 L79.33 2 L118 16');
    expect(spark.area).toBe('M2 30 L40.67 16 L79.33 2 L118 16 L118 30 L2 30 Z');
    const flat = sparkline([0, 0, 0]);
    expect(flat.any).toBe(false);
    expect(flat.line).toBe('M2 30 L60 30 L118 30');
    expect(sparkline([]).line).toBe('');
  });

  it('cuts the ring into slices that sit two pixels apart and add up', () => {
    const donut = donutView({ visitor: 50, ai: 25, crawler: 25, bot: 9 });
    expect(donut.total).toBe(100);
    expect(donut.slices.map((s) => [s.series, s.share])).toEqual([[1, 50], [2, 25], [3, 25]]);
    const drawn = donut.slices.map((s) => Number(s.dash.split(' ')[0]));
    // Each slice gives up the 2px gap; the three together span the ring less three gaps.
    expect(Math.round(drawn.reduce((a, b) => a + b, 0) + 6)).toBe(Math.round(donut.circumference));
    expect(donut.slices[0].offset).toBe(-1);
    // One slice is the whole ring, no gap.
    const solo = donutView({ visitor: 0, ai: 0, crawler: 7, bot: 0 });
    expect(solo.slices).toHaveLength(1);
    expect(solo.slices[0].dash).toBe(`${solo.circumference} 0`);
    expect(donutView({ visitor: 0, ai: 0, crawler: 0, bot: 0 }).slices).toEqual([]);
  });

  it('lists every AI engine, the ones that have come first', () => {
    expect(AI_ENGINES[0]).toBe('ChatGPT');
    expect(new Set(AI_ENGINES).size).toBe(AI_ENGINES.length);
    const roster = engineRoster([
      { label: 'Claude', count: 3, lastSeen: '2026-09-12', family: 'ai' },
      { label: 'Google', count: 40, lastSeen: '2026-09-14', family: 'search' },
      { label: 'ChatGPT', count: 9, lastSeen: '2026-09-15', family: 'ai' },
    ]);
    expect(roster).toHaveLength(AI_ENGINES.length);
    expect(roster.slice(0, 2)).toEqual([
      { label: 'ChatGPT', seen: true, count: 9, lastSeen: 'last 15 Sep' },
      { label: 'Claude', seen: true, count: 3, lastSeen: 'last 12 Sep' },
    ]);
    expect(roster[2]).toEqual({ label: 'Perplexity', seen: false, count: 0, lastSeen: '' });
    expect(roster.some((engine) => engine.label === 'Google')).toBe(false);
  });

  it('shows a change only once a whole previous window exists', () => {
    const full = readerTiles(summariseVisits(ROWS, TODAY, 30));
    expect(full.map((tile) => [tile.key, tile.value])).toEqual([
      ['people', 9],
      ['assistant', 2],
      ['aiCrawler', 5],
      ['searchCrawler', 4],
    ]);
    expect(full[0].delta).toEqual({ label: '-1', direction: 'down', note: 'down on the 30 days before' });
    expect(full[1].delta).toEqual({ label: '+2', direction: 'up', note: 'up on the 30 days before' });
    expect(full[3].delta).toEqual({ label: '+4', direction: 'up', note: 'up on the 30 days before' });

    const young = readerTiles(summariseVisits(ROWS.filter((row) => row.day >= '2026-09-01'), TODAY, 30));
    for (const tile of young) expect(tile.delta).toBeNull();
    expect(readersView(summariseVisits(ROWS.filter((row) => row.day >= '2026-09-01'), TODAY, 30)).since).toBe('Counting since 10 September 2026');
    expect(readersView(summariseVisits(ROWS, TODAY, 30)).since).toBe('');
    expect(readersView(summariseVisits(ROWS, TODAY, 30)).range).toBe('17 Aug to 15 Sep');
  });
});

// ---------------------------------------------------------------------------

describe('the migration keeps the public side write-only through one door', () => {
  const migration = source('db', 'migrations', '0034_page_visits.sql');

  it('grants the renderer role nothing on the table itself', () => {
    for (const line of migration.split('\n')) {
      if (/^\s*grant .*on public\.page_visits/i.test(line)) {
        expect(line).not.toContain('tg_sites_renderer');
      }
    }
  });

  it('grants the renderer execute on the one definer function, with a pinned search path', () => {
    expect(migration).toMatch(/grant execute on function public\.record_visit\(text, text, text\)\s+to tg_sites_renderer/);
    expect(migration.match(/security definer/g)?.length).toBe(2);
    expect(migration.match(/set search_path = public, pg_temp/g)?.length).toBe(2);
    expect(migration).toContain('revoke all on function public.record_visit(text, text, text) from public;');
  });

  it('gives the app role a read and nothing else', () => {
    expect(migration).toContain('grant select on public.page_visits to tg_sites_app;');
    expect(migration).not.toMatch(/grant[^;]*(insert|update|delete)[^;]*page_visits/i);
    expect(migration).toContain('force row level security');
    expect(migration).toContain('for select to tg_sites_app');
  });

  it('lets only the app role prune, with a floor', () => {
    expect(migration).toContain('grant execute on function public.prune_page_visits(integer) to tg_sites_app;');
    expect(migration).not.toMatch(/prune_page_visits[^;]*tg_sites_renderer/);
    expect(migration).toContain('greatest(coalesce(p_days, 90), 30)');
  });

  it('stores counts and nothing about anybody', () => {
    const table = migration.slice(migration.indexOf('create table'), migration.indexOf('primary key'));
    for (const word of ['ip', 'agent', 'session', 'cookie', 'referer', 'email']) {
      expect(table.toLowerCase()).not.toMatch(new RegExp(`\\b${word}\\b`));
    }
  });
});

describe('the database module respects the roles', () => {
  const module = source('lib', 'db', 'visits.ts');

  it('writes as the public role through record_visit and reads as the app role', () => {
    expect(module).toMatch(/withPublicTenant\(tenantId[\s\S]*?public\.record_visit\(/);
    expect(module).toMatch(/withTenant\(tenantId[\s\S]*?from public\.page_visits/);
    expect(module).not.toMatch(/insert into|update public\.page_visits|delete from/i);
  });
});

describe('the published page counts after the response', () => {
  const route = source('app', 'site', '[host]', '[[...path]]', 'page.tsx');

  it('reads the headers before after() and records inside it', () => {
    const readAt = route.indexOf('const requestHeaders = await headers();');
    const afterAt = route.indexOf('after(async () => {');
    expect(readAt).toBeGreaterThan(0);
    expect(afterAt).toBeGreaterThan(readAt);
    expect(route.slice(afterAt)).toMatch(/recordVisit\(found\.tenantId/);
    expect(route).toContain("import { after } from 'next/server';");
  });

  it('classifies from the user agent and referer only', () => {
    expect(route).toMatch(/classifyVisit\(\{\s*userAgent: requestHeaders\.get\('user-agent'\),\s*referer: requestHeaders\.get\('referer'\),\s*\}\)/);
  });
});

describe('the housekeeping cron', () => {
  it('is a closed door without the secret and prunes ninety days', () => {
    const cron = source('app', 'api', 'cron', 'housekeeping', 'route.ts');
    expect(cron).toContain("process.env.CRON_SECRET ?? ''");
    expect(cron).toContain('if (!secret || auth !== `Bearer ${secret}`)');
    expect(cron).toContain('KEEP_VISIT_DAYS = 90');
    expect(cron).toContain("export const dynamic = 'force-dynamic';");
  });

  it('is scheduled in vercel.json', () => {
    const config = JSON.parse(source('vercel.json')) as { crons: Array<{ path: string; schedule: string }> };
    const cron = config.crons.find((entry) => entry.path === '/api/cron/housekeeping');
    expect(cron?.schedule).toBe('30 4 * * *');
  });
});

describe('the chart parts keep to the chart rules', () => {
  const panel = source('components', 'seo', 'VisitCharts.tsx');
  const css = source('components', 'seo', 'seo.css');
  const dashboard = source('components', 'results', 'ResultsDashboard.tsx');
  const page = source('app', 'results', 'page.tsx');

  it('is wired into the results board, best effort', () => {
    expect(dashboard).toContain("import { Bars, DailyColumns, Donut, EngineRoster, Tile } from '../seo/VisitCharts';");
    expect(dashboard).toContain('const view = readersView(visits);');
    expect(page).toContain('listVisitRows(site.tenantId, days * 2)');
    expect(page).toContain('summariseVisits(rows, now, days)');
    expect(page).toMatch(/\.catch\([\s\S]*?return summariseVisits\(\[\], now, days\);/);
  });

  it('carries a roster, a donut, sparklines, a legend, a table view and no script', () => {
    expect(panel).toContain('AI engines that have found you');
    expect(panel).toContain('className="viz-donut__slice"');
    expect(panel).toContain('className="viz-spark"');
    expect(panel).toContain('className="viz-legend"');
    expect(panel).toContain('<details className="viz-details">');
    expect(panel).toContain('<table className="viz-table">');
    expect(panel).not.toMatch(/from 'next/);
    expect(panel).not.toContain("'use client'");
    expect(panel).not.toContain('onClick');
  });

  it('uses three validated series colours, with their own dark steps', () => {
    expect(css).toMatch(/\.seo2 \{[^}]*--viz-1: #2a78d6;\s*--viz-2: #eb6834;\s*--viz-3: #1baf7a;/);
    expect(css).toMatch(/\.sv-root\[data-theme='dark'\] \.seo2 \{[^}]*--viz-1: #3987e5;\s*--viz-2: #d95926;\s*--viz-3: #199e70;/);
    expect(css).toMatch(/\.sv-root\[data-theme='system'\] \.seo2 \{[^}]*--viz-1: #3987e5;/);
  });

  it('moves only for somebody who has not asked for less', () => {
    const guard = css.indexOf('@media (prefers-reduced-motion: no-preference) {');
    expect(guard).toBeGreaterThan(0);
    const block = css.slice(guard, css.indexOf('/* The table view', guard));
    expect(block).toContain('@keyframes viz-rise');
    expect(block).toContain('@keyframes viz-draw');
    // No animation anywhere outside the guard.
    expect(css.replace(block, '')).not.toMatch(/viz-[a-z_]+ \{[^}]*animation:/);
  });

  it('keeps marks thin, gapped and capped, and the hover layer behind a real pointer', () => {
    expect(css).toContain('.viz-col__stack { display: flex; flex-direction: column-reverse; justify-content: flex-start; gap: 2px; width: 100%; max-width: 24px; height: 100%; transform-origin: bottom center; }');
    expect(panel).toContain('strokeWidth="18"');
    expect(css).toContain('.viz-col__stack .viz-seg:last-child { border-radius: 4px 4px 0 0; }');
    expect(css).toMatch(/@media \(hover: hover\) and \(pointer: fine\) \{\s*\.viz-col:hover \.viz-col__tip \{ opacity: 1; \}/);
  });

  it('writes values in the ink tokens, never the series colour', () => {
    const value = css.match(/\.viz-bar__value \{[^}]*\}/)?.[0] ?? '';
    expect(value).toContain('color: var(--ed-ink)');
    expect(value).not.toContain('--viz-');
    const tile = css.match(/\.viz-tile__value \{[^}]*\}/)?.[0] ?? '';
    expect(tile).toContain('color: var(--ed-ink)');
  });
});
