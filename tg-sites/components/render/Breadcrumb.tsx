/**
 * The trail above a nested page.
 *
 * WHY IT EXISTS, and it is not decoration. We emit BreadcrumbList structured
 * data for every nested page, and Google's own guidance is that markup must
 * represent content that is VISIBLE on the page. A BreadcrumbList with no
 * breadcrumb anywhere is a mismatch, and a mismatch between markup and page is
 * the thing that gets structured data ignored or treated as spam. I added the
 * markup on 1 Aug 2026 without the trail; this is the other half.
 *
 * IT IS ALSO THE CHEAPEST INTERNAL LINKING THERE IS. A page three levels down
 * with no trail is reachable only through the menu, and both a visitor and a
 * crawler have to go back to the top to move sideways.
 *
 * BUILT FROM THE ADDRESS, exactly as breadcrumbLd is, because the address IS
 * the hierarchy: a child page's path is its parent's plus its own slug. Two
 * sources would be two things that can disagree, and disagreeing with the
 * structured data is the one outcome that makes this worse than nothing.
 *
 * NOTHING ON THE HOME PAGE. A trail of one is not a trail.
 *
 * THE LAST CRUMB IS NOT A LINK. It is the page somebody is already on, and a
 * link to here is a link that does nothing. aria-current says which one it is.
 */
import type { ReactElement } from 'react';

/** greek-island-hopping becomes Greek island hopping. */
function titleFromSlug(slug: string): string {
  const words = slug.replace(/-+/g, ' ').trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : slug;
}

export function Breadcrumb({
  path,
  pageTitle,
}: {
  /** The address, without a leading slash. Empty string is the home page. */
  path: string;
  pageTitle: string;
}): ReactElement | null {
  const segments = path.split('/').filter(Boolean);
  if (segments.length === 0) return null;

  const crumbs: Array<{ name: string; href: string | null }> = [
    { name: 'Home', href: '/' },
  ];

  let walked = '';
  for (const [index, segment] of segments.entries()) {
    walked += `/${segment}`;
    const last = index === segments.length - 1;
    crumbs.push({
      // The last one is this page, whose real title we know. The ones between
      // are addresses we have not loaded, so the slug becomes words. Same
      // derivation as breadcrumbLd, deliberately.
      name: last ? pageTitle : titleFromSlug(segment),
      href: last ? null : walked,
    });
  }

  return (
    <nav className="tgs-crumbs" aria-label="Breadcrumb">
      <ol>
        {crumbs.map((crumb, index) => (
          <li key={index}>
            {crumb.href ? (
              <a href={crumb.href}>{crumb.name}</a>
            ) : (
              <span aria-current="page">{crumb.name}</span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
