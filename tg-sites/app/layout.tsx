import type { Metadata } from 'next';
import './globals.css';

/**
 * Run next to the database, not an ocean away from it.
 *
 * Vercel defaults a project to iad1, Washington DC. This app's Postgres is in
 * eu-west-2, London, and its visitors are the customers of UK travel agencies.
 * Nothing had ever set this, so every published page view was answered by a
 * function in Virginia that then made its reads across the Atlantic, and each of
 * those reads is a transaction: a begin, a set_config to name the tenant for RLS,
 * the query, a commit. Time to first byte is inside Largest Contentful Paint, so
 * that was being paid on the metric Google ranks on, on every page.
 *
 * Found by reading a deployment record rather than by any test: the region only
 * appears in what Vercel reports back, never in this repo, which is exactly how
 * it stayed wrong from the first deploy.
 *
 * On the root layout so it covers the published site, the editor and the API
 * routes alike. All three talk to the same database, so all three want to be in
 * the same place as it.
 */
export const preferredRegion = 'lhr1';

export const metadata: Metadata = {
  title: 'Travelgenix Sites',
  description: 'The Travelgenix website builder.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-GB">
      <body>{children}</body>
    </html>
  );
}
