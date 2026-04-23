// =============================================================================
//  /api/enquiry/_lib/routing/_templates/auto-reply-email.js
// =============================================================================
//
//  Default HTML email sent to the VISITOR after they submit an enquiry.
//  Used when the form has no custom Routing Email Auto Reply HTML set.
//
//  Branded with the CLIENT's colours (buttonColour + accentColour) — not
//  Travelgenix's. This is the travel agency's communication with their
//  customer. Travelgenix appears as a small "Powered by" footer credit.
//
//  Three "while you wait" CTAs mirror the visitor thank-you state:
//    1. Chat with Luna (if Luna Chat routing is enabled on the form)
//    2. [Future: book a 15-min call]
//    3. [Future: destination guide PDF]
//  Post-MVP: these CTAs become agent-configurable in the settings panel.
//
// =============================================================================

function esc(s) {
  if (s === null || s === undefined) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Render a single recap row inside the "what you told us" summary.
 * Skip if value is empty so the summary stays clean.
 */
function row(label, value) {
  if (!value || value === '—' || value === '') return '';
  return `
    <tr>
      <td style="padding:10px 20px;border-bottom:1px solid #F1F5F9;color:#94A3B8;font-size:12px;text-transform:uppercase;letter-spacing:0.06em;font-weight:500;vertical-align:top;width:130px;">${esc(label)}</td>
      <td style="padding:10px 20px;border-bottom:1px solid #F1F5F9;color:#0F172A;font-size:14px;font-weight:500;">${esc(value)}</td>
    </tr>`;
}

/**
 * Strip the last border-bottom from the summary table so it doesn't
 * double up with the table's own border-radius.
 */
function finaliseRows(rows) {
  return rows.replace(/(border-bottom:1px solid #F1F5F9;)([^]*?)(?=<\/tr>\s*<\/table>)/g, (m, p1, p2) => p2 + '');
}

export function renderDefaultAutoReplyEmail(t) {
  // Parse client's button colour for gradient variation (lighten by a step)
  const accent = t.accentColour || '#00B4D8';
  const primary = t.buttonColour || '#1B2B5B';

  // Summary rows (only non-empty ones)
  let rows = '';
  rows += row('Destination', t.destinations);
  rows += row('Departing from', t.departureAirport);
  rows += row('Dates', t.dates);
  rows += row('Duration', t.duration);
  rows += row('Travellers', t.travellers);
  rows += row('Budget', t.budget);
  if (t.stars || t.boardBasis) {
    const styleParts = [t.stars, t.boardBasis].filter(Boolean).join(' · ');
    rows += row('Style', styleParts);
  }
  rows += row('Interests', t.interests);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<title>Your enquiry ${esc(t.reference)}</title>
</head>
<body style="margin:0;padding:0;background:#F8FAFC;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;">

  <!-- Preheader -->
  <div style="display:none;max-height:0;overflow:hidden;font-size:1px;line-height:1px;color:#F8FAFC;">
    Thanks ${esc(t.firstName)} — we've got your enquiry and we'll be in touch within 24 hours. Reference ${esc(t.reference)}.
  </div>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#F8FAFC;">
    <tr>
      <td align="center" style="padding:32px 16px;">

        <!-- Main card -->
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;background:#FFFFFF;border-radius:16px;overflow:hidden;box-shadow:0 1px 3px rgba(15,23,42,0.06);">

          <!-- Hero -->
          <tr>
            <td align="center" style="background:linear-gradient(135deg,${esc(primary)} 0%,${esc(accent)} 100%);padding:40px 32px 36px;text-align:center;">
              <div style="display:inline-block;width:56px;height:56px;border-radius:50%;background:rgba(255,255,255,0.15);text-align:center;line-height:56px;margin-bottom:16px;">
                <span style="color:#FFFFFF;font-size:26px;font-weight:700;">✓</span>
              </div>
              <h1 style="margin:0;color:#FFFFFF;font-size:26px;font-weight:700;line-height:1.25;">${esc(t.thankYouMessage)}</h1>
              <p style="margin:8px 0 0;color:rgba(255,255,255,0.85);font-size:15px;line-height:1.5;">
                One of the team at ${esc(t.clientName)} will be in touch within 24 hours.
              </p>
              <div style="display:inline-block;margin-top:20px;padding:6px 14px;background:rgba(255,255,255,0.15);border-radius:999px;color:#FFFFFF;font-size:12px;font-weight:500;font-family:'SF Mono',Menlo,Consolas,monospace;letter-spacing:0.04em;">
                Reference ${esc(t.reference)}
              </div>
            </td>
          </tr>

          ${rows.trim() ? `
          <!-- Summary of what they told us -->
          <tr>
            <td style="padding:28px 32px 8px;">
              <h2 style="margin:0 0 12px;color:#0F172A;font-size:15px;font-weight:600;">Here's what you told us</h2>
              <p style="margin:0 0 16px;color:#64748B;font-size:13px;line-height:1.5;">A quick recap for your records.</p>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid #E2E8F0;border-radius:12px;overflow:hidden;">
                ${rows}
              </table>
            </td>
          </tr>` : ''}

          <!-- What happens next -->
          <tr>
            <td style="padding:28px 32px 8px;">
              <h2 style="margin:0 0 12px;color:#0F172A;font-size:15px;font-weight:600;">What happens next</h2>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="padding:8px 0;vertical-align:top;width:32px;">
                    <div style="width:24px;height:24px;border-radius:50%;background:${esc(accent)};color:#FFFFFF;text-align:center;line-height:24px;font-size:12px;font-weight:700;">1</div>
                  </td>
                  <td style="padding:8px 0 8px 10px;color:#475569;font-size:14px;line-height:1.6;">
                    We'll review what you're looking for and match it against our trusted supplier network.
                  </td>
                </tr>
                <tr>
                  <td style="padding:8px 0;vertical-align:top;">
                    <div style="width:24px;height:24px;border-radius:50%;background:${esc(accent)};color:#FFFFFF;text-align:center;line-height:24px;font-size:12px;font-weight:700;">2</div>
                  </td>
                  <td style="padding:8px 0 8px 10px;color:#475569;font-size:14px;line-height:1.6;">
                    A specialist will get in touch within 24 hours with tailored options and live prices.
                  </td>
                </tr>
                <tr>
                  <td style="padding:8px 0;vertical-align:top;">
                    <div style="width:24px;height:24px;border-radius:50%;background:${esc(accent)};color:#FFFFFF;text-align:center;line-height:24px;font-size:12px;font-weight:700;">3</div>
                  </td>
                  <td style="padding:8px 0 8px 10px;color:#475569;font-size:14px;line-height:1.6;">
                    Once you've seen the options, we'll refine together until we've nailed the perfect trip.
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          ${t.lunaChatEnabled ? `
          <!-- While you wait CTA -->
          <tr>
            <td style="padding:24px 32px 8px;">
              <div style="padding:20px;background:#F8FAFC;border:1px solid #E2E8F0;border-radius:12px;text-align:center;">
                <h3 style="margin:0 0 6px;color:#0F172A;font-size:15px;font-weight:600;">Got questions while you wait?</h3>
                <p style="margin:0 0 14px;color:#64748B;font-size:13px;line-height:1.5;">
                  Chat with Luna, our AI travel assistant — she knows all about ${esc(t.destinations)}.
                </p>
                <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 auto;">
                  <tr>
                    <td style="border-radius:8px;background:${esc(primary)};">
                      <a href="#luna-chat" style="display:inline-block;padding:12px 22px;color:#FFFFFF;font-size:13px;font-weight:600;text-decoration:none;border-radius:8px;">
                        Chat with Luna →
                      </a>
                    </td>
                  </tr>
                </table>
              </div>
            </td>
          </tr>` : ''}

          <!-- Sign-off -->
          <tr>
            <td style="padding:28px 32px 8px;">
              <p style="margin:0;color:#475569;font-size:14px;line-height:1.6;">
                If there's anything else to add — dietary requirements, a specific hotel you've had your eye on, or just another thought — reply to this email and we'll update your enquiry.
              </p>
              <p style="margin:16px 0 0;color:#475569;font-size:14px;line-height:1.6;">
                Speak soon,<br>
                <strong style="color:#0F172A;">The team at ${esc(t.clientName)}</strong>
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:28px 32px 28px;">
              <div style="padding-top:20px;border-top:1px solid #F1F5F9;text-align:center;color:#94A3B8;font-size:11px;line-height:1.6;">
                This is an automated confirmation. Your reference is <strong style="color:#64748B;">${esc(t.reference)}</strong> — please quote it in any reply.
                <br><br>
                <span style="color:#CBD5E1;">Powered by <a href="https://travelgenix.io" style="color:#CBD5E1;text-decoration:none;">Travelgenix</a></span>
              </div>
            </td>
          </tr>
        </table>

      </td>
    </tr>
  </table>

</body>
</html>`;
}
