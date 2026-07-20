// =============================================================================
//  /api/track/sequences.js   →   GET | POST | DELETE
// =============================================================================
//
//  YesAware outreach sequences (mail merge). ADMIN ONLY.
//
//  IMPORTANT: YesAware does not send email itself — that would need the Gmail
//  OAuth/CASA regime we deliberately avoided. A sequence PLANS the sends and the
//  cron/dashboard surface a "due queue" of what to send now; you send those in
//  Gmail (the extension can insert the step, and Track stamps it). After you send
//  a step you call action 'advance' to schedule the next one.
//
//    GET                          list sequences (+ active recipient counts)
//    GET ?due=1                   the due queue: personalised steps ready to send
//    POST {action:'create-sequence', name, steps:[{delayDays,subject,body}]}
//    POST {action:'enroll', sequenceId, recipients:[{email,name}]}
//    POST {action:'advance', recipientId}     mark current step sent, schedule next
//    POST {action:'pause-sequence'|'resume-sequence', id}
//    DELETE {id}                  delete a sequence
//
// =============================================================================

import { requireAdmin, setAdminCors } from '../admin/_guard.js';
import { applyRateLimit, RATE_LIMITS } from '../_auth.js';

const AIRTABLE_API = 'https://api.airtable.com/v0';
const BASE = process.env.AIRTABLE_BASE_ID || 'appAYzWZxvK6qlwXK';
const SEQ = 'YesAware Sequences';
const RECIP = 'YesAware Sequence Recipients';
const REC_RE = /^rec[A-Za-z0-9]{14}$/;

function authHeaders() { return { Authorization: `Bearer ${process.env.AIRTABLE_KEY}`, 'Content-Type': 'application/json' }; }
function readBody(req) { let b = req.body; if (typeof b === 'string') { try { b = JSON.parse(b); } catch { b = {}; } } return b && typeof b === 'object' ? b : {}; }
const isEmail = (s) => typeof s === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) && s.length <= 254;

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
async function getOne(table, id) { const r = await fetch(`${AIRTABLE_API}/${BASE}/${encodeURIComponent(table)}/${id}`, { headers: authHeaders() }); return r.ok ? r.json() : null; }

function parseSteps(raw) { try { const p = JSON.parse(raw || '[]'); return Array.isArray(p) ? p : []; } catch { return []; } }
function cleanSteps(steps) {
  return (Array.isArray(steps) ? steps : []).slice(0, 20).map((s) => ({
    delayDays: Math.max(0, Math.min(365, Number(s && s.delayDays) || 0)),
    subject: (typeof (s && s.subject) === 'string' ? s.subject : '').slice(0, 300),
    body: (typeof (s && s.body) === 'string' ? s.body : '').slice(0, 20000),
  })).filter((s) => s.subject || s.body);
}
function personalize(text, name) { return String(text || '').replace(/\{\{\s*name\s*\}\}/gi, name || 'there'); }

export default async function handler(req, res) {
  setAdminCors(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  const gate = requireAdmin(req);
  if (gate.error) return res.status(gate.status).json({ error: gate.error });
  const rlKey = `ya-seq:${gate.user.recordId || gate.user.clientId || 'anon'}`;
  if (!applyRateLimit(res, rlKey, req.method === 'GET' ? RATE_LIMITS.widgetRead : RATE_LIMITS.widgetWrite)) return;
  if (!process.env.AIRTABLE_KEY) return res.status(500).json({ error: 'Server configuration error' });

  try {
    if (req.method === 'GET') return await get(req, res);
    if (req.method === 'POST') return await post(req, res);
    if (req.method === 'DELETE') return await del(req, res);
    res.setHeader('Allow', 'GET, POST, DELETE');
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) { console.error('[track/sequences]', e && e.message); return res.status(500).json({ error: 'Internal server error' }); }
}

async function get(req, res) {
  if (req.query && (req.query.due === '1' || req.query.due === 'true')) return await dueQueue(res);
  const [seqRecs, recRecs] = await Promise.all([fetchAll(SEQ, 300), fetchAll(RECIP, 3000)]);
  const counts = {};
  recRecs.forEach((r) => { const f = r.fields || {}; if (f.Status === 'active') counts[f.SequenceId] = (counts[f.SequenceId] || 0) + 1; });
  const sequences = seqRecs.map((s) => {
    const f = s.fields || {};
    return { id: s.id, name: f.Name || '', steps: parseSteps(f.Steps), status: f.Status || 'active', activeRecipients: counts[s.id] || 0 };
  }).sort((a, b) => a.name.localeCompare(b.name));
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({ ok: true, sequences });
}

async function dueQueue(res) {
  const [seqRecs, recRecs] = await Promise.all([fetchAll(SEQ, 300), fetchAll(RECIP, 3000)]);
  const seqById = {};
  seqRecs.forEach((s) => { const f = s.fields || {}; seqById[s.id] = { name: f.Name || '', steps: parseSteps(f.Steps), status: f.Status || 'active' }; });
  const now = Date.now();
  const due = [];
  for (const r of recRecs) {
    const f = r.fields || {};
    if (f.Status !== 'active') continue;
    const seq = seqById[f.SequenceId];
    if (!seq || seq.status !== 'active') continue;
    const stepIdx = Number(f.Step) || 0;
    const step = seq.steps[stepIdx];
    if (!step) continue;
    if (!f.NextDueAt || (Date.parse(f.NextDueAt) || 0) > now) continue;
    due.push({
      recipientId: r.id, sequenceId: f.SequenceId, sequenceName: seq.name,
      email: f.Email || '', name: f.Name || '', step: stepIdx, totalSteps: seq.steps.length,
      subject: personalize(step.subject, f.Name), body: personalize(step.body, f.Name), dueAt: f.NextDueAt || '',
    });
  }
  due.sort((a, b) => (Date.parse(a.dueAt) || 0) - (Date.parse(b.dueAt) || 0));
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({ ok: true, due });
}

async function post(req, res) {
  const b = readBody(req);
  switch (b.action) {
    case 'create-sequence': {
      const name = (typeof b.name === 'string' ? b.name : '').slice(0, 120).trim();
      if (!name) return res.status(400).json({ error: 'A sequence name is required' });
      const steps = cleanSteps(b.steps);
      if (!steps.length) return res.status(400).json({ error: 'Add at least one step with a subject or body' });
      const r = await fetch(`${AIRTABLE_API}/${BASE}/${encodeURIComponent(SEQ)}`, { method: 'POST', headers: authHeaders(), body: JSON.stringify({ records: [{ fields: { Name: name, Steps: JSON.stringify(steps), Status: 'active' } }] }) });
      if (!r.ok) return res.status(502).json({ error: 'Could not save sequence' });
      const d = await r.json();
      const s = d.records[0];
      return res.status(200).json({ ok: true, sequence: { id: s.id, name, steps, status: 'active', activeRecipients: 0 } });
    }
    case 'enroll': {
      if (!REC_RE.test(b.sequenceId || '')) return res.status(400).json({ error: 'Invalid sequence id' });
      const list = (Array.isArray(b.recipients) ? b.recipients : []).slice(0, 200)
        .map((x) => ({ email: typeof (x && x.email) === 'string' ? x.email.trim() : '', name: typeof (x && x.name) === 'string' ? x.name.slice(0, 120) : '' }))
        .filter((x) => isEmail(x.email));
      if (!list.length) return res.status(400).json({ error: 'No valid recipient emails' });
      const nowIso = new Date().toISOString();
      const records = list.map((x) => ({ fields: { Email: x.email, Name: x.name, SequenceId: b.sequenceId, Step: 0, NextDueAt: nowIso, Status: 'active' } }));
      let enrolled = 0;
      for (let i = 0; i < records.length; i += 10) {
        const r = await fetch(`${AIRTABLE_API}/${BASE}/${encodeURIComponent(RECIP)}`, { method: 'POST', headers: authHeaders(), body: JSON.stringify({ records: records.slice(i, i + 10) }) });
        if (r.ok) { const d = await r.json(); enrolled += (d.records || []).length; }
      }
      return res.status(200).json({ ok: true, enrolled });
    }
    case 'advance': {
      if (!REC_RE.test(b.recipientId || '')) return res.status(400).json({ error: 'Invalid recipient id' });
      const rec = await getOne(RECIP, b.recipientId);
      if (!rec) return res.status(404).json({ error: 'Recipient not found' });
      const rf = rec.fields || {};
      const seq = await getOne(SEQ, rf.SequenceId);
      const steps = seq ? parseSteps((seq.fields || {}).Steps) : [];
      const nextStep = (Number(rf.Step) || 0) + 1;
      let fields;
      if (nextStep >= steps.length) fields = { Step: nextStep, Status: 'done' };
      else fields = { Step: nextStep, NextDueAt: new Date(Date.now() + Math.max(0, Number(steps[nextStep].delayDays) || 0) * 86400000).toISOString(), Status: 'active' };
      const pr = await fetch(`${AIRTABLE_API}/${BASE}/${encodeURIComponent(RECIP)}/${b.recipientId}`, { method: 'PATCH', headers: authHeaders(), body: JSON.stringify({ fields }) });
      if (!pr.ok) return res.status(502).json({ error: 'Could not advance recipient' });
      return res.status(200).json({ ok: true, done: fields.Status === 'done', step: nextStep });
    }
    case 'pause-sequence':
    case 'resume-sequence': {
      if (!REC_RE.test(b.id || '')) return res.status(400).json({ error: 'Invalid sequence id' });
      const status = b.action === 'pause-sequence' ? 'paused' : 'active';
      const r = await fetch(`${AIRTABLE_API}/${BASE}/${encodeURIComponent(SEQ)}/${b.id}`, { method: 'PATCH', headers: authHeaders(), body: JSON.stringify({ fields: { Status: status } }) });
      if (!r.ok) return res.status(502).json({ error: 'Could not update sequence' });
      return res.status(200).json({ ok: true, status });
    }
    default:
      return res.status(400).json({ error: 'Unknown action' });
  }
}

async function del(req, res) {
  const b = readBody(req);
  if (!REC_RE.test(b.id || '')) return res.status(400).json({ error: 'Invalid id' });
  const r = await fetch(`${AIRTABLE_API}/${BASE}/${encodeURIComponent(SEQ)}/${b.id}`, { method: 'DELETE', headers: authHeaders() });
  if (!r.ok) return res.status(502).json({ error: 'Could not delete sequence' });
  return res.status(200).json({ ok: true, id: b.id });
}
