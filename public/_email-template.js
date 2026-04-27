/**
 * Travelgenix Widget Suite — Email confirmation template
 *
 * Renders the trimmed `order` object (see retrieve-order.js trimOrder())
 * into an email-client-safe HTML document. Used for:
 *   - The customer's "email me a copy" confirmation (Phase 2 — sending parked)
 *   - The inline preview inside the editor's preview pane
 *
 * Email HTML is fundamentally different from web HTML:
 *   - No <style> blocks reliably (Outlook strips them)
 *   - All styles must be inline (style="..." on every element)
 *   - No CSS variables — colour values are substituted into the strings
 *   - Table-based layout (Outlook ignores flexbox/grid)
 *   - 600px max width
 *   - System font stack only (no Google Fonts in Outlook)
 *
 * Design mirrors the approved email mockup:
 *   - Navy header bar with brand name + "Booking Confirmation" eyebrow
 *   - Hero band with hotel image + property name + "Confirmed" pill
 *   - Greeting paragraph with countdown
 *   - Booking ref + total grid
 *   - Stay details table
 *   - Payment card (cost / paid / balance)
 *   - Optional instalment plan callout
 *   - "Before you go" section for in-resort fees / cancellation
 *   - CTA button (View my booking online)
 *   - "Need a hand?" help block
 *   - Footer with company info
 *
 * Public API:
 *   renderEmailHtml(order, opts) → string (full HTML email)
 *
 * This file is loaded as ES module both server-side (Node, via the email
 * sending endpoint) and browser-side (the editor preview pane via
 * <script type="module">). Pure JS, no Node-only APIs.
 */

// ----- Helpers (mirrors _pdf-template.js) -----

const escapeHtml = (s) => {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
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

const formatMoney = (amount, currency) => {
  if (amount == null || !Number.isFinite(amount)) return '—';
  const symbol = currencySymbol(currency);
  return symbol + Math.abs(amount).toLocaleString('en-GB', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
};

const formatDate = (iso, opts = {}) => {
  if (!iso) return '—';
  const d = new Date(iso.length === 10 ? iso + 'T00:00:00Z' : iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-GB', {
    weekday: opts.includeWeekday ? 'short' : undefined,
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

const daysUntil = (iso) => {
  if (!iso) return null;
  const d = new Date(iso.length === 10 ? iso + 'T00:00:00Z' : iso);
  if (Number.isNaN(d.getTime())) return null;
  const ms = d.getTime() - Date.now();
  return Math.max(0, Math.ceil(ms / (1000 * 60 * 60 * 24)));
};

const pickHeroImage = (media) => {
  if (!Array.isArray(media) || media.length === 0) return null;
  const exterior = media.find((m) => /exterior/i.test(m?.type || ''));
  return (exterior?.url) || media[0]?.url || null;
};

// Render an ISO timestamp as HH:MM in airport-local clock. Travelify dresses
// local times as UTC so we read UTC components (matches widget behaviour).
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

// Lighten/darken hex (used to derive primary-dark from primary)
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
 *   brandName?: string,            // displayed in header/footer when set
 *   supportEmail?: string,
 *   supportPhone?: string,
 *   colors?: { primary, accent, success, warning, text },
 *   radius?: number,
 *   bookingUrl?: string            // CTA target ("View my booking online")
 * }
 */
export function renderEmailHtml(order, opts = {}) {
  const brandName = (opts.brandName || '').trim();
  const hasBrand = brandName.length > 0;
  const supportEmail = opts.supportEmail || null;
  const supportPhone = opts.supportPhone || null;
  const bookingUrl = opts.bookingUrl || '#';

  const COLOR_DEFAULTS = {
    primary: '#1B2B5B',
    accent:  '#00B4D8',
    success: '#10B981',
    warning: '#F59E0B',
    text:    '#0F172A',
  };
  const colors = Object.assign({}, COLOR_DEFAULTS, opts.colors || {});
  const parsedRadius = parseInt(opts.radius, 10);
  const radius = Math.max(0, Math.min(28, Number.isFinite(parsedRadius) ? parsedRadius : 12));
  const radiusLg = radius + 'px';
  const radiusSm = Math.round(radius * 0.5) + 'px';

  // Order data
  const accomItem = (order.items || []).find((it) => it?.product === 'Accommodation') || (order.items || [])[0] || null;
  const accom = accomItem?.accommodation || null;
  const flightItems = (order.items || []).filter((it) => it?.product === 'Flights');
  const extraItems = (order.items || []).filter((it) => it?.product === 'AirportExtras');
  const summary = order.summary || {};
  const isMultiProduct = flightItems.length > 0 || extraItems.length > 0;

  const orderRef = accomItem?.bookingReference || flightItems[0]?.bookingReference || (order.id ? String(order.id) : '');
  const heroImg = accom ? pickHeroImage(accom.media) : null;
  const propertyName = accom?.name || 'Your booking';
  const city = accom?.location?.city || '';
  const country = accom?.location?.country || '';
  const locationLine = [city, country].filter(Boolean).join(', ');

  const startDate = accomItem?.startDate || null;
  const nights = computeNights(startDate, accomItem?.duration ?? accom?.units?.[0]?.nights);
  const checkout = nights ? computeCheckout(startDate, nights) : null;
  // Countdown uses earliest item date so flight-led trips count down to the
  // flight, not to hotel check-in.
  const tripStart = summary.earliestStart || startDate;
  const days = daysUntil(tripStart);

  const unit = accom?.units?.[0] || null;
  const rate = unit?.rates?.[0] || null;

  const totalCost = (typeof summary.totalPrice === 'number' && summary.totalPrice > 0)
    ? summary.totalPrice
    : (accom?.pricing?.price ?? accomItem?.price ?? null);
  const currency = accom?.pricing?.currency || accomItem?.currency || flightItems[0]?.currency || extraItems[0]?.currency || order.currency || 'GBP';

  // Pick a deposit option that has a breakdown
  const depositOption =
    (accom?.pricing?.depositOptions || []).find((d) => Array.isArray(d.breakdown) && d.breakdown.length > 0) ||
    (accom?.pricing?.depositOptions || [])[0] ||
    null;

  const depositPaid = depositOption?.amount ?? null;
  const balance = totalCost != null && depositPaid != null ? totalCost - depositPaid : null;
  const balanceDueDate = depositOption?.dueDate || null;
  const instalments = depositOption?.breakdown || [];

  const isRefundable = !!accom?.pricing?.isRefundable;

  const customerFirstName = order.customerFirstname || 'there';
  const subjectDestination = city || 'trip';

  const inResortFees = accom?.pricing?.inResortFees;

  // Subject line — useful when actually sending; leaked into <title> too
  const subject = `Your ${subjectDestination} booking is confirmed${startDate ? ' — ' + formatDateShort(startDate) : ''}`;

  // Pre-compute strings used inline
  const fontStack = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";
  const accentLight = shiftHex(colors.accent, 70); // pale tint for callouts
  const successLight = shiftHex(colors.success, 80);
  const warningLight = shiftHex(colors.warning, 80);

  // ---------- Email-safe sub-renderers ----------
  // Email HTML must use table-based layout (Outlook ignores flexbox/grid)
  // and all styles inline (Outlook strips <style> blocks). These helpers
  // emit one self-contained block per leg / extra.

  const renderEmailFlightItem = (item) => {
    const f = item?.flights;
    if (!f || !Array.isArray(f.routes) || f.routes.length === 0) return '';
    const carrierNames = new Set();
    for (const r of f.routes) {
      for (const s of (r.segments || [])) {
        if (s.marketingCarrier?.name) carrierNames.add(s.marketingCarrier.name);
      }
    }
    const carrier = Array.from(carrierNames).slice(0, 3).join(', ');

    const legHtml = f.routes.map((route) => {
      const segs = route.segments || [];
      if (segs.length === 0) return '';
      const first = segs[0];
      const last = segs[segs.length - 1];
      const stops = segs.length - 1;
      const flightMins = segs.reduce((a, s) => a + (typeof s.duration === 'number' ? s.duration : 0), 0);
      const baggage = first.baggage?.allowance || first.baggage?.weight || '';
      const cabin = first.cabinClass || '';
      return `
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:14px;border-top:1px solid #F1F5F9;">
          <tr>
            <td colspan="3" style="padding:14px 0 8px;">
              <span style="display:inline-block;padding:2px 10px;background:#F1F5F9;border-radius:9999px;font-size:10px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:#475569;font-family:${fontStack};">${escapeHtml(route.direction || 'Flight')}</span>
            </td>
          </tr>
          <tr>
            <td width="35%" style="vertical-align:top;font-family:${fontStack};">
              <div style="font-size:18px;font-weight:700;color:${colors.text};line-height:1.1;font-variant-numeric:tabular-nums;">${escapeHtml(fmtTimeUtc(first.depart))}</div>
              <div style="font-size:11px;font-weight:600;color:#475569;margin-top:2px;letter-spacing:.04em;">${escapeHtml(first.origin?.iataCode || '')}${first.origin?.terminal ? ' · T' + escapeHtml(first.origin.terminal) : ''}</div>
              <div style="font-size:11px;color:#94A3B8;margin-top:2px;">${escapeHtml(first.origin?.name || '')}</div>
            </td>
            <td width="30%" align="center" style="vertical-align:middle;font-family:${fontStack};">
              <div style="font-size:10px;color:#94A3B8;font-variant-numeric:tabular-nums;">${escapeHtml(fmtDuration(flightMins))}</div>
              <div style="height:1px;background:#CBD5E1;margin:6px 12px;"></div>
              <div style="font-size:10px;color:#94A3B8;">${stops === 0 ? 'Direct' : (stops + ' stop' + (stops === 1 ? '' : 's'))}</div>
            </td>
            <td width="35%" align="right" style="vertical-align:top;font-family:${fontStack};">
              <div style="font-size:18px;font-weight:700;color:${colors.text};line-height:1.1;font-variant-numeric:tabular-nums;">${escapeHtml(fmtTimeUtc(last.arrive))}</div>
              <div style="font-size:11px;font-weight:600;color:#475569;margin-top:2px;letter-spacing:.04em;">${escapeHtml(last.destination?.iataCode || '')}${last.destination?.terminal ? ' · T' + escapeHtml(last.destination.terminal) : ''}</div>
              <div style="font-size:11px;color:#94A3B8;margin-top:2px;">${escapeHtml(last.destination?.name || '')}</div>
            </td>
          </tr>
          ${(cabin || baggage) ? `
          <tr>
            <td colspan="3" style="padding-top:10px;font-size:11px;color:#475569;font-family:${fontStack};">
              ${cabin ? `<strong style="color:${colors.text};">${escapeHtml(cabin)}</strong>` : ''}${cabin && baggage ? ' &nbsp;·&nbsp; ' : ''}${baggage ? escapeHtml(baggage) : ''}
            </td>
          </tr>` : ''}
        </table>`;
    }).join('');

    return `
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#FFFFFF;border:1px solid #E2E8F0;border-radius:${radiusLg};">
        <tr>
          <td style="padding:16px 20px 4px;font-family:${fontStack};">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td style="font-size:14px;font-weight:600;color:${colors.text};">✈ Flights</td>
                ${carrier ? `<td align="right" style="font-size:11px;color:#94A3B8;">${escapeHtml(carrier)}</td>` : ''}
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="padding:0 20px 16px;">
            ${legHtml}
          </td>
        </tr>
      </table>`;
  };

  const renderEmailExtraItem = (item) => {
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

    return `
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#F8FAFC;border:1px solid #E2E8F0;border-radius:${radiusLg};margin-top:12px;">
        <tr>
          <td style="padding:14px 18px;font-family:${fontStack};">
            <div style="font-size:10px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:#94A3B8;margin-bottom:4px;">${escapeHtml(kindLabel)}</div>
            <div style="font-size:14px;font-weight:600;color:${colors.text};margin-bottom:4px;">${escapeHtml(e.name || 'Airport extra')}</div>
            ${e.subTitle ? `<div style="font-size:11px;color:#475569;margin-bottom:8px;">${escapeHtml(e.subTitle)}</div>` : ''}
            <div style="font-size:11px;color:#475569;padding-top:8px;border-top:1px solid #E2E8F0;">
              ${airport ? `<strong style="color:${colors.text};">${escapeHtml(airport)}</strong>${terminal ? ` · ${escapeHtml(terminal)}` : ''}` : ''}
              ${(airport && dateLabel) ? '  ·  ' : ''}
              ${dateLabel ? escapeHtml(dateLabel) : ''}
              ${(dateLabel && startTime) ? '  ·  ' : ''}
              ${startTime ? `<span style="font-variant-numeric:tabular-nums;">${escapeHtml(startTime)}${endTime ? ` – ${escapeHtml(endTime)}` : ''}</span>` : ''}
            </div>
          </td>
        </tr>
      </table>`;
  };

  // ---------- HTML ----------

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:0;background:#F8FAFC;font-family:${fontStack};-webkit-font-smoothing:antialiased;">

<!-- Preview text (hidden but shows in inbox preview) -->
<div style="display:none;font-size:1px;color:#F8FAFC;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">
  ${escapeHtml(propertyName)} · ${escapeHtml(formatDateShort(startDate))} · Booking ${escapeHtml(orderRef)}
</div>

<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background:#F8FAFC;">
  <tr>
    <td align="center" style="padding:24px 16px;">

      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="600" style="max-width:600px;width:100%;background:#ffffff;border-radius:${radiusLg};overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.06);">

        <!-- HEADER -->
        ${hasBrand ? `
        <tr>
          <td style="padding:20px 32px;background-color:${colors.primary};">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td style="color:#ffffff;font-size:16px;font-weight:700;letter-spacing:-.01em;font-family:${fontStack};">
                  ${escapeHtml(brandName)}
                </td>
                <td align="right" style="color:rgba(255,255,255,.7);font-size:11px;font-weight:500;letter-spacing:.08em;text-transform:uppercase;font-family:${fontStack};">
                  Booking Confirmation
                </td>
              </tr>
            </table>
          </td>
        </tr>` : `
        <tr>
          <td style="padding:20px 32px;background-color:${colors.primary};text-align:center;color:rgba(255,255,255,.85);font-size:11px;font-weight:500;letter-spacing:.08em;text-transform:uppercase;font-family:${fontStack};">
            Booking Confirmation
          </td>
        </tr>`}

        <!-- HERO -->
        ${heroImg ? `
        <tr>
          <td style="padding:0;">
            <div style="position:relative;height:240px;background-image:url('${escapeHtml(heroImg)}');background-size:cover;background-position:center;">
              <div style="position:absolute;inset:0;background:linear-gradient(180deg,rgba(15,23,42,.10) 0%,rgba(15,23,42,.75) 100%);"></div>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="position:absolute;bottom:0;left:0;right:0;">
                <tr>
                  <td style="padding:24px 32px;">
                    <div style="display:inline-block;padding:5px 12px;background:${colors.success};border-radius:999px;color:#ffffff;font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;font-family:${fontStack};margin-bottom:12px;">
                      ✓ &nbsp;Confirmed
                    </div>
                    ${locationLine ? `<div style="color:rgba(255,255,255,.85);font-size:11px;margin-bottom:6px;font-weight:500;letter-spacing:.06em;text-transform:uppercase;font-family:${fontStack};">${escapeHtml(locationLine)}</div>` : ''}
                    <div style="color:#ffffff;font-size:28px;font-weight:700;font-family:${fontStack};letter-spacing:-.02em;line-height:1.1;text-shadow:0 2px 12px rgba(0,0,0,.3);">
                      ${escapeHtml(propertyName)}
                    </div>
                  </td>
                </tr>
              </table>
            </div>
          </td>
        </tr>` : `
        <tr>
          <td style="padding:48px 32px;background:linear-gradient(135deg,${colors.primary} 0%,${shiftHex(colors.primary, -18)} 100%);text-align:center;">
            <div style="display:inline-block;padding:5px 12px;background:${colors.success};border-radius:999px;color:#ffffff;font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;font-family:${fontStack};margin-bottom:12px;">
              ✓ &nbsp;Confirmed
            </div>
            ${locationLine ? `<div style="color:rgba(255,255,255,.85);font-size:11px;margin-bottom:6px;font-weight:500;letter-spacing:.06em;text-transform:uppercase;font-family:${fontStack};">${escapeHtml(locationLine)}</div>` : ''}
            <div style="color:#ffffff;font-size:28px;font-weight:700;font-family:${fontStack};letter-spacing:-.02em;line-height:1.1;">${escapeHtml(propertyName)}</div>
          </td>
        </tr>`}

        <!-- GREETING -->
        <tr>
          <td style="padding:32px 32px 0;">
            <p style="margin:0 0 8px;font-size:18px;color:${colors.text};font-weight:600;letter-spacing:-.01em;font-family:${fontStack};">
              Hi ${escapeHtml(customerFirstName)},
            </p>
            <p style="margin:0;font-size:15px;line-height:1.6;color:#475569;font-family:${fontStack};">
              Your booking is confirmed. Here's everything you need in one place${days != null && days > 0 ? ` — your ${escapeHtml(subjectDestination)} ${days === 1 ? 'trip is tomorrow' : 'escape begins in <strong style="color:' + colors.text + ';font-variant-numeric:tabular-nums;">' + days + ' days</strong>'}` : ''}.
            </p>
          </td>
        </tr>

        <!-- REF + TOTAL -->
        <tr>
          <td style="padding:24px 32px 0;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#F8FAFC;border:1px solid #E2E8F0;border-radius:${radiusLg};">
              <tr>
                <td style="padding:16px 20px;border-right:1px solid #E2E8F0;width:50%;">
                  <div style="font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:#94A3B8;margin-bottom:4px;font-family:${fontStack};">Booking reference</div>
                  <div style="font-size:18px;font-weight:700;color:${colors.text};letter-spacing:.02em;font-family:${fontStack};font-variant-numeric:tabular-nums;">${escapeHtml(orderRef)}</div>
                </td>
                <td align="right" style="padding:16px 20px;width:50%;">
                  <div style="font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:#94A3B8;margin-bottom:4px;font-family:${fontStack};">Total</div>
                  <div style="font-size:18px;font-weight:700;color:${colors.text};letter-spacing:-.01em;font-family:${fontStack};font-variant-numeric:tabular-nums;">${escapeHtml(formatMoney(totalCost, currency))}</div>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- STAY -->
        <tr>
          <td style="padding:24px 32px 0;">
            <div style="font-size:11px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:#94A3B8;margin-bottom:12px;font-family:${fontStack};">Your stay</div>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
              ${startDate ? `
              <tr>
                <td width="50%" style="padding:12px 16px 12px 0;border-bottom:1px solid #F1F5F9;font-size:14px;color:#475569;font-family:${fontStack};">Check-in</td>
                <td style="padding:12px 0;border-bottom:1px solid #F1F5F9;text-align:right;font-size:14px;font-weight:600;color:${colors.text};font-family:${fontStack};font-variant-numeric:tabular-nums;">${escapeHtml(formatDate(startDate, { includeWeekday: true, shortMonth: true }))} · from 15:00</td>
              </tr>` : ''}
              ${checkout ? `
              <tr>
                <td style="padding:12px 16px 12px 0;border-bottom:1px solid #F1F5F9;font-size:14px;color:#475569;font-family:${fontStack};">Check-out</td>
                <td style="padding:12px 0;border-bottom:1px solid #F1F5F9;text-align:right;font-size:14px;font-weight:600;color:${colors.text};font-family:${fontStack};font-variant-numeric:tabular-nums;">${escapeHtml(formatDate(checkout, { includeWeekday: true, shortMonth: true }))} · by 12:00</td>
              </tr>` : ''}
              ${unit ? `
              <tr>
                <td style="padding:12px 16px 12px 0;border-bottom:1px solid #F1F5F9;font-size:14px;color:#475569;font-family:${fontStack};">Room</td>
                <td style="padding:12px 0;border-bottom:1px solid #F1F5F9;text-align:right;font-size:14px;font-weight:600;color:${colors.text};font-family:${fontStack};">${escapeHtml([(unit.roomType && unit.roomType !== 'Unknown') ? unit.roomType : unit.name, rate?.board].filter(Boolean).join(' · '))}</td>
              </tr>` : ''}
              ${nights ? `
              <tr>
                <td style="padding:12px 16px 12px 0;border-bottom:1px solid #F1F5F9;font-size:14px;color:#475569;font-family:${fontStack};">Nights</td>
                <td style="padding:12px 0;border-bottom:1px solid #F1F5F9;text-align:right;font-size:14px;font-weight:600;color:${colors.text};font-family:${fontStack};font-variant-numeric:tabular-nums;">${nights}</td>
              </tr>` : ''}
              <tr>
                <td style="padding:12px 16px 12px 0;font-size:14px;color:#475569;font-family:${fontStack};">Lead guest</td>
                <td style="padding:12px 0;text-align:right;font-size:14px;font-weight:600;color:${colors.text};font-family:${fontStack};">${escapeHtml([order.customerTitle, order.customerFirstname, order.customerSurname].filter(Boolean).join(' '))}</td>
              </tr>
            </table>
          </td>
        </tr>

        ${flightItems.length > 0 ? `
        <!-- FLIGHTS -->
        <tr>
          <td style="padding:24px 32px 0;">
            <div style="font-size:11px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:#94A3B8;margin-bottom:12px;font-family:${fontStack};">Flights</div>
            ${flightItems.map(renderEmailFlightItem).join('')}
          </td>
        </tr>` : ''}

        ${extraItems.length > 0 ? `
        <!-- AIRPORT EXTRAS -->
        <tr>
          <td style="padding:24px 32px 0;">
            <div style="font-size:11px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:#94A3B8;margin-bottom:12px;font-family:${fontStack};">Airport extras</div>
            ${extraItems.map(renderEmailExtraItem).join('')}
          </td>
        </tr>` : ''}

        ${totalCost != null ? `
        <!-- PAYMENT -->
        <tr>
          <td style="padding:24px 32px 0;">
            <div style="font-size:11px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:#94A3B8;margin-bottom:12px;font-family:${fontStack};">Payment</div>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#F8FAFC;border:1px solid #E2E8F0;border-radius:${radiusLg};">
              <tr>
                <td style="padding:16px 20px;">
                  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                    <tr>
                      <td style="font-size:14px;color:#475569;padding:4px 0;font-family:${fontStack};">${isMultiProduct ? 'Total holiday cost' : 'Total cost'}</td>
                      <td align="right" style="font-size:14px;font-weight:600;color:${colors.text};padding:4px 0;font-family:${fontStack};font-variant-numeric:tabular-nums;">${escapeHtml(formatMoney(totalCost, currency))}</td>
                    </tr>
                    ${isMultiProduct && accomItem && typeof accomItem.price === 'number' ? `
                    <tr>
                      <td style="font-size:12px;color:#94A3B8;padding:2px 0 2px 12px;font-family:${fontStack};">— Accommodation</td>
                      <td align="right" style="font-size:12px;color:#475569;padding:2px 0;font-family:${fontStack};font-variant-numeric:tabular-nums;">${escapeHtml(formatMoney(accomItem.price, currency))}</td>
                    </tr>` : ''}
                    ${flightItems.length > 0 ? `
                    <tr>
                      <td style="font-size:12px;color:#94A3B8;padding:2px 0 2px 12px;font-family:${fontStack};">— Flights</td>
                      <td align="right" style="font-size:12px;color:#475569;padding:2px 0;font-family:${fontStack};font-variant-numeric:tabular-nums;">${escapeHtml(formatMoney(flightItems.reduce((a, i) => a + (typeof i.price === 'number' ? i.price : 0), 0), currency))}</td>
                    </tr>` : ''}
                    ${extraItems.length > 0 ? `
                    <tr>
                      <td style="font-size:12px;color:#94A3B8;padding:2px 0 2px 12px;font-family:${fontStack};">— Airport extras</td>
                      <td align="right" style="font-size:12px;color:#475569;padding:2px 0;font-family:${fontStack};font-variant-numeric:tabular-nums;">${escapeHtml(formatMoney(extraItems.reduce((a, i) => a + (typeof i.price === 'number' ? i.price : 0), 0), currency))}</td>
                    </tr>` : ''}
                    ${depositPaid != null ? `
                    <tr>
                      <td style="font-size:14px;color:#475569;padding:4px 0;font-family:${fontStack};">Deposit paid</td>
                      <td align="right" style="font-size:14px;font-weight:600;color:${colors.success};padding:4px 0;font-family:${fontStack};font-variant-numeric:tabular-nums;">${escapeHtml(formatMoney(depositPaid, currency))}</td>
                    </tr>` : ''}
                    ${balance != null && balance > 0 ? `
                    <tr>
                      <td style="font-size:14px;color:#475569;padding:4px 0;font-family:${fontStack};">Balance due</td>
                      <td align="right" style="font-size:14px;font-weight:600;color:${colors.warning};padding:4px 0;font-family:${fontStack};font-variant-numeric:tabular-nums;">${escapeHtml(formatMoney(balance, currency))}${balanceDueDate ? ' by ' + escapeHtml(formatDateShort(balanceDueDate)) : ''}</td>
                    </tr>` : ''}
                  </table>
                </td>
              </tr>
            </table>
            ${instalments.length > 0 ? `
            <div style="margin-top:16px;padding:14px 18px;background:${accentLight};border:1px solid ${shiftHex(colors.accent, 50)};border-left:3px solid ${colors.accent};border-radius:${radiusSm};font-size:13px;color:${shiftHex(colors.primary, -10)};line-height:1.5;font-family:${fontStack};">
              <strong style="color:${colors.text};">Instalment plan active.</strong> ${instalments.length} payment${instalments.length === 1 ? '' : 's'} of <span style="font-variant-numeric:tabular-nums;">${escapeHtml(formatMoney(instalments[0].amount, currency))}</span>${instalments.length > 1 ? ` from ${escapeHtml(formatDateShort(instalments[0].dueDate))} to ${escapeHtml(formatDateShort(instalments[instalments.length - 1].dueDate))}` : ` on ${escapeHtml(formatDateShort(instalments[0].dueDate))}`}.
            </div>` : ''}
          </td>
        </tr>` : ''}

        ${(inResortFees || isRefundable) ? `
        <!-- BEFORE YOU GO -->
        <tr>
          <td style="padding:28px 32px 0;">
            <div style="font-size:11px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:#94A3B8;margin-bottom:12px;font-family:${fontStack};">Before you go</div>
            ${inResortFees ? `
            <p style="margin:0 0 10px;font-size:14px;line-height:1.6;color:#475569;font-family:${fontStack};">
              An <strong style="color:${colors.text};">in-resort fee of ${escapeHtml(formatMoney(inResortFees, currency))}</strong> may apply on arrival, payable directly at the hotel.
            </p>` : ''}
            ${isRefundable ? `
            <p style="margin:0;font-size:14px;line-height:1.6;color:#475569;font-family:${fontStack};">
              <strong style="color:${colors.success};">Fully refundable.</strong> Cancellation deadlines apply — see your booking for full terms.
            </p>` : ''}
          </td>
        </tr>` : ''}

        <!-- CTA -->
        <tr>
          <td align="center" style="padding:32px;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td style="background:${colors.primary};border-radius:${radiusSm};">
                  <a href="${escapeHtml(bookingUrl)}" style="display:inline-block;padding:13px 28px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;font-family:${fontStack};">
                    View my booking online
                  </a>
                </td>
              </tr>
            </table>
            <p style="margin:16px 0 0;font-size:12px;color:#94A3B8;font-family:${fontStack};">
              Access your booking, documents and live updates anytime.
            </p>
          </td>
        </tr>

        ${(supportEmail || supportPhone) ? `
        <!-- HELP -->
        <tr>
          <td style="padding:0 32px 32px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#F8FAFC;border-radius:${radiusLg};">
              <tr>
                <td style="padding:18px 20px;">
                  <div style="font-size:14px;font-weight:600;color:${colors.text};margin-bottom:4px;letter-spacing:-.01em;font-family:${fontStack};">Need a hand?</div>
                  <div style="font-size:13px;color:#475569;line-height:1.5;font-family:${fontStack};">
                    ${supportEmail ? `Reply to this email${supportPhone ? ` or call us on <a href="tel:${escapeHtml(supportPhone.replace(/[^+0-9]/g, ''))}" style="color:${colors.accent};text-decoration:none;font-weight:500;font-variant-numeric:tabular-nums;">${escapeHtml(supportPhone)}</a>` : ''}.` :
                      supportPhone ? `Call us on <a href="tel:${escapeHtml(supportPhone.replace(/[^+0-9]/g, ''))}" style="color:${colors.accent};text-decoration:none;font-weight:500;font-variant-numeric:tabular-nums;">${escapeHtml(supportPhone)}</a>.` : ''}
                    We're here to help.
                  </div>
                </td>
              </tr>
            </table>
          </td>
        </tr>` : ''}

      </table>

      <!-- FOOTER -->
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="600" style="max-width:600px;width:100%;margin-top:16px;">
        <tr>
          <td align="center" style="padding:16px 32px;font-size:12px;color:#94A3B8;line-height:1.6;font-family:${fontStack};">
            ${hasBrand ? escapeHtml(brandName) : ''}${hasBrand && supportEmail ? ' · ' : ''}${supportEmail ? escapeHtml(supportEmail) : ''}
            <br><br>
            <span style="color:#CBD5E1;">This email was sent because you requested a copy of your booking confirmation.</span>
          </td>
        </tr>
      </table>

    </td>
  </tr>
</table>

</body>
</html>`;
}
