/**
 * POST /api/widget-copy
 *
 * Duplicates a widget. The new widget:
 *   - gets a fresh widgetId (tgw_xxx)
 *   - has " (Copy)" appended to its name (or uses caller-supplied name)
 *   - belongs to the SAME user as the source (ownership re-affirmed, not transferred)
 *   - carries an exact copy of the Config blob (theme, layout, content, credentials)
 *   - has fresh CreatedAt / UpdatedAt timestamps
 *   - does NOT inherit stats (views, clicks, etc) — those naturally start at zero
 *
 * Request:  { widgetId: 'tgw_xxx', name?: 'New name' }
 * Response: { success: true, widgetId, recordId }
 *
 * Why a separate endpoint instead of folding into widget-config:
 *   - widget-config's CREATE path requires the client to send a full config
 *     blob, which the dashboard doesn't have without first loading the source
 *   - This endpoint takes only the source widgetId — the server reads the
 *     source and copies internally. One request, no round-trip.
 *   - Plan-limit checks are applied here too (a copy still counts).
 *
 * Enquiry forms are NOT handled by this endpoint — they live in a separate
 * Airtable base with a richer schema and need /api/enquiry-form-copy instead.
 * If a caller targets an Enquiry widget here, we return 400 directing them
 * to the right endpoint.
 */

import { requireAuth, setCors, applyRateLimit, RATE_LIMITS } from './_auth.js';
import { getRecord } from './_lib/auth/airtable.js';
import { USERS } from './_lib/auth/schema.js';
import { normalisePlanValue, resolveClientPlan } from './_lib/auth/plan.js';

const AIRTABLE_API = 'https://api.airtable.com/v0';
const TABLE_NAME = 'Widgets';

const PLAN_ALIASES = {
  'spark': 'Spark', 'spark plan': 'Spark',
  'boost': 'Boost', 'boost plan': 'Boost',
  'ignite': 'Ignite', 'ignite plan': 'Ignite',
  'bespoke': 'Bespoke', 'bespoke plan': 'Bespoke', 'enterprise': 'Bespoke',
};

const PLAN_WIDGET_LIMITS = {
  'Pricing Table':         { Spark: 1, Boost: 5, Ignite: -1, Bespoke: -1 },
  'FAQ':                   { Spark: 0, Boost: 3, Ignite: -1, Bespoke: -1 },
  'Google Reviews':        { Spark: 0, Boost: 3, Ignite: -1, Bespoke: -1 },
  'Testimonials':          { Spark: 0, Boost: 0, Ignite: -1, Bespoke: -1 },
  'Destination Spotlight': { Spark: 1, Boost: 5, Ignite: -1, Bespoke: -1 },
  'Airport Spotlight':     { Spark: 0, Boost: 5, Ignite: -1, Bespoke: -1 },
  'Weather':               { Spark: 1, Boost: 3, Ignite: -1, Bespoke: -1 },
  'Enquiry Form':          { Spark: 1, Boost: 5, Ignite: -1, Bespoke: -1 },
  'My Booking':            { Spark: 0, Boost: 0, Ignite: -1, Bespoke: -1 },
  'Text FX':               { Spark: -1, Boost: -1, Ignite: -1, Bespoke: -1 },
  'Logo Showcase':         { Spark: -1, Boost: -1, Ignite: -1, Bespoke: -1 },
  'Travel Offers':         { Spark: 0, Boost: 3, Ignite: -1, Bespoke: -1 },
  'Popup':                 { Spark: 0, Boost: 3, Ignite: -1, Bespoke: -1 },
  'Countdown Timer':       { Spark: -1, Boost: -1, Ignite: -1, Bespoke: -1 },
  'Event Calendar':        { Spark: 0, Boost: 3, Ignite: -1, Bespoke: -1 },
  'Social Share':          { Spark: -1, Boost: -1, Ignite: -1, Bespoke: -1 },
  'WhatsApp Chat':         { Spark: -1, Boost: -1, Ignite: -1, Bespoke: -1 },
  'Opening Hours':         { Spark: -1, Boost: -1, Ignite: -1, Bespoke: -1 },
  'Newsletter Signup':     { Spark: -1, Boost: -1, Ignite: -1, Bespoke: -1 },
  'Contact Card':          { Spark: -1, Boost: -1, Ignite: -1, Bespoke: -1 },
};

/**
 * Hydrate email + plan from user/client records when JWT is incomplete.
 * Mirrors widget-config's hydrateLegacyUserFields. Kept local for now —
 * once a third endpoint needs the same trick, lift to a shared module.
 */
async function hydrateLegacyUserFields(user) {
  if (!user) return;
  try {
    if (!user.email && user.recordId) {
      const u = await getRecord(USERS.tableId, user.recordId);
      const email = u?.fields?.[USERS.fields.email];
      if (typeof email === 'string' && email.trim()) user.email = email.trim();
    }
  } catch (err) {
    console.warn('[widget-copy] hydrate email failed:', err.message);
  }
  try {
    if (!user.plan && user.clientId) {
      // Use the same resolver widget-config uses — it handles plan + package
      // + alias normalisation in one place.
      const planRaw = await resolveClientPlan(user.clientId);
      if (planRaw) {
        const normalised = await normalisePlanValue(planRaw);
        if (normalised) user.plan = normalised;
      }
    }
  } catch (err) {
    console.warn('[widget-copy] hydrate plan failed:', err.message);
  }
}

function canonicalisePlan(raw) {
  if (!raw) return null;
  const key = String(raw).trim().toLowerCase();
  return PLAN_ALIASES[key] || (raw[0].toUpperCase() + raw.slice(1).toLowerCase());
}

async function throwAirtableError(opName, resp) {
  let body = '';
  try { body = await resp.text(); } catch {}
  if (body.length > 800) body = body.slice(0, 800) + '…[truncated]';
  throw new Error(opName + (body ? ` — ${resp.status} ${body}` : ` — ${resp.status}`));
}

async function countWidgetsOfType(headers, baseId, email, widgetType) {
  const safeEmail = email.replace(/'/g, "\\'");
  const safeType = widgetType.replace(/'/g, "\\'");
  const formula = encodeURIComponent(
    `AND({ClientEmail}='${safeEmail}', {WidgetType}='${safeType}')`
  );
  const url = `${AIRTABLE_API}/${baseId}/${TABLE_NAME}?filterByFormula=${formula}&fields%5B%5D=WidgetID&pageSize=100`;
  const resp = await fetch(url, { headers });
  if (!resp.ok) await throwAirtableError('Count query failed', resp);
  const data = await resp.json();
  return (data.records || []).length;
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' });
    }

    // Auth
    const auth = requireAuth(req);
    if (auth.error) return res.status(auth.status).json({ error: auth.error });
    const user = auth.user;
    await hydrateLegacyUserFields(user);

    if (!user.email) {
      console.warn('[widget-copy] no email on user after hydration; cannot proceed');
      return res.status(401).json({ error: 'User email missing' });
    }

    if (!applyRateLimit(res, `widget-copy:${user.email}`, RATE_LIMITS.widgetWrite)) return;

    // Parse + validate request
    const body = req.body || {};
    const widgetId = typeof body.widgetId === 'string' ? body.widgetId.trim() : '';
    if (!widgetId || widgetId.length > 100) {
      console.warn('[widget-copy] 400: invalid widgetId');
      return res.status(400).json({ error: 'widgetId is required' });
    }
    const customName = (typeof body.name === 'string' && body.name.trim()) ? body.name.trim().slice(0, 200) : null;

    // Look up source widget. Filter ALSO by ownership — defence in depth on
    // top of the field comparison below.
    const apiKey = process.env.AIRTABLE_KEY;
    const baseId = process.env.AIRTABLE_BASE_ID;
    if (!apiKey || !baseId) {
      console.error('[widget-copy] missing AIRTABLE env vars');
      return res.status(500).json({ error: 'Server configuration error' });
    }
    const headers = { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' };

    const safeWidgetId = widgetId.replace(/'/g, "\\'");
    const safeEmail = user.email.replace(/'/g, "\\'");
    const lookupFormula = encodeURIComponent(
      `AND({WidgetID}='${safeWidgetId}', {ClientEmail}='${safeEmail}')`
    );
    const lookupUrl = `${AIRTABLE_API}/${baseId}/${TABLE_NAME}?filterByFormula=${lookupFormula}&maxRecords=1`;
    const lookupResp = await fetch(lookupUrl, { headers });
    if (!lookupResp.ok) await throwAirtableError('Lookup failed', lookupResp);
    const lookupData = await lookupResp.json();
    const source = (lookupData.records || [])[0];
    if (!source) {
      // Either widgetId doesn't exist or it doesn't belong to this user.
      // We don't distinguish — same response either way to avoid leaking
      // the existence of other users' widgets.
      console.warn('[widget-copy] source not found or not owned', { widgetId, email: user.email });
      return res.status(404).json({ error: 'Widget not found' });
    }

    const sourceFields = source.fields || {};
    const sourceType = sourceFields.WidgetType;

    // Enquiry Forms have a different storage shape (pointer + real record
    // in a different base). Refuse here — caller should hit the dedicated
    // endpoint.
    if (sourceType === 'Enquiry Form') {
      return res.status(400).json({
        error: 'Use /api/enquiry-form-copy for Enquiry Forms',
        redirect: '/api/enquiry-form-copy'
      });
    }

    // Plan-limit check — a copy counts against the user's per-type quota.
    // Skip this check for unlimited types entirely.
    const userPlan = canonicalisePlan(user.plan);
    const limits = userPlan ? PLAN_WIDGET_LIMITS[sourceType] : null;
    const planLimit = limits ? limits[userPlan] : null;
    if (planLimit !== null && planLimit !== -1 && planLimit !== undefined) {
      const currentCount = await countWidgetsOfType(headers, baseId, user.email, sourceType);
      if (currentCount >= planLimit) {
        return res.status(403).json({
          error: `You've reached your plan's limit of ${planLimit} ${sourceType} widget${planLimit === 1 ? '' : 's'}. Upgrade to copy more.`
        });
      }
    }

    // Mint new widgetId — same format as widget-config's create path
    const newWidgetId = `tgw_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    // Derive new name: caller-supplied wins; otherwise "<original> (Copy)".
    // Cap at 200 chars to keep Airtable happy and prevent ever-growing names
    // when users copy a copy (e.g. "X (Copy) (Copy) (Copy)" still fits).
    const originalName = (sourceFields.Name || '').trim();
    const derivedName = customName || `${originalName} (Copy)`.slice(0, 200);

    // Stamp ClientRecordId — the AUTHORITATIVE owner. widget-list scopes a
    // client workspace by {ClientRecordId}='<activeClientId>' and, for a staff
    // member whose login email is shared across accounts, drops the ClientEmail
    // fallback entirely. So a copy created WITHOUT ClientRecordId (as this
    // endpoint did) never appears in the list even though it was created — the
    // "copied widget doesn't show" bug. A copy belongs to the same client as
    // its source, so carry the source's ClientRecordId; fall back to the
    // session's client if the source predates the field.
    const REC = /^rec[A-Za-z0-9]{14}$/;
    const srcOwner = typeof sourceFields.ClientRecordId === 'string' ? sourceFields.ClientRecordId : '';
    const copyClientRecordId = REC.test(srcOwner)
      ? srcOwner
      : (typeof user.clientId === 'string' && REC.test(user.clientId) ? user.clientId : '');

    const copyFields = {
      WidgetID: newWidgetId,
      Name: derivedName,
      // Carry the full config blob verbatim. Includes theme, layout,
      // colours, copy content, integrations — everything the user
      // configured on the original. The user opted-in to copying
      // credentials when they chose this action.
      Config: sourceFields.Config || '{}',
      Status: 'Active', // Generic widgets have no Draft concept; Active is the only value used.
      WidgetType: sourceType,
      ClientName: user.clientName || sourceFields.ClientName || '',
      ClientEmail: user.email,
      CreatedAt: new Date().toISOString(),
      UpdatedAt: new Date().toISOString(),
    };
    if (copyClientRecordId) {
      copyFields.ClientRecordId = copyClientRecordId;
    } else {
      console.warn(`[widget-copy] copy ${newWidgetId} created WITHOUT ClientRecordId ` +
        `(source ${widgetId} had none, session clientId unusable) — it may not appear in the scoped list.`);
    }

    const createUrl = `${AIRTABLE_API}/${baseId}/${TABLE_NAME}`;
    const createResp = await fetch(createUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        records: [{ fields: copyFields }],
      }),
    });
    if (!createResp.ok) await throwAirtableError('Create failed', createResp);
    const created = await createResp.json();

    return res.status(201).json({
      success: true,
      widgetId: newWidgetId,
      recordId: created.records[0].id,
      name: derivedName,
    });
  } catch (err) {
    console.error('[widget-copy]', err.message);
    return res.status(500).json({ error: 'Service temporarily unavailable' });
  }
}
