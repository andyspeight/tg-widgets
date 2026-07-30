import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { FontHead } from '../../../../components/render/FontHead';
import { PageRenderer } from '../../../../components/render/PageRenderer';
import { SiteBody, SiteHead } from '../../../../components/render/SiteHead';
import { listFontFaces } from '../../../../lib/db/fonts';
import { getPublishedPage } from '../../../../lib/db/pages';
import { getPublicSettings } from '../../../../lib/db/settings';
import { getPublicTheme } from '../../../../lib/db/theme';
import { resolveTenantByHostname } from '../../../../lib/db/tenants';
import { socialMetas } from '../../../../lib/settings/head';
import { familiesFromFiles } from '../../../../lib/theme/fonts';
import { themeTokens } from '../../../../lib/theme/tokens';

/**
 * A client's website, on their own hostname.
 *
 * The thing the whole project exists for. Content is in the initial HTML
 * response, not injected by client JavaScript: there is no 'use client' anywhere
 * in this tree, so Next ships no bundle for the page content at all.
 *
 * WHERE THE TENANT COMES FROM, WHICH IS THE ONLY REAL DIFFERENCE FROM /preview
 *
 * The hostname, put in the path by middleware.ts. /preview answers the same
 * question from the session, because on a shared domain the hostname is ours and
 * cannot say which client is meant. Here it can, and it is the only thing that
 * does: nothing about a visitor's request is trusted except which host they asked
 * for, and that is resolved through resolve_tenant, the one SECURITY DEFINER
 * function in the database.
 *
 * Everything is read through the READ-ONLY role. A draft is invisible to it even
 * with the correct tenant set, so an unpublished page cannot appear here however
 * it is asked for. That is a database guarantee rather than a query I have to
 * remember to write.
 *
 * A HOSTNAME THAT RESOLVES TO NOTHING IS A 404, NOT AN ERROR PAGE. Somebody has
 * pointed DNS at us before their site exists, or after it was removed, and the
 * honest answer is that there is no site here.
 */

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ host: string; path?: string[] }> };

async function load(host: string, path: string[] | undefined) {
  const tenantId = await resolveTenantByHostname(decodeURIComponent(host));
  if (!tenantId) return null;

  /*
   * Four reads, in parallel, all through the read-only role.
   *
   * In parallel rather than in sequence because they are independent and this is
   * the request a visitor waits on. Sequentially it would be four round trips to
   * eu-west-2 before a byte of HTML.
   */
  const [page, theme, faces, settings] = await Promise.all([
    getPublishedPage(tenantId, (path ?? []).join('/')),
    getPublicTheme(tenantId),
    listFontFaces(tenantId),
    getPublicSettings(tenantId),
  ]);

  return page ? { page, theme, faces, settings, tenantId } : null;
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { host, path } = await params;

  try {
    const found = await load(host, path);
    if (!found) return { title: 'Not found', robots: { index: false, follow: false } };

    const { seo } = found.page.content;
    const title = seo.title ?? found.page.title;
    const canonical = `https://${decodeURIComponent(host)}/${(path ?? []).join('/')}`.replace(
      /\/$/,
      '',
    );

    return {
      title,
      description: seo.description,
      robots: seo.noindex ? { index: false, follow: false } : undefined,
      alternates: { canonical: seo.canonical || canonical },
      /*
       * The social tags are built by lib/settings/head.ts and handed to Next's
       * metadata rather than rendered as tags, so Next can de-duplicate them
       * against anything else claiming the same property.
       */
      other: Object.fromEntries(
        socialMetas(found.settings, {
          title,
          description: seo.description,
          image: seo.ogImage,
          url: canonical,
        })
          .filter((meta) => meta.name)
          .map((meta) => [meta.name!, meta.content]),
      ),
      openGraph: {
        title,
        description: seo.description,
        url: canonical,
        locale: found.settings.locale.replace('-', '_'),
        images: seo.ogImage || found.settings.socialImageUrl
          ? [seo.ogImage || found.settings.socialImageUrl!]
          : undefined,
      },
    };
  } catch {
    // Metadata must never be the reason a page 500s.
    return { title: 'Travelgenix Sites' };
  }
}

export default async function SitePage({ params }: Params) {
  const { host, path } = await params;

  const found = await load(host, path);
  if (!found) notFound();

  const slug = decodeURIComponent(host);

  return (
    <>
      {/*
        Icons, the manifest link and the analytics snippets. React hoists link,
        meta and script into the head from here, so it sits with the content it
        applies to rather than being threaded through a layout.
      */}
      <SiteHead settings={found.settings} />

      {/* @font-face and the preloads, before the content, so the browser starts
          fetching the font while it is still reading the page. */}
      <FontHead tenantSlug={slug} files={found.faces} typography={found.theme.typography} />

      {/* The page's only h1. Section headings start at h2, which the heading
          block enforces by not offering h1 at all. */}
      <h1 className="tgs-sr-only">{found.page.title}</h1>

      <PageRenderer
        page={found.page.content}
        theme={themeTokens(found.theme, familiesFromFiles(found.faces)).style}
      />

      {/* The tag manager noscript fallback, and any staff body HTML. Last, so
          nothing here delays the content above it. */}
      <SiteBody settings={found.settings} />
    </>
  );
}
