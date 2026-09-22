/**
 * /api/admin/events-refresh — the staff Refresh now button
 *
 * GET  reports what is stored, what the committed fallback holds, and when the
 *      cron last managed to replace it.
 * POST reads the supplier sheet and rebuilds, right now.
 *
 * Why it exists (22 Sep 2026). Andy: "it is updated and has all the new
 * fixtures / teams etc, and I will be giving you weekly updates so we need a
 * simple way to do it." The six-hourly cron already means nobody has to do
 * anything for a weekly update to land. This is for the other half of that
 * sentence: after an update has just been made, waiting up to six hours to see
 * it is not a simple way to work.
 *
 * It runs exactly what the cron runs, so a button press and a scheduled run
 * cannot produce different results.
 *
 * Auth: requireAdmin. POST is rate limited harder than GET, because a rebuild
 * reads eleven thousand rows and holding the button down is not a workflow.
 */
import { requireAdmin, setAdminCors } from './_guard.js';
import { applyRateLimit, RATE_LIMITS } from '../_auth.js';
import { refreshEventsSnapshot, currentStoredSnapshot } from '../_lib/events/refresh-snapshot.js';
import { SUPPLIER_SHEET_ID } from '../_lib/events/supplier-sheet.js';

export default async function handler(req, res) {
  setAdminCors(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();

  const gate = requireAdmin(req);
  if (gate.error) return res.status(gate.status).json({ error: gate.error });
  const who = String((gate.user && (gate.user.email || gate.user.userId || gate.user.id)) || 'staff').toLowerCase();

  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'GET') {
    if (!applyRateLimit(res, `events-refresh:read:${who}`, RATE_LIMITS.widgetRead)) return;
    const stored = await currentStoredSnapshot();
    return res.status(200).json({
      sheetId: SUPPLIER_SHEET_ID,
      sheetUrl: `https://docs.google.com/spreadsheets/d/${SUPPLIER_SHEET_ID}/edit`,
      stored,
      // What the widgets fall back to when no refresh has ever landed.
      committedGeneratedAt: '2026-08-21',
      schedule: 'every six hours (00:00, 06:00, 12:00, 18:00 UTC)',
    });
  }

  if (req.method === 'POST') {
    if (!applyRateLimit(res, `events-refresh:run:${who}`, RATE_LIMITS.widgetWrite)) return;
    const result = await refreshEventsSnapshot();
    console.log('[admin/events-refresh]', who, JSON.stringify(result));
    return res.status(200).json(result);
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
