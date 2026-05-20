// Vercel serverless function: proxies POST requests to the Travelify Offers cache.
//
// Per-client credentials live in the Airtable Clients table (one record per
// client, with their Travelify App ID + public API Key). The widget POSTs its
// own appId in the request body; we look that up to build the auth header
// server-side. The apiKey never ships to the browser via this endpoint —
// the offers payload comes back instead.
//
// Demo fallback: requests with no appId or with appId='250' use the hardcoded
// Travelgenix demo credentials so the public marketing demo on tg-widgets.vercel.app
// keeps working without configuration.

import { setCors, lookupClientCredentialsByAppId } from './_auth.js';

const TRAVELIFY_ENDPOINT = 'https://api.travelify.io/widgetsvc/traveloffers';

// Travelgenix demo credentials (App 250) — published in Travelify docs.
const DEMO_APP_ID = '250';
const DEMO_PUBLIC_KEY = 'A41D180E-CBFE-4E30-A47D-FAAB424A650D';

export default async function handler(req, res) {
  setCors(res);

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  // Capture the real visitor's user-agent — Travelify logs this for analytics
  // and recommends sending it via customerUserAgent in the body
  const customerUserAgent = req.headers['user-agent'] || 'Travelgenix-Widget/1.0';

  const body = req.body || {};

  // ── Resolve credentials ───────────────────────────────────────────
  // Strip appId out of the body so it never goes through to Travelify (it
  // doesn't belong on the request payload — it belongs in the auth header).
  const { appId: rawAppId, apiKey: _ignoredApiKey, ...travelifyBody } = body;
  const requestedAppId = rawAppId == null ? '' : String(rawAppId).trim();

  let appId;
  let apiKey;

  // Demo path: no appId supplied, or appId is the demo account.
  if (!requestedAppId || requestedAppId === DEMO_APP_ID) {
    appId = DEMO_APP_ID;
    apiKey = DEMO_PUBLIC_KEY;
  } else {
    // Real client: look up by App ID against the Clients table.
    try {
      const creds = await lookupClientCredentialsByAppId(requestedAppId);
      if (!creds) {
        return res.status(404).json({
          success: false,
          error: 'Unknown client',
          detail: `No Travelgenix client with Travelify App ID ${requestedAppId}`,
        });
      }
      appId = creds.appId;
      apiKey = creds.apiKey;
    } catch (err) {
      console.error('[offers] credential lookup failed for appId', requestedAppId, '—', err.message);
      return res.status(500).json({
        success: false,
        error: 'Credential lookup failed',
      });
    }
  }

  // Sensible defaults so the widget works with a minimal body
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
    ...travelifyBody,
  };

  // Build auth header — exact format from Travelify docs: "Token AppId:PublicApiKey"
  const authHeader = `Token ${appId}:${apiKey}`;

  // ── Forward browser context headers ──────────────────────────────
  // Travelify's auth layer checks Referer (and sometimes Origin) to validate
  // requests are coming from a real browser session, not a server-to-server
  // call. The widget runs in the visitor's browser and produces a Referer
  // naturally; this proxy hop strips it unless we forward it explicitly.
  //
  // We don't fabricate values when they're missing — if a caller hits this
  // proxy directly with no Referer, we pass nothing through and let Travelify
  // reject it the way they would have anyway. Honest behaviour.
  const upstreamHeaders = {
    'Authorization': authHeader,
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'User-Agent': 'Travelgenix-Widget-Proxy/1.0 (+https://tg-widgets.vercel.app)',
  };
  const incomingReferer = req.headers['referer'] || req.headers['referrer'] || '';
  const incomingOrigin = req.headers['origin'] || '';
  if (incomingReferer) {
    upstreamHeaders['Referer'] = incomingReferer;
    // Derive Origin from Referer if the browser didn't send one (rare, but
    // some embedded contexts strip Origin while preserving Referer).
    if (!incomingOrigin) {
      try {
        upstreamHeaders['Origin'] = new URL(incomingReferer).origin;
      } catch { /* malformed Referer — leave Origin unset */ }
    }
  }
  if (incomingOrigin) {
    upstreamHeaders['Origin'] = incomingOrigin;
  }

  try {
    const upstream = await fetch(TRAVELIFY_ENDPOINT, {
      method: 'POST',
      headers: upstreamHeaders,
      body: JSON.stringify(payload),
    });

    // Try to parse JSON — but capture text first so we can debug non-JSON responses
    const responseText = await upstream.text();
    let data;
    try {
      data = JSON.parse(responseText);
    } catch {
      return res.status(502).json({
        success: false,
        error: 'Upstream returned non-JSON response',
        upstreamStatus: upstream.status,
        upstreamBody: responseText.slice(0, 500),
      });
    }

    if (!upstream.ok) {
      return res.status(upstream.status).json({
        success: false,
        error: data?.error || `Upstream returned ${upstream.status}`,
        upstreamStatus: upstream.status,
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
