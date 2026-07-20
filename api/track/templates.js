// =============================================================================
//  /api/track/templates.js   →   GET | POST | PATCH | DELETE /api/track/templates
// =============================================================================
//
//  YesAware email templates. ADMIN ONLY. CRUD over the YesAware Templates table.
//    GET               list templates (add ?stats=1 for per-template open/click
//                       usage; the extension picker uses the plain list).
//    POST   {name,subject,body}          create
//    PATCH  {id,name?,subject?,body?}     update
//    DELETE {id}                          delete
//
// =============================================================================

import { requireAdmin, setAdminCors } from '../admin/_guard.js';
import { applyRateLimit, RATE_LIMITS } from '../_auth.js';

const AIRTABLE_API = 'https://api.airtable.com/v0';
const BASE = process.env.AIRTABLE_BASE_ID || 'appAYzWZxvK6qlwXK';
const TEMPLATES = 'YesAware Templates';
const MESSAGES = 'YesAware Messages';
const EVENTS = 'YesAware Events';
const REC_RE = /^rec[A-Za-z0-9]{14}$/;

function authHeaders() {
  return { Authorization: `Bearer ${process.env.AIRTABLE_KEY}`, 'Content-Type': 'application/json' };
}

async function fetchAll(table, cap) {
  const out = [];
  let offset = '';
  for (let page = 0; page < 25 && out.length < cap; page++) {
    const url = new URL(`${AIRTABLE_API}/${BASE}/${encodeURIComponent(table)}`);
    url.searchParams.set('pageSize', '100');
    if (offset) url.searchParams.set('offset', offset);
    const r = await fetch(url, { headers: authHeaders() });
    if (!r.ok) break;
    const d = await r.json();
    for (const rec of d.records || []) out.push(rec);
    offset = d.offset || '';
    if (!offset) break;
  }
  return out;
}

function readBody(req) {
  let b = req.body;
  if (typeof b === 'string') { try { b = JSON.parse(b); } catch { b = {}; } }
  return b && typeof b === 'object' ? b : {};
}
const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');

function toTemplate(rec) {
  const f = rec.fields || {};
  return { id: rec.id, name: f.Name || '', subject: f.Subject || '', body: f.Body || '', created: Date.parse(rec.createdTime) || 0 };
}

export default async function handler(req, res) {
  setAdminCors(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();

  const gate = requireAdmin(req);
  if (gate.error) return res.status(gate.status).json({ error: gate.error });

  const rlKey = `yesaware-tpl:${gate.user.recordId || gate.user.clientId || 'anon'}`;
  const limit = req.method === 'GET' ? RATE_LIMITS.widgetRead : RATE_LIMITS.widgetWrite;
  if (!applyRateLimit(res, rlKey, limit)) return;

  if (!process.env.AIRTABLE_KEY) return res.status(500).json({ error: 'Server configuration error' });

  try {
    if (req.method === 'GET') return await list(req, res);
    if (req.method === 'POST') return await create(req, res);
    if (req.method === 'PATCH') return await update(req, res);
    if (req.method === 'DELETE') return await remove(req, res);
    res.setHeader('Allow', 'GET, POST, PATCH, DELETE');
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    console.error('[track/templates]', e && e.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function list(req, res) {
  const recs = await fetchAll(TEMPLATES, 500);
  const templates = recs.map(toTemplate).sort((a, b) => a.name.localeCompare(b.name));

  const wantStats = req.query && (req.query.stats === '1' || req.query.stats === 'true');
  if (wantStats) {
    const [msgRecs, evtRecs] = await Promise.all([fetchAll(MESSAGES, 2000), fetchAll(EVENTS, 3000)]);
    // token -> {opens, humanOpens, clicks}
    const byToken = new Map();
    for (const e of evtRecs) {
      const f = e.fields || {}; const t = f.Token; if (!t) continue;
      let g = byToken.get(t); if (!g) { g = { opens: 0, humanOpens: 0, clicks: 0 }; byToken.set(t, g); }
      if (f.Type === 'open') { g.opens++; if (f.Source === 'direct') g.humanOpens++; } else if (f.Type === 'click') g.clicks++;
    }
    // templateId -> aggregate
    const byTpl = new Map();
    for (const m of msgRecs) {
      const f = m.fields || {}; const tid = f.TemplateId; if (!tid) continue;
      let a = byTpl.get(tid); if (!a) { a = { uses: 0, opens: 0, humanOpens: 0, clicks: 0 }; byTpl.set(tid, a); }
      a.uses++;
      const g = byToken.get(f.Token); if (g) { a.opens += g.opens; a.humanOpens += g.humanOpens; a.clicks += g.clicks; }
    }
    templates.forEach((t) => { const a = byTpl.get(t.id) || { uses: 0, opens: 0, humanOpens: 0, clicks: 0 }; t.stats = a; });
  }

  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({ ok: true, templates });
}

async function create(req, res) {
  const b = readBody(req);
  const name = str(b.name, 120).trim();
  if (!name) return res.status(400).json({ error: 'A template name is required' });
  const fields = { Name: name, Subject: str(b.subject, 300), Body: str(b.body, 20000) };
  const r = await fetch(`${AIRTABLE_API}/${BASE}/${encodeURIComponent(TEMPLATES)}`, {
    method: 'POST', headers: authHeaders(), body: JSON.stringify({ records: [{ fields }] }),
  });
  if (!r.ok) { console.warn('[track/templates] create non-2xx', r.status); return res.status(502).json({ error: 'Could not save template' }); }
  const d = await r.json();
  return res.status(200).json({ ok: true, template: toTemplate(d.records[0]) });
}

async function update(req, res) {
  const b = readBody(req);
  if (!REC_RE.test(b.id || '')) return res.status(400).json({ error: 'Invalid template id' });
  const fields = {};
  if (typeof b.name === 'string') { const n = str(b.name, 120).trim(); if (!n) return res.status(400).json({ error: 'Name cannot be empty' }); fields.Name = n; }
  if (typeof b.subject === 'string') fields.Subject = str(b.subject, 300);
  if (typeof b.body === 'string') fields.Body = str(b.body, 20000);
  if (!Object.keys(fields).length) return res.status(400).json({ error: 'Nothing to update' });
  const r = await fetch(`${AIRTABLE_API}/${BASE}/${encodeURIComponent(TEMPLATES)}/${b.id}`, {
    method: 'PATCH', headers: authHeaders(), body: JSON.stringify({ fields }),
  });
  if (!r.ok) { console.warn('[track/templates] update non-2xx', r.status); return res.status(502).json({ error: 'Could not update template' }); }
  const d = await r.json();
  return res.status(200).json({ ok: true, template: toTemplate(d) });
}

async function remove(req, res) {
  const b = readBody(req);
  if (!REC_RE.test(b.id || '')) return res.status(400).json({ error: 'Invalid template id' });
  const r = await fetch(`${AIRTABLE_API}/${BASE}/${encodeURIComponent(TEMPLATES)}/${b.id}`, {
    method: 'DELETE', headers: authHeaders(),
  });
  if (!r.ok) { console.warn('[track/templates] delete non-2xx', r.status); return res.status(502).json({ error: 'Could not delete template' }); }
  return res.status(200).json({ ok: true, id: b.id });
}
