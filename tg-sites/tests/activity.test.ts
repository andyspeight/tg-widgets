/**
 * The activity log, at its edges.
 *
 * The statement-level claims (an event is written inside the transaction that
 * caused it, the read goes through withTenant, newest first) live in db.test.ts
 * against the fake driver, where ordering is asserted rather than observed. Here
 * are the two things that do not need a driver: the wording a reader sees, and
 * the boundaries that keep the log honest, which are source facts.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { absoluteDate, relativeTime, resolveActors } from '../lib/activity/log';
import { pageActivitySummary, type ActivityEntry } from '../lib/db/activity';

const ROOT = join(__dirname, '..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

describe('the line a reader sees', () => {
  it('names the page for each kind of event', () => {
    expect(pageActivitySummary('page.create', 'Home')).toBe('Created the Home page');
    expect(pageActivitySummary('page.delete', 'About')).toBe('Deleted the About page');
    expect(pageActivitySummary('page.publish', 'Contact')).toBe('Published the Contact page');
  });

  it('falls back the same way createPage does, so an unnamed page still reads', () => {
    // A page saved with no title is 'Untitled page' on the canvas; the log line
    // must not read 'Published the  page' with a hole in it.
    expect(pageActivitySummary('page.publish', '   ')).toBe('Published the Untitled page page');
    expect(pageActivitySummary('page.create', '')).toBe('Created the Untitled page page');
  });
});

describe('the table is a log, not a story its subject can rewrite', () => {
  const migration = read('db/migrations/0021_site_activity.sql');

  it('forces row level security and scopes every row to the tenant', () => {
    expect(migration).toContain('force row level security');
    expect(migration).toContain('tenant_id = public.current_tenant()');
  });

  it('grants select and insert only, so a written line cannot be changed or removed', () => {
    // The whole append-only guarantee is the absence of update and delete here.
    // Anchored to a grant STATEMENT (a line beginning grant), not the prose that
    // explains the absence, which naturally contains the words "update or delete".
    expect(migration).toContain('grant select, insert on public.site_activity to tg_sites_app');
    expect(migration).not.toMatch(/^\s*grant\b.*\b(update|delete)\b/im);
  });

  it('never grants the renderer anything, because the public site shows no history', () => {
    expect(migration).not.toContain('tg_sites_renderer');
  });

  it('is proven cross-tenant in the isolation check', () => {
    const iso = read('db/isolation-check.sql');
    expect(iso).toContain('site_activity');
    expect(iso).toContain('a tenant sees its own activity');
    expect(iso).toContain('nor a line erased from it');
  });
});

describe('the boundaries around who records and who reads', () => {
  it('records an event from inside the mutation, never from a callable action', () => {
    // recordActivity is a db-layer function called by the page mutations; there
    // is no action that lets the outside world write an arbitrary line.
    const pages = read('lib/db/pages.ts');
    expect(pages).toContain("action: 'page.create'");
    expect(pages).toContain("action: 'page.delete'");
    expect(pages).toContain("action: 'page.publish'");

    // The one activity action is read-only.
    const action = read('app/actions/activity.ts');
    expect(action).toContain('listActivity');
    expect(action).not.toContain('recordActivity');
  });

  it('reads only for a tenant the caller belongs to', () => {
    const action = read('app/actions/activity.ts');
    // requireTenantId resolves the tenant from the signed-in user's memberships,
    // so the action cannot be pointed at a site the caller is not in.
    expect(action).toContain('requireTenantId');
  });
});

// ---------------------------------------------------------------------------
// The screen: turning a stored row into a name and a time a person reads.
// ---------------------------------------------------------------------------

describe('resolving who did it', () => {
  const base = {
    action: 'page.publish',
    summary: 'Published the Home page',
    createdAt: new Date('2026-08-17T09:00:00Z'),
  } satisfies Partial<ActivityEntry>;
  const entry = (id: string, actorId: string | null): ActivityEntry => ({ id, actorId, ...base });

  it('prefers a name, falls back to an email, and blanks a stranger', () => {
    const members = [
      { userId: 'u1', email: 'sam@x.co', name: 'Sam Reed' },
      { userId: 'u2', email: 'jo@x.co', name: null },
    ];
    const lines = resolveActors(
      [entry('a', 'u1'), entry('b', 'u2'), entry('c', 'u3'), entry('d', null)],
      members,
    );
    // u3 is nobody in the list (a member since removed); a null actor is an event
    // no person accounts for. Both come back with no name rather than an id.
    expect(lines.map((line) => line.actor)).toEqual(['Sam Reed', 'jo@x.co', null, null]);
  });

  it('treats a name that is only spaces as no name', () => {
    const lines = resolveActors([entry('a', 'u1')], [{ userId: 'u1', email: 'sam@x.co', name: '   ' }]);
    expect(lines[0].actor).toBe('sam@x.co');
  });

  it('carries the other fields through untouched', () => {
    const lines = resolveActors([entry('a', 'u1')], [{ userId: 'u1', email: 'sam@x.co', name: 'Sam' }]);
    expect(lines[0]).toMatchObject({ id: 'a', action: 'page.publish', summary: 'Published the Home page' });
    expect(lines[0].createdAt).toEqual(base.createdAt);
  });
});

describe('how long ago, in words', () => {
  const now = new Date('2026-08-17T12:00:00Z').getTime();
  const S = 1000;
  const M = 60 * S;
  const H = 60 * M;
  const D = 24 * H;
  const ago = (ms: number) => new Date(now - ms);

  it('reads the recent past the way a person would say it', () => {
    expect(relativeTime(ago(5 * S), now)).toBe('just now');
    expect(relativeTime(ago(2 * M), now)).toBe('2 minutes ago');
    expect(relativeTime(ago(3 * H), now)).toBe('3 hours ago');
    expect(relativeTime(ago(2 * D), now)).toBe('2 days ago');
  });

  it('is singular for one, so it never reads "1 hours ago"', () => {
    expect(relativeTime(ago(1 * M), now)).toBe('1 minute ago');
    expect(relativeTime(ago(1 * H), now)).toBe('1 hour ago');
    expect(relativeTime(ago(1 * D), now)).toBe('1 day ago');
  });

  it('falls back to a plain date once it is more than a week old', () => {
    const older = relativeTime(ago(10 * D), now);
    expect(older).not.toMatch(/ago/);
    expect(older).toBe(absoluteDate(ago(10 * D)));
  });

  it('a clock a little ahead reads as just now, not a negative count', () => {
    expect(relativeTime(new Date(now + 30 * S), now)).toBe('just now');
  });

  it('an unreadable value does not throw', () => {
    expect(relativeTime('not a date', now)).toBe('just now');
  });
});

describe('a plain date', () => {
  it('is the day, a short month and the year, in UK order', () => {
    // Built from local parts so the assertion does not depend on the runner's
    // timezone: August is month index 7.
    const shown = absoluteDate(new Date(2026, 7, 7, 12, 0, 0));
    expect(shown).toContain('2026');
    expect(shown).toMatch(/Aug/);
    expect(shown).toMatch(/^7\b/);
  });
});

describe('the screen shows the log to everyone, read only', () => {
  const editor = read('components/settings/SettingsEditor.tsx');

  it('adds an Activity tab that is not behind the code gate', () => {
    // A plain entry in the always-present part of the list, not inside the
    // canEditCode spread that guards Domains and Custom code.
    expect(editor).toContain("{ id: 'activity', label: 'Activity' }");
    // Rendered with no canEditCode guard, unlike the two tabs after it.
    expect(editor).toContain("{tab === 'activity' && <ActivityPanel />}");
  });

  it('hides the settings save bar on the activity tab, which saves nothing', () => {
    expect(editor).toContain("tab !== 'activity'");
  });

  it('loads the log over its own action and shows a time, not a raw stamp', () => {
    const panel = read('components/settings/ActivityPanel.tsx');
    expect(panel).toContain('listActivityAction');
    expect(panel).toContain('relativeTime');
  });

  it('resolves the actor on the server from the member list', () => {
    const action = read('app/actions/activity.ts');
    expect(action).toContain('listMembers');
    expect(action).toContain('resolveActors');
  });
});
