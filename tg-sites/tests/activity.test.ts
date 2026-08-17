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

import { pageActivitySummary } from '../lib/db/activity';

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
