/**
 * The web app manifest, per site.
 *
 * What Android reads when somebody chooses "Add to Home screen". iOS uses the
 * apple-touch-icon link instead, which is why SiteHead emits both.
 *
 * A ROUTE RATHER THAN app/manifest.ts, because Next's special manifest file is
 * one manifest for one app and this is one per tenant, resolved from the hostname
 * that middleware put in the path. Reached at /manifest.webmanifest on a client's
 * own domain, which is where SiteHead's link points.
 */

import { NextResponse } from 'next/server';

import { getPublicSettings } from '../../../../lib/db/settings';
import { getTenant, resolveTenantByHostname } from '../../../../lib/db/tenants';
import { manifest } from '../../../../lib/settings/head';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ host: string }> },
): Promise<NextResponse> {
  const { host } = await params;

  const tenantId = await resolveTenantByHostname(decodeURIComponent(host));
  if (!tenantId) return new NextResponse(null, { status: 404 });

  const [settings, tenant] = await Promise.all([
    getPublicSettings(tenantId),
    getTenant(tenantId),
  ]);

  /*
   * No icon, no manifest.
   *
   * An empty manifest makes Android offer to install the site and then show a
   * screenshot of the page as its icon, which looks broken. SiteHead does not emit
   * the link in that case either, so this is the second of two guards, and it is
   * here because a manifest URL that has been bookmarked or cached should stop
   * working when the icon is removed rather than start serving something empty.
   */
  if (!settings.touchIconUrl) return new NextResponse(null, { status: 404 });

  return NextResponse.json(manifest(settings, tenant?.name ?? 'Website'), {
    headers: {
      'content-type': 'application/manifest+json',
      /*
       * Five minutes, not a year.
       *
       * A manifest is not immutable: the URL never changes and the contents do,
       * every time somebody sets a new icon. Long caching here would mean a client
       * changing their home screen icon and being told it worked while every phone
       * kept the old one. Five minutes is long enough to stop it being fetched per
       * page view and short enough that a change looks like it took.
       */
      'cache-control': 'public, max-age=300',
    },
  });
}
