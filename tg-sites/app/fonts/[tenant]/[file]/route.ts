/**
 * Serving a font file.
 *
 * The one public, unauthenticated route in the product that returns a body from
 * the database. A visitor's browser fetches this while painting a client's page,
 * so it has no session and cannot have one.
 *
 * WHY IT IS SAFE TO BE PUBLIC
 *
 * A font file is public by nature. It is a static asset referenced from a public
 * page, and the only way to make it private would be to make the page private.
 * What matters is what this route CANNOT reach, and the answer is enforced by
 * the database rather than by this file: it reads through withPublicTenant, so
 * it connects as tg_sites_renderer, which cannot write anything anywhere, cannot
 * see a draft page and cannot read the publish log. Even a total failure of the
 * logic below cannot do more than return the wrong font.
 *
 * WHY THE TENANT IS IN THE URL
 *
 * Every read in this codebase is scoped to a tenant, and this request carries no
 * cookie to derive one from. So it comes from the path, resolved through
 * resolve_tenant, the same function the public renderer uses for a hostname. The
 * slug is not a secret: it is already the site's staging hostname.
 *
 * WHY IT CAN BE CACHED FOR A YEAR
 *
 * The URL is keyed on the file's row id, which never changes for a given set of
 * bytes. Re-importing a family makes new rows and therefore new URLs, so
 * "immutable" is true rather than optimistic, and a changed font is never served
 * from a stale cache.
 */

import { getFontFile } from '../../../../lib/db/fonts';
import { resolveTenantByHostname, STAGING_SUFFIX } from '../../../../lib/db/tenants';

/**
 * A year, immutable, and public so a CDN will hold it.
 *
 * The whole point of self-hosting is that the font comes from the same origin as
 * the page. Without a long cache it would come from the same origin on EVERY
 * page view, which would be slower than the Google link this replaced.
 */
const CACHE = 'public, max-age=31536000, immutable';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ tenant: string; file: string }> },
) {
  const { tenant, file } = await params;

  // Split off the extension. It is there so the URL looks like a font to a CDN
  // and to a person reading a network panel; the id is what identifies the row.
  const fileId = file.replace(/\.(woff2|woff|ttf|otf)$/i, '');

  /*
   * Slug shape checked before it becomes a hostname.
   *
   * normaliseHostname inside resolveTenantByHostname would refuse anything
   * dangerous anyway, but a slug with a dot in it would otherwise be
   * concatenated into something that looks like a different domain, and it is
   * better to refuse here than to resolve something unintended.
   */
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(tenant)) {
    return new Response('Not found', { status: 404 });
  }

  const tenantId = await resolveTenantByHostname(`${tenant}${STAGING_SUFFIX}`);
  if (!tenantId) return new Response('Not found', { status: 404 });

  const found = await getFontFile(tenantId, fileId);
  if (!found) return new Response('Not found', { status: 404 });

  return new Response(new Uint8Array(found.bytes), {
    headers: {
      'content-type': found.mime,
      'content-length': String(found.bytes.byteLength),
      'cache-control': CACHE,
      /*
       * A font is fetched by the CSS engine, which for a same-origin request
       * needs no CORS at all. The header is here for the one case that does: a
       * client's own domain serving a page whose fonts still come from the
       * staging host while DNS is being pointed. Fonts are the one resource type
       * browsers demand CORS for even in no-cors mode.
       */
      'access-control-allow-origin': '*',
      // The bytes are sniffed on the way in, but a browser should not be
      // guessing about a binary either way.
      'x-content-type-options': 'nosniff',
    },
  });
}
