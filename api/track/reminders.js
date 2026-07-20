// =============================================================================
//  /api/track/reminders.js   →   GET | POST | PATCH | DELETE
// =============================================================================
//
//  YesAware follow-up reminders and send-later nudges. ADMIN ONLY.
//    GET                       list (pending first, by due date)
//    POST   {note,dueAt,token?} create
//    PATCH  {id,status?,dueAt?} complete or snooze
//    DELETE {id}               delete
//
//  A reminder is a time-based nudge. The cron /api/cron/yesaware-reminders emails
//  Andy a digest when reminders fall due. "Send later" is just a reminder whose
//  note says to send something — Gmail's native Schedule send does the delivery.
//
// =============================================================================

import { requireAdmin, setAdminCors } from '../admin/_guard.js';
import { applyRateLimit, RATE_LIMITS } from '../_auth.js';

const AIRTABLE_API = 'https://api.airtable.com/v0';
const BASE = process.env.AIRTABLE_BASE_ID || 'appAYzWZxvK6qlwXK';
const TABLE = 'YesAware Reminders';
const REC_RE = /^rec[A-Za-z0-9]{14}$/;
const TOKEN_RE = /^[A-Za-z0-9]{8,64}$/;

function authHeaders() { return { Authorization: `Bearer ${process.env.AIRTABLE_KEY}`, 'Content-Type': 'application/json' }; }

async function fetchAll(cap) {
  const out = []; let offset = '';
  for (let page = 0; page < 15 && out.length < cap; page++) {
    const url = new URL(`${AIRTABLE_API}/${BASE}/${encodeURIComponent(TABLE)}`);
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

function readBody(req) { let b = req.body; if (typeof b === 'string') { try { b = JSON.parse(b); } catch { b = {}; } } return b && typeof b === 'object' ? b : {}; }
function toReminder(rec) {
  const f = rec.fields || {};
  return { id: rec.id, note: f.Note || '', dueAt: f.DueAt || '', token: f.Token || '', status: f.Status || 'pending', fired: !!f.Fired, created: Date.parse(rec.createdTime) || 0 };
}

export default async function handler(req, res) {
  setAdminCors(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  const gate = requireAdmin(req);
  if (gate.error) return res.status(gate.status).json({ error: gate.error });
  const rlKey = `ya-rem:${gate.user.recordId || gate.user.clientId || 'anon'}`;
  if (!applyRateLimit(res, rlKey, req.method === 'GET' ? RATE_LIMITS.widgetRead : RATE_LIMITS.widgetWrite)) return;
  if (!process.env.AIRTABLE_KEY) return res.status(500).json({ error: 'Server configuration error' });

  try {
    if (req.method === 'GET') return await list(res);
    if (req.method === 'POST') return await create(req, res);
    if (req.method === 'PATCH') return await update(req, res);
    if (req.method === 'DELETE') return await remove(req, res);
    res.setHeader('Allow', 'GET, POST, PATCH, DELETE');
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) { console.error('[track/reminders]', e && e.message); return res.status(500).json({ error: 'Internal server error' }); }
}

async function list(res) {
  const recs = await fetchAll(1000);
  const reminders = recs.map(toReminder).sort((a, b) => {
    if (a.status !== b.status) return a.status === 'pending' ? -1 : 1;
    return (Date.parse(a.dueAt) || 0) - (Date.parse(b.dueAt) || 0);
  });
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({ ok: true, reminders });
}

async function create(req, res) {
  const b = readBody(req);
  const note = (typeof b.note === 'string' ? b.note : '').slice(0, 200).trim();
  if (!note) return res.status(400).json({ error: 'A note is required' });
  const dueAt = typeof b.dueAt === 'string' ? b.dueAt : '';
  if (!dueAt || isNaN(Date.parse(dueAt))) return res.status(400).json({ error: 'A valid due date and time is required' });
  const token = (typeof b.token === 'string' && TOKEN_RE.test(b.token)) ? b.token : '';
  const fields = { Note: note, DueAt: new Date(dueAt).toISOString(), Status: 'pending', ...(token ? { Token: token } : {}) };
  const r = await fetch(`${AIRTABLE_API}/${BASE}/${encodeURIComponent(TABLE)}`, { method: 'POST', headers: authHeaders(), body: JSON.stringify({ records: [{ fields }] }) });
  if (!r.ok) { console.warn('[track/reminders] create', r.status); return res.status(502).json({ error: 'Could not save reminder' }); }
  const d = await r.json();
  return res.status(200).json({ ok: true, reminder: toReminder(d.records[0]) });
}

async function update(req, res) {
  const b = readBody(req);
  if (!REC_RE.test(b.id || '')) return res.status(400).json({ error: 'Invalid id' });
  const fields = {};
  if (b.status === 'done' || b.status === 'pending') fields.Status = b.status;
  if (typeof b.dueAt === 'string' && !isNaN(Date.parse(b.dueAt))) { fields.DueAt = new Date(b.dueAt).toISOString(); fields.Fired = false; }
  if (!Object.keys(fields).length) return res.status(400).json({ error: 'Nothing to update' });
  const r = await fetch(`${AIRTABLE_API}/${BASE}/${encodeURIComponent(TABLE)}/${b.id}`, { method: 'PATCH', headers: authHeaders(), body: JSON.stringify({ fields }) });
  if (!r.ok) { console.warn('[track/reminders] update', r.status); return res.status(502).json({ error: 'Could not update reminder' }); }
  const d = await r.json();
  return res.status(200).json({ ok: true, reminder: toReminder(d) });
}

async function remove(req, res) {
  const b = readBody(req);
  if (!REC_RE.test(b.id || '')) return res.status(400).json({ error: 'Invalid id' });
  const r = await fetch(`${AIRTABLE_API}/${BASE}/${encodeURIComponent(TABLE)}/${b.id}`, { method: 'DELETE', headers: authHeaders() });
  if (!r.ok) { console.warn('[track/reminders] delete', r.status); return res.status(502).json({ error: 'Could not delete reminder' }); }
  return res.status(200).json({ ok: true, id: b.id });
}
