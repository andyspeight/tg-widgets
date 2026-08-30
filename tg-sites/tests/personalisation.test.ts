/**
 * Server-side personalisation, the wiring: the returning-visitor cookie the
 * middleware sets, and the render boundary that filters a page's sections by the
 * request before it draws them.
 *
 * The decision itself is proved in audience.test.ts. These hold the two seams
 * that make it real on a published page: the cookie is set once, on the first
 * visit only, and the site route resolves the visitor and filters the tree it is
 * about to render (while leaving the shared, cached load result alone, so a
 * crawler's metadata pass still sees the whole page).
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';

import { middleware } from '../middleware';
import { RETURNING_VISITOR_COOKIE } from '../lib/content/audience';

const read = (...p: string[]) => readFileSync(join(__dirname, '..', ...p), 'utf8');

function siteRequest(headers: Record<string, string>) {
  // A client hostname (not localhost, not *.vercel.app, not a preview subdomain),
  // so middleware takes the rewrite branch where the cookie is set.
  return new NextRequest('https://acme.travel/', {
    headers: { host: 'acme.travel', ...headers },
  });
}

describe('the returning-visitor cookie', () => {
  it('is set on a first visit, marked functional and long-lived', () => {
    const res = middleware(siteRequest({}));
    const cookie = res.cookies.get(RETURNING_VISITOR_COOKIE);
    expect(cookie?.value).toBe('1');
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.sameSite).toBe('lax');
    expect((cookie?.maxAge ?? 0)).toBeGreaterThan(60 * 60 * 24 * 300);
  });

  it('is not set again when the visitor already carries it', () => {
    const res = middleware(siteRequest({ cookie: `${RETURNING_VISITOR_COOKIE}=1` }));
    expect(res.cookies.get(RETURNING_VISITOR_COOKIE)).toBeUndefined();
  });
});

describe('the site route personalises what it renders', () => {
  const route = read('app', 'site', '[host]', '[[...path]]', 'page.tsx');

  it('reads the visitor and filters both a page and a collection entry', () => {
    expect(route).toContain('readVisitorSignals(slug)');
    expect(route).toContain('visibleSections(rawFound.page.content.sections, signals)');
    expect(route).toContain('visibleSections(rawFound.entry.item.sections, signals)');
  });

  it('filters a copy, never the shared cached load result', () => {
    // The metadata pass shares load()'s object, so a crawler must still see the
    // whole page. The filter builds `found` from a spread of `rawFound`.
    expect(route).toContain('...rawFound');
    // And generateMetadata does not personalise: its body, between its own
    // declaration and the page component, never filters or reads the visitor.
    const metaStart = route.indexOf('export async function generateMetadata');
    const metaEnd = route.indexOf('export default async function SitePage');
    expect(metaStart).toBeGreaterThanOrEqual(0);
    const metaBody = route.slice(metaStart, metaEnd);
    expect(metaBody).not.toContain('visibleSections');
    expect(metaBody).not.toContain('readVisitorSignals');
  });
});
