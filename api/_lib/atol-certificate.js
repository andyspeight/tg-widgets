/**
 * ATOL certificates, issued on the client's behalf (24 Sep 2026).
 *
 * Andy: "When a booking is 'ATOL Protected' and the travel company is a
 * Travelgenix client, we must attach the correct ATOL certificate to the
 * booking ... produce these exactly as they are, plus the relevant booking
 * details." He supplied the CAA's three templates, dated 1 July 2018, which are
 * still the current ones: api/_data/atol/ATOLCert_*_010718.pdf, kept exactly
 * as the CAA publishes them.
 *
 * EXACTLY AS THEY ARE. The CAA: "Individual certificates must follow the format
 * exactly", and the yellow background "must be included on any electronic
 * versions". So nothing here redraws the certificate. We open the CAA's own
 * file, take off the "SAMPLE" watermark (an Acrobat watermark the CAA laid over
 * its published samples, a separate object marked /Private /Watermark, so it
 * comes off without touching a line of the design), and write the booking into
 * the blanks in the certificate's own ink colour and Arial-metric type.
 *
 * WHICH BOOKINGS (Andy, 24 Sep 2026: "every flight they sell"). A booking with
 * a flight the CLIENT sold gets a certificate once the client has entered its
 * ATOL details and switched that certificate on in the My Booking editor. A
 * flight inside a tour operator's package (a Packages item: Jet2 Holidays,
 * TUI) is the operator's to certify, under the operator's licence, and is left
 * alone. Flights alone get a Flight-only certificate; flights sold with a
 * hotel or car hire get a Package one, single- or multi-contract as the client
 * has chosen. A cancelled booking gets none.
 *
 * WHAT GOES WHERE, from the CAA's "Guidance on completion of an ATOL
 * Certificate" (ATOL Policy and Regulations 2019/01, read through search
 * excerpts: the CAA site is blocked from the development sandbox):
 *   Who is protected     Flight-only: "all known names (including infants) must
 *                        be specified". Packages may be limited to the lead
 *                        name; we print everyone, it is the stronger reading.
 *   Number of passengers excludes infants.
 *   What is protected    only the parts protected together as one booking.
 *   Issuer               "the business which interacts with the consumer":
 *                        the client, by the legal name it entered.
 *   Unique reference     one per certificate. A new certificate is required
 *                        each time the booking details change, so the
 *                        reference is the booking reference plus a fingerprint
 *                        of what the certificate says: unchanged details give
 *                        the same reference, changed details a new one.
 *
 * Pure except renderAtolCertificatePdf, which reads the template from disk.
 * The date of issue is handed in (api/_lib/atol-issue-log.js keeps it stable).
 */
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
// pdf-lib is loaded only when a certificate is drawn: /api/retrieve-order
// imports this module for the yes/no decision on every booking lookup and has
// no use for a PDF library.
let _pdfLib = null;
const pdfLib = async () => (_pdfLib ||= await import('pdf-lib'));
import { listStays, bookingMoment } from '../../public/_order-stays.js';

// ─── The three certificates ────────────────────────────────────────────────

export const ATOL_TYPES = {
  'flight-only':    { label: 'Flight-only',               file: 'ATOLCert_FlightOnly_010718.pdf' },
  'package-single': { label: 'Package (Single-contract)', file: 'ATOLCert_PackageSingle_010718.pdf' },
  'package-multi':  { label: 'Package (Multi-contract)',  file: 'ATOLCert_PackageMulti_010718.pdf' },
};

// ─── Settings, as the My Booking editor saves them (config.atol) ────────────

const clean = (v, max) => String(v == null ? '' : v)
  .replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

/**
 * The client's ATOL details and switches, cleaned. `ready` is true only when
 * both details are there: no name and number, no certificate, whatever the
 * switches say. The two package switches are one choice (a company's packages
 * are sold one way or the other); the editor keeps them apart, and a config
 * edited by hand with both on reads as single-contract.
 */
export function normaliseAtolSettings(raw) {
  const a = raw && typeof raw === 'object' ? raw : {};
  const holderName = clean(a.holderName, 120);
  const num = clean(a.atolNumber, 20).toUpperCase();
  const atolNumber = /^[A-Z0-9][A-Z0-9 -]{0,19}$/.test(num) ? num : '';
  const packageSingle = a.packageSingle === true;
  return {
    holderName,
    atolNumber,
    flightOnly: a.flightOnly === true,
    packageSingle,
    packageMulti: a.packageMulti === true && !packageSingle,
    ready: !!(holderName && atolNumber),
  };
}

// ─── Which certificate, if any ─────────────────────────────────────────────

const isCancelled = (s) => /cancel/i.test(String(s || ''));
// A flight inside a Packages item belongs to the tour operator (item.package
// is set by every trimmer for that product).
const ownItems = (order) => (Array.isArray(order && order.items) ? order.items : [])
  .filter((it) => it && typeof it === 'object' && !it.package && it.product !== 'Packages' && !isCancelled(it.status));
const ownFlights = (order) => ownItems(order).filter((it) => it.product === 'Flights' && it.flights);
// Services that make a flight into a package under the Package Travel
// Regulations: accommodation or car hire, sold with it. (Transfers are
// carriage, the same kind as the flight; tickets count only when they are a
// significant part of the trip, which we cannot judge, so they do not make a
// package on their own. When there IS a package they are listed on it.)
const PACKAGE_MAKERS = new Set(['Accommodation', 'CarRental']);

/**
 * { type: 'flight-only' | 'package-single' | 'package-multi' } when this
 * booking gets a certificate, else { type: null, reason }. The reason is for
 * logs and tests, never shown to a customer.
 */
export function atolCertificateType(order, settingsRaw) {
  const s = settingsRaw && typeof settingsRaw.ready === 'boolean' ? settingsRaw : normaliseAtolSettings(settingsRaw);
  if (!s.ready) return { type: null, reason: 'no_atol_details' };
  if (!order || typeof order !== 'object') return { type: null, reason: 'no_booking' };
  if (isCancelled(order.status)) return { type: null, reason: 'cancelled' };
  if (!ownFlights(order).length) return { type: null, reason: 'no_flight' };
  const isPackage = ownItems(order).some((it) => PACKAGE_MAKERS.has(it.product));
  if (!isPackage) return s.flightOnly ? { type: 'flight-only' } : { type: null, reason: 'flight_only_off' };
  if (s.packageSingle) return { type: 'package-single' };
  if (s.packageMulti) return { type: 'package-multi' };
  return { type: null, reason: 'package_off' };
}

// ─── What the certificate says ─────────────────────────────────────────────

// Airline records arrive in capitals ("GEMMA WHITAKER"). Those, and all-lower
// names, are put into ordinary case; a name typed in mixed case ("McDonald")
// is left exactly as it was written.
function nameCase(s) {
  const t = clean(s, 80);
  if (!t || (t !== t.toUpperCase() && t !== t.toLowerCase())) return t;
  return t.toLowerCase().replace(/(^|[\s'’-])(\p{L})/gu, (m, sep, ch) => sep + ch.toUpperCase());
}
// Titles as airlines abbreviate them, written the way a person would.
const TITLES = { MR: 'Mr', MRS: 'Mrs', MS: 'Ms', MISS: 'Miss', MSTR: 'Master', MASTER: 'Master', DR: 'Dr', PROF: 'Prof', REV: 'Rev' };
const titleOf = (t) => TITLES[clean(t, 30).toUpperCase().replace(/\./g, '')] || nameCase(t);
const personName = (p) => [titleOf(p.title), nameCase(p.firstname), nameCase(p.surname)].filter(Boolean).join(' ');
const isInfant = (p) => /infant/i.test(String(p && p.type || ''));

/** Everyone travelling on the protected parts, once each, lead first. */
function protectedPeople(order, type) {
  const own = ownItems(order);
  const lists = [];
  for (const it of own) {
    if (type === 'flight-only' && it.product !== 'Flights') continue;
    lists.push(it.accommodation && it.accommodation.guests, it.flights && it.flights.travellers,
      it.carRental && it.carRental.travellers, it.transfers && it.transfers.travellers,
      it.ticketsAttractions && it.ticketsAttractions.guests);
  }
  const seen = new Map();
  const out = [];
  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    for (const p of list) {
      if (!p || typeof p !== 'object') continue;
      const key = (clean(p.firstname, 80) + '|' + clean(p.surname, 80)).toLowerCase();
      if (key === '|') continue;
      const had = seen.get(key);
      if (had) {
        // The hotel's record often has the type 'Lead' and no title; the
        // airline's has the title. Keep the first, borrow what it lacked.
        if (!had.title && p.title) had.title = p.title;
        if (isInfant(p)) had.type = p.type;
        continue;
      }
      const copy = { title: p.title, firstname: p.firstname, surname: p.surname, type: p.type };
      seen.set(key, copy);
      out.push(copy);
    }
  }
  // Lead first, then the order they were booked in.
  out.sort((a, b) => (/lead/i.test(b.type || '') ? 1 : 0) - (/lead/i.test(a.type || '') ? 1 : 0));
  return out;
}

// "Sat 26 Sep 2026". Built by hand: Intl's en-GB gives "Sat, 26 Sept 2026".
// Read with bookingMoment, printed from its UTC fields: a booking date is a
// calendar date, not an instant (CLAUDE.md, ET121109).
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function tripDay(v) {
  if (!v) return '';
  const m = bookingMoment(v);
  if (!m || Number.isNaN(m.getTime())) return '';
  return WD[m.getUTCDay()] + ' ' + m.getUTCDate() + ' ' + MON[m.getUTCMonth()] + ' ' + m.getUTCFullYear();
}
const place = (pt) => {
  if (!pt) return '';
  const code = clean(pt.iataCode, 10).toUpperCase();
  const name = clean(pt.name, 80);
  // "London Luton (LTN)". Skip the code only when the name already carries it
  // as a word of its own: "Rhodes" contains RHO but does not say it.
  if (name && code && !new RegExp('\\b' + code + '\\b').test(name.toUpperCase())) return name + ' (' + code + ')';
  return name || code;
};
// "U2 2231": the carrier's code, a space, the number. Travelify sends the
// number on its own ("2231") or with the code already on it ("U22232"), and a
// code ending in a digit run straight into the number reads as nonsense.
function flightNumber(seg) {
  const no = clean(seg && seg.flightNo, 20).toUpperCase().replace(/\s+/g, '');
  if (!no) return '';
  const code = clean(seg.marketingCarrier && seg.marketingCarrier.code, 10).toUpperCase();
  if (code && no.startsWith(code) && /^\d/.test(no.slice(code.length))) return code + ' ' + no.slice(code.length);
  return /^\d/.test(no) && code ? code + ' ' + no : no;
}
function directionLabel(d, i, n) {
  const s = String(d || '').toLowerCase();
  if (/out/.test(s)) return 'Outbound flight';
  if (/in|ret|back|home/.test(s)) return 'Return flight';
  return n === 2 ? (i === 0 ? 'Outbound flight' : 'Return flight') : 'Flight';
}

function flightLines(order) {
  const lines = [];
  for (const it of ownFlights(order)) {
    const routes = Array.isArray(it.flights.routes) ? it.flights.routes : [];
    routes.forEach((r, i) => {
      const segs = (Array.isArray(r && r.segments) ? r.segments : []).filter(Boolean);
      if (!segs.length) return;
      const first = segs[0], last = segs[segs.length - 1];
      const via = segs.slice(0, -1).map((s) => clean(s.destination && s.destination.iataCode, 10).toUpperCase()).filter(Boolean);
      const nos = segs.map(flightNumber).filter(Boolean);
      const parts = [
        directionLabel(r.direction, i, routes.length) + (tripDay(first.depart) ? ', ' + tripDay(first.depart) : '') + ':',
        place(first.origin) + ' to ' + place(last.destination) + (via.length ? ' via ' + via.join(', ') : ''),
      ];
      let line = parts.join(' ');
      if (nos.length) line += ', ' + (nos.length > 1 ? 'flights ' + nos.join(' and ') : 'flight ' + nos[0]);
      lines.push(line);
    });
  }
  return lines;
}

function packageLines(order) {
  const lines = flightLines(order);
  const own = new Set(ownItems(order));
  for (const st of listStays(order)) {
    if (!own.has(st.item)) continue;
    const city = clean(st.accom && st.accom.location && st.accom.location.city, 60);
    let l = 'Accommodation: ' + clean(st.name, 100) + (city && !st.name.includes(city) ? ', ' + city : '');
    if (st.nights) l += ', ' + st.nights + (st.nights === 1 ? ' night' : ' nights');
    if (st.checkin) l += ' from ' + tripDay(st.checkin);
    lines.push(l);
  }
  for (const it of ownItems(order)) {
    if (it.product === 'CarRental' && it.carRental) {
      const c = it.carRental;
      const where = clean(c.pickup && c.pickup.name, 80);
      const when = tripDay((c.pickup && c.pickup.dateTime) || it.startDate);
      lines.push('Car hire' + (when ? ' from ' + when : '') + (where ? ', collected at ' + where : ''));
    } else if (it.product === 'Transfers' && it.transfers) {
      const t = it.transfers;
      const from = clean(t.outPickup && t.outPickup.name, 60), to = clean(t.outDropoff && t.outDropoff.name, 60);
      const when = tripDay((t.outPickup && t.outPickup.dateTime) || it.startDate);
      lines.push('Transfers' + (from && to ? ': ' + from + ' to ' + to : '') + (t.returnPickup ? ' and back' : '') + (when ? ', ' + when : ''));
    } else if (it.product === 'TicketsAttractions' && it.ticketsAttractions) {
      const when = tripDay(it.startDate);
      lines.push('Tickets: ' + clean(it.ticketsAttractions.name, 100) + (when ? ', ' + when : ''));
    }
  }
  return lines;
}

function money(amount, currency) {
  const cur = /^[A-Z]{3}$/.test(String(currency || '').toUpperCase()) ? String(currency).toUpperCase() : 'GBP';
  try { return new Intl.NumberFormat('en-GB', { style: 'currency', currency: cur }).format(amount); }
  catch { return cur + ' ' + amount.toFixed(2); }
}

const FP_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function fingerprint(parts) {
  const h = createHash('sha256').update(JSON.stringify(parts)).digest();
  let out = '';
  for (let i = 0; i < 5; i++) out += FP_ALPHABET[h[i] % FP_ALPHABET.length];
  return out;
}

/**
 * Everything the certificate will say, as plain strings. Throws only on a
 * type it does not know; call atolCertificateType first.
 *   { type, typeLabel, names[], passengers, protectedLines[], protector,
 *     cost, costAmount, currency, holderName, issuerName, atolNumber,
 *     reference, fingerprint }
 */
export function buildAtolCertificate(order, settingsRaw, { type, orderRef } = {}) {
  if (!ATOL_TYPES[type]) throw new Error('unknown ATOL certificate type: ' + type);
  const s = settingsRaw && typeof settingsRaw.ready === 'boolean' ? settingsRaw : normaliseAtolSettings(settingsRaw);
  const people = protectedPeople(order, type);
  const names = people.map(personName).filter(Boolean);
  const passengers = people.filter((p) => !isInfant(p)).length;
  const protectedLines = type === 'flight-only' ? flightLines(order) : packageLines(order);

  let costAmount = null, currency = '';
  if (type === 'flight-only') {
    const fl = ownFlights(order);
    const priced = fl.filter((it) => typeof it.price === 'number' && Number.isFinite(it.price));
    if (priced.length) {
      costAmount = Math.round(priced.reduce((t, it) => t + it.price, 0) * 100) / 100;
      currency = (fl[0] && (fl[0].currency || (fl[0].flights.pricing && fl[0].flights.pricing.currency))) || order.currency || 'GBP';
    }
  }
  const cost = costAmount == null ? '' : money(costAmount, currency);
  const ref = clean(orderRef || (order && order.id) || '', 40).toUpperCase().replace(/\s+/g, '');
  const fp = fingerprint([type, s.holderName, s.atolNumber, names, passengers, protectedLines, cost]);
  return {
    type,
    typeLabel: ATOL_TYPES[type].label,
    names,
    passengers,
    protectedLines,
    protector: s.holderName + ', ATOL number ' + s.atolNumber,
    cost,
    costAmount,
    currency: costAmount == null ? '' : (String(currency || 'GBP').toUpperCase()),
    holderName: s.holderName,
    issuerName: s.holderName,
    atolNumber: s.atolNumber,
    reference: (ref ? ref + '-' : '') + fp,
    fingerprint: fp,
  };
}

// ─── Drawing it on the CAA's page ──────────────────────────────────────────

const INK_RGB = [44 / 255, 46 / 255, 53 / 255];   // the certificate's own text colour
const TEMPLATE_DIR = new URL('../_data/atol/', import.meta.url);
const templateCache = new Map();
function templateBytes(type) {
  if (!templateCache.has(type)) templateCache.set(type, readFileSync(new URL(ATOL_TYPES[type].file, TEMPLATE_DIR)));
  return templateCache.get(type);
}

/** True for an Acrobat watermark: a form XObject whose PieceInfo says so. */
function isWatermark(doc, xobj, { PDFName, PDFDict, PDFRef }) {
  const x = xobj instanceof PDFRef ? doc.context.lookup(xobj) : xobj;
  const dict = x && x.dict;
  if (!dict) return false;
  const piece = dict.lookup(PDFName.of('PieceInfo'));
  const ct = piece instanceof PDFDict ? piece.lookup(PDFName.of('ADBE_CompoundType')) : null;
  const priv = ct instanceof PDFDict ? ct.get(PDFName.of('Private')) : null;
  return !!priv && priv.toString() === '/Watermark';
}

/**
 * Take the SAMPLE watermark off the page: find the XObjects Acrobat marked as
 * a watermark and delete the operator that paints each. Returns how many draws
 * were removed (1 on each CAA sample), so a test can tell it happened.
 */
export async function removeSampleWatermark(doc) {
  const lib = await pdfLib();
  const { PDFName, PDFArray, PDFDict, PDFRef, decodePDFRawStream } = lib;
  const page = doc.getPage(0);
  const xobjs = page.node.Resources().lookup(PDFName.of('XObject'));
  if (!(xobjs instanceof PDFDict)) return 0;
  const names = xobjs.keys().filter((k) => isWatermark(doc, xobjs.get(k), lib)).map((k) => k.toString().slice(1));
  if (!names.length) return 0;
  const c = page.node.get(PDFName.of('Contents'));
  const cv = doc.context.lookup(c);
  const refs = cv instanceof PDFArray ? cv.asArray() : [c];
  let removed = 0;
  for (const ref of refs) {
    if (!(ref instanceof PDFRef)) continue;
    const stream = doc.context.lookup(ref);
    let text = Buffer.from(decodePDFRawStream(stream).decode()).toString('latin1');
    for (const n of names) {
      const re = new RegExp('/' + n.replace(/[^A-Za-z0-9]/g, '\\$&') + '\\s+Do\\b', 'g');
      removed += (text.match(re) || []).length;
      text = text.replace(re, '');
    }
    doc.context.assign(ref, doc.context.flateStream(Buffer.from(text, 'latin1')));
  }
  return removed;
}

// Where each blank is, in PDF points from the bottom left of the A4 page. Read
// off the CAA files themselves (the text positions of the labels round each
// blank, and the ruled boxes of the footer table).
const FOOTER = { y: 41.5, ref: [46, 170.5], date: [170.5, 262.5], issuer: [262.5, 357], atol: [357, 449] };
const LAYOUT = {
  'flight-only': {
    namesTop: 607, namesBottom: 584,
    whatTop: 555, whatBottom: 530,
    protector: { label: 'Who is protecting your flight?', y: 518, below: 503 },
    cost: { y: 458 },
    // The first blank starts its line and runs into "stops trading", so the
    // name sits against it; the second follows "If" and starts there.
    stops: [{ x: 58, y: 392, right: 232, alignRight: true }, { x: 70, y: 295, right: 232 }],
    confirmFrom: null,
    footIssuer: { x: 140, y: 148, right: 260, size: 9 },
    heldBy: { x: 58, y: 135, label: 'ATOL held by', size: 9 },
    dateSlashes: true,
  },
  package: {
    namesTop: 607, namesBottom: 556,
    whatTop: 529, whatBottom: 481,
    protector: { label: 'Who is protecting your trip?', y: 430 },
    cost: null,
    stops: [{ x: 70, y: 363, right: 540 }, { x: 70, y: 264, right: 540 }],
    confirmFrom: { x: 58, y: 456, label: 'confirmation you will receive from', right: 540 },
    footIssuer: { x: 141, y: 171, right: 540, size: 9 },
    heldBy: null,
    dateSlashes: false,
  },
};

/**
 * Only characters Helvetica's WinAnsi encoding can draw. Accents it has
 * (é, ü, ñ) stay; anything else loses its accent (ł is drawn l) or becomes '?',
 * rather than failing the whole certificate over one letter.
 */
function drawable(font, text) {
  let out = '';
  for (const ch of String(text || '')) {
    try { font.encodeText(ch); out += ch; continue; } catch { /* not in WinAnsi */ }
    const base = ch.normalize('NFD').replace(/[̀-ͯ]/g, '');
    const alt = { 'ł': 'l', 'Ł': 'L', 'đ': 'd', 'Đ': 'D', 'ı': 'i', 'ø': 'o', 'Ø': 'O', '’': "'", '‘': "'", '–': '-', '—': '-' }[ch] || base;
    try { font.encodeText(alt); out += alt; } catch { out += '?'; }
  }
  return out;
}

/** Break text into lines no wider than `width` at `size`. */
function wrap(font, text, size, width) {
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const w of words) {
    const tryLine = line ? line + ' ' + w : w;
    if (font.widthOfTextAtSize(tryLine, size) <= width || !line) line = tryLine;
    else { lines.push(line); line = w; }
  }
  if (line) lines.push(line);
  return lines;
}

/**
 * Fit paragraphs into a box: the largest size from `max` down to `min` at which
 * every paragraph wraps inside the width and the lines fit between top and
 * bottom. Returns the lines and the size, or the smallest attempt if nothing
 * fits (the caller has already kept the content short).
 */
function fitBlock(font, paragraphs, { width, top, bottom, max = 11, min = 5 }) {
  let best = null;
  for (let size = max; size >= min - 0.001; size -= 0.25) {
    const lead = size * 1.18;
    const lines = [];
    for (const p of paragraphs) lines.push(...wrap(font, p, size, width));
    best = { lines, size, lead };
    if ((lines.length - 1) * lead <= top - bottom) return best;
  }
  return best;
}

/** One line of text, shrunk until it fits `width` (never below `min`). */
function fitLine(font, text, max, width, min = 5.5) {
  let size = max;
  while (size > min && font.widthOfTextAtSize(text, size) > width) size -= 0.25;
  return size;
}

/**
 * Text into a box of `width` by `height`: the largest size, from `max` down,
 * at which it wraps to lines that all fit the width and together fit the
 * height. Nothing may overprint the CAA's own wording, so this keeps going
 * down to 4pt before it gives up, and a word too long for the width at any
 * size is the only thing that can still run over.
 */
function fitWrapped(font, text, width, height, max) {
  let last = null;
  for (let size = max; size >= 4 - 0.001; size -= 0.25) {
    const lines = wrap(font, text, size, width);
    const lead = size * 1.12;
    last = { lines, size, lead };
    const tall = size + (lines.length - 1) * lead;
    if (tall <= height && lines.every((l) => font.widthOfTextAtSize(l, size) <= width)) return last;
  }
  return last;
}

/**
 * The finished certificate as PDF bytes. `model` from buildAtolCertificate;
 * `issuedOn` a Date (the certificate's date of issue).
 */
export async function renderAtolCertificatePdf(model, { issuedOn, sample = false } = {}) {
  const { PDFDocument, StandardFonts, rgb } = await pdfLib();
  const INK = rgb(...INK_RGB);
  const doc = await PDFDocument.load(templateBytes(model.type));
  // A preview keeps the CAA's own SAMPLE watermark, so a specimen made with a
  // real ATOL number can never pass for a certificate. Only a real booking
  // gets a clean page.
  if (!sample) await removeSampleWatermark(doc);
  doc.setTitle('ATOL Certificate ' + model.reference);
  doc.setSubject(model.typeLabel + ' ATOL Certificate issued by ' + model.issuerName);
  doc.setProducer('Travelgenix');
  doc.setCreator('Travelgenix My Booking');
  const page = doc.getPage(0);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const L = LAYOUT[model.type === 'flight-only' ? 'flight-only' : 'package'];
  const text = (t, x, y, size, f = font) => page.drawText(drawable(f, t), { x, y, size, font: f, color: INK });
  const LEFT = 58, RIGHT = 540;

  // A name in a blank inside the CAA's sentences: on the line itself when it
  // fits at a readable size, otherwise wrapped onto two short lines either
  // side of it, still inside the gap the form leaves.
  const inBlank = (raw, { x, right, y, max, alignRight = false, room = 12 }) => {
    const nm = drawable(font, raw);
    const width = right - x;
    const one = fitLine(font, nm, max, width);
    if (font.widthOfTextAtSize(nm, one) <= width && one >= Math.min(7.5, max)) {
      text(nm, alignRight ? right - font.widthOfTextAtSize(nm, one) : x, y, one);
      return;
    }
    const f = fitWrapped(font, nm, width, room, 7);
    const mid = y + (max * 0.35);
    const top = mid + ((f.lines.length - 1) * f.lead) / 2 - f.size * 0.35;
    f.lines.forEach((ln, i) => {
      const w = font.widthOfTextAtSize(ln, f.size);
      text(ln, alignRight ? right - w : x, top - i * f.lead, f.size);
    });
  };

  // Number of passengers, after its label.
  const npLabelW = bold.widthOfTextAtSize('Number of passengers:', 12);
  text(String(model.passengers), 376 + npLabelW + 6, 622, 12);

  // Who is protected.
  const names = fitBlock(font, [model.names.map((n) => drawable(font, n)).join(', ')], { width: RIGHT - LEFT, top: L.namesTop, bottom: L.namesBottom });
  names.lines.forEach((ln, i) => text(ln, LEFT, L.namesTop - i * names.lead, names.size));

  // What is protected.
  const what = fitBlock(font, model.protectedLines.map((l) => drawable(font, l)), { width: RIGHT - LEFT, top: L.whatTop, bottom: L.whatBottom, max: 10.5 });
  what.lines.forEach((ln, i) => text(ln, LEFT, L.whatTop - i * what.lead, what.size));

  // Who is protecting your flight / trip.
  const P = L.protector;
  if (P.below) {
    const sz = fitLine(font, drawable(font, model.protector), 11, RIGHT - LEFT);
    text(model.protector, LEFT, P.below, sz);
  } else {
    const x = LEFT + bold.widthOfTextAtSize(P.label, 12) + 8;
    const sz = fitLine(font, drawable(font, model.protector), 11, RIGHT - x);
    text(model.protector, x, P.y, sz);
  }

  // ATOL protected cost (Flight-only).
  if (L.cost && model.cost) text(model.cost, LEFT, L.cost.y, 11);

  // The ATOL holder's name inside "If ... stops trading".
  for (const b of L.stops) inBlank(model.holderName, { ...b, max: 12 });

  // "... on the confirmation you will receive from <issuer>" (packages).
  if (L.confirmFrom) {
    const c = L.confirmFrom;
    const x = 127 + font.widthOfTextAtSize('you will receive from', 12) + 4;
    inBlank(model.issuerName, { x, right: c.right, y: c.y, max: 12 });
  }

  // The regulation 17 paragraph: "<issuer> confirms ..." and "ATOL held by <holder>".
  const fi = L.footIssuer;
  inBlank(model.issuerName, { x: fi.x, right: fi.right, y: fi.y, max: fi.size, room: 11 });
  if (L.heldBy) {
    const h = L.heldBy;
    const x = h.x + font.widthOfTextAtSize(h.label + ' ', h.size);
    inBlank(model.holderName, { x, right: RIGHT, y: h.y, max: h.size, room: 10 });
  }

  // The footer table: reference, date of issue, issuer, ATOL number.
  const centred = (t, [x0, x1], y, max, f = font, pad = 8) => {
    const s = drawable(f, t);
    const size = fitLine(f, s, max, x1 - x0 - pad);
    page.drawText(s, { x: (x0 + x1) / 2 - f.widthOfTextAtSize(s, size) / 2, y, size, font: f, color: INK });
  };
  // A footer cell (the row runs from y 37 to 54.5): one line on the row's
  // baseline if it fits, otherwise wrapped and centred in the cell.
  const cell = (t, [x0, x1], max) => {
    const s = drawable(font, t);
    const width = x1 - x0 - 10;
    const one = fitLine(font, s, max, width);
    if (one >= 7 && font.widthOfTextAtSize(s, one) <= width) {
      centred(s, [x0, x1], FOOTER.y, max, font, 10);
      return;
    }
    const f = fitWrapped(font, s, width, 15, 7.5);
    const blockTop = 45.75 + ((f.lines.length - 1) * f.lead) / 2 - f.size * 0.35;
    f.lines.forEach((ln, i) => page.drawText(ln, {
      x: (x0 + x1) / 2 - font.widthOfTextAtSize(ln, f.size) / 2, y: blockTop - i * f.lead, size: f.size, font, color: INK,
    }));
  };
  cell(model.reference, FOOTER.ref, 10.5);
  const d = issuedOn instanceof Date && !Number.isNaN(issuedOn.getTime()) ? issuedOn : new Date();
  const dd = String(d.getUTCDate()).padStart(2, '0'), mm = String(d.getUTCMonth() + 1).padStart(2, '0'), yyyy = String(d.getUTCFullYear());
  if (L.dateSlashes) {
    // The Flight-only form prints its own slashes at x 202 and 231.
    centred(dd, [178, 202], FOOTER.y, 11, font, 2);
    centred(mm, [206, 231], FOOTER.y, 11, font, 2);
    centred(yyyy, [235, 263], FOOTER.y, 10.5, font, 2);
  } else {
    centred(dd + '/' + mm + '/' + yyyy, FOOTER.date, FOOTER.y, 11);
  }
  // The issuer's legal name in a 94pt cell: wrapped when it is long.
  cell(model.issuerName, FOOTER.issuer, 10);
  cell(model.atolNumber, FOOTER.atol, 11);

  return doc.save();
}

// ─── A made-up booking, for the editor's preview ───────────────────────────

/**
 * The booking a client sees their details on when they press Preview in the
 * My Booking editor. Obviously invented, in the real trimmed shape. Always
 * rendered with the CAA's SAMPLE watermark left on.
 */
export function sampleAtolBooking(type) {
  const people = [
    { type: 'Lead', title: 'Mrs', firstname: 'Sample', surname: 'Traveller' },
    { type: 'Adult', title: 'Mr', firstname: 'Example', surname: 'Traveller' },
    { type: 'Child', title: 'Miss', firstname: 'Specimen', surname: 'Traveller' },
  ];
  const seg = (from, fromName, to, toName, when, no) => ({
    origin: { iataCode: from, name: fromName }, destination: { iataCode: to, name: toName },
    depart: when, marketingCarrier: { code: 'U2', name: 'easyJet' }, flightNo: no,
  });
  const items = [{
    id: 1, status: 'Confirmed', product: 'Flights', price: 642.3, currency: 'GBP', startDate: '2027-05-14T00:00:00',
    flights: {
      routes: [
        { direction: 'Outbound', segments: [seg('LGW', 'London Gatwick', 'FAO', 'Faro', '2027-05-14T07:05:00', '8161')] },
        { direction: 'Inbound', segments: [seg('FAO', 'Faro', 'LGW', 'London Gatwick', '2027-05-21T11:40:00', '8162')] },
      ],
      travellers: people,
    },
  }];
  if (type !== 'flight-only') {
    items.push({
      id: 2, status: 'Confirmed', product: 'Accommodation', price: 1180, currency: 'GBP', startDate: '2027-05-14T00:00:00', duration: 7,
      accommodation: { name: 'Sample Beach Hotel', location: { city: 'Albufeira' }, units: [{ checkin: '2027-05-14T00:00:00', nights: 7 }], guests: people },
    });
  }
  return { id: 100000, status: 'Confirmed', currency: 'GBP', items };
}
