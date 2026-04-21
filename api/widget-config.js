/**
 * Widget Config API (Hardened)
 * GET  /api/widget-config?id=WIDGET_ID  → public, returns config JSON (cached)
 * POST /api/widget-config               → AUTHENTICATED, creates/updates config
 * 
 * Security: GET is public (widgets must load without auth), POST requires valid session token.
 * All inputs sanitised before Airtable queries.
 */
import { requireAuth, sanitiseForFormula, sanitiseConfig, setCors, applyRateLimit, RATE_LIMITS } from './_auth.js';

const AIRTABLE_API = 'https://api.airtable.com/v0';
const TABLE_NAME = 'Widgets';

// Allowed widget type names. Canonical casing — must match the Airtable
// singleSelect "WidgetType" option names exactly (the field is case-sensitive).
// If you add a new widget type, update THREE places:
//   1. This constant
//   2. PLAN_WIDGET_LIMITS below
//   3. The WidgetType singleSelect options in Airtable
//   4. The WIDGETS array in public/index.html
const ALLOWED_WIDGET_TYPES = [
  'Pricing Table',
  'FAQ',
  'Google Reviews',
  'Testimonials',
  'Destination Spotlight',
];

// Per-plan widget count limits, keyed by widgetType.
//   -1       = unlimited
//    0       = widget type not available on this plan
//   positive = max number of widgets of this type this plan can create
// KEEP IN SYNC with the WIDGETS array in public/index.html. If these drift,
// the dashboard will show one limit while the API enforces another.
const PLAN_WIDGET_LIMITS = {
  'Pricing Table':         { Spark: 1, Boost: 5, Ignite: -1, Bespoke: -1 },
  'FAQ':                   { Spark: 0, Boost: 3, Ignite: -1, Bespoke: -1 },
  'Google Reviews':        { Spark: 0, Boost: 3, Ignite: -1, Bespoke: -1 },
  'Testimonials':          { Spark: 0, Boost: 0, Ignite: -1, Bespoke: -1 },
  'Destination Spotlight': { Spark: 1, Boost: 3, Ignite: -1, Bespoke: -1 },
};

// Count existing widgets owned by this user, of a specific type.
// Used by the CREATE path to enforce plan limits.
async function countUserWidgetsOfType(email, widgetType, headers) {
  const emailEsc = sanitiseForFormula(email.toLowerCase());
  const typeEsc  = sanitiseForFormula(widgetType);
  const formula = encodeURIComponent(
    `AND(LOWER({ClientEmail})='${emailEsc}',{WidgetType}='${typeEsc}')`
  );
  // Only fetch WidgetID to keep the payload tiny — we just need a count.
  // maxRecords capped at 100: all current plan limits are <=5, so this
  // always captures enough to detect "over limit" without paginating.
  const url = `${AIRTABLE_API}/${AIRTABLE_BASE_ID}/${TABLE_NAME}`
    + `?filterByFormula=${formula}&maxRecords=100&fields%5B%5D=WidgetID`;
  const resp = await fetch(url, { headers });
  if (!resp.ok) throw new Error('Count query failed');
  const data = await resp.json();
  return (data.records || []).length;
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { AIRTABLE_KEY, AIRTABLE_BASE_ID } = process.env;
  if (!AIRTABLE_KEY || !AIRTABLE_BASE_ID) return res.status(500).json({ error: 'Server configuration error' });

  const headers = { 'Authorization': `Bearer ${AIRTABLE_KEY}`, 'Content-Type': 'application/json' };

  try {
    // ── GET: Public — fetch config by widget ID ─────────────
    if (req.method === 'GET') {
      const widgetId = req.query.id;
      if (!widgetId || typeof widgetId !== 'string' || widgetId.length > 100) {
        return res.status(400).json({ error: 'Invalid widget ID' });
      }

      // Sanitise before using in formula
      const safeId = sanitiseForFormula(widgetId);
      const formula = encodeURIComponent(`{WidgetID} = '${safeId}'`);
      const url = `${AIRTABLE_API}/${AIRTABLE_BASE_ID}/${TABLE_NAME}?filterByFormula=${formula}&maxRecords=1`;

      const resp = await fetch(url, { headers });
      if (!resp.ok) throw new Error(`Upstream error`);

      const data = await resp.json();
      if (!data.records || data.records.length === 0) {
        return res.status(404).json({ error: 'Widget not found' });
      }

      const configStr = data.records[0].fields.Config || '{}';
      try {
        const config = JSON.parse(configStr);
        res.setHeader('Cache-Control', 's-maxage=300, max-age=60, stale-while-revalidate=600');
        return res.status(200).json(config);
      } catch {
        return res.status(500).json({ error: 'Widget data corrupted' });
      }
    }

    // ── POST: Authenticated — create or update config ───────
    if (req.method === 'POST') {
      // Require valid session
      const auth = requireAuth(req);
      if (auth.error) return res.status(auth.status).json({ error: auth.error });
      const user = auth.user;

      // ── Rate limit (per-user, in-memory) ──────────────────
      // Catches buggy clients and opportunistic abuse. See _auth.js for
      // the cold-start caveat. GET path is not rate-limited — the CDN
      // cache (s-maxage=300) absorbs that class of abuse.
      if (!applyRateLimit(res, `save:${user.email}`, RATE_LIMITS.widgetWrite)) return;

      const { widgetId, name, config, widgetType } = req.body || {};
      if (!config || typeof config !== 'object') {
        return res.status(400).json({ error: 'Missing or invalid config' });
      }

      // Sanitise the config object
      const cleanConfig = sanitiseConfig(config);
      const configStr = JSON.stringify(cleanConfig);

      // Cap config size (prevent abuse)
      if (configStr.length > 500000) {
        return res.status(413).json({ error: 'Config too large (max 500KB)' });
      }

      const safeName = (typeof name === 'string' ? name : 'Untitled').slice(0, 200);

      // Validate widgetType against the enum if provided. Case-insensitive
      // match — we store the canonical form to match the Airtable singleSelect
      // option names exactly. If not provided here, the CREATE path below
      // will reject the request (required for new widgets).
      let safeType = null;
      if (widgetType !== undefined && widgetType !== null) {
        if (typeof widgetType !== 'string' || widgetType.length === 0 || widgetType.length > 50) {
          return res.status(400).json({ error: 'Invalid widgetType' });
        }
        const canonical = ALLOWED_WIDGET_TYPES.find(
          t => t.toLowerCase() === widgetType.toLowerCase()
        );
        if (!canonical) {
          return res.status(400).json({
            error: `Unsupported widget type. Allowed: ${ALLOWED_WIDGET_TYPES.join(', ')}`
          });
        }
        safeType = canonical;
      }

      // If widgetId provided, try to update existing (verify ownership)
      if (widgetId) {
        const safeWid = sanitiseForFormula(widgetId);
        const formula = encodeURIComponent(`{WidgetID} = '${safeWid}'`);
        const searchUrl = `${AIRTABLE_API}/${AIRTABLE_BASE_ID}/${TABLE_NAME}?filterByFormula=${formula}&maxRecords=1`;
        const searchResp = await fetch(searchUrl, { headers });
        const searchData = await searchResp.json();

        if (searchData.records && searchData.records.length > 0) {
          const record = searchData.records[0];
          
          // Verify ownership — widget must belong to this user.
          // Fail closed if the email is missing, empty, or doesn't match.
          // Prior version skipped the check entirely when widgetEmail was
          // falsy, letting any signed-in user overwrite unattributed widgets.
          const widgetEmail = (record.fields.ClientEmail || '').toLowerCase().trim();
          const userEmail = (user.email || '').toLowerCase().trim();
          if (!widgetEmail || !userEmail || widgetEmail !== userEmail) {
            return res.status(403).json({ error: 'You do not have permission to edit this widget' });
          }

          const updateUrl = `${AIRTABLE_API}/${AIRTABLE_BASE_ID}/${TABLE_NAME}/${record.id}`;
          const updateResp = await fetch(updateUrl, {
            method: 'PATCH',
            headers,
            body: JSON.stringify({
              fields: {
                Config: configStr,
                Name: safeName,
                UpdatedAt: new Date().toISOString(),
              },
            }),
          });
          if (!updateResp.ok) throw new Error('Update failed');

          return res.status(200).json({ success: true, recordId: record.id, widgetId });
        }
      }

      // ── Enforce per-plan widget count limits ──────────────────
      // Must happen only on the CREATE path — updates don't change count.

      // widgetType is required for CREATE. The earlier validation accepted
      // it as optional to support future UPDATE-only flows; here we require it.
      if (!safeType) {
        return res.status(400).json({
          error: 'widgetType is required when creating a new widget'
        });
      }

      const planLimits = PLAN_WIDGET_LIMITS[safeType];
      if (!planLimits) {
        // Should be unreachable: safeType is already validated against
        // ALLOWED_WIDGET_TYPES above. If we hit this, the two constants have
        // drifted — a dev sync error, not user error.
        console.error('[widget-config] Widget type missing from PLAN_WIDGET_LIMITS:', safeType);
        return res.status(500).json({ error: 'Widget configuration error. Contact support.' });
      }
      const planLimit = planLimits[user.plan];
      if (planLimit === undefined) {
        console.error('[widget-config] Unknown plan for limit check:', user.plan);
        return res.status(403).json({ error: 'Your plan does not support widget creation. Contact support.' });
      }
      if (planLimit === 0) {
        return res.status(403).json({
          error: `The ${safeType} widget is not included in your plan. Please upgrade to use this widget.`
        });
      }
      if (planLimit > 0) {
        let existingCount;
        try {
          existingCount = await countUserWidgetsOfType(user.email, safeType, headers);
        } catch (err) {
          console.error('[widget-config] Count query failed:', err.message);
          return res.status(503).json({ error: 'Service temporarily unavailable. Please try again.' });
        }
        if (existingCount >= planLimit) {
          return res.status(403).json({
            error: `You've reached your plan's limit of ${planLimit} ${safeType} widget${planLimit === 1 ? '' : 's'}. Upgrade to create more.`
          });
        }
      }
      // planLimit === -1 means unlimited — fall through to create.

      // Create new record (tagged to authenticated user)
      // Always generate the widgetId server-side for new records.
      // A client-provided widgetId is only honoured on the UPDATE path above
      // (where ownership has been verified). Falling through to here means the
      // search either found no match or no widgetId was supplied — in either
      // case we mint a fresh ID to prevent squatting on predictable/reserved
      // IDs and collisions with future auto-generated ones.
      const newWidgetId = `tgw_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const createUrl = `${AIRTABLE_API}/${AIRTABLE_BASE_ID}/${TABLE_NAME}`;
      const createResp = await fetch(createUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          records: [{
            fields: {
              WidgetID: newWidgetId,
              Name: safeName,
              Config: configStr,
              Status: 'Active',
              WidgetType: safeType,
              ClientName: user.clientName || '',
              ClientEmail: user.email,
              CreatedAt: new Date().toISOString(),
              UpdatedAt: new Date().toISOString(),
            },
          }],
        }),
      });
      if (!createResp.ok) throw new Error('Create failed');
      const created = await createResp.json();

      return res.status(201).json({
        success: true,
        recordId: created.records[0].id,
        widgetId: newWidgetId,
      });
    }

    // ── DELETE: Authenticated — remove a widget ─────────────
    if (req.method === 'DELETE') {
      // Require valid session
      const auth = requireAuth(req);
      if (auth.error) return res.status(auth.status).json({ error: auth.error });
      const user = auth.user;

      // Rate limit (per-user, same preset as POST writes)
      if (!applyRateLimit(res, `delete:${user.email}`, RATE_LIMITS.widgetWrite)) return;

      // Parse widgetId from query string (DELETE convention)
      const widgetId = req.query.id;
      if (!widgetId || typeof widgetId !== 'string' || widgetId.length > 100) {
        return res.status(400).json({ error: 'Invalid or missing widget ID' });
      }

      // Look up the record
      const safeWid = sanitiseForFormula(widgetId);
      const formula = encodeURIComponent(`{WidgetID} = '${safeWid}'`);
      const searchUrl = `${AIRTABLE_API}/${AIRTABLE_BASE_ID}/${TABLE_NAME}?filterByFormula=${formula}&maxRecords=1`;
      const searchResp = await fetch(searchUrl, { headers });
      if (!searchResp.ok) throw new Error('Lookup failed');
      const searchData = await searchResp.json();

      if (!searchData.records || searchData.records.length === 0) {
        // Idempotent: treat "already gone" as success so retries are safe
        return res.status(200).json({ success: true, alreadyGone: true });
      }

      const record = searchData.records[0];

      // Verify ownership — fail closed if email is missing or doesn't match.
      // Same pattern as the UPDATE path; prevents cross-account deletes.
      const widgetEmail = (record.fields.ClientEmail || '').toLowerCase().trim();
      const userEmail = (user.email || '').toLowerCase().trim();
      if (!widgetEmail || !userEmail || widgetEmail !== userEmail) {
        return res.status(403).json({ error: 'You do not have permission to delete this widget' });
      }

      // Delete from Airtable
      const deleteUrl = `${AIRTABLE_API}/${AIRTABLE_BASE_ID}/${TABLE_NAME}/${record.id}`;
      const deleteResp = await fetch(deleteUrl, { method: 'DELETE', headers });
      if (!deleteResp.ok) throw new Error('Delete failed');

      return res.status(200).json({ success: true, widgetId, recordId: record.id });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('[widget-config]', err.message);
    return res.status(500).json({ error: 'Service temporarily unavailable' });
  }
}
