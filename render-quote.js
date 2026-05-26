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
  const shots = images.slice(0, 2).map(img =>
    `<div class="gallery-cell"><img src="${esc(img.url)}" alt="${esc(img.name || 'Hotel image')}" /></div>`
  ).join('');
  return `<div class="gallery">${shots}</div>`;
}

function renderDetailRow(label, value) {
  if (value === '' || value === null || value === undefined) return '';
  return `<div class="detail"><dt>${esc(label)}</dt><dd>${value}</dd></div>`;
}

function renderItem(item, index, currency) {
  const cur = item.currency || currency;
  const typeLabel = item.productType === 'DynamicPackage'
    ? 'Flight + Hotel Package'
    : (item.productType === 'Accommodation' ? 'Accommodation' : esc(item.productType || 'Item'));

  // Details list — values are pre-escaped or known-safe.
  const details = [
    renderDetailRow('Accommodation', esc(item.accommodationName)),
    renderDetailRow('Location', esc(item.location)),
    renderDetailRow('Check-in', niceDate(item.checkIn)),
    renderDetailRow('Check-out', niceDate(item.checkOut)),
    renderDetailRow('Nights', esc(item.nights)),
    renderDetailRow('Room type', esc(item.roomType)),
    renderDetailRow('Board basis', esc(item.boardBasis)),
    renderDetailRow('Operator', esc(item.operator)),
    renderDetailRow('ATOL protected', boolPill(item.atolProtected)),
    renderDetailRow('Transfers included', boolPill(item.transfersIncluded)),
  ].join('');

  return `
  <section class="item">
    <div class="item-head">
      <div class="item-head-main">
        <div class="item-type">${typeLabel}</div>
        <h2 class="item-title">${esc(item.accommodationName)}</h2>
        <div class="item-sub">
          <span class="rating">${stars(item.starRating)}</span>
          <span class="loc">${esc(item.location)}</span>
        </div>
      </div>
      <div class="item-price">
        <div class="item-price-amount">${money(item.price, cur)}</div>
        <div class="item-price-label">${Number(item.travellers) > 1 ? money(item.price / Number(item.travellers), cur) + ' pp' : 'total'}</div>
      </div>
    </div>

    ${renderFlights(item)}

    <dl class="details">${details}</dl>

    ${renderImages(item.images)}

    <div class="description">${sanitiseDescription(item.description)}</div>
  </section>`;
}

// ----------------------------------------------------------------------------
// Document shell
// ----------------------------------------------------------------------------

function renderQuoteHTML(input) {
  const q = normaliseQuote(input);
  const currency = q.currency || 'GBP';
  const items = Array.isArray(q.items) ? q.items : [];

  // Traveller count: prefer an explicit pax, else the max travellers on any item.
  const pax = Number(q.travellers) ||
    items.reduce((m, i) => Math.max(m, Number(i.travellers) || 0), 0) || 0;
  const guests = pax > 0 ? `${pax} traveller${pax === 1 ? '' : 's'}` : '';

  const total = Number(q.total) || items.reduce((s, i) => s + (Number(i.price) || 0), 0);
  const perPerson = pax > 0 ? total / pax : null;

  const itemsHTML = items.map((it, i) => renderItem(it, i, currency)).join('');
  const today = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' });
  const agent = q.agent || {};

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<title>${esc(q.title || 'Your holiday quote')}</title>
<style>
  :root{
    --navy:#1B2B5B; --navy-dark:#111D3E; --teal:#00B4D8; --teal-dark:#0096B7;
    --ink:#0F172A; --slate:#475569; --mute:#94A3B8;
    --bg:#FFFFFF; --bg2:#F8FAFC; --bg3:#F1F5F9; --line:#E2E8F0;
    --ok:#10B981; --no:#94A3B8;
  }
  *{box-sizing:border-box;}
  html,body{margin:0;padding:0;}
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
  }
  .brand-id{display:flex;flex-direction:column;gap:2px;}
  .brand-name{font-size:18px;font-weight:700;color:var(--navy);letter-spacing:-0.01em;}
  .brand-tag{font-size:12px;color:var(--slate);}
  .brand-meta{text-align:right;font-size:12px;color:var(--slate);line-height:1.5;}
  .brand-meta strong{color:var(--ink);}

  /* Hero */
  .hero{
    background:linear-gradient(135deg,var(--navy) 0%,var(--navy-dark) 100%);
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

  /* Item */
  .item{border:1px solid var(--line);border-radius:14px;overflow:hidden;margin-bottom:24px;}
  .item-head{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;padding:20px 22px;border-bottom:1px solid var(--line);break-inside:avoid;}
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

  /* Details */
  .details{display:grid;grid-template-columns:1fr 1fr;column-gap:32px;row-gap:0;margin:0;padding:8px 22px;}
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
      <div class="brand-name">Your Travel Co</div>
      <div class="brand-tag">Your personalised holiday quote</div>
    </div>
    <div class="brand-meta">
      <div><strong>${esc(q.contactTelNo || '')}</strong></div>
      <div>${esc(q.contactEmail || '')}</div>
    </div>
  </header>

  <section class="hero">
    <h1>${esc(q.title || 'Your holiday quote')}</h1>
    <p>A curated itinerary tailored just for you.</p>
    <div class="hero-ref">Quote ${esc(q.quoteId || '')} &middot; Prepared ${esc(today)}${q.leadName ? ' &middot; For ' + esc(q.leadName) : ''}</div>
  </section>

  <section class="chips">
    <div class="chip">
      <div class="chip-label">Destination</div>
      <div class="chip-value">${esc(q.destination || (items[0] ? items[0].location : '—'))}</div>
    </div>
    <div class="chip">
      <div class="chip-label">Travellers</div>
      <div class="chip-value">${esc(guests || '—')}</div>
    </div>
    <div class="chip">
      <div class="chip-label">Items</div>
      <div class="chip-value">${items.length} ${items.length === 1 ? 'item' : 'items'}</div>
    </div>
  </section>

  <main class="body">
    ${itemsHTML}

    <div class="total">
      <div class="total-label">Total price${items.length > 1 ? ' (' + items.length + ' items)' : ''}</div>
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
    <div><strong>Your Travel Co</strong> &middot; ${esc(q.contactTelNo || '')} &middot; ${esc(q.contactEmail || '')}</div>
    <div>Prices are subject to availability at the time of booking. This quote is for information only and does not constitute a confirmed booking.</div>
  </footer>

</div>
</body>
</html>`;
}

export { renderQuoteHTML, sanitiseDescription, esc, money };
