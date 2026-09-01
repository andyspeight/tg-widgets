/**
 * The published route must fetch a page's data once per request, not twice.
 *
 * WHY THIS IS A SOURCE ASSERTION RATHER THAN A BEHAVIOURAL ONE. Proving the
 * deduplication properly means running generateMetadata and the page component
 * inside one Next request and counting transactions, which needs a server and a
 * database this suite deliberately does not have. What CAN be pinned here is the
 * thing that was actually wrong: the wrapper was missing. If somebody unwraps it
 * the regression is silent everywhere else, because the page still renders and
 * every test still passes; it just costs twice the database work on every view.
 *
 * Comments are stripped before asserting, because this repo has twice been
 * caught by a source check that matched the comment explaining the rule rather
 * than the code obeying it.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROUTE = resolve(__dirname, '..', 'app/site/[host]/[[...path]]/page.tsx');
const source = readFileSync(ROUTE, 'utf8');
const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('the published page load is memoised per request', () => {
  it('imports cache from react', () => {
    expect(code).toMatch(/import\s*\{\s*cache\s*\}\s*from\s*'react'/);
  });

  it('wraps load in cache()', () => {
    expect(code).toMatch(/const\s+load\s*=\s*cache\(/);
  });

  it('is still called from both generateMetadata and the page component', () => {
    /*
     * The whole reason the wrapper matters. If this drops to one call site the
     * wrapper is merely harmless; at two or more it is load-bearing, so the
     * count is the thing worth asserting rather than the mere presence.
     */
    const calls = code.match(/await load\(host, path\)/g) ?? [];
    expect(calls.length).toBeGreaterThanOrEqual(2);
  });

  it('does not reach for a longer-lived cache than the request', () => {
    /*
     * unstable_cache and a revalidate window both outlive the request. Either
     * would let one visitor's tenant data answer another's, or hold a published
     * page back after a publish. Caching published HTML at the edge is a real
     * option and a separate decision; it does not belong inside this function.
     */
    expect(code).not.toMatch(/unstable_cache/);
  });
});
