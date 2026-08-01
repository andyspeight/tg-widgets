/**
 * Renaming a page without breaking every link to it.
 *
 * THE BUG THIS IS ABOUT, because it is easy to miss what was wrong. A page's
 * address is its slug plus its parents' slugs, so renaming /about to /about-us
 * left the old address resolving to nothing. The page was still there, the
 * editor showed nothing amiss, and everybody arriving from a search result, a
 * newsletter or an AI answer got a 404. Worse, the dialog said so ("changing
 * this breaks any existing link"), so the sensible response was never to tidy an
 * address at all.
 *
 * WHAT IS ACTUALLY AT RISK NOW, in the order it matters:
 *
 * 1. THE ADDRESSES ARE READ BEFORE THE UPDATE. Afterwards the old ones are gone
 *    and there is nothing left to work them out from. This is the one mistake
 *    that would leave the feature looking finished and recording nothing.
 *
 * 2. IT IS A PERMANENT REDIRECT. A temporary one tells a search engine to keep
 *    the old address and check back, so the rename still costs the client their
 *    ranking, just more slowly. Nothing visible distinguishes the two.
 *
 * 3. A REDIRECT NEVER SHADOWS A LIVE PAGE. It is consulted only after the page
 *    and the collection lookups have both said no, and it refuses to send
 *    somebody back where they came from. A redirect loop on a client's live site
 *    is a far worse failure than the 404 it was avoiding.
 *
 * 4. ONE DEFINITION OF WHERE A PAGE LIVES. "Used to be" and "is now" have to be
 *    worked out the same way or a redirect points at an address that does not
 *    exist. That is why the walk moved into lib/content/paths.ts and why the
 *    sitemap uses it too.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  livePaths,
  MAX_PATH_DEPTH,
  normalisePath,
  subtreeIds,
  type PageNode,
} from '../lib/content/paths';

function read(...parts: string[]): string {
  return readFileSync(join(__dirname, '..', ...parts), 'utf8');
}

/** A page, published unless said otherwise. */
const node = (
  id: string,
  slug: string,
  parentId: string | null = null,
  published = true,
): PageNode => ({ id, slug, parentId, published });

/**
 * The tree most of these run against.
 *
 *   ''                 home
 *   about              about
 *   about/team         team
 *   destinations       dests   (a draft)
 *   destinations/greece greece (published, under a draft)
 */
const TREE: PageNode[] = [
  node('home', ''),
  node('about', 'about'),
  node('team', 'team', 'about'),
  node('dests', 'destinations', null, false),
  node('greece', 'greece', 'dests'),
];

// ---------------------------------------------------------------------------
// Where a page lives
// ---------------------------------------------------------------------------

describe('working out a page address', () => {
  it('gives the home page the empty string, which is a real answer', () => {
    const paths = livePaths(TREE);
    // .has(), not a truthiness check. '' is the home page and it is falsy, and
    // getting that wrong drops the most important page on the site.
    expect(paths.has('home')).toBe(true);
    expect(paths.get('home')).toBe('');
  });

  it('joins a child onto its parent', () => {
    expect(livePaths(TREE).get('team')).toBe('about/team');
  });

  /*
   * NOT //about. The home page's slug is the empty string, so a naive join puts
   * a stray separator at the front of every top level address.
   */
  it('does not leave an empty segment in front of a top level page', () => {
    const paths = livePaths([node('home', ''), node('about', 'about', 'home')]);
    expect(paths.get('about')).toBe('about');
  });

  /*
   * A CHILD UNDER A DRAFT HAS NO ADDRESS, and it is not a rule invented for
   * this. getPublishedPage walks a path a segment at a time, so /destinations
   * 404s and therefore /destinations/greece cannot be reached however published
   * it is itself. Anything that listed it would be listing a URL that 404s.
   */
  it('leaves out a published page whose parent is a draft', () => {
    const paths = livePaths(TREE);
    expect(paths.has('greece')).toBe(false);
    expect(paths.has('dests')).toBe(false);
  });

  it('leaves out a page that has never been published', () => {
    expect(livePaths([node('x', 'x', null, false)]).size).toBe(0);
  });

  it('agrees with the depth a requested path is allowed to have', () => {
    const chain = (length: number): PageNode[] =>
      Array.from({ length }, (_, index) =>
        node(`p${index}`, `s${index}`, index === 0 ? null : `p${index - 1}`));

    const deepest = MAX_PATH_DEPTH;
    const ok = livePaths(chain(deepest)).get(`p${deepest - 1}`);
    expect(ok).toBe(Array.from({ length: deepest }, (_, i) => `s${i}`).join('/'));
    // And one deeper is refused by BOTH ends, so a page that cannot be asked for
    // is never offered either.
    expect(livePaths(chain(deepest + 1)).has(`p${deepest}`)).toBe(false);
    expect(normalisePath(ok as string)).toBe(ok);
    expect(normalisePath(`${ok}/one-more`)).toBeNull();
  });

  /*
   * A cycle cannot happen through the schema and would HANG rather than fail if
   * it did, which on a visitor's request means the site stops answering. The cap
   * is what turns that into a missing page.
   */
  it('ends rather than hanging if two pages are each other parent', () => {
    const paths = livePaths([node('a', 'a', 'b'), node('b', 'b', 'a')]);
    expect(paths.size).toBe(0);
  });
});

describe('a page and everything under it', () => {
  it('includes the page itself, since renaming it is the usual case', () => {
    expect(subtreeIds(TREE, 'about')).toContain('about');
  });

  /*
   * THE ONE A HUMAN WOULD FORGET. Renaming /destinations changes the address of
   * every page beneath it without any of them being touched, so recording a
   * redirect for the page alone leaves the children broken and silent.
   */
  it('reaches grandchildren, because a rename moves the whole branch', () => {
    const deep: PageNode[] = [
      node('a', 'a'),
      node('b', 'b', 'a'),
      node('c', 'c', 'b'),
      node('elsewhere', 'elsewhere'),
    ];
    expect(subtreeIds(deep, 'a').sort()).toEqual(['a', 'b', 'c']);
    expect(subtreeIds(deep, 'a')).not.toContain('elsewhere');
  });

  it('ends rather than hanging on a cycle', () => {
    expect(subtreeIds([node('a', 'a', 'b'), node('b', 'b', 'a')], 'a').sort())
      .toEqual(['a', 'b']);
  });
});

describe('tidying a requested address', () => {
  it('asks the same question however the slashes fall', () => {
    for (const asked of ['about/team', '/about/team', 'about/team/', '//about//team//']) {
      expect(normalisePath(asked), asked).toBe('about/team');
    }
  });

  it('reads the root as the home page rather than as nothing', () => {
    expect(normalisePath('')).toBe('');
    expect(normalisePath('/')).toBe('');
  });

  it('refuses what could not be an address here, rather than trimming it', () => {
    expect(normalisePath('a/'.repeat(MAX_PATH_DEPTH + 1))).toBeNull();
    expect(normalisePath('x'.repeat(5000))).toBeNull();
    expect(normalisePath(null)).toBeNull();
    expect(normalisePath(42)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The decisions, read as source
// ---------------------------------------------------------------------------

describe('recording the move', () => {
  const source = read('lib', 'db', 'pages.ts');
  const meta = source.slice(
    source.indexOf('export async function updatePageMeta'),
    source.indexOf('\nexport ', source.indexOf('export async function updatePageMeta') + 10),
  );

  /*
   * THE ORDERING CLAIM, and it is the one that would leave this feature looking
   * finished and doing nothing. After the update the old addresses are gone and
   * there is nothing left to work them out from.
   */
  it('reads the old addresses before the update, and writes after it', () => {
    const before = meta.indexOf('addressesBefore(');
    const update = meta.indexOf('update public.pages');
    const record = meta.indexOf('recordMove(');

    expect(before).toBeGreaterThan(-1);
    expect(before).toBeLessThan(update);
    expect(update).toBeLessThan(record);
  });

  /*
   * BOTH HALVES OR NEITHER. A redirect written outside the transaction could
   * forward an address that never moved, and a rename that kept its redirect
   * lost would break the links it exists to protect.
   */
  it('does both inside the one transaction', () => {
    expect(meta).toContain('withTenant(tenantId, async (tx) => {');
    expect(meta).toContain('recordMove(tx,');
  });

  it('records nothing when the update matched no page', () => {
    const norows = meta.indexOf('if (!rows.length) return null;');
    expect(norows).toBeGreaterThan(-1);
    expect(norows).toBeLessThan(meta.indexOf('recordMove('));
  });

  it('reads no tree at all for a change that moves nothing', () => {
    // A title-only edit is the common one and should stay a single statement.
    expect(meta).toContain('const mightMove = changes.slug !== undefined || movingParent;');
  });
});

describe('sending somebody to the new address', () => {
  const route = read('app', 'site', '[host]', '[[...path]]', 'page.tsx');

  /*
   * PERMANENT, NOT TEMPORARY, and nothing on screen tells the two apart. A
   * temporary redirect tells a search engine to keep the old address and check
   * back, so the client loses the ranking anyway.
   */
  it('is a permanent redirect, so the page keeps what it has earned', () => {
    expect(route).toContain('permanentRedirect(`/${moved}`)');
    // The plain one is a 307 and would be the obvious import to reach for.
    expect(route).not.toMatch(/\bredirect\(`\/\$\{moved\}`\)/);
  });

  /*
   * ONLY AFTER EVERYTHING ELSE HAS SAID NO. A live page always wins, so a
   * redirect can never shadow real content, and the two extra reads land on a
   * request that was already going to be a 404.
   */
  it('is consulted only once the page and the collection have both said no', () => {
    expect(route).toContain('if (!found) return gone(host, path);');

    /*
     * EXACTLY ONCE, AND INSIDE gone(). Checking only that load() does not call
     * it was too weak: a lookup added anywhere else in the route still runs on
     * every request that was going to succeed, and one placed before the page
     * lookup would let a redirect shadow live content.
     */
    expect((route.match(/resolveRedirect\(/g) ?? []).length).toBe(1);

    const inGone = route.slice(
      route.indexOf('async function gone('),
      route.indexOf('export default'),
    );
    expect(inGone).toContain('resolveRedirect(');
  });

  it('treats the home page as a real destination rather than as nothing', () => {
    expect(route).toContain('if (moved !== null)');
  });

  /*
   * MIDDLEWARE IS WHERE A REDIRECT NORMALLY BELONGS AND IT MUST NOT GO THERE.
   * It runs on every request, before caching, in an environment where the
   * Postgres driver has no business being, and this needs two queries. The rule
   * predates redirects and is written at the top of that file.
   */
  it('never puts a database call in middleware', () => {
    const middleware = read('middleware.ts');
    expect(middleware).not.toMatch(/from '\.\/lib\/db\//);
    expect(middleware).not.toContain('resolveRedirect');
  });
});

describe('the redirect lookup', () => {
  const source = read('lib', 'db', 'redirects.ts');

  it('runs as the read-only role, like everything else a visitor triggers', () => {
    const resolve = source.slice(source.indexOf('export async function resolveRedirect'));
    expect(resolve).toContain('withPublicTenant(tenantId');
  });

  /*
   * The target is worked out fresh every time. A stored to_path would go stale
   * on the second rename and send people to another 404, looking healthy while
   * it did it.
   */
  it('works the target out from where the page is now, never from a stored path', () => {
    expect(source).toContain('livePaths(await tree(tx)).get(pageId)');
    expect(source).not.toContain('to_path');
  });

  it('gives up rather than pointing at a page nobody can reach', () => {
    expect(source).toContain('if (now === undefined) return null;');
  });

  /*
   * A LOOP IS WORSE THAN THE 404. This should be unreachable, because a page
   * living at that address would have been found first, and recordMove deletes
   * the row that would make it possible. It is checked anyway: it is one line
   * and the failure it prevents takes a client's site down rather than one page.
   */
  it('never sends somebody back where they came from', () => {
    expect(source).toContain('return now === from ? null : now;');
  });

  it('cleans up the row that would let a rename back become a loop', () => {
    const record = source.slice(source.indexOf('export async function recordMove'));
    expect(record).toContain('delete from public.page_redirects where from_path =');
  });

  it('lets the newest claim on an address win', () => {
    expect(source).toContain('on conflict (tenant_id, from_path)');
    expect(source).toContain('do update set page_id = excluded.page_id');
  });
});

describe('what the rename dialog says', () => {
  const source = read('components', 'sites', 'SiteDashboard.tsx');
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

  /*
   * THE OLD WARNING WAS TRUE AND IS NOW A LIE, and a lie that discourages
   * exactly the thing this work makes safe. Somebody who believes renaming
   * breaks their links never fixes an address written badly on day one.
   */
  it('no longer tells people that renaming breaks their links', () => {
    expect(code).not.toContain('breaks any existing link');
  });

  it('says what happens to the old address, and only when there is one', () => {
    expect(code).toContain('will keep working');
    // Live AND actually moving. A draft has no links, and fixing a typo in a
    // live page's name leaves its address alone.
    expect(code).toContain(
      "const addressIsMoving = isRename && isLive && effectiveSlug !== (initialSlug ?? '');",
    );
    expect(code).toContain('{addressIsMoving && (');
  });

  it('is told whether the page is live rather than working it out', () => {
    expect(code).toContain("isLive={dialog.page.status === 'published'}");
  });
});

describe('the schema', () => {
  const sql = read('db', 'migrations', '0018_page_redirects.sql');

  it('points at a page, so a second rename cannot strand the first', () => {
    expect(sql).toContain('page_id    uuid not null references public.pages(id) on delete cascade');
    expect(sql).not.toMatch(/^\s*to_path/m);
  });

  it('allows one answer per address', () => {
    expect(sql).toContain('unique (tenant_id, from_path)');
  });

  /*
   * The renderer reads this table without a published filter, which is unlike
   * everything else it reads and is deliberate: a redirect is a fact about an
   * address, not content. The page it points at is still gated.
   */
  it('lets a visitor request resolve one, and keeps it inside the tenant', () => {
    expect(sql).toContain('create policy page_redirects_renderer on public.page_redirects');
    expect(sql).toContain('using (tenant_id = public.current_tenant())');
    expect(sql).toContain('grant select on public.page_redirects to tg_sites_renderer');
    // Read only. A visitor's request must never be able to write one.
    expect(sql).not.toMatch(/grant .*(insert|update|delete).* to tg_sites_renderer/);
  });

  it('is checked against a real database as well', () => {
    const isolation = read('db', 'isolation-check.sql');
    expect(isolation).toContain('public.page_redirects');
    expect(isolation).toContain('deleting a page removes the redirects pointing at it');
  });
});
