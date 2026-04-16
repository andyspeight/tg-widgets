/**
 * Widget Config API
 * GET  /api/widget-config?id=WIDGET_ID  → returns config JSON
 * POST /api/widget-config               → creates/updates config, returns record ID
 * 
 * Env vars required:
 *   AIRTABLE_KEY     — Airtable personal access token
 *   AIRTABLE_BASE_ID — Base ID for widget configs
 */

const AIRTABLE_API = 'https://api.airtable.com/v0';
const TABLE_NAME = 'Widgets';

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { AIRTABLE_KEY, AIRTABLE_BASE_ID } = process.env;

  if (!AIRTABLE_KEY || !AIRTABLE_BASE_ID) {
    return res.status(500).json({ error: 'Server configuration missing' });
  }

  const headers = {
    'Authorization': `Bearer ${AIRTABLE_KEY}`,
    'Content-Type': 'application/json',
  };

  try {
    // ── GET: Fetch config by widget ID ──────────────────────────
    if (req.method === 'GET') {
      const widgetId = req.query.id;
      if (!widgetId) return res.status(400).json({ error: 'Missing widget ID' });

      // Search by WidgetID field
      const formula = encodeURIComponent(`{WidgetID} = '${widgetId}'`);
      const url = `${AIRTABLE_API}/${AIRTABLE_BASE_ID}/${TABLE_NAME}?filterByFormula=${formula}&maxRecords=1`;

      const resp = await fetch(url, { headers });
      if (!resp.ok) throw new Error(`Airtable error: ${resp.status}`);

      const data = await resp.json();
      if (!data.records || data.records.length === 0) {
        return res.status(404).json({ error: 'Widget not found' });
      }

      const record = data.records[0];
      const configStr = record.fields.Config || '{}';

      try {
        const config = JSON.parse(configStr);
        // Cache for 5 minutes at CDN, 1 minute at browser
        res.setHeader('Cache-Control', 's-maxage=300, max-age=60, stale-while-revalidate=600');
        return res.status(200).json(config);
      } catch (e) {
        return res.status(500).json({ error: 'Invalid config data' });
      }
    }

    // ── POST: Create or update config ───────────────────────────
    if (req.method === 'POST') {
      const { widgetId, name, config } = req.body || {};

      if (!config) return res.status(400).json({ error: 'Missing config' });

      const configStr = JSON.stringify(config);

      // If widgetId provided, try to update existing
      if (widgetId) {
        const formula = encodeURIComponent(`{WidgetID} = '${widgetId}'`);
        const searchUrl = `${AIRTABLE_API}/${AIRTABLE_BASE_ID}/${TABLE_NAME}?filterByFormula=${formula}&maxRecords=1`;
        const searchResp = await fetch(searchUrl, { headers });
        const searchData = await searchResp.json();

        if (searchData.records && searchData.records.length > 0) {
          // Update existing record
          const recordId = searchData.records[0].id;
          const updateUrl = `${AIRTABLE_API}/${AIRTABLE_BASE_ID}/${TABLE_NAME}/${recordId}`;
          const updateResp = await fetch(updateUrl, {
            method: 'PATCH',
            headers,
            body: JSON.stringify({
              fields: {
                Config: configStr,
                Name: name || searchData.records[0].fields.Name || 'Untitled',
                UpdatedAt: new Date().toISOString(),
              },
            }),
          });

          if (!updateResp.ok) throw new Error(`Update failed: ${updateResp.status}`);
          const updated = await updateResp.json();
          return res.status(200).json({
            success: true,
            recordId: updated.id,
            widgetId: widgetId,
          });
        }
      }

      // Create new record
      const newWidgetId = widgetId || `tgp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const createUrl = `${AIRTABLE_API}/${AIRTABLE_BASE_ID}/${TABLE_NAME}`;
      const createResp = await fetch(createUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          records: [{
            fields: {
              WidgetID: newWidgetId,
              Name: name || 'Untitled Widget',
              Config: configStr,
              Status: 'Active',
              WidgetType: 'Pricing Table',
              CreatedAt: new Date().toISOString(),
              UpdatedAt: new Date().toISOString(),
            },
          }],
        }),
      });

      if (!createResp.ok) throw new Error(`Create failed: ${createResp.status}`);
      const created = await createResp.json();
      return res.status(201).json({
        success: true,
        recordId: created.records[0].id,
        widgetId: newWidgetId,
      });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('[widget-config]', err);
    return res.status(500).json({ error: err.message });
  }
}
