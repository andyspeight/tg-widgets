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
