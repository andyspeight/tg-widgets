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

  // Capture the real visitor's user-agent — Travelify logs this for analytics
  // and recommends sending it via customerUserAgent in the body
  const customerUserAgent = req.headers['user-agent'] || 'Travelgenix-Widget/1.0';

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
    customerUserAgent,
    ...body,
  };

  // Build auth header — exact format from Travelify docs: "Token AppId:PublicApiKey"
  const authHeader = `Token ${APP_ID}:${PUBLIC_KEY}`;

  try {
    const upstream = await fetch(TRAVELIFY_ENDPOINT, {
      method: 'POST',
      headers: {
        'Authorization': authHeader,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'User-Agent': 'Travelgenix-Widget-Proxy/1.0 (+https://tg-widgets.vercel.app)',
      },
      body: JSON.stringify(payload),
    });

    // Try to parse JSON — but capture text first so we can debug non-JSON responses
    const responseText = await upstream.text();
    let data;
    try {
      data = JSON.parse(responseText);
    } catch (parseErr) {
      return res.status(502).json({
        success: false,
        error: 'Upstream returned non-JSON response',
        upstreamStatus: upstream.status,
        upstreamBody: responseText.slice(0, 500),
      });
    }

    // Mirror upstream status when it's not a 2xx so we can see what went wrong
    if (!upstream.ok) {
      return res.status(upstream.status).json({
        success: false,
        error: data?.error || `Upstream returned ${upstream.status}`,
        upstreamStatus: upstream.status,
        upstream: data,
        // Echo back the auth header shape (masked) so we can verify the format
        debug: {
          authHeaderFormat: `Token ${APP_ID}:${PUBLIC_KEY.slice(0, 8)}...`,
          payloadKeys: Object.keys(payload),
        },
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
