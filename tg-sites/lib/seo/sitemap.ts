/**
 * A client's sitemap.xml.
 *
 * WHAT THIS FIXES. There was no sitemap route in the product at all before
 * 1 Aug 2026. A sitemap is not what gets a page ranked, but it is what gets a
 * page FOUND, and it is the difference between a new blog entry being read in
 * hours and being read in weeks. For a site whose pages are mostly reachable
 * only through a menu, it is the difference between found and not.
 *
 * XML BUILT BY HAND, and escaped by hand, which is a sentence that should make
 * anybody nervous, so here is why it is right. There is exactly one variable
 * kind of thing in this file, a URL, and a URL that has been through `new URL()`
 * cannot contain a raw `<` or `&` in a form that matters. It is still escaped,
 * below, belt and braces. The alternative is a dependency whose whole job is to
 * join strings.
 *
 * NO PRIORITY AND NO CHANGEFREQ. Both are in the spec, both have been ignored by
 * Google for years, and both are things somebody would then ask to configure.
 * lastmod is the one hint that is still read, and only when it is honest, which
 * is why it comes from the row's own timestamp rather than from today's date.
 */

/** One address on the site. */
export interface SitemapEntry {
  /** Path without a leading slash. Empty string is the home page. */
  path: string;
  /** ISO timestamp, or null when nothing is known. */
  updatedAt: string | null;
}

/**
 * The cap, and it is a real one rather than a formality.
 *
 * The spec's own limit is 50,000 URLs or 50MB per file. A travel agency will
 * never approach it, but "never" is what everybody says before somebody imports
 * a supplier feed as a collection. Past this the sitemap has to be split into an
 * index, and until that exists it is better to serve the newest 50,000 and say
 * so in a comment inside the file than to serve a broken one.
 */
export const MAX_SITEMAP_URLS = 50_000;

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * An absolute URL for one path, or null if it cannot be made into one.
 *
 * Through `new URL()` rather than by joining strings, because that is what
 * normalises a stray double slash, refuses a path someone has managed to get a
 * space or a control character into, and encodes the rest. A path that will not
 * parse is dropped rather than emitted broken: a sitemap of malformed URLs is
 * worse than a shorter sitemap.
 */
export function absoluteUrl(origin: string, path: string): string | null {
  if (typeof path !== 'string') return null;

  /*
   * PROTOCOL-RELATIVE IS REFUSED BEFORE ANYTHING ELSE TOUCHES IT, and the order
   * is the whole point. The first version stripped leading slashes first, to
   * tolerate callers that disagree about a leading "/", and that strip turned
   * "//evil.test/x" into an ordinary relative path. The origin check below then
   * passed, because the URL really was on our origin by then, and the sitemap
   * cheerfully listed https://theirsite.co.uk/evil.test/x.
   *
   * Same rule and same wording as safeUrl in lib/content/sanitise.ts: a
   * protocol-relative address is a scheme in disguise.
   */
  if (path.startsWith('//')) return null;

  // Control characters are never in a slug and are how a URL is smuggled past
  // a naive check. Refused rather than encoded.
  if (/[\u0000-\u001F\u007F]/.test(path)) return null;

  try {
    const url = new URL(path.replace(/^\/+/, ''), `${origin.replace(/\/+$/, '')}/`);
    // Belt and braces on the above: an absolute address with its own scheme
    // ignores the base entirely, so the origin has to be checked as well.
    if (url.origin !== new URL(origin).origin) return null;
    return url.href.replace(/\/$/, '') || url.origin;
  } catch {
    return null;
  }
}

/**
 * The whole file.
 *
 * DEDUPED BY URL, because a page and a collection entry can in principle claim
 * the same address, and the page always wins for a visitor: the site route only
 * asks a collection once the pages have said no. A sitemap that listed the same
 * URL twice would be telling a crawler something the site does not do.
 */
export function sitemapXml(origin: string, entries: readonly SitemapEntry[]): string {
  const seen = new Set<string>();
  const rows: string[] = [];
  let dropped = 0;

  for (const entry of entries) {
    if (rows.length >= MAX_SITEMAP_URLS) {
      dropped += 1;
      continue;
    }

    const url = absoluteUrl(origin, entry.path);
    if (!url || seen.has(url)) continue;
    seen.add(url);

    const lastmod = entry.updatedAt && !Number.isNaN(Date.parse(entry.updatedAt))
      ? `\n    <lastmod>${escapeXml(new Date(entry.updatedAt).toISOString())}</lastmod>`
      : '';

    rows.push(`  <url>\n    <loc>${escapeXml(url)}</loc>${lastmod}\n  </url>`);
  }

  // Said out loud rather than silently, per the rule about capped coverage: a
  // sitemap that quietly stops at 50,000 reads as "that is the whole site".
  const note = dropped > 0
    ? `\n<!-- ${dropped} further URLs omitted: this site is past the ${MAX_SITEMAP_URLS} URL limit for a single sitemap. -->`
    : '';

  return `<?xml version="1.0" encoding="UTF-8"?>${note}
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${rows.join('\n')}
</urlset>
`;
}
