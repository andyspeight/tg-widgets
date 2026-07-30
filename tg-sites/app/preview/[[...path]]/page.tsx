import type { Metadata } from 'next';
import Link from 'next/link';

import '../../../components/sites/sites.css';
import { PageRenderer } from '../../../components/render/PageRenderer';
import { getPublishedPage } from '../../../lib/db/pages';
import { getPublicTheme } from '../../../lib/db/theme';
import { themeTokens } from '../../../lib/theme/tokens';
import { activeSite } from '../../../lib/auth/session';

/**
 * The published site, rendered on the server.
 *
 * This is the property the whole project exists for: the content is in the
 * initial HTML response, not injected by client JavaScript. There is no
 * 'use client' anywhere in this tree, so Next ships no JS bundle for the
 * page content at all. View source and it is all there.
 *
 * It reads through withPublicTenant, which uses the read-only database role.
 * A draft is invisible to that role even with the correct tenant set, so an
 * unpublished page cannot appear here however it is asked for.
 *
 * Living under /preview because the editor and the sites share one domain for
 * now. On a client's own hostname this becomes the root route and the tenant
 * comes from the Host header. Nothing else about it changes.
 *
 * WHY THIS ONE NEEDS A SESSION
 *
 * Two separate questions, and only one of them is about permission. WHICH
 * tenant is being asked for is answered here by the session, because on a
 * shared domain there is nothing else to answer it with: the hostname is ours,
 * not the client's. WHAT can be seen is still answered by the renderer role,
 * which cannot see a draft even with the right tenant set.
 *
 * So this is a staff preview, and it says so rather than showing a sign-in
 * screen for content that is genuinely public. The public path is the client's
 * own hostname, and that is a later job.
 */

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ path?: string[] }> };

async function load(path: string[] | undefined) {
  const site = await activeSite();
  if (!site) return null;

  /*
   * Page and theme together, both through the read-only role.
   *
   * In parallel rather than in sequence: they are independent reads and this is
   * the request a visitor waits on. Both go through withPublicTenant, so a
   * theme cannot be read for a tenant the request is not scoped to, and neither
   * call can write anything.
   */
  const [page, theme] = await Promise.all([
    getPublishedPage(site.tenantId, (path ?? []).join('/')),
    getPublicTheme(site.tenantId),
  ]);

  return page ? { page, theme } : null;
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { path } = await params;

  try {
    const found = await load(path);
    if (!found) return { title: 'Not published', robots: { index: false, follow: false } };

    const { seo, title } = { seo: found.page.content.seo, title: found.page.title };
    return {
      title: seo.title ?? title,
      description: seo.description,
      robots: seo.noindex ? { index: false, follow: false } : undefined,
    };
  } catch {
    // Metadata must never be the reason a page 500s. The body below reports
    // the real problem in language someone can act on.
    return { title: 'Travelgenix Sites' };
  }
}

export default async function PublishedPage({ params }: Params) {
  const { path } = await params;

  let found: Awaited<ReturnType<typeof load>> = null;
  let failure: string | null = null;

  try {
    found = await load(path);
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error);
  }

  if (failure) return <Notice heading="Cannot reach the database">{failure}</Notice>;

  if (!found) {
    const site = await activeSite();
    const where = (path ?? []).join('/');

    // No site at all means no session, or a session with no memberships.
    // Either way the answer is not "nothing is published here".
    if (!site) {
      return (
        <Notice heading="Sign in to preview a site">
          On this domain there is no way to tell which site you mean, so the
          preview reads it from whoever is signed in.
        </Notice>
      );
    }

    return (
      <Notice heading="Nothing published here yet">
        {where
          ? `${site.name} has no published page at /${where}.`
          : `${site.name} has no published home page.`}
      </Notice>
    );
  }

  return (
    <>
      {/* The page's only h1. Section headings start at h2, which the heading
          block enforces by not offering h1 at all. */}
      <h1 className="tgs-sr-only">{found.page.title}</h1>
      <PageRenderer page={found.page.content} theme={themeTokens(found.theme).style} />
    </>
  );
}

// ---------------------------------------------------------------------------

/**
 * Deliberately plain, and deliberately not styled like the client's site.
 *
 * This is scaffolding talking, not the site. Dressing it up in the tenant's
 * theme would suggest the site is working when it is not.
 */
function Notice({ heading, children }: { heading: string; children: React.ReactNode }) {
  return (
    <div className="sv-root" data-theme="light">
      <main className="tg-door" data-narrow="true">
        <h1 className="tg-door__title" data-small="true">{heading}</h1>
        <p className="tg-door__lede">{children}</p>
        <div className="tg-door__actions">
          <Link className="tg-btn" data-variant="primary" href="/sites">
            Back to your pages
          </Link>
        </div>
      </main>
    </div>
  );
}
