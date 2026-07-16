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
import { getRecord } from './_lib/auth/airtable.js';
import { USERS } from './_lib/auth/schema.js';
import { isStaffEmail } from './_lib/auth/staff.js';

const REC_ID_RE = /^rec[A-Za-z0-9]{14}$/;

/**
 * Hydrate the user's email AND linked client from the Users table when the JWT
 * didn't carry them.
 *
 * BACKGROUND: SSO-issued JWTs (Travelify cookie auth) sometimes lack `email`
 * and `clientId` even though they carry `recordId`. The legacy `signin.html`
 * flow puts them in the JWT; the cookie SSO flow doesn't always.
 *
 * Email is needed for the ownership check — without it the create path writes
 * `undefined` to OwnerEmail and the update path locks the user out with a 403.
 * clientId is needed to stamp ClientRecordId on the Widgets pointer — without
 * it the saved form is invisible in /api/widget-list (which scopes by
 * ClientRecordId) and the owner can never reopen it.
 *
 * Mirrors the hydrateLegacyUserFields helper in api/widget-config.js.
 *
 * @param {object} user — auth.user from requireAuth(). Mutated in place.
 */
async function hydrateUserFacts(user) {
  // Cookie-issued JWTs carry neither the email (needed for the ownership check)
  // nor the linked client. We need the client too now: the Widgets pointer we
  // write MUST carry ClientRecordId, because /api/widget-list scopes the
  // dashboard strictly by it (its ClientEmail fallback is dropped for staff
  // whose login email spans several accounts). Without the stamp the saved form
  // is invisible in the dashboard and the owner can't reopen it. One Users read
  // gives us both facts.
  if (!user || !user.recordId) return;
  const needEmail = !user.email;
  const needClient = !(typeof user.clientId === 'string' && REC_ID_RE.test(user.clientId));
  if (!needEmail && !needClient) return;
  try {
    const u = await getRecord(USERS.tableId, user.recordId);
    if (needEmail) {
      const email = u?.fields?.[USERS.fields.email];
      if (typeof email === 'string' && email.trim()) {
        user.email = email.trim();
        console.log('[enquiry-form-config] hydrated email from record:', user.recordId);
      } else {
        console.warn('[enquiry-form-config] hydrate failed: no email on user record', user.recordId);
      }
    }
    if (needClient) {
      const links = u?.fields?.[USERS.fields.client];
      const first = Array.isArray(links) ? links[0] : null;
      const id = typeof first === 'string' ? first : (first && first.id);
      if (typeof id === 'string' && REC_ID_RE.test(id)) user.clientId = id;
    }
  } catch (err) {
    console.warn('[enquiry-form-config] hydrate user facts failed:', err.message);
  }
}

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
  // Translations JSON — Layer-2 content i18n. Per-language overlays of the
  // author content (header, submit label, thank-you, field labels/placeholders/
  // help and option labels), keyed by 2-letter language code. Produced on save
  // by /api/enquiry-translate and stored as a JSON string. English is the source;
  // the widget overlays this per viewer language and falls back string by string.
  i18nJSON:            'fld0phLw3nKqM7UG6',
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

// Coerce to a single-line string with control characters removed and length
// capped. Done with a char-code loop (no regex) so it is robust and never
// introduces stray control characters itself.
function clampStr(value, cap) {
  if (typeof value !== 'string') return '';
  let out = '';
  for (let i = 0; i < value.length && out.length < cap; i++) {
    const c = value.charCodeAt(i);
    if (c < 32 || c === 127) continue;   // drop all control chars
    out += value[i];
  }
  return out;
}

// Validate + whitelist the Layer-2 translations object the editor sends. The
// shape is keyed by 2-letter language code; each language carries the same
// content slots as the source (header, submit label, thank-you, and per-field
// label/placeholder/help/option labels). Everything is capped to the same
// lengths as the source fields. Field entries are keyed by the field's stable
// `name`; option labels are keyed by the option's stable `value` — those keys
// are submission logic and stay exactly as the editor sends them (capped),
// never translated. Unknown keys, non-strings and empties are dropped. Returns a
// clean object (possibly empty). Mirrors the offers saved-offers i18n whitelist.
const I18N_LANG_CAP = 12;
const I18N_FIELDS_CAP = 80;     // distinct fields with translations per language
const I18N_OPTIONS_CAP = 80;    // distinct option values per field
const I18N_KEY_CAP = 200;       // field name / option value key length
const I18N_SLOT_CAP = { title: 200, subtitle: 500, submitButtonText: 60, thankYouMessage: 500, label: 200, placeholder: 200, help: 500, option: 120 };

function cleanTranslations(raw) {
  const src = (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw : {};
  const out = {};
  let langN = 0;
  for (const lang of Object.keys(src)) {
    if (langN >= I18N_LANG_CAP) break;
    if (!/^[a-z]{2}$/.test(lang)) continue;
    const inLang = (src[lang] && typeof src[lang] === 'object' && !Array.isArray(src[lang])) ? src[lang] : {};
    const o = {};

    // Header.
    const inHeader = (inLang.header && typeof inLang.header === 'object' && !Array.isArray(inLang.header)) ? inLang.header : {};
    const header = {};
    const ht = clampStr(inHeader.title, I18N_SLOT_CAP.title);
    const hs = clampStr(inHeader.subtitle, I18N_SLOT_CAP.subtitle);
    if (ht) header.title = ht;
    if (hs) header.subtitle = hs;
    if (Object.keys(header).length) o.header = header;

    // Submit + thank-you.
    const sb = clampStr(inLang.submitButtonText, I18N_SLOT_CAP.submitButtonText);
    const ty = clampStr(inLang.thankYouMessage, I18N_SLOT_CAP.thankYouMessage);
    if (sb) o.submitButtonText = sb;
    if (ty) o.thankYouMessage = ty;

    // Fields — keyed by field name.
    const inFields = (inLang.fields && typeof inLang.fields === 'object' && !Array.isArray(inLang.fields)) ? inLang.fields : {};
    const fields = {};
    let fieldN = 0;
    for (const rawName of Object.keys(inFields)) {
      if (fieldN >= I18N_FIELDS_CAP) break;
      const name = clampStr(rawName, I18N_KEY_CAP);
      if (!name) continue;
      const inF = (inFields[rawName] && typeof inFields[rawName] === 'object' && !Array.isArray(inFields[rawName])) ? inFields[rawName] : {};
      const fo = {};
      const lbl = clampStr(inF.label, I18N_SLOT_CAP.label);
      const ph = clampStr(inF.placeholder, I18N_SLOT_CAP.placeholder);
      const hp = clampStr(inF.help, I18N_SLOT_CAP.help);
      if (lbl) fo.label = lbl;
      if (ph) fo.placeholder = ph;
      if (hp) fo.help = hp;

      // Option labels — keyed by the option's stable value.
      const inOpts = (inF.options && typeof inF.options === 'object' && !Array.isArray(inF.options)) ? inF.options : {};
      const opts = {};
      let optN = 0;
      for (const rawVal of Object.keys(inOpts)) {
        if (optN >= I18N_OPTIONS_CAP) break;
        const val = clampStr(rawVal, I18N_KEY_CAP);
        if (!val) continue;
        const lab = clampStr(inOpts[rawVal], I18N_SLOT_CAP.option);
        if (lab) { opts[val] = lab; optN++; }
      }
      if (Object.keys(opts).length) fo.options = opts;

      if (Object.keys(fo).length) { fields[name] = fo; fieldN++; }
    }
    if (Object.keys(fields).length) o.fields = fields;

    if (Object.keys(o).length) { out[lang] = o; langN++; }
  }
  return out;
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
  if (payload.i18n !== undefined) {
    // Layer-2 translations. Validate + whitelist, then store as a JSON string.
    // Empty object clears the field. Never write unbounded data.
    try {
      const clean = cleanTranslations(payload.i18n);
      const s = Object.keys(clean).length ? JSON.stringify(clean) : '';
      if (s.length > 200000) throw new Error('translations too large');
      fields[EF.i18nJSON] = s;
    } catch (e) {
      throw new Error('Invalid i18n: ' + e.message);
    }
  }
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
  // Parse + re-validate the stored translations once, so a hand-edited record can
  // never inject junk into a render path. audienceLanguages is derived from the
  // languages that actually have translations, so the editor's language toggles
  // light up correctly on reload without needing a separate stored field.
  let i18n = {};
  try { i18n = cleanTranslations(JSON.parse(f[EF.i18nJSON] || '{}')); } catch (e) { i18n = {}; }
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
    // Layer-2 translations (parsed + re-validated above) plus the derived set of
    // languages that carry translations, for the editor's language toggles.
    i18n: i18n,
    audienceLanguages: Object.keys(i18n),
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
        console.warn('[enquiry-form-config] GET 400: invalid widget ID', { received: typeof widgetId, length: widgetId && widgetId.length });
        return res.status(400).json({ error: 'Invalid widget ID' });
      }

      // For editor load path we also want the full record back; for widget
      // render path we only need the public subset. Use the `editor=1` query
      // param to switch modes — editor path requires auth, widget path is public.
      const editorMode = req.query.editor === '1';

      if (editorMode) {
        const auth = requireAuth(req);
        if (auth.error) return res.status(auth.status).json({ error: auth.error });
        // Hydrate email from user record if JWT didn't carry it (SSO cookie sessions).
        await hydrateUserFacts(auth.user);

        const record = await fetchEnquiryFormByWidgetId(widgetId, headers, AIRTABLE_BASE_ID);
        if (!record) return res.status(404).json({ error: 'Form not found' });

        // Access check. Travelgenix staff can open any client's form ("act as
        // client" support capability, per staff.js); otherwise the signed-in
        // user must be the form's owner.
        const ownerEmail = (record.fields[EF.ownerEmail] || '').toLowerCase().trim();
        const userEmail  = (auth.user.email || '').toLowerCase().trim();
        if (!isStaffEmail(userEmail) && (!ownerEmail || ownerEmail !== userEmail)) {
          console.warn('[enquiry-form-config] GET 403: ownership mismatch', { ownerEmail: ownerEmail || '(empty)', userEmail: userEmail || '(empty)', widgetId });
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
        // Layer-2 translations — per-language overlays of the author content.
        // The widget overlays these for the viewer's language and falls back
        // string by string to the English source above.
        i18n: pub.i18n,
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
      // Hydrate email from user record if JWT didn't carry it (SSO cookie sessions).
      // MUST happen before rate-limit-by-email below — otherwise the rate
      // limit key collapses to 'enquiry-save:undefined' and one user can
      // exhaust the bucket for everyone.
      await hydrateUserFacts(user);

      // The session's owning client, used to stamp ClientRecordId on the Widgets
      // pointer. This is what /api/widget-list scopes the dashboard by, so a
      // pointer without it is invisible in the list. Only trust a well-formed id.
      const sessionClientId = (typeof user.clientId === 'string' && REC_ID_RE.test(user.clientId)) ? user.clientId : null;

      if (!applyRateLimit(res, `enquiry-save:${user.email}`, RATE_LIMITS.widgetWrite)) return;

      const body = req.body || {};
      const payload = sanitiseConfig(body.config || {});
      const widgetId = body.widgetId && typeof body.widgetId === 'string' ? body.widgetId : null;

      // CREATE path: name is no longer required upfront. Users iterate on
      // forms — palette, fields, routing — and may not name the form until
      // late in the session. Forcing a name before any save means autosave
      // hammers the API with 400s the moment they start dragging fields in.
      // Default to "Untitled form" when missing; the user can rename via
      // the name input at any point and the next save will update it.
      if (!widgetId) {
        const incomingName = (payload.name && typeof payload.name === 'string') ? payload.name.trim() : '';
        if (!incomingName) {
          payload.name = 'Untitled form';
        } else {
          payload.name = incomingName;
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

        // Access check against the real record (source of truth for enquiry
        // forms). Travelgenix staff can edit any client's form ("act as client"
        // support capability, per staff.js); otherwise the signed-in user must
        // be the form's owner.
        const ownerEmail = (efRec.fields[EF.ownerEmail] || '').toLowerCase().trim();
        const userEmail  = (user.email || '').toLowerCase().trim();
        if (!isStaffEmail(userEmail) && (!ownerEmail || ownerEmail !== userEmail)) {
          console.warn('[enquiry-form-config] UPDATE 403: ownership mismatch', { ownerEmail: ownerEmail || '(empty)', userEmail: userEmail || '(empty)', widgetId });
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
          console.warn('[enquiry-form-config] UPDATE 400 from validator:', err.message, 'widgetId:', widgetId);
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
          const pointerFields = {
            Name: safeStr(payload.name || pointerRec.fields.Name || 'Enquiry Form', 200),
            Config: pointerConfig,
            UpdatedAt: new Date().toISOString(),
          };
          // Backfill ClientRecordId on legacy pointers that never had it stamped
          // (every enquiry pointer created before this fix), so the form finally
          // shows up in the dashboard list. Only when the OWNER is the one saving
          // — a staff member editing someone else's form must not stamp their own
          // client onto it. Never overwrite an existing stamp.
          if (sessionClientId && !pointerRec.fields.ClientRecordId && userEmail && ownerEmail && userEmail === ownerEmail) {
            pointerFields.ClientRecordId = sessionClientId;
          }
          const pointerPatchUrl = `${AIRTABLE_API}/${AIRTABLE_BASE_ID}/${WIDGETS_TABLE}/${pointerRec.id}`;
          await fetch(pointerPatchUrl, {
            method: 'PATCH',
            headers,
            body: JSON.stringify({ fields: pointerFields }),
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
        console.warn('[enquiry-form-config] CREATE 400 from validator:', err.message, 'email:', user.email);
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

      const pointerCreateFields = {
        WidgetID: newWidgetId,
        Name: safeStr(payload.name, 200),
        Config: pointerConfig,
        Status: 'Active',
        WidgetType: WIDGET_TYPE,
        ClientName: user.clientName || '',
        ClientEmail: user.email,
        CreatedAt: new Date().toISOString(),
        UpdatedAt: new Date().toISOString(),
      };
      // Stamp the authoritative owner so the form shows in the dashboard list
      // (/api/widget-list scopes by ClientRecordId). Omit when the session gave
      // us no trustworthy client, exactly as api/widget-config.js does — never
      // write a guessed owner. The ClientEmail fallback still covers those.
      if (sessionClientId) {
        pointerCreateFields.ClientRecordId = sessionClientId;
      } else {
        console.warn('[enquiry-form-config] Creating pointer', newWidgetId, 'WITHOUT ClientRecordId — no session client id');
      }

      const pointerCreateUrl = `${AIRTABLE_API}/${AIRTABLE_BASE_ID}/${WIDGETS_TABLE}`;
      const pointerCreateResp = await fetch(pointerCreateUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({ records: [{ fields: pointerCreateFields }] }),
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
      // Hydrate email from user record if JWT didn't carry it (SSO cookie sessions).
      // Must happen before rate-limit-by-email below — see POST path for why.
      await hydrateUserFacts(user);

      if (!applyRateLimit(res, `enquiry-delete:${user.email}`, RATE_LIMITS.widgetWrite)) return;

      const widgetId = req.query.id;
      if (!widgetId || typeof widgetId !== 'string' || widgetId.length > 100) {
        console.warn('[enquiry-form-config] DELETE 400: invalid widget ID', { received: typeof widgetId, length: widgetId && widgetId.length });
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
        console.warn('[enquiry-form-config] DELETE 403: ownership mismatch', { ownerEmail: ownerEmail || '(empty)', userEmail: userEmail || '(empty)', widgetId });
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

// Test surface — pure validation logic, no network.
export const _test = { cleanTranslations, clampStr };
