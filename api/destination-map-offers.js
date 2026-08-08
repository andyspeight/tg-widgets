/**
 * Public widget endpoint — World Map offers.
 *
 * Returns the aggregated offers payload that the cron job writes to Redis.
 * Falls through three tiers to guarantee the widget NEVER receives an empty
 * map under any failure mode:
 *
 *   1. Redis cache (the normal path, sub-50ms)
 *   2. Bundled seed payload committed in /public/seed-map-offers.json
 *   3. Last-resort hardcoded skeleton (a handful of major destinations)
 *
 * Caching: Cache-Control headers tell Vercel's edge to cache the response
 * for 5 minutes with stale-while-revalidate, so even Redis can take a break.
 *
 * CORS: open. This is read-only public data, no secrets.
 */

import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getJson } from './_redis.js';

const REDIS_KEY = 'map:offers:v1';
// Hotels mode (?mode=hotels) reads the parallel accommodation summary the cron
// builds. Hotels have no seed/skeleton fallback (those are package-specific),
// so an empty hotel cache returns the calm empty state, never a live search.
const HOTELS_KEY = 'map:hotels:v1';

// Resolve the seed path relative to this file (avoids cwd surprises on Vercel).
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SEED_PATH = path.join(__dirname, '..', 'public', 'seed-map-offers.json');

let cachedSeed = null;
function loadSeed() {
  if (cachedSeed) return cachedSeed;
  try {
    const raw = fs.readFileSync(SEED_PATH, 'utf8');
    cachedSeed = JSON.parse(raw);
    return cachedSeed;
  } catch (e) {
    console.error('[map-offers] seed load failed', e.message);
    return null;
  }
}

const SKELETON = {
  version: 1,
  generatedAt: '1970-01-01T00:00:00Z',
  origin: 'LGW',
  source: 'skeleton',
  destinations: [
    { destination: 'Tenerife', country: 'Spain', region: 'Europe', lat: 28.27, lng: -16.61, fromPrice: 380, currency: 'GBP', offerCount: 0, offerType: 'Packages' },
    { destination: 'Palma',    country: 'Spain', region: 'Europe', lat: 39.57, lng: 2.65,  fromPrice: 320, currency: 'GBP', offerCount: 0, offerType: 'Packages' },
    { destination: 'Faro',     country: 'Portugal', region: 'Europe', lat: 37.02, lng: -7.93, fromPrice: 290, currency: 'GBP', offerCount: 0, offerType: 'Packages' },
    { destination: 'Heraklion', country: 'Greece', region: 'Europe', lat: 35.34, lng: 25.15, fromPrice: 410, currency: 'GBP', offerCount: 0, offerType: 'Packages' },
    { destination: 'Dalaman',  country: 'Turkey', region: 'Europe', lat: 36.71, lng: 28.79, fromPrice: 350, currency: 'GBP', offerCount: 0, offerType: 'Packages' },
    { destination: 'Cancun',   country: 'Mexico', region: 'Americas', lat: 21.04, lng: -86.87, fromPrice: 890, currency: 'GBP', offerCount: 0, offerType: 'Packages' },
    { destination: 'Dubai',    country: 'UAE',    region: 'Middle East', lat: 25.25, lng: 55.36, fromPrice: 620, currency: 'GBP', offerCount: 0, offerType: 'Packages' },
    { destination: 'Bangkok',  country: 'Thailand', region: 'Asia', lat: 13.69, lng: 100.75, fromPrice: 780, currency: 'GBP', offerCount: 0, offerType: 'Packages' },
  ],
  countries: [
    { country: 'Spain', region: 'Europe', lat: 40.0, lng: -3.7, fromPrice: 320, currency: 'GBP', destinationCount: 2, totalOffers: 0 },
    { country: 'Portugal', region: 'Europe', lat: 39.4, lng: -8.2, fromPrice: 290, currency: 'GBP', destinationCount: 1, totalOffers: 0 },
    { country: 'Greece', region: 'Europe', lat: 39.0, lng: 22.0, fromPrice: 410, currency: 'GBP', destinationCount: 1, totalOffers: 0 },
    { country: 'Turkey', region: 'Europe', lat: 39.0, lng: 35.0, fromPrice: 350, currency: 'GBP', destinationCount: 1, totalOffers: 0 },
    { country: 'Mexico', region: 'Americas', lat: 23.6, lng: -102.5, fromPrice: 890, currency: 'GBP', destinationCount: 1, totalOffers: 0 },
    { country: 'UAE', region: 'Middle East', lat: 24.0, lng: 54.0, fromPrice: 620, currency: 'GBP', destinationCount: 1, totalOffers: 0 },
    { country: 'Thailand', region: 'Asia', lat: 15.9, lng: 100.99, fromPrice: 780, currency: 'GBP', destinationCount: 1, totalOffers: 0 },
  ],
  stats: { source: 'skeleton', destinationsCovered: 8, countriesCovered: 7 },
};

export default async function handler(req, res) {
  // CORS — public read-only data
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'GET') { res.status(405).json({ error: 'method not allowed' }); return; }

  const hotels = String((req.query && req.query.mode) || '') === 'hotels';

  // Tier 1: Redis
  try {
    const fromRedis = await getJson(hotels ? HOTELS_KEY : REDIS_KEY);
    // New country-sweep shape writes `countries` (+ `airports`); the legacy
    // shape used `destinations`. Accept either so a payload in either form is served.
    const hasNewShape = fromRedis && Array.isArray(fromRedis.countries) && fromRedis.countries.length > 0;
    const hasOldShape = fromRedis && Array.isArray(fromRedis.destinations) && fromRedis.destinations.length > 0;
    if (hasNewShape || hasOldShape) {
      fromRedis.source = 'redis';
      // Cache ONLY real data, and only briefly. Critically, we must NOT set a
      // long edge cache on fallback responses (seed/skeleton) — doing so caused
      // a stale empty map to stick in Vercel's edge for up to an hour even after
      // Redis was populated. So the cache header lives here, on the success path.
      res.setHeader('Cache-Control', 'public, s-maxage=120, stale-while-revalidate=300');
      res.status(200).json(fromRedis);
      return;
    }
  } catch (e) {
    console.error('[map-offers] redis read failed', e.message);
  }

  // Fallbacks below must NEVER be edge-cached — otherwise an empty map can
  // stick around after Redis fills. Tell the edge not to store them.
  res.setHeader('Cache-Control', 'no-store, must-revalidate');

  // Hotels mode has no package seed/skeleton to fall back to — return the calm
  // empty state (the widget shows its empty message), never a live search.
  if (hotels) {
    res.status(200).json({ version: 1, generatedAt: '1970-01-01T00:00:00Z', source: 'empty', currency: 'GBP', countries: [], airports: [], stats: { totalOffers: 0, countriesCovered: 0, airportsCovered: 0 } });
    return;
  }

  // Tier 2: bundled seed
  const seed = loadSeed();
  if (seed && Array.isArray(seed.destinations) && seed.destinations.length > 0) {
    seed.source = 'seed';
    res.status(200).json(seed);
    return;
  }

  // Tier 3: skeleton — guaranteed non-empty
  res.status(200).json(SKELETON);
}
