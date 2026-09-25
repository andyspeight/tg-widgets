// =============================================================================
//  /public/_passport-rules.js — who may add a passport to a flight, and when
// =============================================================================
//
//  Passport details (Travelify's FOID, form of identification) for the people
//  on a flight, added or changed by the customer on their My Booking page and
//  sent to Travelify's updatepaxfoid endpoint (25 Sep 2026, the spec "My
//  Booking widget: passenger FOID (passport) capture for flights").
//
//  ONE set of rules, read in three places:
//    - api/retrieve-order.js decides what the page may show for each flight;
//    - api/update-passport.js checks everything again before it sends, so a
//      page left open past the cut-off, or a hand-made request, cannot submit;
//    - public/widget-mybooking.js checks each field as the customer types.
//  The widget is a single script on customer sites and cannot import, so it
//  carries a VERBATIM copy of the core between the two markers below.
//  test/passport-rules-drift-smoke.mjs fails the moment the two differ. Edit
//  here, copy the block, run the drift test. Never edit the widget's copy alone.
//
//  THE RULES, from the spec:
//    - Flights items only, each on its own item id.
//    - Shown only when the item's canEditFOID is boolean true AND today is at
//      least a day before the outbound departure. Calendar days, time ignored:
//      the day before departure is the last day; departure day is too late.
//    - Infants never get a passport block and are never sent. A flight with
//      only infants on it offers nothing.
//    - Four fields, all required for anyone being sent: number (letters and
//      digits, 5 to 20, stored upper case), issuing country (an ISO 3166-1
//      alpha-2 code), issue date (before today), expiry date (after the day
//      they fly home, or after the last arrival on a one-way flight, and after
//      the issue date). The type is always Passport.
//    - Only people whose details are new or changed are sent. Nothing changed,
//      nothing sent.
//
//  "Today" is the UTC calendar day, the same day the upsell rule uses
//  (upsellStartsInTime in public/_order-upsell.js). Booking days are read from
//  the first ten characters of the supplier's own value, never through a Date
//  built from it (the booking-dates rule in CLAUDE.md).
//
//  Runtime-neutral: it imports nothing and reads neither the process nor the
//  page, so the browser and the server run the same bytes.

// >>> passport rules (verbatim copy lives in public/widget-mybooking.js)
/**
 * Every ISO 3166-1 alpha-2 country, the codes Travelify takes for the issuing
 * country. The platform names countries with Intl.DisplayNames (see
 * countryName in api/_lib/fill/_source.js) but had no list of the codes
 * themselves, so this is it. 249 codes.
 */
const PASSPORT_COUNTRIES = ('AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ'
  + ' BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER'
  + ' ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM'
  + ' IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF'
  + ' MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK'
  + ' PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD'
  + ' TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW').split(' ');

const PASSPORT_NUMBER_RE = /^[A-Z0-9]{5,20}$/;
const PASSPORT_DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * A field read the way Travelify writes it. Its API treats canEditFOID and
 * CanEditFOID, firstname and Firstname as the same field, so we read either.
 */
function ppField(obj, name) {
  if (!obj || typeof obj !== 'object') return undefined;
  if (Object.prototype.hasOwnProperty.call(obj, name)) return obj[name];
  const want = String(name).toLowerCase();
  const keys = Object.keys(obj);
  for (let i = 0; i < keys.length; i++) if (keys[i].toLowerCase() === want) return obj[keys[i]];
  return undefined;
}

function ppList(v) { return Array.isArray(v) ? v : []; }

/** True for a real calendar day written YYYY-MM-DD (so 2027-02-30 is not). */
function ppRealDay(s) {
  const m = PASSPORT_DAY_RE.exec(String(s || ''));
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}

/** The calendar day a supplier value names: its first ten characters, or ''. */
function ppDay(v) {
  if (typeof v !== 'string') return '';
  const s = v.trim().slice(0, 10);
  return ppRealDay(s) ? s : '';
}

/** Today's calendar day, from the UTC fields like every booking day here. */
function ppToday() {
  return new Date().toISOString().slice(0, 10);
}

function ppIsInfant(t) {
  return String(ppField(t, 'type') || '').trim().toLowerCase() === 'infant';
}

/** The passport a traveller already has on the booking, tidied. Empty strings where there is none. */
function ppExisting(t) {
  const s = (v) => (v == null ? '' : String(v)).trim();
  return {
    number: s(ppField(t, 'foidNumber')).toUpperCase(),
    country: s(ppField(t, 'foidIssuingCountry')).toUpperCase(),
    issued: ppDay(s(ppField(t, 'foidStartDate'))),
    expires: ppDay(s(ppField(t, 'foidExpiryDate'))),
  };
}

/** All four details present, so there is nothing to ask for. */
function ppComplete(p) {
  return !!(p && p.number && p.country && p.issued && p.expires);
}

/**
 * The two days the rules turn on: when they fly out (the earliest outbound
 * departure) and the day the passport must outlast (the last inbound arrival,
 * or the last outbound arrival on a one-way flight).
 */
function ppFlightDays(d) {
  const routes = ppList(ppField(d, 'routes'));
  const dir = (r) => String(ppField(r, 'direction') || '').trim().toLowerCase();
  let out = routes.filter((r) => dir(r) === 'outbound');
  let back = routes.filter((r) => dir(r) === 'inbound');
  // A flight whose routes carry no direction at all: the first is the way out.
  if (!out.length && !back.length && routes.length) { out = [routes[0]]; back = routes.slice(1); }
  const segs = (rs) => rs.reduce((acc, r) => acc.concat(ppList(ppField(r, 'segments'))), []);
  const days = (list, field) => list.map((s) => ppDay(ppField(s, field))).filter(Boolean).sort();
  const outDeparts = days(segs(out), 'depart');
  const departDay = outDeparts[0] || '';
  const lastArrivals = days(segs(back.length ? back : out), 'arrive');
  const lastDay = lastArrivals[lastArrivals.length - 1] || outDeparts[outDeparts.length - 1] || '';
  return { departDay, lastDay };
}

/**
 * May this flight's passports be added or changed today?
 * `people` lists the travellers who would get a passport block (no infants),
 * each with its index in the item's own travellers array.
 */
function ppEligibility(d, today) {
  const day = PASSPORT_DAY_RE.test(String(today || '')) ? String(today) : ppToday();
  const canEdit = ppField(d, 'canEditFOID') === true;
  const days = ppFlightDays(d);
  const people = [];
  ppList(ppField(d, 'travellers')).forEach((t, index) => {
    if (t && typeof t === 'object' && !ppIsInfant(t)) people.push({ index, traveller: t });
  });
  const inTime = !!days.departDay && day < days.departDay;
  return {
    canEdit,
    inTime,
    departDay: days.departDay,
    lastDay: days.lastDay,
    today: day,
    people,
    editable: canEdit && inTime && people.length > 0,
  };
}

/** What the customer typed, tidied the way it will be stored. */
function ppClean(v) {
  const s = (x) => (x == null ? '' : String(x)).trim();
  return {
    number: s(v && v.number).toUpperCase(),
    country: s(v && v.country).toUpperCase(),
    issued: s(v && v.issued),
    expires: s(v && v.expires),
  };
}

/** Nothing typed in any of the four. */
function ppBlank(v) {
  return !v || (!v.number && !v.country && !v.issued && !v.expires);
}

/**
 * Check one person's four details. Returns the tidied value and an error code
 * per field that fails: required, format, country, date, notPast, tooSoon,
 * beforeIssue. The page words each code in its own language.
 */
function ppValidate(v, lastDay, today) {
  const day = PASSPORT_DAY_RE.test(String(today || '')) ? String(today) : ppToday();
  const value = ppClean(v);
  const errors = {};
  if (!value.number) errors.number = 'required';
  else if (!PASSPORT_NUMBER_RE.test(value.number)) errors.number = 'format';
  if (!value.country) errors.country = 'required';
  else if (PASSPORT_COUNTRIES.indexOf(value.country) === -1) errors.country = 'country';
  if (!value.issued) errors.issued = 'required';
  else if (!ppRealDay(value.issued)) errors.issued = 'date';
  else if (value.issued >= day) errors.issued = 'notPast';
  if (!value.expires) errors.expires = 'required';
  else if (!ppRealDay(value.expires)) errors.expires = 'date';
  else if (lastDay && value.expires <= lastDay) errors.expires = 'tooSoon';
  else if (!errors.issued && value.expires <= value.issued) errors.expires = 'beforeIssue';
  return { value, errors };
}

/** Has anything changed from what the booking already holds? */
function ppChanged(existing, value) {
  const e = existing || {};
  const v = value || {};
  return (e.number || '') !== (v.number || '') || (e.country || '') !== (v.country || '')
    || (e.issued || '') !== (v.issued || '') || (e.expires || '') !== (v.expires || '');
}

/** A passport number as the page may show it when it cannot be edited: the last four only. */
function ppMask(number) {
  const n = String(number || '');
  if (!n) return '';
  return '••••' + (n.length > 4 ? n.slice(-4) : '');
}
// <<< passport rules

export {
  PASSPORT_COUNTRIES, PASSPORT_NUMBER_RE, ppField, ppRealDay, ppDay, ppToday, ppIsInfant, ppExisting,
  ppComplete, ppFlightDays, ppEligibility, ppClean, ppBlank, ppValidate, ppChanged, ppMask,
};
