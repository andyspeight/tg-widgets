/**
 * Widget List API
 * GET /api/widget-list?email=USER_EMAIL → returns array of saved widgets for that user
 * GET /api/widget-list (no email) → returns all widgets (admin)
 */
const AIRTABLE_API = 'https://api.airtable.com/v0';
const TABLE_NAME = 'Widgets';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { AIRTABLE_KEY, AIRTABLE_BASE_ID } = process.env;
  if (!AIRTABLE_KEY || !AIRTABLE_BASE_ID) return res.status(500).json({ error: 'Config missing' });

  try {
    const email = req.query.email;
    let url = `${AIRTABLE_API}/${AIRTABLE_BASE_ID}/${TABLE_NAME}?sort%5B0%5D%5Bfield%5D=UpdatedAt&sort%5B0%5D%5Bdirection%5D=desc&maxRecords=50`;
    
    if (email) {
      const formula = encodeURIComponent(`{ClientEmail} = '${email.replace(/'/g, "\\'")}'`);
      url += `&filterByFormula=${formula}`;
    }

    const resp = await fetch(url, {
      headers: { 'Authorization': `Bearer ${AIRTABLE_KEY}` },
    });
    if (!resp.ok) throw new Error(`Airtable ${resp.status}`);
    const data = await resp.json();

    const widgets = (data.records || []).map(r => ({
      widgetId: r.fields.WidgetID || '',
      name: r.fields.Name || 'Untitled',
      type: r.fields.WidgetType || 'Unknown',
      status: r.fields.Status || 'Draft',
      views: r.fields.Views || 0,
      updated: r.fields.UpdatedAt ? new Date(r.fields.UpdatedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '',
      client: r.fields.ClientName || '',
    }));

    res.setHeader('Cache-Control', 'max-age=10');
    return res.status(200).json(widgets);
  } catch (err) {
    console.error('[widget-list]', err);
    return res.status(500).json({ error: err.message });
  }
}
