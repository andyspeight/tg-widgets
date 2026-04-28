/**
 * Enquiry Form Config API
 * GET  /api/enquiry-form-config?id=WIDGET_ID    → public, returns form config for widget rendering
 * POST /api/enquiry-form-config                  → AUTHENTICATED, creates/updates form
 * DELETE /api/enquiry-form-config?id=WIDGET_ID  → AUTHENTICATED, archives form
 *
 * This endpoint fans out every write to TWO tables:
 *   1. "Widgets" table (appAYzWZxvK6qlwXK · tblVAThVqAjqtria2)
 *      — pointer record so the form appears in the dashboard catalogue
 *   2. "Enquiry Forms" table (appAYzWZxvK6qlwXK · tblpw4TCmQfJHZIlF)
 *      — real record with all 42 typed fields
 *
 * Ownership is tracked by:
 *   - Widgets.ClientEmail (existing pattern)
 *   - Enquiry Forms.Owner Email (fldLzWF0XnEXeZYH1)
 *
 * The two records are linked by a shared WidgetID (tgw_...).
 * Form ID (EF-####) comes from the Enquiry Forms table formula, read after create.
 */
import {
  requireAuth,
  sanitiseForFormula,
  sanitiseConfig,
  setCors,
  applyRateLimit,
  RATE_LIMITS,
} from './_auth.js';

const AIRTABLE_API = 'https://api.airtable.com/v0';
const WIDGETS_TABLE = 'Widgets';
const ENQUIRY_FORMS_TABLE = 'tblpw4TCmQfJHZIlF'; // table ID — name has spaces

const WIDGET_TYPE = 'Enquiry Form';

// Enquiry Forms field IDs (never use field names — they drift)
const EF = {
  formName:            'fldC0MLSyJqg6U1zT',
  sequential:          'fldatpd9Ms5J5JGPy',
  clientName:          'fldrw1eTFYCFIo0pp',
  status:              'fldTR9W1dhMRoT0MK',
  template:            'fldaM2kxvZDutozGT',
  layoutMode:          'fldCEfu1NVD9Ewp4O',
  fieldsJSON:          'fldYdK8X3BgN7hPCx',
  // stepsJSON — multi-step form step metadata (array of { id, label }).
  // Only meaningful when layoutMode === 'multi-step'. Stored as a JSON
  // string alongside fieldsJSON; individual field objects within fieldsJSON
  // carry a `step` property pointing at one of these step IDs.
  stepsJSON:           'flddIHep7nOXNugJK',
  headerTitle:         'fldCflEWJo9YxxA8Y',
  headerSubtitle:      'fldRBu8uajKutfX60',
  submitButtonText:    'fldjrfgcfK7580bft',
  thankYouMode:        'fldTy6oSMKUwYEYjQ',
  thankYouMessage:     'fldiB3PkfcsHRKEWd',
  redirectUrl:         'fldYkShCNfibHChpg',
  referencePrefix:     'fldXJxPXCLBnQeb7f',
  buttonColour:        'fldxyawmdBzNiOb7g',
  accentColour:        'fldD113UMPvDR4zOL',
  theme:               'fldliFN8Q7koARRU5',
  // Routing flags
  routingGoogleSheets: 'fldGg7Yew1GCkmW08',
  sheetId:             'fldtfW0lFELg7yiv2',
  sheetTab:            'fldJ9KIeaiVsU4jP4',
  routingAirtable:     'fld3JRqVuEKw2R9Hy',
  airtableBaseId:      'fldMJzweCfekIBAoF',
  airtableTableId:     'flddiEIebjjtGJMWY',
  airtablePAT:         'fldA6v05RBuCovsh6',
  airtablePATVerifiedAt:'fldU9OeeLqwRVfPYN',
  airtablePATLastError:'fldEvB2ncXRAVZQIG',
  airtableFieldMap:    'fldMF5oFaWCyqsNhL',
  routingEmail:        'fldkwZwxheNZJ8CrH',
  routingEmailTo:      'fldlu1HcErBfp2wh2',
  routingAutoReply:    'fldmqrE0BG0xuWTMx',
  emailTemplateHTML:   'fldmboZUbr73kiuyJ',
  autoReplyHTML:       'fldTocc7Yd5IurXVl',
  routingWebhook:      'fldH7rQpSid6uqw0p',
  webhookURL:          'fldNyUqKUUDElxrGS',
  webhookSecret:       'fldcoECqbqhWSj7eW',
  routingLunaWork:     'fld3RUFhBQPmFZpAW',
  routingLunaMarketing:'fld1HDVC7zzb5LL4d',
  routingLunaChat:     'fldrnewg30EV3xMzY',
  antiSpamHoneypot:    'fldVTzbUzzLjVldEk',
  antiSpamRateLimit:   'fldgwmG6xCrGuniEa',
  antiSpamTurnstile:   'fldl0efl9oLr2hngY',
  allowedOrigins:      'fldTOt0kOMUooJCuC',
  submissionCount:     'fldvjS3fx96TGmkax',
  formId:              'fldZTiyzyhXjCIapn', // formula — read only
  widgetId:            'fld4LTXFnaJahj0uX',
  ownerEmail:          'fldLzWF0XnEXeZYH1',
};

// Thank You Mode options (must match Airtable singleSelect exactly)
const THANK_YOU_MODES = ['inline', 'replace', 'redirect'];

// Rate-limit tier options
const RATE_LIMIT_TIERS = ['strict', 'standard', 'lenient'];

// Theme options
const THEMES = ['light', 'dark', 'auto'];

// Status options
const STATUS_OPTIONS = ['Draft', 'Live', 'Archived'];

// Layout mode options
const LAYOUT_MODES = ['single-page', 'multi-step'];

// Template options (for analytics only)
const TEMPLATE_OPTIONS = ['Holiday Enquiry', 'Cruise Enquiry', 'Tour Enquiry', 'Tailor-Made', 'Group Travel', 'Blank'];

// ────────────────────────────────────────────────────────────────
//  Helpers
// ────────────────────────────────────────────────────────────────

function whitelist(value, allowed, fallback) {
  if (typeof value !== 'string') return fallback;
  return allowed.includes(value) ? value : fallback;
}

function safeStr(value, max = 500) {
  if (typeof value !== 'string') return '';
  return value.slice(0, max);
}

function safeBool(value) {
  return value === true || value === 'true' || value === 1;
}

function generateWebhookSecret() {
  // 32 bytes of entropy, hex-encoded = 64 chars. Good enough for HMAC signing.
  const arr = new Uint8Array(32);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(arr);
  } else {
    // Node fallback
    const nodeCrypto = require('crypto');
    const buf = nodeCrypto.randomBytes(32);
    for (let i = 0; i < 32; i++) arr[i] = buf[i];
  }
  return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
}

// Build the Airtable fields body for Enquiry Forms write from the editor payload
function buildEnquiryFormFields(payload, userEmail, isCreate) {
  const fields = {};

  if (payload.name !== undefined)              fields[EF.formName] = safeStr(payload.name, 200);
  if (payload.clientName !== undefined)        fields[EF.clientName] = safeStr(payload.clientName, 200);
  if (payload.status !== undefined)            fields[EF.status] = whitelist(payload.status, STATUS_OPTIONS, 'Draft');
  if (payload.template !== undefined)          fields[EF.template] = whitelist(payload.template, TEMPLATE_OPTIONS, 'Blank');
  if (payload.layoutMode !== undefined)        fields[EF.layoutMode] = whitelist(payload.layoutMode, LAYOUT_MODES, 'single-page');
  if (payload.fieldsJSON !== undefined) {
    // fieldsJSON is the source of truth for what the widget renders.
    // Always stored as a JSON string; reject anything non-serialisable.
    try {
      const s = typeof payload.fieldsJSON === 'string'
        ? payload.fieldsJSON
        : JSON.stringify(payload.fieldsJSON);
      if (s.length > 200000) throw new Error('fieldsJSON too large');
      fields[EF.fieldsJSON] = s;
    } catch (e) {
      throw new Error('Invalid fieldsJSON: ' + e.message);
    }
  }
  if (payload.stepsJSON !== undefined) {
    // stepsJSON — multi-step step metadata as JSON string.
    // Expected shape: [{ id: 1, label: 'Your trip' }, ...]. Unused when
    // layoutMode === 'single-page' but always safe to persist — the widget
    // only consults it when in multi-step mode.
    try {
      const raw = typeof payload.stepsJSON === 'string'
        ? payload.stepsJSON
        : JSON.stringify(payload.stepsJSON);
      if (raw.length > 10000) throw new Error('stepsJSON too large');
      // Validate structure — must be an array of { id: number, label: string }
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) throw new Error('stepsJSON must be an array');
      parsed.forEach((s, i) => {
        if (!s || typeof s !== 'object') throw new Error(`stepsJSON[${i}] must be an object`);
        if (typeof s.id !== 'number' || !Number.isInteger(s.id) || s.id < 1) {
          throw new Error(`stepsJSON[${i}].id must be a positive integer`);
        }
        if (typeof s.label !== 'string') throw new Error(`stepsJSON[${i}].label must be a string`);
      });
      // Re-stringify after parsing to canonicalise whitespace + truncate labels
      const clean = parsed.map(s => ({ id: s.id, label: String(s.label).slice(0, 80) }));
      fields[EF.stepsJSON] = JSON.stringify(clean);
    } catch (e) {
      throw new Error('Invalid stepsJSON: ' + e.message);
    }
  }
  if (payload.headerTitle !== undefined)       fields[EF.headerTitle] = safeStr(payload.headerTitle, 200);
  if (payload.headerSubtitle !== undefined)    fields[EF.headerSubtitle] = safeStr(payload.headerSubtitle, 500);
  if (payload.submitButtonText !== undefined)  fields[EF.submitButtonText] = safeStr(payload.submitButtonText, 60);
  if (payload.thankYouMode !== undefined)      fields[EF.thankYouMode] = whitelist(payload.thankYouMode, THANK_YOU_MODES, 'inline');
  if (payload.thankYouMessage !== undefined)   fields[EF.thankYouMessage] = safeStr(payload.thankYouMessage, 500);
  if (payload.redirectUrl !== undefined)       fields[EF.redirectUrl] = safeStr(payload.redirectUrl, 500);
  if (payload.referencePrefix !== undefined)   fields[EF.referencePrefix] = safeStr(payload.referencePrefix, 10);
  if (payload.buttonColour !== undefined)      fields[EF.buttonColour] = safeStr(payload.buttonColour, 10);
  if (payload.accentColour !== undefined)      fields[EF.accentColour] = safeStr(payload.accentColour, 10);
  if (payload.theme !== undefined)             fields[EF.theme] = whitelist(payload.theme, THEMES, 'light');

  // Routing destinations
  const r = payload.routing || {};
  if (r.googleSheets !== undefined) {
    fields[EF.routingGoogleSheets] = safeBool(r.googleSheets.enabled);
    if (r.googleSheets.sheetId !== undefined) fields[EF.sheetId] = safeStr(r.googleSheets.sheetId, 100);
    if (r.googleSheets.tab !== undefined)     fields[EF.sheetTab] = safeStr(r.googleSheets.tab, 100);
  }
  if (r.airtable !== undefined) {
    fields[EF.routingAirtable] = safeBool(r.airtable.enabled);
    if (r.airtable.baseId !== undefined)  fields[EF.airtableBaseId] = safeStr(r.airtable.baseId, 50);
    if (r.airtable.tableId !== undefined) fields[EF.airtableTableId] = safeStr(r.airtable.tableId, 50);
    // PAT is NEVER stored in plaintext — must be encrypted before it reaches here.
    // This endpoint trusts the caller to have encrypted it already; the editor
    // currently passes undefined and the encryption endpoint writes this field
    // directly. Leaving the write-through here as a placeholder for once that
    // endpoint exists.
    if (r.airtable.patEncrypted !== undefined) fields[EF.airtablePAT] = safeStr(r.airtable.patEncrypted, 5000);
    if (r.airtable.fieldMap !== undefined) {
      try {
        const s = typeof r.airtable.fieldMap === 'string'
          ? r.airtable.fieldMap
          : JSON.stringify(r.airtable.fieldMap);
        fields[EF.airtableFieldMap] = safeStr(s, 10000);
      } catch (e) { /* ignore */ }
    }
  }
  if (r.email !== undefined) {
    fields[EF.routingEmail] = safeBool(r.email.enabled);
    if (r.email.to !== undefined)            fields[EF.routingEmailTo] = safeStr(r.email.to, 2000);
    if (r.email.autoReply !== undefined)     fields[EF.routingAutoReply] = safeBool(r.email.autoReply);
    if (r.email.templateHTML !== undefined)  fields[EF.emailTemplateHTML] = safeStr(r.email.templateHTML, 100000);
    if (r.email.autoReplyHTML !== undefined) fields[EF.autoReplyHTML] = safeStr(r.email.autoReplyHTML, 100000);
  }
  if (r.webhook !== undefined) {
    fields[EF.routingWebhook] = safeBool(r.webhook.enabled);
    if (r.webhook.url !== undefined) fields[EF.webhookURL] = safeStr(r.webhook.url, 500);
    // Webhook secret: only generate once per form. If the caller provides one, use it;
    // otherwise the create path generates a fresh random secret below.
    if (r.webhook.secret !== undefined) fields[EF.webhookSecret] = safeStr(r.webhook.secret, 128);
  }
  if (r.lunaChat !== undefined)      fields[EF.routingLunaChat] = safeBool(r.lunaChat.enabled);
  if (r.lunaMarketing !== undefined) fields[EF.routingLunaMarketing] = safeBool(r.lunaMarketing.enabled);
  if (r.lunaWork !== undefined)      fields[EF.routingLunaWork] = safeBool(r.lunaWork.enabled);

  // Anti-spam
  const s = payload.security || {};
  if (s.honeypot !== undefined)    fields[EF.antiSpamHoneypot] = safeBool(s.honeypot);
  if (s.rateLimitTier !== undefined) fields[EF.antiSpamRateLimit] = whitelist(s.rateLimitTier, RATE_LIMIT_TIERS, 'standard');
  if (s.turnstile !== undefined)   fields[EF.antiSpamTurnstile] = safeBool(s.turnstile);
  if (s.allowedOrigins !== undefined) fields[EF.allowedOrigins] = safeStr(s.allowedOrigins, 2000);

  // Ownership + linkage — only set on create (never change on update)
  if (isCreate) {
    fields[EF.ownerEmail] = userEmail;
  }

  return fields;
}

// Convert an Enquiry Forms record back into the editor's config object shape
function readEnquiryFormRecord(record) {
  const f = record.fields;
  return {
    recordId: record.id,
    widgetId: f[EF.widgetId] || '',
    formId: f[EF.formId] || '',
    name: f[EF.formName] || '',
    clientName: f[EF.clientName] || '',
    status: f[EF.status] || 'Draft',
    template: f[EF.template] || 'Blank',
    layoutMode: f[EF.layoutMode] || 'single-page',
    fieldsJSON: f[EF.fieldsJSON] || '[]',
    // stepsJSON — multi-step metadata. Default to empty array string; the
    // widget's normaliser will synthesise one step per unique step ID it
    // finds in fieldsJSON when this is empty.
    stepsJSON: f[EF.stepsJSON] || '[]',
    headerTitle: f[EF.headerTitle] || '',
    headerSubtitle: f[EF.headerSubtitle] || '',
    submitButtonText: f[EF.submitButtonText] || 'Send my enquiry',
    thankYouMode: f[EF.thankYouMode] || 'inline',
    thankYouMessage: f[EF.thankYouMessage] || '',
    redirectUrl: f[EF.redirectUrl] || '',
    referencePrefix: f[EF.referencePrefix] || 'TG-',
    buttonColour: f[EF.buttonColour] || '#1B2B5B',
    accentColour: f[EF.accentColour] || '#00B4D8',
    theme: f[EF.theme] || 'light',
    routing: {
      googleSheets: { enabled: !!f[EF.routingGoogleSheets], sheetId: f[EF.sheetId] || '', tab: f[EF.sheetTab] || '' },
      airtable: {
        enabled: !!f[EF.routingAirtable],
        baseId: f[EF.airtableBaseId] || '',
        tableId: f[EF.airtableTableId] || '',
        hasPAT: !!f[EF.airtablePAT], // legacy — kept for backwards compat
        patSet: !!f[EF.airtablePAT],
        patVerifiedAt: f[EF.airtablePATVerifiedAt] || null,
        patLastError: f[EF.airtablePATLastError] || '',
        fieldMap: f[EF.airtableFieldMap] || '{}',
      },
      email: {
        enabled: f[EF.routingEmail] !== false, // default on
        to: f[EF.routingEmailTo] || '',
        autoReply: !!f[EF.routingAutoReply],
        templateHTML: f[EF.emailTemplateHTML] || '',
        autoReplyHTML: f[EF.autoReplyHTML] || '',
      },
      webhook: {
        enabled: !!f[EF.routingWebhook],
        url: f[EF.webhookURL] || '',
        // Return whether a secret exists, not the secret itself (editor can regenerate if needed)
        hasSecret: !!f[EF.webhookSecret],
      },
      lunaChat: { enabled: !!f[EF.routingLunaChat] },
      lunaMarketing: { enabled: !!f[EF.routingLunaMarketing] },
      lunaWork: { enabled: !!f[EF.routingLunaWork] },
    },
    security: {
      honeypot: f[EF.antiSpamHoneypot] !== false, // default on
      rateLimitTier: f[EF.antiSpamRateLimit] || 'standard',
      turnstile: !!f[EF.antiSpamTurnstile],
      allowedOrigins: f[EF.allowedOrigins] || '',
    },
    submissionCount: f[EF.submissionCount] || 0,
  };
}

// ────────────────────────────────────────────────────────────────
//  Airtable fetch helpers
// ────────────────────────────────────────────────────────────────

async function fetchWidgetsRecord(widgetId, headers, baseId) {
  const safe = sanitiseForFormula(widgetId);
  const formula = encodeURIComponent(`{WidgetID} = '${safe}'`);
  const url = `${AIRTABLE_API}/${baseId}/${WIDGETS_TABLE}?filterByFormula=${formula}&maxRecords=1`;
  const resp = await fetch(url, { headers });
  if (!resp.ok) throw new Error('Widgets lookup failed');
  const data = await resp.json();
  return data.records && data.records[0] ? data.records[0] : null;
}

async function fetchEnquiryFormByWidgetId(widgetId, headers, baseId) {
  const safe = sanitiseForFormula(widgetId);
  // Filter by field ID using Airtable's field-ID syntax in formulas — use the field name here
  // since filterByFormula requires field names. "Widget ID" is the display name.
  const formula = encodeURIComponent(`{Widget ID} = '${safe}'`);
  const url = `${AIRTABLE_API}/${baseId}/${ENQUIRY_FORMS_TABLE}?filterByFormula=${formula}&maxRecords=1&returnFieldsByFieldId=true`;
  const resp = await fetch(url, { headers });
  if (!resp.ok) throw new Error('Enquiry Forms lookup failed');
  const data = await resp.json();
  return data.records && data.records[0] ? data.records[0] : null;
}

// ────────────────────────────────────────────────────────────────
//  Handler
// ────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { AIRTABLE_KEY, AIRTABLE_BASE_ID } = process.env;
  if (!AIRTABLE_KEY || !AIRTABLE_BASE_ID) {
    return res.status(500).json({ error: 'Server configuration error' });
  }
  const headers = {
    'Authorization': `Bearer ${AIRTABLE_KEY}`,
    'Content-Type': 'application/json',
  };

  try {
    // ── GET: public, returns form config by widgetId (for widget rendering) ──
    if (req.method === 'GET') {
      const widgetId = req.query.id;
      if (!widgetId || typeof widgetId !== 'string' || widgetId.length > 100) {
        return res.status(400).json({ error: 'Invalid widget ID' });
      }

      // For editor load path we also want the full record back; for widget
      // render path we only need the public subset. Use the `editor=1` query
      // param to switch modes — editor path requires auth, widget path is public.
      const editorMode = req.query.editor === '1';

      if (editorMode) {
        const auth = requireAuth(req);
        if (auth.error) return res.status(auth.status).json({ error: auth.error });

        const record = await fetchEnquiryFormByWidgetId(widgetId, headers, AIRTABLE_BASE_ID);
        if (!record) return res.status(404).json({ error: 'Form not found' });

        // Ownership check
        const ownerEmail = (record.fields[EF.ownerEmail] || '').toLowerCase().trim();
        const userEmail  = (auth.user.email || '').toLowerCase().trim();
        if (!ownerEmail || ownerEmail !== userEmail) {
          return res.status(403).json({ error: 'You do not have permission to view this form' });
        }

        return res.status(200).json(readEnquiryFormRecord(record));
      }

      // Public widget-render path. Only returns live forms; Draft/Archived return 404.
      const record = await fetchEnquiryFormByWidgetId(widgetId, headers, AIRTABLE_BASE_ID);
      if (!record) return res.status(404).json({ error: 'Form not found' });
      if (record.fields[EF.status] !== 'Live') {
        return res.status(404).json({ error: 'Form not found' });
      }

      const pub = readEnquiryFormRecord(record);

      // Build the security block for the public response. We only expose the
      // Turnstile sitekey when Turnstile is enabled on this form — saves a
      // DNS lookup + script load on forms that don't use it. The sitekey is
      // public by design (Cloudflare publishes it client-side on every site
      // using Turnstile), but keeping it conditional reduces attack surface
      // and stops bots scraping keys from forms that wouldn't validate them.
      //
      // If the form has turnstile enabled but the env var is missing, we leave
      // the sitekey null. The widget falls back to no challenge and submit.js
      // fails closed (fail-if-secret-missing) so the bad deploy gets caught
      // server-side rather than letting submissions through unchecked.
      const publicSecurity = {
        honeypot: pub.security.honeypot,
        turnstile: pub.security.turnstile,
      };
      if (pub.security.turnstile) {
        publicSecurity.turnstileSiteKey = process.env.TURNSTILE_SITE_KEY || null;
      }

      // Drop sensitive routing config from the public payload — only surface
      // what the widget actually needs to render and submit. The submit endpoint
      // re-reads the full record on submission so routing stays server-side.
      const publicConfig = {
        formId: pub.formId,
        widgetId: pub.widgetId,
        name: pub.name,
        header: { title: pub.headerTitle, subtitle: pub.headerSubtitle },
        submitText: pub.submitButtonText,
        thankYou: {
          mode: pub.thankYouMode,
          message: pub.thankYouMessage,
          redirectUrl: pub.redirectUrl,
        },
        branding: {
          buttonColour: pub.buttonColour,
          accentColour: pub.accentColour,
          theme: pub.theme,
        },
        fieldsJSON: pub.fieldsJSON,
        // Multi-step config — only meaningful when layoutMode === 'multi-step',
        // but we always expose both so the widget's normaliser has everything
        // it needs. Widget falls back to single-page if either is missing.
        layoutMode: pub.layoutMode || 'single-page',
        // Parse stepsJSON here so the widget receives an actual array. If
        // parsing fails, surface an empty array and let the widget synthesise
        // steps from the fields' step properties.
        steps: (function () {
          try { const parsed = JSON.parse(pub.stepsJSON || '[]'); return Array.isArray(parsed) ? parsed : []; }
          catch (e) { return []; }
        })(),
        security: publicSecurity,
      };
      res.setHeader('Cache-Control', 's-maxage=60, max-age=30, stale-while-revalidate=300');
      return res.status(200).json(publicConfig);
    }

    // ── POST: authenticated, create or update ──
    if (req.method === 'POST') {
      const auth = requireAuth(req);
      if (auth.error) return res.status(auth.status).json({ error: auth.error });
      const user = auth.user;

      if (!applyRateLimit(res, `enquiry-save:${user.email}`, RATE_LIMITS.widgetWrite)) return;

      const body = req.body || {};
      const payload = sanitiseConfig(body.config || {});
      const widgetId = body.widgetId && typeof body.widgetId === 'string' ? body.widgetId : null;

      // Basic sanity: need at least a name when creating
      if (!widgetId) {
        if (!payload.name || typeof payload.name !== 'string' || payload.name.trim().length === 0) {
          return res.status(400).json({ error: 'name is required when creating a new form' });
        }
      }

      // ── UPDATE path ──
      if (widgetId) {
        // Fetch both records
        const [pointerRec, efRec] = await Promise.all([
          fetchWidgetsRecord(widgetId, headers, AIRTABLE_BASE_ID),
          fetchEnquiryFormByWidgetId(widgetId, headers, AIRTABLE_BASE_ID),
        ]);

        if (!efRec) return res.status(404).json({ error: 'Form not found' });

        // Ownership check against the real record (source of truth for enquiry forms)
        const ownerEmail = (efRec.fields[EF.ownerEmail] || '').toLowerCase().trim();
        const userEmail  = (user.email || '').toLowerCase().trim();
        if (!ownerEmail || ownerEmail !== userEmail) {
          return res.status(403).json({ error: 'You do not have permission to edit this form' });
        }

        // Auto-generate webhook secret on first enable.
        // Mirrors the CREATE path: when the agent toggles webhook routing ON
        // for the first time, mint a fresh signing secret server-side. The
        // submit endpoint requires this secret to sign HMAC headers — without
        // it, every webhook delivery will fail closed with "signing secret
        // missing". This block patches the gap that existed pre-2026-04-28
        // where the secret was only generated on CREATE.
        const webhookBeingEnabled = payload.routing && payload.routing.webhook && payload.routing.webhook.enabled === true;
        const existingSecret = efRec.fields[EF.webhookSecret];
        const callerSuppliedSecret = payload.routing && payload.routing.webhook && payload.routing.webhook.secret;
        if (webhookBeingEnabled && !existingSecret && !callerSuppliedSecret) {
          payload.routing.webhook.secret = generateWebhookSecret();
          console.log('[enquiry-form-config] Auto-generated webhook secret on update for', widgetId);
        }

        // Build the Enquiry Forms update body
        let efFields;
        try {
          efFields = buildEnquiryFormFields(payload, user.email, false);
        } catch (err) {
          return res.status(400).json({ error: err.message });
        }

        // Patch the Enquiry Forms record
        const efPatchUrl = `${AIRTABLE_API}/${AIRTABLE_BASE_ID}/${ENQUIRY_FORMS_TABLE}/${efRec.id}`;
        const efPatchResp = await fetch(efPatchUrl, {
          method: 'PATCH',
          headers,
          body: JSON.stringify({ fields: efFields }),
        });
        if (!efPatchResp.ok) {
          const errText = await efPatchResp.text();
          console.error('[enquiry-form-config] Enquiry Forms PATCH failed:', efPatchResp.status, errText.slice(0, 300));
          throw new Error('Enquiry Forms update failed');
        }

        // Patch the pointer record — keep Name + Config in sync so the dashboard mini-preview is correct
        if (pointerRec) {
          const pointerConfig = JSON.stringify({
            formId: efRec.fields[EF.formId] || '',
            status: payload.status || 'Draft',
            submissionCount: efRec.fields[EF.submissionCount] || 0,
          });
          const pointerPatchUrl = `${AIRTABLE_API}/${AIRTABLE_BASE_ID}/${WIDGETS_TABLE}/${pointerRec.id}`;
          await fetch(pointerPatchUrl, {
            method: 'PATCH',
            headers,
            body: JSON.stringify({
              fields: {
                Name: safeStr(payload.name || pointerRec.fields.Name || 'Enquiry Form', 200),
                Config: pointerConfig,
                UpdatedAt: new Date().toISOString(),
              },
            }),
          });
        }

        // Re-fetch the updated record to return canonical state
        const fresh = await fetchEnquiryFormByWidgetId(widgetId, headers, AIRTABLE_BASE_ID);
        return res.status(200).json({
          success: true,
          widgetId,
          form: readEnquiryFormRecord(fresh),
        });
      }

      // ── CREATE path ──
      // Mint the widgetId server-side (never trust client)
      const newWidgetId = `tgw_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

      // Generate webhook secret up-front if webhook routing is enabled
      if (payload.routing && payload.routing.webhook && payload.routing.webhook.enabled && !payload.routing.webhook.secret) {
        payload.routing.webhook.secret = generateWebhookSecret();
      }

      // Build Enquiry Forms fields
      let efFields;
      try {
        efFields = buildEnquiryFormFields(payload, user.email, true);
      } catch (err) {
        return res.status(400).json({ error: err.message });
      }
      efFields[EF.widgetId] = newWidgetId;
      // Default submission count to 0 on create
      efFields[EF.submissionCount] = 0;
      // Default status to Draft on create unless the caller explicitly set Live
      if (!efFields[EF.status]) efFields[EF.status] = 'Draft';

      // Create the Enquiry Forms record FIRST so we can read the generated Form ID
      const efCreateUrl = `${AIRTABLE_API}/${AIRTABLE_BASE_ID}/${ENQUIRY_FORMS_TABLE}?returnFieldsByFieldId=true`;
      const efCreateResp = await fetch(efCreateUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({ records: [{ fields: efFields }] }),
      });
      if (!efCreateResp.ok) {
        const errText = await efCreateResp.text();
        console.error('[enquiry-form-config] Enquiry Forms create failed:', efCreateResp.status, errText.slice(0, 400));
        return res.status(500).json({ error: 'Form create failed (enquiry forms table)' });
      }
      const efCreated = await efCreateResp.json();
      const newEfRec = efCreated.records[0];
      const newFormId = newEfRec.fields[EF.formId] || '';

      // Now create the pointer record in Widgets
      const pointerConfig = JSON.stringify({
        formId: newFormId,
        status: efFields[EF.status],
        submissionCount: 0,
      });

      const pointerCreateUrl = `${AIRTABLE_API}/${AIRTABLE_BASE_ID}/${WIDGETS_TABLE}`;
      const pointerCreateResp = await fetch(pointerCreateUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          records: [{
            fields: {
              WidgetID: newWidgetId,
              Name: safeStr(payload.name, 200),
              Config: pointerConfig,
              Status: 'Active',
              WidgetType: WIDGET_TYPE,
              ClientName: user.clientName || '',
              ClientEmail: user.email,
              CreatedAt: new Date().toISOString(),
              UpdatedAt: new Date().toISOString(),
            },
          }],
        }),
      });

      // If pointer create fails, rollback the Enquiry Forms record so we don't orphan it
      if (!pointerCreateResp.ok) {
        const errText = await pointerCreateResp.text();
        console.error('[enquiry-form-config] Widgets pointer create failed, rolling back EF record:', pointerCreateResp.status, errText.slice(0, 300));
        try {
          await fetch(`${AIRTABLE_API}/${AIRTABLE_BASE_ID}/${ENQUIRY_FORMS_TABLE}/${newEfRec.id}`, {
            method: 'DELETE',
            headers,
          });
        } catch (rbErr) {
          console.error('[enquiry-form-config] Rollback also failed — orphaned EF record:', newEfRec.id, rbErr.message);
        }
        return res.status(500).json({ error: 'Form create failed (pointer record)' });
      }

      return res.status(201).json({
        success: true,
        widgetId: newWidgetId,
        form: readEnquiryFormRecord(newEfRec),
      });
    }

    // ── DELETE: authenticated, archive (soft-delete) ──
    if (req.method === 'DELETE') {
      const auth = requireAuth(req);
      if (auth.error) return res.status(auth.status).json({ error: auth.error });
      const user = auth.user;

      if (!applyRateLimit(res, `enquiry-delete:${user.email}`, RATE_LIMITS.widgetWrite)) return;

      const widgetId = req.query.id;
      if (!widgetId || typeof widgetId !== 'string' || widgetId.length > 100) {
        return res.status(400).json({ error: 'Invalid or missing widget ID' });
      }

      const efRec = await fetchEnquiryFormByWidgetId(widgetId, headers, AIRTABLE_BASE_ID);
      if (!efRec) {
        // Idempotent
        return res.status(200).json({ success: true, alreadyGone: true });
      }

      // Ownership check
      const ownerEmail = (efRec.fields[EF.ownerEmail] || '').toLowerCase().trim();
      const userEmail  = (user.email || '').toLowerCase().trim();
      if (!ownerEmail || ownerEmail !== userEmail) {
        return res.status(403).json({ error: 'You do not have permission to delete this form' });
      }

      // Soft-delete: set status to Archived on Enquiry Forms + Status=Archived on pointer.
      // We keep the records so existing submissions still resolve their form context,
      // and so "restore" remains possible. A future hard-delete endpoint can be added
      // behind an admin auth check.
      const efPatchUrl = `${AIRTABLE_API}/${AIRTABLE_BASE_ID}/${ENQUIRY_FORMS_TABLE}/${efRec.id}`;
      await fetch(efPatchUrl, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ fields: { [EF.status]: 'Archived' } }),
      });

      const pointerRec = await fetchWidgetsRecord(widgetId, headers, AIRTABLE_BASE_ID);
      if (pointerRec) {
        const pointerPatchUrl = `${AIRTABLE_API}/${AIRTABLE_BASE_ID}/${WIDGETS_TABLE}/${pointerRec.id}`;
        await fetch(pointerPatchUrl, {
          method: 'PATCH',
          headers,
          body: JSON.stringify({ fields: { Status: 'Archived', UpdatedAt: new Date().toISOString() } }),
        });
      }

      return res.status(200).json({ success: true, widgetId, archived: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('[enquiry-form-config]', err.message);
    return res.status(500).json({ error: 'Service temporarily unavailable' });
  }
}
