/**
 * POST /api/atol-certificate-preview
 *
 * The My Booking editor's "Preview certificate" button (24 Sep 2026). Draws
 * one of the three CAA ATOL certificates with the client's own ATOL details,
 * as they have typed them and before they save, on a made-up booking, so they
 * can see exactly what their customers will be given.
 *
 * The CAA's SAMPLE watermark is LEFT ON. A specimen carrying a real ATOL
 * number must never be usable as a certificate; only a real booking, through
 * /api/booking-pdf with document 'atol', gets a clean page.
 *
 * Body: { type: 'flight-only' | 'package-single' | 'package-multi',
 *         atol: { holderName, atolNumber } }
 * Signed-in only (any client user), rate limited per user.
 */
import { requireAuth, setCors, applyRateLimit, RATE_LIMITS } from './_auth.js';
import { ATOL_TYPES, normaliseAtolSettings, buildAtolCertificate, renderAtolCertificatePdf, sampleAtolBooking } from './_lib/atol-certificate.js';
import { ukToday } from './_lib/atol-issue-log.js';

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const auth = requireAuth(req);
  if (auth.error) return res.status(auth.status || 401).json({ error: auth.error });
  const user = auth.user || {};
  const who = String(user.email || user.userId || user.id || 'session').toLowerCase();
  if (!applyRateLimit(res, `atol-preview:${who}`, RATE_LIMITS.widgetRead)) return;

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  body = body && typeof body === 'object' ? body : {};
  const type = ATOL_TYPES[body.type] ? body.type : 'flight-only';
  const settings = normaliseAtolSettings(body.atol);
  if (!settings.ready) {
    return res.status(400).json({ error: 'Add your company’s legal name and ATOL number first, then preview.' });
  }
  try {
    const model = buildAtolCertificate(sampleAtolBooking(type), settings, { type, orderRef: 'SAMPLE' });
    const bytes = Buffer.from(await renderAtolCertificatePdf(model, { issuedOn: new Date(ukToday() + 'T00:00:00Z'), sample: true }));
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Length', bytes.length);
    res.setHeader('Content-Disposition', `inline; filename="ATOL-certificate-sample.pdf"`);
    res.setHeader('Cache-Control', 'private, no-store');
    return res.status(200).end(bytes);
  } catch (err) {
    console.error('[atol-certificate-preview]', err && err.message);
    return res.status(500).json({ error: 'The preview could not be drawn. Please try again.' });
  }
}
