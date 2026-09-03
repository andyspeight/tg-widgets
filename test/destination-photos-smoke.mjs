/**
 * /api/admin/destination-photos (3 Sep 2026): the hero photo fill for
 * resorts and cities without one. Checks the pure parts: the search query per
 * level, the Images + Attributions cell shape (which must match the records
 * the countries were filled with), and the guard rails around the handler.
 *
 * Run: node test/destination-photos-smoke.mjs   (also: npm run test:destination-photos)
 */
import { readFileSync } from 'node:fs';
import { buildQuery, photosToCells, LEVELS } from '../api/admin/destination-photos.js';

let passed = 0, failed = 0;
const ok = (c, label) => { if (c) { passed++; } else { failed++; console.error('  FAIL:', label); } };

// ── queries ────────────────────────────────────────────────────────────────
ok(buildQuery('Ölüdeniz', 'Fethiye and the Turquoise Coast', 'resort') === 'Ölüdeniz Fethiye and the Turquoise Coast holiday beach resort', 'resort query: name, parent, hint');
ok(buildQuery('Marrakech', 'Morocco', 'city') === 'Marrakech Morocco travel', 'city query: name, country, hint');
ok(buildQuery('Greece', '', 'country') === 'Greece travel landscape', 'country query has no parent');
ok(buildQuery('  Nassau  ', undefined, 'resort') === 'Nassau holiday beach resort', 'whitespace and a missing parent are tolerated');

// ── cells ──────────────────────────────────────────────────────────────────
const results = [
  { urls: { raw: 'https://images.unsplash.com/photo-1?ixid=abc&ixlib=rb-4.1.0' }, user: { name: 'Max Bvp' }, links: { html: 'https://unsplash.com/photos/one', download_location: 'https://api.unsplash.com/photos/one/download' } },
  { urls: { raw: 'https://evil.example.com/photo-2' }, user: { name: 'Nope' }, links: { html: 'https://example.com' } },
  { urls: { raw: 'https://images.unsplash.com/photo-3?ixid=def' }, user: {}, links: {} },
  { urls: { raw: 'https://images.unsplash.com/photo-4?ixid=ghi' }, user: { name: 'Four' }, links: { html: 'https://unsplash.com/photos/four' } },
  { urls: { raw: 'https://images.unsplash.com/photo-5?ixid=jkl' }, user: { name: 'Five' }, links: { html: 'https://unsplash.com/photos/five' } },
];
const cells = photosToCells(results);
ok(cells.urls.length === 3, 'at most three photos per record');
ok(cells.urls[0] === 'https://images.unsplash.com/photo-1?ixid=abc&ixlib=rb-4.1.0&w=1200&fit=crop&q=80', 'raw url gets the same sizing params as the existing records');
ok(!cells.urls.some(u => u.includes('evil.example.com')), 'only images.unsplash.com urls are accepted');
ok(cells.credits[0] === 'Photo by Max Bvp on Unsplash (https://unsplash.com/photos/one)', 'credit line matches the existing convention');
ok(cells.credits[1] === 'Photo by Unsplash on Unsplash (https://unsplash.com)', 'a photo with no user still gets a credit line');
ok(cells.downloads.length === 1 && cells.downloads[0].endsWith('/download'), 'download_location collected for the guideline ping');
ok(photosToCells(null).urls.length === 0 && photosToCells([]).credits.length === 0, 'no results, no cells');

// ── levels and guard rails ─────────────────────────────────────────────────
ok(LEVELS.resort.images === 'fldBMns5p5ChZCriU' && LEVELS.city.images === 'fldt3898YIanGbfzc' && LEVELS.country.images === 'fldTqpNZX5n1219mh', 'image field ids match api/destination-content.js');
const src = readFileSync(new URL('../api/admin/destination-photos.js', import.meta.url), 'utf8');
ok(/requireAdmin\(req\)/.test(src) && /setAdminCors\(req, res\)/.test(src), 'handler is admin-gated with same-origin CORS');
ok(/filter\(r => !r\.hasImage && r\.name\)/.test(src), 'only records with an empty images field are candidates');
ok(/UNSPLASH_ACCESS_KEY is not set/.test(src), 'refuses to fill without the Unsplash key');
ok(/MAX_BATCH = 25/.test(src) && /maxDuration: 60/.test(src), 'batches are capped and the function has a duration budget');
ok(/rate limit/.test(src) && /break;/.test(src), 'an Unsplash rate limit stops the batch');
const vercel = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
ok(vercel.rewrites.some(r => r.source === '/admin/destination-photos'), 'the admin page has a clean-url rewrite');
ok(vercel.functions['api/admin/destination-photos.js'] && vercel.functions['api/admin/destination-photos.js'].maxDuration === 60, 'vercel.json carries the function duration');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
