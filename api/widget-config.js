/**
 * Widget Config API (Hardened)
 * GET  /api/widget-config?id=WIDGET_ID  → public, returns config JSON (cached)
 * POST /api/widget-config               → AUTHENTICATED, creates/updates config
 * 
 * Security: GET is public (widgets must load without auth), POST requires valid session token.
 * All inputs sanitised before Airtable queries.
 */
import { requireAuth, sanitiseForFormula, sanitiseConfig, setCors } from './_auth.js';

const AIRTABLE_API = 'https://api.airtable.com/v0';
const TABLE_NAME = 'Widgets';

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
      const safeType = (typeof widgetType === 'string' ? widgetType : 'Pricing Table').slice(0, 50);

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

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('[widget-config]', err.message);
    return res.status(500).json({ error: 'Service temporarily unavailable' });
  }
}
