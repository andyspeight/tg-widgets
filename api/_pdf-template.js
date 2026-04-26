/**
 * Travelgenix Widget Suite — PDF HTML template
 *
 * Renders the trimmed `order` object (see retrieve-order.js trimOrder())
 * into a print-ready A4 HTML document. Two pages when there's enough
 * hotel detail to justify it, single page otherwise.
 *
 * Used by booking-pdf.js — Puppeteer turns the returned HTML into a PDF.
 *
 * Design language is locked to the approved A4 mockup:
 *   - Inter (body) + Fraunces (display) via Google Fonts
 *   - Travelgenix navy #1B2B5B header band + hero gradient
 *   - Soft slate body, accent cyan for callouts, success green / warning amber
 *   - 794 × 1123 px page size (A4 at 96dpi)
 *
 * Public API:
 *   renderPdfHtml(order, opts) → string (full HTML document)
 */

// ----- Helpers -----

const escapeHtml = (s) => {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
};

const formatMoney = (amount, currency) => {
  if (amount == null || !Number.isFinite(amount)) return '—';
  const symbol = currencySymbol(currency);
  const formatted = Math.abs(amount).toLocaleString('en-GB', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return amount < 0 ? `– ${symbol}${formatted}` : `${symbol}${formatted}`;
};

const currencySymbol = (code) => {
  switch ((code || '').toUpperCase()) {
    case 'GBP': return '£';
    case 'EUR': return '€';
    case 'USD': return '$';
    case 'AUD': return 'A$';
    case 'CAD': return 'C$';
    default: return code ? `${code} ` : '£';
  }
};

const formatDate = (iso, opts = {}) => {
  if (!iso) return '—';
  const d = new Date(iso.length === 10 ? iso + 'T00:00:00Z' : iso);
  if (Number.isNaN(d.getTime())) return '—';
  const day = opts.includeWeekday
    ? d.toLocaleDateString('en-GB', { weekday: 'long', timeZone: 'UTC' }) + ' '
    : '';
  return day + d.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: opts.shortMonth ? 'short' : 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
};

const formatDateShort = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso.length === 10 ? iso + 'T00:00:00Z' : iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
  });
};

const computeNights = (startDate, duration) => {
  if (Number.isFinite(duration) && duration > 0) return duration;
  return null;
};

const computeCheckout = (startDate, nights) => {
  if (!startDate || !Number.isFinite(nights)) return null;
  const d = new Date(startDate.length === 10 ? startDate + 'T00:00:00Z' : startDate);
  if (Number.isNaN(d.getTime())) return null;
  d.setUTCDate(d.getUTCDate() + nights);
  return d.toISOString().slice(0, 10);
};

const renderStars = (rating) => {
  if (!Number.isFinite(rating)) return '';
  const n = Math.max(0, Math.min(5, Math.round(rating)));
  return '★'.repeat(n);
};

const titleCaseName = (parts) => parts.filter(Boolean).join(' ');

// Pick the best hero image: EXTERIOR > first available
const pickHeroImage = (media) => {
  if (!Array.isArray(media) || media.length === 0) return null;
  const exterior = media.find((m) => /exterior/i.test(m?.type || ''));
  return (exterior?.url) || media[0]?.url || null;
};

// Pick a description for the page-2 hotel block
const pickHotelDescription = (descriptions) => {
  if (!Array.isArray(descriptions) || descriptions.length === 0) return null;
  // Prefer something that looks editorial; fall back to first
  const main =
    descriptions.find((d) => /general|description|introduction|overview/i.test(d?.type || '')) ||
    descriptions.find((d) => (d?.text || '').length > 200) ||
    descriptions[0];
  return main?.text || null;
};

// ----- Main render -----

/**
 * @param {object} order — trimmed order from retrieve-order
 * @param {object} opts — { issuedAt?: ISO string, brandName?: string, supportEmail?: string, supportPhone?: string }
 */
export function renderPdfHtml(order, opts = {}) {
  const issuedAt = opts.issuedAt || new Date().toISOString();
  const brandName = opts.brandName || 'Travelgenix';
  const supportEmail = opts.supportEmail || null;
  const supportPhone = opts.supportPhone || null;

  // First accommodation item is the v1 case
  const accomItem = (order.items || []).find((it) => it?.product === 'Accommodation') || (order.items || [])[0] || null;
  const accom = accomItem?.accommodation || null;

  const orderRef = accomItem?.bookingReference || order.id || '';
  const heroImg = accom ? pickHeroImage(accom.media) : null;
  const stars = accom ? renderStars(accom.rating) : '';
  const propertyName = accom?.name || '—';
  const city = accom?.location?.city || '';
  const country = accom?.location?.country || '';
  const locationLine = [city, country].filter(Boolean).join(', ');

  const startDate = accomItem?.startDate || (accom?.units?.[0]?.checkin) || null;
  const nights = computeNights(startDate, accomItem?.duration ?? accom?.units?.[0]?.nights);
  const checkout = nights ? computeCheckout(startDate, nights) : null;

  const unit = accom?.units?.[0] || null;
  const rate = unit?.rates?.[0] || null;

  const totalCost = accom?.pricing?.price ?? accomItem?.price ?? null;
  const currency = accom?.pricing?.currency || accomItem?.currency || order.currency || 'GBP';

  // Pick a deposit option that has a breakdown (the instalment plan)
  const depositOption =
    (accom?.pricing?.depositOptions || []).find((d) => Array.isArray(d.breakdown) && d.breakdown.length > 0) ||
    (accom?.pricing?.depositOptions || [])[0] ||
    null;

  const depositPaid = depositOption?.amount ?? null;
  const balance = totalCost != null && depositPaid != null ? totalCost - depositPaid : null;
  const balanceDueDate = depositOption?.dueDate || null;
  const instalments = depositOption?.breakdown || [];

  const isRefundable = !!accom?.pricing?.isRefundable;
  const refundability = accom?.pricing?.refundability || null;

  const customerName = titleCaseName([order.customerTitle, order.customerFirstname, order.customerSurname]);
  const customerSurnameOnly = order.customerSurname || '';

  const guests = accom?.guests || [];
  const leadGuest = guests.find((g) => g?.type === 'Lead') || guests[0] || {
    title: order.customerTitle,
    firstname: order.customerFirstname,
    surname: order.customerSurname,
  };
  const leadGuestName = titleCaseName([leadGuest?.title, leadGuest?.firstname, leadGuest?.surname]);

  const specialRequests = order.specialRequests || null;

  const hotelDesc = accom ? pickHotelDescription(accom.descriptions) : null;
  const amenities = (accom?.amenities || []).slice(0, 12);

  // Decide whether to render page 2
  const hasHotelDetail = !!(hotelDesc || amenities.length > 0);

  // Pre-compute small bits used inline
  const refBarBookedDate = formatDateShort(order.created);
  const checkinFmt = startDate ? formatDate(startDate, { includeWeekday: true }) : '—';
  const checkoutFmt = checkout ? formatDate(checkout, { includeWeekday: true }) : '—';
  const propertyTypeLine = [accom?.propertyType, stars ? `${stars}-star` : null].filter(Boolean).join(' · ');
  const addressLine = [
    accom?.location?.address1,
    accom?.location?.city,
    accom?.location?.state,
  ].filter(Boolean).join(', ');

  // ---------- HTML ----------

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Booking ${escapeHtml(orderRef)} — ${escapeHtml(brandName)}</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Fraunces:opsz,wght@9..144,500;9..144,600;9..144,700&display=swap" rel="stylesheet">
<style>
  :root {
    --primary: #1B2B5B;
    --primary-dark: #111D3E;
    --accent: #00B4D8;
    --accent-dark: #0096B7;
    --success: #10B981;
    --warning: #F59E0B;
    --text: #0F172A;
    --text-2: #475569;
    --text-3: #94A3B8;
    --bg: #F8FAFC;
    --bg-2: #F1F5F9;
    --border: #E2E8F0;
    --border-light: #F1F5F9;
    --font: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif;
    --font-display: 'Fraunces', Georgia, serif;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: var(--font);
    color: var(--text);
    -webkit-font-smoothing: antialiased;
    background: #fff;
  }
  .num, .price, time { font-variant-numeric: tabular-nums; }

  .page {
    width: 794px;
    min-height: 1123px;
    background: #fff;
    position: relative;
    overflow: hidden;
    page-break-after: always;
  }
  .page:last-child { page-break-after: auto; }

  /* HEADER BAND */
  .pdf-header {
    background: linear-gradient(135deg, var(--primary) 0%, var(--primary-dark) 100%);
    color: #fff;
    padding: 24px 48px;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .pdf-header-brand {
    font-family: var(--font-display);
    font-size: 20px;
    font-weight: 600;
    letter-spacing: -.01em;
  }
  .pdf-header-meta {
    text-align: right;
    font-size: 10px;
    font-weight: 500;
    letter-spacing: .08em;
    text-transform: uppercase;
    color: rgba(255,255,255,.72);
    line-height: 1.7;
  }

  /* HERO */
  .pdf-hero {
    position: relative;
    height: 240px;
    ${heroImg
      ? `background-image: url('${escapeHtml(heroImg)}'); background-size: cover; background-position: center;`
      : `background: linear-gradient(135deg, #1B2B5B 0%, #00B4D8 100%);`
    }
  }
  .pdf-hero-overlay {
    position: absolute; inset: 0;
    background: linear-gradient(180deg, rgba(15,23,42,.05) 0%, rgba(15,23,42,.78) 100%);
  }
  .pdf-hero-content {
    position: absolute; bottom: 0; left: 0; right: 0;
    padding: 28px 48px;
    color: #fff;
  }
  .pdf-confirmed {
    display: inline-block;
    padding: 5px 12px;
    background: var(--success);
    border-radius: 999px;
    font-size: 10px;
    font-weight: 700;
    letter-spacing: .08em;
    text-transform: uppercase;
    margin-bottom: 12px;
  }
  .pdf-hero-eyebrow {
    font-size: 10px;
    font-weight: 500;
    letter-spacing: .08em;
    text-transform: uppercase;
    opacity: .85;
    margin-bottom: 4px;
  }
  .pdf-hero-name {
    font-family: var(--font-display);
    font-size: 34px;
    font-weight: 600;
    letter-spacing: -.02em;
    line-height: 1.05;
    margin: 0 0 8px;
  }
  .pdf-hero-stars {
    color: #FFD166;
    font-size: 13px;
    letter-spacing: 2px;
  }

  /* BODY */
  .pdf-body { padding: 36px 48px; }

  .pdf-greeting {
    font-size: 14px;
    color: var(--text);
    line-height: 1.65;
    margin: 0 0 28px;
    max-width: 60ch;
  }
  .pdf-greeting strong { font-weight: 600; }

  /* SECTION */
  .pdf-section { margin-bottom: 24px; }
  .pdf-section-title {
    font-size: 11px;
    font-weight: 600;
    letter-spacing: .14em;
    text-transform: uppercase;
    color: var(--text-3);
    margin: 0 0 12px;
    padding-bottom: 8px;
    border-bottom: 1px solid var(--border);
  }

  /* REF BAR */
  .pdf-ref-bar {
    display: grid;
    grid-template-columns: 1fr 1fr 1fr;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 12px;
    overflow: hidden;
    margin-bottom: 24px;
  }
  .pdf-ref-cell { padding: 16px 20px; border-right: 1px solid var(--border); }
  .pdf-ref-cell:last-child { border-right: none; }
  .pdf-ref-label {
    font-size: 9px; font-weight: 600; letter-spacing: .12em;
    text-transform: uppercase; color: var(--text-3); margin-bottom: 4px;
  }
  .pdf-ref-value {
    font-size: 16px; font-weight: 700; color: var(--text); letter-spacing: .02em;
  }
  .pdf-ref-value.money { font-size: 18px; letter-spacing: -.01em; }

  /* KV */
  .pdf-kv {
    display: grid;
    grid-template-columns: 180px 1fr;
    gap: 0 20px;
    font-size: 13px;
    margin: 0;
  }
  .pdf-kv dt {
    color: var(--text-2);
    padding: 10px 0;
    border-bottom: 1px solid var(--border-light);
  }
  .pdf-kv dd {
    margin: 0;
    padding: 10px 0;
    border-bottom: 1px solid var(--border-light);
    color: var(--text);
    font-weight: 500;
  }
  .pdf-kv dt:last-of-type, .pdf-kv dd:last-of-type { border-bottom: none; }

  /* PAY */
  .pdf-pay {
    display: grid;
    grid-template-columns: 1.2fr 1fr;
    gap: 20px;
  }
  .pdf-pay-box {
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 18px 20px;
  }
  .pdf-pay-row {
    display: flex; justify-content: space-between; align-items: baseline;
    padding: 7px 0; font-size: 13px;
  }
  .pdf-pay-row .label { color: var(--text-2); }
  .pdf-pay-row .value { font-weight: 600; color: var(--text); }
  .pdf-pay-row .value.paid { color: var(--success); }
  .pdf-pay-row .value.due { color: var(--warning); }
  .pdf-pay-row.total {
    border-top: 1px solid var(--border);
    margin-top: 8px; padding-top: 14px; font-size: 14px;
  }
  .pdf-pay-row.total .value { font-size: 20px; font-weight: 700; letter-spacing: -.01em; }

  .pdf-pay-box-title {
    font-size: 9px; font-weight: 600; letter-spacing: .12em;
    text-transform: uppercase; color: var(--text-3); margin: 0 0 10px;
  }
  .pdf-instalment {
    display: flex; justify-content: space-between;
    padding: 8px 0; font-size: 13px;
    border-bottom: 1px dashed var(--border-light);
  }
  .pdf-instalment:last-child { border-bottom: none; }
  .pdf-instalment .date { color: var(--text-2); }
  .pdf-instalment .amt { font-weight: 600; }

  /* BANNER */
  .pdf-banner {
    margin-top: 16px; padding: 14px 18px;
    background: #ECFEFF;
    border: 1px solid #A5F3FC;
    border-left: 3px solid var(--accent);
    border-radius: 8px;
    font-size: 12px; line-height: 1.5;
    color: #075985;
  }
  .pdf-banner strong { color: var(--primary-dark); }

  /* POLICIES */
  .pdf-policies { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  .pdf-policy {
    padding: 18px;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 12px;
  }
  .pdf-policy-label {
    font-size: 10px; font-weight: 600; letter-spacing: .12em;
    text-transform: uppercase; color: var(--text-3); margin-bottom: 6px;
  }
  .pdf-policy-title {
    font-family: var(--font-display);
    font-size: 14px; font-weight: 600;
    color: var(--text); margin-bottom: 6px; letter-spacing: -.01em;
  }
  .pdf-policy-body { font-size: 12px; line-height: 1.55; color: var(--text-2); }
  .pdf-policy-body .good { color: var(--success); font-weight: 600; }
  .pdf-policy-body strong { color: var(--text); }

  /* FOOTER */
  .pdf-footer {
    position: absolute;
    left: 48px; right: 48px; bottom: 24px;
    border-top: 1px solid var(--border);
    padding-top: 12px;
    display: flex; justify-content: space-between;
    font-size: 10px; color: var(--text-3); letter-spacing: .02em;
  }
  .pdf-footer-brand { font-weight: 700; color: var(--text-2); letter-spacing: -.01em; }

  /* PAGE 2 HEADER */
  .pdf-page-header {
    padding: 16px 48px;
    display: flex; justify-content: space-between; align-items: center;
    border-bottom: 1px solid var(--border);
    font-size: 11px; color: var(--text-3); letter-spacing: .02em;
  }
  .pdf-page-header .brand {
    font-family: var(--font-display);
    font-weight: 600; color: var(--primary);
    font-size: 16px; letter-spacing: -.01em;
  }

  /* HOTEL DETAIL */
  .pdf-hotel-h1 {
    font-family: var(--font-display);
    font-size: 24px; font-weight: 600; letter-spacing: -.02em;
    margin: 0 0 6px;
  }
  .pdf-hotel-sub {
    font-size: 12px; color: var(--text-2);
    margin: 0 0 16px; line-height: 1.5;
  }
  .pdf-hotel-desc {
    font-size: 13px; color: var(--text-2); line-height: 1.65;
    margin: 0 0 16px;
    white-space: pre-wrap;
  }

  .pdf-amenities {
    display: grid;
    grid-template-columns: 1fr 1fr 1fr 1fr;
    gap: 8px;
    margin-top: 16px;
  }
  .pdf-amenity {
    padding: 8px 12px;
    background: var(--bg);
    border: 1px solid var(--border-light);
    border-radius: 8px;
    font-size: 11px; color: var(--text-2);
    text-align: center;
    display: flex; align-items: center; justify-content: center; gap: 6px;
  }
  .pdf-amenity::before {
    content: '';
    width: 4px; height: 4px;
    border-radius: 50%;
    background: var(--success);
    flex-shrink: 0;
  }

  .pdf-contact {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
    margin-top: 12px;
  }
  .pdf-contact-card {
    padding: 16px 18px;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 12px;
  }
  .pdf-contact-label {
    font-size: 10px; font-weight: 600; letter-spacing: .12em;
    text-transform: uppercase; color: var(--text-3); margin-bottom: 4px;
  }
  .pdf-contact-value {
    font-size: 13px; font-weight: 600;
    color: var(--text); line-height: 1.5; letter-spacing: -.01em;
  }
  .pdf-contact-value small {
    display: block;
    font-size: 11px; color: var(--text-3);
    font-weight: 400; margin-top: 2px; letter-spacing: 0;
  }

  @media print { body { background: #fff; } }
</style>
</head>
<body>

<!-- ============ PAGE 1 ============ -->
<div class="page">

  <div class="pdf-header">
    <div class="pdf-header-brand">${escapeHtml(brandName)}</div>
    <div class="pdf-header-meta">
      Booking Confirmation<br>
      <span class="num">Issued ${escapeHtml(formatDateShort(issuedAt))}</span>
    </div>
  </div>

  <div class="pdf-hero">
    <div class="pdf-hero-overlay"></div>
    <div class="pdf-hero-content">
      <div class="pdf-confirmed">✓ &nbsp;Confirmed</div>
      ${locationLine ? `<div class="pdf-hero-eyebrow">${escapeHtml(locationLine)}</div>` : ''}
      <div class="pdf-hero-name">${escapeHtml(propertyName)}</div>
      ${stars ? `<div class="pdf-hero-stars">${stars}</div>` : ''}
    </div>
  </div>

  <div class="pdf-body">

    <p class="pdf-greeting">
      Dear <strong>${escapeHtml(customerSurnameOnly ? `Mr ${customerSurnameOnly}` : (customerName || 'Customer'))}</strong>, thank you for booking with us. This document contains everything you need for your upcoming stay. Please keep it safe and bring it with you, or save it to your phone.
    </p>

    <div class="pdf-ref-bar">
      <div class="pdf-ref-cell">
        <div class="pdf-ref-label">Booking reference</div>
        <div class="pdf-ref-value num">${escapeHtml(orderRef)}</div>
      </div>
      <div class="pdf-ref-cell">
        <div class="pdf-ref-label">Booked</div>
        <div class="pdf-ref-value num" style="font-size:14px;">${escapeHtml(refBarBookedDate)}</div>
      </div>
      <div class="pdf-ref-cell">
        <div class="pdf-ref-label">Total</div>
        <div class="pdf-ref-value money num">${escapeHtml(formatMoney(totalCost, currency))}</div>
      </div>
    </div>

    <div class="pdf-section">
      <div class="pdf-section-title">Your Trip</div>
      <dl class="pdf-kv">
        ${locationLine ? `<dt>Destination</dt><dd>${escapeHtml(locationLine)}</dd>` : ''}
        <dt>Accommodation</dt>
        <dd>${escapeHtml(propertyName)}${propertyTypeLine ? ` · ${escapeHtml(propertyTypeLine)}` : ''}</dd>
        ${addressLine ? `<dt>Address</dt><dd>${escapeHtml(addressLine)}</dd>` : ''}
        <dt>Check-in</dt>
        <dd class="num">${escapeHtml(checkinFmt)} &nbsp;·&nbsp; from 15:00</dd>
        <dt>Check-out</dt>
        <dd class="num">${escapeHtml(checkoutFmt)} &nbsp;·&nbsp; by 12:00</dd>
        ${nights ? `<dt>Duration</dt><dd class="num">${nights} night${nights === 1 ? '' : 's'}</dd>` : ''}
        ${unit ? `<dt>Room type</dt><dd>${escapeHtml([unit.roomType || unit.name, rate?.board].filter(Boolean).join(', '))}</dd>` : ''}
        ${leadGuestName ? `<dt>Lead guest</dt><dd>${escapeHtml(leadGuestName)}</dd>` : ''}
        ${specialRequests ? `<dt>Special requests</dt><dd style="font-style:italic; color:var(--text-2);">${escapeHtml(specialRequests)}</dd>` : ''}
      </dl>
    </div>

    ${totalCost != null ? `
    <div class="pdf-section">
      <div class="pdf-section-title">Payment Schedule</div>
      <div class="pdf-pay">
        <div class="pdf-pay-box">
          <div class="pdf-pay-row">
            <span class="label">Room rate</span>
            <span class="value num">${escapeHtml(formatMoney(totalCost, currency))}</span>
          </div>
          ${depositPaid != null ? `
          <div class="pdf-pay-row">
            <span class="label">Deposit paid</span>
            <span class="value paid num">– ${escapeHtml(formatMoney(depositPaid, currency))}</span>
          </div>` : ''}
          ${balance != null && balance > 0 ? `
          <div class="pdf-pay-row">
            <span class="label">Balance due${balanceDueDate ? ` by ${escapeHtml(formatDateShort(balanceDueDate))}` : ''}</span>
            <span class="value due num">${escapeHtml(formatMoney(balance, currency))}</span>
          </div>` : ''}
          <div class="pdf-pay-row total">
            <span class="label">Total holiday cost</span>
            <span class="value num">${escapeHtml(formatMoney(totalCost, currency))}</span>
          </div>
        </div>
        ${instalments.length > 0 ? `
        <div class="pdf-pay-box">
          <div class="pdf-pay-box-title">Instalment Plan</div>
          ${instalments.map((b) => `
            <div class="pdf-instalment">
              <span class="date num">${escapeHtml(formatDateShort(b.dueDate))}</span>
              <span class="amt num">${escapeHtml(formatMoney(b.amount, currency))}</span>
            </div>
          `).join('')}
        </div>` : `
        <div class="pdf-pay-box">
          <div class="pdf-pay-box-title">Payment</div>
          <p style="font-size:12px; color:var(--text-2); line-height:1.55; margin:0;">
            Your booking is fully secured. ${depositPaid != null ? 'Your deposit has been received.' : ''} Any remaining balance is due before travel.
          </p>
        </div>`}
      </div>
      ${accom?.pricing?.inResortFees ? `
      <div class="pdf-banner">
        <strong>Payable at the hotel:</strong> additional in-resort fees of <span class="num">${escapeHtml(formatMoney(accom.pricing.inResortFees, currency))}</span> may apply on arrival.
      </div>` : ''}
    </div>` : ''}

    <div class="pdf-section">
      <div class="pdf-section-title">Policies</div>
      <div class="pdf-policies">
        <div class="pdf-policy">
          <div class="pdf-policy-label">Cancellation</div>
          <div class="pdf-policy-title">${isRefundable ? 'Refundable' : 'Non-refundable'}</div>
          <div class="pdf-policy-body">
            ${isRefundable
              ? `<span class="good">Fully refundable</span> until your refundability deadline. After that, the full room rate will be charged.`
              : `This rate is non-refundable. Please contact us if your plans change.`}
          </div>
        </div>
        <div class="pdf-policy">
          <div class="pdf-policy-label">Check-in / out</div>
          <div class="pdf-policy-title">Standard hours</div>
          <div class="pdf-policy-body">
            Check-in from <strong class="num">15:00</strong>, check-out by <strong class="num">12:00</strong>. Photo ID required on arrival.
          </div>
        </div>
      </div>
    </div>

  </div>

  <div class="pdf-footer">
    <span class="pdf-footer-brand">${escapeHtml(brandName)}</span>
    <span class="num">Booking ${escapeHtml(orderRef)}${hasHotelDetail ? ' · Page 1 of 2' : ''}</span>
    <span>${escapeHtml(supportEmail || '')}</span>
  </div>

</div>

${hasHotelDetail ? `
<!-- ============ PAGE 2 ============ -->
<div class="page">

  <div class="pdf-page-header">
    <span class="brand">${escapeHtml(brandName)}</span>
    <span class="num">Booking ${escapeHtml(orderRef)} · ${escapeHtml(propertyName)}${startDate ? ` · ${escapeHtml(formatDateShort(startDate))}` : ''}</span>
  </div>

  <div class="pdf-body">

    <div class="pdf-section">
      <div class="pdf-section-title">Your Hotel</div>
      <h2 class="pdf-hotel-h1">${escapeHtml(propertyName)}${city ? `, ${escapeHtml(city)}` : ''}</h2>
      <p class="pdf-hotel-sub">${escapeHtml([addressLine, propertyTypeLine].filter(Boolean).join(' · '))}</p>
      ${hotelDesc ? `<p class="pdf-hotel-desc">${escapeHtml(hotelDesc)}</p>` : ''}

      ${amenities.length > 0 ? `
      <div class="pdf-amenities">
        ${amenities.map((a) => `<div class="pdf-amenity">${escapeHtml(a)}</div>`).join('')}
      </div>` : ''}
    </div>

    <div class="pdf-section">
      <div class="pdf-section-title">Guest Details</div>
      <dl class="pdf-kv">
        ${customerName ? `<dt>Name</dt><dd>${escapeHtml(customerName)}</dd>` : ''}
        ${order.customerEmail ? `<dt>Email</dt><dd>${escapeHtml(order.customerEmail)}</dd>` : ''}
      </dl>
    </div>

    ${(supportEmail || supportPhone) ? `
    <div class="pdf-section">
      <div class="pdf-section-title">Need Help?</div>
      <div class="pdf-contact">
        ${supportEmail ? `
        <div class="pdf-contact-card">
          <div class="pdf-contact-label">Email</div>
          <div class="pdf-contact-value">
            ${escapeHtml(supportEmail)}
            <small>We're here to help with anything about your booking</small>
          </div>
        </div>` : ''}
        ${supportPhone ? `
        <div class="pdf-contact-card">
          <div class="pdf-contact-label">Phone</div>
          <div class="pdf-contact-value num">
            ${escapeHtml(supportPhone)}
            <small style="font-variant-numeric: tabular-nums;">Mon–Fri 9am–6pm</small>
          </div>
        </div>` : ''}
      </div>
    </div>` : ''}

    <p style="margin-top:36px; font-size:11px; color:var(--text-3); line-height:1.6;">
      This confirmation is issued under ${escapeHtml(brandName)}'s standard booking terms. Please retain this document for your records.
    </p>

  </div>

  <div class="pdf-footer">
    <span class="pdf-footer-brand">${escapeHtml(brandName)}</span>
    <span class="num">Booking ${escapeHtml(orderRef)} · Page 2 of 2</span>
    <span>${escapeHtml(supportEmail || '')}</span>
  </div>

</div>` : ''}

</body>
</html>`;
}
