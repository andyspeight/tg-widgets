/**
 * /api/identity/users/[id]
 *
 * GET    → single user with full permission list
 * PATCH  → update status (suspend/reactivate), fullName, plan, or notes
 * DELETE → delete user + all their permissions
 *
 * Auth: owner role on widget_suite
 *
 * NOTE: this file lives at api/identity/users/[id].js — Vercel's dynamic
 * route syntax. The folder structure matters: api/identity/users.js (the list
 * endpoint) and api/identity/users/[id].js (this file) coexist by design.
 */

import {
  T_USERS,
  T_PERMISSIONS,
  applyCors,
  requireOwner,
  airtableFetch,
} from '../../../lib/identity-helpers.js';

export default async function handler(req, res) {
  applyCors(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();

  const id = req.query.id;
  if (!id || !/^rec[A-Za-z0-9]{14}$/.test(id)) {
    return res.status(400).json({ ok: false, error: 'Invalid user id' });
  }

  const me = await requireOwner(req, res);
  if (!me) return;

  if (req.method === 'GET') return handleGet(req, res, id);
  if (req.method === 'PATCH') return handlePatch(req, res, id, me);
  if (req.method === 'DELETE') return handleDelete(req, res, id, me);

  return res.status(405).json({ ok: false, error: 'Method not allowed' });
}

async function handleGet(req, res, id) {
  try {
    const user = await airtableFetch(`${T_USERS}/${id}`);
    const permsRes = await airtableFetch(
      `${T_PERMISSIONS}?filterByFormula=${encodeURIComponent(`FIND('${id}', ARRAYJOIN({User}))`)}&maxRecords=100`
    );
    return res.status(200).json({
      ok: true,
      user: {
        recordId: user.id,
        email: user.fields.Email || '',
        fullName: user.fields.ClientName || '',
        clientCode: user.fields.ClientCode || '',
        plan: user.fields.Plan || '',
        status: user.fields.Status || 'Active',
        notes: user.fields.Notes || '',
      },
      permissions: (permsRes.records || []).map((p) => ({
        permissionId: p.id,
        productSlug: (p.fields['Product Slug'] || [])[0] || null,
        productName: (p.fields['Product Name'] || [])[0] || null,
        role: p.fields.Role || 'user',
        status: p.fields.Status || 'Active',
        expiresAt: p.fields['Expires At'] || null,
      })),
    });
  } catch (err) {
    if (err.status === 404) return res.status(404).json({ ok: false, error: 'User not found' });
    console.error('[identity/users/:id GET]', err);
    return res.status(500).json({ ok: false, error: 'Failed to load user' });
  }
}

async function handlePatch(req, res, id, me) {
  let body;
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  } catch {
    return res.status(400).json({ ok: false, error: 'Invalid JSON body' });
  }
  if (!body || typeof body !== 'object') {
    return res.status(400).json({ ok: false, error: 'Body required' });
  }

  if (body.status === 'Suspended' && id === me.recordId) {
    return res.status(400).json({ ok: false, error: "You can't suspend your own account" });
  }

  const fields = {};
  if (typeof body.status === 'string' && ['Active', 'Suspended'].includes(body.status)) {
    fields.Status = body.status;
  }
  if (typeof body.fullName === 'string' && body.fullName.trim().length >= 2) {
    fields.ClientName = body.fullName.trim();
  }
  if (typeof body.plan === 'string') {
    fields.Plan = body.plan.trim();
  }
  if (typeof body.notes === 'string') {
    fields.Notes = body.notes;
  }

  if (Object.keys(fields).length === 0) {
    return res.status(400).json({ ok: false, error: 'No valid fields to update' });
  }

  try {
    const updated = await airtableFetch(T_USERS, {
      method: 'PATCH',
      body: JSON.stringify({
        typecast: true,
        records: [{ id, fields }],
      }),
    });
    return res.status(200).json({ ok: true, user: { recordId: updated.records[0].id, ...updated.records[0].fields } });
  } catch (err) {
    console.error('[identity/users/:id PATCH]', err);
    return res.status(500).json({ ok: false, error: 'Failed to update user' });
  }
}

async function handleDelete(req, res, id, me) {
  if (id === me.recordId) {
    return res.status(400).json({ ok: false, error: "You can't delete your own account" });
  }
  try {
    const perms = await airtableFetch(
      `${T_PERMISSIONS}?filterByFormula=${encodeURIComponent(`FIND('${id}', ARRAYJOIN({User}))`)}&maxRecords=100`
    );
    const permIds = (perms.records || []).map((p) => p.id);
    if (permIds.length > 0) {
      const params = permIds.map((p) => `records[]=${encodeURIComponent(p)}`).join('&');
      await airtableFetch(`${T_PERMISSIONS}?${params}`, { method: 'DELETE' });
    }
    await airtableFetch(`${T_USERS}/${id}`, { method: 'DELETE' });
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[identity/users/:id DELETE]', err);
    return res.status(500).json({ ok: false, error: 'Failed to delete user' });
  }
}
