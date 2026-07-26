/**
 * Tripbuster spreadsheet import — parsing, column mapping and cell coercion.
 *
 * Agents keep their deals in a spreadsheet, so the importer has to cope with
 * whatever a real spreadsheet produces: quoted fields, commas inside a hotel
 * name, newlines inside a description, doubled quotes, a UTF-8 BOM from Excel,
 * CRLF line endings, tab or semicolon delimiters from a European locale, prices
 * written "£1,299" and dates written "01/02/2027".
 *
 * Division of labour: this module normalises, deal-schema.js decides. Coercion
 * is deliberately best-effort — when a cell cannot be read as a date or a
 * number, the ORIGINAL text is passed through so validateDeal reports it as
 * invalid. That keeps one source of truth for what a valid deal is, and means a
 * coercion gap can never quietly widen what the database will accept.
 *
 * Pure and dependency-free, so it unit tests directly with no database.
 */

/** Cap on what we will parse at all. A real agent sheet is a few hundred rows. */
export const MAX_TEXT_BYTES = 1024 * 1024; // 1 MB
export const MAX_ROWS = 500;

// ── delimiter detection ─────────────────────────────────────────────────────

const DELIMITERS = ['\t', ';', ','];

/**
 * Guess the delimiter by counting candidates in the header line, ignoring
 * anything inside quotes. Tabs win outright when present because a tab almost
 * never appears in deal text; between comma and semicolon the more frequent one
 * wins, which is what tells a UK export from a European one.
 */
export function detectDelimiter(text) {
  const counts = { '\t': 0, ';': 0, ',': 0 };
  let inQuotes = false;
  for (let i = 0; i < text.length && i < 8192; i++) {
    const c = text[i];
    if (c === '"') { inQuotes = !inQuotes; continue; }
    if (inQuotes) continue;
    if (c === '\n') break; // header line only
    if (Object.prototype.hasOwnProperty.call(counts, c)) counts[c]++;
  }
  if (counts['\t'] > 0) return '\t';
  // Default to comma when neither appears, so a single-column sheet still parses.
  return counts[';'] > counts[','] ? ';' : ',';
}

/**
 * RFC 4180 parser.
 *
 * @returns {{rows: string[][], delimiter: string, truncated: boolean}}
 */
export function parseDelimited(text, { delimiter } = {}) {
  let src = String(text == null ? '' : text);
  if (src.charCodeAt(0) === 0xfeff) src = src.slice(1); // Excel's UTF-8 BOM
  const delim = delimiter || detectDelimiter(src);

  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  let truncated = false;

  for (let i = 0; i < src.length; i++) {
    const c = src[i];

    if (inQuotes) {
      if (c === '"') {
        // A doubled quote is an escaped quote; a single one closes the field.
        if (src[i + 1] === '"') { field += '"'; i++; continue; }
        inQuotes = false;
        continue;
      }
      field += c;
      continue;
    }

    // A quote only opens a quoted field at the very start of that field, so a
    // stray quote mid-value (6" pizza) stays literal instead of swallowing the
    // rest of the file.
    if (c === '"' && field === '') { inQuotes = true; continue; }
    if (c === delim) { row.push(field); field = ''; continue; }
    if (c === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      continue;
    }
    if (c === '\r') continue; // CRLF, and a lone CR is not a row break we honour
    field += c;
  }
  // Whatever is left when the text ends is the last field of the last row.
  if (field !== '' || row.length) { row.push(field); rows.push(row); }

  // Drop rows that are entirely blank — trailing newlines and the empty rows
  // Excel likes to append would otherwise read as "5 rows need attention".
  let kept = rows.filter((r) => r.some((cell) => String(cell).trim() !== ''));

  // Cap AFTER parsing (the 1 MB input limit already bounds the work), so
  // `truncated` says whether rows were actually dropped rather than guessing
  // mid-parse. One header row plus MAX_ROWS of deals.
  if (kept.length > MAX_ROWS + 1) {
    truncated = true;
    kept = kept.slice(0, MAX_ROWS + 1);
  }
  return { rows: kept, delimiter: delim, truncated };
}

// ── column mapping ──────────────────────────────────────────────────────────

/** Normalise a header for matching: letters and digits only, lower case. */
function normHeader(s) {
  return String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Importable deal columns and the header names agents actually use.
 *
 * The canonical column name is always accepted, so an agent who downloads the
 * template and keeps its headers never depends on a synonym. Everything listed
 * beyond that is a convenience for sheets that already exist.
 *
 * `kind` drives coercion. `array` cells hold several values in one cell.
 */
export const SHEET_COLUMNS = [
  // 1. type & headline
  { col: 'title', kind: 'text', required: true, syn: ['deal', 'dealtitle', 'headline', 'name', 'dealname', 'offer', 'offername'] },
  { col: 'strapline', kind: 'text', syn: ['subtitle', 'tagline', 'summary', 'shortdescription'] },
  { col: 'reference', kind: 'text', syn: ['ref', 'sku', 'code', 'dealref', 'dealcode', 'yourref', 'productcode', 'id'] },
  { col: 'holiday_type', kind: 'holidaytype', syn: ['type', 'holiday', 'producttype', 'dealtype'] },
  // 2. destination & accommodation
  { col: 'country', kind: 'text', syn: ['destinationcountry'] },
  { col: 'region', kind: 'text', syn: ['area', 'island', 'coast'] },
  { col: 'resort', kind: 'text', syn: ['destination', 'town', 'city', 'where', 'location'] },
  { col: 'accommodation_name', kind: 'text', syn: ['hotel', 'hotelname', 'accommodation', 'property', 'propertyname', 'apartment', 'villa'] },
  { col: 'star_rating', kind: 'stars', syn: ['stars', 'rating', 'hotelrating', 'hotelstars', 'starrating'] },
  { col: 'guest_score', kind: 'decimal', syn: ['score', 'guestrating', 'reviewscore', 'tripadvisor', 'guestreview'] },
  { col: 'distance_to_beach', kind: 'text', syn: ['beach', 'beachdistance', 'tobeach', 'distancetothebeach'] },
  { col: 'distance_to_airport', kind: 'text', syn: ['airportdistance', 'toairport', 'distancetotheairport'] },
  { col: 'overview', kind: 'text', syn: ['description', 'details', 'about', 'hoteldescription', 'longdescription'] },
  // 3. room & board
  { col: 'board_basis', kind: 'board', syn: ['board', 'meals', 'mealplan', 'boardtype', 'basis'] },
  { col: 'room_type', kind: 'text', syn: ['room', 'roomdescription', 'accommodationtype'] },
  { col: 'adults', kind: 'int', syn: ['numberofadults', 'pax', 'adultsharing'] },
  { col: 'children', kind: 'int', syn: ['kids', 'numberofchildren', 'child'] },
  { col: 'infants', kind: 'int', syn: ['babies', 'numberofinfants'] },
  { col: 'facilities', kind: 'array', syn: ['amenities', 'features', 'hotelfacilities'] },
  // 4. flights & transfers
  { col: 'departure_airports', kind: 'array', syn: ['airport', 'airports', 'departureairport', 'departingfrom', 'flyingfrom', 'from', 'origin'] },
  { col: 'airline', kind: 'text', syn: ['carrier', 'flightwith'] },
  { col: 'flight_duration', kind: 'text', syn: ['flighttime'] },
  { col: 'cabin_bag', kind: 'text', syn: ['handluggage', 'carryon', 'cabinbaggage'] },
  { col: 'hold_luggage', kind: 'text', syn: ['luggage', 'checkedbag', 'baggage', 'holdbaggage'] },
  { col: 'transfers', kind: 'text', syn: ['transfer', 'airporttransfers'] },
  // 5. dates & availability
  { col: 'availability_type', kind: 'availtype', syn: ['datetype', 'dates'] },
  { col: 'nights', kind: 'int', syn: ['duration', 'night', 'numberofnights', 'length', 'stay'] },
  { col: 'travel_from', kind: 'date', syn: ['departuredate', 'departing', 'startdate', 'traveldate', 'checkin', 'datefrom', 'validfrom'] },
  { col: 'travel_until', kind: 'date', syn: ['returndate', 'enddate', 'checkout', 'dateto', 'validto', 'traveluntil', 'until'] },
  { col: 'booking_deadline', kind: 'date', syn: ['bookby', 'deadline', 'bookbydate', 'offerends', 'expires'] },
  { col: 'availability_status', kind: 'availstatus', syn: ['availability', 'status2', 'onrequest'] },
  { col: 'spaces_left', kind: 'int', syn: ['spaces', 'places', 'remaining', 'placesleft', 'allocation'] },
  // 6. pricing
  { col: 'price_from', kind: 'money', required: true, syn: ['price', 'pricepp', 'from', 'fromprice', 'cost', 'perperson', 'priceperperson', 'adultprice'] },
  { col: 'price_basis', kind: 'pricebasis', syn: ['basisofprice', 'pricetype'] },
  { col: 'was_price', kind: 'money', syn: ['was', 'rrp', 'wasprice', 'originalprice', 'fullprice', 'brochureprice'] },
  { col: 'deposit_from', kind: 'money', syn: ['deposit', 'depositfrom', 'lowdeposit'] },
  { col: 'child_price_from', kind: 'money', syn: ['childprice', 'kidsprice', 'childfrom'] },
  { col: 'single_supplement', kind: 'money', syn: ['singlesupp', 'solosupplement'] },
  { col: 'currency', kind: 'currency', syn: ['ccy', 'curr'] },
  { col: 'price_includes', kind: 'array', syn: ['includes', 'included', 'whatsincluded', 'priceincluded'] },
  { col: 'local_charges', kind: 'text', syn: ['resortfees', 'localtaxes', 'touristtax', 'payablelocally'] },
  // 7. offer & selling points
  { col: 'offer_badges', kind: 'array', syn: ['badges', 'labels', 'tags', 'flashes'] },
  { col: 'selling_points', kind: 'array', syn: ['highlights', 'bullets', 'usps', 'keypoints', 'sellingpoints'] },
  // 8. media
  { col: 'hero_image_url', kind: 'url', syn: ['image', 'imageurl', 'photo', 'mainimage', 'picture', 'heroimage'] },
  { col: 'video_url', kind: 'url', syn: ['video', 'youtube', 'videolink'] },
  { col: 'gallery', kind: 'urlarray', syn: ['images', 'photos', 'galleryimages', 'moreimages'] },
  // 9. booking & protection
  { col: 'clickout_url', kind: 'url', syn: ['url', 'link', 'bookinglink', 'bookingurl', 'weblink', 'deeplink', 'bookonline', 'moreinfo'] },
  { col: 'booking_phone', kind: 'text', syn: ['phone', 'telephone', 'tel', 'callus', 'contactnumber'] },
  { col: 'protection_type', kind: 'protection', syn: ['protection', 'financialprotection', 'bonding'] },
  { col: 'atol_number', kind: 'text', syn: ['atol', 'atolno'] },
  { col: 'abta_number', kind: 'text', syn: ['abta', 'abtano'] },
  { col: 'terms_url', kind: 'url', syn: ['terms', 'termslink', 'conditions', 'tcs'] },
  // status
  { col: 'status', kind: 'status', syn: ['publish', 'live', 'dealstatus', 'state'] },
];

/** Lookup from any accepted header spelling to its canonical column. */
const HEADER_LOOKUP = (() => {
  const m = new Map();
  for (const spec of SHEET_COLUMNS) {
    m.set(normHeader(spec.col), spec.col);          // canonical always wins
    for (const s of spec.syn || []) {
      if (!m.has(normHeader(s))) m.set(normHeader(s), spec.col);
    }
  }
  return m;
})();

const COLUMN_SPECS = new Map(SHEET_COLUMNS.map((s) => [s.col, s]));

/** True when `col` is a column the importer will accept. Guards client overrides. */
export function isImportableColumn(col) {
  return COLUMN_SPECS.has(String(col));
}

/**
 * Match a header row to deal columns.
 *
 * @param {string[]} headerRow
 * @param {object} override  optional { "<header as written>": "<deal column>" }
 *                           from the agent's own mapping choices. Validated
 *                           against the whitelist, so a hand-edited request
 *                           cannot map a cell onto agent_id or source.
 * @returns {{mapping: Array<{index:number, header:string, col:string|null}>,
 *            mapped: string[], unmapped: string[], duplicates: string[]}}
 */
export function mapHeaders(headerRow, override = {}) {
  const mapping = [];
  const used = new Map();
  const duplicates = [];
  const unmapped = [];

  (headerRow || []).forEach((raw, index) => {
    const header = String(raw == null ? '' : raw).trim();
    let col = null;

    // An explicit choice wins, but only for a real column. '' means "ignore
    // this column", which is how the agent drops a spare notes field.
    const chosen = Object.prototype.hasOwnProperty.call(override, header) ? override[header] : undefined;
    if (chosen !== undefined) {
      col = chosen === '' || chosen === null ? null : (isImportableColumn(chosen) ? String(chosen) : null);
    } else if (header) {
      col = HEADER_LOOKUP.get(normHeader(header)) || null;
    }

    // Two columns claiming the same field: the first wins, so a re-upload is
    // deterministic rather than depending on column order luck.
    if (col && used.has(col)) {
      duplicates.push(header);
      col = null;
    } else if (col) {
      used.set(col, index);
    }

    if (!col && header) unmapped.push(header);
    mapping.push({ index, header, col });
  });

  return { mapping, mapped: Array.from(used.keys()), unmapped, duplicates };
}

// ── cell coercion ───────────────────────────────────────────────────────────

/** Normalise an enum-ish cell for matching. */
const normEnum = (s) => String(s == null ? '' : s).toLowerCase().replace(/[^a-z]/g, '');

const BOARD_MAP = {
  allinclusive: 'All inclusive', ai: 'All inclusive', allinc: 'All inclusive', inclusive: 'All inclusive',
  ultraallinclusive: 'Ultra all inclusive', uai: 'Ultra all inclusive', premiumallinclusive: 'Ultra all inclusive',
  fullboard: 'Full board', fb: 'Full board',
  halfboard: 'Half board', hb: 'Half board', dinnerbedandbreakfast: 'Half board', dbb: 'Half board',
  bedandbreakfast: 'Bed & breakfast', bedbreakfast: 'Bed & breakfast', bb: 'Bed & breakfast',
  breakfast: 'Bed & breakfast', breakfastincluded: 'Bed & breakfast',
  selfcatering: 'Self catering', sc: 'Self catering', selfcater: 'Self catering', accommodationonly: 'Self catering',
  roomonly: 'Room only', ro: 'Room only', nomeals: 'Room only',
};

const HOLIDAY_TYPE_MAP = {
  packageholiday: 'Package holiday', package: 'Package holiday', packages: 'Package holiday', holiday: 'Package holiday',
  hotelonly: 'Hotel only', hotel: 'Hotel only', accommodation: 'Hotel only', accommodationonly: 'Hotel only',
  flighthotel: 'Flight + hotel', flightandhotel: 'Flight + hotel', flightplushotel: 'Flight + hotel',
  dynamicpackage: 'Flight + hotel', dynamicpackages: 'Flight + hotel',
  citybreak: 'City break', city: 'City break',
  cruise: 'Cruise', cruises: 'Cruise', cruiseandstay: 'Cruise',
  escortedtour: 'Escorted tour', tour: 'Escorted tour', tours: 'Escorted tour', touring: 'Escorted tour',
  flightonly: 'Flight only', flight: 'Flight only', flights: 'Flight only',
};

const AVAIL_STATUS_MAP = {
  available: 'Available', yes: 'Available', instock: 'Available', y: 'Available',
  onrequest: 'On request', request: 'On request', enquire: 'On request',
  limited: 'Limited', low: 'Limited', lowavailability: 'Limited', lastfew: 'Limited',
};

const AVAIL_TYPE_MAP = {
  range: 'range', daterange: 'range', between: 'range',
  fixed: 'fixed', fixeddate: 'fixed', fixeddates: 'fixed', specificdate: 'fixed',
  flexible: 'flexible', flex: 'flexible', anytime: 'flexible',
};

const PRICE_BASIS_MAP = {
  pp: 'pp', perperson: 'pp', personn: 'pp', each: 'pp', pppn: 'pp',
  total: 'total', totalprice: 'total', party: 'total', wholeparty: 'total', group: 'total', room: 'total',
};

const CURRENCY_MAP = {
  gbp: 'GBP', pound: 'GBP', pounds: 'GBP', sterling: 'GBP', gb: 'GBP',
  eur: 'EUR', euro: 'EUR', euros: 'EUR',
  usd: 'USD', dollar: 'USD', dollars: 'USD', us: 'USD',
};

const PROTECTION_MAP = {
  atol: 'ATOL', abta: 'ABTA',
  atolabta: 'ATOL + ABTA', abtaatol: 'ATOL + ABTA', both: 'ATOL + ABTA',
  trustaccount: 'Trust account', trust: 'Trust account',
  none: 'None', na: 'None', no: 'None',
};

const STATUS_MAP = {
  live: 'live', published: 'live', active: 'live', yes: 'live', publish: 'live', y: 'live', on: 'live',
  draft: 'draft', unpublished: 'draft', no: 'draft', n: 'draft', off: 'draft',
  paused: 'paused', pause: 'paused', hold: 'paused', onhold: 'paused',
};

function fromMap(value, map) {
  const key = normEnum(value);
  if (!key) return null;
  // Unrecognised text is returned unchanged so validateDeal rejects it with a
  // message naming the field, rather than being silently dropped.
  return Object.prototype.hasOwnProperty.call(map, key) ? map[key] : String(value).trim();
}

/**
 * Read a money cell. Handles "£1,299", "1 299,50" (European), "1299.00",
 * "€899 pp" and a bare number. Returns the original string when it cannot find
 * a number, so validation reports it.
 */
function coerceMoney(value) {
  const raw = String(value == null ? '' : value).trim();
  if (!raw) return null;
  // Drop currency symbols, spaces and any trailing words like "pp".
  let s = raw.replace(/[£$€]/g, '').replace(/[a-zA-Z]/g, '').trim();
  s = s.replace(/\s/g, '');
  if (!s) return raw;
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  if (lastComma > -1 && lastDot > -1) {
    // Both present: the RIGHTMOST is the decimal separator.
    if (lastComma > lastDot) s = s.replace(/\./g, '').replace(',', '.');
    else s = s.replace(/,/g, '');
  } else if (lastComma > -1) {
    // Comma only. Exactly two digits after it reads as decimals (1299,50);
    // anything else is a thousands separator (1,299 / 1,299,000).
    s = /,\d{2}$/.test(s) ? s.replace(',', '.') : s.replace(/,/g, '');
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : raw;
}

function coerceInt(value) {
  const raw = String(value == null ? '' : value).trim();
  if (!raw) return null;
  const m = raw.match(/-?\d+/);
  if (!m) return raw;
  return parseInt(m[0], 10);
}

function coerceDecimal(value) {
  const raw = String(value == null ? '' : value).trim();
  if (!raw) return null;
  const n = coerceMoney(raw);
  return n;
}

/** "4*", "4 star", "four" → 4. */
function coerceStars(value) {
  const raw = String(value == null ? '' : value).trim();
  if (!raw) return null;
  const words = { one: 1, two: 2, three: 3, four: 4, five: 5 };
  const w = words[normEnum(raw)];
  if (w) return w;
  return coerceInt(raw);
}

// Excel stores dates as days since 1899-12-30 (its leap-year bug included).
const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30);
const MONTHS = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

function iso(y, m, d) {
  const dt = new Date(Date.UTC(y, m - 1, d));
  // Reject 31 February rather than letting it roll into March.
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/**
 * Read a date cell as an ISO calendar date.
 *
 * DAY COMES FIRST in the ambiguous slash form: "01/02/2027" is 1 February,
 * because this is a UK product and that is what a UK agent means. The template
 * says so, and the preview shows the interpreted date back so a mistake is
 * visible before anything is written.
 */
function coerceDate(value) {
  const raw = String(value == null ? '' : value).trim();
  if (!raw) return null;

  // Already ISO.
  let m = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return iso(+m[1], +m[2], +m[3]) || raw;

  // Excel serial number.
  if (/^\d{5}(\.\d+)?$/.test(raw)) {
    const days = Math.floor(Number(raw));
    const dt = new Date(EXCEL_EPOCH_MS + days * 86400000);
    return iso(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate()) || raw;
  }

  // d/m/yyyy, d-m-yyyy, d.m.yyyy — day first.
  m = raw.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/);
  if (m) {
    let y = +m[3];
    if (y < 100) y += y < 70 ? 2000 : 1900;
    return iso(y, +m[2], +m[1]) || raw;
  }

  // "12 May 2027" / "12 May 27" / "May 12 2027".
  m = raw.match(/^(\d{1,2})\s+([a-zA-Z]{3,9})\.?\s+(\d{2,4})$/);
  if (m) {
    const mo = MONTHS[m[2].toLowerCase().slice(0, 4)] || MONTHS[m[2].toLowerCase().slice(0, 3)];
    let y = +m[3];
    if (y < 100) y += y < 70 ? 2000 : 1900;
    if (mo) return iso(y, mo, +m[1]) || raw;
  }
  m = raw.match(/^([a-zA-Z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{2,4})$/);
  if (m) {
    const mo = MONTHS[m[1].toLowerCase().slice(0, 4)] || MONTHS[m[1].toLowerCase().slice(0, 3)];
    let y = +m[3];
    if (y < 100) y += y < 70 ? 2000 : 1900;
    if (mo) return iso(y, mo, +m[2]) || raw;
  }

  return raw; // let validation reject it and name the field
}

/**
 * Split a multi-value cell. Pipe is the documented separator; a newline inside
 * a quoted cell works too, and semicolon is accepted UNLESS it is the file's
 * own delimiter (in which case a semicolon in a cell cannot mean "next item").
 */
function coerceArray(value, delimiter) {
  const raw = String(value == null ? '' : value);
  if (!raw.trim()) return null;
  const parts = raw.split(delimiter === ';' ? /[|\n]/ : /[|;\n]/);
  const out = [];
  for (const p of parts) {
    const s = p.trim();
    if (s) out.push(s);
  }
  return out;
}

function coerceText(value) {
  const s = String(value == null ? '' : value).trim();
  return s || null;
}

/**
 * Turn one parsed row into a raw deal object keyed by database column.
 *
 * Only mapped, non-empty cells appear in the result, which matters for
 * re-imports: a column the agent left out of their sheet is left alone on the
 * existing deal rather than being blanked.
 */
export function rowToDeal(row, mapping, { delimiter = ',' } = {}) {
  const deal = {};
  for (const { index, col } of mapping) {
    if (!col) continue;
    const spec = COLUMN_SPECS.get(col);
    if (!spec) continue;
    const cell = row[index];
    if (cell === undefined) continue;

    let v;
    switch (spec.kind) {
      case 'money': v = coerceMoney(cell); break;
      case 'int': v = coerceInt(cell); break;
      case 'decimal': v = coerceDecimal(cell); break;
      case 'stars': v = coerceStars(cell); break;
      case 'date': v = coerceDate(cell); break;
      case 'array': v = coerceArray(cell, delimiter); break;
      case 'urlarray': v = coerceArray(cell, delimiter); break;
      case 'board': v = fromMap(cell, BOARD_MAP); break;
      case 'holidaytype': v = fromMap(cell, HOLIDAY_TYPE_MAP); break;
      case 'availstatus': v = fromMap(cell, AVAIL_STATUS_MAP); break;
      case 'availtype': v = fromMap(cell, AVAIL_TYPE_MAP); break;
      case 'pricebasis': v = fromMap(cell, PRICE_BASIS_MAP); break;
      case 'currency': v = fromMap(cell, CURRENCY_MAP); break;
      case 'protection': v = fromMap(cell, PROTECTION_MAP); break;
      case 'status': v = fromMap(cell, STATUS_MAP); break;
      case 'url':
      case 'text':
      default: v = coerceText(cell); break;
    }
    if (v === null || v === undefined) continue;
    deal[col] = v;
  }
  return deal;
}

/**
 * Check a row's shape against the header before trusting its values.
 *
 * A row with MORE cells than the header almost always means an unquoted comma —
 * a price written £1,299 in a comma-delimited file splits into "£1" and "299",
 * so the deal would import with a price of 1 and every later column shifted by
 * one. That is silent corruption dressed up as a successful import, so it is
 * reported as a row problem rather than guessed at.
 *
 * Fewer cells is normal and fine: agents leave trailing columns off entirely,
 * and a missing cell just means "no value for that field".
 *
 * @returns {string|null} a message for the agent, or null when the row is fine
 */
export function rowShapeProblem(row, headerLength) {
  const n = Array.isArray(row) ? row.length : 0;
  if (n > headerLength) {
    return `This row has ${n} values but the header has ${headerLength} columns. `
      + 'That usually means a value contains a comma and needs wrapping in "quotes".';
  }
  return null;
}

// ── the template ────────────────────────────────────────────────────────────

/**
 * Columns offered in the downloadable template. A deliberately short list: the
 * full 50+ are all importable, but a first-time agent needs a sheet they can
 * fill in over a cup of tea, not a spreadsheet the width of a bus.
 */
const TEMPLATE_COLUMNS = [
  'reference', 'title', 'holiday_type', 'country', 'resort', 'accommodation_name',
  'star_rating', 'board_basis', 'nights', 'departure_airports',
  'travel_from', 'travel_until', 'price_from', 'was_price', 'currency',
  'selling_points', 'hero_image_url', 'clickout_url', 'status',
];

const TEMPLATE_EXAMPLES = [
  {
    reference: 'BEN-1042', title: '4 nights in Benidorm, all inclusive',
    holiday_type: 'Package holiday', country: 'Spain', resort: 'Benidorm',
    accommodation_name: 'Hotel Sol Pelicanos', star_rating: '3', board_basis: 'All inclusive',
    nights: '4', departure_airports: 'Manchester|Birmingham',
    travel_from: '2027-02-01', travel_until: '2027-02-28', price_from: '229', was_price: '319',
    currency: 'GBP', selling_points: 'Steps from Levante beach|Free kids club|Rooftop pool',
    hero_image_url: 'https://example.com/benidorm.jpg',
    clickout_url: 'https://youragency.co.uk/deals/BEN-1042', status: 'live',
  },
  {
    reference: 'ALG-2213', title: 'Algarve half board, 7 nights',
    holiday_type: 'Package holiday', country: 'Portugal', resort: 'Albufeira',
    accommodation_name: 'Balaia Golf Village', star_rating: '4', board_basis: 'Half board',
    nights: '7', departure_airports: 'Gatwick',
    travel_from: '2027-05-10', travel_until: '2027-06-20', price_from: '489', was_price: '',
    currency: 'GBP', selling_points: 'Golf on site|Family apartments',
    hero_image_url: '', clickout_url: 'https://youragency.co.uk/deals/ALG-2213', status: 'draft',
  },
];

/** One CSV cell, quoted only when it has to be. */
function csvCell(value) {
  const s = String(value == null ? '' : value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * The template as CSV text, with a leading BOM so Excel opens a UK £ sign and
 * accented resort names correctly instead of showing mojibake.
 */
export function templateCsv() {
  const lines = [TEMPLATE_COLUMNS.join(',')];
  for (const ex of TEMPLATE_EXAMPLES) {
    lines.push(TEMPLATE_COLUMNS.map((c) => csvCell(ex[c])).join(','));
  }
  return '﻿' + lines.join('\r\n') + '\r\n';
}

/** Column guidance for the UI, so the help text cannot drift from the parser. */
export function templateGuide() {
  return TEMPLATE_COLUMNS.map((col) => {
    const spec = COLUMN_SPECS.get(col);
    return {
      col,
      kind: spec.kind,
      required: !!spec.required,
      alsoAccepts: (spec.syn || []).slice(0, 4),
    };
  });
}
