/**
 * The monthly report's calendar arithmetic and view shaping. Pure, so it is
 * proved here; the tenant-scoped reads (lib/db/report.ts) are exercised by the
 * page and typechecking, the way the rest of lib/db is.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  delta,
  deltaLabel,
  isFutureOrCurrent,
  monthOf,
  monthRange,
  nextMonth,
  parseMonthKey,
  previousMonth,
} from '../lib/content/report';

describe('month ranges are UTC and roll over correctly', () => {
  it('bounds a month from its first to the next first', () => {
    const r = monthRange(2026, 8);
    expect(r.from.toISOString()).toBe('2026-08-01T00:00:00.000Z');
    expect(r.to.toISOString()).toBe('2026-09-01T00:00:00.000Z');
    expect(r.key).toBe('2026-08');
    expect(r.label).toBe('August 2026');
  });

  it('rolls December over to the next January', () => {
    const r = monthRange(2026, 12);
    expect(r.to.toISOString()).toBe('2027-01-01T00:00:00.000Z');
  });

  it('clamps a nonsense month into range', () => {
    expect(monthRange(2026, 0).month).toBe(1);
    expect(monthRange(2026, 13).month).toBe(12);
  });
});

describe('parseMonthKey is total and defensive', () => {
  const now = new Date('2026-08-15T12:00:00Z');
  it('reads a valid YYYY-MM', () => {
    expect(parseMonthKey('2026-03', now)).toEqual({ year: 2026, month: 3 });
  });
  it('falls back to the month of now for junk or absence', () => {
    expect(parseMonthKey(undefined, now)).toEqual({ year: 2026, month: 8 });
    expect(parseMonthKey('nonsense', now)).toEqual({ year: 2026, month: 8 });
    expect(parseMonthKey('2026-13', now)).toEqual({ year: 2026, month: 8 });
    expect(parseMonthKey('1999-05', now)).toEqual({ year: 2026, month: 8 });
  });
});

describe('previous and next months roll across years', () => {
  it('steps back across January', () => {
    expect(previousMonth(2026, 1)).toEqual({ year: 2025, month: 12 });
    expect(previousMonth(2026, 8)).toEqual({ year: 2026, month: 7 });
  });
  it('steps forward across December', () => {
    expect(nextMonth(2026, 12)).toEqual({ year: 2027, month: 1 });
    expect(nextMonth(2026, 8)).toEqual({ year: 2026, month: 9 });
  });
});

describe('the Next control is capped at the current month', () => {
  const now = new Date('2026-08-15T12:00:00Z');
  it('is true for this month and the future, false for the past', () => {
    expect(isFutureOrCurrent(2026, 8, now)).toBe(true);
    expect(isFutureOrCurrent(2026, 9, now)).toBe(true);
    expect(isFutureOrCurrent(2027, 1, now)).toBe(true);
    expect(isFutureOrCurrent(2026, 7, now)).toBe(false);
    expect(isFutureOrCurrent(2025, 12, now)).toBe(false);
  });
  it('monthOf reads the UTC month', () => {
    expect(monthOf(new Date('2026-01-31T23:30:00Z'))).toEqual({ year: 2026, month: 1 });
  });
});

describe('delta shows the change and its direction', () => {
  it('is up, down or flat', () => {
    expect(delta(5, 3)).toEqual({ diff: 2, direction: 'up' });
    expect(delta(2, 6)).toEqual({ diff: -4, direction: 'down' });
    expect(delta(4, 4)).toEqual({ diff: 0, direction: 'flat' });
  });
  it('labels the signed change', () => {
    expect(deltaLabel(delta(5, 3))).toBe('+2');
    expect(deltaLabel(delta(2, 6))).toBe('-4');
    expect(deltaLabel(delta(4, 4))).toBe('0');
  });
});

describe('the report page is wired up and tenant-scoped', () => {
  const read = (...p: string[]) => readFileSync(join(__dirname, '..', ...p), 'utf8');

  it('reads through activeSite and the month reports, gated behind sign-in', () => {
    const page = read('app', 'reports', 'page.tsx');
    // Scoped to the logged-in client's own site, like every dashboard page.
    expect(page).toContain('await activeSite()');
    expect(page).toContain("redirect('/signin?next=%2Freports')");
    // The shown month and the previous month, for the counts and the deltas.
    expect(page).toContain('readMonthReport(site.tenantId, range.from, range.to)');
    expect(page).toContain('readMonthMetrics(site.tenantId, prevRange.from, prevRange.to)');
    // The month comes from the URL, defensively parsed.
    expect(page).toContain('parseMonthKey(mParam, now)');
    // Honest about analytics being off.
    expect(page).toContain('web analytics is switched on');
  });

  it('the db reads are tenant-scoped and month-bounded', () => {
    const db = read('lib', 'db', 'report.ts');
    expect(db).toContain('withTenant(tenantId');
    expect(db).toContain('created_at >= ${from} and created_at < ${to}');
    // Collection items are scoped tenant-wide by joining the RLS-scoped table.
    expect(db).toContain('join public.collections c on c.id = ci.collection_id');
  });

  it('the dashboard links to the report', () => {
    const dash = read('components', 'sites', 'SiteDashboard.tsx');
    expect(dash).toContain('href="/reports"');
  });
});
