import type { MetadataRoute } from 'next';

/**
 * Nothing in this shell should ever be indexed.
 *
 * It is a work in progress on a throwaway hostname, and a half-built CMS
 * demo turning up in a search for Travelgenix would be a bad look. Per-page
 * robots metadata replaces this once real tenant pages exist, at which point
 * this file becomes a per-tenant sitemap and robots pair.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: '*', disallow: '/' }],
  };
}
