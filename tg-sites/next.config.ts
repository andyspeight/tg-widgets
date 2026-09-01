import type { NextConfig } from 'next';

/**
 * Security headers are set here rather than at the platform, so they travel
 * with the app whichever way it gets deployed.
 *
 * The Content Security Policy is deliberately absent for now. Getting it
 * right needs the real widget origin and the per-tenant third parties, and a
 * wrong CSP that silently blocks a client's embed is worse than none in a
 * shell nobody has deployed. It lands with the tenant work, alongside HSTS.
 */
const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,

  // The Postgres driver opens raw sockets and must stay a real Node module.
  // Bundling it works until it does not, and the way it fails is a runtime
  // error on a deployed server rather than anything the build would catch.
  serverExternalPackages: ['postgres'],

  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
        ],
      },
      {
        /*
         * THE BEHAVIOUR SCRIPTS A PUBLISHED PAGE LOADS, cached properly.
         *
         * They were served with Next's default for public/, which is
         * `max-age=0, must-revalidate`: every page view revalidated four small
         * files that change only on a deploy. PageSpeed called this out under
         * "use efficient cache lifetimes".
         *
         * A DAY, NOT A YEAR, and the difference is the URL. These paths carry no
         * content hash, so the same address serves different bytes after a
         * deploy; an immutable year would pin a stale script in every visitor's
         * browser until they cleared it. stale-while-revalidate is what makes a
         * day cheap: for the following week the cached copy is used at once and
         * refreshed in the background, so a repeat visitor never waits and a
         * deploy still reaches everyone within a day.
         *
         * The immutable year belongs to /fonts and /_next, whose URLs are keyed
         * on their content and therefore cannot go stale. If these scripts are
         * ever hashed too, this becomes a year.
         */
        source: '/:file(tg-motion\\.js|slideshow\\.js|theme-toggle\\.js|no-right-click\\.js)',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=86400, stale-while-revalidate=604800',
          },
        ],
      },
      {
        // The editor is never framed by anyone, including us.
        source: '/editor/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Cache-Control', value: 'no-store' },
        ],
      },
    ];
  },
};

export default nextConfig;
