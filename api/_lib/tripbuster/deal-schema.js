/**
 * Tripbuster deal payload validation.
 *
 * Whitelist in, whitelist out. Only the fields listed here survive, which means
 * a caller can never set `agent_id`, forge `source`, mark a deal `expired`, or
 * smuggle extra keys into the insert — regardless of what they post.
 *
 * Enums mirror the CHECK constraints in db/tripbuster/001_init.sql exactly. If
 * one changes, change both: the database is the backstop, this layer exists to
 * turn a violation into a message an agent can actually act on rather than a 500.
 *
 * Pure and dependency-free so it can be unit tested directly.
 */

const HOLIDAY_TYPES = ['Package holiday', 'Hotel only', 'Flight + hotel', 'City break',
  'Cruise', 'Escorted tour', 'Flight only'];
const BOARDS = ['All inclusive', 'Ultra all inclusive', 'Full board', 'Half board',
  'Bed & breakfast', 'Self catering', 'Room only'];
const AVAIL_TYPES = ['range', 'fixed', 'flexible'];
const AVAIL_STATUS = ['Available', 'On request', 'Limited'];
const PRICE_BASIS = ['pp', 'total'];
const CURRENCIES = ['GBP', 'EUR', 'USD'];
const PROTECTIONS = ['ATOL', 'ABTA', 'ATOL + ABTA', 'Trust account', 'None'];
// 'expired' is deliberately absent: that transition belongs to the system, not
// to whoever is posting.
const STATUSES = ['draft', 'live', 'paused'];

const MAX_ARRAY_ITEMS = 30;
const MAX_ARRAY_ITEM_LEN = 120;
const MAX_GALLERY = 20;

/**
 * Strip null bytes and control characters, collapse runs of whitespace, trim and
 * cap. Newlines survive for the long free-text fields but are normalised, so a
 * pasted description cannot arrive carrying fifty blank lines.
 */
function clean(value, max) {
  if (typeof value !== 'string') return null;
  const s = value
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (!s) return null;
  return s.slice(0, max);
}

/**
 * Absolute http(s) only. Deals link out to a third-party site, so a relative
 * path is meaningless here, and an allowlist keeps javascript:/data: out.
 */
function absoluteUrl(value) {
  const s = clean(value, 2048);
  if (!s) return null;
  let u;
  try {
    u = new URL(s);
  } catch {
    return null;
  }
  return (u.protocol === 'http:' || u.protocol === 'https:') ? u.toString() : null;
}

function enumValue(value, allowed) {
  const s = clean(value, 60);
  return s && allowed.includes(s) ? s : null;
}

function intValue(value, min, max) {
  if (value === '' || value === null || value === undefined) return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return undefined; // undefined = "was provided but invalid"
  return Math.max(min, Math.min(max, Math.round(n)));
}

function decimalValue(value, min, max, dp) {
  if (value === '' || value === null || value === undefined) return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return undefined;
  const clamped = Math.max(min, Math.min(max, n));
  return Number(clamped.toFixed(dp));
}

/** ISO calendar date only. Rejects "2026-02-31" rather than silently rolling it. */
function dateValue(value) {
  const s = clean(value, 20);
  if (!s) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return undefined;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return undefined;
  return s;
}

function stringArray(value, { max = MAX_ARRAY_ITEMS, itemLen = MAX_ARRAY_ITEM_LEN } = {}) {
  if (value === null || value === undefined) return null;
  const list = Array.isArray(value) ? value : [value];
  const out = [];
  const seen = new Set();
  for (const item of list) {
    if (out.length >= max) break;
    const s = clean(item, itemLen);
    if (!s || seen.has(s.toLowerCase())) continue;
    seen.add(s.toLowerCase());
    out.push(s);
  }
  return out;
}

function urlArray(value, max) {
  if (value === null || value === undefined) return null;
  const list = Array.isArray(value) ? value : [value];
  const out = [];
  for (const item of list) {
    if (out.length >= max) break;
    const u = absoluteUrl(item);
    if (u) out.push(u);
  }
  return out;
}

/**
 * Validate a deal payload.
 *
 * @param {object} input   raw body from the client
 * @param {object} opts
 * @param {boolean} opts.partial  true for PATCH — only supplied keys are considered
 * @returns {{ok: boolean, deal: object, errors: Array<{field: string, message: string}>}}
 */
export function validateDeal(input, { partial = false } = {}) {
  const errors = [];
  const deal = {};
  const src = (input && typeof input === 'object' && !Array.isArray(input)) ? input : {};
  const given = (key) => Object.prototype.hasOwnProperty.call(src, key);

  // `field` is the database column; `key` is what the client sends (same here,
  // the dashboard posts snake_case).
  const text = (key, max, { required = false, label } = {}) => {
    if (partial && !given(key)) return;
    const v = clean(src[key], max);
    if (v === null && required && !partial) {
      errors.push({ field: key, message: `${label || key} is required` });
      return;
    }
    if (given(key) || v !== null) deal[key] = v;
  };

  const pick = (key, fn, label) => {
    if (partial && !given(key)) return;
    if (!given(key)) return;
    const v = fn(src[key]);
    if (v === undefined) {
      errors.push({ field: key, message: `${label} is not valid` });
      return;
    }
    deal[key] = v;
  };

  // 1. type & headline
  text('title', 200, { required: true, label: 'Deal title' });
  text('strapline', 300);
  text('reference', 80);
  pick('holiday_type', (v) => enumValue(v, HOLIDAY_TYPES) ?? undefined, 'Holiday type');

  // 2. destination & accommodation
  text('country', 80);
  text('region', 120);
  text('resort', 120);
  text('accommodation_name', 200);
  pick('star_rating', (v) => (v === '' || v === null ? null : intValue(v, 1, 5)), 'Hotel rating');
  pick('guest_score', (v) => (v === '' || v === null ? null : decimalValue(v, 0, 10, 1)), 'Guest score');
  text('distance_to_beach', 60);
  text('distance_to_airport', 60);
  text('overview', 4000);

  // 3. room & board
  pick('board_basis', (v) => (v === '' || v === null ? null : enumValue(v, BOARDS) ?? undefined), 'Board basis');
  text('room_type', 160);
  pick('adults', (v) => intValue(v, 0, 30), 'Adults');
  pick('children', (v) => intValue(v, 0, 30), 'Children');
  pick('infants', (v) => intValue(v, 0, 30), 'Infants');
  if (!partial || given('facilities')) {
    const f = stringArray(src.facilities);
    if (f) deal.facilities = f;
  }

  // 4. flights & transfers
  if (!partial || given('departure_airports')) {
    const a = stringArray(src.departure_airports, { max: 20 });
    if (a) deal.departure_airports = a;
  }
  text('airline', 120);
  text('flight_duration', 40);
  text('cabin_bag', 80);
  text('hold_luggage', 80);
  text('transfers', 80);

  // 5. dates & availability
  pick('availability_type', (v) => enumValue(v, AVAIL_TYPES) ?? undefined, 'Availability type');
  pick('nights', (v) => (v === '' || v === null ? null : intValue(v, 1, 60)), 'Nights');
  pick('travel_from', dateValue, 'Travel from date');
  pick('travel_until', dateValue, 'Travel until date');
  pick('booking_deadline', dateValue, 'Booking deadline');
  pick('availability_status', (v) => enumValue(v, AVAIL_STATUS) ?? undefined, 'Availability status');
  pick('spaces_left', (v) => (v === '' || v === null ? null : intValue(v, 0, 9999)), 'Spaces left');

  // 6. pricing
  pick('price_from', (v) => (v === '' || v === null ? null : decimalValue(v, 0, 1000000, 2)), 'Price');
  pick('price_basis', (v) => enumValue(v, PRICE_BASIS) ?? undefined, 'Price basis');
  pick('was_price', (v) => (v === '' || v === null ? null : decimalValue(v, 0, 1000000, 2)), 'Was price');
  pick('deposit_from', (v) => (v === '' || v === null ? null : decimalValue(v, 0, 1000000, 2)), 'Deposit');
  pick('child_price_from', (v) => (v === '' || v === null ? null : decimalValue(v, 0, 1000000, 2)), 'Child price');
  pick('single_supplement', (v) => (v === '' || v === null ? null : decimalValue(v, 0, 1000000, 2)), 'Single supplement');
  pick('currency', (v) => enumValue(v, CURRENCIES) ?? undefined, 'Currency');
  if (!partial || given('price_includes')) {
    const inc = stringArray(src.price_includes);
    if (inc) deal.price_includes = inc;
  }
  text('local_charges', 400);

  // 7. offer & selling points
  if (!partial || given('offer_badges')) {
    const b = stringArray(src.offer_badges, { max: 8 });
    if (b) deal.offer_badges = b;
  }
  if (!partial || given('selling_points')) {
    const sp = stringArray(src.selling_points, { max: 12, itemLen: 200 });
    if (sp) deal.selling_points = sp;
  }

  // 8. media
  pick('hero_image_url', (v) => (v === '' || v === null ? null : absoluteUrl(v) ?? undefined), 'Hero image URL');
  pick('video_url', (v) => (v === '' || v === null ? null : absoluteUrl(v) ?? undefined), 'Video URL');
  if (!partial || given('gallery')) {
    const g = urlArray(src.gallery, MAX_GALLERY);
    if (g) deal.gallery = g;
  }

  // 9. booking & protection
  pick('clickout_url', (v) => (v === '' || v === null ? null : absoluteUrl(v) ?? undefined), 'Booking link');
  text('booking_phone', 40);
  pick('protection_type', (v) => (v === '' || v === null ? null : enumValue(v, PROTECTIONS) ?? undefined), 'Protection type');
  text('atol_number', 20);
  text('abta_number', 20);
  pick('terms_url', (v) => (v === '' || v === null ? null : absoluteUrl(v) ?? undefined), 'Terms URL');

  // status
  pick('status', (v) => enumValue(v, STATUSES) ?? undefined, 'Status');

  // Cross-field checks. The database enforces these too; catching them here gives
  // the agent a sentence they can act on instead of a constraint name.
  const from = deal.travel_from ?? (partial ? undefined : null);
  const until = deal.travel_until ?? (partial ? undefined : null);
  if (from && until && until < from) {
    errors.push({ field: 'travel_until', message: 'Travel until date must be on or after the travel from date' });
  }
  if (deal.was_price != null && deal.price_from != null && deal.was_price <= deal.price_from) {
    errors.push({ field: 'was_price', message: 'Was price must be higher than the current price to show a saving' });
  }

  return { ok: errors.length === 0, deal, errors };
}

export const DEAL_ENUMS = {
  HOLIDAY_TYPES, BOARDS, AVAIL_TYPES, AVAIL_STATUS, PRICE_BASIS, CURRENCIES, PROTECTIONS, STATUSES,
};
