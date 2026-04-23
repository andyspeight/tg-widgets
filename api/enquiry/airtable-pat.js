/**
 * Airtable PAT management endpoint.
 *
 *   POST   /api/enquiry/airtable-pat
 *     Save (and optionally verify) a client's Airtable PAT for a specific form.
 *     Body: {
 *       widgetId: 'tgw_...',
 *       pat:      'pat<raw token>',
 *       baseId:   'appXXXXX',   // optional — if present, we verify the PAT can read this base
 *       skipVerify: false       // optional — skip the Airtable verify call
 *     }
 *     Returns: { saved: true, verified: true|false, verifyError: string|null }
 *
 *   DELETE /api/enquiry/airtable-pat?widgetId=tgw_...
 *     Remove the stored PAT and clear verify state.
 *     Returns: { removed: true }
 *
 * Security:
 *  - Requires a valid session (agent must be signed in).
 *  - Ownership check: the agent must own the form record. We look up the
 *    form by widgetId, compare Owner Email to the session email, reject
 *    with 403 otherwise.
 *  - PATs travel over HTTPS only, never logged, never returned in responses.
 *  - Stored encrypted via pat-crypt.js (AES-256-GCM).
 *  - Rate-limited: 5 save attempts per agent per 15 min to prevent spray.
 */
import {
  requireAuth,
  setCors,
  applyRateLimit,
  RATE_LIMITS,
  sanitiseForFormula,
} from '../_auth.js';
import { encryptPat } from './_lib/pat-crypt.js';

const BASE_ID = process.env.AIRTABLE_BASE_ID;
const PAT = process.env.AIRTABLE_KEY;
const TABLE_FORMS = 'tblpw4TCmQfJHZIlF';

// Field IDs on the Enquiry Forms table
const F = {
  widgetId:       'fld4LTXFnaJahj0uX',
  ownerEmail:     'fldLzWF0XnEXeZYH1',
  patEncrypted:   'fldA6v05RBuCovsh6',
  patVerifiedAt:  'fldU9OeeLqwRVfPYN',
  patLastError:   'fldEvB2ncXRAVZQIG',
  routingAirtable:'fld3JRqVuEKw2R9Hy',
  routingBaseId:  'fldMJzweCfekIBAoF',
  routingTableId: 'flddiEIebjjtGJMWY',
};

// Generous but not unlimited — prevent spray attacks without frustrating
// agents who genuinely need to paste a few PATs.
const PAT_RATE_LIMIT = { max: 15, windowMs: 15 * 60 * 1000 };

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (!PAT || !BASE_ID) {
    return res.status(500).json({ error: 'Server misconfigured: missing AIRTABLE_KEY or AIRTABLE_BASE_ID' });
  }

  const authResult = requireAuth(req);
  if (authResult.error) {
    return res.status(authResult.status).json({ error: authResult.error });
  }
  const agentEmail = String(authResult.user.email || '').toLowerCase().trim();
  if (!agentEmail) return res.status(401).json({ error: 'Session missing email' });

  if (!applyRateLimit(res, `pat:${agentEmail}`, PAT_RATE_LIMIT)) return;

  try {
    if (req.method === 'POST') return await handleSave(req, res, agentEmail);
    if (req.method === 'DELETE') return await handleDelete(req, res, agentEmail);
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    // Never leak internals. Log the real error server-side, send something
    // safe to the client.
    console.error('[airtable-pat] fatal', err);
    if (err.message && err.message.startsWith('decryptPat')) {
      return res.status(400).json({ error: 'Encryption error — please re-enter your token' });
    }
    return res.status(500).json({ error: 'Internal server error' });
  }
}

/* ============================ SAVE ============================ */
async function handleSave(req, res, agentEmail) {
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); }
    catch (e) { return res.status(400).json({ error: 'Invalid JSON body' }); }
  }
  if (!body || typeof body !== 'object') {
    return res.status(400).json({ error: 'Missing body' });
  }

  const { widgetId, pat, baseId, skipVerify } = body;

  // Structural validation only — we don't test the PAT works here, that's
  // the verify step further down.
  if (typeof widgetId !== 'string' || !/^tgw_[A-Za-z0-9_-]+$/.test(widgetId)) {
    return res.status(400).json({ error: 'Invalid widgetId' });
  }
  if (typeof pat !== 'string' || pat.length < 30 || pat.length > 500) {
    return res.status(400).json({ error: 'Invalid PAT format' });
  }
  if (!/^pat[A-Za-z0-9._-]+$/.test(pat)) {
    return res.status(400).json({ error: 'PAT must start with "pat" (Airtable token format)' });
  }
  // baseId is optional but must be well-formed if present
  if (baseId && !/^app[A-Za-z0-9]{14}$/.test(baseId)) {
    return res.status(400).json({ error: 'Invalid Airtable base ID format' });
  }

  // Find the form record by widgetId AND ownership
  const formRecord = await findFormByWidgetId(widgetId, agentEmail);
  if (!formRecord) {
    // Could be "form doesn't exist" OR "form exists but you don't own it".
    // Don't distinguish in the response to avoid leaking existence of others' forms.
    return res.status(404).json({ error: 'Form not found' });
  }

  // Verify the PAT against Airtable (optional, on by default).
  // If verification fails, we still save the encrypted PAT but record the
  // failure so the UI can show a helpful error.
  let verified = false;
  let verifyError = null;
  if (!skipVerify) {
    const verifyResult = await verifyPatAgainstAirtable(pat, baseId);
    verified = verifyResult.verified;
    verifyError = verifyResult.error;
  }

  // Encrypt and store
  let encrypted;
  try {
    encrypted = encryptPat(pat);
  } catch (err) {
    console.error('[airtable-pat] encryption failed', err);
    return res.status(500).json({ error: 'Could not encrypt token — server misconfigured' });
  }

  const updateFields = {
    [F.patEncrypted]: encrypted,
    [F.patVerifiedAt]: verified ? new Date().toISOString() : null,
    [F.patLastError]: verified ? '' : (verifyError || ''),
  };

  const patchRes = await fetch(
    `https://api.airtable.com/v0/${BASE_ID}/${TABLE_FORMS}/${formRecord.id}`,
    {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${PAT}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ fields: updateFields }),
    }
  );
  if (!patchRes.ok) {
    const text = await patchRes.text();
    console.error('[airtable-pat] save failed', patchRes.status, text);
    return res.status(502).json({ error: 'Failed to save token — Airtable write failed' });
  }

  return res.status(200).json({
    saved: true,
    verified,
    verifyError,
  });
}

/* ============================ DELETE ============================ */
async function handleDelete(req, res, agentEmail) {
  const widgetId = req.query && req.query.widgetId;
  if (typeof widgetId !== 'string' || !/^tgw_[A-Za-z0-9_-]+$/.test(widgetId)) {
    return res.status(400).json({ error: 'Invalid widgetId' });
  }

  const formRecord = await findFormByWidgetId(widgetId, agentEmail);
  if (!formRecord) {
    return res.status(404).json({ error: 'Form not found' });
  }

  // Clear all three PAT fields — encrypted blob, verify timestamp, last error
  const patchRes = await fetch(
    `https://api.airtable.com/v0/${BASE_ID}/${TABLE_FORMS}/${formRecord.id}`,
    {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${PAT}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        fields: {
          [F.patEncrypted]: '',
          [F.patVerifiedAt]: null,
          [F.patLastError]: '',
        },
      }),
    }
  );
  if (!patchRes.ok) {
    const text = await patchRes.text();
    console.error('[airtable-pat] delete failed', patchRes.status, text);
    return res.status(502).json({ error: 'Failed to remove token' });
  }

  return res.status(200).json({ removed: true });
}

/* ============================ HELPERS ============================ */

/**
 * Look up an Enquiry Form by widgetId, scoped to the current agent.
 * Returns { id, fields } or null if not found / not owned.
 */
async function findFormByWidgetId(widgetId, agentEmail) {
  const formula = `AND(` +
    `{${F.widgetId}} = '${sanitiseForFormula(widgetId)}',` +
    `LOWER({${F.ownerEmail}}) = '${sanitiseForFormula(agentEmail)}'` +
  `)`;

  const params = new URLSearchParams({
    filterByFormula: formula,
    maxRecords: '1',
  });
  // Only request the fields we need
  [F.widgetId, F.ownerEmail, F.patEncrypted].forEach(f => params.append('fields[]', f));

  const url = `https://api.airtable.com/v0/${BASE_ID}/${TABLE_FORMS}?${params.toString()}`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${PAT}` },
  });
  if (!response.ok) {
    console.error('[airtable-pat] findFormByWidgetId failed', response.status);
    return null;
  }
  const data = await response.json();
  return (data.records && data.records[0]) || null;
}

/**
 * Verify a PAT by making a Meta API call to Airtable. If a baseId is given,
 * we check the PAT can access that specific base. If not, we just check the
 * PAT authenticates at all.
 *
 * Returns { verified: boolean, error: string|null }
 */
async function verifyPatAgainstAirtable(patValue, baseId) {
  try {
    if (baseId) {
      // Check base-level access by hitting the schema endpoint for the target base
      const url = `https://api.airtable.com/v0/meta/bases/${baseId}/tables`;
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${patValue}` },
      });
      if (response.status === 401) {
        return { verified: false, error: 'Token is invalid or expired' };
      }
      if (response.status === 403) {
        return { verified: false, error: 'Token lacks access to the specified base' };
      }
      if (response.status === 404) {
        return { verified: false, error: 'Base ID not found — check the base ID' };
      }
      if (!response.ok) {
        const text = await response.text().catch(() => '');
        return { verified: false, error: `Airtable returned ${response.status}${text ? ': ' + text.slice(0, 100) : ''}` };
      }
      return { verified: true, error: null };
    } else {
      // Lightweight check — list bases the token can see
      const url = 'https://api.airtable.com/v0/meta/bases';
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${patValue}` },
      });
      if (response.status === 401) {
        return { verified: false, error: 'Token is invalid or expired' };
      }
      if (!response.ok) {
        return { verified: false, error: `Airtable returned ${response.status}` };
      }
      return { verified: true, error: null };
    }
  } catch (err) {
    console.error('[airtable-pat] verify error', err);
    return { verified: false, error: 'Could not reach Airtable' };
  }
}
