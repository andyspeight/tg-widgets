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
//    - One emergency contact per flight's form (the spec's second revision,
//      the same day): an email address and a telephone number, pre-filled from
//      the primary passenger or else the booking, always sent with a save but
//      never a reason to save on its own.
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

/*
 * EMERGENCY CONTACT (the spec's second revision, 25 Sep 2026). One email
 * address and one telephone number for the booking, asked once in each
 * flight's form and sent with every save as EmailAddress and Telephone
 * { CountryPrefix, Number }. They start from the primary passenger's own
 * (travellers[0].emailAddress and .telephone) and fall back to the booking's
 * (customerEmail, customerTelPrefix, customerTelNum).
 */

/** "GB:44 US:1 ..." into { GB: '44', US: '1', ... }. */
function ppPairs(s) {
  const out = {};
  s.split(' ').forEach((p) => { const i = p.indexOf(':'); if (i > 0) out[p.slice(0, i)] = p.slice(i + 1); });
  return out;
}

/**
 * Every country's dialling code, by the country it belongs to, as the ITU
 * assigns them (generated from libphonenumber-js 1.13.14 on 25 Sep 2026; the
 * platform had no list of its own). The passport countries that have a code,
 * plus Ascension Island (AC) and Kosovo (XK), which have codes of their own but
 * are not ISO passport countries. AQ BV GS HM PN TF UM have no code of their
 * own and are left out. 244 entries.
 */
const DIAL_CODES = ppPairs('AC:247 AD:376 AE:971 AF:93 AG:1 AI:1 AL:355 AM:374 AO:244 AR:54 AS:1 AT:43 AU:61 AW:297 AX:358 AZ:994'
  + ' BA:387 BB:1 BD:880 BE:32 BF:226 BG:359 BH:973 BI:257 BJ:229 BL:590 BM:1 BN:673 BO:591 BQ:599 BR:55 BS:1'
  + ' BT:975 BW:267 BY:375 BZ:501 CA:1 CC:61 CD:243 CF:236 CG:242 CH:41 CI:225 CK:682 CL:56 CM:237 CN:86 CO:57'
  + ' CR:506 CU:53 CV:238 CW:599 CX:61 CY:357 CZ:420 DE:49 DJ:253 DK:45 DM:1 DO:1 DZ:213 EC:593 EE:372 EG:20'
  + ' EH:212 ER:291 ES:34 ET:251 FI:358 FJ:679 FK:500 FM:691 FO:298 FR:33 GA:241 GB:44 GD:1 GE:995 GF:594'
  + ' GG:44 GH:233 GI:350 GL:299 GM:220 GN:224 GP:590 GQ:240 GR:30 GT:502 GU:1 GW:245 GY:592 HK:852 HN:504'
  + ' HR:385 HT:509 HU:36 ID:62 IE:353 IL:972 IM:44 IN:91 IO:246 IQ:964 IR:98 IS:354 IT:39 JE:44 JM:1 JO:962'
  + ' JP:81 KE:254 KG:996 KH:855 KI:686 KM:269 KN:1 KP:850 KR:82 KW:965 KY:1 KZ:7 LA:856 LB:961 LC:1 LI:423'
  + ' LK:94 LR:231 LS:266 LT:370 LU:352 LV:371 LY:218 MA:212 MC:377 MD:373 ME:382 MF:590 MG:261 MH:692 MK:389'
  + ' ML:223 MM:95 MN:976 MO:853 MP:1 MQ:596 MR:222 MS:1 MT:356 MU:230 MV:960 MW:265 MX:52 MY:60 MZ:258 NA:264'
  + ' NC:687 NE:227 NF:672 NG:234 NI:505 NL:31 NO:47 NP:977 NR:674 NU:683 NZ:64 OM:968 PA:507 PE:51 PF:689'
  + ' PG:675 PH:63 PK:92 PL:48 PM:508 PR:1 PS:970 PT:351 PW:680 PY:595 QA:974 RE:262 RO:40 RS:381 RU:7 RW:250'
  + ' SA:966 SB:677 SC:248 SD:249 SE:46 SG:65 SH:290 SI:386 SJ:47 SK:421 SL:232 SM:378 SN:221 SO:252 SR:597'
  + ' SS:211 ST:239 SV:503 SX:1 SY:963 SZ:268 TC:1 TD:235 TG:228 TH:66 TJ:992 TK:690 TL:670 TM:993 TN:216'
  + ' TO:676 TR:90 TT:1 TV:688 TW:886 TZ:255 UA:380 UG:256 US:1 UY:598 UZ:998 VA:39 VC:1 VE:58 VG:1 VI:1 VN:84'
  + ' VU:678 WF:681 WS:685 XK:383 YE:967 YT:262 ZA:27 ZM:260 ZW:263'
);

/**
 * Where countries share a code, the one a code alone pre-selects (the spec:
 * "44 selects United Kingdom"). The code sent is the same whichever is chosen.
 * test:mybooking-passport fails if a shared code is missing from here.
 */
const DIAL_PRINCIPAL = {
  1: 'US', 7: 'RU', 39: 'IT', 44: 'GB', 47: 'NO', 61: 'AU', 212: 'MA', 262: 'RE', 358: 'FI', 590: 'GP', 599: 'CW',
};

const CONTACT_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CONTACT_NUMBER_RE = /^\d{4,15}$/;

/** Digits only: all a telephone field keeps of anything typed or pasted. */
function ppDigits(v) {
  return (v == null ? '' : String(v)).replace(/\D+/g, '');
}

/** A dialling code as the API takes it: digits, no "+", no leading "00". */
function ppDialPrefix(v) {
  return ppDigits(v).replace(/^0+/, '');
}

/** The country a dialling code pre-selects, or '' when no country has that code. */
function ppDialCountry(prefix) {
  const code = ppDialPrefix(prefix);
  if (!code) return '';
  if (DIAL_PRINCIPAL[code]) return DIAL_PRINCIPAL[code];
  const keys = Object.keys(DIAL_CODES);
  for (let i = 0; i < keys.length; i++) if (DIAL_CODES[keys[i]] === code) return keys[i];
  return '';
}

/**
 * The emergency contact the form starts from. Email and telephone are decided
 * separately: each is the primary passenger's own when they carry one (a
 * telephone counts only with a number), otherwise the booking's.
 */
function ppContactExisting(order, primary) {
  const s = (v) => (v == null ? '' : String(v)).trim();
  const email = s(ppField(primary, 'emailAddress')) || s(ppField(order, 'customerEmail'));
  const tel = ppField(primary, 'telephone');
  const own = tel && typeof tel === 'object' ? ppDigits(ppField(tel, 'number')) : '';
  if (own) return { email, prefix: ppDialPrefix(ppField(tel, 'countryPrefix')), number: own };
  return { email, prefix: ppDialPrefix(ppField(order, 'customerTelPrefix')), number: ppDigits(ppField(order, 'customerTelNum')) };
}

/**
 * Check the emergency contact. Returns the tidied value and an error code per
 * field that fails: email (required, email), prefix (required, dialCode),
 * number (required, digits, phoneLength). The number is kept exactly as
 * entered, a leading zero included.
 */
function ppValidateContact(v) {
  const s = (x) => (x == null ? '' : String(x)).trim();
  const rawPrefix = s(v && v.prefix);
  const value = { email: s(v && v.email), prefix: ppDialPrefix(rawPrefix), number: s(v && v.number) };
  const errors = {};
  if (!value.email) errors.email = 'required';
  else if (value.email.length > 254 || !CONTACT_EMAIL_RE.test(value.email)) errors.email = 'email';
  if (!rawPrefix) errors.prefix = 'required';
  else if (!/^\+?\d{1,4}$/.test(rawPrefix) || !ppDialCountry(value.prefix)) errors.prefix = 'dialCode';
  if (!value.number) errors.number = 'required';
  else if (!/^\d+$/.test(value.number)) errors.number = 'digits';
  else if (!CONTACT_NUMBER_RE.test(value.number)) errors.number = 'phoneLength';
  return { value, errors };
}
// <<< passport rules

export {
  PASSPORT_COUNTRIES, PASSPORT_NUMBER_RE, ppField, ppList, ppRealDay, ppDay, ppToday, ppIsInfant, ppExisting,
  ppComplete, ppFlightDays, ppEligibility, ppClean, ppBlank, ppValidate, ppChanged, ppMask,
  DIAL_CODES, DIAL_PRINCIPAL, ppDigits, ppDialPrefix, ppDialCountry, ppContactExisting, ppValidateContact,
};
