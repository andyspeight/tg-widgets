// =============================================================================
//  /api/cron/yesaware-reminders.js   (Vercel Cron)
// =============================================================================
//
//  Emails Andy a digest when YesAware items fall due: reminders whose DueAt has
//  passed, and sequence steps that are ready to send. Reminders are marked Fired
//  once the digest goes out, so each fires once. Sequence sends stay in the queue
//  until Andy sends them and advances the recipient.
//
//  AUTH: Authorization: Bearer ${CRON_SECRET} (same convention as the other crons).
//  Recipient: YESAWARE_OWNER_EMAIL (default andy.speight@agendas.group).
//
// =============================================================================

import { sendViaSendGrid, buildFromField } from '../_lib/sendgrid.js';

const AIRTABLE_API = 'https://api.airtable.com/v0';
const BASE = process.env.AIRTABLE_BASE_ID || 'appAYzWZxvK6qlwXK';
const REMINDERS = 'YesAware Reminders';
const SEQ = 'YesAware Sequences';
const RECIP = 'YesAware Sequence Recipients';
const OWNER = process.env.YESAWARE_OWNER_EMAIL || 'andy.speight@agendas.group';
const DASH = (process.env.YESAWARE_PUBLIC_ORIGIN || 'https://widgets.travelify.io').replace(/\/+$/, '') + '/yesaware';

function authHeaders() { return { Authorization: `Bearer ${process.env.AIRTABLE_KEY}`, 'Content-Type': 'application/json' }; }
function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

async function fetchAll(table, cap) {
  const out = []; let offset = '';
  for (let page = 0; page < 25 && out.length < cap; page++) {
    const url = new URL(`${AIRTABLE_API}/${BASE}/${encodeURIComponent(table)}`);
    url.searchParams.set('pageSize', '100');
    if (offset) url.searchParams.set('offset', offset);
    const r = await fetch(url, { headers: authHeaders() });
    if (!r.ok) break;
    const d = await r.json();
    for (const rec of d.records || []) out.push(rec);
    offset = d.offset || ''; if (!offset) break;
  }
  return out;
}

function digestHtml(dueRem, dueSeq) {
  const row = (t) => `<li style="margin:0 0 8px">${t}</li>`;
  let html = `<div style="font-family:Arial,Helvetica,sans-serif;color:#0F172A;max-width:560px">`;
  html += `<h2 style="font-size:18px;margin:0 0 4px">YesAware — things need you</h2>`;
  html += `<p style="color:#64748B;margin:0 0 16px">A quick nudge from your email tracker.</p>`;
  if (dueRem.length) {
    html += `<h3 style="font-size:14px;margin:16px 0 6px">Reminders (${dueRem.length})</h3><ul style="padding-left:18px;margin:0">`;
    html += dueRem.map((r) => row(esc((r.fields || {}).Note || 'Reminder'))).join('');
    html += `</ul>`;
  }
  if (dueSeq.length) {
    html += `<h3 style="font-size:14px;margin:16px 0 6px">Sequence sends ready (${dueSeq.length})</h3><ul style="padding-left:18px;margin:0">`;
    html += dueSeq.map((d) => row(`${esc(d.name)} &mdash; step ${d.step + 1} to <b>${esc(d.email)}</b>`)).join('');
    html += `</ul>`;
  }
  html += `<p style="margin:20px 0 0"><a href="${DASH}" style="display:inline-block;padding:10px 18px;border-radius:8px;background:#1B2B5B;color:#fff;font-weight:bold;text-decoration:none">Open YesAware</a></p>`;
  html += `</div>`;
  return html;
}

export default async function handler(req, res) {
  const auth = req.headers['authorization'] || '';
  const secret = process.env.CRON_SECRET || '';
  if (!secret || auth !== `Bearer ${secret}`) return res.status(401).json({ ok: false, error: 'unauthorised' });
  if (!process.env.AIRTABLE_KEY) return res.status(200).json({ ok: true, note: 'airtable not configured' });

  const now = Date.now();
  try {
    const remRecs = await fetchAll(REMINDERS, 1000);
    const dueRem = remRecs.filter((r) => { const f = r.fields || {}; return f.Status === 'pending' && !f.Fired && f.DueAt && (Date.parse(f.DueAt) || 0) <= now; });

    const [seqRecs, recRecs] = await Promise.all([fetchAll(SEQ, 300), fetchAll(RECIP, 3000)]);
    const seqById = {};
    seqRecs.forEach((s) => { const f = s.fields || {}; let steps = []; try { steps = JSON.parse(f.Steps || '[]'); } catch { steps = []; } seqById[s.id] = { name: f.Name || '', steps, status: f.Status || 'active' }; });
    const dueSeq = recRecs.filter((r) => {
      const f = r.fields || {};
      if (f.Status !== 'active') return false;
      const sq = seqById[f.SequenceId]; if (!sq || sq.status !== 'active') return false;
      if (!Array.isArray(sq.steps) || !sq.steps[Number(f.Step) || 0]) return false;
      return f.NextDueAt && (Date.parse(f.NextDueAt) || 0) <= now;
    }).map((r) => { const f = r.fields || {}; return { name: (seqById[f.SequenceId] || {}).name || 'Sequence', email: f.Email || '', step: Number(f.Step) || 0 }; });

    if (!dueRem.length && !dueSeq.length) return res.status(200).json({ ok: true, dueReminders: 0, dueSequenceSends: 0, emailed: false });

    let emailed = false;
    try {
      await sendViaSendGrid({
        to: OWNER,
        from: buildFromField('YesAware'),
        subject: `YesAware: ${dueRem.length + dueSeq.length} item(s) need you`,
        html: digestHtml(dueRem, dueSeq),
        categoryTag: 'yesaware',
      });
      emailed = true;
    } catch (e) { console.warn('[yesaware-reminders] email failed', e && e.message); }

    if (emailed) {
      for (const r of dueRem) {
        try { await fetch(`${AIRTABLE_API}/${BASE}/${encodeURIComponent(REMINDERS)}/${r.id}`, { method: 'PATCH', headers: authHeaders(), body: JSON.stringify({ fields: { Fired: true } }) }); } catch (e) { /* retry next run */ }
      }
    }
    return res.status(200).json({ ok: true, dueReminders: dueRem.length, dueSequenceSends: dueSeq.length, emailed });
  } catch (e) {
    console.error('[yesaware-reminders]', e && e.message);
    return res.status(500).json({ ok: false, error: 'run failed' });
  }
}
