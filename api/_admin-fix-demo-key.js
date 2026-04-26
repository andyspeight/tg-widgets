/**
 * TEMPORARY ADMIN ENDPOINT — REMOVE AFTER USE
 *
 * Single-purpose: re-encrypt the demo Travelify API key and write it to the
 * pinned ClientIntegrations record. Used once to fix the demo path after
 * Travelify returned 401 with the previously stored key.
 *
 * Hard-pinned to:
 *   - Base:   appAYzWZxvK6qlwXK
 *   - Table:  tblpzQpwmcTvUeHcF (ClientIntegrations)
 *   - Record: rec6TnQI0Pz8PyrGs (the only Travelify integration row)
 *   - Field:  fldpb4JQRSuot0Gg2 (ApiKeyEncrypted)
 *
 * This file MUST be deleted from the repo and ADMIN_FIX_SECRET removed from
 * Vercel env vars after use. Until that's done, the endpoint is locked behind
 * a shared-secret header which only Andy knows.
 *
 * Endpoint:
 *   POST /api/_admin-fix-demo-key
 *
 * Headers:
 *   Content-Type:        application/json
 *   x-admin-fix-secret:  <ADMIN_FIX_SECRET env var value>
 *
 * Body:
 *   { "apiKey": "<the correct Travelify App 250 key>" }
 *
 * Response:
 *   200 { ok: true, recordId, keyLengthStored } on success
 *   401 { error: 'unauthorised' } on missing/wrong secret
 *   400 on missing/invalid body
 *   500 on encryption / Airtable failure (no detail leaked)
 */

import crypto from 'node:crypto';
import { encrypt } from './_crypto.js';

const AIRTABLE_BASE = 'appAYzWZxvK6qlwXK';
const INTEGRATIONS_TABLE = 'tblpzQpwmcTvUeHcF';
const PINNED_RECORD_ID = 'rec6TnQI0Pz8PyrGs';
const API_KEY_ENCRYPTED_FIELD = 'fldpb4JQRSuot0Gg2';

function timingSafeEquals(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

export default async function handler(req, res) {
  // Method check
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  // Shared-secret auth (timing-safe)
  const expected = process.env.ADMIN_FIX_SECRET;
  if (!expected || expected.length < 16) {
    console.error('[admin-fix-demo-key] ADMIN_FIX_SECRET missing or too short');
    return res.status(401).json({ error: 'unauthorised' });
  }
  const supplied = req.headers['x-admin-fix-secret'];
  if (!timingSafeEquals(supplied, expected)) {
    console.warn('[admin-fix-demo-key] auth failed from', req.headers['x-forwarded-for'] || 'unknown');
    return res.status(401).json({ error: 'unauthorised' });
  }

  // Parse and validate body
  let body;
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
  } catch {
    return res.status(400).json({ error: 'invalid_json' });
  }

  const apiKey = body.apiKey;
  if (typeof apiKey !== 'string' || apiKey.length < 8 || apiKey.length > 256) {
    return res.status(400).json({ error: 'invalid_apiKey' });
  }

  // Encrypt with TG_ENCRYPTION_KEY (server-side env)
  let encrypted;
  try {
    encrypted = encrypt(apiKey);
  } catch (e) {
    console.error('[admin-fix-demo-key] encryption failed:', e.message);
    return res.status(500).json({ error: 'server_error' });
  }

  // Update the pinned Airtable record (only the one field, on the one record)
  const airtableKey = process.env.AIRTABLE_KEY;
  if (!airtableKey) {
    console.error('[admin-fix-demo-key] AIRTABLE_KEY env var missing');
    return res.status(500).json({ error: 'server_error' });
  }

  const url = `https://api.airtable.com/v0/${AIRTABLE_BASE}/${INTEGRATIONS_TABLE}`;
  const payload = JSON.stringify({
    records: [{
      id: PINNED_RECORD_ID,
      fields: { [API_KEY_ENCRYPTED_FIELD]: encrypted },
    }],
  });

  let airtableRes;
  try {
    airtableRes = await fetch(url, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${airtableKey}`,
        'Content-Type': 'application/json',
      },
      body: payload,
    });
  } catch (e) {
    console.error('[admin-fix-demo-key] Airtable network error:', e.message);
    return res.status(500).json({ error: 'server_error' });
  }

  if (!airtableRes.ok) {
    const text = await airtableRes.text().catch(() => '');
    console.error('[admin-fix-demo-key] Airtable update failed:', airtableRes.status, text.slice(0, 300));
    return res.status(500).json({ error: 'server_error' });
  }

  console.log('[admin-fix-demo-key] success — record updated, plaintext key length:', apiKey.length);
  return res.status(200).json({
    ok: true,
    recordId: PINNED_RECORD_ID,
    keyLengthStored: apiKey.length,
  });
}
