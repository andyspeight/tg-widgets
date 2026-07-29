import type { Metadata } from 'next';
import Link from 'next/link';

import { PageRenderer } from '../../../components/render/PageRenderer';
import { getPublishedPage } from '../../../lib/db/pages';
import { currentTenantId, currentWorkspace } from '../../../lib/session';

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
 * comes from the Host header rather than the workspace cookie. Nothing else
 * about it changes.
 */

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ path?: string[] }> };

async function load(path: string[] | undefined) {
  const tenantId = await currentTenantId();
  if (!tenantId) return null;
  return getPublishedPage(tenantId, (path ?? []).join('/'));
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { path } = await params;

  try {
    const found = await load(path);
    if (!found) return { title: 'Not published', robots: { index: false, follow: false } };

    const { seo, title } = { seo: found.content.seo, title: found.title };
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
    const workspace = await currentWorkspace();
    const where = (path ?? []).join('/');
    return (
      <Notice heading="Nothing published here yet">
        {where
          ? `The "${workspace}" site has no published page at /${where}.`
          : `The "${workspace}" site has no published home page.`}
      </Notice>
    );
  }

  return (
    <>
      {/* The page's only h1. Section headings start at h2, which the heading
          block enforces by not offering h1 at all. */}
      <h1 className="tgs-sr-only">{found.title}</h1>
      <PageRenderer page={found.content} />
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
    <main
      style={{
        maxWidth: 560,
        margin: '0 auto',
        padding: '96px 24px',
        fontFamily: 'ui-sans-serif, system-ui, sans-serif',
        lineHeight: 1.6,
        color: '#0f172a',
      }}
    >
      <h1 style={{ fontSize: 24, margin: '0 0 8px', letterSpacing: '-0.01em' }}>{heading}</h1>
      <p style={{ color: '#475569', margin: '0 0 24px' }}>{children}</p>
      <Link href="/sites" style={{ color: '#1b2b5b', fontWeight: 600 }}>
        Back to the page list
      </Link>
    </main>
  );
}
