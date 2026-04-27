/**
 * Travelgenix Widget Suite — Client Integrations API
 *
 * Manages encrypted third-party API credentials per client.
 * Currently supports: Travelify (more services planned: Duda, Metricool, Resend, etc.)
 *
 * Auth: Bearer token required (verified via _auth.js)
 * Scope: Each user can only read/write integrations matching their own ClientEmail
 *
 * Methods:
 *   GET    ?service=Travelify     → returns metadata of active integration (no key)
 *   POST   {service, appId, apiKey, notes?}  → save (creates new or replaces existing active)
 *   DELETE ?service=Travelify     → soft-revoke (sets Status=Revoked, keeps audit trail)
 *
 * The actual API key is NEVER returned in responses — only metadata
 * (status, appId, lastUsedAt, integrationId) so the editor can show "credentials saved".
 *
 * Storage:
 *   Base:  appAYzWZxvK6qlwXK
 *   Table: tblpzQpwmcTvUeHcF (ClientIntegrations)
 */

import { requireAuth, sanitiseForFormula, setCors, applyRateLimit, RATE_LIMITS } from './_auth.js';
import { encrypt } from './_crypto.js';

const AIRTABLE_BASE = process.env.AIRTABLE_BASE_ID || 'appAYzWZxvK6qlwXK';
const TABLE_ID = 'tblpzQpwmcTvUeHcF';

// Field IDs
const F = {
  IntegrationID:    'fldIZBDjX5lNJDf1S',
  ClientEmail:      'flditBgdp6egbk3Fb',
  Service:          'fld0TP0kypkfOOJF6',
  AppId:            'fldCXwCixuvqN2HMy',
  ApiKeyEncrypted:  'fldpb4JQRSuot0Gg2',
  Status:           'fldEVMrKnEpFaxORk',
  Notes:            'fld1pmMz2XLcFXClF',
  CreatedAt:        'fldsCvRmaFdzLAR6r',
  UpdatedAt:        'fldOlf1fxG2fm5Rl8',
  LastUsedAt:       'fldQgOjcM3sfKL7uB',
};

const SERVICES = ['Travelify', 'Duda', 'Metricool', 'Resend', 'Other'];
const STATUSES = ['Active', 'Revoked', 'Error'];

// ----- Airtable helpers -----

function airtableHeaders() {
  const key = process.env.AIRTABLE_KEY;
  if (!key) throw new Error('AIRTABLE_KEY env var missing');
  return {
    'Authorization': `Bearer ${key}`,
    'Content-Type': 'application/json',
  };
}

async function listActiveIntegrations(clientEmail, service) {
  const safeEmail = sanitiseForFormula(clientEmail);
  const safeService = sanitiseForFormula(service);
  const formula = `AND({${F.ClientEmail}}='${safeEmail}',{${F.Service}}='${safeService}',{${F.Status}}='Active')`;

  const url = new URL(`https://api.airtable.com/v0/${AIRTABLE_BASE}/${TABLE_ID}`);
  url.searchParams.set('filterByFormula', formula);
  url.searchParams.set('maxRecords', '5');
  url.searchParams.set('returnFieldsByFieldId', 'true');

  const res = await fetch(url.toString(), { headers: airtableHeaders() });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Airtable list failed (${res.status}): ${body.slice(0, 200)}`);
  }
  const data = await res.json();
  return data.records || [];
}

async function createIntegration(fields) {
  const url = `https://api.airtable.com/v0/${AIRTABLE_BASE}/${TABLE_ID}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: airtableHeaders(),
    body: JSON.stringify({
      records: [{ fields }],
      typecast: false,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Airtable create failed (${res.status}): ${body.slice(0, 200)}`);
  }
  const data = await res.json();
  return data.records[0];
}

async function updateIntegration(recordId, fields) {
  const url = `https://api.airtable.com/v0/${AIRTABLE_BASE}/${TABLE_ID}`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: airtableHeaders(),
    body: JSON.stringify({
      records: [{ id: recordId, fields }],
      typecast: false,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Airtable update failed (${res.status}): ${body.slice(0, 200)}`);
  }
  const data = await res.json();
  return data.records[0];
}

// ----- Validation helpers -----

function validateService(s) {
  if (typeof s !== 'string') return null;
  return SERVICES.includes(s) ? s : null;
}

function validateAppId(s) {
  if (typeof s !== 'string') return null;
  // Reasonable bounds, alphanumeric + dash + underscore + dot
  if (!/^[a-zA-Z0-9_\-.]{1,50}$/.test(s)) return null;
  return s;
}

function validateApiKey(s) {
  if (typeof s !== 'string') return null;
  // Only check it's plausible (not empty, not absurdly long, no whitespace within)
  if (s.length < 8 || s.length > 500) return null;
  if (/\s/.test(s)) return null;
  return s;
}

function validateNotes(s) {
  if (s == null || s === '') return '';
  if (typeof s !== 'string') return '';
  return s.slice(0, 500);
}

function newIntegrationID() {
  const ts = Math.floor(Date.now() / 1000);
  const rand = Math.random().toString(36).slice(2, 8);
  return `int_${ts}_${rand}`;
}

// ----- Response shape (never includes the API key) -----

function publicShape(record) {
  if (!record) return null;
  const f = record.fields || {};
  return {
    integrationId: f[F.IntegrationID] || null,
    service: f[F.Service] || null,
    appId: f[F.AppId] || null,
    status: f[F.Status] || null,
    notes: f[F.Notes] || '',
    createdAt: f[F.CreatedAt] || null,
    updatedAt: f[F.UpdatedAt] || null,
    lastUsedAt: f[F.LastUsedAt] || null,
    hasKey: !!f[F.ApiKeyEncrypted],
  };
}

// ----- HTTP handler -----

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();

  // Auth — same pattern as widget-list.js, widget-config.js, widget-ai.js
  const auth = requireAuth(req);
  if (auth.error) return res.status(auth.status).json({ error: auth.error });
  const user = auth.user;

  const clientEmail = (user.email || '').toLowerCase().trim();
  if (!clientEmail) return res.status(401).json({ error: 'Authentication required' });

  // Rate limit per user. Reads are generous (dashboard refreshes), writes moderate.
  const rlKey = req.method === 'GET'
    ? `integrations-read:${clientEmail}`
    : `integrations-write:${clientEmail}`;
  const rlLimit = req.method === 'GET' ? RATE_LIMITS.widgetRead : RATE_LIMITS.widgetWrite;
  if (!applyRateLimit(res, rlKey, rlLimit)) return;

  try {
    if (req.method === 'GET') {
      const service = validateService(req.query?.service);
      if (!service) return res.status(400).json({ error: 'Invalid or missing service' });

      const records = await listActiveIntegrations(clientEmail, service);
      if (records.length === 0) {
        return res.status(200).json({ integration: null });
      }
      // Most recently updated wins if multiple exist
      records.sort((a, b) => {
        const ua = a.fields?.[F.UpdatedAt] || '';
        const ub = b.fields?.[F.UpdatedAt] || '';
        return ub.localeCompare(ua);
      });
      return res.status(200).json({ integration: publicShape(records[0]) });
    }

    if (req.method === 'POST') {
      let body;
      try {
        body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
      } catch {
        return res.status(400).json({ error: 'Invalid JSON body' });
      }

      const service = validateService(body.service);
      if (!service) return res.status(400).json({ error: 'Invalid or missing service' });

      const appId = validateAppId(body.appId);
      if (!appId) return res.status(400).json({ error: 'Invalid or missing appId' });

      const apiKey = validateApiKey(body.apiKey);
      if (!apiKey) return res.status(400).json({ error: 'Invalid or missing apiKey' });

      const notes = validateNotes(body.notes);
      const now = new Date().toISOString();

      // Encrypt the API key
      let apiKeyEncrypted;
      try {
        apiKeyEncrypted = encrypt(apiKey);
      } catch (e) {
        console.error('Encryption failed:', e.message);
        return res.status(500).json({ error: 'Server configuration error' });
      }

      // Revoke any existing active integration for this client+service (one-active-at-a-time policy)
      const existing = await listActiveIntegrations(clientEmail, service);
      for (const rec of existing) {
        await updateIntegration(rec.id, {
          [F.Status]: 'Revoked',
          [F.UpdatedAt]: now,
          [F.Notes]: ((rec.fields?.[F.Notes] || '') + ' [auto-revoked on rotation ' + now + ']').trim().slice(0, 500),
        });
      }

      // Create the new active integration
      const created = await createIntegration({
        [F.IntegrationID]: newIntegrationID(),
        [F.ClientEmail]: clientEmail,
        [F.Service]: service,
        [F.AppId]: appId,
        [F.ApiKeyEncrypted]: apiKeyEncrypted,
        [F.Status]: 'Active',
        [F.Notes]: notes,
        [F.CreatedAt]: now,
        [F.UpdatedAt]: now,
      });

      return res.status(200).json({ integration: publicShape(created) });
    }

    if (req.method === 'DELETE') {
      const service = validateService(req.query?.service);
      if (!service) return res.status(400).json({ error: 'Invalid or missing service' });

      const records = await listActiveIntegrations(clientEmail, service);
      if (records.length === 0) {
        return res.status(404).json({ error: 'No active integration found' });
      }
      const now = new Date().toISOString();
      for (const rec of records) {
        await updateIntegration(rec.id, {
          [F.Status]: 'Revoked',
          [F.UpdatedAt]: now,
        });
      }
      return res.status(200).json({ revoked: records.length });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('client-integrations error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
