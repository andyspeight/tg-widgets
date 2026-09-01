/**
 * A published page must ask for its fonts by SLUG, not by hostname.
 *
 * THE BUG THIS EXISTS FOR. /fonts/<tenant>/<file> takes a bare slug and builds
 * the hostname itself, refusing anything containing a dot on purpose so a slug
 * cannot be dressed up as another domain. The published route handed it
 * decodeURIComponent(host), so every font URL on every live page 404'd and every
 * client site rendered in a fallback face instead of the typeface its design
 * committed to. Verified against the live site on 25 Aug 2026: the font URL in
 * the served HTML returned 404.
 *
 * Nothing errored. No page broke. No test failed. The only symptom was that the
 * type was subtly wrong forever, and it surfaced because Andy noticed a headline
 * wrapping onto two lines in the editor and one line live. The editor had been
 * right all along, because it passes site.slug.
 *
 * Deriving the slug from the hostname would have fixed only the preview
 * subdomains. A client on their own domain has a hostname with no slug in it.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (...p: string[]) => readFileSync(resolve(__dirname, '..', ...p), 'utf8');
const strip = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');

describe('the font route contract', () => {
  const route = read('app', 'fonts', '[tenant]', '[file]', 'route.ts');

  it('refuses a tenant segment containing a dot', () => {
    const pattern = /\/\^\[a-z0-9\]\+\(-\[a-z0-9\]\+\)\*\$\//.test(route);
    expect(pattern, 'the slug shape check must still be there').toBe(true);

    // The same expression the route uses, applied to both spellings.
    const shape = /^[a-z0-9]+(-[a-z0-9]+)*$/;
    expect(shape.test('coastwise')).toBe(true);
    expect(shape.test('coastwise.travelgenixsites.com')).toBe(false);
  });

  it('builds the hostname itself, which is why it must be given the slug', () => {
    expect(strip(route)).toMatch(/resolveTenantByHostname\(`\$\{tenant\}\$\{STAGING_SUFFIX\}`\)/);
  });
});

describe('what the published route passes', () => {
  const page = strip(read('app', 'site', '[host]', '[[...path]]', 'page.tsx'));

  it('gives FontHead the tenant slug', () => {
    const calls = page.match(/<FontHead[^/]*\/>/g) ?? [];
    expect(calls.length, 'both the page and the search results page render one').toBeGreaterThanOrEqual(2);
    for (const call of calls) expect(call).toContain('tenantSlug');
  });

  it('never gives it the bare hostname variable again', () => {
    /*
     * `slug` in this file is decodeURIComponent(host). The name made the bug
     * read as correct, which is most of why it survived.
     */
    expect(page).not.toMatch(/<FontHead\s+tenantSlug=\{slug\}/);
  });

  it('reads the slug through the read-only role a visitor request has', () => {
    expect(page).toContain('getPublicTenantSlug(tenantId)');
  });
});

describe('the preview route, which was right all along', () => {
  const preview = strip(read('app', 'preview', '[[...path]]', 'page.tsx'));
  it('passes the slug', () => {
    expect(preview).toMatch(/tenantSlug=\{found\.slug\}/);
  });
});
