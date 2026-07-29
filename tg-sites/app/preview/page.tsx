import type { Metadata } from 'next';
import { PageRenderer } from '../../components/render/PageRenderer';
import { SEED_PAGE } from '../../lib/content/seed';

/**
 * A server-rendered page.
 *
 * This route exists to prove the property the whole project is being built
 * for: the content is in the initial HTML response, not injected by client
 * JavaScript. There is no 'use client' anywhere in this tree, so Next ships
 * no JS bundle for the page content at all.
 *
 * It renders the seed page. When pages come out of Postgres this becomes
 * `[[...slug]]` with a tenant-scoped query behind it, and nothing about the
 * renderer changes.
 */

export const metadata: Metadata = {
  title: SEED_PAGE.seo.title ?? SEED_PAGE.title,
  description: SEED_PAGE.seo.description,
  robots: SEED_PAGE.seo.noindex ? { index: false, follow: false } : undefined,
};

export default function Preview() {
  return (
    <>
      {/* The page's only h1. Section headings start at h2, which the heading
          block enforces by not offering h1 at all. */}
      <h1 className="tgs-sr-only">{SEED_PAGE.title}</h1>
      <PageRenderer page={SEED_PAGE} />
    </>
  );
}
