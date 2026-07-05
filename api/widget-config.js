/**
 * Widget Config API (Hardened)
 * GET  /api/widget-config?id=WIDGET_ID  → public, returns config JSON (cached)
 * POST /api/widget-config               → AUTHENTICATED, creates/updates config
 * 
 * Security: GET is public (widgets must load without auth), POST requires valid session token.
 * All inputs sanitised before Airtable queries.
 */
import { requireAuth, sanitiseForFormula, sanitiseConfig, setCors, applyRateLimit, RATE_LIMITS, lookupClientCredentialsByEmail } from './_auth.js';
import { getJson } from './_redis.js';
import { evaluatePublicRateLimit } from './_lib/rate-limit-public.js';
import { logWidgetEvent } from './_lib/telemetry.js';

// Hydration fallback for cookie-issued JWTs that lack the legacy fields
// (email, plan) the rest of this endpoint depends on. Once every active
// session has been re-issued under the new auth/signin + auth/sso flow
// (which now embed email + plan natively), this fallback becomes a no-op.
import { getRecord, listAllRecords } from './_lib/auth/airtable.js';
import { USERS, CLIENTS, CATALOGUE, CLIENT_ENTITLEMENTS, PACKAGE_CATALOGUE } from './_lib/auth/schema.js';
import { normalisePlanValue } from './_lib/auth/plan.js';

/**
 * If the JWT carries userId but not email/plan/clientId (true for cookies
 * issued before the auth migration that started embedding those fields),
 * look the missing fields up by record ID and patch them onto the user
 * object in place. Failures are logged and swallowed so the request can
 * still proceed with whatever the JWT did carry.
 *
 * Hydration chain:
 *   - email: from USERS.email by user.recordId
 *   - clientId: from USERS.client[0] by user.recordId (linked-record array)
 *   - plan: from CLIENTS.plan by user.clientId (after clientId hydration)
 *
 * This is critical for legacy JWTs that lack BOTH clientId and plan —
 * without the clientId hop, plan hydration is skipped and the user
 * gets a hard 403 on widget save. Only runs when something is missing —
 * no perf hit on freshly-issued JWTs.
 */
async function hydrateLegacyUserFields(user) {
  if (!user) return;
  const needsEmail    = !user.email    && user.recordId;
  const needsClientId = !user.clientId && user.recordId;
  const needsPlan     = !user.plan;
  if (!needsEmail && !needsClientId && !needsPlan) return;

  // Diagnostic snapshot: what did the JWT carry before hydration? This is
  // what we'll have to work with if any of the lookups below fail.
  console.log('[widget-config] hydrate start:', {
    hasEmail:    !!user.email,
    hasRecordId: !!user.recordId,
    hasClientId: !!user.clientId,
    hasPlan:     !!user.plan,
    needsEmail, needsClientId, needsPlan,
  });

  // Step 1: hydrate email AND clientId from the user record in one fetch.
  // Both come from the same USERS table row, so we do a single getRecord
  // even when only one is needed.
  if (needsEmail || needsClientId) {
    try {
      const u = await getRecord(USERS.tableId, user.recordId);
      const f = u?.fields || {};
      if (needsEmail) {
        const email = f[USERS.fields.email];
        if (typeof email === 'string' && email.trim()) {
          user.email = email.trim();
        }
      }
      if (needsClientId) {
        // USERS.client is a linked-record array — take the first ID.
        // For multi-client users this picks an arbitrary one, but the
        // JWT should have carried the correct clientId. Falling back to
        // the first is consistent with the new middleware's behaviour.
        const clientIds = f[USERS.fields.client];
        if (Array.isArray(clientIds) && clientIds.length > 0 && typeof clientIds[0] === 'string') {
          user.clientId = clientIds[0];
        }
      }
    } catch (err) {
      console.warn('[widget-config] hydrate user fields failed:', err.message);
    }
  }

  // Step 2: hydrate plan from the client record. Runs AFTER clientId
  // hydration so a legacy JWT missing both can still resolve.
  //
  // Two fields can carry plan information:
  //   - CLIENTS.fields.plan    — singleSelect (legacy, manually populated)
  //   - CLIENTS.fields.package — linked record to Packages (SSO writes here)
  //
  // Try Plan first (older clients have this), fall back to Package
  // (SSO-created clients have this). Mirrors resolveClientPlan() in
  // _lib/auth/plan.js so the JWT-mint path and the hydration path agree.
  if (needsPlan && user.clientId) {
    try {
      const c = await getRecord(CLIENTS.tableId, user.clientId);
      const fields = c?.fields || {};

      // First try the legacy Plan singleSelect
      let raw = fields[CLIENTS.fields.plan];
      let plan = await normalisePlanValue(raw);
      let resolvedFrom = plan ? 'plan' : null;

      // Fall back to the Package linked record (SSO-managed clients)
      if (!plan) {
        raw = fields[CLIENTS.fields.package];
        plan = await normalisePlanValue(raw);
        if (plan) resolvedFrom = 'package';
      }

      // Diagnostic: which field gave us the answer, so log spelunking
      // tells us instantly whether the fallback fired or not.
      console.log('[widget-config] hydrate plan resolution:', {
        clientId: user.clientId,
        resolvedFrom: resolvedFrom || 'none',
        resolvedPlan: plan || null,
      });

      if (plan) user.plan = plan;
    } catch (err) {
      console.warn('[widget-config] hydrate plan failed:', err.message);
    }
  }

  // Diagnostic exit: what did we end up with? If user.plan is still empty
  // here despite needsPlan being true, the chain broke somewhere — look
  // at the warn lines above and the start log to figure out where.
  console.log('[widget-config] hydrate end:', {
    resolvedEmail:    !!user.email,
    resolvedClientId: !!user.clientId,
    resolvedPlan:     user.plan || null,
  });
}

const AIRTABLE_API = 'https://api.airtable.com/v0';
const TABLE_NAME = 'Widgets';

// ── Per-client supplier visibility ─────────────────────────────────────────
// The offer + map widgets hide offers from suppliers a client hasn't switched
// on in Control (/admin/suppliers.html → /api/admin/client-suppliers, stored
// as Redis suppliers:client:{clientId}). We resolve the selection at config-GET
// time and ship it inside the widget config so the widget can gate its own
// offer list — including the live-Travelify fallback, which a server-side cache
// filter would miss. Off by default per product decision: an EMPTY selection
// means "show all", so we attach supplierFilter ONLY when the client has chosen
// some suppliers. Stored keys are the master "prodType:id" (e.g. "Packages:61");
// we split them into the three integer lists the widget matches against — a
// package offer's flight.sid === accommodation.sid === its Packages supplier id.
async function supplierFilterForClient(clientId) {
  if (!clientId) return null;
  try {
    const rec = await getJson('suppliers:client:' + clientId);
    const keys = rec && Array.isArray(rec.enabled) ? rec.enabled : [];
    if (!keys.length) return null; // no selection → show all → nothing to ship
    const f = { flights: [], accommodation: [], packages: [] };
    for (const k of keys) {
      const i = String(k).indexOf(':');
      if (i < 1) continue;
      const id = parseInt(k.slice(i + 1), 10);
      if (!Number.isFinite(id)) continue;
      const prod = k.slice(0, i);
      if (prod === 'Flights') f.flights.push(id);
      else if (prod === 'Accommodation') f.accommodation.push(id);
      else if (prod === 'Packages') f.packages.push(id);
    }
    if (!f.flights.length && !f.accommodation.length && !f.packages.length) return null;
    return f;
  } catch (e) {
    // Fail open — a Redis hiccup must never blank a live widget.
    console.warn('[widget-config] supplier filter lookup failed:', e.message);
    return null;
  }
}

const REC_ID_RE = /^rec[A-Za-z0-9]{14}$/;
// Staff bypass the entitlement gate (they create widgets for demos/setup).
// Keep in sync with STAFF_DOMAINS in the dashboard and /api/widget-catalogue.
const ENTITLEMENT_STAFF_DOMAINS = ['travelgenix.io', 'travelgenix.com', 'agendas.group'];

/**
 * Capture the OWNING-CLIENT id from the session, trusting it ONLY when it
 * came from the JWT. Must be called on the raw `user` object BEFORE
 * hydrateLegacyUserFields() runs — once hydration fills user.clientId from
 * the user's first linked client (clientIds[0]), it's an arbitrary pick for
 * a multi-client staff member and no longer safe to act on.
 *
 * Returns the rec... id when trustworthy, else null.
 */
function captureSessionClientId(user) {
  return (user && typeof user.clientId === 'string' && REC_ID_RE.test(user.clientId))
    ? user.clientId
    : null;
}

/**
 * Decide whether the current session may modify (edit or delete) a widget.
 *
 * A widget belongs to a CLIENT, not the staff member who created it. The
 * authoritative owner is the widget's ClientRecordId. So the rule is:
 *
 *   - Widget HAS a ClientRecordId (stamped at creation, Stage 5 onward):
 *       permit iff the session's owning client === that ClientRecordId.
 *       Client-scoped — any user signed into the owning client passes,
 *       regardless of who originally created the widget. The session is the
 *       source of truth: a staff member who belongs to several clients can
 *       only act on the one they're currently signed into.
 *
 *   - Widget has NO ClientRecordId (legacy, pre-Stage-5):
 *       fall back to the original creator-email check so existing widgets
 *       keep working exactly as before. No regression.
 *
 * Fails closed in both branches.
 *
 * @returns {true | string} true if permitted, else a human-readable reason.
 */
function canModifyWidget(record, { sessionClientId, userEmail }) {
  const fields = record.fields || {};
  const widgetClientId = typeof fields.ClientRecordId === 'string'
    ? fields.ClientRecordId.trim()
    : '';

  // Does the authenticated user's own email match the widget's owning email?
  // This is the legacy ownership signal and the safe fallback below.
  const widgetEmail = (fields.ClientEmail || '').toLowerCase().trim();
  const email = (userEmail || '').toLowerCase().trim();
  const emailMatches = !!(widgetEmail && email && widgetEmail === email);

  // Authoritative path: widget has a known owning client.
  if (widgetClientId) {
    // The session carries a trustworthy owning client — the strong check.
    // A different client id is a genuine cross-client attempt: deny.
    if (sessionClientId) {
      return sessionClientId === widgetClientId ? true : 'client-mismatch';
    }
    // The session has NO owning client id at all (e.g. a legacy or stale token
    // issued before the clientId claim existed, or a sign-in path that omits
    // it). Do NOT hard-deny the real owner over a missing claim — fall back to
    // the same ClientEmail match the legacy path uses. Cross-client protection
    // is unaffected: an attacker's session would carry a *different* clientId
    // and be denied above; this branch only relaxes the id-absent case and
    // still requires the owning email to match. Fails closed otherwise.
    return emailMatches ? true : 'client-missing-email-mismatch';
  }

  // Legacy path: no owning client recorded — fall back to creator email.
  if (emailMatches) return true;
  return 'email-mismatch';
}

// Allowed widget type names. Canonical casing — must match the Airtable
// singleSelect "WidgetType" option names exactly (the field is case-sensitive).
// If you add a new widget type, update FIVE places:
//   1. This constant
//   2. PLAN_WIDGET_LIMITS below
//   3. The WidgetType singleSelect options in Airtable (lets configs save)
//   4. The WIDGETS array in public/index.html (the client dashboard)
//   5. A record in the Airtable CATALOGUE table (the admin catalogue page),
//      added via the "New product" drawer on /admin/catalogue.html, category
//      "Widget". Without this the widget will not appear in the admin catalogue.
// Also: editor + demo rewrites and a widget-*.js headers block in vercel.json.
const ALLOWED_WIDGET_TYPES = [
  'Pricing Table',
  'FAQ',
  'Google Reviews',
  'Testimonials',
  'Destination Spotlight',
  'Airport Spotlight',
  'Attraction Spotlight',
  'Weather',
  'Currency Converter',
  'World Clock',
  'Flight Time',
  'Stats Counter',
  'Spin Wheel',
  'Enquiry Form',
  'My Booking',
  'Quote PDF',
  'Text FX',
  'Logo Showcase',
  'Travel Offers',
  'Popup',
  'Countdown Timer',
  'Event Calendar',
  'Social Share',
  'WhatsApp Chat',
  'Opening Hours',
  'Newsletter Signup',
  'Contact Card',
  'Loader',
  'Maps',
  'YouTube',
  'RSS Feed',
  'Back to Top',
  'Announcement Bar',
  'Appointment',
  'Carousel',
  'Team Showcase',
  'World Map',
  'Travel Results AI',
  'Special Offers',
];

// Per-plan widget count limits, keyed by widgetType.
//   -1       = unlimited
//    0       = widget type not available on this plan
//   positive = max number of widgets of this type this plan can create
// KEEP IN SYNC with the WIDGETS array in public/index.html. If these drift,
// the dashboard will show one limit while the API enforces another.
const PLAN_WIDGET_LIMITS = {
  'Pricing Table':         { Spark: 1, Boost: 5, Ignite: -1, Bespoke: -1 },
  'FAQ':                   { Spark: 0, Boost: 3, Ignite: -1, Bespoke: -1 },
  'Google Reviews':        { Spark: 0, Boost: 3, Ignite: -1, Bespoke: -1 },
  'Testimonials':          { Spark: 0, Boost: 0, Ignite: -1, Bespoke: -1 },
  'Destination Spotlight': { Spark: 1, Boost: 3, Ignite: -1, Bespoke: -1 },
  'Airport Spotlight':     { Spark: 0, Boost: 3, Ignite: -1, Bespoke: -1 },
  'Attraction Spotlight':  { Spark: 0, Boost: 0, Ignite: -1, Bespoke: -1 },
  'Weather':               { Spark: 1, Boost: 3, Ignite: -1, Bespoke: -1 },
  'Currency Converter':    { Spark: 1, Boost: 3, Ignite: -1, Bespoke: -1 },
  'World Clock':           { Spark: 1, Boost: 3, Ignite: -1, Bespoke: -1 },
  'Flight Time':           { Spark: 1, Boost: 3, Ignite: -1, Bespoke: -1 },
  'Stats Counter':         { Spark: 1, Boost: 3, Ignite: -1, Bespoke: -1 },
  'Spin Wheel':            { Spark: 1, Boost: 3, Ignite: -1, Bespoke: -1 },
  'Enquiry Form':          { Spark: -1, Boost: -1, Ignite: -1, Bespoke: -1 },
  'My Booking':            { Spark: -1, Boost: -1, Ignite: -1, Bespoke: -1 },
  'Quote PDF':             { Spark: 1, Boost: 3, Ignite: -1, Bespoke: -1 },
  'Text FX':               { Spark: -1, Boost: -1, Ignite: -1, Bespoke: -1 },
  'Logo Showcase':         { Spark: -1, Boost: -1, Ignite: -1, Bespoke: -1 },
  'Travel Offers':         { Spark: -1, Boost: -1, Ignite: -1, Bespoke: -1 },
  'Popup':                 { Spark: 0, Boost: 3, Ignite: -1, Bespoke: -1 },
  'Countdown Timer':       { Spark: -1, Boost: -1, Ignite: -1, Bespoke: -1 },
  'Event Calendar':        { Spark: 0, Boost: 3, Ignite: -1, Bespoke: -1 },
  'Social Share':          { Spark: -1, Boost: -1, Ignite: -1, Bespoke: -1 },
  'WhatsApp Chat':         { Spark: -1, Boost: -1, Ignite: -1, Bespoke: -1 },
  'Opening Hours':         { Spark: -1, Boost: -1, Ignite: -1, Bespoke: -1 },
  'Newsletter Signup':     { Spark: -1, Boost: -1, Ignite: -1, Bespoke: -1 },
  'Contact Card':          { Spark: -1, Boost: -1, Ignite: -1, Bespoke: -1 },
  'Loader':                { Spark: 0, Boost: 3, Ignite: -1, Bespoke: -1 },
  'Maps':                  { Spark: 1, Boost: 3, Ignite: -1, Bespoke: -1 },
  'YouTube':               { Spark: 1, Boost: 3, Ignite: -1, Bespoke: -1 },
  'RSS Feed':              { Spark: 1, Boost: 3, Ignite: -1, Bespoke: -1 },
  'Back to Top':           { Spark: 1, Boost: 3, Ignite: -1, Bespoke: -1 },
  'Announcement Bar':      { Spark: 1, Boost: 3, Ignite: -1, Bespoke: -1 },
  'Appointment':           { Spark: 0, Boost: 0, Ignite: -1, Bespoke: -1 },
  'Carousel':              { Spark: 1, Boost: 3, Ignite: -1, Bespoke: -1 },
  'Team Showcase':         { Spark: 0, Boost: 3, Ignite: -1, Bespoke: -1 },
  'World Map':             { Spark: -1, Boost: -1, Ignite: -1, Bespoke: -1 },
  'Travel Results AI':     { Spark: 0, Boost: 0, Ignite: -1, Bespoke: -1 },
  'Special Offers':        { Spark: 0, Boost: 3, Ignite: -1, Bespoke: -1 },
};

// Canonical plan names recognised by PLAN_WIDGET_LIMITS lookups.
// PLAN_WIDGET_LIMITS keys use Title Case (Spark / Boost / Ignite / Bespoke);
// the JWT or hydrated user record might supply a casing variant or a
// suffix like "Ignite Plan". This map collapses all known variants down
// to the canonical Title-Case form. Anything that doesn't map returns
// null, which the caller treats as "unknown plan, deny".
const PLAN_ALIASES = {
  spark: 'Spark',
  boost: 'Boost',
  ignite: 'Ignite',
  bespoke: 'Bespoke',
};

function canonicalisePlan(raw) {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed) return null;
  // Direct match first (covers "Spark", "spark", "SPARK", "  spark  ")
  if (PLAN_ALIASES[trimmed]) return PLAN_ALIASES[trimmed];
  // Token match for noisy values like "Ignite Plan", "plan: boost", "boost-tier"
  // Split on non-letter characters so "ignite_plan" and "ignite plan" both work.
  const tokens = trimmed.split(/[^a-z]+/).filter(Boolean);
  for (const tok of tokens) {
    if (PLAN_ALIASES[tok]) return PLAN_ALIASES[tok];
  }
  return null;
}

// Widget-type alias map. Editors should send the canonical type names
// (matching ALLOWED_WIDGET_TYPES and the Airtable singleSelect options
// exactly), but accept common shorthand so a slug or short-form doesn't
// break a save. The match in ALLOWED_WIDGET_TYPES is already case-
// insensitive; this map adds aliases on top of that.
//
// Keys are lowercase, values are the canonical Title-Case form.
const WIDGET_TYPE_ALIASES = {
  // slug → canonical
  'pricing':           'Pricing Table',
  'pricing-table':     'Pricing Table',
  'reviews':           'Google Reviews',
  'google-reviews':    'Google Reviews',
  'faq':               'FAQ',
  'testimonials':      'Testimonials',
  'spotlight':         'Destination Spotlight',
  'destination':       'Destination Spotlight',
  'destination-spotlight': 'Destination Spotlight',
  'airport':           'Airport Spotlight',
  'airport-spotlight': 'Airport Spotlight',
  'attraction':            'Attraction Spotlight',
  'attraction-spotlight':  'Attraction Spotlight',
  'weather':           'Weather',
  'currency':          'Currency Converter',
  'currency-converter':'Currency Converter',
  'fx':                'Currency Converter',
  'converter':         'Currency Converter',
  'exchange':          'Currency Converter',
  'worldclock':        'World Clock',
  'world-clock':       'World Clock',
  'world clock':       'World Clock',
  'clock':             'World Clock',
  'timezone':          'World Clock',
  'timezones':         'World Clock',
  'flighttime':        'Flight Time',
  'flight-time':       'Flight Time',
  'flight time':       'Flight Time',
  'flight-distance':   'Flight Time',
  'distance':          'Flight Time',
  'statscounter':      'Stats Counter',
  'stats-counter':     'Stats Counter',
  'stats':             'Stats Counter',
  'counter':           'Stats Counter',
  'stat-counter':      'Stats Counter',
  'spinwheel':         'Spin Wheel',
  'spin-wheel':        'Spin Wheel',
  'spin the wheel':    'Spin Wheel',
  'wheel':             'Spin Wheel',
  'prize-wheel':       'Spin Wheel',
  'enquiry':           'Enquiry Form',
  'enquiry-form':      'Enquiry Form',
  'mybooking':         'My Booking',
  'my-booking':        'My Booking',
  'quote-pdf':         'Quote PDF',
  'quote':             'Quote PDF',
  'textfx':            'Text FX',
  'text-fx':           'Text FX',
  'logos':             'Logo Showcase',
  'logo-showcase':     'Logo Showcase',
  'offers':            'Travel Offers',
  'travel-offers':     'Travel Offers',
  'popup':             'Popup',
  'countdown':         'Countdown Timer',
  'countdown-timer':   'Countdown Timer',
  'events':            'Event Calendar',
  'event-calendar':    'Event Calendar',
  'share':             'Social Share',
  'social-share':      'Social Share',
  'whatsapp':          'WhatsApp Chat',
  'whatsapp-chat':     'WhatsApp Chat',
  'hours':             'Opening Hours',
  'opening-hours':     'Opening Hours',
  'newsletter':        'Newsletter Signup',
  'newsletter-signup': 'Newsletter Signup',
  'contact':           'Contact Card',
  'contact-card':      'Contact Card',
  'maps':              'Maps',
  'map':               'Maps',
  'google-maps':       'Maps',
  'youtube':           'YouTube',
  'youtube-feed':      'YouTube',
  'yt':                'YouTube',
  'rss':               'RSS Feed',
  'rss-feed':          'RSS Feed',
  'rss feed':          'RSS Feed',
  'news':              'RSS Feed',
  'feed':              'RSS Feed',
  'back to top':       'Back to Top',
  'backtotop':         'Back to Top',
  'back-to-top':       'Back to Top',
  'scroll-top':        'Back to Top',
  'scrolltop':         'Back to Top',
  'totop':             'Back to Top',
  'dealbar':           'Announcement Bar',
  'deal-bar':          'Announcement Bar',
  'announcement':      'Announcement Bar',
  'announcement-bar':  'Announcement Bar',
  'notification-bar':  'Announcement Bar',
  'promo-bar':         'Announcement Bar',
  'appointment':       'Appointment',
  'appointments':      'Appointment',
  'scheduler':         'Appointment',
  'callback':          'Appointment',
  'booking-scheduler': 'Appointment',
  'consultation':      'Appointment',
  // Special Offers (the offer builder workspace; embed widget is offers-grid).
  // NB 'offers' / 'travel-offers' map to the separate Travel Offers widget.
  'special-offers':        'Special Offers',
  'special offers':        'Special Offers',
  'special-offer-builder': 'Special Offers',
  'special offer builder': 'Special Offers',
  'offers-grid':           'Special Offers',
  'offer-builder':         'Special Offers',
};

function canonicaliseWidgetType(raw) {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  // Exact case-insensitive match against the canonical list first
  const direct = ALLOWED_WIDGET_TYPES.find(
    t => t.toLowerCase() === trimmed.toLowerCase()
  );
  if (direct) return direct;
  // Fall back to the alias map (slugs, short forms, kebab-case)
  return WIDGET_TYPE_ALIASES[trimmed.toLowerCase()] || null;
}

// Count existing widgets owned by this user, of a specific type.
// Used by the CREATE path to enforce plan limits.
//
// Takes baseId as a parameter rather than reading from process.env directly,
// because the destructured AIRTABLE_BASE_ID lives inside handler() scope and
// the previous version of this helper referenced an undefined identifier.
async function countUserWidgetsOfType(email, widgetType, headers, baseId) {
  const emailEsc = sanitiseForFormula(email.toLowerCase());
  const typeEsc  = sanitiseForFormula(widgetType);
  const formula = encodeURIComponent(
    `AND(LOWER({ClientEmail})='${emailEsc}',{WidgetType}='${typeEsc}')`
  );
  // Only fetch WidgetID to keep the payload tiny — we just need a count.
  // maxRecords capped at 100: all current plan limits are <=5, so this
  // always captures enough to detect "over limit" without paginating.
  const url = `${AIRTABLE_API}/${baseId}/${TABLE_NAME}`
    + `?filterByFormula=${formula}&maxRecords=100&fields%5B%5D=WidgetID`;
  const resp = await fetch(url, { headers });
  if (!resp.ok) await throwAirtableError('Count query failed', resp);
  const data = await resp.json();
  return (data.records || []).length;
}

/**
 * When an Airtable request fails, the response body contains structured
 * error info (e.g. {"error": {"type": "INVALID_MULTIPLE_CHOICE_OPTIONS",
 * "message": "..."}}). The default catch-and-throw pattern in this file
 * loses that detail — operators end up staring at "Create failed" in
 * Vercel logs with no clue what Airtable actually objected to.
 *
 * This helper reads the body (best-effort) and embeds it in the thrown
 * Error so the top-level catch can log it. The outer response to the
 * client stays the generic "Service temporarily unavailable" — we leak
 * nothing user-facing — but our logs now contain the actual cause.
 *
 * Call with: throwAirtableError('Create failed', createResp);
 */
async function throwAirtableError(opName, resp) {
  let body = '';
  try {
    body = await resp.text();
  } catch { /* response already consumed or network died */ }
  // Trim very long bodies to keep log lines manageable
  if (body.length > 800) body = body.slice(0, 800) + '…[truncated]';
  const detail = body ? ` — ${resp.status} ${body}` : ` — ${resp.status}`;
  throw new Error(opName + detail);
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { AIRTABLE_KEY, AIRTABLE_BASE_ID } = process.env;
  if (!AIRTABLE_KEY || !AIRTABLE_BASE_ID) return res.status(500).json({ error: 'Server configuration error' });

  const headers = { 'Authorization': `Bearer ${AIRTABLE_KEY}`, 'Content-Type': 'application/json' };

  try {
    // ── GET: Public — fetch config by widget ID ─────────────
    if (req.method === 'GET') {
      const startedAt = Date.now();
      const widgetId = typeof req.query.id === 'string' ? req.query.id.slice(0, 120) : '';

      // Telemetry: send response, then log after the bytes are flushed. Most
      // config GETs are cheap cache HITs, but we still log so a scan across
      // widget IDs (lots of 404s from one IP) is visible on the dashboard.
      let accountName = null;
      let widgetTypeVal = null;
      async function done(status, jsonBody) {
        res.status(status).json(jsonBody);
        await logWidgetEvent(req, {
          event: 'config',
          widgetId,
          widgetType: widgetTypeVal,
          accountName,
          status,
          latencyMs: Date.now() - startedAt,
        });
      }

      // Rate limit (cross-instance, fail-open). Generous — real embeds refresh
      // and the CDN absorbs most reads — but bounded so config can't be scraped.
      const rl = await evaluatePublicRateLimit(req, res, { event: 'config', widgetId });
      if (!rl.allowed) {
        return done(429, { error: `Too many requests. Retry in ${rl.retryAfter}s.` });
      }

      if (!req.query.id || typeof req.query.id !== 'string' || req.query.id.length > 100) {
        return done(400, { error: 'Invalid widget ID' });
      }

      // Sanitise before using in formula
      const safeId = sanitiseForFormula(req.query.id);
      const formula = encodeURIComponent(`{WidgetID} = '${safeId}'`);
      const url = `${AIRTABLE_API}/${AIRTABLE_BASE_ID}/${TABLE_NAME}?filterByFormula=${formula}&maxRecords=1`;

      const resp = await fetch(url, { headers });
      if (!resp.ok) await throwAirtableError('GET upstream failed', resp);

      const data = await resp.json();
      if (!data.records || data.records.length === 0) {
        return done(404, { error: 'Widget not found' });
      }

      const widgetRecord = data.records[0];
      const configStr = widgetRecord.fields.Config || '{}';
      const name = widgetRecord.fields.Name || '';
      const widgetType = widgetRecord.fields.WidgetType || '';
      widgetTypeVal = String(widgetType).trim() || null;
      const clientEmail = (widgetRecord.fields.ClientEmail || '').toLowerCase().trim();
      accountName = (widgetRecord.fields.ClientName || widgetRecord.fields['Client Name'] || clientEmail || '').toString().trim() || null;

      try {
        const config = JSON.parse(configStr);

        // Per-client integration credential injection.
        //
        // BACKGROUND: Travelify Offers credentials are stored centrally per
        // client in the ClientIntegrations table — not on each widget. The
        // offers editor strips appId/apiKey before saving (since "stored
        // centrally" is the design intent), and this is where they get
        // injected back in for the widget to use.
        //
        // Why GET-time injection rather than baked into Config at save time:
        // - Single source of truth — if a client rotates their Travelify
        //   key, every Offers widget picks it up on next load. No need to
        //   walk all widget records and update them.
        // - Per-client scoping — Travelgenix users get the Travelgenix creds,
        //   Company B users get Company B's. Whichever client owns the
        //   widget (via ClientEmail) is who the creds are looked up for.
        //
        // Note: the credentials ship in the widget config, so any visitor on
        // a customer site can read them via DevTools. Travelify devs have
        // confirmed the Offers API creds are safe to expose publicly (see
        // widget-offers.js header comment). If that changes in future,
        // switch this to proxy through /api/offers instead and keep creds
        // server-side.
        // The World Map builds Travelify booking deeplinks and needs the
        // client's AppID (the demo-account deeplinks in the shared cache are
        // rewritten to the client's own AppID). It does NOT call Travelify
        // directly, so it never needs the API key — inject the AppID alone.
        if ((widgetType === 'Travel Offers' || widgetType === 'World Map') && clientEmail) {
          try {
            const creds = await lookupClientCredentialsByEmail(clientEmail);
            if (creds) {
              config.appId = creds.appId;
              if (widgetType === 'Travel Offers') config.apiKey = creds.apiKey;
              // Attach the client's supplier visibility so the widget can hide
              // offers from suppliers they haven't switched on in Control. Only
              // present when the client has actually restricted their suppliers.
              const supplierFilter = await supplierFilterForClient(creds.recordId);
              if (supplierFilter) config.supplierFilter = supplierFilter;
            } else {
              console.warn('[widget-config] no Travelify credentials on Clients record for', clientEmail, 'widgetId:', widgetId);
              // Leave config without creds — widget will show "Missing Travelify credentials"
              // which correctly tells the user something is wrong.
            }
          } catch (credErr) {
            // Don't fail the whole config response if cred lookup fails — log
            // and let the widget show its missing-creds error. Avoids one
            // misconfigured client breaking the entire endpoint.
            console.error('[widget-config] Travelify cred lookup failed:', credErr.message, 'widgetId:', widgetId);
          }
        }

        // Build the base response. Returns { config, name } so the editor can
        // restore the widget name on load. Pre-existing clients reading the
        // response as the config object directly are still supported via the
        // _legacy fields spread on the root.
        const payload = { config, name, ...config };

        // recordId injection — AUTHENTICATED requests only.
        //
        // The editor needs the Airtable record ID (rec...) on reopen because
        // routing (/api/routing-configs) is keyed on the record ID, not the
        // public WidgetID (tgw_...). We expose it ONLY when the caller is a
        // signed-in user (editor), never to anonymous public embeds — there is
        // no reason to leak an internal identifier to every site visitor.
        //
        // requireAuth returns { user } when authenticated, { error, status }
        // otherwise. It never throws, so a public embed simply doesn't get the
        // field and the response shape is unchanged for them.
        let isAuthed = false;
        try {
          const auth = requireAuth(req);
          if (auth && auth.user) {
            payload.recordId = widgetRecord.id;
            isAuthed = true;
          }
        } catch (authErr) {
          // Soft-fail: if the auth check itself errors, just omit recordId.
          console.warn('[widget-config] GET soft-auth check failed:', authErr.message);
        }

        if (isAuthed) {
          // Never let a shared CDN cache the recordId-bearing response and
          // then serve it to an anonymous embed. Keep authed responses private.
          res.setHeader('Cache-Control', 'private, no-store');
        } else {
          res.setHeader('Cache-Control', 's-maxage=300, max-age=60, stale-while-revalidate=600');
        }
        return done(200, payload);
      } catch {
        return done(500, { error: 'Widget data corrupted' });
      }
    }

    // ── POST: Authenticated — create or update config ───────
    if (req.method === 'POST') {
      // Require valid session
      const auth = requireAuth(req);
      if (auth.error) return res.status(auth.status).json({ error: auth.error });
      const user = auth.user;

      // Capture the OWNING-CLIENT provenance BEFORE hydration runs.
      // Trustworthy only when JWT-provided; see captureSessionClientId().
      // Used both to stamp ClientRecordId at create AND to authorise edits.
      const ownerClientIdFromSession = captureSessionClientId(user);

      // Cookie-issued JWTs don't carry email or plan in the payload.
      // Fill them in from Airtable before we use them for rate limiting,
      // ownership checks, plan limits, or persistence.
      await hydrateLegacyUserFields(user);

      // ── Rate limit (per-user, in-memory) ──────────────────
      // Catches buggy clients and opportunistic abuse. See _auth.js for
      // the cold-start caveat. GET path is not rate-limited — the CDN
      // cache (s-maxage=300) absorbs that class of abuse.
      if (!applyRateLimit(res, `save:${user.email}`, RATE_LIMITS.widgetWrite)) return;

      const { widgetId, name, config, widgetType } = req.body || {};
      if (!config || typeof config !== 'object') {
        return res.status(400).json({ error: 'Missing or invalid config' });
      }

      // Sanitise the config object
      const cleanConfig = sanitiseConfig(config);
      const configStr = JSON.stringify(cleanConfig);

      // Cap config size. Airtable's Config column is long text, hard-capped at
      // 100,000 characters — anything bigger is rejected by Airtable with a 422
      // (INVALID_VALUE_FOR_COLUMN) that used to surface as an unexplained 500.
      // Gate at 95,000 for headroom and tell the user what to actually do.
      // The usual culprit is an image embedded as a base64 data URI (the old
      // Quote PDF logo path); logos are now uploaded to Blob and stored as URLs.
      if (configStr.length > 95000) {
        return res.status(413).json({
          error: 'This design is too large to save. If you added a logo or image, remove it and upload it again (it will be stored as a link instead of embedded). Otherwise, try trimming some content and saving again.',
        });
      }

      const safeName = (typeof name === 'string' ? name : 'Untitled').slice(0, 200);

      // Validate widgetType against the enum if provided. The canonicaliser
      // accepts the canonical Title-Case names, any casing variant of them,
      // and the alias map (slugs and short forms). Anything outside that
      // returns null and we 400. Editors should be sending the canonical
      // form passed to tgse.init({ widgetType: ... }) — the alias map is
      // a safety net for editors that drift.
      let safeType = null;
      if (widgetType !== undefined && widgetType !== null) {
        if (typeof widgetType !== 'string' || widgetType.length === 0 || widgetType.length > 50) {
          return res.status(400).json({ error: 'Invalid widgetType' });
        }
        const canonical = canonicaliseWidgetType(widgetType);
        if (!canonical) {
          console.error('[widget-config] Unknown widgetType from editor:', widgetType);
          return res.status(400).json({
            error: `Unsupported widget type. Allowed: ${ALLOWED_WIDGET_TYPES.join(', ')}`
          });
        }
        safeType = canonical;
      }

      // If widgetId provided, try to update existing (verify ownership)
      if (widgetId) {
        const safeWid = sanitiseForFormula(widgetId);
        const formula = encodeURIComponent(`{WidgetID} = '${safeWid}'`);
        const searchUrl = `${AIRTABLE_API}/${AIRTABLE_BASE_ID}/${TABLE_NAME}?filterByFormula=${formula}&maxRecords=1`;
        const searchResp = await fetch(searchUrl, { headers });
        const searchData = await searchResp.json();

        if (searchData.records && searchData.records.length > 0) {
          const record = searchData.records[0];
          
          // Verify ownership — a widget belongs to a CLIENT, not the staff
          // member who created it. canModifyWidget() permits any user signed
          // into the owning client (via ClientRecordId), and falls back to
          // the legacy creator-email check for widgets created before
          // ClientRecordId existed. Fails closed either way.
          const verdict = canModifyWidget(record, {
            sessionClientId: ownerClientIdFromSession,
            userEmail: user.email,
          });
          if (verdict !== true) {
            console.warn(`[widget-config] edit denied (${verdict}) widget=${widgetId} ` +
              `session=${ownerClientIdFromSession || 'none'} user=${user.email}`);
            return res.status(403).json({ error: 'You do not have permission to edit this widget' });
          }

          const updateUrl = `${AIRTABLE_API}/${AIRTABLE_BASE_ID}/${TABLE_NAME}/${record.id}`;
          const updateResp = await fetch(updateUrl, {
            method: 'PATCH',
            headers,
            body: JSON.stringify({
              fields: {
                Config: configStr,
                Name: safeName,
                UpdatedAt: new Date().toISOString(),
              },
            }),
          });
          if (!updateResp.ok) await throwAirtableError('Update failed', updateResp);

          return res.status(200).json({ success: true, recordId: record.id, widgetId });
        }
      }

      // ── Enforce per-plan widget count limits ──────────────────
      // Must happen only on the CREATE path — updates don't change count.

      // widgetType is required for CREATE. The earlier validation accepted
      // it as optional to support future UPDATE-only flows; here we require it.
      if (!safeType) {
        return res.status(400).json({
          error: 'widgetType is required when creating a new widget'
        });
      }

      // ── Entitlement gate (Control) ───────────────────────────────
      // Server-side mirror of the dashboard show-and-tag. A create is blocked
      // ONLY when the widget maps to a productised (Active) catalogue item that
      // the owning client has not been granted. Staff bypass. Anything we can't
      // confidently match, or any lookup failure, FAILS OPEN — we never block a
      // legitimate create over an Airtable hiccup or a naming mismatch.
      try {
        const email = (user.email || '').toLowerCase();
        const at = email.lastIndexOf('@');
        const domain = at === -1 ? '' : email.slice(at + 1);
        const isStaff = ENTITLEMENT_STAFF_DOMAINS.includes(domain);
        const clientId = (typeof user.clientId === 'string' && REC_ID_RE.test(user.clientId))
          ? user.clientId
          : null;

        if (!isStaff && clientId) {
          // Access follows the client's PLAN via the Package Catalogue (the
          // catalogue toggles), so Control is the single source of truth and
          // staff change it live. A create is blocked only when the widget maps
          // to an ACTIVE catalogue item that the client's package does not
          // include. No package resolved, no match, or any lookup failure
          // FAILS OPEN (handled by the surrounding catch).
          const [catalogue, packageCatalogue, clientRec] = await Promise.all([
            listAllRecords(CATALOGUE.tableId),
            listAllRecords(PACKAGE_CATALOGUE.tableId),
            getRecord(CLIENTS.tableId, clientId).catch(() => null),
          ]);
          const typeLc = safeType.toLowerCase();
          const catItem = catalogue.find(
            (c) => String(c.fields[CATALOGUE.fields.productName] || '').toLowerCase() === typeLc
          );
          const clientPkgId = clientRec ? (clientRec.fields[CLIENTS.fields.package] || [])[0] : null;
          if (catItem && !!catItem.fields[CATALOGUE.fields.active] && clientPkgId) {
            const includedInPlan = packageCatalogue.some((row) => {
              if (!row.fields[PACKAGE_CATALOGUE.fields.includedByDefault]) return false;
              const pkgs = row.fields[PACKAGE_CATALOGUE.fields.package] || [];
              const cats = row.fields[PACKAGE_CATALOGUE.fields.catalogueItem] || [];
              return pkgs.includes(clientPkgId) && cats.includes(catItem.id);
            });
            if (!includedInPlan) {
              console.warn(`[widget-config] create blocked (not in plan) type=${safeType} client=${clientId} pkg=${clientPkgId}`);
              return res.status(403).json({
                error: `${safeType} isn't on your plan yet. Ask Travelgenix to add it, or upgrade your plan.`,
                code: 'not_entitled',
              });
            }
          }
        }
      } catch (gateErr) {
        console.warn('[widget-config] entitlement gate skipped (fail-open):', gateErr?.message);
      }

      const planLimits = PLAN_WIDGET_LIMITS[safeType];
      if (!planLimits) {
        // Should be unreachable: safeType is already validated against
        // ALLOWED_WIDGET_TYPES above. If we hit this, the two constants have
        // drifted — a dev sync error, not user error.
        console.error('[widget-config] Widget type missing from PLAN_WIDGET_LIMITS:', safeType);
        return res.status(500).json({ error: 'Widget configuration error. Contact support.' });
      }
      // Canonicalise plan before the lookup. JWTs and Airtable rows can both
      // carry casing variants ("ignite", "Ignite Plan") that don't match the
      // Title-Case keys in PLAN_WIDGET_LIMITS. Without this normalisation an
      // Ignite user with a lowercase plan claim gets a hard 403.
      const canonicalPlan = canonicalisePlan(user.plan);
      if (!canonicalPlan) {
        console.error('[widget-config] Unrecognised plan value:', user.plan, 'for user:', user.email);
        return res.status(403).json({ error: 'Your plan does not support widget creation. Contact support.' });
      }
      const planLimit = planLimits[canonicalPlan];
      if (planLimit === undefined) {
        // Plan canonicalised to a known name but PLAN_WIDGET_LIMITS doesn't
        // have an entry for it on this widget. Means PLAN_WIDGET_LIMITS is
        // missing a key — fix the constant, don't blame the user.
        console.error('[widget-config] Plan', canonicalPlan, 'missing from limits for', safeType);
        return res.status(403).json({ error: 'Your plan does not support widget creation. Contact support.' });
      }
      if (planLimit === 0) {
        return res.status(403).json({
          error: `The ${safeType} widget is not included in your plan. Please upgrade to use this widget.`
        });
      }
      if (planLimit > 0) {
        let existingCount;
        try {
          existingCount = await countUserWidgetsOfType(user.email, safeType, headers, AIRTABLE_BASE_ID);
        } catch (err) {
          console.error('[widget-config] Count query failed:', err.message);
          return res.status(503).json({ error: 'Service temporarily unavailable. Please try again.' });
        }
        if (existingCount >= planLimit) {
          return res.status(403).json({
            error: `You've reached your plan's limit of ${planLimit} ${safeType} widget${planLimit === 1 ? '' : 's'}. Upgrade to create more.`
          });
        }
      }
      // planLimit === -1 means unlimited — fall through to create.

      // Create new record (tagged to authenticated user)
      // Always generate the widgetId server-side for new records.
      // A client-provided widgetId is only honoured on the UPDATE path above
      // (where ownership has been verified). Falling through to here means the
      // search either found no match or no widgetId was supplied — in either
      // case we mint a fresh ID to prevent squatting on predictable/reserved
      // IDs and collisions with future auto-generated ones.
      const newWidgetId = `tgw_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const createUrl = `${AIRTABLE_API}/${AIRTABLE_BASE_ID}/${TABLE_NAME}`;
      // Build the create fields. ClientEmail is retained for backward
      // compatibility and the existing edit-ownership check, but the
      // AUTHORITATIVE owner is ClientRecordId — the record ID of the client
      // whose workspace this widget was created in. Credential-using widgets
      // (Quote PDF, My Booking) resolve Travelify creds from ClientRecordId
      // first, which is why stamping it correctly at birth matters.
      // Only stamped when the session gave us a trustworthy client (see
      // ownerClientIdFromSession above); omitted otherwise so we never write
      // a guessed/wrong owner.
      const createFields = {
        WidgetID: newWidgetId,
        Name: safeName,
        Config: configStr,
        Status: 'Active',
        WidgetType: safeType,
        ClientName: user.clientName || '',
        ClientEmail: user.email,
        CreatedAt: new Date().toISOString(),
        UpdatedAt: new Date().toISOString(),
      };
      if (ownerClientIdFromSession) {
        createFields.ClientRecordId = ownerClientIdFromSession;
      } else {
        console.warn(`[widget-config] Creating widget ${newWidgetId} WITHOUT ClientRecordId ` +
          `— no trustworthy session clientId (user=${user.email}). ` +
          `Credential resolution will fall back to ClientEmail.`);
      }
      const createResp = await fetch(createUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          records: [{
            fields: createFields,
          }],
        }),
      });
      if (!createResp.ok) await throwAirtableError('Create failed', createResp);
      const created = await createResp.json();

      return res.status(201).json({
        success: true,
        recordId: created.records[0].id,
        widgetId: newWidgetId,
      });
    }

    // ── DELETE: Authenticated — remove a widget ─────────────
    if (req.method === 'DELETE') {
      // Require valid session
      const auth = requireAuth(req);
      if (auth.error) return res.status(auth.status).json({ error: auth.error });
      const user = auth.user;

      // Capture owning-client from session BEFORE hydration (same trust rule
      // as the POST path) so delete authorisation is client-scoped.
      const ownerClientIdFromSession = captureSessionClientId(user);

      // Cookie-issued JWTs don't carry email in the payload. DELETE needs
      // email (for rate limit + the legacy ownership fallback), not plan, so
      // this is cheap on the legacy-cookie path and a no-op on new ones.
      await hydrateLegacyUserFields(user);

      // Rate limit (per-user, same preset as POST writes)
      if (!applyRateLimit(res, `delete:${user.email}`, RATE_LIMITS.widgetWrite)) return;

      // Parse widgetId from query string (DELETE convention)
      const widgetId = req.query.id;
      if (!widgetId || typeof widgetId !== 'string' || widgetId.length > 100) {
        return res.status(400).json({ error: 'Invalid or missing widget ID' });
      }

      // Look up the record
      const safeWid = sanitiseForFormula(widgetId);
      const formula = encodeURIComponent(`{WidgetID} = '${safeWid}'`);
      const searchUrl = `${AIRTABLE_API}/${AIRTABLE_BASE_ID}/${TABLE_NAME}?filterByFormula=${formula}&maxRecords=1`;
      const searchResp = await fetch(searchUrl, { headers });
      if (!searchResp.ok) await throwAirtableError('Lookup failed', searchResp);
      const searchData = await searchResp.json();

      if (!searchData.records || searchData.records.length === 0) {
        // Idempotent: treat "already gone" as success so retries are safe
        return res.status(200).json({ success: true, alreadyGone: true });
      }

      const record = searchData.records[0];

      // Verify ownership — client-scoped, same rule as the edit path.
      // Prevents cross-account deletes; any user of the owning client may
      // delete, legacy widgets fall back to creator email. Fails closed.
      const verdict = canModifyWidget(record, {
        sessionClientId: ownerClientIdFromSession,
        userEmail: user.email,
      });
      if (verdict !== true) {
        console.warn(`[widget-config] delete denied (${verdict}) widget=${widgetId} ` +
          `session=${ownerClientIdFromSession || 'none'} user=${user.email}`);
        return res.status(403).json({ error: 'You do not have permission to delete this widget' });
      }

      // Delete from Airtable
      const deleteUrl = `${AIRTABLE_API}/${AIRTABLE_BASE_ID}/${TABLE_NAME}/${record.id}`;
      const deleteResp = await fetch(deleteUrl, { method: 'DELETE', headers });
      if (!deleteResp.ok) await throwAirtableError('Delete failed', deleteResp);

      return res.status(200).json({ success: true, widgetId, recordId: record.id });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('[widget-config]', err.message);
    // Airtable rejecting the Config value (long-text column, 100k char cap)
    // is a user-fixable condition, not an outage — say so instead of a 500.
    // The 95k gate above should catch this first; this is belt and braces.
    if (/INVALID_VALUE_FOR_COLUMN/.test(err.message || '')) {
      return res.status(422).json({
        error: 'This design is too large to save. If you added a logo or image, please remove it and upload it again — it will now be stored as a link instead of embedded.',
      });
    }
    return res.status(500).json({ error: 'Service temporarily unavailable' });
  }
}
