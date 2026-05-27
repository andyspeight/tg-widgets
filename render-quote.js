/**
 * render-quote.js
 * ----------------
 * Pure renderer: takes a Quick Quote `quoteDocument` object and returns a
 * complete, print-ready HTML string for a client-facing holiday quote PDF.
 *
 * Design: follows travelgenix-design tokens (navy #1B2B5B / teal #00B4D8).
 * Security (travelgenix-security):
 *   - The hotel `description` field is HTML from a supplier API, so it is
 *     sanitised against an allowlist before being injected. Everything else
 *     is HTML-escaped.
 *   - PRICE RULE: only the public sell `price` and per-person figure are ever
 *     shown. nettPrice / costPrice / memberPrice are never read by this module.
 *
 * This file is environment-agnostic (no Node-only APIs) so it drops straight
 * into a Vercel route later.
 */

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

/** Escape text for safe insertion into HTML. */
function esc(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Sanitise the supplier-provided description HTML against a small allowlist.
 * Permits only h3, p, br, hr, ul, li, strong, em. Strips everything else,
 * including any attributes, scripts, event handlers, and unknown tags.
 */
function sanitiseDescription(html) {
  if (!html) return '';
  const allowed = new Set(['h3', 'p', 'br', 'hr', 'ul', 'li', 'strong', 'em', 'b', 'i']);
  // Remove any tag that isn't in the allowlist; strip all attributes from those that are.
  return String(html).replace(/<\/?([a-zA-Z0-9]+)(\s[^>]*)?>/g, (match, tag) => {
    const t = tag.toLowerCase();
    if (!allowed.has(t)) return '';
    return match.startsWith('</') ? `</${t}>` : `<${t}>`;
  });
}

/** Format a number as GBP (or other currency) with no decimals when whole. */
function money(amount, currency = 'GBP') {
  const symbols = { GBP: '£', EUR: '€', USD: '$' };
  const sym = symbols[currency] || '';
  const n = Number(amount) || 0;
  const formatted = n.toLocaleString('en-GB', {
    minimumFractionDigits: n % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  });
  return `${sym}${formatted}`;
}

/** Format an ISO date (YYYY-MM-DD) as e.g. "08 Aug 2026". */
function niceDate(iso) {
  if (!iso) return '';
  const d = new Date(iso + (iso.length === 10 ? 'T00:00:00Z' : ''));
  if (isNaN(d)) return esc(iso);
  return d.toLocaleDateString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC',
  });
}

/** Star rating as filled/empty star glyphs (drawn, not emoji). */
function stars(rating) {
  const r = Math.round(Number(rating) || 0);
  let out = '';
  for (let i = 0; i < 5; i++) {
    out += `<span class="star ${i < r ? 'on' : 'off'}">&#9733;</span>`;
  }
  return out;
}

/** Yes/No pill for ATOL, transfers etc. */
function boolPill(value) {
  const yes = String(value).toLowerCase() === 'yes' || value === true;
  return `<span class="pill ${yes ? 'pill-yes' : 'pill-no'}">${yes ? 'Yes' : 'No'}</span>`;
}

// ----------------------------------------------------------------------------
// Normalisation — official Travelify hotlist shape -> flat renderer shape
// ----------------------------------------------------------------------------
//
// The Travelify hotlist API (GET /account/hotlist/{id}/{key}?isViewPage=true)
// returns { success, data:{ name, items:[{ travellers, product:{...} }] } }.
// Each item's `product` carries the hotel plus a `units[]` array, and every
// unit has `rates[]`, each with a `pricing` block that includes COST fields
// (nettPrice, memberPrice, originalPrice, inResortFees). There is NO curated
// "one room per hotel" object.
//
// This function flattens each item to the single LEAD-IN room (the rate whose
// sell `price` matches the item's headline `price`, i.e. isLeadIn). It reads
// ONLY sell-side fields — the cost fields are never copied into the flat shape,
// so the renderer (and the PDF) can never display them. This is the structural
// price guarantee: cost data is dropped at the boundary, not merely hidden.
//
// Accepts either the already-flat shape (legacy/sample) or the official raw
// response, so the renderer works with both.

/** Find the lead-in rate across an item's units. Returns { unit, rate } or null. */
function pickLeadInRate(product, headlinePrice) {
  const units = Array.isArray(product && product.units) ? product.units : [];
  let cheapest = null;
  let leadIn = null;
  for (const unit of units) {
    const rates = Array.isArray(unit.rates) ? unit.rates : [];
    for (const rate of rates) {
      const price = rate && rate.pricing && Number(rate.pricing.price);
      if (!Number.isFinite(price)) continue;
      // Lead-in = the rate whose sell price equals the item headline price.
      if (headlinePrice != null && price === Number(headlinePrice) && !leadIn) {
        leadIn = { unit, rate };
      }
      if (!cheapest || price < Number(cheapest.rate.pricing.price)) {
        cheapest = { unit, rate };
      }
    }
  }
  return leadIn || cheapest || null;
}

/** Map a board code (RoomOnly/BedAndBreakfast/HalfBoard/AllInclusive) to a label. */
function boardLabel(rate, unit) {
  const raw = (rate && (rate.name || rate.board)) || (unit && unit.board) || '';
  const map = {
    RoomOnly: 'Room Only', BedAndBreakfast: 'Bed & Breakfast',
    HalfBoard: 'Half Board', FullBoard: 'Full Board', AllInclusive: 'All Inclusive',
  };
  if (map[raw]) return map[raw];
  // Otherwise title-case the human name the API gave (e.g. "BED AND BREAKFAST").
  return String(raw).toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
}

/** Pull the best long-form description text from a product.descriptions array. */
function pickDescription(descriptions) {
  if (!Array.isArray(descriptions)) return '';
  const byTitle = t => descriptions.find(d => d && (d.title || '').toLowerCase() === t);
  const chosen = byTitle('description') || byTitle('summary') ||
    descriptions.find(d => d && d.type === 'Generic' && d.text);
  return (chosen && chosen.text) || '';
}

/** Compute nights from a checkin + nights field, or from check-in/out dates. */
function checkoutFrom(checkin, nights) {
  if (!checkin || !Number(nights)) return '';
  const d = new Date(checkin);
  if (isNaN(d)) return '';
  d.setUTCDate(d.getUTCDate() + Number(nights));
  return d.toISOString().slice(0, 10);
}

/** Flatten one official item to the renderer's flat item shape. Sell-side only. */
function normaliseItem(it) {
  const product = (it && it.product) || {};
  const headline = it && it.price != null ? Number(it.price) : null;
  const pick = pickLeadInRate(product, headline);
  const unit = pick && pick.unit;
  const rate = pick && pick.rate;

  const loc = product.location || {};
  const locationStr = [loc.city, loc.country].filter(Boolean).join(', ');
  const checkin = (unit && unit.checkin) ? String(unit.checkin).slice(0, 10) : '';
  const nights = unit && unit.nights;

  return {
    productType: it.productType || 'Accommodation',
    accommodationName: product.name || '',
    starRating: product.rating || 0,
    location: locationStr,
    checkIn: checkin,
    checkOut: checkoutFrom(unit && unit.checkin, nights),
    nights: nights || '',
    roomType: (unit && unit.name) || '',
    boardBasis: rate ? boardLabel(rate, unit) : '',
    // SELL price only — taken from the item headline (never the cost fields).
    price: headline != null ? headline : (rate && rate.pricing ? Number(rate.pricing.price) : 0),
    currency: (rate && rate.pricing && rate.pricing.currency) || product.pricing?.currency || 'GBP',
    travellers: Number(it.travellers) || 1,
    description: pickDescription(product.descriptions),
    images: Array.isArray(product.media)
      ? product.media.map(m => ({ url: m && m.url, name: m && m.caption })).filter(x => x.url)
      : [],
    // Hotlist items are accommodation-only — no flights in this API shape.
  };
}

/**
 * Normalise either shape into { quoteId, title, leadName, contactEmail,
 * contactTelNo, currency, travellers, items:[flat], total }.
 */
/**
 * Normalise any of the hotlist shapes into a flat object the renderer uses:
 *   { quoteId, title, leadName, contactEmail, contactTelNo, currency,
 *     travellers, items:[flat], total }
 *
 * The Travelify hotlist API returns one of two shapes depending on the quote:
 *   A) quoteDocument shape — data.quoteDocument = { setup, items:[flat], total }
 *      Items are already curated/flat (accommodationName, checkIn, price, ...).
 *      This is what most demo quotes use (e.g. 16809).
 *   B) raw-items shape — data.items[].product.units[].rates[]
 *      No quoteDocument; we extract the lead-in room per item (e.g. 17629).
 * Plus a legacy already-flat sample shape. We detect and route all three.
 */
function normaliseQuote(input) {
  // Unwrap a { success, data } envelope if present.
  const env = (input && input.data && typeof input.data === 'object') ? input.data : input;
  const top = env || {};

  // ---- Shape A: quoteDocument { setup, items:[flat], total } ----
  const qd = top.quoteDocument;
  if (qd && Array.isArray(qd.items) && qd.items.length) {
    const setup = qd.setup || {};
    const pax = Number(setup.adults || 0) + Number(setup.children || 0);
    return {
      quoteId: setup.quoteId || top.id || '',
      title: setup.quoteTitle || top.name || 'Your holiday quote',
      leadName: setup.leadName ||
        [top.customerFirstname, top.customerSurname].filter(Boolean).join(' ').trim(),
      contactEmail: top.contactEmail || '',
      contactTelNo: top.contactTelNo || '',
      currency: top.currency || qd.items[0].currency || 'GBP',
      travellers: pax || null,
      items: qd.items, // already flat; renderItem reads these directly
      total: Number(qd.total) || Number(top.quoteTotal) ||
        qd.items.reduce((s, i) => s + (Number(i.price) || 0), 0),
      destination: top.destination || setup.tripDestination || '',
      agent: top.agentName ? { name: top.agentName, email: top.contactEmail, phone: top.contactTelNo } : {},
    };
  }

  // ---- Legacy already-flat shape (sample): items[].accommodationName, no product ----
  const looksFlat = Array.isArray(top.items) && top.items[0] &&
    top.items[0].accommodationName !== undefined && !top.items[0].product;
  if (looksFlat) {
    const setup = top.setup || {};
    return {
      quoteId: top.quoteId || setup.quoteId || top.id || '',
      title: setup.quoteTitle || top.name || 'Your holiday quote',
      leadName: setup.leadName || '',
      contactEmail: top.contactEmail || '',
      contactTelNo: top.contactTelNo || '',
      currency: top.currency || 'GBP',
      travellers: Number(setup.adults) || null,
      items: top.items,
      total: Number(top.total) || top.items.reduce((s, i) => s + (Number(i.price) || 0), 0),
      destination: top.destination || '',
      agent: top.agent || {},
    };
  }

  // ---- Shape B: raw items[].product.units[].rates[] (extract lead-in room) ----
  const rawItems = Array.isArray(top.items) ? top.items : [];
  const items = rawItems.map(normaliseItem);
  const total = items.reduce((s, i) => s + (Number(i.price) || 0), 0);
  const lead = [top.customerTitle, top.customerFirstname, top.customerSurname]
    .filter(Boolean).join(' ').trim();
  const travellers = rawItems.reduce((m, i) => Math.max(m, Number(i.travellers) || 0), 0) || null;

  return {
    quoteId: top.id || '',
    title: top.name || 'Your holiday quote',
    leadName: lead,
    contactEmail: top.contactEmail || '',
    contactTelNo: top.contactTelNo || '',
    currency: items[0] ? items[0].currency : (top.currency || 'GBP'),
    travellers,
    items,
    total,
    destination: top.destination || '',
    agent: {},
  };
}

// ----------------------------------------------------------------------------
// Item block
// ----------------------------------------------------------------------------

// Package-embedded flights (legacy accommodation shape): uses IATA airport
// codes (departureAirport/arrivalAirport). Standalone `flights` items use long
// city strings via origin/destination and are rendered by renderFlightCard.
function renderFlights(item) {
  // Show the flights block when we have any airport/airline/flight info.
  const hasFlights = item.departureAirport || item.arrivalAirport ||
    item.airline || item.outboundFlightNumber;
  if (!hasFlights) return '';

  // Return leg: use explicit return airports if present, otherwise it's the
  // reverse of the outbound (arrival -> departure), which is what the viewer
  // shows for round trips.
  const retDep = item.returnDepartureAirport || item.arrivalAirport;
  const retArr = item.returnArrivalAirport || item.departureAirport;
  const retAirline = item.returnAirline || item.airline;

  // Build the small meta line under each leg. Show airline + date, and the
  // flight number only if we actually have one — otherwise "Flight details
  // pending" (never invent a number or time we don't hold).
  const legMeta = (airline, flightNo, date) => {
    const bits = [];
    if (airline) bits.push(esc(airline));
    if (flightNo) bits.push(esc(flightNo));
    if (date) bits.push(niceDate(date));
    const line = bits.join(' &middot; ');
    return line
      ? `<div class="leg-meta">${line}</div>` +
        (flightNo ? '' : '<div class="leg-pending">Flight details pending</div>')
      : '<div class="leg-pending">Flight details pending</div>';
  };

  const leg = (tag, dep, arr, meta) => `
    <div class="flight-leg">
      <div class="leg-tag">${tag}</div>
      <div class="leg-route">
        <div class="airport"><div class="iata">${esc(dep || '')}</div></div>
        <div class="leg-arrow" aria-hidden="true">&#9992;</div>
        <div class="airport"><div class="iata">${esc(arr || '')}</div></div>
      </div>
      ${meta}
    </div>`;

  return `
  <div class="flights">
    ${leg('Outbound', item.departureAirport, item.arrivalAirport,
      legMeta(item.airline, item.outboundFlightNumber, item.departureDate))}
    ${leg('Return', retDep, retArr,
      legMeta(retAirline, item.returnFlightNumber, item.returnDate))}
  </div>`;
}

function renderImages(images) {
  if (!Array.isArray(images) || images.length === 0) return '';
  // Cap at 2. Supplier hotel photos are often 150KB-1MB+ each at source and
  // Chromium embeds them at full resolution, so each image materially grows the
  // PDF. Two keeps the document attractive while staying well within email
  // attachment limits (SendGrid hard limit 30MB; practical target <7MB). A
  // proper image-resize proxy is the fast-follow if multi-hotel quotes get big.
  //
  // Hotlist images carry a hosted `url`. Manually uploaded images instead carry
  // a base64 `preview` data-URI (no url), so fall back to that. Skip any image
  // with no usable source rather than emitting a broken/empty cell.
  const shots = images.slice(0, 2).map(img => {
    const src = img.url || img.preview || '';
    if (!src) return '';
    return `<div class="gallery-cell"><img src="${esc(src)}" alt="${esc(img.name || 'Hotel image')}" /></div>`;
  }).filter(Boolean).join('');
  if (!shots) return '';
  return `<div class="gallery">${shots}</div>`;
}

function renderDetailRow(label, value) {
  if (value === '' || value === null || value === undefined) return '';
  return `<div class="detail"><dt>${esc(label)}</dt><dd>${value}</dd></div>`;
}

// ----------------------------------------------------------------------------
// Item cards — type-aware dispatcher
// ----------------------------------------------------------------------------
//
// Quotes built in the current Quick Quote builder carry a flat `quoteDocument`
// whose items each have a `type` field. Confirmed live types and their fields:
//
//   hotels      hotelName, city, propertyType, starRating, checkIn, checkOut,
//               nights, roomType, boardBasis, description/descriptionHtml, images[]
//   transfers   origin, destination, date, time, passengers, vehicleType
//   activities  activityName, location, date, time, participants
//   carhire     company, carType, pickupLocation, dropoffLocation,
//               pickupDate, dropoffDate
//   cruises     cruiseName, cruiseLine, shipName, departurePort, cabinType,
//               nights, startDate, endDate, summary, itinerary[{day,port,description}]
//   flights     airline, origin, destination, cabinClass, departureDate,
//               returnDate, outboundFlightNumber, returnFlightNumber
//
// Legacy quotes (no quoteDocument) arrive via normaliseItem with `productType`
// ('Accommodation'/'DynamicPackage') and the older accommodation field names
// (accommodationName, departureAirport, atolProtected, transfersIncluded).
// renderAccommodationCard handles BOTH the new `hotels` type and that legacy
// shape, reading whichever field names are present.
//
// ATOL and transfers are quote-level (quoteDocument.setup.atolProtected) and are
// NOT rendered per item, except on the legacy accommodation/package shape where
// they genuinely live on the item.

/** Shared card shell: header (type label, title, optional stars + sub), price. */
function itemShell(opts) {
  const { typeLabel, title, sub, starRating, price, cur, travellers, body } = opts;
  const pp = Number(travellers) > 1
    ? money(Number(price) / Number(travellers), cur) + ' pp'
    : 'total';
  return `
  <section class="item">
    <div class="item-head">
      <div class="item-head-main">
        <div class="item-type">${esc(typeLabel)}</div>
        <h2 class="item-title">${esc(title || 'Item')}</h2>
        ${(sub || starRating) ? `<div class="item-sub">
          ${starRating ? `<span class="rating">${stars(starRating)}</span>` : ''}
          ${sub ? `<span class="loc">${esc(sub)}</span>` : ''}
        </div>` : ''}
      </div>
      <div class="item-price">
        <div class="item-price-amount">${money(price, cur)}</div>
        <div class="item-price-label">${pp}</div>
      </div>
    </div>
    ${body}
  </section>`;
}

/** Accommodation — handles new `hotels` type and legacy accommodation/package. */
function renderAccommodationCard(item, cur) {
  const name = item.hotelName || item.accommodationName || 'Accommodation';
  const loc = item.city || item.location || '';
  const typeLabel = item.productType === 'DynamicPackage'
    ? 'Flight + Hotel Package'
    : (item.propertyType || 'Accommodation');

  const details = [
    renderDetailRow('Location', esc(loc)),
    renderDetailRow('Property type', esc(item.propertyType)),
    renderDetailRow('Check-in', niceDate(item.checkIn)),
    renderDetailRow('Check-out', niceDate(item.checkOut)),
    renderDetailRow('Nights', esc(item.nights)),
    renderDetailRow('Room type', esc(item.roomType)),
    renderDetailRow('Board basis', esc(item.boardBasis)),
    renderDetailRow('Operator', esc(item.operator)),
    // ATOL/transfers only on the legacy shape that actually carries them.
    item.atolProtected !== undefined && item.atolProtected !== ''
      ? renderDetailRow('ATOL protected', boolPill(item.atolProtected)) : '',
    item.transfersIncluded !== undefined && item.transfersIncluded !== ''
      ? renderDetailRow('Transfers included', boolPill(item.transfersIncluded)) : '',
  ].join('');

  const desc = item.descriptionHtml || item.description;
  return itemShell({
    typeLabel, title: name, sub: loc, starRating: item.starRating,
    price: item.price, cur, travellers: item.travellers,
    body: `
      ${renderFlights(item)}
      <dl class="details">${details}</dl>
      ${renderImages(item.images)}
      ${desc ? `<div class="description">${sanitiseDescription(desc)}</div>` : ''}`,
  });
}

/** Car hire. */
function renderCarHireCard(item, cur) {
  const days = (() => {
    if (!item.pickupDate || !item.dropoffDate) return '';
    const a = new Date(item.pickupDate), b = new Date(item.dropoffDate);
    const n = Math.round((b - a) / 86400000);
    return n > 0 ? `${n} day${n === 1 ? '' : 's'}` : '';
  })();
  const details = [
    renderDetailRow('Vehicle', esc(item.carType)),
    renderDetailRow('Supplier', esc(item.company)),
    renderDetailRow('Pick-up', esc(item.pickupLocation)),
    renderDetailRow('Pick-up date', niceDate(item.pickupDate)),
    renderDetailRow('Drop-off', esc(item.dropoffLocation)),
    renderDetailRow('Drop-off date', niceDate(item.dropoffDate)),
    renderDetailRow('Duration', esc(days)),
  ].join('');
  return itemShell({
    typeLabel: 'Car hire', title: item.carType || 'Car hire', sub: item.company,
    price: item.price, cur, travellers: item.travellers,
    body: `<dl class="details">${details}</dl>`,
  });
}

/** Activity / ticket. */
function renderActivityCard(item, cur) {
  const details = [
    renderDetailRow('Activity', esc(item.activityName)),
    renderDetailRow('Location', esc(item.location)),
    renderDetailRow('Date', niceDate(item.date)),
    renderDetailRow('Time', esc(item.time)),
    renderDetailRow('Participants', item.participants
      ? esc(`${item.participants} ${Number(item.participants) === 1 ? 'person' : 'people'}`) : ''),
  ].join('');
  return itemShell({
    typeLabel: 'Activity', title: item.activityName || 'Activity', sub: item.location,
    price: item.price, cur, travellers: item.travellers,
    body: `<dl class="details">${details}</dl>`,
  });
}

/** Transfer. */
function renderTransferCard(item, cur) {
  const when = [niceDate(item.date), item.time].filter(Boolean).join(' &middot; ');
  const details = [
    renderDetailRow('From', esc(item.origin)),
    renderDetailRow('To', esc(item.destination)),
    renderDetailRow('Vehicle', esc(item.vehicleType)),
    renderDetailRow('When', when),
    renderDetailRow('Passengers', item.passengers
      ? esc(`${item.passengers} ${Number(item.passengers) === 1 ? 'passenger' : 'passengers'}`) : ''),
  ].join('');
  const title = (item.origin && item.destination)
    ? `${item.origin} to ${item.destination}` : (item.vehicleType || 'Transfer');
  return itemShell({
    typeLabel: 'Transfer', title, sub: item.vehicleType,
    price: item.price, cur, travellers: item.travellers,
    body: `<dl class="details">${details}</dl>`,
  });
}

/** Standalone flight — uses long city strings (origin/destination), not IATA. */
function renderFlightCard(item, cur) {
  const cityLeg = (tag, from, to, airline, flightNo, date) => {
    const meta = [airline && esc(airline), flightNo && esc(flightNo), date && niceDate(date)]
      .filter(Boolean).join(' &middot; ');
    return `
      <div class="cityleg">
        <div class="leg-tag">${tag}</div>
        <div class="cityleg-route">
          <span class="cityleg-pt">${esc(from || '')}</span>
          <span class="cityleg-arrow" aria-hidden="true">&#9992;</span>
          <span class="cityleg-pt">${esc(to || '')}</span>
        </div>
        ${meta ? `<div class="leg-meta">${meta}</div>`
               : '<div class="leg-pending">Flight details pending</div>'}
      </div>`;
  };
  const details = [
    renderDetailRow('Airline', esc(item.airline)),
    renderDetailRow('Cabin class', esc(item.cabinClass)),
  ].join('');
  return itemShell({
    typeLabel: 'Flights', title: item.airline || 'Flights',
    sub: (item.origin && item.destination) ? `${item.origin} to ${item.destination}` : '',
    price: item.price, cur, travellers: item.travellers,
    body: `
      <div class="cityflights">
        ${cityLeg('Outbound', item.origin, item.destination, item.airline,
          item.outboundFlightNumber, item.departureDate)}
        ${cityLeg('Return', item.destination, item.origin, item.airline,
          item.returnFlightNumber, item.returnDate)}
      </div>
      ${(item.airline || item.cabinClass) ? `<dl class="details">${details}</dl>` : ''}`,
  });
}

/** Fees — a custom charge line. Carries a nested items[] of
 *  {description, amount, quantity} plus a roll-up price. Rendered as a compact
 *  charge breakdown, not a product card (no images/dates/stars). */
function renderFeesCard(item, cur) {
  const lines = Array.isArray(item.items) ? item.items : [];
  const rows = lines.map(f => {
    const qty = Number(f.quantity) || 1;
    const amt = Number(f.amount) || 0;
    const label = qty > 1 ? `${esc(f.description)} x${qty}` : esc(f.description);
    return `<div class="fee-row"><span class="fee-desc">${label}</span><span class="fee-amt">${money(amt * qty, cur)}</span></div>`;
  }).join('');
  const body = rows
    ? `<div class="fees">${rows}</div>`
    : `<div class="fees"><div class="fee-row"><span class="fee-desc">Additional charge</span><span class="fee-amt">${money(item.price, cur)}</span></div></div>`;
  return itemShell({
    typeLabel: 'Fees', title: lines.length === 1 ? (lines[0].description || 'Fees') : 'Additional fees',
    price: item.price, cur, travellers: item.travellers,
    body,
  });
}

/** Day divider — a structural heading splitting the quote into days/sections.
 *  Not a product and not priced, so it renders as a band rather than a card. */
function renderDayDivider(item) {
  const day = item.dayNumber !== undefined && item.dayNumber !== ''
    ? `Day ${esc(item.dayNumber)}` : '';
  const desc = item.descriptionHtml || item.description;
  return `
  <div class="day-divider">
    <div class="day-divider-head">
      ${day ? `<span class="day-divider-day">${day}</span>` : ''}
      ${item.title ? `<span class="day-divider-title">${esc(item.title)}</span>` : ''}
    </div>
    ${desc ? `<div class="day-divider-desc">${sanitiseDescription(desc)}</div>` : ''}
  </div>`;
}

/**
 * Highlights — a non-priced panel of bullet points, each { icon, text }.
 * Informational only; no price, excluded from the item count.
 */
function renderHighlightsCard(item) {
  const rows = Array.isArray(item.items) ? item.items : [];
  if (!rows.length) return '';
  const lis = rows.map(r => {
    const icon = (r && r.icon) ? `<span class="hl-icon">${esc(r.icon)}</span>` : '';
    const text = (r && r.text) ? esc(r.text) : '';
    if (!text) return '';
    return `<li class="hl-item">${icon}<span class="hl-text">${text}</span></li>`;
  }).filter(Boolean).join('');
  if (!lis) return '';
  return `
  <section class="info-card">
    <div class="info-card-head"><div class="item-type">Trip highlights</div></div>
    <ul class="hl-list">${lis}</ul>
  </section>`;
}

/**
 * Location — a non-priced destination spotlight: image, overview, why-go
 * (selling angle), visa notes, local currency, and weather if present.
 * Informational only; no price, excluded from the item count.
 */
function renderLocationCard(item) {
  const MONTHS = ['', 'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];
  const name = item.locationName || 'Destination';
  const overview = item.overviewHtml || item.overview;
  const angle = item.sellingAngleHtml || item.sellingAngle;
  const visa = item.visaNotesHtml || item.visaNotes;
  const imgSrc = item.imagePreview || item.imageUrl || '';
  const month = Number(item.monthOfTravel);
  const metaParts = [];
  if (item.localCurrency) metaParts.push(`Local currency: <strong>${esc(item.localCurrency)}</strong>`);
  if (month >= 1 && month <= 12) metaParts.push(`Travelling in <strong>${MONTHS[month]}</strong>`);

  const weather = Array.isArray(item.weatherAverages) ? item.weatherAverages.filter(Boolean) : [];
  const weatherHtml = weather.length
    ? `<div class="loc-weather">${weather.map(w => {
        const m = Number(w && w.month);
        const label = (m >= 1 && m <= 12) ? MONTHS[m].slice(0, 3) : esc(w && w.label || '');
        const temp = (w && (w.high != null || w.temp != null)) ? esc(String(w.high != null ? w.high : w.temp)) + '&deg;' : '';
        return `<div class="loc-weather-cell"><div class="lw-month">${label}</div><div class="lw-temp">${temp}</div></div>`;
      }).join('')}</div>`
    : '';

  return `
  <section class="info-card">
    <div class="info-card-intro">
      <div class="info-card-head"><div class="item-type">Destination</div>
        <h2 class="item-title">${esc(name)}</h2>
      </div>
      ${imgSrc ? `<div class="loc-image"><img src="${esc(imgSrc)}" alt="${esc(name)}" /></div>` : ''}
      ${metaParts.length ? `<div class="loc-meta">${metaParts.join(' &middot; ')}</div>` : ''}
    </div>
    ${overview ? `<div class="loc-block">${sanitiseDescription(overview)}</div>` : ''}
    ${angle ? `<div class="loc-block"><div class="loc-block-label">Why go</div>${sanitiseDescription(angle)}</div>` : ''}
    ${visa ? `<div class="loc-block"><div class="loc-block-label">Visa &amp; entry</div>${sanitiseDescription(visa)}</div>` : ''}
    ${weatherHtml}
  </section>`;
}

/** Extra — a manually added add-on (festival, experience, upgrade). Carries a
 *  title, extraType, optional flag, date range, description and optional image. */
function renderExtraCard(item, cur) {
  const start = item.startTime
    ? `${niceDate(item.startDate)}, ${esc(item.startTime)}` : niceDate(item.startDate);
  const end = item.endTime
    ? `${niceDate(item.endDate)}, ${esc(item.endTime)}` : niceDate(item.endDate);

  const details = [
    renderDetailRow('Type', esc(item.extraType)),
    renderDetailRow('From', start),
    renderDetailRow('To', end),
    item.optional !== undefined && item.optional !== ''
      ? renderDetailRow('Optional', boolPill(item.optional)) : '',
  ].join('');

  const desc = item.descriptionHtml || item.description;
  return itemShell({
    typeLabel: 'Extra', title: item.title || 'Extra', sub: item.extraType,
    price: item.price, cur, travellers: item.travellers,
    body: `
      <dl class="details">${details}</dl>
      ${renderImages(item.images)}
      ${desc ? `<div class="description">${sanitiseDescription(desc)}</div>` : ''}`,
  });
}

/** Tour — includes a day-by-day itinerary. Itinerary steps carry
 *  {day, title, location, description}; title/location are often blank, so the
 *  day line falls back title -> location -> nothing, with the description below. */
function renderTourCard(item, cur) {
  const details = [
    renderDetailRow('Operator', esc(item.operator)),
    renderDetailRow('Tour code', esc(item.tourCode)),
    renderDetailRow('Starts', esc(item.startLocation)),
    renderDetailRow('Ends', esc(item.endLocation)),
    renderDetailRow('Duration', item.durationDays
      ? `${esc(item.durationDays)} day${String(item.durationDays) === '1' ? '' : 's'}` : ''),
    renderDetailRow('Departs', niceDate(item.startDate)),
    renderDetailRow('Returns', niceDate(item.endDate)),
  ].join('');

  let itinerary = '';
  if (Array.isArray(item.itinerary) && item.itinerary.length) {
    const rows = item.itinerary.map(d => {
      const heading = d.title || d.location || '';
      return `
      <div class="itin-row">
        <div class="itin-day">Day ${esc(d.day)}</div>
        <div class="itin-port">${esc(heading)}${
          d.description ? `<span class="itin-desc">${esc(d.description)}</span>` : ''}</div>
      </div>`;
    }).join('');
    itinerary = `<div class="itinerary"><div class="itin-head">Itinerary</div>${rows}</div>`;
  }

  const summary = item.summary
    ? `<div class="description">${sanitiseDescription(item.summary)}</div>` : '';

  return itemShell({
    typeLabel: 'Tour', title: item.tourName || 'Tour', sub: item.startLocation,
    price: item.price, cur, travellers: item.travellers,
    body: `<dl class="details">${details}</dl>${itinerary}${summary}`,
  });
}

/** Cruise — includes a day-by-day itinerary. */
function renderCruiseCard(item, cur) {
  const details = [
    renderDetailRow('Cruise line', esc(item.cruiseLine)),
    renderDetailRow('Ship', esc(item.shipName)),
    renderDetailRow('Departure port', esc(item.departurePort)),
    renderDetailRow('Cabin', esc(item.cabinType)),
    renderDetailRow('Nights', esc(item.nights)),
    renderDetailRow('Departs', niceDate(item.startDate)),
    renderDetailRow('Returns', niceDate(item.endDate)),
  ].join('');

  let itinerary = '';
  if (Array.isArray(item.itinerary) && item.itinerary.length) {
    const rows = item.itinerary.map(d => `
      <div class="itin-row">
        <div class="itin-day">Day ${esc(d.day)}</div>
        <div class="itin-port">${esc(d.port || '')}${
          d.description ? `<span class="itin-desc">${esc(d.description)}</span>` : ''}</div>
      </div>`).join('');
    itinerary = `<div class="itinerary"><div class="itin-head">Itinerary</div>${rows}</div>`;
  }

  const summary = item.summary
    ? `<div class="description">${sanitiseDescription(item.summary)}</div>` : '';

  return itemShell({
    typeLabel: 'Cruise', title: item.cruiseName || 'Cruise', sub: item.cruiseLine,
    price: item.price, cur, travellers: item.travellers,
    body: `<dl class="details">${details}</dl>${itinerary}${summary}`,
  });
}

/**
 * Dispatch an item to the right card by its `type` (new quoteDocument shape) or
 * `productType` (legacy shape). Unknown types fall back to a minimal card rather
 * than forcing accommodation fields onto them.
 */
function renderItem(item, index, currency) {
  const cur = item.currency || currency;
  const type = String(item.type || '').toLowerCase();

  switch (type) {
    case 'hotels':
    case 'hotel':
    case 'accommodation':
      return renderAccommodationCard(item, cur);
    case 'carhire':
      return renderCarHireCard(item, cur);
    case 'activities':
    case 'activity':
      return renderActivityCard(item, cur);
    case 'transfers':
    case 'transfer':
      return renderTransferCard(item, cur);
    case 'flights':
    case 'flight':
      return renderFlightCard(item, cur);
    case 'cruises':
    case 'cruise':
      return renderCruiseCard(item, cur);
    case 'tours':
    case 'tour':
      return renderTourCard(item, cur);
    case 'extra':
    case 'extras':
      return renderExtraCard(item, cur);
    case 'fees':
    case 'fee':
      return renderFeesCard(item, cur);
    case 'daydivider':
      return renderDayDivider(item);
    case 'highlights':
      return renderHighlightsCard(item);
    case 'locations':
    case 'location':
      return renderLocationCard(item);
    default:
      break;
  }

  // No flat `type` — legacy shape from normaliseItem (productType + accommodation
  // fields), or has clear car-hire fields. Route accordingly.
  if (item.carType || item.pickupLocation) return renderCarHireCard(item, cur);
  if (item.cruiseName) return renderCruiseCard(item, cur);
  if (item.tourName) return renderTourCard(item, cur);
  if (item.extraType || item.productType === 'Extra') return renderExtraCard(item, cur);
  if (item.productType === 'DayDivider' || item.dayNumber !== undefined) return renderDayDivider(item);
  if (item.activityName) return renderActivityCard(item, cur);
  if (item.vehicleType && item.origin) return renderTransferCard(item, cur);
  // Default: accommodation/package (legacy productType shape).
  return renderAccommodationCard(item, cur);
}

// ----------------------------------------------------------------------------
// Document shell
// ----------------------------------------------------------------------------

/**
 * Resolve the client's branding from editor config (opts.brand), falling back
 * to the Travelgenix defaults so an unconfigured quote still renders cleanly.
 * Colours map onto the CSS custom properties the template already uses, so the
 * whole document re-themes from four values.
 */
// A logo is usable if it's an https URL or an inline image data URI (the latter
// is what the editor's file upload produces). Data URIs are capped so a huge
// upload can't bloat every quote; oversized ones are dropped (no logo shown).
function isUsableLogo(v) {
  if (/^https:\/\//.test(v)) return true;
  if (/^data:image\/(png|jpeg|jpg|gif|webp|svg\+xml);base64,/i.test(v)) {
    return v.length <= 700000; // ~512KB decoded — plenty for a logo
  }
  return false;
}

function resolveBrand(opts) {
  const b = (opts && opts.brand) || {};
  const c = b.colors || {};
  const hex = (v, fallback) =>
    (typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v.trim())) ? v.trim() : fallback;
  // Back-compat: older saved configs used {primary, primaryDark, accent,
  // accentDark}. Map those onto the new 6-colour model when the new keys are
  // absent, so existing widgets keep rendering correctly.
  const topBar = hex(c.topBar, hex(c.primaryDark, '#111D3E'));
  const hero   = hex(c.hero,   hex(c.primary,     '#1B2B5B'));
  const accent = hex(c.accent, '#00B4D8');
  const labels = hex(c.labels, hex(c.accentDark,  '#0096B7'));
  const titles = hex(c.titles, hex(c.primary,     '#1B2B5B'));
  const text   = hex(c.text,   '#0F172A');
  const btn = (b.button && typeof b.button === 'object') ? b.button : {};
  return {
    name: (b.name && String(b.name).trim()) || 'Your Travel Co',
    tagline: (b.tagline && String(b.tagline).trim()) || '',
    logoUrl: (typeof b.logoUrl === 'string' && isUsableLogo(b.logoUrl.trim()))
      ? b.logoUrl.trim() : '',
    supportEmail: (b.supportEmail && String(b.supportEmail).trim()) || '',
    supportPhone: (b.supportPhone && String(b.supportPhone).trim()) || '',
    colors: { topBar, hero, accent, labels, titles, text },
    // Embed Download/Email button colours (used by widget-quote-pdf.js, not the
    // PDF itself). Kept here so a single config drives both.
    button: {
      bg:   hex(btn.bg,   accent),
      text: hex(btn.text, '#FFFFFF'),
    },
  };
}

function renderQuoteHTML(input, opts) {
  const q = normaliseQuote(input);
  const brand = resolveBrand(opts);
  const currency = q.currency || 'GBP';
  const items = Array.isArray(q.items) ? q.items : [];

  // Traveller count: prefer an explicit pax, else the max travellers on any item.
  const pax = Number(q.travellers) ||
    items.reduce((m, i) => Math.max(m, Number(i.travellers) || 0), 0) || 0;
  const guests = pax > 0 ? `${pax} traveller${pax === 1 ? '' : 's'}` : '';

  const total = Number(q.total) || items.reduce((s, i) => s + (Number(i.price) || 0), 0);
  const perPerson = pax > 0 ? total / pax : null;

  const itemsHTML = items.map((it, i) => renderItem(it, i, currency)).join('');

  // Day dividers are structural, not products — exclude them from the count.
  // Non-priced, informational blocks — excluded from the "N items" count and
  // never contribute to the total. Covers day dividers, trip highlights, and
  // destination spotlights.
  const NON_PRODUCT_TYPES = ['daydivider', 'highlights', 'locations', 'location'];
  const isDivider = (it) => NON_PRODUCT_TYPES.includes(String(it.type || '').toLowerCase())
    || it.productType === 'DayDivider';
  const productCount = items.filter(it => !isDivider(it)).length;
  const today = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' });
  const agent = q.agent || {};

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<title>${esc(q.title || 'Your holiday quote')}</title>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Noto+Color+Emoji&display=swap" rel="stylesheet" />
<style>
  :root{
    --topbar:${brand.colors.topBar}; --hero:${brand.colors.hero}; --accent:${brand.colors.accent}; --labels:${brand.colors.labels}; --titles:${brand.colors.titles}; --text:${brand.colors.text};
    /* Legacy aliases kept so existing rules resolve to the right new colour. */
    --navy:${brand.colors.titles}; --navy-dark:${brand.colors.topBar}; --teal:${brand.colors.accent}; --teal-dark:${brand.colors.labels};
    --ink:${brand.colors.text}; --slate:#475569; --mute:#94A3B8;
    --bg:#FFFFFF; --bg2:#F8FAFC; --bg3:#F1F5F9; --line:#E2E8F0;
    --ok:#10B981; --no:#94A3B8;
  }
  *{box-sizing:border-box;}
  html,body{margin:0;padding:0;}
  /* Continuation pages get top + bottom breathing room so cards never touch the
     paper edge. Page 1 keeps a full-bleed header, so its top margin is removed
     via @page :first. Left/right stay 0 — horizontal insets come from .body. */
  @page{margin:14mm 0;}
  @page :first{margin-top:0;}
  body{
    font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;
    color:var(--ink); font-size:13px; line-height:1.6; background:var(--bg);
    -webkit-print-color-adjust:exact; print-color-adjust:exact;
  }
  .page{max-width:820px;margin:0 auto;}

  /* Header */
  .brand{
    display:flex;align-items:center;justify-content:space-between;
    padding:22px 32px;border-bottom:3px solid var(--teal);
    background:var(--navy-dark);
  }
  .brand-id{display:flex;flex-direction:column;gap:2px;}
  .brand-name{font-size:18px;font-weight:700;color:#fff;letter-spacing:-0.01em;}
  .brand-logo{max-height:44px;max-width:220px;width:auto;height:auto;display:block;}
  .brand-tag{font-size:12px;color:#C7D2E8;}
  .brand-meta{text-align:right;font-size:12px;color:#C7D2E8;line-height:1.5;}
  .brand-meta strong{color:#fff;}

  /* Hero */
  .hero{
    background:linear-gradient(135deg,var(--hero) 0%,var(--topbar) 100%);
    color:#fff;padding:34px 32px;
  }
  .hero h1{margin:0 0 6px;font-size:26px;font-weight:700;letter-spacing:-0.02em;}
  .hero p{margin:0;font-size:14px;color:#C7D2E8;}
  .hero-ref{margin-top:14px;font-size:11px;color:#9DB0D4;letter-spacing:0.04em;text-transform:uppercase;}

  /* Summary chips */
  .chips{display:flex;gap:12px;padding:20px 32px;background:var(--bg2);border-bottom:1px solid var(--line);}
  .chip{flex:1;background:#fff;border:1px solid var(--line);border-radius:10px;padding:12px 14px;}
  .chip-label{font-size:10px;text-transform:uppercase;letter-spacing:0.05em;color:var(--mute);font-weight:600;}
  .chip-value{font-size:14px;font-weight:600;color:var(--ink);margin-top:2px;}

  /* Body */
  .body{padding:28px 32px;}

  /* Item — allow tall cards (e.g. a hotel with gallery + long facilities) to
     break across a page boundary rather than being shoved whole onto the next
     page, which leaves the previous page mostly blank. Inner blocks (header,
     details, gallery, flights, itinerary) keep their own break-inside:avoid so
     they stay intact; only the overall card is allowed to flow. */
  .item{border:1px solid var(--line);border-radius:14px;margin-bottom:24px;break-inside:auto;}
  /* Keep the header glued to whatever follows so a title never orphans at a
     page foot even when a very tall card is forced to break internally. */
  .item-head{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;padding:20px 22px;border-bottom:1px solid var(--line);break-inside:avoid;break-after:avoid;}
  .item-type{font-size:10px;text-transform:uppercase;letter-spacing:0.06em;color:var(--teal-dark);font-weight:700;}
  .item-title{margin:4px 0 6px;font-size:19px;font-weight:700;color:var(--navy);letter-spacing:-0.01em;}
  .item-sub{display:flex;align-items:center;gap:10px;font-size:12px;color:var(--slate);}
  .star{font-size:13px;}
  .star.on{color:#F59E0B;} .star.off{color:#E2E8F0;}
  .item-price{text-align:right;white-space:nowrap;}
  .item-price-amount{font-size:22px;font-weight:700;color:var(--navy);font-variant-numeric:tabular-nums;}
  .item-price-label{font-size:11px;color:var(--mute);}

  /* Flights */
  .flights{display:flex;gap:14px;padding:18px 22px;background:var(--bg2);break-inside:avoid;}
  .flight-leg{flex:1;background:#fff;border:1px solid var(--line);border-radius:10px;padding:12px 14px;}
  .leg-tag{font-size:10px;text-transform:uppercase;letter-spacing:0.05em;color:var(--mute);font-weight:700;margin-bottom:8px;}
  .leg-route{display:flex;align-items:center;gap:10px;}
  .iata{font-size:14px;font-weight:600;color:var(--ink);}
  .leg-arrow{color:var(--teal);font-size:14px;}
  .leg-meta{margin-top:8px;font-size:11px;color:var(--slate);}
  .leg-pending{margin-top:3px;font-size:10px;color:var(--mute);font-style:italic;}

  /* Standalone flight (long city names, not IATA) */
  .cityflights{display:flex;flex-direction:column;gap:10px;padding:18px 22px;background:var(--bg2);break-inside:avoid;}
  .cityleg{background:#fff;border:1px solid var(--line);border-radius:10px;padding:12px 14px;}
  .cityleg-route{display:flex;align-items:center;gap:10px;flex-wrap:wrap;}
  .cityleg-pt{font-size:13px;font-weight:600;color:var(--ink);}
  .cityleg-arrow{color:var(--teal);font-size:14px;}

  /* Cruise itinerary */
  .itinerary{padding:8px 22px 14px;break-inside:avoid;}
  .itin-head{font-size:10px;text-transform:uppercase;letter-spacing:0.06em;color:var(--teal-dark);font-weight:700;margin:6px 0 8px;}
  .itin-row{display:flex;gap:14px;padding:7px 0;border-bottom:1px solid var(--bg3);}
  .itin-day{flex:0 0 64px;font-size:12px;font-weight:700;color:var(--teal-dark);}
  .itin-port{font-size:12px;color:var(--ink);font-weight:600;}
  .itin-desc{display:block;font-weight:400;color:var(--slate);margin-top:2px;}
  /* Fees */
  .fees{padding:4px 22px 16px;}
  .fee-row{display:flex;justify-content:space-between;align-items:baseline;gap:16px;padding:7px 0;border-bottom:1px solid var(--bg3);font-size:12.5px;}
  .fee-row:last-child{border-bottom:none;}
  .fee-desc{color:var(--ink);}
  .fee-amt{font-weight:700;color:var(--ink);font-variant-numeric:tabular-nums;white-space:nowrap;}
  /* Day divider */
  .day-divider{margin:18px 0 4px;padding:10px 22px;background:var(--bg2);border-left:3px solid var(--teal);break-inside:avoid;}
  .day-divider-head{display:flex;align-items:baseline;gap:12px;}
  .day-divider-day{font-size:10px;text-transform:uppercase;letter-spacing:0.06em;color:var(--teal-dark);font-weight:700;}
  .day-divider-title{font-size:14px;font-weight:700;color:var(--navy);}
  .day-divider-desc{font-size:12px;color:var(--slate);margin-top:4px;}

  /* Info cards (non-priced): highlights + destination spotlight */
  .info-card{border:1px solid var(--line);border-radius:14px;margin-bottom:24px;padding:18px 22px;break-inside:auto;}
  .info-card-head{margin-bottom:10px;break-inside:avoid;break-after:avoid;}
  .info-card-intro{break-inside:avoid;}
  .info-card .item-title{margin:2px 0 0;font-size:18px;font-weight:700;color:var(--titles);letter-spacing:-0.01em;}
  .hl-list{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:8px 22px;}
  .hl-item{display:flex;align-items:flex-start;gap:10px;font-size:13px;color:var(--ink);break-inside:avoid;}
  .hl-icon{flex-shrink:0;font-size:15px;line-height:1.3;font-family:'Noto Color Emoji','Apple Color Emoji','Segoe UI Emoji',sans-serif;}
  .hl-text{line-height:1.4;}
  .loc-image{margin:4px 0 12px;border-radius:8px;overflow:hidden;background:var(--bg3);break-inside:avoid;break-before:avoid;}
  .loc-image img{width:100%;height:220px;object-fit:cover;display:block;}
  .loc-meta{font-size:12px;color:var(--slate);margin-bottom:10px;}
  .loc-meta strong{color:var(--ink);}
  .loc-block{font-size:13px;color:var(--ink);line-height:1.55;margin-top:10px;break-inside:avoid;}
  .loc-block-label{font-size:10px;text-transform:uppercase;letter-spacing:0.06em;color:var(--labels);font-weight:700;margin-bottom:3px;}
  .loc-weather{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px;}
  .loc-weather-cell{flex:1;min-width:48px;text-align:center;padding:6px 4px;background:var(--bg2);border-radius:8px;}
  .lw-month{font-size:10px;text-transform:uppercase;color:var(--slate);font-weight:600;}
  .lw-temp{font-size:14px;font-weight:700;color:var(--titles);}

  /* Details */
  .details{display:grid;grid-template-columns:1fr 1fr;column-gap:32px;row-gap:0;margin:0;padding:8px 22px;break-inside:avoid;}
  .detail{display:flex;justify-content:space-between;gap:16px;padding:8px 0;border-bottom:1px solid var(--bg3);}
  .detail dt{color:var(--slate);font-size:12px;}
  .detail dd{margin:0;font-weight:600;font-size:12px;color:var(--ink);text-align:right;}
  .pill{display:inline-block;padding:1px 8px;border-radius:999px;font-size:11px;font-weight:600;}
  .pill-yes{background:#ECFDF5;color:var(--ok);}
  .pill-no{background:var(--bg3);color:var(--no);}

  /* Gallery */
  .gallery{display:grid;grid-template-columns:repeat(2,1fr);gap:8px;padding:14px 22px;break-inside:avoid;}
  .gallery-cell{height:180px;border-radius:8px;overflow:hidden;background:var(--bg3);}
  .gallery-cell img{width:100%;height:180px;object-fit:cover;display:block;}

  /* Description */
  .description{padding:6px 22px 22px;color:var(--slate);font-size:12.5px;}
  .description h3{font-size:13px;color:var(--navy);margin:16px 0 6px;font-weight:700;}
  .description p{margin:0 0 8px;}
  .description hr{border:none;border-top:1px solid var(--line);margin:14px 0;}

  /* Total */
  .total{display:flex;justify-content:space-between;align-items:center;background:var(--navy);color:#fff;border-radius:14px;padding:20px 24px;margin-top:4px;}
  .total-label{font-size:13px;color:#C7D2E8;}
  .total-right{text-align:right;}
  .total-amount{font-size:28px;font-weight:700;font-variant-numeric:tabular-nums;letter-spacing:-0.01em;}
  .total-pp{font-size:12px;color:#9DB0D4;margin-top:2px;}

  /* Agent */
  .agent{display:flex;align-items:center;gap:14px;margin-top:24px;padding:18px 22px;border:1px solid var(--line);border-radius:14px;background:var(--bg2);}
  .agent-avatar{width:46px;height:46px;border-radius:999px;background:var(--navy);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:16px;}
  .agent-name{font-weight:700;color:var(--ink);font-size:14px;}
  .agent-role{font-size:12px;color:var(--slate);}
  .agent-contact{margin-left:auto;text-align:right;font-size:12px;color:var(--slate);line-height:1.6;}

  /* Footer */
  .foot{margin-top:8px;padding:22px 32px;border-top:1px solid var(--line);color:var(--mute);font-size:11px;text-align:center;line-height:1.6;}
  .foot strong{color:var(--slate);}
</style>
</head>
<body>
<div class="page">

  <header class="brand">
    <div class="brand-id">
      ${brand.logoUrl
        ? `<img class="brand-logo" src="${esc(brand.logoUrl)}" alt="${esc(brand.name)}" />`
        : `<div class="brand-name">${esc(brand.name)}</div>`}
      ${brand.tagline ? `<div class="brand-tag">${esc(brand.tagline)}</div>` : ''}
    </div>
    ${(() => {
      const phone = brand.supportPhone || q.contactTelNo || '';
      const email = brand.supportEmail || q.contactEmail || '';
      if (!phone && !email) return '';
      return `<div class="brand-meta">
      ${phone ? `<div><strong>${esc(phone)}</strong></div>` : ''}
      ${email ? `<div>${esc(email)}</div>` : ''}
    </div>`;
    })()}
  </header>

  <section class="hero">
    <h1>${esc(q.title || 'Your holiday quote')}</h1>
    <p>A curated itinerary tailored just for you.</p>
    <div class="hero-ref">Quote ${esc(q.quoteId || '')} &middot; Prepared ${esc(today)}${q.leadName ? ' &middot; For ' + esc(q.leadName) : ''}</div>
  </section>

  <section class="chips">
    <div class="chip">
      <div class="chip-label">Destination</div>
      <div class="chip-value">${esc(q.destination || (items.find(it => !isDivider(it)) || {}).location || '—')}</div>
    </div>
    <div class="chip">
      <div class="chip-label">Travellers</div>
      <div class="chip-value">${esc(guests || '—')}</div>
    </div>
    <div class="chip">
      <div class="chip-label">Items</div>
      <div class="chip-value">${productCount} ${productCount === 1 ? 'item' : 'items'}</div>
    </div>
  </section>

  <main class="body">
    ${itemsHTML}

    <div class="total">
      <div class="total-label">Total price${productCount > 1 ? ' (' + productCount + ' items)' : ''}</div>
      <div class="total-right">
        <div class="total-amount">${money(total, currency)}</div>
        ${perPerson ? `<div class="total-pp">Per person ${money(perPerson, currency)}</div>` : ''}
      </div>
    </div>

    ${agent.name ? `
    <div class="agent">
      <div class="agent-avatar">${esc((agent.name || 'A').trim().charAt(0))}</div>
      <div>
        <div class="agent-name">${esc(agent.name)}</div>
        <div class="agent-role">${esc(agent.role || 'Travel Consultant')}</div>
      </div>
      <div class="agent-contact">
        ${agent.email ? `<div>${esc(agent.email)}</div>` : ''}
        ${agent.phone ? `<div>${esc(agent.phone)}</div>` : ''}
      </div>
    </div>` : ''}
  </main>

  <footer class="foot">
    <div><strong>${esc(brand.name)}</strong>${[esc(brand.supportPhone || q.contactTelNo || ''), esc(brand.supportEmail || q.contactEmail || '')].filter(Boolean).map(x => ' &middot; ' + x).join('')}</div>
    <div>Prices are subject to availability at the time of booking. This quote is for information only and does not constitute a confirmed booking.</div>
  </footer>

</div>
</body>
</html>`;
}

export { renderQuoteHTML, sanitiseDescription, esc, money };
