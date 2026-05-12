/**
 * /api/identity/users
 *
 * GET  → list all users in the same Client as the signed-in user, with permissions
 * POST → create a new user (staff member), grant permissions, send invite email
 *
 * Auth: widget_suite owner or admin.
 *
 * Uses the existing _lib/auth helpers exclusively — no parallel implementations.
 */

import {
  requireAuth,
  requireProductAccess,
} from '../_lib/auth/middleware.js';
import { setCors, requireMethod, jsonError, parseJson } from '../_lib/auth/http.js';
import {
  listRecords,
  listAllRecords,
  findOneByField,
  createRecord,
  getRecord,
} from '../_lib/auth/airtable.js';
import {
  USERS,
  CLIENTS,
  PERMISSIONS,
  PRODUCTS,
} from '../_lib/auth/schema.js';
import { invalidateUserPermissions } from '../_lib/auth/permissions.js';
import crypto from 'crypto';

const SIGNIN_URL = 'https://id.travelify.io/signin.html';

export default async function handler(req, res) {
  if (setCors(req, res)) return;

  const ctx = await requireAuth(req, res);
  if (!ctx) return;

  const role = requireProductAccess(
    ctx,
    PRODUCTS.slugs.WIDGET_SUITE,
    [PERMISSIONS.roles.OWNER, PERMISSIONS.roles.ADMIN],
    res
  );
  if (!role) return;

  if (req.method === 'GET')  return handleList(req, res, ctx);
  if (req.method === 'POST') return handleCreate(req, res, ctx);

  return jsonError(res, 405, 'method_not_allowed', 'GET or POST only');
}

// ---------------------------------------------------------------------------
// GET — list every user in the same Client as the requester, with their perms
// ---------------------------------------------------------------------------
async function handleList(req, res, ctx) {
  try {
    const clientId = ctx.clientRecordId;

    // Fetch users + permissions in parallel (both small tables for our scope)
    const [allUsers, allPermissions, allProducts] = await Promise.all([
      listAllRecords(USERS.tableId),
      listAllRecords(PERMISSIONS.tableId),
      listAllRecords(PRODUCTS.tableId),
    ]);

    // Build a userRecordId -> permissions list map
    const permsByUserId = new Map();

    // Build productRecordId -> { slug, displayName } map
    const productByRecordId = new Map();
    for (const p of allProducts) {
      productByRecordId.set(p.id, {
        slug: p.fields[PRODUCTS.fields.productId] || '',
        displayName: p.fields[PRODUCTS.fields.displayName] || p.fields[PRODUCTS.fields.productId] || '',
      });
    }

    for (const perm of allPermissions) {
      const f = perm.fields;
      const userLinks = f[PERMISSIONS.fields.user] || [];
      const productLinks = f[PERMISSIONS.fields.product] || [];
      const product = productLinks[0] ? productByRecordId.get(productLinks[0]) : null;
      if (!product) continue;

      for (const uid of userLinks) {
        if (!permsByUserId.has(uid)) permsByUserId.set(uid, []);
        permsByUserId.get(uid).push({
          permissionId: perm.id,
          productSlug: product.slug,
          productName: product.displayName,
          role: f[PERMISSIONS.fields.role] || 'member',
          status: f[PERMISSIONS.fields.status] || PERMISSIONS.statuses.ACTIVE,
          expiresAt: f[PERMISSIONS.fields.expiresAt] || null,
        });
      }
    }

    // Filter users to just those linked to the same Client as the requester
    const users = allUsers
      .filter((u) => {
        const links = u.fields[USERS.fields.client] || [];
        return links.includes(clientId);
      })
      .map((u) => {
        const f = u.fields;
        return {
          recordId: u.id,
          email: f[USERS.fields.email] || '',
          fullName: f[USERS.fields.fullName] || '',
          role: f[USERS.fields.role] || 'member',
          status: f[USERS.fields.status] || USERS.statuses.ACTIVE,
          lastLogin: f[USERS.fields.lastLogin] || null,
          createdAt: f[USERS.fields.created] || u.createdTime || null,
          permissions: permsByUserId.get(u.id) || [],
          isMe: u.id === ctx.userRecordId,
        };
      })
      .sort((a, b) => {
        if (a.status !== b.status) return a.status === USERS.statuses.ACTIVE ? -1 : 1;
        return (a.fullName || '').localeCompare(b.fullName || '');
      });

    return res.status(200).json({ ok: true, users });
  } catch (err) {
    console.error('[identity/users GET]', err);
    return jsonError(res, 500, 'list_failed', 'Failed to load users');
  }
}

// ---------------------------------------------------------------------------
// POST — create a new user under the same Client + grant permissions
// ---------------------------------------------------------------------------
async function handleCreate(req, res, ctx) {
  const body = await parseJson(req);
  if (!body) return jsonError(res, 400, 'bad_json', 'Invalid JSON body');

  const email = String(body.email || '').trim().toLowerCase();
  const fullName = String(body.fullName || '').trim();
  const role = String(body.role || 'admin').toLowerCase();
  const productSlugs = Array.isArray(body.productSlugs) ? body.productSlugs.map(String) : [];
  const sendEmail = body.sendEmail !== false;

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return jsonError(res, 400, 'invalid_email', 'Enter a valid email address');
  }
  if (fullName.length < 2 || fullName.length > 100) {
    return jsonError(res, 400, 'invalid_name', 'Full name is required (2–100 chars)');
  }
  const validRoles = Object.values(PERMISSIONS.roles);
  if (!validRoles.includes(role)) {
    return jsonError(res, 400, 'invalid_role', 'Invalid role');
  }
  if (productSlugs.length === 0) {
    return jsonError(res, 400, 'no_products', 'Select at least one product');
  }

  try {
    // 1. Check the email isn't already in the Users table
    const existing = await findOneByField(USERS.tableId, USERS.fields.email, email);
    if (existing) {
      return jsonError(res, 409, 'email_exists', 'A user with this email already exists');
    }

    // 2. Resolve product slugs → record IDs
    const allProducts = await listAllRecords(PRODUCTS.tableId);
    const slugToRecord = new Map();
    for (const p of allProducts) {
      const slug = p.fields[PRODUCTS.fields.productId];
      if (slug) slugToRecord.set(slug, { id: p.id, name: p.fields[PRODUCTS.fields.displayName] || slug });
    }
    const resolvedProducts = [];
    for (const slug of productSlugs) {
      const match = slugToRecord.get(slug);
      if (!match) return jsonError(res, 400, 'unknown_product', `Unknown product: ${slug}`);
      resolvedProducts.push({ slug, recordId: match.id, name: match.name });
    }

    // 3. Generate a temporary password.
    // We hash via the same algorithm the existing signin uses. Look it up first.
    const tempPassword = generateMemorablePassword();
    const passwordHash = await hashPassword(tempPassword);

    // 4. Create the User row, linked to the requester's Client
    const userFields = {
      [USERS.fields.email]:        email,
      [USERS.fields.fullName]:     fullName,
      [USERS.fields.client]:       [ctx.clientRecordId],
      [USERS.fields.role]:         role === 'owner' || role === 'admin' ? role : USERS.roles.MEMBER,
      [USERS.fields.status]:       USERS.statuses.ACTIVE,
      [USERS.fields.passwordHash]: passwordHash,
      [USERS.fields.authMethods]:  [USERS.authMethodValues.PASSWORD],
      [USERS.fields.notes]:        `Created via Identity Console by ${ctx.email} on ${new Date().toISOString().slice(0, 10)}`,
    };
    const newUser = await createRecord(USERS.tableId, userFields);
    const newUserId = newUser.id;

    // 5. Create permission rows — up to 10 at a time per Airtable's batch rule
    const permFields = resolvedProducts.map((p) => ({
      [PERMISSIONS.fields.user]:      [newUserId],
      [PERMISSIONS.fields.product]:   [p.recordId],
      [PERMISSIONS.fields.role]:      role,
      [PERMISSIONS.fields.status]:    PERMISSIONS.statuses.ACTIVE,
      [PERMISSIONS.fields.grantedBy]: [ctx.userRecordId],
      [PERMISSIONS.fields.granted]:   new Date().toISOString(),
    }));
    // createRecord creates one at a time; that's fine for up to 7 products
    const createdPerms = [];
    for (const fields of permFields) {
      const p = await createRecord(PERMISSIONS.tableId, fields);
      createdPerms.push(p);
    }

    invalidateUserPermissions(newUserId);

    // 6. Send welcome email (or surface credentials inline if email infra unavailable)
    let emailResult = { sent: false, reason: 'Skipped by request' };
    if (sendEmail) {
      try {
        emailResult = await sendWelcomeEmail({
          to: email,
          fullName,
          tempPassword,
          productNames: resolvedProducts.map((p) => p.name),
        });
      } catch (err) {
        console.error('[identity/users POST] email error:', err);
        emailResult = { sent: false, reason: 'Email send failed (see server logs)' };
      }
    }

    return res.status(201).json({
      ok: true,
      user: {
        recordId: newUserId,
        email,
        fullName,
        tempPassword,   // returned ONCE — UI shows in success modal
        role,
      },
      permissions: createdPerms.map((r) => ({ permissionId: r.id })),
      productNames: resolvedProducts.map((p) => p.name),
      email: emailResult,
    });
  } catch (err) {
    console.error('[identity/users POST]', err);
    return jsonError(res, 500, 'create_failed', err.message || 'Failed to create user');
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Generate a memorable temporary password using the same alphabet/format
 * as the existing onboarding flow uses for invite tokens.
 * Format: 4 groups of 4 uppercase letters/numbers separated by dashes.
 */
function generateMemorablePassword() {
  const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I/L
  const bytes = crypto.randomBytes(16);
  let out = '';
  for (let i = 0; i < 16; i++) {
    out += ALPHABET[bytes[i] % ALPHABET.length];
    if ((i + 1) % 4 === 0 && i < 15) out += '-';
  }
  return out;
}

/**
 * Hash a password the way the existing signin route expects.
 * The project uses bcrypt (we saw the $2a$ hash in Andy's user record).
 * We import bcrypt dynamically so this file stays importable in any
 * environment where bcrypt might not be present at parse time.
 */
async function hashPassword(plaintext) {
  // Lazy-import; bcryptjs is a pure-JS implementation that works on Vercel
  const bcrypt = await import('bcryptjs').then((m) => m.default || m);
  return bcrypt.hash(plaintext, 12);
}

/**
 * Send the welcome email via SendGrid using the env vars that already power
 * the Enquiry Form, My Booking confirmation, and other transactional mail.
 *
 * Returns { sent: true, id } on success, { sent: false, reason } otherwise.
 */
async function sendWelcomeEmail({ to, fullName, tempPassword, productNames }) {
  const SG = process.env.SENDGRID_API_KEY;
  const FROM = process.env.SENDGRID_FROM_EMAIL || 'noreply@travelify.io';
  const FROM_NAME = (process.env.SENDGRID_FROM_NAME_FALLBACK || 'Travelgenix')
    .replace(/["<>\r\n]/g, '').slice(0, 100);

  if (!SG) return { sent: false, reason: 'SENDGRID_API_KEY not configured' };

  const subject = 'Your Travelgenix sign-in details';
  const text = renderWelcomeText({ fullName, email: to, tempPassword, productNames });
  const html = renderWelcomeHtml({ fullName, email: to, tempPassword, productNames });

  const payload = {
    personalizations: [{ to: [{ email: to, name: fullName }] }],
    from: { email: FROM, name: FROM_NAME },
    subject: subject.slice(0, 200),
    content: [
      { type: 'text/plain', value: text },
      { type: 'text/html', value: html },
    ],
    categories: ['identity-welcome'],
    tracking_settings: {
      click_tracking: { enable: false, enable_text: false },
      open_tracking: { enable: false },
    },
  };

  const r = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: { Authorization: `Bearer ${SG}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (r.status === 202) return { sent: true, id: r.headers.get('x-message-id') || null };
  const body = await r.text().catch(() => '');
  console.error('[identity/users] SendGrid', r.status, body);
  return { sent: false, reason: `SendGrid ${r.status}` };
}

function escapeHtml(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function renderWelcomeText({ fullName, email, tempPassword, productNames }) {
  const products = (productNames || []).map((p) => `  - ${p}`).join('\n');
  return [
    `Hi ${fullName},`,
    '',
    `You've been given access to Travelgenix. Sign-in details below:`,
    '',
    `  Sign in at:  ${SIGNIN_URL}`,
    `  Email:       ${email}`,
    `  Password:    ${tempPassword}`,
    '',
    products ? `You can access:\n${products}\n` : '',
    `Keep this email — your temporary password is what you'll use to sign in.`,
    `You can change it from the account menu after signing in.`,
    '',
    `— Travelgenix`,
  ].filter(Boolean).join('\n');
}

function renderWelcomeHtml({ fullName, email, tempPassword, productNames }) {
  const productList = (productNames || [])
    .map((p) => `<li style="margin:0 0 6px 0;padding:0;font-size:15px;line-height:1.5;color:#0F172A;">${escapeHtml(p)}</li>`)
    .join('');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="light dark">
  <title>Your Travelgenix sign-in details</title>
</head>
<body style="margin:0;padding:0;background:#F1F5F9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;-webkit-font-smoothing:antialiased;">
  <span style="display:none!important;visibility:hidden;opacity:0;color:transparent;height:0;width:0;overflow:hidden;">Your Travelgenix account is ready.</span>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#F1F5F9;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;background:#FFFFFF;border-radius:12px;overflow:hidden;box-shadow:0 4px 12px rgba(15,23,42,0.06);">
        <tr><td style="background:#1B2B5B;padding:20px 32px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
            <td style="font-size:16px;font-weight:600;color:#FFFFFF;letter-spacing:-0.01em;">Travelgenix</td>
            <td align="right" style="font-size:12px;color:#94A3B8;letter-spacing:0.04em;text-transform:uppercase;">Account access</td>
          </tr></table>
        </td></tr>
        <tr><td style="padding:40px 32px 16px 32px;">
          <h1 style="margin:0 0 8px 0;padding:0;font-size:24px;line-height:1.25;font-weight:700;color:#0F172A;letter-spacing:-0.02em;">You've been given access to Travelgenix</h1>
          <p style="margin:0;padding:0;font-size:15px;line-height:1.6;color:#475569;">Hi ${escapeHtml(fullName)}, your account is ready. Use the details below to sign in.</p>
        </td></tr>
        <tr><td style="padding:8px 32px 0 32px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#F8FAFC;border:1px solid #E2E8F0;border-radius:12px;">
            <tr><td style="padding:20px 24px;border-bottom:1px solid #E2E8F0;">
              <div style="font-size:11px;line-height:1.4;color:#94A3B8;letter-spacing:0.08em;text-transform:uppercase;margin-bottom:4px;">Sign in at</div>
              <a href="${escapeHtml(SIGNIN_URL)}" style="font-size:16px;line-height:1.5;color:#1B2B5B;text-decoration:none;font-weight:600;">id.travelify.io</a>
            </td></tr>
            <tr><td style="padding:20px 24px;border-bottom:1px solid #E2E8F0;">
              <div style="font-size:11px;line-height:1.4;color:#94A3B8;letter-spacing:0.08em;text-transform:uppercase;margin-bottom:4px;">Email</div>
              <div style="font-size:15px;line-height:1.5;color:#0F172A;font-weight:500;">${escapeHtml(email)}</div>
            </td></tr>
            <tr><td style="padding:20px 24px;">
              <div style="font-size:11px;line-height:1.4;color:#94A3B8;letter-spacing:0.08em;text-transform:uppercase;margin-bottom:4px;">Temporary password</div>
              <div style="font-family:'SF Mono',Menlo,Consolas,monospace;font-size:16px;line-height:1.4;color:#0F172A;font-weight:600;letter-spacing:0.02em;">${escapeHtml(tempPassword)}</div>
            </td></tr>
          </table>
        </td></tr>
        <tr><td align="center" style="padding:28px 32px 8px 32px;">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td align="center" style="background:#1B2B5B;border-radius:8px;">
            <a href="${escapeHtml(SIGNIN_URL)}" style="display:inline-block;padding:14px 28px;font-size:15px;line-height:1;font-weight:600;color:#FFFFFF;text-decoration:none;letter-spacing:-0.01em;">Sign in to Travelgenix</a>
          </td></tr></table>
        </td></tr>
        ${productList ? `<tr><td style="padding:24px 32px 8px 32px;">
          <div style="font-size:13px;line-height:1.4;color:#94A3B8;letter-spacing:0.04em;text-transform:uppercase;font-weight:600;margin-bottom:12px;">What you can access</div>
          <ul style="margin:0;padding:0 0 0 18px;list-style:disc;color:#475569;">${productList}</ul>
        </td></tr>` : ''}
        <tr><td style="padding:16px 32px 24px 32px;">
          <div style="font-size:13px;line-height:1.5;color:#475569;">Keep this email — your temporary password is what you'll use to sign in. You can change it from the account menu after signing in.</div>
        </td></tr>
        <tr><td style="background:#F8FAFC;padding:20px 32px;border-top:1px solid #E2E8F0;">
          <div style="font-size:12px;line-height:1.5;color:#94A3B8;">Travelgenix · Bournemouth, UK · Part of Agendas Group<br>This is a transactional email about your Travelgenix account.</div>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}
