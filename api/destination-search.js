/**
 * Destination Search API (Hardened)
 * GET /api/destination-search?q=QUERY  → AUTHENTICATED, returns matching destinations
 *
 * Used by the Spotlight editor's destination picker. Queries all three tables
 * (Countries, Cities and Regions, Resorts and Areas) via filterByFormula, ranked
 * so an exact prefix match wins over a contains match.
 *
 * Security:
 *   - Auth required (Bearer session token from /api/widget-auth) — no anonymous
 *     enumeration of the destination database
 *   - Rate-limited per user
 *   - Input sanitised before interpolation into filter formula
 *   - PAT is server-only; client never sees any Airtable credentials
 *   - Max 20 results per table, capped
 *
 * Response:
 *   {
 *     results: [
 *       { level: 'country'|'city'|'resort', recordId: 'rec...', name: '...', country?: '...' }
 *     ]
 *   }
 */

import { requireAuth, sanitiseForFormula, setCors, applyRateLimit, RATE_LIMITS } from './_auth.js';

const AIRTABLE_API = 'https://api.airtable.com/v0';
const DESTINATION_BASE_ID = 'appuZdlMJ7HKUt6qS';

const LEVELS = [
  { key: 'country', tableId: 'tblsxbqbyhTDoWhbo', nameFieldId: 'flddJJrpwcXOwWIow' },
  { key: 'city',    tableId: 'tblTkKujdVZgWPAQe', nameFieldId: 'fld2VkY61c1JKUWKB' },
  { key: 'resort',  tableId: 'tblwV9gnbVEyZ99gI', nameFieldId: 'fldnvOipaWpG3W1rx' },
];

const MAX_PER_LEVEL = 20;

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  // Auth required — this endpoint exposes the destination catalogue
  const auth = requireAuth(req);
  if (auth.error) return res.status(auth.status).json({ error: auth.error });
  const user = auth.user;

  if (!applyRateLimit(res, `destsearch:${user.email}`, RATE_LIMITS.widgetRead)) return;

  const { AIRTABLE_DESTINATION_CONTENT_PAT } = process.env;
  if (!AIRTABLE_DESTINATION_CONTENT_PAT) {
    return res.status(500).json({ error: 'Server configuration error' });
  }

  const raw = typeof req.query.q === 'string' ? req.query.q : '';
  const levelFilter = typeof req.query.level === 'string' ? req.query.level : '';
  const q = raw.trim().slice(0, 100);
  if (q.length < 1) return res.status(200).json({ results: [] });

  // LOWER() on both sides, then either exact-prefix (rank 0) or contains (rank 1)
  const safeQ = sanitiseForFormula(q.toLowerCase());
  const formula = `OR(FIND('${safeQ}',LOWER({Name})) > 0)`;
  // Note: filterByFormula refers to fields by name. Each level's primary
  // field is named differently (Country / City+Region / Resort+Area), so we
  // reference the primary field via NAME — every record has its primary
  // field populated and Airtable's {Name} reference works when the primary
  // field is the only relevant one. To be safe across all three tables we
  // build the formula per-level below.
  const activeLevels = levelFilter && LEVELS.find(l => l.key === levelFilter)
    ? [LEVELS.find(l => l.key === levelFilter)]
    : LEVELS;

  try {
    const all = [];
    await Promise.all(activeLevels.map(async (lvl) => {
      // Use the field-name reference via filterByFormula — the level-specific
      // primary field names are Country / City/Region / Resort/Area, but we
      // fetch by field ID in the response. For the formula we use a FIND
      // against the primary field by name via the generic "search" approach
      // Airtable permits: SEARCH(LOWER('x'), LOWER({<primary>})).
      //
      // Since we don't know the name at build-time reliably, we instead use
      // a per-level primary field name. For this repo we know them:
      const primaryFieldName = lvl.key === 'country' ? 'Country'
        : lvl.key === 'city' ? 'City/Region' : 'Resort/Area';

      const f = encodeURIComponent(
        `FIND('${safeQ}', LOWER({${primaryFieldName}})) > 0`
      );
      const qs = new URLSearchParams();
      qs.append('filterByFormula', decodeURIComponent(f));
      qs.append('maxRecords', String(MAX_PER_LEVEL));
      qs.append('fields[]', lvl.nameFieldId);
      qs.append('returnFieldsByFieldId', 'true');

      const url = `${AIRTABLE_API}/${DESTINATION_BASE_ID}/${lvl.tableId}?${qs.toString()}`;
      const resp = await fetch(url, {
        headers: { 'Authorization': `Bearer ${AIRTABLE_DESTINATION_CONTENT_PAT}` },
      });
      if (!resp.ok) return; // degrade silently per-level

      const data = await resp.json();
      (data.records || []).forEach(r => {
        const name = r.fields?.[lvl.nameFieldId];
        if (typeof name === 'string' && name.length) {
          all.push({
            level: lvl.key,
            recordId: r.id,
            name: name.slice(0, 120),
          });
        }
      });
    }));

    // Rank: exact match > starts-with > contains > other (alphabetical tiebreak)
    const qLower = q.toLowerCase();
    function rank(item) {
      const n = item.name.toLowerCase();
      if (n === qLower) return 0;
      if (n.startsWith(qLower)) return 1;
      if (n.includes(qLower)) return 2;
      return 3;
    }
    all.sort((a, b) => {
      const ra = rank(a), rb = rank(b);
      if (ra !== rb) return ra - rb;
      // Countries first, then cities, then resorts, when tied
      const levelOrder = { country: 0, city: 1, resort: 2 };
      if (levelOrder[a.level] !== levelOrder[b.level]) return levelOrder[a.level] - levelOrder[b.level];
      return a.name.localeCompare(b.name);
    });

    const results = all.slice(0, 40);

    res.setHeader('Cache-Control', 'private, max-age=60');
    return res.status(200).json({ results });

  } catch (err) {
    console.error('[destination-search] error:', err?.message || err);
    return res.status(502).json({ error: 'Upstream unavailable' });
  }
}
