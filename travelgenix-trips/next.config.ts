import type { NextConfig } from 'next';

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,

  // Public trip pages are operator-branded and embed operator imagery that lives
  // on Vercel Blob (the same store the Tour Builder writes to today).
  images: {
    remotePatterns: [{ protocol: 'https', hostname: '**.public.blob.vercel-storage.com' }],
  },

  async headers() {
    return [
      {
        // The console is ours and must never be framed. Public trip pages are
        // deliberately excluded: an operator may legitimately iframe their own
        // trip page into their site while they migrate off the widget embed.
        source: '/console/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
        ],
      },
    ];
  },
};

export default config;
