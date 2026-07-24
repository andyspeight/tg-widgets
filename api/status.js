/**
 * GET /api/status — public platform health, from the last synthetic-monitor run.
 *
 * Returns the most recent result the robot-client monitor (api/cron/monitor.js)
 * stored: overall ok plus a per-check pass/fail. Deliberately REDACTED — it never
 * exposes probe detail (the config check's detail names missing env vars, which
 * is internal). Full detail lives only in the monitor's alert email.
 *
 * 200 when healthy, 503 when degraded, so an external uptime checker can watch it.
 */
import { getJson } from './_redis.js';

const STATUS_KEY = 'monitor:status:v1';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(204).end();

  let status = null;
  try { status = await getJson(STATUS_KEY); } catch { status = null; }

  if (!status) {
    return res.status(200).json({ ok: null, note: 'No monitor run recorded yet' });
  }

  const checks = Array.isArray(status.probes)
    ? status.probes.map((p) => ({ name: p.name, ok: !!p.ok }))
    : [];
  const body = { ok: !!status.ok, at: status.at, checks };
  return res.status(status.ok ? 200 : 503).json(body);
}
