// Vercel serverless function: proxies POST requests to the Travelify offers cache.
// Keeps the Authorization header server-side so the public key never ships to the browser.

const TRAVELIFY_ENDPOINT = 'https://api.travelify.io/widgetsvc/traveloffers';

// Test credentials from the Travelify docs. Swap to env vars before any real client.
const APP_ID = '250';
const PUBLIC_KEY = 'A41D180E-CBFE-4E30-A47D-FAAB424A650D';

export default async function handler(req, res) {
  // CORS — wide open for the test, tighten when we go to clients
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  // Sensible defaults so the widget works with an empty body
  const body = req.body || {};
  const payload = {
    type: 'Accommodation',
    deduping: 'Aggressive',
    currency: 'GBP',
    language: 'en',
    nationality: 'GB',
    maxOffers: 20,
    rollingDates: true,
    DatesMin: 7,
    DatesMax: 90,
    pricingByType: 'Person',
    sort: 'price:asc',
    ...body,
  };

  try {
    const upstream = await fetch(TRAVELIFY_ENDPOINT, {
      method: 'POST',
      headers: {
        'Authorization': `Token ${APP_ID}:${PUBLIC_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const data = await upstream.json();

    // Mirror upstream status when it's not a 2xx so we can see what went wrong
    if (!upstream.ok) {
      return res.status(upstream.status).json({
        success: false,
        error: data?.error || `Upstream returned ${upstream.status}`,
        upstream: data,
      });
    }

    return res.status(200).json(data);
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: err.message || 'Proxy request failed',
    });
  }
}
