/**
 * Widget Auth API
 * POST /api/widget-auth  { email, code }  → returns user info or error
 * 
 * Env vars: AIRTABLE_KEY, AIRTABLE_BASE_ID
 */
const AIRTABLE_API = 'https://api.airtable.com/v0';
const TABLE_NAME = 'Users';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { AIRTABLE_KEY, AIRTABLE_BASE_ID } = process.env;
  if (!AIRTABLE_KEY || !AIRTABLE_BASE_ID) return res.status(500).json({ error: 'Config missing' });

  const { email, code } = req.body || {};
  if (!email || !code) return res.status(400).json({ error: 'Email and client code required' });

  const headers = { 'Authorization': `Bearer ${AIRTABLE_KEY}`, 'Content-Type': 'application/json' };

  try {
    // Look up user by email
    const formula = encodeURIComponent(`{Email} = '${email.replace(/'/g, "\\'")}'`);
    const url = `${AIRTABLE_API}/${AIRTABLE_BASE_ID}/${TABLE_NAME}?filterByFormula=${formula}&maxRecords=1`;
    const resp = await fetch(url, { headers });
    if (!resp.ok) throw new Error(`Airtable ${resp.status}`);
    const data = await resp.json();

    if (!data.records || !data.records.length) {
      return res.status(401).json({ error: 'Account not found. Contact your Travelgenix account manager to get set up.' });
    }

    const record = data.records[0];
    const storedCode = record.fields.ClientCode || '';
    const status = record.fields.Status || '';

    // Check code
    if (storedCode !== code) {
      return res.status(401).json({ error: 'Invalid client code. Check the code in your welcome email or contact support.' });
    }

    // Check status
    if (status === 'Disabled') {
      return res.status(403).json({ error: 'Account disabled. Contact your Travelgenix account manager.' });
    }

    if (status === 'Pending') {
      return res.status(403).json({ error: 'Account pending activation. We\'ll be in touch shortly.' });
    }

    // Update last login
    const updateUrl = `${AIRTABLE_API}/${AIRTABLE_BASE_ID}/${TABLE_NAME}/${record.id}`;
    await fetch(updateUrl, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ fields: { LastLogin: new Date().toISOString() } }),
    });

    return res.status(200).json({
      success: true,
      user: {
        email: record.fields.Email,
        clientName: record.fields.ClientName || '',
        plan: record.fields.Plan || '',
        status: record.fields.Status || 'Active',
      },
    });
  } catch (err) {
    console.error('[widget-auth]', err);
    return res.status(500).json({ error: 'Authentication service error' });
  }
}
