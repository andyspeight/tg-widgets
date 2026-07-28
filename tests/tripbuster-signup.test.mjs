/**
 * Tripbuster sign-up and enquiry notifications.
 *
 * Run: node tests/tripbuster-signup.test.mjs
 *
 * Two features that both hinge on sending an email, and both have failure modes
 * that are invisible unless you look for them:
 *
 *   • a sign-up form that quietly tells the world which agencies have accounts
 *   • an account created but never emailed, so nobody can ever verify it
 *   • an approval link a mail scanner follows and approves on your behalf
 *   • the same enquiry emailed twice, so an agency rings a customer twice
 *   • an enquiry LOST because the mail provider had a bad minute
 *
 * SendGrid is intercepted at fetch rather than stubbed at the module boundary,
 * so the real wrapper builds the real payload and the assertions are made
 * against what would actually have gone over the wire.
 */
import http from 'node:http';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

const FAKE_PG_PORT = 8351;
process.env.TRIPBUSTER_SUPABASE_URL = `http://127.0.0.1:${FAKE_PG_PORT}`;
process.env.TRIPBUSTER_SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
process.env.TRIPBUSTER_SESSION_SECRET = 'signup-test-secret-that-is-long-enough-32';
process.env.TRIPBUSTER_SITE_ORIGIN = 'https://tripbuster.example';
process.env.SENDGRID_API_KEY = 'SG.test';
process.env.SENDGRID_FROM_EMAIL = 'noreply@travelify.io';
process.env.TRIPBUSTER_ADMIN_EMAIL = 'andy@example.co.uk';
process.env.RL_DISABLED = '1';
process.env.TRIPBUSTER_ADMIN_PASSWORD = 'an-owner-password-long-enough';

// ── intercept SendGrid ──────────────────────────────────────────
// Everything else (the fake PostgREST) still goes over real fetch.
const realFetch = globalThis.fetch;
let sent = [];
let mailBehaviour = 'ok'; // 'ok' | 'fail' | 'throw'

globalThis.fetch = async (url, init) => {
  if (String(url).includes('api.sendgrid.com')) {
    if (mailBehaviour === 'throw') throw new Error('network down');
    const payload = JSON.parse(init.body);
    if (mailBehaviour === 'fail') {
      return new Response('{"errors":[{"message":"bad request"}]}', { status: 400 });
    }
    sent.push({
      to: payload.personalizations[0].to.map((t) => t.email),
      subject: payload.subject,
      html: (payload.content.find((c) => c.type === 'text/html') || {}).value || '',
      replyTo: payload.reply_to && payload.reply_to.email,
      category: (payload.categories || [])[0],
      from: payload.from,
    });
    return new Response('', { status: 202, headers: { 'x-message-id': `msg-${sent.length}` } });
  }
  return realFetch(url, init);
};

const { default: register } = await import('../api/tripbuster/register.js');
const { default: verify } = await import('../api/tripbuster/verify.js');
const { default: approve } = await import('../api/tripbuster/approve.js');
const { default: lead } = await import('../api/tripbuster/lead.js');
const { default: account } = await import('../api/tripbuster/account.js');
const { default: admin } = await import('../api/tripbuster/admin.js');
const { validateRegistration } = await import('../api/_lib/tripbuster/register-schema.js');
const { signAdminLink, createAgentToken } = await import('../api/_lib/tripbuster/auth.js');

// ── the fake database ───────────────────────────────────────────
// Holds just enough state that the sequences under test are real sequences:
// register then verify then approve has to actually move an account through
// three states, or the test proves nothing about the flow.

const AGENT_ID = 'aaaaaaaa-0000-4000-8000-000000000001';
const LEAD_ID = 'bbbbbbbb-0000-4000-8000-000000000002';
const DEAL_ID = 'cccccccc-0000-4000-8000-000000000003';

let db;
function resetDb() {
  db = {
    agents: [],
    leads: [],
    // Everything a claim needs, kept flat for readability.
    leadRow: {
      id: LEAD_ID, agent_id: AGENT_ID, notified_at: null, deal_title: 'Benidorm, 7 nights',
      name: 'Pat Jones', phone: '07700 900123', email: 'pat@example.co.uk',
      message: 'Any chance of a sea view?', preferred_time: 'Evenings',
      created_at: '2026-07-28T18:30:00Z',
    },
    notifyAgent: {
      id: AGENT_ID, name: 'Jetaway Travel', slug: 'jetaway-travel',
      email: 'bookings@example.co.uk', notify_email: null, notify_leads: true,
      phone: '0141 555 907', hours_mode: 'always', plan: 'Boost', status: 'active',
      rate_tier: 'standard', free_until: null,
    },
  };
}
resetDb();

const rpc = {
  tb_register_agent(a) {
    const email = String(a.p_email).toLowerCase().trim();
    const existing = db.agents.find((x) => x.email === email);
    if (existing) {
      if (existing.verified_at) return { created: false, reason: 'taken' };
      existing.verify_token_hash = a.p_token_hash;
      existing.verify_expires_at = a.p_expires_at;
      existing.password_hash = a.p_password_hash;
      return { created: false, reason: 'resent', agentId: existing.id, name: existing.name };
    }
    const row = {
      id: AGENT_ID, slug: 'new-agency', name: a.p_name, email,
      free_until: a.p_free_until || null,
      status: 'pending', plan: a.p_plan, password_hash: a.p_password_hash,
      verify_token_hash: a.p_token_hash, verify_expires_at: a.p_expires_at,
      verified_at: null, approved_at: null, signup_ip_hash: a.p_ip_hash,
    };
    db.agents.push(row);
    return { created: true, agentId: row.id, slug: row.slug, name: row.name };
  },

  tb_verify_agent(a) {
    const row = db.agents.find((x) => x.verify_token_hash === a.p_token_hash);
    if (!row) return { ok: false, reason: 'unknown' };
    if (row.verify_expires_at && new Date(row.verify_expires_at) < new Date()) {
      return { ok: false, reason: 'expired', agentId: row.id, email: row.email };
    }
    row.verified_at = row.verified_at || new Date().toISOString();
    if (a.p_auto_activate) {
      row.approved_at = row.approved_at || new Date().toISOString();
      if (row.status === 'pending') row.status = 'active';
    }
    // Consumed either way: a link works exactly once.
    row.verify_token_hash = null;
    row.verify_expires_at = null;
    return {
      ok: true, agentId: row.id, name: row.name, email: row.email, slug: row.slug,
      active: !!a.p_auto_activate || row.status === 'active',
    };
  },

  tb_approve_agent(a) {
    const row = db.agents.find((x) => x.id === a.p_agent_id);
    if (!row) return { ok: false, reason: 'unknown' };
    if (!row.verified_at) return { ok: false, reason: 'unverified', name: row.name, email: row.email };
    if (row.status === 'active') {
      return { ok: true, already: true, name: row.name, email: row.email, agentId: row.id };
    }
    if (row.status !== 'pending') {
      return { ok: false, reason: 'not_pending', status: row.status, name: row.name };
    }
    row.status = 'active';
    row.approved_at = new Date().toISOString();
    return { ok: true, already: false, name: row.name, email: row.email, agentId: row.id };
  },

  tb_record_lead() {
    return { recorded: true, leadId: LEAD_ID, agentName: 'Jetaway Travel', billable: true };
  },

  tb_claim_lead_notification(a) {
    const l = db.leadRow;
    const ag = db.notifyAgent;
    if (a.p_lead_id !== l.id) return null;
    // The real function's WHERE clause, expressed as JavaScript. All three
    // conditions have to hold or there is nothing to send.
    if (l.notified_at) return null;
    if (!ag.notify_leads) return null;
    const sendTo = (ag.notify_email || '').trim() || ag.email;
    if (!sendTo) return null;
    l.notified_at = new Date().toISOString();
    return {
      leadId: l.id, sendTo, agentName: ag.name, dealTitle: l.deal_title,
      name: l.name, phone: l.phone, email: l.email, message: l.message,
      preferredTime: l.preferred_time, createdAt: l.created_at,
    };
  },

  tb_release_lead_notification(a) {
    if (a.p_lead_id === db.leadRow.id) db.leadRow.notified_at = null;
    return null;
  },

  tb_admin_agencies() {
    return [{
      id: AGENT_ID, name: 'Jetaway Travel', slug: 'jetaway-travel',
      email: 'bookings@example.co.uk', status: 'active', plan: 'Boost',
      rateTier: 'standard', freeUntil: null, free: false,
      liveDeals: 5, totalDeals: 5, impressions: 4200,
      clicks: 0, calls: 167, leads: 38, chargedPence: 20500, worthPence: 20500,
    }];
  },
  tb_admin_set_agency(a) {
    const ag = db.notifyAgent;
    if (a.p_clear_free) ag.free_until = null;
    else if (a.p_free_until) ag.free_until = a.p_free_until;
    if (a.p_rate_tier) ag.rate_tier = a.p_rate_tier;
    if (a.p_status) ag.status = a.p_status;
    return {
      ok: true, id: ag.id, name: ag.name, freeUntil: ag.free_until || null,
      rateTier: ag.rate_tier || 'standard', status: ag.status,
      free: !!ag.free_until,
    };
  },

  tb_agent_billing_counts() { return { total: 3, overridden: 0 }; },
  tb_agent_contact() { return { hoursMode: 'always', phones: [], hours: [], specialDays: [] }; },
  tb_save_agent_settings() { return { saved: true, billingMode: 'call' }; },
};

const fakePg = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    const send = (code, payload) => {
      res.writeHead(code, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(payload));
    };
    const url = new URL(req.url, 'http://x');

    if (url.pathname.startsWith('/rest/v1/rpc/')) {
      const fn = url.pathname.replace('/rest/v1/rpc/', '');
      if (!rpc[fn]) return send(404, { message: `no function ${fn}` });
      return send(200, rpc[fn](body ? JSON.parse(body) : {}) ?? null);
    }
    // PostgREST table access: only the agents row the settings screen reads and
    // patches.
    if (url.pathname === '/rest/v1/agents') {
      if (req.method === 'PATCH') {
        Object.assign(db.notifyAgent, JSON.parse(body));
        return send(200, []);
      }
      return send(200, [db.notifyAgent]);
    }
    return send(404, { message: 'nope' });
  });
});
await new Promise((r) => fakePg.listen(FAKE_PG_PORT, r));

// ── harness ─────────────────────────────────────────────────────
let passed = 0;
const failures = [];

function test(name, fn) {
  try { fn(); passed++; console.log(`PASS  ${name}`); } catch (e) {
    failures.push({ name, message: e.message });
    console.log(`FAIL  ${name}\n      ${e.message}`);
  }
}
async function testAsync(name, fn) {
  try { await fn(); passed++; console.log(`PASS  ${name}`); } catch (e) {
    failures.push({ name, message: e.message });
    console.log(`FAIL  ${name}\n      ${e.message}`);
  }
}

async function call(handler, { method = 'POST', body = {}, query = {}, headers = {} } = {}) {
  const out = { status: 0, headers: {}, body: '', json: null };
  const res = {
    setHeader(k, v) { out.headers[k.toLowerCase()] = v; },
    status(c) { out.status = c; return res; },
    send(p) { out.body = typeof p === 'string' ? p : JSON.stringify(p); return res; },
    json(p) { out.json = p; out.body = JSON.stringify(p); return res; },
    end(p) { if (p) out.body = p; return res; },
  };
  await handler({ method, body, query, headers: { host: 'tripbuster.example', ...headers } }, res);
  return out;
}

/** Pull the verify token straight out of the email that was sent. */
function tokenFromLastEmail() {
  const m = /verify\?token=([A-Za-z0-9_-]+)/.exec(sent[sent.length - 1].html);
  return m ? m[1] : null;
}

function freshRun() {
  sent = [];
  mailBehaviour = 'ok';
  resetDb();
}

const GOOD_SIGNUP = {
  name: 'Brand New Travel',
  email: 'hello@example.co.uk',
  password: 'a-long-enough-password',
  phone: '01204 555 118',
  town: 'Bolton',
  website: 'brandnewtravel.co.uk',
  agreed: true,
};

// ════════════════════════════════════════════════════════════════
// 1. what a sign-up may contain
// ════════════════════════════════════════════════════════════════

test('a sign-up needs a name, an address, a password and an actual agreement', () => {
  const fields = (body) => validateRegistration(body).errors.map((e) => e.field);
  assert.deepEqual(fields({}), ['name', 'email', 'password', 'agreed']);
  assert.ok(fields({ ...GOOD_SIGNUP, email: 'not-an-email' }).includes('email'));
  assert.ok(fields({ ...GOOD_SIGNUP, password: 'short' }).includes('password'));
  // Unticked is not agreement, and neither is a truthy string.
  assert.ok(fields({ ...GOOD_SIGNUP, agreed: false }).includes('agreed'));
  assert.ok(fields({ ...GOOD_SIGNUP, agreed: 'yes' }).includes('agreed'));
});

test('a password longer than bcrypt reads is refused rather than truncated', () => {
  // bcrypt stops at 72 bytes. Accepting more would mean a carefully typed
  // 90-character passphrase and a shorter prefix of it both signing you in.
  const out = validateRegistration({ ...GOOD_SIGNUP, password: 'x'.repeat(73) });
  assert.equal(out.ok, false);
  assert.ok(out.errors.some((e) => e.field === 'password'));
  assert.equal(validateRegistration({ ...GOOD_SIGNUP, password: 'x'.repeat(72) }).ok, true);
});

test('a password cannot just be the email address', () => {
  const out = validateRegistration({
    ...GOOD_SIGNUP, email: 'hello@example.co.uk', password: 'hello@example.co.uk',
  });
  assert.equal(out.ok, false);
  assert.ok(out.errors.some((e) => e.field === 'password'));
});

test('a website is normalised to an absolute URL, and nonsense is refused', () => {
  assert.equal(validateRegistration(GOOD_SIGNUP).agent.website, 'https://brandnewtravel.co.uk/');
  assert.equal(validateRegistration({ ...GOOD_SIGNUP, website: '' }).agent.website, null);
  assert.ok(validateRegistration({ ...GOOD_SIGNUP, website: 'not a website' })
    .errors.some((e) => e.field === 'website'));
  // No javascript: smuggled into a field we later render as a link.
  assert.ok(validateRegistration({ ...GOOD_SIGNUP, website: 'javascript:alert(1)' })
    .errors.some((e) => e.field === 'website'));
});

// ════════════════════════════════════════════════════════════════
// 2. signing up
// ════════════════════════════════════════════════════════════════

await testAsync('a new agency is created pending, and emailed a link', async () => {
  freshRun();
  const r = await call(register, { body: GOOD_SIGNUP });
  assert.equal(r.status, 200);
  assert.ok(r.json.ok);

  assert.equal(db.agents.length, 1);
  const row = db.agents[0];
  assert.equal(row.status, 'pending', 'a new agency must not be trading yet');
  assert.equal(row.plan, 'Spark');
  assert.equal(row.verified_at, null);

  assert.equal(sent.length, 1);
  assert.equal(sent[0].to[0], 'hello@example.co.uk');
  assert.equal(sent[0].category, 'tb-verify');
  assert.ok(sent[0].html.includes('https://tripbuster.example/tripbuster/verify?token='));
  // Always our own verified sender, never a domain we do not control.
  assert.equal(sent[0].from.email, 'noreply@travelify.io');
  assert.equal(sent[0].from.name, 'Tripbuster');
});

await testAsync('the link is stored hashed, never in the clear', async () => {
  freshRun();
  await call(register, { body: GOOD_SIGNUP });
  const token = tokenFromLastEmail();
  assert.ok(token && token.length > 20);
  const stored = db.agents[0].verify_token_hash;
  assert.notEqual(stored, token, 'the raw token reached the database');
  assert.equal(stored, createHash('sha256').update(token).digest('hex'));
});

await testAsync('an address that already has an account gets the same answer', async () => {
  freshRun();
  await call(register, { body: GOOD_SIGNUP });
  // Verify it, so a repeat is genuinely 'taken' rather than a resend.
  await call(verify, { method: 'GET', query: { token: tokenFromLastEmail() } });
  sent = [];

  const first = await call(register, { body: GOOD_SIGNUP });
  const second = await call(register, {
    body: { ...GOOD_SIGNUP, email: 'someone-else@example.co.uk' },
  });

  // THE POINT: a form that says "that email is taken" is a way to ask, one
  // address at a time, which travel agencies advertise here.
  assert.equal(first.status, second.status);
  assert.deepEqual(first.json, second.json);
  assert.ok(!JSON.stringify(first.json).toLowerCase().includes('taken'));

  // The person who owns the address is told; the person at the keyboard is not.
  const toOwner = sent.find((m) => m.category === 'tb-already-registered');
  assert.ok(toOwner, 'the account holder should hear that somebody tried');
  assert.equal(toOwner.to[0], 'hello@example.co.uk');
});

await testAsync('signing up again before verifying sends a fresh link', async () => {
  freshRun();
  await call(register, { body: GOOD_SIGNUP });
  const first = tokenFromLastEmail();
  const r = await call(register, { body: GOOD_SIGNUP });
  assert.equal(r.status, 200);
  const second = tokenFromLastEmail();
  assert.notEqual(second, first, 'a lost email should be replaceable');
  assert.equal(db.agents.length, 1, 'and must not create a second account');
  // The old link is dead the moment a new one is issued.
  const stale = await call(verify, { method: 'GET', query: { token: first } });
  assert.equal(stale.status, 404);
});

await testAsync('no account is created when the email cannot be sent', async () => {
  freshRun();
  mailBehaviour = 'fail';
  const r = await call(register, { body: GOOD_SIGNUP });
  // The row exists but the link never left, so this is the one case that admits
  // to a problem rather than saying "check your email".
  assert.equal(r.status, 502);
  assert.ok(/confirmation email/i.test(r.json.error));
});

await testAsync('sign-up is refused outright when mail is not configured', async () => {
  freshRun();
  const key = process.env.SENDGRID_API_KEY;
  delete process.env.SENDGRID_API_KEY;
  const r = await call(register, { body: GOOD_SIGNUP });
  process.env.SENDGRID_API_KEY = key;
  assert.equal(r.status, 503);
  // Nothing half-made: no account with an address nobody can ever verify.
  assert.equal(db.agents.length, 0);
});

await testAsync('a new agency joins the free period when one is running', async () => {
  freshRun();
  const future = new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10);
  process.env.TRIPBUSTER_FREE_UNTIL = future;
  await call(register, { body: GOOD_SIGNUP });
  delete process.env.TRIPBUSTER_FREE_UNTIL;
  assert.equal(db.agents[0].free_until, future);
});

await testAsync('a free period that has already gone by is not applied', async () => {
  freshRun();
  // The launch offer simply lapses. No code change, no switch to remember.
  process.env.TRIPBUSTER_FREE_UNTIL = '2020-01-01';
  await call(register, { body: GOOD_SIGNUP });
  delete process.env.TRIPBUSTER_FREE_UNTIL;
  assert.equal(db.agents[0].free_until, null);
});

await testAsync('a malformed free-until date is ignored rather than guessed at', async () => {
  freshRun();
  process.env.TRIPBUSTER_FREE_UNTIL = 'next spring';
  await call(register, { body: GOOD_SIGNUP });
  delete process.env.TRIPBUSTER_FREE_UNTIL;
  assert.equal(db.agents[0].free_until, null);
});

// ════════════════════════════════════════════════════════════════
// 3. confirming the address
// ════════════════════════════════════════════════════════════════

await testAsync('confirming leaves the agency verified but still waiting on us', async () => {
  freshRun();
  await call(register, { body: GOOD_SIGNUP });
  const token = tokenFromLastEmail();
  sent = [];

  const r = await call(verify, { method: 'GET', query: { token } });
  assert.equal(r.status, 200);
  assert.ok(r.body.includes('Thanks, that is confirmed'));
  assert.ok(/content="noindex/.test(r.body), 'these pages must not be indexed');

  assert.ok(db.agents[0].verified_at, 'the address is proved');
  assert.equal(db.agents[0].status, 'pending', 'but nothing of theirs is public yet');

  // And somebody at Tripbuster has been told, with a way to act on it.
  const admin = sent.find((m) => m.category === 'tb-signup-admin');
  assert.ok(admin, 'nobody was told there is an agency waiting');
  assert.equal(admin.to[0], 'andy@example.co.uk');
  assert.ok(admin.html.includes('/tripbuster/approve?agent='));
});

await testAsync('a confirmation link works exactly once', async () => {
  freshRun();
  await call(register, { body: GOOD_SIGNUP });
  const token = tokenFromLastEmail();
  assert.equal((await call(verify, { method: 'GET', query: { token } })).status, 200);
  const again = await call(verify, { method: 'GET', query: { token } });
  assert.equal(again.status, 404);
  assert.ok(again.body.includes('already been used'));
});

await testAsync('an expired link says so and offers a way out', async () => {
  freshRun();
  await call(register, { body: GOOD_SIGNUP });
  const token = tokenFromLastEmail();
  db.agents[0].verify_expires_at = new Date(Date.now() - 1000).toISOString();
  const r = await call(verify, { method: 'GET', query: { token } });
  assert.equal(r.status, 410);
  assert.ok(r.body.includes('expired'));
  assert.ok(r.body.includes('Sign up again'));
});

await testAsync('on auto-approval the agency is trading straight away', async () => {
  freshRun();
  process.env.TRIPBUSTER_AGENT_APPROVAL = 'auto';
  await call(register, { body: GOOD_SIGNUP });
  const token = tokenFromLastEmail();
  sent = [];
  const r = await call(verify, { method: 'GET', query: { token } });
  delete process.env.TRIPBUSTER_AGENT_APPROVAL;

  assert.equal(r.status, 200);
  assert.ok(r.body.includes('You are all set'));
  assert.equal(db.agents[0].status, 'active');
  // No approval email, because there is nothing to approve.
  assert.ok(!sent.some((m) => m.category === 'tb-signup-admin'));
});

// ════════════════════════════════════════════════════════════════
// 4. approving
// ════════════════════════════════════════════════════════════════

async function readyForApproval() {
  freshRun();
  await call(register, { body: GOOD_SIGNUP });
  await call(verify, { method: 'GET', query: { token: tokenFromLastEmail() } });
  sent = [];
  return signAdminLink(AGENT_ID);
}

await testAsync('following the approval link does NOT approve anything', async () => {
  const { exp, sig } = await readyForApproval();
  const r = await call(approve, { method: 'GET', query: { agent: AGENT_ID, exp, sig } });
  assert.equal(r.status, 200);
  assert.ok(r.body.includes('Approve this agency?'));
  // Mail scanners, link previewers and security appliances all follow links in
  // email. If a GET approved, every agency would be approved before a human
  // ever read the message.
  assert.equal(db.agents[0].status, 'pending', 'a GET must never approve');
  assert.equal(sent.length, 0);
});

await testAsync('confirming the approval puts them live and tells them', async () => {
  const { exp, sig } = await readyForApproval();
  const r = await call(approve, { method: 'POST', body: { agent: AGENT_ID, exp, sig } });
  assert.equal(r.status, 200);
  assert.ok(r.body.includes('Approved'));
  assert.equal(db.agents[0].status, 'active');
  const welcome = sent.find((m) => m.category === 'tb-approved');
  assert.ok(welcome);
  assert.equal(welcome.to[0], 'hello@example.co.uk');
});

await testAsync('an approval link cannot be edited to approve somebody else', async () => {
  const { exp, sig } = await readyForApproval();
  const other = 'dddddddd-0000-4000-8000-000000000009';
  const r = await call(approve, { method: 'POST', body: { agent: other, exp, sig } });
  assert.equal(r.status, 403);
  assert.equal(db.agents[0].status, 'pending');
});

await testAsync('an approval link cannot have its expiry extended', async () => {
  const { sig } = await readyForApproval();
  const later = String(Date.now() + 999 * 24 * 3600 * 1000);
  const r = await call(approve, { method: 'POST', body: { agent: AGENT_ID, exp: later, sig } });
  assert.equal(r.status, 403, 'the expiry is inside the signed material');
});

await testAsync('an expired approval link is refused', async () => {
  await readyForApproval();
  const { exp, sig } = signAdminLink(AGENT_ID, -1000);
  const r = await call(approve, { method: 'POST', body: { agent: AGENT_ID, exp, sig } });
  assert.equal(r.status, 403);
});

await testAsync('approving twice is not an error', async () => {
  const { exp, sig } = await readyForApproval();
  await call(approve, { method: 'POST', body: { agent: AGENT_ID, exp, sig } });
  const again = await call(approve, { method: 'POST', body: { agent: AGENT_ID, exp, sig } });
  assert.equal(again.status, 200);
  assert.ok(again.body.includes('Already approved'));
});

await testAsync('an unverified agency cannot be approved into existence', async () => {
  freshRun();
  await call(register, { body: GOOD_SIGNUP });
  const { exp, sig } = signAdminLink(AGENT_ID);
  const r = await call(approve, { method: 'POST', body: { agent: AGENT_ID, exp, sig } });
  assert.equal(r.status, 409);
  assert.ok(/confirmed their email/i.test(r.body));
  assert.equal(db.agents[0].status, 'pending');
});

await testAsync('an old approval link cannot un-suspend an agency', async () => {
  const { exp, sig } = await readyForApproval();
  // Somebody suspended them deliberately after the email went out.
  db.agents[0].status = 'suspended';
  const r = await call(approve, { method: 'POST', body: { agent: AGENT_ID, exp, sig } });
  assert.equal(r.status, 409);
  assert.equal(db.agents[0].status, 'suspended');
});

// ════════════════════════════════════════════════════════════════
// 5. telling an agency somebody wants a call
// ════════════════════════════════════════════════════════════════

const LEAD_BODY = {
  dealId: DEAL_ID, name: 'Pat Jones', phone: '07700 900123',
  email: 'pat@example.co.uk', message: 'Any chance of a sea view?', surface: 'site',
};

await testAsync('an enquiry emails the agency, and replies go to the traveller', async () => {
  freshRun();
  const r = await call(lead, { body: LEAD_BODY });
  assert.equal(r.status, 200);
  assert.equal(r.json.recorded, true);

  const mail = sent.find((m) => m.category === 'tb-lead');
  assert.ok(mail, 'nobody was told about the enquiry');
  assert.equal(mail.to[0], 'bookings@example.co.uk');
  // Hitting reply has to reach the person who asked for the call.
  assert.equal(mail.replyTo, 'pat@example.co.uk');
  // The name is in the subject so one enquiry is distinguishable from another
  // in a phone notification without opening anything.
  assert.ok(mail.subject.includes('Pat Jones'));
  for (const needle of ['07700 900123', 'pat@example.co.uk', 'sea view', 'Benidorm']) {
    assert.ok(mail.html.includes(needle), `the email should carry: ${needle}`);
  }
});

await testAsync('the same enquiry is never emailed twice', async () => {
  freshRun();
  await call(lead, { body: LEAD_BODY });
  assert.equal(sent.filter((m) => m.category === 'tb-lead').length, 1);
  // A retry, a double submit, a warm and a cold invocation racing: all land here.
  await call(lead, { body: LEAD_BODY });
  assert.equal(sent.filter((m) => m.category === 'tb-lead').length, 1,
    'an agency must not ring the same person twice');
});

await testAsync('two simultaneous attempts still produce exactly one email', async () => {
  freshRun();
  await Promise.all([call(lead, { body: LEAD_BODY }), call(lead, { body: LEAD_BODY })]);
  assert.equal(sent.filter((m) => m.category === 'tb-lead').length, 1);
});

await testAsync('an agency that turned the emails off does not get one', async () => {
  freshRun();
  db.notifyAgent.notify_leads = false;
  const r = await call(lead, { body: LEAD_BODY });
  assert.equal(r.status, 200, 'the enquiry is still taken');
  assert.equal(sent.filter((m) => m.category === 'tb-lead').length, 0);
});

await testAsync('a separate notification address wins over the sign-in one', async () => {
  freshRun();
  db.notifyAgent.notify_email = 'enquiries@example.co.uk';
  await call(lead, { body: LEAD_BODY });
  assert.equal(sent.find((m) => m.category === 'tb-lead').to[0], 'enquiries@example.co.uk');
});

await testAsync('a mail failure never loses the enquiry', async () => {
  freshRun();
  mailBehaviour = 'fail';
  const r = await call(lead, { body: LEAD_BODY });
  // The enquiry is stored and visible in the inbox. That is the thing that
  // matters; the email is the second-best copy of it.
  assert.equal(r.status, 200);
  assert.equal(r.json.recorded, true);
  // And it is still owed an email rather than silently marked as handled.
  assert.equal(db.leadRow.notified_at, null, 'the claim should have been released');

  // So a later attempt can still deliver it.
  mailBehaviour = 'ok';
  await call(lead, { body: LEAD_BODY });
  assert.equal(sent.filter((m) => m.category === 'tb-lead').length, 1);
});

await testAsync('a mail provider that throws still does not lose the enquiry', async () => {
  freshRun();
  mailBehaviour = 'throw';
  const r = await call(lead, { body: LEAD_BODY });
  assert.equal(r.status, 200);
  assert.equal(r.json.recorded, true);
  assert.equal(db.leadRow.notified_at, null);
});

// ════════════════════════════════════════════════════════════════
// 6. the settings behind it
// ════════════════════════════════════════════════════════════════

const token = createAgentToken({
  agentId: AGENT_ID, slug: 'jetaway-travel', plan: 'Boost', email: 'bookings@example.co.uk',
});
const asAgent = { authorization: `Bearer ${token}` };

await testAsync('the settings screen says where enquiries currently go', async () => {
  freshRun();
  const r = await call(account, { method: 'GET', headers: asAgent });
  assert.equal(r.json.notifyLeads, true);
  assert.equal(r.json.notifyEmail, '');
  // So the screen can say "leave empty to use bookings@…" rather than a blank box.
  assert.equal(r.json.signInEmail, 'bookings@example.co.uk');
});

await testAsync('the notification address is validated', async () => {
  freshRun();
  const bad = await call(account, {
    method: 'PATCH', headers: asAgent, body: { notifyEmail: 'not-an-address' },
  });
  assert.equal(bad.status, 422);
  assert.equal(bad.json.errors[0].field, 'notifyEmail');

  const good = await call(account, {
    method: 'PATCH', headers: asAgent, body: { notifyEmail: 'Enquiries@Example.co.uk' },
  });
  assert.equal(good.status, 200);
  assert.equal(db.notifyAgent.notify_email, 'enquiries@example.co.uk', 'stored lower case');
});

await testAsync('clearing the address falls back rather than switching off', async () => {
  freshRun();
  db.notifyAgent.notify_email = 'enquiries@example.co.uk';
  const r = await call(account, { method: 'PATCH', headers: asAgent, body: { notifyEmail: '' } });
  assert.equal(r.status, 200);
  assert.equal(db.notifyAgent.notify_email, null);
  // Still on. Turning them off is a separate, deliberate switch.
  assert.equal(db.notifyAgent.notify_leads, true);
});

await testAsync('changing only the notifications does not need the schedule transaction', async () => {
  freshRun();
  const r = await call(account, {
    method: 'PATCH', headers: asAgent, body: { notifyLeads: false },
  });
  assert.equal(r.status, 200);
  assert.equal(r.json.notifyLeads, false);
  assert.equal(db.notifyAgent.notify_leads, false);
});

await testAsync('the settings screen still refuses to touch plan or status', async () => {
  freshRun();
  await call(account, {
    method: 'PATCH',
    headers: asAgent,
    body: { notifyLeads: true, plan: 'Bespoke', status: 'active' },
  });
  assert.equal(db.notifyAgent.plan, 'Boost', 'a settings screen must not upgrade a plan');
  assert.equal(db.notifyAgent.status, 'active');
});

await testAsync('an agency can write its own profile', async () => {
  freshRun();
  const r = await call(account, {
    method: 'PATCH',
    headers: asAgent,
    body: {
      about: '  Glasgow, family run.  ', town: 'Glasgow', region: 'Lanarkshire',
      website: 'jetawaytravel.co.uk', foundedYear: '2011',
    },
  });
  assert.equal(r.status, 200);
  assert.equal(db.notifyAgent.about, 'Glasgow, family run.', 'trimmed');
  assert.equal(db.notifyAgent.town, 'Glasgow');
  assert.equal(db.notifyAgent.website, 'https://jetawaytravel.co.uk/', 'made absolute');
  assert.equal(db.notifyAgent.founded_year, 2011);
});

await testAsync('but NOT its own protection numbers or rate tier', async () => {
  freshRun();
  // The whole value of showing ATOL on an agency page is that we checked it.
  // A settings screen where an agency types its own is worth nothing.
  //
  // Compare against a snapshot rather than asserting the columns are absent.
  // Some of them ARE set on the fixture (rate_tier is 'standard'), and a test
  // that only passes while a column happens to be null stops testing anything
  // the moment somebody seeds it.
  const FORBIDDEN = ['atol_number', 'abta_number', 'protection_type', 'rate_tier', 'free_until'];
  const before = Object.fromEntries(FORBIDDEN.map((k) => [k, db.notifyAgent[k]]));
  await call(account, {
    method: 'PATCH',
    headers: asAgent,
    body: {
      about: 'Legitimate change', atolNumber: '99999', abtaNumber: 'FAKE',
      protectionType: 'ATOL', rateTier: 'premium', freeUntil: '2030-01-01',
    },
  });
  assert.equal(db.notifyAgent.about, 'Legitimate change', 'the allowed field went through');
  for (const forbidden of FORBIDDEN) {
    assert.equal(db.notifyAgent[forbidden], before[forbidden],
      `an agency wrote its own ${forbidden}`);
  }
});

await testAsync('a nonsense website or founding year is refused', async () => {
  freshRun();
  const bad = await call(account, {
    method: 'PATCH', headers: asAgent, body: { website: 'not a website' },
  });
  assert.equal(bad.status, 422);
  assert.equal(bad.json.errors[0].field, 'website');

  const year = await call(account, {
    method: 'PATCH', headers: asAgent, body: { foundedYear: '3200' },
  });
  assert.equal(year.status, 422);
  assert.equal(year.json.errors[0].field, 'foundedYear');
});

// ════════════════════════════════════════════════════════════════
// 7. the owner console
// ════════════════════════════════════════════════════════════════

async function ownerToken() {
  const r = await call(admin, {
    method: 'POST', query: { action: 'login' },
    body: { password: 'an-owner-password-long-enough' },
  });
  return r.json.token;
}

await testAsync('the owner console refuses the wrong password', async () => {
  freshRun();
  const r = await call(admin, {
    method: 'POST', query: { action: 'login' }, body: { password: 'wrong' },
  });
  assert.equal(r.status, 401);
  assert.ok(!r.json.token);
});

await testAsync('and refuses anyone with no token at all', async () => {
  freshRun();
  assert.equal((await call(admin, { method: 'GET' })).status, 401);
  assert.equal((await call(admin, { method: 'PATCH', body: { agentId: AGENT_ID } })).status, 401);
});

await testAsync('AN AGENT TOKEN IS NOT AN OWNER TOKEN', async () => {
  freshRun();
  // The whole reason the scope claim exists. Any agency holding a valid session
  // must not be able to reach the screen that sets what every agency is charged.
  const r = await call(admin, { method: 'GET', headers: asAgent });
  assert.equal(r.status, 401);
});

await testAsync('an owner token is not an agent token either', async () => {
  freshRun();
  const t = await ownerToken();
  const r = await call(account, {
    method: 'GET', headers: { authorization: `Bearer ${t}` },
  });
  assert.equal(r.status, 401, 'the owner must not be able to act as an agency');
});

await testAsync('the console lists every agency with what it is worth', async () => {
  freshRun();
  const t = await ownerToken();
  const r = await call(admin, { method: 'GET', headers: { authorization: `Bearer ${t}` } });
  assert.equal(r.status, 200);
  assert.equal(r.json.agencies.length, 1);
  assert.equal(r.json.agencies[0].name, 'Jetaway Travel');
  assert.equal(r.json.agencies[0].worthPence, 20500);
});

await testAsync('a free period can be set on one agency', async () => {
  freshRun();
  const t = await ownerToken();
  const r = await call(admin, {
    method: 'PATCH',
    headers: { authorization: `Bearer ${t}` },
    body: { agentId: AGENT_ID, freeUntil: '2027-01-31' },
  });
  assert.equal(r.status, 200);
  assert.equal(db.notifyAgent.free_until, '2027-01-31');
});

await testAsync('and cleared again, which starts charging from now', async () => {
  freshRun();
  db.notifyAgent.free_until = '2027-01-31';
  const t = await ownerToken();
  const r = await call(admin, {
    method: 'PATCH',
    headers: { authorization: `Bearer ${t}` },
    body: { agentId: AGENT_ID, clearFree: true },
  });
  assert.equal(r.status, 200);
  assert.equal(db.notifyAgent.free_until, null);
});

await testAsync('a nonsense date is refused rather than stored', async () => {
  freshRun();
  const t = await ownerToken();
  for (const freeUntil of ['31/01/2027', 'next spring', '2027-13-45']) {
    const r = await call(admin, {
      method: 'PATCH',
      headers: { authorization: `Bearer ${t}` },
      body: { agentId: AGENT_ID, freeUntil },
    });
    assert.equal(r.status, 422, freeUntil);
  }
  assert.equal(db.notifyAgent.free_until, null);
});

await testAsync('a rate tier outside the two we have is refused', async () => {
  freshRun();
  const t = await ownerToken();
  const r = await call(admin, {
    method: 'PATCH',
    headers: { authorization: `Bearer ${t}` },
    body: { agentId: AGENT_ID, rateTier: 'platinum' },
  });
  assert.equal(r.status, 422);
  assert.equal(db.notifyAgent.rate_tier, 'standard', 'nothing was written');
});

// ── report ──────────────────────────────────────────────────────
globalThis.fetch = realFetch;
await new Promise((r) => fakePg.close(r));
console.log(`\n${passed}/${passed + failures.length} passed`);
if (failures.length) {
  console.log('\nFailures:');
  for (const f of failures) console.log(`  ${f.name}: ${f.message}`);
  process.exit(1);
}
process.exit(0);
