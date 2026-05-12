/**
 * /api/identity/users
 *
 * GET   → list all users with their permission summary
 * POST  → create a new staff/user record, optionally grant permissions, optionally email
 *
 * Auth: owner role on widget_suite (enforced by requireOwner)
 */

import {
  T_USERS,
  T_PRODUCTS,
  T_PERMISSIONS,
  applyCors,
  requireOwner,
  airtableFetch,
  generateClientCode,
  sendWelcomeEmail,
} from '../../lib/identity-helpers.js';

export default async function handler(req, res) {
  applyCors(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();

  if (req.method === 'GET') return handleList(req, res);
  if (req.method === 'POST') return handleCreate(req, res);

  return res.status(405).json({ ok: false, error: 'Method not allowed' });
}

// ---------- GET /api/identity/users ----------
async function handleList(req, res) {
  const me = await requireOwner(req, res);
  if (!me) return;

  try {
    const usersRes = await airtableFetch(`${T_USERS}?pageSize=100`);
    const permsRes = await airtableFetch(`${T_PERMISSIONS}?pageSize=100`);

    const permsByUser = {};
    for (const p of permsRes.records || []) {
      const userIds = p.fields.User || [];
      const productSlugs = p.fields['Product Slug'] || [];
      const productNames = p.fields['Product Name'] || [];
      for (const uid of userIds) {
        if (!permsByUser[uid]) permsByUser[uid] = [];
        permsByUser[uid].push({
          permissionId: p.id,
          productSlug: productSlugs[0] || null,
          productName: productNames[0] || null,
          role: p.fields.Role || 'user',
          status: p.fields.Status || 'Active',
          expiresAt: p.fields['Expires At'] || null,
        });
      }
    }

    const users = (usersRes.records || []).map((u) => ({
      recordId: u.id,
      email: u.fields.Email || '',
      fullName: u.fields.ClientName || '',
      clientCode: u.fields.ClientCode || '',
      plan: u.fields.Plan || '',
      status: u.fields.Status || 'Active',
      lastLogin: u.fields.LastLogin || null,
      createdAt: u.fields.CreatedAt || u.createdTime || null,
      notes: u.fields.Notes || '',
      permissions: permsByUser[u.id] || [],
    }));

    users.sort((a, b) => {
      if (a.status !== b.status) return a.status === 'Active' ? -1 : 1;
      return (a.fullName || '').localeCompare(b.fullName || '');
    });

    return res.status(200).json({ ok: true, users });
  } catch (err) {
    console.error('[identity/users GET]', err);
    return res.status(500).json({ ok: false, error: 'Failed to load users' });
  }
}

// ---------- POST /api/identity/users ----------
async function handleCreate(req, res) {
  const me = await requireOwner(req, res);
  if (!me) return;

  let body;
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  } catch {
    return res.status(400).json({ ok: false, error: 'Invalid JSON body' });
  }
  if (!body || typeof body !== 'object') {
    return res.status(400).json({ ok: false, error: 'Body required' });
  }

  const email = String(body.email || '').trim().toLowerCase();
  const fullName = String(body.fullName || '').trim();
  const plan = String(body.plan || 'Bespoke').trim();
  const role = String(body.role || 'user').trim().toLowerCase();
  const productSlugs = Array.isArray(body.productSlugs) ? body.productSlugs.map(String) : [];
  const sendEmail = body.sendEmail !== false;

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ ok: false, error: 'Invalid email address' });
  }
  if (fullName.length < 2 || fullName.length > 100) {
    return res.status(400).json({ ok: false, error: 'Full name is required (2–100 chars)' });
  }
  if (!['owner', 'admin', 'user', 'agent'].includes(role)) {
    return res.status(400).json({ ok: false, error: 'Invalid role' });
  }
  if (productSlugs.length === 0) {
    return res.status(400).json({ ok: false, error: 'At least one product must be granted' });
  }

  try {
    const existing = await airtableFetch(
      `${T_USERS}?filterByFormula=${encodeURIComponent(`LOWER({Email})='${email}'`)}&maxRecords=1`
    );
    if (existing.records && existing.records.length > 0) {
      return res.status(409).json({ ok: false, error: 'A user with this email already exists' });
    }

    const productsRes = await airtableFetch(`${T_PRODUCTS}?pageSize=100`);
    const productsBySlug = {};
    for (const p of productsRes.records || []) {
      const slug = (p.fields.Slug || p.fields['Product Slug'] || '').toString();
      if (slug) productsBySlug[slug] = { recordId: p.id, name: p.fields.Name || slug };
    }
    const resolvedProducts = [];
    for (const slug of productSlugs) {
      const match = productsBySlug[slug];
      if (!match) {
        return res.status(400).json({ ok: false, error: `Unknown product: ${slug}` });
      }
      resolvedProducts.push({ slug, ...match });
    }

    const clientCode = generateClientCode('STAFF');

    const userCreate = await airtableFetch(T_USERS, {
      method: 'POST',
      body: JSON.stringify({
        typecast: true,
        records: [{
          fields: {
            Email: email,
            ClientName: fullName,
            ClientCode: clientCode,
            Plan: plan,
            Status: 'Active',
            Notes: `Created via Identity Console by ${me.email} on ${new Date().toISOString().slice(0, 10)}`,
          },
        }],
      }),
    });
    const newUserId = userCreate.records[0].id;

    const permRecords = resolvedProducts.map((p) => ({
      fields: {
        User: [newUserId],
        Product: [p.recordId],
        Role: role,
        Status: 'Active',
      },
    }));
    const permCreate = await airtableFetch(T_PERMISSIONS, {
      method: 'POST',
      body: JSON.stringify({ typecast: true, records: permRecords }),
    });

    let emailResult = { sent: false, reason: 'Skipped by request' };
    if (sendEmail) {
      try {
        emailResult = await sendWelcomeEmail({
          to: email,
          fullName,
          clientCode,
          productNames: resolvedProducts.map((p) => p.name),
        });
      } catch (err) {
        console.error('[identity/users POST] email error:', err);
        emailResult = { sent: false, reason: 'Send failed (see server logs)' };
      }
    }

    return res.status(201).json({
      ok: true,
      user: {
        recordId: newUserId,
        email,
        fullName,
        clientCode,
        plan,
        status: 'Active',
      },
      permissions: permCreate.records.map((r) => ({ permissionId: r.id })),
      productNames: resolvedProducts.map((p) => p.name),
      email: emailResult,
    });
  } catch (err) {
    console.error('[identity/users POST]', err);
    return res.status(500).json({ ok: false, error: err.message || 'Failed to create user' });
  }
}
