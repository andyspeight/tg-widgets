/**
 * /api/identity/permissions
 *
 * POST    → grant a permission: { userId, productSlug, role, expiresAt? }
 * PATCH   → change a permission: { permissionId, role?, status?, expiresAt? }
 * DELETE  → revoke a permission: ?id=recXXX
 *
 * Auth: owner role on widget_suite
 */

import {
  T_PRODUCTS,
  T_PERMISSIONS,
  applyCors,
  requireOwner,
  airtableFetch,
} from '../../lib/identity-helpers.js';

const ALLOWED_ROLES = ['owner', 'admin', 'user', 'agent'];
const ALLOWED_STATUSES = ['Active', 'Suspended'];

export default async function handler(req, res) {
  applyCors(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();

  const me = await requireOwner(req, res);
  if (!me) return;

  if (req.method === 'POST') return handleGrant(req, res);
  if (req.method === 'PATCH') return handleUpdate(req, res);
  if (req.method === 'DELETE') return handleRevoke(req, res);

  return res.status(405).json({ ok: false, error: 'Method not allowed' });
}

async function handleGrant(req, res) {
  let body;
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  } catch {
    return res.status(400).json({ ok: false, error: 'Invalid JSON body' });
  }
  if (!body || typeof body !== 'object') {
    return res.status(400).json({ ok: false, error: 'Body required' });
  }

  const userId = String(body.userId || '');
  const productSlug = String(body.productSlug || '');
  const role = String(body.role || 'user').toLowerCase();
  const expiresAt = body.expiresAt ? String(body.expiresAt) : null;

  if (!/^rec[A-Za-z0-9]{14}$/.test(userId)) {
    return res.status(400).json({ ok: false, error: 'Invalid userId' });
  }
  if (!productSlug) {
    return res.status(400).json({ ok: false, error: 'productSlug required' });
  }
  if (!ALLOWED_ROLES.includes(role)) {
    return res.status(400).json({ ok: false, error: 'Invalid role' });
  }

  try {
    const productsRes = await airtableFetch(
      `${T_PRODUCTS}?filterByFormula=${encodeURIComponent(`OR({Slug}='${productSlug}',{Product Slug}='${productSlug}')`)}&maxRecords=1`
    );
    const product = (productsRes.records || [])[0];
    if (!product) {
      return res.status(400).json({ ok: false, error: `Unknown product: ${productSlug}` });
    }

    const existing = await airtableFetch(
      `${T_PERMISSIONS}?filterByFormula=${encodeURIComponent(
        `AND(FIND('${userId}', ARRAYJOIN({User})), FIND('${product.id}', ARRAYJOIN({Product})))`
      )}&maxRecords=1`
    );
    if (existing.records && existing.records.length > 0) {
      return res.status(409).json({
        ok: false,
        error: 'User already has a permission for this product',
        permissionId: existing.records[0].id,
      });
    }

    const fields = {
      User: [userId],
      Product: [product.id],
      Role: role,
      Status: 'Active',
    };
    if (expiresAt) fields['Expires At'] = expiresAt;

    const created = await airtableFetch(T_PERMISSIONS, {
      method: 'POST',
      body: JSON.stringify({ typecast: true, records: [{ fields }] }),
    });
    return res.status(201).json({ ok: true, permissionId: created.records[0].id });
  } catch (err) {
    console.error('[identity/permissions POST]', err);
    return res.status(500).json({ ok: false, error: 'Failed to grant permission' });
  }
}

async function handleUpdate(req, res) {
  let body;
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  } catch {
    return res.status(400).json({ ok: false, error: 'Invalid JSON body' });
  }
  if (!body || typeof body !== 'object') {
    return res.status(400).json({ ok: false, error: 'Body required' });
  }

  const id = String(body.permissionId || '');
  if (!/^rec[A-Za-z0-9]{14}$/.test(id)) {
    return res.status(400).json({ ok: false, error: 'Invalid permissionId' });
  }

  const fields = {};
  if (body.role && ALLOWED_ROLES.includes(String(body.role).toLowerCase())) {
    fields.Role = String(body.role).toLowerCase();
  }
  if (body.status && ALLOWED_STATUSES.includes(body.status)) {
    fields.Status = body.status;
  }
  if (body.expiresAt === null) {
    fields['Expires At'] = null;
  } else if (typeof body.expiresAt === 'string') {
    fields['Expires At'] = body.expiresAt;
  }

  if (Object.keys(fields).length === 0) {
    return res.status(400).json({ ok: false, error: 'No valid fields to update' });
  }

  try {
    const updated = await airtableFetch(T_PERMISSIONS, {
      method: 'PATCH',
      body: JSON.stringify({ typecast: true, records: [{ id, fields }] }),
    });
    return res.status(200).json({ ok: true, permissionId: updated.records[0].id });
  } catch (err) {
    console.error('[identity/permissions PATCH]', err);
    return res.status(500).json({ ok: false, error: 'Failed to update permission' });
  }
}

async function handleRevoke(req, res) {
  const id = String(req.query.id || '');
  if (!/^rec[A-Za-z0-9]{14}$/.test(id)) {
    return res.status(400).json({ ok: false, error: 'Invalid permission id' });
  }
  try {
    await airtableFetch(`${T_PERMISSIONS}/${id}`, { method: 'DELETE' });
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[identity/permissions DELETE]', err);
    return res.status(500).json({ ok: false, error: 'Failed to revoke permission' });
  }
}
