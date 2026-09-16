/**
 * The results board: the enquiries summary behind its fourth tile, and the
 * pins that keep the board the one home of the audit, the readers and the
 * enquiries (the old /seo address forwards here; every link points here).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { enquiryTile, summariseEnquiries } from '../lib/results/enquiries';

function source(...parts: string[]): string {
  return readFileSync(join(__dirname, '..', ...parts), 'utf8');
}

const TODAY = new Date('2026-09-15T10:30:00Z');

describe('the enquiries summary', () => {
  const rows = [
    { day: '2026-09-15', count: 2 },
    { day: '2026-09-14', count: 1 },
    { day: '2026-09-01', count: 3 },
    // The window before: 18 July to 16 August.
    { day: '2026-08-10', count: 4 },
    // Before both.
    { day: '2026-06-01', count: 9 },
    { day: '2026-09-10', count: 0 },
  ];
  const summary = summariseEnquiries(rows, TODAY, 30);

  it('counts the window and the window before, zero-filled by day', () => {
    expect(summary.from).toBe('2026-08-17');
    expect(summary.to).toBe('2026-09-15');
    expect(summary.total).toBe(6);
    expect(summary.previous).toBe(4);
    expect(summary.daily).toHaveLength(30);
    expect(summary.daily[29]).toBe(2);
    expect(summary.daily[28]).toBe(1);
    expect(summary.daily[15]).toBe(3);
    expect(summary.daily.reduce((a, b) => a + b, 0)).toBe(6);
    expect(summary.firstDay).toBe('2026-06-01');
    expect(summariseEnquiries([], TODAY).firstDay).toBeNull();
  });

  it('becomes a tile in the readers’ shape, neutral in colour', () => {
    const tile = enquiryTile(summary, true);
    expect(tile.key).toBe('enquiries');
    expect(tile.series).toBe(0);
    expect(tile.value).toBe(6);
    expect(tile.delta).toEqual({ label: '+2', direction: 'up', note: 'up on the 30 days before' });
    expect(tile.spark.line.startsWith('M')).toBe(true);
    expect(enquiryTile(summary, false).delta).toBeNull();
    expect(enquiryTile(summariseEnquiries([], TODAY), true).delta).toEqual({ label: '0', direction: 'flat', note: 'same as the 30 days before' });
  });
});

describe('the results board is the one home of the audit, the readers and the enquiries', () => {
  const board = source('components', 'results', 'ResultsDashboard.tsx');
  const page = source('app', 'results', 'page.tsx');
  const css = source('components', 'results', 'results.css');
  const seoCss = source('components', 'seo', 'seo.css');

  it('renders with no script and no Next import, so the smoke can draw it alone', () => {
    expect(board).not.toMatch(/from 'next/);
    expect(board).not.toContain("'use client'");
    expect(board).not.toContain('onClick');
  });

  it('carries two rings, four tiles and the fix list', () => {
    expect(board.match(/<Ring /g)?.length).toBe(2);
    expect(board).toContain('tone="engines"');
    expect(board).toContain("filter((tile) => tile.key !== 'searchCrawler')");
    expect(board).toContain('enquiryTile(enquiries,');
    expect(board).toContain('<IssueRow ');
    expect(board).toContain('Every published page');
  });

  it('reads visits and enquiries best effort, twice the window for the comparison', () => {
    expect(page).toContain('listVisitRows(site.tenantId, days * 2)');
    expect(page).toContain('readEnquiryDays(site.tenantId, days)');
    expect(page).toContain('summariseEnquiries(rows, now, days)');
    expect(page).toMatch(/\.catch\([\s\S]*?return summariseEnquiries\(\[\], now, days\);/);
    expect(page).toContain("return raw === '90' ? 90 : 30;");
  });

  it('is a twelve-column board whose enquiries tile wears the neutral slate', () => {
    expect(css).toContain('grid-template-columns: repeat(12, minmax(0, 1fr));');
    expect(css).toContain(".rs-card[data-span='5'] { grid-column: span 5; }");
    expect(css).toContain(".rs-card[data-span] { grid-column: span 12; }");
    expect(seoCss).toMatch(/\.seo2 \{\s*--viz-0: #64748b;/);
    expect(seoCss).toContain(".viz-tile[data-series='0'] { background: var(--viz-0-wash); }");
  });

  it('forwards the old address and points every link at the board', () => {
    expect(source('app', 'seo', 'page.tsx')).toContain("permanentRedirect('/results');");
    expect(source('components', 'sites', 'SiteDashboard.tsx')).toContain('href="/results"');
    expect(source('components', 'sites', 'SiteDashboard.tsx')).not.toContain('href="/seo"');
    expect(source('components', 'editor', 'Rail.tsx')).toContain("href: '/results'");
    expect(source('app', 'actions', 'starters.ts')).toContain("revalidatePath('/results');");
  });
});
