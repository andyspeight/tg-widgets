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

// Render an ISO timestamp as HH:MM in airport-local clock. Travelify dresses
// local times as UTC so we read UTC components — same convention used by
// the widget. Mismatching this would shift printed clock times by hours.
const fmtTimeUtc = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return hh + ':' + mm;
};

const fmtDuration = (mins) => {
  if (typeof mins !== 'number' || !Number.isFinite(mins) || mins <= 0) return '';
  const h = Math.floor(mins / 60);
  const m = Math.round(mins % 60);
  if (h && m) return h + 'h ' + m + 'm';
  if (h) return h + 'h';
  return m + 'm';
};

// Render a single Flights item as a print-safe table block. Each leg
// (Outbound / Inbound) becomes a row group: depart info | route arrow |
// arrive info, then a meta strip with cabin + baggage, then segment
// detail rows for multi-stop legs. No collapsibles — print is always-on.
const renderPdfFlightItem = (item) => {
  const f = item?.flights;
  if (!f || !Array.isArray(f.routes) || f.routes.length === 0) return '';

  const carrierNames = new Set();
  for (const r of f.routes) {
    for (const s of (r.segments || [])) {
      if (s.marketingCarrier?.name) carrierNames.add(s.marketingCarrier.name);
    }
  }
  const carrier = Array.from(carrierNames).slice(0, 3).join(', ');

  const renderLeg = (route) => {
    const segs = route.segments || [];
    if (segs.length === 0) return '';
    const first = segs[0];
    const last = segs[segs.length - 1];
    const stops = segs.length - 1;
    const flightMins = segs.reduce((a, s) => a + (typeof s.duration === 'number' ? s.duration : 0), 0);
    const baggage = first.baggage?.allowance || first.baggage?.weight || '';
    const cabin = first.cabinClass || '';
    const fareName = first.fareName || '';

    const segRows = stops > 0 ? segs.map((s, i) => {
      const next = segs[i + 1];
      let stopHtml = '';
      if (next) {
        const arr = Date.parse(s.arrive || '');
        const dep = Date.parse(next.depart || '');
        const gap = (Number.isFinite(arr) && Number.isFinite(dep)) ? Math.round((dep - arr) / 60000) : 0;
        stopHtml = `
          <tr><td colspan="3" style="padding:6px 0 6px 18px; font-size:11px; color:#64748B; font-style:italic; border-left:2px solid #E2E8F0; margin-left:18px;">
            ${gap > 0 ? `${escapeHtml(fmtDuration(gap))} stopover in ${escapeHtml(s.destination?.iataCode || '')}` : `Stopover in ${escapeHtml(s.destination?.iataCode || '')}`}
          </td></tr>`;
      }
      return `
        <tr>
          <td style="padding:6px 0; font-size:12px; color:#0F172A; vertical-align:top; width:60px;">
            <strong class="num">${escapeHtml(fmtTimeUtc(s.depart))}</strong><br>
            <span style="font-size:10px; color:#94A3B8;">${escapeHtml(s.origin?.iataCode || '')}</span>
          </td>
          <td style="padding:6px 12px; font-size:12px; color:#475569; vertical-align:top;">
            <strong>${escapeHtml((s.marketingCarrier?.code || '') + (s.flightNo || ''))}</strong>${s.marketingCarrier?.name ? ` · ${escapeHtml(s.marketingCarrier.name)}` : ''}
            <div style="font-size:10px; color:#94A3B8;">${escapeHtml(fmtDuration(s.duration))}${s.aircraft ? ` · Aircraft ${escapeHtml(s.aircraft)}` : ''}</div>
          </td>
          <td style="padding:6px 0; font-size:12px; color:#0F172A; vertical-align:top; width:60px; text-align:right;">
            <strong class="num">${escapeHtml(fmtTimeUtc(s.arrive))}</strong><br>
            <span style="font-size:10px; color:#94A3B8;">${escapeHtml(s.destination?.iataCode || '')}</span>
          </td>
        </tr>${stopHtml}`;
    }).join('') : '';

    return `
      <div style="padding:14px 0; border-top:1px solid #E2E8F0;">
        <div style="display:inline-block; padding:2px 10px; background:#F1F5F9; border-radius:9999px; font-size:10px; font-weight:600; letter-spacing:.06em; text-transform:uppercase; color:#475569; margin-bottom:10px;">
          ${escapeHtml(route.direction || 'Flight')}
        </div>
        <table style="width:100%; border-collapse:collapse;">
          <tr>
            <td style="vertical-align:top; width:35%;">
              <div style="font-size:18px; font-weight:700; color:#0F172A; line-height:1.1;" class="num">${escapeHtml(fmtTimeUtc(first.depart))}</div>
              <div style="font-size:11px; font-weight:600; color:#475569; margin-top:2px; letter-spacing:.04em;">${escapeHtml(first.origin?.iataCode || '')}${first.origin?.terminal ? ` · T${escapeHtml(first.origin.terminal)}` : ''}</div>
              <div style="font-size:11px; color:#94A3B8; margin-top:2px;">${escapeHtml(first.origin?.name || '')}</div>
            </td>
            <td style="vertical-align:middle; text-align:center; width:30%;">
              <div style="font-size:10px; color:#94A3B8;" class="num">${escapeHtml(fmtDuration(flightMins))}</div>
              <div style="height:1px; background:#CBD5E1; margin:6px 12px; position:relative;">
                <span style="display:inline-block; position:absolute; left:0; top:-3px; width:7px; height:7px; border-radius:50%; background:#00B4D8;"></span>
                <span style="display:inline-block; position:absolute; right:0; top:-3px; width:7px; height:7px; border-radius:50%; background:#00B4D8;"></span>
              </div>
              <div style="font-size:10px; color:#94A3B8;">${stops === 0 ? 'Direct' : (stops + ' stop' + (stops === 1 ? '' : 's'))}</div>
            </td>
            <td style="vertical-align:top; width:35%; text-align:right;">
              <div style="font-size:18px; font-weight:700; color:#0F172A; line-height:1.1;" class="num">${escapeHtml(fmtTimeUtc(last.arrive))}</div>
              <div style="font-size:11px; font-weight:600; color:#475569; margin-top:2px; letter-spacing:.04em;">${escapeHtml(last.destination?.iataCode || '')}${last.destination?.terminal ? ` · T${escapeHtml(last.destination.terminal)}` : ''}</div>
              <div style="font-size:11px; color:#94A3B8; margin-top:2px;">${escapeHtml(last.destination?.name || '')}</div>
            </td>
          </tr>
        </table>
        ${(cabin || baggage) ? `
        <div style="margin-top:10px; padding-top:10px; border-top:1px dashed #E2E8F0; font-size:11px; color:#475569;">
          ${cabin ? `<strong style="color:#0F172A;">${escapeHtml(cabin)}</strong>${fareName ? ` · ${escapeHtml(fareName)}` : ''}` : ''}
          ${cabin && baggage ? ' &nbsp;·&nbsp; ' : ''}
          ${baggage ? `${escapeHtml(baggage)}` : ''}
        </div>` : ''}
        ${segRows ? `
        <table style="width:100%; border-collapse:collapse; margin-top:10px;">
          ${segRows}
        </table>` : ''}
      </div>`;
  };

  const fareInfo = (Array.isArray(f.fareInformation) ? f.fareInformation : []).filter((fi) => {
    if (!fi.title || !fi.text) return false;
    if ((fi.type || '').toLowerCase() === 'farebasis') return false;
    if (/fare\s*basis/i.test(fi.title)) return false;
    return true;
  });

  return `
    <div style="margin-bottom:16px;">
      <div style="display:flex; align-items:baseline; justify-content:space-between; margin-bottom:8px;">
        <div style="font-size:14px; font-weight:600; color:#0F172A;">✈ Flights</div>
        ${carrier ? `<div style="font-size:11px; color:#94A3B8;">${escapeHtml(carrier)}</div>` : ''}
      </div>
      ${f.routes.map(renderLeg).join('')}
      ${fareInfo.length > 0 ? `
        <div style="margin-top:12px; padding:12px 14px; background:#F8FAFC; border-radius:8px;">
          <div style="font-size:10px; font-weight:600; letter-spacing:.06em; text-transform:uppercase; color:#94A3B8; margin-bottom:8px;">Fare conditions</div>
          ${fareInfo.map((fi) => `<div style="font-size:11px; color:#475569; margin-bottom:4px;"><strong style="color:#0F172A;">${escapeHtml(fi.title)}:</strong> ${escapeHtml(fi.text)}</div>`).join('')}
        </div>` : ''}
    </div>`;
};

// Render an AirportExtras item (Lounge / Transfer / Parking) for the PDF.
const renderPdfExtraItem = (item) => {
  const e = item?.airportExtras;
  if (!e) return '';

  const kindLabel = e.type === 'Lounge' ? 'Airport lounge'
    : e.type === 'Transfer' ? 'Airport transfer'
    : e.type === 'Parking' ? 'Airport parking'
    : (e.type || 'Airport extra');

  const airport = e.location?.iataCode || '';
  const terminal = e.location?.terminal ? `T${e.location.terminal}` : '';
  const startTime = fmtTimeUtc(e.startDateTime);
  const endTime = fmtTimeUtc(e.endDateTime);
  const dateLabel = e.startDateTime ? formatDateShort(e.startDateTime) : '';

  const descByType = (type) => (e.descriptions || []).find((d) => d.type === type);
  const fullDesc = descByType('Generic')?.text || '';
  const openingTimes = descByType('OpeningTimes')?.text || '';
  const dressCode = descByType('DressCode')?.text || '';

  return `
    <div style="margin-bottom:16px; padding:14px 16px; background:#F8FAFC; border-radius:10px;">
      <div style="font-size:10px; font-weight:600; letter-spacing:.06em; text-transform:uppercase; color:#94A3B8; margin-bottom:4px;">${escapeHtml(kindLabel)}</div>
      <div style="font-size:14px; font-weight:600; color:#0F172A; margin-bottom:4px;">${escapeHtml(e.name || 'Airport extra')}</div>
      ${e.subTitle ? `<div style="font-size:11px; color:#475569; margin-bottom:8px;">${escapeHtml(e.subTitle)}</div>` : ''}
      <div style="font-size:11px; color:#475569; padding-top:8px; border-top:1px solid #E2E8F0;">
        ${airport ? `<strong style="color:#0F172A;">${escapeHtml(airport)}</strong>${terminal ? ` · ${escapeHtml(terminal)}` : ''}` : ''}
        ${(airport && dateLabel) ? '  ·  ' : ''}
        ${dateLabel ? escapeHtml(dateLabel) : ''}
        ${(dateLabel && startTime) ? '  ·  ' : ''}
        ${startTime ? `<span class="num">${escapeHtml(startTime)}${endTime ? ` – ${escapeHtml(endTime)}` : ''}</span>` : ''}
      </div>
      ${(fullDesc || openingTimes || dressCode) ? `
        <div style="margin-top:10px; padding-top:10px; border-top:1px dashed #E2E8F0; font-size:11px; color:#475569; line-height:1.55;">
          ${fullDesc ? `<p style="margin:0 0 6px;">${escapeHtml(fullDesc.slice(0, 400))}${fullDesc.length > 400 ? '…' : ''}</p>` : ''}
          ${openingTimes ? `<div><strong style="color:#0F172A;">Opening times:</strong> ${escapeHtml(openingTimes)}</div>` : ''}
          ${dressCode ? `<div><strong style="color:#0F172A;">Dress code:</strong> ${escapeHtml(dressCode)}</div>` : ''}
        </div>` : ''}
    </div>`;
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

// Lighten (positive) or darken (negative) a hex colour by a percentage.
// Used to derive primary-dark from primary in the gradient ramp.
function shiftHex(hex, percent) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 0xff;
  const g = (n >> 8) & 0xff;
  const b = n & 0xff;
  const target = percent >= 0 ? 255 : 0;
  const ratio = Math.abs(percent) / 100;
  const adj = (c) => Math.round(c + (target - c) * ratio);
  const out = (adj(r) << 16) | (adj(g) << 8) | adj(b);
  return '#' + out.toString(16).padStart(6, '0');
}

// ----- Main render -----

/**
 * @param {object} order — trimmed order from retrieve-order
 * @param {object} opts — {
 *   issuedAt?: ISO string,
 *   brandName?: string,            // displayed in header/footer when set; omitted when blank
 *   supportEmail?: string,
 *   supportPhone?: string,
 *   colors?: { primary, accent, success, warning, text },
 *   radius?: number                // base radius in px
 * }
 */
export function renderPdfHtml(order, opts = {}) {
  const issuedAt = opts.issuedAt || new Date().toISOString();
  const brandName = (opts.brandName || '').trim();         // empty = no brand row
  const hasBrand = brandName.length > 0;
  const supportEmail = opts.supportEmail || null;
  const supportPhone = opts.supportPhone || null;

  // Colour overrides — defaults match the Travelgenix design language but
  // are fully overridable per widget.
  const COLOR_DEFAULTS = {
    primary: '#1B2B5B',
    accent:  '#00B4D8',
    success: '#10B981',
    warning: '#F59E0B',
    text:    '#0F172A',
  };
  const colors = Object.assign({}, COLOR_DEFAULTS, opts.colors || {});
  // Note: don't use `|| 12` — that would treat 0 (Sharp) as falsy and
  // substitute 12. Default only when the value is missing or NaN.
  const parsedRadius = parseInt(opts.radius, 10);
  const radius = Math.max(0, Math.min(28, Number.isFinite(parsedRadius) ? parsedRadius : 12));
  // Derive a darker primary for the gradient ramp
  const primaryDark = shiftHex(colors.primary, -18);

  // First accommodation item is the v1 case
  const accomItem = (order.items || []).find((it) => it?.product === 'Accommodation') || (order.items || [])[0] || null;
  const accom = accomItem?.accommodation || null;

  // Multi-product items. The PDF mirrors the widget: hotel on top, flights
  // and extras as their own sections below the trip overview.
  const flightItems = (order.items || []).filter((it) => it?.product === 'Flights');
  const extraItems = (order.items || []).filter((it) => it?.product === 'AirportExtras');
  const summary = order.summary || {};

  const orderRef = accomItem?.bookingReference || flightItems[0]?.bookingReference || order.id || '';
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

  // Total cost prefers the multi-product summary. For hotel-only orders the
  // summary is missing or single-product, so we fall back to the hotel price.
  const totalCost = (typeof summary.totalPrice === 'number' && summary.totalPrice > 0)
    ? summary.totalPrice
    : (accom?.pricing?.price ?? accomItem?.price ?? null);
  const currency = accom?.pricing?.currency || accomItem?.currency || flightItems[0]?.currency || extraItems[0]?.currency || order.currency || 'GBP';

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

  const guests = (Array.isArray(summary.travellers) && summary.travellers.length > 0)
    ? summary.travellers
    : (accom?.guests || []);
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
<title>Booking ${escapeHtml(orderRef)}${hasBrand ? ' — ' + escapeHtml(brandName) : ''}</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Fraunces:opsz,wght@9..144,500;9..144,600;9..144,700&display=swap" rel="stylesheet">
<style>
  :root {
    --primary: ${colors.primary};
    --primary-dark: ${primaryDark};
    --accent: ${colors.accent};
    --accent-dark: ${shiftHex(colors.accent, -16)};
    --success: ${colors.success};
    --warning: ${colors.warning};
    --text: ${colors.text};
    --text-2: #475569;
    --text-3: #94A3B8;
    --bg: #F8FAFC;
    --bg-2: #F1F5F9;
    --border: #E2E8F0;
    --border-light: #F1F5F9;
    --radius: ${radius}px;
    --radius-sm: ${Math.round(radius * 0.5)}px;
    --radius-md: ${Math.round(radius * 0.66)}px;
    --radius-lg: ${radius}px;
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
    <div class="pdf-header-brand">${hasBrand ? escapeHtml(brandName) : '&nbsp;'}</div>
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
        ${unit ? `<dt>Room type</dt><dd>${escapeHtml([(unit.roomType && unit.roomType !== 'Unknown') ? unit.roomType : unit.name, rate?.board].filter(Boolean).join(' · '))}</dd>` : ''}
        ${leadGuestName ? `<dt>Lead guest</dt><dd>${escapeHtml(leadGuestName)}</dd>` : ''}
        ${specialRequests ? `<dt>Special requests</dt><dd style="font-style:italic; color:var(--text-2);">${escapeHtml(specialRequests)}</dd>` : ''}
      </dl>
    </div>

    ${flightItems.length > 0 ? `
    <div class="pdf-section">
      ${flightItems.map(renderPdfFlightItem).join('')}
    </div>` : ''}

    ${extraItems.length > 0 ? `
    <div class="pdf-section">
      <div class="pdf-section-title">Airport Extras</div>
      ${extraItems.map(renderPdfExtraItem).join('')}
    </div>` : ''}

    ${totalCost != null ? `
    <div class="pdf-section">
      <div class="pdf-section-title">Payment Schedule</div>
      <div class="pdf-pay">
        <div class="pdf-pay-box">
          <div class="pdf-pay-row">
            <span class="label">${(flightItems.length || extraItems.length) ? 'Total holiday cost' : 'Room rate'}</span>
            <span class="value num">${escapeHtml(formatMoney(totalCost, currency))}</span>
          </div>
          ${(flightItems.length || extraItems.length) && accomItem && typeof accomItem.price === 'number' ? `
          <div class="pdf-pay-row" style="font-size:11px; padding:4px 0;">
            <span class="label" style="color:#94A3B8; padding-left:12px;">— Accommodation</span>
            <span class="value num" style="color:#475569;">${escapeHtml(formatMoney(accomItem.price, currency))}</span>
          </div>` : ''}
          ${flightItems.length > 0 ? `
          <div class="pdf-pay-row" style="font-size:11px; padding:4px 0;">
            <span class="label" style="color:#94A3B8; padding-left:12px;">— Flights</span>
            <span class="value num" style="color:#475569;">${escapeHtml(formatMoney(flightItems.reduce((a, i) => a + (typeof i.price === 'number' ? i.price : 0), 0), currency))}</span>
          </div>` : ''}
          ${extraItems.length > 0 ? `
          <div class="pdf-pay-row" style="font-size:11px; padding:4px 0;">
            <span class="label" style="color:#94A3B8; padding-left:12px;">— Airport extras</span>
            <span class="value num" style="color:#475569;">${escapeHtml(formatMoney(extraItems.reduce((a, i) => a + (typeof i.price === 'number' ? i.price : 0), 0), currency))}</span>
          </div>` : ''}
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
    <span class="pdf-footer-brand">${hasBrand ? escapeHtml(brandName) : ''}</span>
    <span class="num">Booking ${escapeHtml(orderRef)}${hasHotelDetail ? ' · Page 1 of 2' : ''}</span>
    <span>${escapeHtml(supportEmail || '')}</span>
  </div>

</div>

${hasHotelDetail ? `
<!-- ============ PAGE 2 ============ -->
<div class="page">

  <div class="pdf-page-header">
    <span class="brand">${hasBrand ? escapeHtml(brandName) : '&nbsp;'}</span>
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
      ${hasBrand
        ? `This confirmation is issued under ${escapeHtml(brandName)}'s standard booking terms. Please retain this document for your records.`
        : `Please retain this document for your records.`}
    </p>

  </div>

  <div class="pdf-footer">
    <span class="pdf-footer-brand">${hasBrand ? escapeHtml(brandName) : ''}</span>
    <span class="num">Booking ${escapeHtml(orderRef)} · Page 2 of 2</span>
    <span>${escapeHtml(supportEmail || '')}</span>
  </div>

</div>` : ''}

</body>
</html>`;
}
