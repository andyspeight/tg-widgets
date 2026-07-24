/**
 * POST/GET /api/cron/monitor  — the synthetic "robot client".
 *
 * Runs every few minutes (vercel.json cron). It exercises the real user-facing
 * paths (the offers proxy end-to-end, the widget-config endpoint), checks the
 * dependency backbone (Redis) and confirms every required setting is present,
 * then:
 *   - stores the latest result in Redis for /api/status to read,
 *   - emails a de-duplicated alert when a check STARTS failing (at most one per
 *     check / 30 min), and a one-off "recovered" note when it comes back.
 *
 * This is what flips "the client tells us" into "we already knew" — we hear
 * about a break from our own robot, ahead of any client.
 *
 * Auth: Vercel sends `Authorization: Bearer ${CRON_SECRET}` on cron invocations.
 */
import { runAllProbes } from '../_lib/monitor/probes.js';
import { getJson, setJson, setNxEx } from '../_redis.js';
import { sendViaSendGrid, buildFromField } from '../_lib/sendgrid.js';

const SELF_ORIGIN = process.env.MONITOR_ORIGIN || 'https://tg-widgets.vercel.app';
const STATUS_KEY = 'monitor:status:v1';
const ALERT_TTL_SECONDS = 1800; // re-alert a still-failing check at most every 30 min
const HEARTBEAT_KEY = 'monitor:heartbeat:v1';
const HEARTBEAT_TTL_SECONDS = 60 * 60 * 24 * 30; // one "monitor is live" note per 30 days max

export default async function handler(req, res) {
  const auth = req.headers['authorization'] || '';
  const secret = process.env.CRON_SECRET || '';
  if (!secret || auth !== `Bearer ${secret}`) {
    return res.status(401).json({ ok: false, error: 'unauthorised' });
  }

  const at = new Date().toISOString();

  let probes;
  try {
    probes = await runAllProbes({ selfOrigin: SELF_ORIGIN, secret });
  } catch (e) {
    // A thrown probe run is itself a failure worth surfacing, never a silent skip.
    probes = [{ name: 'monitor', ok: false, detail: 'probe run threw: ' + (e && e.message), latencyMs: 0 }];
  }

  const failing = probes.filter((p) => !p.ok);
  const overallOk = failing.length === 0;

  // Previous run — for recovery detection.
  let prev = null;
  try { prev = await getJson(STATUS_KEY); } catch { prev = null; }
  const prevOk = {};
  if (prev && Array.isArray(prev.probes)) prev.probes.forEach((p) => { prevOk[p.name] = p.ok; });

  // Persist current status for /api/status (best-effort).
  try { await setJson(STATUS_KEY, { at, ok: overallOk, probes }); } catch (e) { console.error('[monitor] status store failed', e && e.message); }

  // Alerts: a check that is failing (deduped 30 min), and any that just recovered.
  let alerted = 0;
  for (const f of failing) {
    let first = false;
    try { first = await setNxEx('monitor:alert:' + f.name, at, ALERT_TTL_SECONDS); } catch { first = true; }
    if (first) { await safeAlert('fail', f, at); alerted++; }
  }
  for (const p of probes) {
    if (p.ok && prevOk[p.name] === false) { await safeAlert('recovered', p, at); alerted++; }
  }

  // One-time "monitor is live" confirmation — sent on the first run after the
  // system is switched on (or at most once per 30 days), so we can prove the
  // whole alert path reaches the inbox without waiting for a real outage.
  let firstEver = false;
  try { firstEver = await setNxEx(HEARTBEAT_KEY, at, HEARTBEAT_TTL_SECONDS); } catch { firstEver = false; }
  if (firstEver) {
    const summary = probes.map((p) => p.name + '=' + (p.ok ? 'ok' : 'FAIL')).join(', ');
    await safeAlert('live', { name: 'startup', detail: (overallOk ? 'all healthy — ' : 'DEGRADED — ') + summary }, at);
    alerted++;
  }

  console.log('[monitor]', overallOk ? 'all healthy' : 'DEGRADED', '|', probes.map((p) => p.name + '=' + (p.ok ? 'ok' : 'FAIL')).join(' '));
  return res.status(200).json({ ok: overallOk, at, probes, alerted });
}

async function safeAlert(kind, probe, at) {
  try { await sendMonitorAlert(kind, probe, at); }
  catch (e) { console.error('[monitor] alert send failed', e && e.message); }
}

async function sendMonitorAlert(kind, probe, at) {
  if (!process.env.SENDGRID_API_KEY || !process.env.SENDGRID_FROM_EMAIL) return;
  const to = process.env.WIDGET_ALERT_EMAIL || process.env.ALERT_EMAIL || 'andy.speight@agendas.group';
  const recovered = kind === 'recovered';
  const live = kind === 'live';
  const esc = (s) => String(s || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const row = (k, v) => '<tr><td style="padding:3px 12px 3px 0;color:#64748b;vertical-align:top">' + esc(k) + '</td><td style="padding:3px 0"><b>' + esc(v) + '</b></td></tr>';
  const lead = live
    ? 'Your early-warning monitor is now live. This is a one-time confirmation that alerts reach this inbox — you will not get this note again. From now on you only hear from the monitor when a check starts failing, or recovers.'
    : (recovered
      ? 'A monitored check has recovered — the platform is healthy again.'
      : 'Our own monitor found a problem, ahead of any client report. A platform check is failing.');
  const statusText = live ? 'LIVE' : (recovered ? 'OK' : 'FAILING');
  const html =
    '<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;font-size:14px;color:#0f172a;line-height:1.5">' +
    '<p style="margin:0 0 12px">' + esc(lead) + '</p>' +
    '<table style="border-collapse:collapse;font-size:13px">' +
    row(live ? 'Monitor' : 'Check', probe.name) +
    row('Status', statusText) +
    row('Detail', probe.detail || '—') +
    row('When', at) +
    '</table>' +
    (live
      ? '<p style="margin:14px 0 0;color:#94a3b8;font-size:12px">Live status any time at /api/status.</p>'
      : (recovered ? '' : '<p style="margin:14px 0 0;color:#94a3b8;font-size:12px">You will not get another alert for this check for 30 minutes. Live status is at /api/status.</p>'));
  const subject = live
    ? 'Travelgenix Monitor is live'
    : (recovered ? 'Recovered: ' : 'Monitor alert: ') + probe.name + (recovered ? ' is healthy again' : ' is failing');
  await sendViaSendGrid({
    to,
    from: buildFromField('Travelgenix Monitor'),
    subject,
    html: html + '</div>',
  });
}
