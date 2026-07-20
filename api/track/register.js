// =============================================================================
//  /api/track/register.js   →   POST /api/track/register
// =============================================================================
//
//  Mint a YesAware tracker for one email. ADMIN ONLY (Travelgenix staff) — this
//  is a personal tool and is never exposed to client accounts. It stores one
//  "YesAware Messages" row and returns the pixel URL plus signed tracked-link
//  URLs to paste, and a ready-made HTML snippet.
//
//  Body: { subject?, recipient?, links?: [{ label?, url }] }
//  Returns: { token, pixelUrl, pixelHtml, links: [{label,url,trackedUrl}], snippetHtml }
//
// =============================================================================

import { requireAdmin, setAdminCors } from '../admin/_guard.js';
import { applyRateLimit, RATE_LIMITS } from '../_auth.js';
import {
  newToken, pixelUrl, trackedLinkUrl, safeHttpUrl,
  airtableInsert, MESSAGES, trackingEnabled,
} from '../_lib/yesaware.js';

const MAX_LINKS = 25;

function esc(v) {
  return String(v == null ? '' : v).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

export default async function handler(req, res) {
  setAdminCors(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Owner gate — authenticated Travelgenix staff/admin only. Fails closed.
  const gate = requireAdmin(req);
  if (gate.error) return res.status(gate.status).json({ error: gate.error });

  if (!trackingEnabled()) return res.status(503).json({ error: 'Tracking is disabled' });

  const rlKey = `yesaware-register:${gate.user.recordId || gate.user.clientId || 'anon'}`;
  if (!applyRateLimit(res, rlKey, RATE_LIMITS.widgetWrite)) return;

  // Parse + validate body.
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  if (!body || typeof body !== 'object') body = {};

  const subject = typeof body.subject === 'string' ? body.subject.slice(0, 300) : '';
  const recipient = typeof body.recipient === 'string' ? body.recipient.slice(0, 200) : '';
  const rawLinks = Array.isArray(body.links) ? body.links.slice(0, MAX_LINKS) : [];

  const token = newToken();

  const links = [];
  for (const l of rawLinks) {
    if (!l || typeof l !== 'object') continue;
    const clean = safeHttpUrl(typeof l.url === 'string' ? l.url : '');
    if (!clean) continue; // silently drop non-http(s) links
    const label = typeof l.label === 'string' ? l.label.slice(0, 120) : '';
    links.push({ label, url: clean, trackedUrl: trackedLinkUrl(token, clean) });
  }

  const pixel = pixelUrl(token);
  const pixelHtml = `<img src="${pixel}" width="1" height="1" alt="" style="display:none">`;

  // Store the message. Fail-open: if Airtable is down we still return the
  // tracker so Andy is never blocked; the events just won't have a parent row.
  await airtableInsert(MESSAGES, {
    Token: token,
    Subject: subject,
    Recipient: recipient,
    Links: JSON.stringify(links.map((l) => ({ label: l.label, url: l.url }))),
  });

  // Copy-paste snippet: tracked links (if any) then the hidden pixel. Labels are
  // escaped; the tracked URLs are built from encoded parts so carry no markup.
  const linkHtml = links.map((l) => `<a href="${l.trackedUrl}">${esc(l.label || l.url)}</a>`).join('<br>');

  return res.status(200).json({
    token,
    pixelUrl: pixel,
    pixelHtml,
    links,
    snippetHtml: (linkHtml ? linkHtml + '<br>' : '') + pixelHtml,
  });
}
