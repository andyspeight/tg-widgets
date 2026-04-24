// =============================================================================
//  /api/destinations/search.js
// =============================================================================
//
//  Autocomplete endpoint for the Destination field in enquiry forms.
//
//  Queries three Airtable tables in the Destination Content base and returns
//  grouped, matched results:
//    - Countries (e.g. "Greece")
//    - Cities and Regions (e.g. "Crete", "Athens")
//    - Resorts and Areas (e.g. "Hersonissos")
//
//  Why this endpoint instead of querying Airtable from the widget directly:
//    1. The PAT has read access by design but exposing it on every client
//       page is a surface we don't need. Server-side keeps it private.
//    2. We can cache + rate limit per visitor to avoid hammering Airtable.
//    3. We can post-process results (dedupe, merge, rank) and shape the
//       payload exactly for the widget without coupling the widget to
//       Airtable field IDs.
//    4. Future-proofs for Luna Brain destination search — same widget, same
//       endpoint, smarter source swapped in server-side.
//
//  GET /api/destinations/search?q=<text>&limit=<n>
//    - q:      free-text query (1–80 chars). Empty returns empty results.
//    - limit:  max results per group, default 8, max 20.
//
//  Response:
//    {
//      query: "cret",
//      groups: [
//        { type: "country", label: "Countries", results: [ {...} ] },
//        { type: "city",    label: "Cities & regions", results: [ {...} ] },
//        { type: "resort",  label: "Resorts & areas",  results: [ {...} ] }
//      ]
//    }
//
//  Each result shape:
//    {
//      id: "recXXX",            // Airtable record ID — stable across submissions
//      name: "Hersonissos",     // Primary display name
//      type: "resort",          // 'country' | 'city' | 'resort'
//      parentCity: "Crete",     // resorts only
//      parentCountry: "Greece", // cities + resorts (derived from the link chain)
//    }
//
//  Caching: public cache for 5 minutes. These fields change infrequently.
//
// =============================================================================

const AIRTABLE_API  = 'https://api.airtable.com/v0';
const BASE_ID       = 'appuZdlMJ7HKUt6qS';
const PAT           = process.env.AIRTABLE_DESTINATION_CONTENT_PAT;

// Table + field IDs. Keep in sync with the Destination Content base schema.
const TABLES = {
  countries: {
    id: 'tblsxbqbyhTDoWhbo',
    fields: {
      name:      'flddJJrpwcXOwWIow',
      continent: 'fldeVnkZXLiy8qCcl',
    },
  },
  cities: {
    id: 'tblTkKujdVZgWPAQe',
    fields: {
      name:    'fld2VkY61c1JKUWKB',
      country: 'fldmJaOJZcMFtJNZD', // linked record (array of recIds)
    },
  },
  resorts: {
    id: 'tblwV9gnbVEyZ99gI',
    fields: {
      name: 'fldnvOipaWpG3W1rx',
      city: 'fldrUx3VrEMJPheIP',   // linked record (array of recIds)
    },
  },
};

const DEFAULT_LIMIT = 8;
const MAX_LIMIT = 20;
const MAX_QUERY_LEN = 80;

// Simple in-memory cache keyed by lowercased query. Each function invocation
// has its own module scope on Vercel — cold starts clear it — but warm
// invocations will hit the cache and skip Airtable entirely for ~5 min.
const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map();

// Common CORS / response helpers ---------------------------------------------

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('X-Content-Type-Options', 'nosniff');
}

// Escape a value so it can be safely embedded inside an Airtable filterByFormula
// single-quoted string. Airtable doesn't do full SQL-style injection but
// unescaped apostrophes will break formula syntax and can be used to pivot
// the query (e.g. "' OR 1=1" would become literal in the formula — safe —
// but still better to be strict).
function escapeForFormula(str) {
  return String(str).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

// Fetch the first page of a table filtered by a SEARCH() against the name
// field, lowercased on both sides so matching is case-insensitive.
async function searchTable(table, nameFieldId, query, limit) {
  // SEARCH(find, within) returns the 1-based index or BLANK if not found.
  // We want records where the query appears anywhere in the name.
  const formula = `SEARCH(LOWER('${escapeForFormula(query)}'), LOWER({${nameFieldId}}))`;
  const url = new URL(`${AIRTABLE_API}/${BASE_ID}/${table}`);
  url.searchParams.set('filterByFormula', formula);
  url.searchParams.set('pageSize', String(limit));
  url.searchParams.set('returnFieldsByFieldId', 'true');
  // Sort shortest-name-first so a query for "crete" returns "Crete" before
  // "Eastern Crete Villages" or similar. Approximates relevance ranking.
  url.searchParams.set('sort[0][field]', nameFieldId);
  url.searchParams.set('sort[0][direction]', 'asc');

  const resp = await fetch(url, {
    headers: { Authorization: `Bearer ${PAT}` },
  });
  if (!resp.ok) {
    const body = await resp.text();
    console.error('[destinations/search] Airtable error', table, resp.status, body.slice(0, 200));
    throw new Error('Airtable request failed');
  }
  const data = await resp.json();
  return data.records || [];
}

// Fetch a batch of records by ID. Used to resolve linked-record IDs (e.g. the
// Cities.country field gives us recIds; we need their names for the parent
// label). Airtable doesn't have a batch-get endpoint, but we can use
// filterByFormula with OR() over RECORD_ID() to fetch many in one call.
async function fetchRecordsByIds(tableId, recordIds, nameFieldId) {
  if (!recordIds || recordIds.length === 0) return {};
  // Dedupe
  const unique = Array.from(new Set(recordIds));
  // Airtable URL length limit ~16KB — 50 IDs is safe with room to spare
  const batches = [];
  for (let i = 0; i < unique.length; i += 50) {
    batches.push(unique.slice(i, i + 50));
  }

  const resultsById = {};
  await Promise.all(batches.map(async (batch) => {
    const ors = batch.map(id => `RECORD_ID()='${escapeForFormula(id)}'`).join(',');
    const formula = batch.length === 1 ? ors : `OR(${ors})`;
    const url = new URL(`${AIRTABLE_API}/${BASE_ID}/${tableId}`);
    url.searchParams.set('filterByFormula', formula);
    url.searchParams.set('pageSize', String(batch.length));
    url.searchParams.set('returnFieldsByFieldId', 'true');
    const resp = await fetch(url, {
      headers: { Authorization: `Bearer ${PAT}` },
    });
    if (!resp.ok) {
      console.warn('[destinations/search] parent lookup failed', tableId, resp.status);
      return;
    }
    const data = await resp.json();
    (data.records || []).forEach(rec => {
      resultsById[rec.id] = rec.fields[nameFieldId] || '';
    });
  }));
  return resultsById;
}

// Handler --------------------------------------------------------------------

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  if (!PAT) {
    console.error('[destinations/search] AIRTABLE_DESTINATION_CONTENT_PAT missing');
    return res.status(500).json({ error: 'server_misconfigured' });
  }

  // Query normalisation. Trim, collapse whitespace, cap length, lowercase.
  const rawQuery = typeof req.query.q === 'string' ? req.query.q : '';
  const query = rawQuery.trim().replace(/\s+/g, ' ').slice(0, MAX_QUERY_LEN);
  if (query.length === 0) {
    // Empty query — return empty groups. Widget should show a "start typing"
    // placeholder rather than popular destinations for now; we can seed with
    // defaults later if Andy wants.
    return res.status(200).json({ query: '', groups: [] });
  }
  // Short queries (1 char) can match thousands of records — require 2+ chars
  // to avoid a flood.
  if (query.length < 2) {
    return res.status(200).json({ query, groups: [] });
  }

  const limit = Math.min(
    Math.max(parseInt(req.query.limit, 10) || DEFAULT_LIMIT, 1),
    MAX_LIMIT
  );

  // Cache check
  const cacheKey = `${query.toLowerCase()}:${limit}`;
  const cached = cache.get(cacheKey);
  if (cached && (Date.now() - cached.t) < CACHE_TTL_MS) {
    res.setHeader('Cache-Control', 'public, max-age=300, stale-while-revalidate=60');
    return res.status(200).json(cached.body);
  }

  try {
    // Fire all three table searches in parallel
    const [countries, cities, resorts] = await Promise.all([
      searchTable(TABLES.countries.id, TABLES.countries.fields.name, query, limit),
      searchTable(TABLES.cities.id,    TABLES.cities.fields.name,    query, limit),
      searchTable(TABLES.resorts.id,   TABLES.resorts.fields.name,   query, limit),
    ]);

    // Resolve parent names — we need country names for cities, and city
    // names for resorts. Also city → country two-hop for resorts so we can
    // label them "Hersonissos, Crete, Greece".
    const cityCountryIds = [];
    cities.forEach(rec => {
      const link = rec.fields[TABLES.cities.fields.country];
      if (Array.isArray(link)) cityCountryIds.push(...link);
    });

    const resortCityIds = [];
    resorts.forEach(rec => {
      const link = rec.fields[TABLES.resorts.fields.city];
      if (Array.isArray(link)) resortCityIds.push(...link);
    });

    // Parallel parent resolution
    const [countryNames, parentCities] = await Promise.all([
      fetchRecordsByIds(TABLES.countries.id, cityCountryIds, TABLES.countries.fields.name),
      fetchRecordsByIds(TABLES.cities.id, resortCityIds, TABLES.cities.fields.name),
    ]);

    // Second hop for resorts: the parent cities we just fetched need their
    // own country lookup. We already have the country names dict from the
    // first hop, but we need to know which city → which country.
    // Fetch the parent city records fully (with country link) this time.
    const parentCityCountryIds = [];
    if (resortCityIds.length > 0) {
      // Fetch parent cities again but include the country link field
      const parentCityFull = await fetchCityCountryLinks(resortCityIds);
      // Build city -> country recId map
      Object.entries(parentCityFull).forEach(([cityRecId, countryIds]) => {
        if (Array.isArray(countryIds)) parentCityCountryIds.push(...countryIds);
      });
      // And fetch any country names we don't already have
      const missing = parentCityCountryIds.filter(id => !(id in countryNames));
      if (missing.length > 0) {
        const more = await fetchRecordsByIds(TABLES.countries.id, missing, TABLES.countries.fields.name);
        Object.assign(countryNames, more);
      }
      // Build a flat city → country-name dict for resort lookup
      const resortCityToCountry = {};
      Object.entries(parentCityFull).forEach(([cityRecId, countryIds]) => {
        if (Array.isArray(countryIds) && countryIds[0]) {
          resortCityToCountry[cityRecId] = countryNames[countryIds[0]] || null;
        }
      });

      // Shape final response ---------------------------------------------
      const countryResults = countries.map(rec => ({
        id:    rec.id,
        name:  rec.fields[TABLES.countries.fields.name] || '',
        type:  'country',
      })).filter(r => r.name);

      const cityResults = cities.map(rec => {
        const countryLink = rec.fields[TABLES.cities.fields.country];
        const countryRecId = Array.isArray(countryLink) && countryLink[0];
        return {
          id:   rec.id,
          name: rec.fields[TABLES.cities.fields.name] || '',
          type: 'city',
          parentCountry: countryRecId ? (countryNames[countryRecId] || null) : null,
        };
      }).filter(r => r.name);

      const resortResults = resorts.map(rec => {
        const cityLink = rec.fields[TABLES.resorts.fields.city];
        const cityRecId = Array.isArray(cityLink) && cityLink[0];
        return {
          id:   rec.id,
          name: rec.fields[TABLES.resorts.fields.name] || '',
          type: 'resort',
          parentCity:    cityRecId ? (parentCities[cityRecId] || null) : null,
          parentCountry: cityRecId ? (resortCityToCountry[cityRecId] || null) : null,
        };
      }).filter(r => r.name);

      const body = {
        query,
        groups: [
          { type: 'country', label: 'Countries',        results: countryResults },
          { type: 'city',    label: 'Cities & regions', results: cityResults },
          { type: 'resort',  label: 'Resorts & areas',  results: resortResults },
        ].filter(g => g.results.length > 0),
      };

      cache.set(cacheKey, { t: Date.now(), body });
      res.setHeader('Cache-Control', 'public, max-age=300, stale-while-revalidate=60');
      return res.status(200).json(body);
    }

    // No resorts matched — skip the two-hop and build the smaller response
    const countryResults = countries.map(rec => ({
      id:    rec.id,
      name:  rec.fields[TABLES.countries.fields.name] || '',
      type:  'country',
    })).filter(r => r.name);

    const cityResults = cities.map(rec => {
      const countryLink = rec.fields[TABLES.cities.fields.country];
      const countryRecId = Array.isArray(countryLink) && countryLink[0];
      return {
        id:   rec.id,
        name: rec.fields[TABLES.cities.fields.name] || '',
        type: 'city',
        parentCountry: countryRecId ? (countryNames[countryRecId] || null) : null,
      };
    }).filter(r => r.name);

    const body = {
      query,
      groups: [
        { type: 'country', label: 'Countries',        results: countryResults },
        { type: 'city',    label: 'Cities & regions', results: cityResults },
      ].filter(g => g.results.length > 0),
    };

    cache.set(cacheKey, { t: Date.now(), body });
    res.setHeader('Cache-Control', 'public, max-age=300, stale-while-revalidate=60');
    return res.status(200).json(body);

  } catch (err) {
    console.error('[destinations/search] unhandled', err);
    return res.status(500).json({ error: 'search_failed' });
  }
}

// Helper: fetch each parent-city record and return a map of cityRecId → array
// of country recIds that city links to. Only called when resorts are in the
// result set. We fetch the city records again here because the initial city
// search only returned cities that matched the query — parent cities of
// matched resorts may not match, so we fetch them explicitly.
async function fetchCityCountryLinks(cityRecordIds) {
  if (!cityRecordIds || cityRecordIds.length === 0) return {};
  const unique = Array.from(new Set(cityRecordIds));
  const batches = [];
  for (let i = 0; i < unique.length; i += 50) {
    batches.push(unique.slice(i, i + 50));
  }
  const result = {};
  await Promise.all(batches.map(async (batch) => {
    const ors = batch.map(id => `RECORD_ID()='${escapeForFormula(id)}'`).join(',');
    const formula = batch.length === 1 ? ors : `OR(${ors})`;
    const url = new URL(`${AIRTABLE_API}/${BASE_ID}/${TABLES.cities.id}`);
    url.searchParams.set('filterByFormula', formula);
    url.searchParams.set('pageSize', String(batch.length));
    url.searchParams.set('returnFieldsByFieldId', 'true');
    const resp = await fetch(url, {
      headers: { Authorization: `Bearer ${PAT}` },
    });
    if (!resp.ok) {
      console.warn('[destinations/search] city link fetch failed', resp.status);
      return;
    }
    const data = await resp.json();
    (data.records || []).forEach(rec => {
      result[rec.id] = rec.fields[TABLES.cities.fields.country] || [];
    });
  }));
  return result;
}
