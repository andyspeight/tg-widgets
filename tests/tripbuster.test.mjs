/**
 * Tripbuster test suite.
 *
 * ESM (.mjs) rather than the repo's usual .cjs because the modules under test are
 * ESM API routes; a CJS test cannot import them without a loader shim.
 *
 * Run: node tests/tripbuster.test.mjs
 *
 * Covers three layers:
 *   1. validateDeal        — pure input validation (whitelisting, enums, URLs, dates)
 *   2. agent tokens        — signing, tampering, expiry, scope confusion
 *   3. my-deals + login    — the HTTP handlers against an in-memory PostgREST stand-in,
 *                            which is what lets us prove cross-agent access is refused
 */
import http from 'node:http';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';

// ── env must be set before the modules under test are imported ──
// Both stand-ins are real HTTP servers on localhost rather than stubbed modules,
// so the code under test runs its actual fetch/parse/error paths. _redis.js in
// particular reads its env at module load, which is why this block comes first.
const FAKE_PG_PORT = 8331;
const FAKE_REDIS_PORT = 8332;
process.env.TRIPBUSTER_SUPABASE_URL = `http://127.0.0.1:${FAKE_PG_PORT}`;
process.env.TRIPBUSTER_SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
process.env.TRIPBUSTER_SESSION_SECRET = 'test-secret-that-is-definitely-long-enough-32';
process.env.UPSTASH_REDIS_REST_URL = `http://127.0.0.1:${FAKE_REDIS_PORT}`;
process.env.UPSTASH_REDIS_REST_TOKEN = 'test-redis-token';
process.env.RL_DISABLED = '1';

const { validateDeal } = await import('../api/_lib/tripbuster/deal-schema.js');
const { createAgentToken, verifyAgentToken } = await import('../api/_lib/tripbuster/auth.js');
const { default: myDeals } = await import('../api/tripbuster/my-deals.js');
const { default: login } = await import('../api/tripbuster/login.js');
const sheet = await import('../api/_lib/tripbuster/sheet.js');
const offerCache = await import('../api/_lib/tripbuster/offer-cache.js');
const { default: importHandler } = await import('../api/tripbuster/import.js');
const { default: offerImport } = await import('../api/tripbuster/offer-import.js');
const { default: account } = await import('../api/tripbuster/account.js');
const { default: leadHandler } = await import('../api/tripbuster/lead.js');
const { default: myLeads } = await import('../api/tripbuster/my-leads.js');
const { validateLead } = await import('../api/_lib/tripbuster/lead-schema.js');

// ── tiny test harness ───────────────────────────────────────────
let passed = 0;
const failures = [];
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`PASS  ${name}`);
  } catch (e) {
    failures.push({ name, message: e.message });
    console.log(`FAIL  ${name}\n      ${e.message}`);
  }
}
async function testAsync(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`PASS  ${name}`);
  } catch (e) {
    failures.push({ name, message: e.message });
    console.log(`FAIL  ${name}\n      ${e.message}`);
  }
}

// ════════════════════════════════════════════════════════════════
console.log('\n─── validateDeal ───');

test('title is required on create', () => {
  const r = validateDeal({});
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.field === 'title'));
});

test('unknown keys are dropped, so agent_id cannot be forged', () => {
  const r = validateDeal({ title: 'x', agent_id: 'someone-else', evil: 1, __proto__: { polluted: true } });
  assert.equal(r.ok, true);
  assert.equal(r.deal.agent_id, undefined);
  assert.equal(r.deal.evil, undefined);
  assert.equal(r.deal.polluted, undefined);
});

test('source cannot be forged through the payload', () => {
  const r = validateDeal({ title: 'x', source: 'live_cache' });
  assert.equal(r.deal.source, undefined);
});

test('status "expired" is refused (system-only transition)', () => {
  const r = validateDeal({ title: 'x', status: 'expired' });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.field === 'status'));
});

test('status "live" is accepted', () => {
  assert.equal(validateDeal({ title: 'x', status: 'live' }).deal.status, 'live');
});

test('board basis outside the enum is refused', () => {
  const r = validateDeal({ title: 'x', board_basis: 'All you can eat' });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.field === 'board_basis'));
});

test('javascript: booking link is refused', () => {
  const r = validateDeal({ title: 'x', clickout_url: 'javascript:alert(1)' });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.field === 'clickout_url'));
});

test('data: image URL is refused', () => {
  const r = validateDeal({ title: 'x', hero_image_url: 'data:text/html,<script>alert(1)</script>' });
  assert.equal(r.ok, false);
});

test('relative booking link is refused (must be absolute, it is a third-party site)', () => {
  const r = validateDeal({ title: 'x', clickout_url: '/book/benidorm' });
  assert.equal(r.ok, false);
});

test('https booking link is kept', () => {
  const r = validateDeal({ title: 'x', clickout_url: 'https://example.co.uk/book' });
  assert.equal(r.ok, true);
  assert.equal(r.deal.clickout_url, 'https://example.co.uk/book');
});

test('impossible date 2026-02-31 is refused rather than rolled forward', () => {
  const r = validateDeal({ title: 'x', travel_from: '2026-02-31' });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.field === 'travel_from'));
});

test('travel_until before travel_from is refused with a readable message', () => {
  const r = validateDeal({ title: 'x', travel_from: '2026-09-01', travel_until: '2026-08-01' });
  assert.equal(r.ok, false);
  assert.match(r.errors.find((e) => e.field === 'travel_until').message, /on or after/);
});

test('was_price below price_from is refused (would show a negative saving)', () => {
  const r = validateDeal({ title: 'x', price_from: 500, was_price: 400 });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.field === 'was_price'));
});

test('star rating is clamped into 1–5', () => {
  assert.equal(validateDeal({ title: 'x', star_rating: 99 }).deal.star_rating, 5);
  assert.equal(validateDeal({ title: 'x', star_rating: -3 }).deal.star_rating, 1);
});

test('non-numeric price is reported, not silently zeroed', () => {
  const r = validateDeal({ title: 'x', price_from: 'three hundred' });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.field === 'price_from'));
});

test('money is rounded to 2dp', () => {
  assert.equal(validateDeal({ title: 'x', price_from: 329.999 }).deal.price_from, 330);
});

test('arrays are de-duplicated and capped', () => {
  const r = validateDeal({ title: 'x', facilities: ['Pool', 'pool', 'POOL', 'Spa'] });
  assert.deepEqual(r.deal.facilities, ['Pool', 'Spa']);
  const many = validateDeal({ title: 'x', offer_badges: Array.from({ length: 50 }, (_, i) => `b${i}`) });
  assert.equal(many.deal.offer_badges.length, 8);
});

test('gallery keeps only valid absolute URLs', () => {
  const r = validateDeal({ title: 'x', gallery: ['https://a.co/1.jpg', 'javascript:1', '/rel.jpg', 'https://a.co/2.jpg'] });
  assert.deepEqual(r.deal.gallery, ['https://a.co/1.jpg', 'https://a.co/2.jpg']);
});

test('control characters are stripped from text', () => {
  const r = validateDeal({ title: 'Benidorm\u0000\u0007 deal' });
  assert.equal(r.deal.title, 'Benidorm deal');
});

test('over-long text is capped rather than rejected', () => {
  const r = validateDeal({ title: 'y'.repeat(500) });
  assert.equal(r.deal.title.length, 200);
});

test('partial mode touches only the keys supplied', () => {
  const r = validateDeal({ price_from: 199 }, { partial: true });
  assert.equal(r.ok, true);
  assert.deepEqual(Object.keys(r.deal), ['price_from']);
});

test('partial mode does not demand a title', () => {
  assert.equal(validateDeal({ strapline: 'new' }, { partial: true }).ok, true);
});

// ════════════════════════════════════════════════════════════════
console.log('\n─── agent tokens ───');

const AGENT_A = '11111111-1111-4111-8111-111111111111';
const AGENT_B = '22222222-2222-4222-8222-222222222222';

test('a freshly signed token verifies', () => {
  const t = createAgentToken({ agentId: AGENT_A, slug: 'a', plan: 'Boost', email: 'a@b.co' });
  assert.equal(verifyAgentToken(t).agentId, AGENT_A);
});

test('a tampered payload fails the signature check', () => {
  const t = createAgentToken({ agentId: AGENT_A, slug: 'a', plan: 'Boost' });
  const [encoded, sig] = t.split('.');
  const body = JSON.parse(Buffer.from(encoded, 'base64url').toString());
  body.agentId = AGENT_B; // try to become another agent
  const forged = `${Buffer.from(JSON.stringify(body)).toString('base64url')}.${sig}`;
  assert.equal(verifyAgentToken(forged), null);
});

test('an expired token is refused', () => {
  const body = { scope: 'tb-agent', agentId: AGENT_A, exp: Date.now() - 1000 };
  const encoded = Buffer.from(JSON.stringify(body)).toString('base64url');
  const sig = createHmac('sha256', process.env.TRIPBUSTER_SESSION_SECRET).update(encoded).digest('base64url');
  assert.equal(verifyAgentToken(`${encoded}.${sig}`), null);
});

test('a correctly signed token with the wrong scope is refused', () => {
  // Simulates a Travelgenix-style token even if both secrets were ever identical.
  const body = { scope: 'tg-client', agentId: AGENT_A, exp: Date.now() + 60000 };
  const encoded = Buffer.from(JSON.stringify(body)).toString('base64url');
  const sig = createHmac('sha256', process.env.TRIPBUSTER_SESSION_SECRET).update(encoded).digest('base64url');
  assert.equal(verifyAgentToken(`${encoded}.${sig}`), null);
});

test('garbage is refused without throwing', () => {
  assert.equal(verifyAgentToken('nonsense'), null);
  assert.equal(verifyAgentToken(''), null);
  assert.equal(verifyAgentToken(null), null);
  assert.equal(verifyAgentToken('a.b.c'), null);
});

// ════════════════════════════════════════════════════════════════
// In-memory PostgREST stand-in. Only the surface the handlers use.
// ════════════════════════════════════════════════════════════════
const db = { agents: [], deals: [], clicks: [], impressions: {}, import_runs: [], leads: [] };
let dealSeq = 0;
const uuid = (n) => `${String(n).padStart(8, '0')}-0000-4000-8000-000000000000`;

function resetDb() {
  dealSeq = 0;
  db.clicks = [];
  db.impressions = {};
  db.import_runs = [];
  db.leads = [];
  db.agent_hours = [];
  db.agent_special_days = [];
  db.agent_phones = [];
  db.agents = [
    { id: AGENT_A, slug: 'agent-a', name: 'Agent A', email: 'a@b.co', plan: 'Boost', status: 'active',
      default_clickout_url: 'https://agent-a.co.uk', atol_number: '11111', abta_number: null,
      protection_type: 'ATOL', password_hash: null, phone: '01204 555 118',
      billing_mode: 'click', call_min_seconds: 60,
      time_zone: 'Europe/London', hours_mode: 'always', closed_behaviour: 'callback' },
    { id: AGENT_B, slug: 'agent-b', name: 'Agent B', email: 'b@b.co', plan: 'Spark', status: 'active',
      default_clickout_url: null, atol_number: '22222', abta_number: null,
      protection_type: 'ATOL', password_hash: null, phone: null,
      billing_mode: 'click', call_min_seconds: 60,
      time_zone: 'Europe/London', hours_mode: 'always', closed_behaviour: 'callback' },
  ];
  db.deals = [
    { id: uuid(++dealSeq), agent_id: AGENT_A, status: 'live', title: 'A live deal',
      price_from: 329, clickout_url: 'https://agent-a.co.uk/1', updated_at: '2026-07-01T00:00:00Z' },
    { id: uuid(++dealSeq), agent_id: AGENT_B, status: 'live', title: 'B live deal',
      price_from: 199, clickout_url: 'https://agent-b.co.uk/1', updated_at: '2026-07-02T00:00:00Z' },
  ];
}

function matches(row, query) {
  for (const [k, v] of query.entries()) {
    if (['select', 'order', 'limit', 'offset'].includes(k)) continue;
    // The importers filter on external_ref being present, so the stand-in has to
    // understand it — otherwise it would return every row and the dedupe tests
    // would pass for the wrong reason.
    if (v === 'not.is.null') {
      if (row[k] === null || row[k] === undefined) return false;
      continue;
    }
    if (v === 'is.null') {
      if (!(row[k] === null || row[k] === undefined)) return false;
      continue;
    }
    if (!v.startsWith('eq.')) continue;
    if (String(row[k] ?? '') !== v.slice(3)) return false;
  }
  return true;
}

const fakePg = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => { raw += c; });
  req.on('end', () => {
    const url = new URL(req.url, `http://127.0.0.1:${FAKE_PG_PORT}`);
    const send = (code, obj) => {
      res.writeHead(code, { 'Content-Type': 'application/json' });
      res.end(obj === undefined ? '' : JSON.stringify(obj));
    };
    if (req.headers.apikey !== process.env.TRIPBUSTER_SUPABASE_SERVICE_ROLE_KEY) return send(401, { message: 'no key' });

    const table = url.pathname.replace('/rest/v1/', '');
    const body = raw ? JSON.parse(raw) : null;

    if (table === 'rpc/tb_agent_deal_counts') {
      const mine = db.deals.filter((d) => d.agent_id === body.p_agent_id);
      return send(200, {
        live: mine.filter((d) => d.status === 'live').length,
        draft: mine.filter((d) => d.status === 'draft').length,
        paused: mine.filter((d) => d.status === 'paused').length,
        expired: 0,
        total: mine.length,
      });
    }

    // Callback requests: writes the lead AND its billable event, exactly as
    // tb_record_lead does, so the inbox and the meter cannot disagree.
    if (table === 'rpc/tb_record_lead') {
      const deal = db.deals.find((d) => d.id === body.p_deal_id);
      if (!deal) return send(200, null);
      const agent = db.agents.find((a) => a.id === deal.agent_id);
      const dup = db.clicks.some((c) => c.deal_id === deal.id && c.event_type === 'lead'
        && c.caller_hash && c.caller_hash === body.p_contact_hash && c.is_billable);
      const lead = {
        id: uuid(++dealSeq), agent_id: deal.agent_id, deal_id: deal.id, deal_title: deal.title,
        name: body.p_name, phone: body.p_phone, email: body.p_email, message: body.p_message,
        preferred_time: body.p_preferred_time, status: 'new', created_at: new Date().toISOString(),
      };
      db.leads.push(lead);
      const billable = !(body.p_suspect_bot || dup);
      db.clicks.push({
        deal_id: deal.id, agent_id: deal.agent_id, event_type: 'lead',
        caller_hash: body.p_contact_hash, is_billable: billable,
      });
      return send(200, {
        recorded: true, leadId: lead.id, agentName: agent && agent.name,
        dealTitle: deal.title, billable,
      });
    }

    if (table === 'rpc/tb_agent_lead_counts') {
      const mine = db.leads.filter((l) => l.agent_id === body.p_agent_id);
      const by = (st) => mine.filter((l) => l.status === st).length;
      return send(200, {
        new: by('new'), contacted: by('contacted'), booked: by('booked'),
        not_interested: by('not_interested'), junk: by('junk'), total: mine.length,
      });
    }

    // Mirrors tb_record_click closely enough to exercise the handler: unknown
    // deals return null, and a repeat from the same hashed IP is not billable.
    if (table === 'rpc/tb_record_click') {
      const deal = db.deals.find((d) => d.id === body.p_deal_id);
      if (!deal) return send(200, null);
      const agent = db.agents.find((a) => a.id === deal.agent_id);
      const dup = db.clicks.some((c) => c.deal_id === deal.id && c.ip_hash === body.p_ip_hash && c.is_billable);
      const billable = !(body.p_suspect_bot || dup);
      db.clicks.push({
        deal_id: deal.id, agent_id: deal.agent_id, surface: body.p_surface,
        ip_hash: body.p_ip_hash, ua_family: body.p_ua_family,
        referrer_host: body.p_referrer_host, country_code: body.p_country_code, is_billable: billable,
      });
      return send(200, {
        recorded: true, billable, duplicate: dup,
        clickoutUrl: deal.clickout_url || (agent && agent.default_clickout_url) || null,
      });
    }

    if (table === 'rpc/tb_record_impressions') {
      const ids = [...new Set(body.p_deal_ids || [])].slice(0, 60);
      const hits = ids.filter((id) => db.deals.some((d) => d.id === id));
      hits.forEach((id) => { db.impressions[id] = (db.impressions[id] || 0) + 1; });
      return send(200, hits.length);
    }

    // Added by migration 007, for "8 of your deals are set differently".
    if (table === 'rpc/tb_agent_billing_counts') {
      const agent = db.agents.find((a) => a.id === body.p_agent_id);
      const mine = db.deals.filter((d) => d.agent_id === body.p_agent_id);
      const resolved = (d) => d.billing_mode || (agent && agent.billing_mode) || 'click';
      return send(200, {
        click: mine.filter((d) => resolved(d) === 'click').length,
        call: mine.filter((d) => resolved(d) === 'call').length,
        both: mine.filter((d) => resolved(d) === 'both').length,
        overridden: mine.filter((d) => !!d.billing_mode).length,
        total: mine.length,
      });
    }

    // Added by migration 009. The same shape the consumer site receives, with
    // the agency's primary number first and the extras after it.
    if (table === 'rpc/tb_agent_contact') {
      const agent = db.agents.find((a) => a.id === body.p_agent_id);
      if (!agent) return send(200, null);
      return send(200, {
        timeZone: agent.time_zone || 'Europe/London',
        hoursMode: agent.hours_mode || 'always',
        closedBehaviour: agent.closed_behaviour || 'callback',
        phones: (agent.phone
          ? [{ label: 'Main number', phone: agent.phone, whenShown: 'always' }] : [])
          .concat(db.agent_phones
            .filter((p) => p.agent_id === agent.id)
            .sort((x, y) => x.sort_order - y.sort_order)
            .map((p) => ({ label: p.label, phone: p.phone, whenShown: p.when_shown }))),
        hours: db.agent_hours
          .filter((h) => h.agent_id === agent.id)
          .map((h) => ({ day: h.day_of_week, opens: h.opens, closes: h.closes }))
          .sort((x, y) => (x.day - y.day) || x.opens.localeCompare(y.opens)),
        specialDays: db.agent_special_days
          .filter((s) => s.agent_id === agent.id)
          .map((s) => ({ date: s.on_date, opens: s.opens, closes: s.closes, note: s.note }))
          .sort((x, y) => x.date.localeCompare(y.date)),
      });
    }

    // Added by migration 009. The real one is one transaction; the stand-in is
    // synchronous, which gives it the same all-or-nothing behaviour for free.
    if (table === 'rpc/tb_save_agent_settings') {
      const agent = db.agents.find((a) => a.id === body.p_agent_id);
      if (!agent) return send(200, null);
      if (body.p_billing_mode !== null && body.p_billing_mode !== undefined) {
        agent.billing_mode = body.p_billing_mode;
      }
      if (body.p_call_min_seconds !== null && body.p_call_min_seconds !== undefined) {
        agent.call_min_seconds = body.p_call_min_seconds;
      }
      if (body.p_clear_phone) agent.phone = null;
      else if (body.p_phone !== null && body.p_phone !== undefined) agent.phone = body.p_phone;
      if (body.p_time_zone) agent.time_zone = body.p_time_zone;
      if (body.p_hours_mode) agent.hours_mode = body.p_hours_mode;
      if (body.p_closed_behaviour) agent.closed_behaviour = body.p_closed_behaviour;

      if (Array.isArray(body.p_hours)) {
        db.agent_hours = db.agent_hours.filter((h) => h.agent_id !== agent.id)
          .concat(body.p_hours.map((h) => ({
            agent_id: agent.id, day_of_week: h.day, opens: h.opens, closes: h.closes,
          })));
      }
      if (Array.isArray(body.p_special_days)) {
        db.agent_special_days = db.agent_special_days.filter((s) => s.agent_id !== agent.id)
          .concat(body.p_special_days.map((s) => ({
            agent_id: agent.id, on_date: s.date, opens: s.opens, closes: s.closes, note: s.note,
          })));
      }
      if (Array.isArray(body.p_phones)) {
        db.agent_phones = db.agent_phones.filter((p) => p.agent_id !== agent.id)
          .concat(body.p_phones.map((p, i) => ({
            agent_id: agent.id, label: p.label, phone: p.phone,
            when_shown: p.whenShown, sort_order: p.sortOrder ?? i,
          })));
      }
      return send(200, {
        billingMode: agent.billing_mode,
        callMinSeconds: agent.call_min_seconds,
        phone: agent.phone || '',
        contact: null,
      });
    }

    // Added by migration 006, for the "where did my deals come from" line.
    if (table === 'rpc/tb_agent_source_counts') {
      const mine = db.deals.filter((d) => d.agent_id === body.p_agent_id);
      return send(200, {
        manual: mine.filter((d) => (d.source || 'manual') === 'manual').length,
        spreadsheet: mine.filter((d) => d.source === 'spreadsheet').length,
        live_cache: mine.filter((d) => d.source === 'live_cache').length,
        total: mine.length,
      });
    }

    if (table === 'rpc/tb_agent_stats') {
      return send(200, {
        days: body.p_days, impressions: 6498, clicks: 150, billableClicks: 132, ctr: 2.31,
        perDeal: Object.fromEntries(db.deals
          .filter((d) => d.agent_id === body.p_agent_id)
          .map((d) => [d.id, { impressions: 3249, clicks: 75 }])),
      });
    }

    const store = db[table];
    if (!store) return send(404, { message: 'no table' });

    if (req.method === 'GET') return send(200, store.filter((r) => matches(r, url.searchParams)));
    if (req.method === 'POST') {
      const rows = (Array.isArray(body) ? body : [body]).map((r) => ({ id: uuid(++dealSeq), ...r }));
      // Enforce the unique (agent_id, external_ref) index from migration 006, so
      // the importers' duplicate handling is exercised for real instead of being
      // taken on trust. Postgres rejects the whole statement, so this does too.
      if (table === 'deals') {
        const clash = rows.some((r) => r.external_ref && (
          db.deals.some((d) => d.agent_id === r.agent_id && d.external_ref === r.external_ref)
          || rows.filter((o) => o.agent_id === r.agent_id && o.external_ref === r.external_ref).length > 1
        ));
        if (clash) return send(409, { message: 'duplicate key value violates unique constraint' });
      }
      store.push(...rows);
      return send(201, rows);
    }
    if (req.method === 'PATCH') {
      const hit = store.filter((r) => matches(r, url.searchParams));
      hit.forEach((r) => Object.assign(r, body));
      return send(200, hit);
    }
    if (req.method === 'DELETE') {
      const hit = store.filter((r) => matches(r, url.searchParams));
      db[table] = store.filter((r) => !hit.includes(r));
      return send(200, hit);
    }
    return send(405, { message: 'nope' });
  });
});

await new Promise((r) => fakePg.listen(FAKE_PG_PORT, r));

// ── stand-in for the Travelgenix offer cache (Upstash REST) ─────────────────
// api/_redis.js does GET {URL}/{command}/{urlencoded args} with a bearer token
// and reads `result` off the JSON. Emulating that, rather than stubbing the
// offer-cache module, means the live-cache route runs its real Redis path
// including configured(), the URL encoding and the JSON parsing.
const redisStore = new Map();

const fakeRedis = http.createServer((req, res) => {
  const send = (code, obj) => {
    res.writeHead(code, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(obj));
  };
  if (req.headers.authorization !== `Bearer ${process.env.UPSTASH_REDIS_REST_TOKEN}`) {
    return send(401, { error: 'no token' });
  }
  const segs = req.url.split('?')[0].split('/').filter(Boolean).map(decodeURIComponent);
  const [command, ...args] = segs;
  if (command === 'get') return send(200, { result: redisStore.get(args.join('/')) ?? null });
  if (command === 'keys') {
    const re = new RegExp(`^${args[0].replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`);
    return send(200, { result: [...redisStore.keys()].filter((k) => re.test(k)) });
  }
  return send(200, { result: null });
});
await new Promise((r) => fakeRedis.listen(FAKE_REDIS_PORT, r));

/** Load the offer cache stand-in with country keys holding the given offers. */
function seedOfferCache(byCountry) {
  redisStore.clear();
  for (const [key, offers] of Object.entries(byCountry)) {
    redisStore.set(key, JSON.stringify({ refreshedAt: '2026-07-26T09:00:00Z', offers }));
  }
}

/** Invoke a handler with a Vercel-shaped req/res and capture the result. */
async function call(handler, { method = 'GET', query = {}, body = null, token = null } = {}) {
  const req = { method, query, body, headers: token ? { authorization: `Bearer ${token}` } : {} };
  let status = 200;
  let payload;
  const res = {
    _h: {},
    setHeader(k, v) { this._h[k.toLowerCase()] = v; },
    getHeader(k) { return this._h[k.toLowerCase()]; },
    status(c) { status = c; return this; },
    json(o) { payload = o; return this; },
    // The import route serves the CSV template through send() rather than json().
    send(o) { payload = o; return this; },
    end() { return this; },
  };
  await handler(req, res);
  return { status, body: payload, headers: res._h };
}

console.log('\n─── my-deals: access control ───');

const tokenA = createAgentToken({ agentId: AGENT_A, slug: 'agent-a', plan: 'Boost', email: 'a@b.co' });
const tokenB = createAgentToken({ agentId: AGENT_B, slug: 'agent-b', plan: 'Spark', email: 'b@b.co' });

await testAsync('no token → 401', async () => {
  resetDb();
  const r = await call(myDeals);
  assert.equal(r.status, 401);
});

await testAsync('tampered token → 401', async () => {
  resetDb();
  const r = await call(myDeals, { token: `${tokenA.split('.')[0]}.deadbeef` });
  assert.equal(r.status, 401);
});

await testAsync('GET returns only this agent\'s deals', async () => {
  resetDb();
  const r = await call(myDeals, { token: tokenA });
  assert.equal(r.status, 200);
  assert.equal(r.body.deals.length, 1);
  assert.equal(r.body.deals[0].title, 'A live deal');
});

await testAsync('GET reports an unlimited allowance, because nobody is capped', async () => {
  resetDb();
  const r = await call(myDeals, { token: tokenA });
  assert.equal(r.body.liveAllowance, -1);  // -1 is unlimited, on every plan
  assert.equal(r.body.liveRemaining, -1);
  assert.equal(r.body.counts.live, 1);
});

await testAsync('PATCH on another agent\'s deal → 404, and the row is untouched', async () => {
  resetDb();
  const bDeal = db.deals.find((d) => d.agent_id === AGENT_B);
  const r = await call(myDeals, { method: 'PATCH', token: tokenA, query: { id: bDeal.id }, body: { title: 'hijacked' } });
  assert.equal(r.status, 404);
  assert.equal(db.deals.find((d) => d.id === bDeal.id).title, 'B live deal');
});

await testAsync('DELETE on another agent\'s deal → 404, and the row survives', async () => {
  resetDb();
  const bDeal = db.deals.find((d) => d.agent_id === AGENT_B);
  const r = await call(myDeals, { method: 'DELETE', token: tokenA, query: { id: bDeal.id } });
  assert.equal(r.status, 404);
  assert.ok(db.deals.some((d) => d.id === bDeal.id));
});

await testAsync('PATCH on own deal succeeds', async () => {
  resetDb();
  const aDeal = db.deals.find((d) => d.agent_id === AGENT_A);
  const r = await call(myDeals, { method: 'PATCH', token: tokenA, query: { id: aDeal.id }, body: { title: 'Renamed' } });
  assert.equal(r.status, 200);
  assert.equal(db.deals.find((d) => d.id === aDeal.id).title, 'Renamed');
});

await testAsync('DELETE on own deal succeeds', async () => {
  resetDb();
  const aDeal = db.deals.find((d) => d.agent_id === AGENT_A);
  const r = await call(myDeals, { method: 'DELETE', token: tokenA, query: { id: aDeal.id } });
  assert.equal(r.status, 200);
  assert.ok(!db.deals.some((d) => d.id === aDeal.id));
});

await testAsync('a non-uuid id is rejected before touching the database', async () => {
  resetDb();
  const r = await call(myDeals, { method: 'PATCH', token: tokenA, query: { id: 'or-1=1' }, body: { title: 'x' } });
  assert.equal(r.status, 400);
});

console.log('\n─── my-deals: create and publish rules ───');

await testAsync('POST creates a draft owned by the token holder', async () => {
  resetDb();
  const r = await call(myDeals, { method: 'POST', token: tokenA, body: { title: 'New draft', resort: 'Benidorm' } });
  assert.equal(r.status, 201);
  const created = db.deals.find((d) => d.title === 'New draft');
  assert.equal(created.agent_id, AGENT_A);
  assert.equal(created.source, 'manual');
});

await testAsync('POST ignores an agent_id supplied in the body', async () => {
  resetDb();
  await call(myDeals, { method: 'POST', token: tokenA, body: { title: 'Sneaky', agent_id: AGENT_B } });
  assert.equal(db.deals.find((d) => d.title === 'Sneaky').agent_id, AGENT_A);
});

await testAsync('POST inherits the agent\'s booking link and ATOL when blank', async () => {
  resetDb();
  await call(myDeals, { method: 'POST', token: tokenA, body: { title: 'Inherits' } });
  const created = db.deals.find((d) => d.title === 'Inherits');
  assert.equal(created.clickout_url, 'https://agent-a.co.uk');
  assert.equal(created.atol_number, '11111');
});

await testAsync('POST live without a price → 422 explaining what is missing', async () => {
  resetDb();
  const r = await call(myDeals, { method: 'POST', token: tokenA, body: { title: 'No price', status: 'live' } });
  assert.equal(r.status, 422);
  assert.ok(r.body.errors.some((e) => e.field === 'price_from'));
});

await testAsync('POST live with no link anywhere → 422 mentioning the default website', async () => {
  resetDb();
  // Agent B has no default_clickout_url
  const r = await call(myDeals, { method: 'POST', token: tokenB, body: { title: 'No link', status: 'live', price_from: 200 } });
  assert.equal(r.status, 422);
  assert.match(r.body.errors.find((e) => e.field === 'clickout_url').message, /default website/);
});

// The capping machinery survives the decision to cap nobody, so that one number
// reimposes a limit if an agency ever floods the index. Machinery that can never
// fire is machinery nobody notices has broken, so exercise it directly with a
// temporary limit rather than trusting it will still work when it is wanted.
{
  const { LIVE_DEAL_LIMITS, allowanceFor, publishHeadroom } =
    await import('../api/_lib/tripbuster/deal-write.js');

  test('every plan is unlimited today', () => {
    for (const plan of ['Spark', 'Boost', 'Ignite', 'Bespoke']) {
      assert.equal(allowanceFor(plan), -1, `${plan} is capped`);
      assert.equal(publishHeadroom(plan, 500), Infinity);
    }
  });

  test('an unknown plan still fails closed', () => {
    assert.equal(allowanceFor('Platinum'), 0);
    assert.equal(publishHeadroom('Platinum', 0), 0);
  });

  test('but a cap still works the moment a number is put back', () => {
    const was = LIVE_DEAL_LIMITS.Spark;
    try {
      LIVE_DEAL_LIMITS.Spark = 3;
      assert.equal(publishHeadroom('Spark', 0), 3);
      assert.equal(publishHeadroom('Spark', 2), 1);
      assert.equal(publishHeadroom('Spark', 9), 0, 'never goes negative');
    } finally {
      LIVE_DEAL_LIMITS.Spark = was;
    }
  });
}

await testAsync('POST live is NOT blocked, however many the agency already has', async () => {
  resetDb();
  // Agent B is on Spark, the smallest plan, and already has a live deal. Under
  // the old caps this was the refusal case. It must now go through: we are paid
  // per click, per call and per enquiry, so a deal an agency cannot publish is
  // revenue neither of us earns.
  const r = await call(myDeals, {
    method: 'POST', token: tokenB,
    body: { title: 'Second live', status: 'live', price_from: 250, clickout_url: 'https://agent-b.co.uk/2' },
  });
  assert.equal(r.status, 201);
  assert.ok(db.deals.find((d) => d.title === 'Second live').published_at);
});

await testAsync('POST live succeeds while allowance remains, and stamps published_at', async () => {
  resetDb();
  const r = await call(myDeals, {
    method: 'POST', token: tokenA,
    body: { title: 'Within allowance', status: 'live', price_from: 300, clickout_url: 'https://agent-a.co.uk/2' },
  });
  assert.equal(r.status, 201);
  assert.ok(db.deals.find((d) => d.title === 'Within allowance').published_at);
});

await testAsync('PATCH draft → live is not capped either', async () => {
  resetDb();
  // Agent B on Spark, already live, publishing another. The other half of the
  // same rule: a cap removed on create but left on publish would just move the
  // wall somewhere less obvious.
  db.deals.push({ id: uuid(++dealSeq), agent_id: AGENT_B, status: 'draft', title: 'B draft', price_from: 150, clickout_url: 'https://agent-b.co.uk/d' });
  const draft = db.deals.find((d) => d.title === 'B draft');
  const r = await call(myDeals, { method: 'PATCH', token: tokenB, query: { id: draft.id }, body: { status: 'live' } });
  assert.equal(r.status, 200);
  assert.equal(db.deals.find((d) => d.id === draft.id).status, 'live');
});

await testAsync('PATCH with nothing usable → 400', async () => {
  resetDb();
  const aDeal = db.deals.find((d) => d.agent_id === AGENT_A);
  const r = await call(myDeals, { method: 'PATCH', token: tokenA, query: { id: aDeal.id }, body: {} });
  assert.equal(r.status, 400);
});

await testAsync('unsupported method → 405', async () => {
  resetDb();
  const r = await call(myDeals, { method: 'PUT', token: tokenA });
  assert.equal(r.status, 405);
});

await testAsync('responses are never cached', async () => {
  resetDb();
  const r = await call(myDeals, { token: tokenA });
  assert.match(r.headers['cache-control'], /no-store/);
});

console.log('\n─── login ───');

const bcrypt = (await import('bcryptjs')).default;

await testAsync('correct credentials return a usable token', async () => {
  resetDb();
  db.agents[0].password_hash = bcrypt.hashSync('right-password', 10);
  const r = await call(login, { method: 'POST', body: { email: 'a@b.co', password: 'right-password' } });
  assert.equal(r.status, 200);
  assert.equal(verifyAgentToken(r.body.token).agentId, AGENT_A);
});

await testAsync('the token response never includes the password hash', async () => {
  resetDb();
  db.agents[0].password_hash = bcrypt.hashSync('right-password', 10);
  const r = await call(login, { method: 'POST', body: { email: 'a@b.co', password: 'right-password' } });
  assert.equal(JSON.stringify(r.body).includes('$2a$'), false);
  assert.equal(r.body.agent.password_hash, undefined);
});

await testAsync('wrong password → 401 with a generic message', async () => {
  resetDb();
  db.agents[0].password_hash = bcrypt.hashSync('right-password', 10);
  const r = await call(login, { method: 'POST', body: { email: 'a@b.co', password: 'nope' } });
  assert.equal(r.status, 401);
  assert.equal(r.body.error, 'Those details do not match an account');
});

await testAsync('unknown email gives the same message as a wrong password', async () => {
  resetDb();
  const r = await call(login, { method: 'POST', body: { email: 'nobody@nowhere.co', password: 'x' } });
  assert.equal(r.status, 401);
  assert.equal(r.body.error, 'Those details do not match an account');
});

await testAsync('a suspended account is refused even with the right password', async () => {
  resetDb();
  db.agents[0].password_hash = bcrypt.hashSync('right-password', 10);
  db.agents[0].status = 'suspended';
  const r = await call(login, { method: 'POST', body: { email: 'a@b.co', password: 'right-password' } });
  assert.equal(r.status, 403);
});

await testAsync('a pending account is told it is still being set up', async () => {
  resetDb();
  db.agents[0].password_hash = bcrypt.hashSync('right-password', 10);
  db.agents[0].status = 'pending';
  const r = await call(login, { method: 'POST', body: { email: 'a@b.co', password: 'right-password' } });
  assert.equal(r.status, 403);
  assert.match(r.body.error, /being set up/);
});

await testAsync('missing fields → 400', async () => {
  resetDb();
  assert.equal((await call(login, { method: 'POST', body: { email: 'a@b.co' } })).status, 400);
});

await testAsync('GET on login → 405', async () => {
  assert.equal((await call(login, { method: 'GET' })).status, 405);
});

// ════════════════════════════════════════════════════════════════
console.log('\n─── visitor fingerprinting (privacy) ───');

const { ipHash, userAgentInfo, referrerHost, countryCode } = await import('../api/_lib/tripbuster/visitor.js');

const reqWith = (headers) => ({ headers, socket: { remoteAddress: '203.0.113.7' } });
const CHROME = 'Mozilla/5.0 (Macintosh) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';

test('the raw IP never appears in the stored hash', () => {
  const h = ipHash(reqWith({ 'x-forwarded-for': '203.0.113.7' }));
  assert.ok(h && h.length === 40);
  assert.equal(h.includes('203.0.113.7'), false);
});

test('the same IP hashes consistently, so de-duplication works', () => {
  const a = ipHash(reqWith({ 'x-forwarded-for': '203.0.113.7' }));
  const b = ipHash(reqWith({ 'x-forwarded-for': '203.0.113.7' }));
  assert.equal(a, b);
});

test('different IPs hash differently, so visitors are told apart', () => {
  const a = ipHash(reqWith({ 'x-forwarded-for': '203.0.113.7' }));
  const b = ipHash(reqWith({ 'x-forwarded-for': '198.51.100.4' }));
  assert.notEqual(a, b);
});

test('the hash is salted, not a bare SHA of the address', () => {
  // An unsalted hash of the small IPv4 space is trivially reversible, so the
  // stored value must not match a plain digest of the IP.
  const plain = createHmac('sha256', '').update('203.0.113.7').digest('hex').slice(0, 40);
  assert.notEqual(ipHash(reqWith({ 'x-forwarded-for': '203.0.113.7' })), plain);
});

test('browsers are bucketed coarsely, not stored verbatim', () => {
  const r = userAgentInfo(reqWith({ 'user-agent': CHROME }));
  assert.equal(r.family, 'chrome');
  assert.equal(r.bot, false);
});

test('declared crawlers are flagged as bots', () => {
  assert.equal(userAgentInfo(reqWith({ 'user-agent': 'Mozilla/5.0 (compatible; Googlebot/2.1)' })).bot, true);
  assert.equal(userAgentInfo(reqWith({ 'user-agent': 'python-requests/2.31.0' })).bot, true);
  assert.equal(userAgentInfo(reqWith({ 'user-agent': 'curl/8.4.0' })).bot, true);
  assert.equal(userAgentInfo(reqWith({ 'user-agent': 'HeadlessChrome/120' })).bot, true);
});

test('a missing user agent is treated as suspect', () => {
  assert.equal(userAgentInfo(reqWith({})).bot, true);
});

test('only the referring host is kept, never the path or query', () => {
  const h = referrerHost(reqWith({ referer: 'https://agent.co.uk/deals?utm_source=x&email=a@b.co' }));
  assert.equal(h, 'agent.co.uk');
});

test('a malformed referrer is dropped rather than stored', () => {
  assert.equal(referrerHost(reqWith({ referer: 'not a url' })), null);
});

test('only a two-letter country code is accepted', () => {
  assert.equal(countryCode(reqWith({ 'x-vercel-ip-country': 'gb' })), 'GB');
  assert.equal(countryCode(reqWith({ 'x-vercel-ip-country': 'nonsense' })), null);
});

// ════════════════════════════════════════════════════════════════
console.log('\n─── click-out recorder (the billable event) ───');

const { default: clickHandler } = await import('../api/tripbuster/click.js');
const { default: impressionsHandler } = await import('../api/tripbuster/impressions.js');

/** Call a public tracking handler with headers, since the UA and IP matter here. */
async function callPublic(handler, { method = 'POST', body = null, query = {}, headers = {} } = {}) {
  const req = { method, query, body, headers: Object.assign({ 'user-agent': CHROME, 'x-forwarded-for': '203.0.113.7' }, headers), socket: { remoteAddress: '203.0.113.7' } };
  let status = 200;
  let payload;
  const res = {
    _h: {},
    setHeader(k, v) { this._h[k.toLowerCase()] = v; },
    getHeader(k) { return this._h[k.toLowerCase()]; },
    status(c) { status = c; return this; },
    json(o) { payload = o; return this; },
    end() { return this; },
  };
  await handler(req, res);
  return { status, body: payload, headers: res._h };
}

await testAsync('a click is recorded and the booking URL comes back', async () => {
  resetDb();
  const deal = db.deals.find((d) => d.agent_id === AGENT_A);
  const r = await callPublic(clickHandler, { body: { dealId: deal.id, surface: 'widget' } });
  assert.equal(r.status, 200);
  assert.equal(r.body.recorded, true);
  assert.equal(r.body.clickoutUrl, deal.clickout_url);
  assert.equal(db.clicks.length, 1);
  assert.equal(db.clicks[0].is_billable, true);
});

await testAsync('whether a click is billable is never exposed to the caller', async () => {
  resetDb();
  const deal = db.deals.find((d) => d.agent_id === AGENT_A);
  const r = await callPublic(clickHandler, { body: { dealId: deal.id } });
  assert.equal('billable' in r.body, false);
  assert.equal('duplicate' in r.body, false);
});

await testAsync('a repeat click from the same visitor is recorded but not billable', async () => {
  resetDb();
  const deal = db.deals.find((d) => d.agent_id === AGENT_A);
  await callPublic(clickHandler, { body: { dealId: deal.id } });
  await callPublic(clickHandler, { body: { dealId: deal.id } });
  assert.equal(db.clicks.length, 2, 'both clicks kept for visibility');
  assert.equal(db.clicks.filter((c) => c.is_billable).length, 1, 'agent billed once');
});

await testAsync('a crawler click is recorded but not billable', async () => {
  resetDb();
  const deal = db.deals.find((d) => d.agent_id === AGENT_A);
  await callPublic(clickHandler, { body: { dealId: deal.id }, headers: { 'user-agent': 'Googlebot/2.1' } });
  assert.equal(db.clicks.length, 1);
  assert.equal(db.clicks[0].is_billable, false);
});

await testAsync('a raw IP is never written to the click row', async () => {
  resetDb();
  const deal = db.deals.find((d) => d.agent_id === AGENT_A);
  await callPublic(clickHandler, { body: { dealId: deal.id } });
  assert.equal(JSON.stringify(db.clicks[0]).includes('203.0.113.7'), false);
});

await testAsync('only the referring host is stored, not the full URL', async () => {
  resetDb();
  const deal = db.deals.find((d) => d.agent_id === AGENT_A);
  await callPublic(clickHandler, {
    body: { dealId: deal.id },
    headers: { referer: 'https://agent.co.uk/page?email=someone@example.com' },
  });
  assert.equal(db.clicks[0].referrer_host, 'agent.co.uk');
  assert.equal(JSON.stringify(db.clicks[0]).includes('example.com'), false);
});

await testAsync('a sendBeacon text/plain body is parsed', async () => {
  resetDb();
  const deal = db.deals.find((d) => d.agent_id === AGENT_A);
  // Beacons arrive as a string, not a parsed object.
  const r = await callPublic(clickHandler, { body: JSON.stringify({ dealId: deal.id, surface: 'widget' }) });
  assert.equal(r.status, 200);
  assert.equal(db.clicks.length, 1);
});

await testAsync('an unknown deal id is a 404 and records nothing', async () => {
  resetDb();
  const r = await callPublic(clickHandler, { body: { dealId: uuid(999) } });
  assert.equal(r.status, 404);
  assert.equal(db.clicks.length, 0);
});

await testAsync('a non-uuid deal id is rejected before the database', async () => {
  resetDb();
  const r = await callPublic(clickHandler, { body: { dealId: "'; delete from deals; --" } });
  assert.equal(r.status, 400);
  assert.equal(db.clicks.length, 0);
});

await testAsync('an unknown surface is coerced rather than rejected', async () => {
  resetDb();
  const deal = db.deals.find((d) => d.agent_id === AGENT_A);
  await callPublic(clickHandler, { body: { dealId: deal.id, surface: 'made-up' } });
  assert.equal(db.clicks[0].surface, 'site');
});

await testAsync('clicks are never cached', async () => {
  resetDb();
  const deal = db.deals.find((d) => d.agent_id === AGENT_A);
  const r = await callPublic(clickHandler, { body: { dealId: deal.id } });
  assert.match(r.headers['cache-control'], /no-store/);
});

await testAsync('GET on the click endpoint → 405', async () => {
  assert.equal((await callPublic(clickHandler, { method: 'GET' })).status, 405);
});

console.log('\n─── impressions ───');

await testAsync('a batch of impressions is recorded in one call', async () => {
  resetDb();
  const ids = db.deals.map((d) => d.id);
  const r = await callPublic(impressionsHandler, { body: { dealIds: ids } });
  assert.equal(r.status, 200);
  assert.equal(r.body.recorded, 2);
});

await testAsync('repeated ids in one call count once', async () => {
  resetDb();
  const id = db.deals[0].id;
  const r = await callPublic(impressionsHandler, { body: { dealIds: [id, id, id, id] } });
  assert.equal(r.body.recorded, 1);
  assert.equal(db.impressions[id], 1);
});

await testAsync('invalid ids are filtered out', async () => {
  resetDb();
  const r = await callPublic(impressionsHandler, { body: { dealIds: ['nope', 123, null, db.deals[0].id] } });
  assert.equal(r.body.recorded, 1);
});

await testAsync('no valid ids → 400', async () => {
  resetDb();
  assert.equal((await callPublic(impressionsHandler, { body: { dealIds: [] } })).status, 400);
  assert.equal((await callPublic(impressionsHandler, { body: {} })).status, 400);
});

await testAsync('crawler impressions are not counted, so CTR stays honest', async () => {
  resetDb();
  const r = await callPublic(impressionsHandler, {
    body: { dealIds: db.deals.map((d) => d.id) },
    headers: { 'user-agent': 'Googlebot/2.1' },
  });
  assert.equal(r.status, 200, 'a crawler gets a 200 so it has no reason to retry');
  assert.equal(r.body.recorded, 0);
  assert.deepEqual(db.impressions, {});
});

await testAsync('the batch is capped so one call cannot inflate counts', async () => {
  resetDb();
  const many = Array.from({ length: 200 }, (_, i) => uuid(500 + i));
  const r = await callPublic(impressionsHandler, { body: { dealIds: many } });
  // None of those ids exist, so nothing is recorded — the point is it does not throw.
  assert.equal(r.status, 200);
  assert.equal(r.body.recorded, 0);
});

console.log('\n─── stats reach the dashboard ───');

await testAsync('GET my-deals includes performance figures', async () => {
  resetDb();
  const r = await call(myDeals, { token: tokenA });
  assert.equal(r.body.stats.impressions, 6498);
  assert.equal(r.body.stats.clicks, 150);
  assert.equal(r.body.stats.ctr, 2.31);
});

await testAsync('the stats window can be narrowed', async () => {
  resetDb();
  const r = await call(myDeals, { token: tokenA, query: { days: '7' } });
  assert.equal(r.body.stats.days, 7);
});

await testAsync('an absurd window is clamped', async () => {
  resetDb();
  const r = await call(myDeals, { token: tokenA, query: { days: '99999' } });
  assert.equal(r.body.stats.days, 365);
});

// ════════════════════════════════════════════════════════════════
console.log('\n─── spreadsheet parser ───');

const { parseDelimited, detectDelimiter, mapHeaders, rowToDeal, rowShapeProblem, templateCsv } = sheet;
/** Parse a one-row sheet and return the deal it produces. */
const oneRow = (headers, cells, delimiter = ',') =>
  rowToDeal(cells, mapHeaders(headers).mapping, { delimiter });

test('a quoted field keeps its commas', () => {
  const r = parseDelimited('hotel,price\n"Sol Pelicanos, Levante",229\n');
  assert.deepEqual(r.rows[1], ['Sol Pelicanos, Levante', '229']);
});

test('a quoted field keeps its newlines', () => {
  const r = parseDelimited('title,overview\nX,"Line one\nLine two"\n');
  assert.equal(r.rows.length, 2);
  assert.equal(r.rows[1][1], 'Line one\nLine two');
});

test('a doubled quote is an escaped quote', () => {
  const r = parseDelimited('title\n"He said ""hello"""\n');
  assert.equal(r.rows[1][0], 'He said "hello"');
});

test('a stray quote mid-value stays literal', () => {
  const r = parseDelimited('room\n6" mattress,x\n');
  assert.equal(r.rows[1][0], '6" mattress');
});

test("Excel's UTF-8 BOM is stripped from the first heading", () => {
  const r = parseDelimited('﻿title,price\nX,10\n');
  assert.equal(r.rows[0][0], 'title');
});

test('CRLF line endings parse', () => {
  const r = parseDelimited('title,price\r\nX,10\r\n');
  assert.deepEqual(r.rows[1], ['X', '10']);
});

test('blank rows are dropped rather than reported as broken', () => {
  const r = parseDelimited('title,price\nX,10\n\n,\n\n');
  assert.equal(r.rows.length, 2);
});

test('tab-delimited files are detected', () => {
  assert.equal(detectDelimiter('a\tb\tc\n'), '\t');
});

test('semicolon-delimited files are detected', () => {
  assert.equal(detectDelimiter('a;b;c\n'), ';');
});

test('a comma inside quotes does not win the delimiter vote', () => {
  assert.equal(detectDelimiter('"a,b";c;d\n'), ';');
});

test('rows beyond the cap are dropped and flagged, not silently lost', () => {
  const many = 'title\n' + Array.from({ length: sheet.MAX_ROWS + 25 }, (_, i) => `Deal ${i}`).join('\n');
  const r = parseDelimited(many);
  assert.equal(r.truncated, true);
  assert.equal(r.rows.length, sheet.MAX_ROWS + 1);
});

test('a sheet at exactly the cap is not reported as truncated', () => {
  const exact = 'title\n' + Array.from({ length: sheet.MAX_ROWS }, (_, i) => `Deal ${i}`).join('\n');
  assert.equal(parseDelimited(exact).truncated, false);
});

test('header synonyms map to deal columns', () => {
  const m = mapHeaders(['Hotel Name', 'Price PP', 'Board', 'Flying from']);
  assert.deepEqual(m.mapped, ['accommodation_name', 'price_from', 'board_basis', 'departure_airports']);
});

test('an unrecognised heading is reported, not guessed at', () => {
  assert.deepEqual(mapHeaders(['title', 'Internal notes']).unmapped, ['Internal notes']);
});

test('a repeated field keeps the first column and reports the second', () => {
  const m = mapHeaders(['hotel', 'Hotel Name']);
  assert.deepEqual(m.duplicates, ['Hotel Name']);
  assert.equal(m.mapping[1].col, null);
});

test('a mapping override cannot point a column at agent_id or source', () => {
  const m = mapHeaders(['A', 'B'], { A: 'agent_id', B: 'source' });
  assert.equal(m.mapping[0].col, null);
  assert.equal(m.mapping[1].col, null);
});

test('a mapping override can rescue an odd heading', () => {
  const m = mapHeaders(['Where they go'], { 'Where they go': 'resort' });
  assert.equal(m.mapping[0].col, 'resort');
});

test('a mapping override of empty string ignores that column', () => {
  assert.equal(mapHeaders(['title'], { title: '' }).mapping[0].col, null);
});

test('£ and thousands separators are read off a price', () => {
  assert.equal(oneRow(['price'], ['£1,299.50']).price_from, 1299.5);
});

test('a European decimal comma is read correctly', () => {
  assert.equal(oneRow(['price'], ['1299,50']).price_from, 1299.5);
});

test('a comma thousands separator is not mistaken for a decimal', () => {
  assert.equal(oneRow(['price'], ['1,299']).price_from, 1299);
});

test('a price with trailing words still reads', () => {
  assert.equal(oneRow(['price'], ['£899 pp']).price_from, 899);
});

test('dates are read day-first, as a UK agent writes them', () => {
  assert.equal(oneRow(['travel_from'], ['01/02/2027']).travel_from, '2027-02-01');
});

test('an ISO date is passed through', () => {
  assert.equal(oneRow(['travel_from'], ['2027-02-01']).travel_from, '2027-02-01');
});

test('an Excel date serial is converted', () => {
  assert.equal(oneRow(['travel_from'], ['46023']).travel_from, '2026-01-01');
});

test('a written-out date is read', () => {
  assert.equal(oneRow(['travel_from'], ['12 May 2027']).travel_from, '2027-05-12');
});

test('an impossible date is passed through so validation rejects it', () => {
  const deal = oneRow(['travel_from'], ['31/02/2027']);
  assert.equal(deal.travel_from, '31/02/2027');
  assert.equal(validateDeal({ title: 'x', ...deal }).ok, false);
});

test('star ratings read from "4*" and from words', () => {
  assert.equal(oneRow(['stars'], ['4*']).star_rating, 4);
  assert.equal(oneRow(['stars'], ['four']).star_rating, 4);
});

test('board shorthand maps onto the enum', () => {
  assert.equal(oneRow(['board'], ['AI']).board_basis, 'All inclusive');
  assert.equal(oneRow(['board'], ['half-board']).board_basis, 'Half board');
  assert.equal(oneRow(['board'], ['B&B']).board_basis, 'Bed & breakfast');
});

test('an unknown board is passed through so validation names the field', () => {
  const deal = oneRow(['board'], ['All you can eat']);
  assert.equal(validateDeal({ title: 'x', ...deal }).ok, false);
});

test('status words map onto the enum', () => {
  assert.equal(oneRow(['status'], ['Publish']).status, 'live');
  assert.equal(oneRow(['status'], ['No']).status, 'draft');
});

test('multi-value cells split on a pipe', () => {
  assert.deepEqual(oneRow(['airports'], ['Manchester|Gatwick']).departure_airports,
    ['Manchester', 'Gatwick']);
});

test('a semicolon splits values only when it is not the file delimiter', () => {
  assert.deepEqual(oneRow(['facilities'], ['pool;gym'], ',').facilities, ['pool', 'gym']);
  assert.deepEqual(oneRow(['facilities'], ['pool;gym'], ';').facilities, ['pool;gym']);
});

test('an empty cell leaves the column out, so a re-import cannot blank a field', () => {
  const deal = oneRow(['title', 'overview'], ['X', '   ']);
  assert.equal('overview' in deal, false);
});

test('a row with more cells than headings is flagged (an unquoted comma)', () => {
  assert.match(rowShapeProblem(['a', 'b', 'c'], 2), /needs wrapping in "quotes"/);
});

test('a row with fewer cells than headings is fine', () => {
  assert.equal(rowShapeProblem(['a'], 3), null);
});

test('the template parses back with its own parser', () => {
  const r = parseDelimited(templateCsv());
  assert.equal(r.rows[0][0], 'reference');
  assert.equal(r.rows.length, 3); // headings plus two worked examples
});

test('every template example validates as a real deal', () => {
  const r = parseDelimited(templateCsv());
  const m = mapHeaders(r.rows[0]);
  for (const row of r.rows.slice(1)) {
    const v = validateDeal(rowToDeal(row, m.mapping, { delimiter: ',' }));
    assert.equal(v.ok, true, `template row failed: ${JSON.stringify(v.errors)}`);
  }
});

// ════════════════════════════════════════════════════════════════
console.log('\n─── live offer cache mapping ───');

const { queryOfferCache, offerToDeal, offerRef, RESYNC_FIELDS, airportCity } = offerCache;
const nowMs = Date.now();
const inDays = (d) => new Date(nowMs + d * 86400000).toISOString();
const freshly = new Date(nowMs - 3600e3).toISOString();

const cacheOffer = (o = {}) => ({
  id: 'X1', type: 'Packages', price: 1200, pricePP: 600, currency: 'GBP',
  airport: 'ALC', airportName: 'Alicante', countryCode: 'ES', resort: 'Benidorm',
  hotel: 'Sol Pelicanos', rating: 3, boardBasis: 'All Inclusive', nights: 7,
  reviewRating: 8.4, origin: 'MAN', originName: 'Manchester', carrier: 'Jet2',
  outboundDate: inDays(30), returnDate: inDays(37), fetchedAt: freshly,
  image: 'https://img.example/a.jpg', url: 'https://agency.co.uk/book/X1',
  adults: 2, children: 0, ...o,
});

/** Query the seeded cache stand-in through the real Redis code path. */
const queryIds = async (filters = {}) => {
  const r = await queryOfferCache(filters);
  return r.offers.map((o) => o.id);
};

await testAsync('an offer fetched too long ago is not importable', async () => {
  seedOfferCache({ 'offers:packages:ES': [
    cacheOffer({}), cacheOffer({ id: 'STALE', fetchedAt: new Date(nowMs - 80 * 3600e3).toISOString() }),
  ] });
  assert.deepEqual(await queryIds(), ['X1']);
});

await testAsync('an offer whose travel date has passed is not importable', async () => {
  seedOfferCache({ 'offers:packages:ES': [cacheOffer({}), cacheOffer({ id: 'GONE', outboundDate: inDays(-3) })] });
  assert.deepEqual(await queryIds(), ['X1']);
});

await testAsync('an offer with no price is not importable', async () => {
  seedOfferCache({ 'offers:packages:ES': [cacheOffer({}), cacheOffer({ id: 'FREE', price: null, pricePP: null })] });
  assert.deepEqual(await queryIds(), ['X1']);
});

await testAsync('the same offer in both pools appears once', async () => {
  seedOfferCache({
    'offers:packages:ES': [cacheOffer({})],
    'offers:extra:ES': [cacheOffer({})],
  });
  const r = await queryOfferCache({});
  assert.equal(r.totalMatched, 1);
});

await testAsync('offers are filtered by country, board, budget, nights and departure window', async () => {
  seedOfferCache({
    'offers:packages:ES': [
      cacheOffer({ id: 'CHEAP', pricePP: 200 }),
      cacheOffer({ id: 'HB', boardBasis: 'Half Board', pricePP: 300 }),
      cacheOffer({ id: 'LONG', nights: 21, pricePP: 900 }),
      cacheOffer({ id: 'SOON', outboundDate: inDays(5), pricePP: 400 }),
    ],
    'offers:packages:GR': [cacheOffer({ id: 'GR1', countryCode: 'GR', pricePP: 250 })],
  });
  assert.deepEqual((await queryIds({ countries: ['GR'] })), ['GR1']);
  assert.deepEqual((await queryIds({ boards: ['Half board'] })), ['HB']);
  assert.deepEqual((await queryIds({ budgetMax: 220 })), ['CHEAP']);
  assert.deepEqual((await queryIds({ nightsMin: 14 })), ['LONG']);
  assert.deepEqual((await queryIds({ withinDays: 10 })), ['SOON']);
});

await testAsync('an unknown country matches nothing rather than everything', async () => {
  seedOfferCache({ 'offers:packages:ES': [cacheOffer({})] });
  assert.deepEqual(await queryIds({ countries: ['ZZ'] }), []);
});

await testAsync('a nonsense board filter matches nothing rather than being ignored', async () => {
  seedOfferCache({ 'offers:packages:ES': [cacheOffer({})] });
  assert.deepEqual(await queryIds({ boards: ['All you can eat'] }), []);
});

test('an offer reference is namespaced and includes the departure airport', () => {
  assert.equal(offerRef(cacheOffer({})), 'cache:X1|MAN|Packages');
  // The same hotel from a different airport is a different thing to sell.
  assert.notEqual(offerRef(cacheOffer({ origin: 'LGW' })), offerRef(cacheOffer({})));
});

test('a cache reference can never collide with a spreadsheet reference', () => {
  assert.ok(offerRef(cacheOffer({})).startsWith('cache:'));
});

test('a cached offer maps onto deal columns', () => {
  const d = offerToDeal(cacheOffer({}));
  assert.equal(d.accommodation_name, 'Sol Pelicanos');
  assert.equal(d.resort, 'Benidorm');
  assert.equal(d.country, 'Spain');           // name, not the ES code
  assert.equal(d.board_basis, 'All inclusive');
  assert.equal(d.price_from, 600);            // per person, not the 1200 total
  assert.equal(d.price_basis, 'pp');
  assert.equal(d.guest_score, 8.4);
  assert.deepEqual(d.departure_airports, ['Manchester']);
  assert.equal(d.clickout_url, 'https://agency.co.uk/book/X1');
});

test('a mapped cache offer passes the deal schema', () => {
  assert.equal(validateDeal(offerToDeal(cacheOffer({}))).ok, true);
});

// ── flight-only offers ──────────────────────────────────────────────────
// The mapper was built when everything in the cache was a package, so a flight
// fell through the stay-shaped title builder and came out as a bare airport
// name. These shapes are taken from real offers served by the live cache on
// 28 July 2026, not invented.
const flightOffer = (o = {}) => ({
  id: 'F1', type: 'Flights', price: 44, pricePP: 22, currency: 'GBP',
  airport: 'BCN', airportName: 'Barcelona Intl. (BCN)', countryCode: 'ES',
  origin: 'LGW', originName: 'Gatwick (LGW)', carrier: 'British Airways',
  direct: true, outboundDate: inDays(60), returnDate: inDays(65),
  fetchedAt: freshly, url: 'https://agency.co.uk/book/F1', adults: 1, ...o,
});

test('a flight is titled as a flight, not as a place', () => {
  const d = offerToDeal(flightOffer());
  assert.equal(d.holiday_type, 'Flight only');
  assert.equal(d.title, 'Flights to Barcelona from London, direct');
  assert.equal(d.nights, null, 'a flight has no nights');
  assert.equal(d.board_basis, null);
});

test('a flight to a well-known airport gets its city as the destination', () => {
  assert.equal(offerToDeal(flightOffer()).resort, 'Barcelona');
});

test('an airport named after a person never becomes a destination page', () => {
  // Venice Marco Polo. The title may say Marco Polo, which is merely clumsy.
  // The resort must not, because that would mint /holidays/italy/marco-polo.
  const d = offerToDeal(flightOffer({
    airport: 'VCE', airportName: 'Marco Polo (VCE)', countryCode: 'IT',
  }));
  assert.equal(d.resort, 'Venice', 'VCE is mapped, so it resolves properly');

  const unknown = offerToDeal(flightOffer({
    airport: 'ZZZ', airportName: 'Kranebitten (ZZZ)', countryCode: 'AT',
  }));
  assert.equal(unknown.resort, null, 'an unmapped airport gets NO destination');
  assert.match(unknown.title, /Flights to Kranebitten/, 'but the title still reads');
});

test('airport codes never survive into the words', () => {
  assert.equal(airportCity('Barcelona Intl. (BCN)'), 'Barcelona');
  assert.equal(airportCity('East Midlands, England, UK (EMA)'), 'East Midlands');
  assert.equal(airportCity('GNB-Grenoble - Isere'), 'Grenoble - Isere');
  assert.equal(airportCity(null), null);
});

test('a mapped flight passes the deal schema', () => {
  assert.equal(validateDeal(offerToDeal(flightOffer())).ok, true);
});

test('a was-price below the selling price is suppressed', () => {
  assert.equal(offerToDeal(cacheOffer({ priceChanged: true, priceBeforeChange: 150 })).was_price, null);
});

test('a genuine was-price is kept', () => {
  assert.equal(offerToDeal(cacheOffer({ priceChanged: true, priceBeforeChange: 900 })).was_price, 900);
});

test('a resync returns only the commercial fields, so agent copy survives', () => {
  const d = offerToDeal(cacheOffer({}), { resyncOnly: true });
  assert.deepEqual(Object.keys(d).sort(), [...RESYNC_FIELDS].sort());
  assert.equal('title' in d, false);
  assert.equal('overview' in d, false);
  assert.equal('selling_points' in d, false);
});

test('the booking link is not refreshed by a resync, so an agent edit survives', () => {
  assert.equal(RESYNC_FIELDS.includes('clickout_url'), false);
});

test('a title reads naturally even when the offer is missing pieces', () => {
  assert.equal(offerToDeal(cacheOffer({})).title, 'Sol Pelicanos, Benidorm, 7 nights all inclusive');
  assert.equal(offerToDeal(cacheOffer({ hotel: null, nights: null, resort: null })).title,
    'Alicante, all inclusive');
  assert.equal(offerToDeal(cacheOffer({
    hotel: null, resort: null, airportName: null, nights: null, boardBasis: null,
  })).title, 'Spain');
});

// ════════════════════════════════════════════════════════════════
console.log('\n─── spreadsheet import endpoint ───');

const SHEET_HEAD = 'reference,title,resort,price,board,nights,clickout_url,status';
const sheetText = (...rows) => [SHEET_HEAD, ...rows].join('\n');
const ROW_A = 'REF-1,Benidorm bargain,Benidorm,229,AI,7,https://agent-a.co.uk/1,live';
const ROW_B = 'REF-2,Algarve escape,Albufeira,489,HB,7,https://agent-a.co.uk/2,live';

const preview = (text, extra = {}, token = tokenA) =>
  call(importHandler, { method: 'POST', token, body: { mode: 'preview', text, ...extra } });
const commit = (text, extra = {}, token = tokenA) =>
  call(importHandler, { method: 'POST', token, body: { mode: 'commit', text, ...extra } });

await testAsync('the importer refuses an unauthenticated request', async () => {
  resetDb();
  assert.equal((await call(importHandler, { method: 'POST', body: { text: sheetText(ROW_A) } })).status, 401);
});

await testAsync('GET returns the importable columns and limits', async () => {
  resetDb();
  const r = await call(importHandler, { token: tokenA });
  assert.equal(r.status, 200);
  assert.ok(r.body.columns.some((c) => c.col === 'accommodation_name'));
  assert.equal(r.body.limits.maxRows, sheet.MAX_ROWS);
});

await testAsync('GET ?format=csv returns the template as a download', async () => {
  resetDb();
  const r = await call(importHandler, { token: tokenA, query: { format: 'csv' } });
  assert.match(r.headers['content-type'], /text\/csv/);
  assert.match(r.headers['content-disposition'], /attachment; filename=/);
  assert.match(r.body, /^﻿?reference,title/);
});

await testAsync('a preview writes nothing at all', async () => {
  resetDb();
  const before = db.deals.length;
  const r = await preview(sheetText(ROW_A, ROW_B));
  assert.equal(r.status, 200);
  assert.equal(r.body.summary.create, 2);
  assert.equal(db.deals.length, before);
  assert.equal(db.import_runs.length, 0);
});

await testAsync('a preview shows the dates and prices it read back', async () => {
  resetDb();
  const r = await preview('reference,title,price,travel_from\nR1,X,"£1,299",01/02/2027');
  assert.equal(r.body.rows[0].deal.price_from, 1299);
  assert.equal(r.body.rows[0].deal.travel_from, '2027-02-01');
});

await testAsync('a preview numbers rows as the agent sees them in the spreadsheet', async () => {
  resetDb();
  const r = await preview(sheetText(ROW_A, ROW_B));
  assert.equal(r.body.rows[0].row, 2); // headings are row 1
  assert.equal(r.body.rows[1].row, 3);
});

await testAsync('a commit creates the deals, stamped spreadsheet and owned by the token holder', async () => {
  resetDb();
  const r = await commit(sheetText(ROW_A, ROW_B));
  assert.equal(r.status, 200);
  assert.equal(r.body.created, 2);
  const made = db.deals.filter((d) => d.source === 'spreadsheet');
  assert.equal(made.length, 2);
  assert.ok(made.every((d) => d.agent_id === AGENT_A));
  assert.ok(made.every((d) => d.external_ref.startsWith('sheet:')));
});

await testAsync('a forged source or agent_id in the body is ignored', async () => {
  resetDb();
  await commit(sheetText(ROW_A), { source: 'live_cache', agent_id: AGENT_B });
  const made = db.deals.find((d) => d.title === 'Benidorm bargain');
  assert.equal(made.source, 'spreadsheet');
  assert.equal(made.agent_id, AGENT_A);
});

await testAsync('re-uploading the same reference updates rather than duplicating', async () => {
  resetDb();
  await commit(sheetText(ROW_A));
  const r = await commit(sheetText('REF-1,Benidorm bargain REVISED,Benidorm,199,AI,7,https://agent-a.co.uk/1,live'));
  assert.equal(r.body.created, 0);
  assert.equal(r.body.updated, 1);
  const rows = db.deals.filter((d) => d.external_ref === 'sheet:REF-1');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].price_from, 199);
  assert.equal(rows[0].title, 'Benidorm bargain REVISED');
});

await testAsync('a price-only refresh sheet updates without repeating the title', async () => {
  resetDb();
  await commit(sheetText(ROW_A));
  const r = await commit('reference,price\nREF-1,149');
  assert.equal(r.body.updated, 1);
  const row = db.deals.find((d) => d.external_ref === 'sheet:REF-1');
  assert.equal(row.price_from, 149);
  assert.equal(row.title, 'Benidorm bargain'); // untouched
});

await testAsync('the same reference twice in one sheet is refused, not duplicated', async () => {
  resetDb();
  const r = await commit(sheetText(ROW_A, 'REF-1,Clashing row,Benidorm,299,AI,7,https://agent-a.co.uk/x,live'));
  assert.equal(r.body.created, 1);
  assert.equal(r.body.failed, 1);
  assert.equal(db.deals.filter((d) => d.external_ref === 'sheet:REF-1').length, 1);
  assert.ok(r.body.problems.some((p) => /also on row 2/.test(p.message)));
});

await testAsync('a sheet with no reference column warns that re-uploads will duplicate', async () => {
  resetDb();
  const r = await preview('title,price\nX,229');
  assert.ok(r.body.notes.some((n) => /reference column/.test(n)));
});

await testAsync('nothing is published unless the agent asks for it', async () => {
  resetDb();
  const r = await commit(sheetText(ROW_A, ROW_B));
  assert.equal(r.body.created, 2);
  assert.ok(db.deals.filter((d) => d.source === 'spreadsheet').every((d) => d.status === 'draft'));
  assert.ok(r.body.problems.some((p) => /Turn on publishing/.test(p.message)));
});

await testAsync('with publishing on, rows marked live go live', async () => {
  resetDb();
  const r = await commit(sheetText(ROW_A), { publish: true });
  assert.equal(r.body.created, 1);
  const made = db.deals.find((d) => d.source === 'spreadsheet');
  assert.equal(made.status, 'live');
  assert.ok(made.published_at);
});

await testAsync('a bulk upload publishes every row, with no allowance to run out of', async () => {
  resetDb();
  // Agent B on Spark, already live. This used to be the case where the importer
  // published what fitted and left the rest as drafts. There is nothing to fit
  // inside now, and a 200-row upload goes live in full.
  const r = await commit(
    'reference,title,price,clickout_url,status\nB1,B one,100,https://agent-b.co.uk/1,live\n'
    + 'B2,B two,120,https://agent-b.co.uk/2,live',
    { publish: true }, tokenB,
  );
  assert.equal(r.body.created, 2);
  assert.ok(db.deals.filter((d) => d.source === 'spreadsheet').every((d) => d.status === 'live'));
  assert.ok(!r.body.problems.some((p) => /live deals on/.test(p.message)),
    'nothing complains about an allowance any more');
});

await testAsync('a row with no price is imported but not published', async () => {
  resetDb();
  const r = await commit('reference,title,clickout_url,status\nR9,No price,https://agent-a.co.uk/9,live',
    { publish: true });
  assert.equal(r.body.created, 1);
  const made = db.deals.find((d) => d.external_ref === 'sheet:R9');
  assert.equal(made.status, 'draft');
  assert.ok(r.body.problems.some((p) => /Add a price/.test(p.message)));
});

await testAsync('a created row with no booking link inherits the agent default', async () => {
  resetDb();
  const r = await commit('reference,title,price,status\nR8,Inherits,229,live', { publish: true });
  assert.equal(r.body.created, 1);
  const made = db.deals.find((d) => d.external_ref === 'sheet:R8');
  assert.equal(made.clickout_url, 'https://agent-a.co.uk');
  assert.equal(made.status, 'live');
});

await testAsync('publishing off does NOT take an already-live deal down', async () => {
  resetDb();
  await commit(sheetText(ROW_A), { publish: true });
  const before = db.deals.find((d) => d.external_ref === 'sheet:REF-1');
  assert.equal(before.status, 'live');
  // Same sheet again, still marked live, but the publish switch is off.
  await commit(sheetText(ROW_A), { publish: false });
  assert.equal(db.deals.find((d) => d.external_ref === 'sheet:REF-1').status, 'live');
});

await testAsync('a mapping override cannot redirect a column onto agent_id', async () => {
  resetDb();
  const r = await commit('Owner,title,price\nsomeone-else,Mapped,229',
    { mapping: { Owner: 'agent_id' } });
  assert.equal(r.body.created, 1);
  assert.equal(db.deals.find((d) => d.title === 'Mapped').agent_id, AGENT_A);
});

await testAsync('an invalid row is reported by row number and the good rows still import', async () => {
  resetDb();
  const r = await commit(sheetText(ROW_A, 'REF-3,Bad board,X,199,All you can eat,7,https://agent-a.co.uk/3,draft'));
  assert.equal(r.body.created, 1);
  assert.equal(r.body.failed, 1);
  assert.ok(r.body.problems.some((p) => p.row === 3));
});

await testAsync('a row missing a title cannot create a deal', async () => {
  resetDb();
  const r = await commit('reference,price\nR7,229');
  assert.equal(r.body.created, 0);
  assert.equal(r.body.failed, 1);
});

await testAsync('unrecognised headings are ignored and reported', async () => {
  resetDb();
  const r = await preview('title,price,Internal notes\nX,229,whatever');
  assert.deepEqual(r.body.unmapped, ['Internal notes']);
  assert.ok(r.body.notes.some((n) => /did not recognise/.test(n)));
});

await testAsync('a sheet whose headings match nothing is refused with advice', async () => {
  resetDb();
  const r = await preview('foo,bar\n1,2');
  assert.equal(r.status, 422);
  assert.match(r.body.error, /column headings/);
});

await testAsync('headings with no rows underneath are refused', async () => {
  resetDb();
  assert.equal((await preview(SHEET_HEAD)).status, 422);
});

await testAsync('an empty upload is refused', async () => {
  resetDb();
  assert.equal((await preview('   ')).status, 400);
});

await testAsync('an oversized file is refused before parsing', async () => {
  resetDb();
  const huge = 'title\n' + 'x'.repeat(sheet.MAX_TEXT_BYTES + 10);
  const r = await preview(huge);
  assert.equal(r.status, 413);
});

await testAsync('a commit leaves a history record the agent can read back', async () => {
  resetDb();
  const r = await commit(sheetText(ROW_A, ROW_B));
  assert.equal(db.import_runs.length, 1);
  const run = db.import_runs[0];
  assert.equal(run.agent_id, AGENT_A);
  assert.equal(run.source, 'spreadsheet');
  assert.equal(run.created_count, 2);
  assert.equal(run.rows_total, 2);
  assert.equal(r.body.runId, run.id);
});

await testAsync('the history endpoint reports past imports and where deals came from', async () => {
  resetDb();
  await commit(sheetText(ROW_A, ROW_B));
  const r = await call(importHandler, { token: tokenA, query: { history: '1' } });
  assert.equal(r.status, 200);
  assert.equal(r.body.runs.length, 1);
  assert.equal(r.body.runs[0].source, 'spreadsheet');
  assert.equal(r.body.runs[0].created_count, 2);
  assert.equal(r.body.bySource.spreadsheet, 2);
});

await testAsync('the history endpoint is scoped to the agent asking', async () => {
  resetDb();
  await commit(sheetText(ROW_A));
  const r = await call(importHandler, { token: tokenB, query: { history: '1' } });
  assert.equal(r.body.runs.length, 0);
  assert.equal(r.body.bySource.spreadsheet, 0);
});

await testAsync('an inactive account cannot commit an import', async () => {
  resetDb();
  db.agents[0].status = 'suspended';
  assert.equal((await commit(sheetText(ROW_A))).status, 403);
});

// ════════════════════════════════════════════════════════════════
console.log('\n─── live offer cache endpoint ───');

/** Mark agent A as a Travelgenix client, which is what unlocks this route. */
function makeTgClient(on = true) {
  db.agents[0].tg_client_email = on ? 'agent-a@travelgenix.io' : null;
}

await testAsync('the live feed refuses an unauthenticated request', async () => {
  resetDb();
  assert.equal((await call(offerImport)).status, 401);
});

await testAsync('a non-Travelgenix agent gets the upsell, not an error', async () => {
  resetDb();
  makeTgClient(false);
  const r = await call(offerImport, { token: tokenA });
  assert.equal(r.status, 403);
  assert.equal(r.body.connected, false);
  assert.match(r.body.error, /Travelgenix/);
});

await testAsync('a non-Travelgenix agent cannot import from the feed either', async () => {
  resetDb();
  makeTgClient(false);
  seedOfferCache({ 'offers:packages:ES': [cacheOffer({})] });
  const r = await call(offerImport, {
    method: 'POST', token: tokenA, body: { refs: [offerRef(cacheOffer({}))] },
  });
  assert.equal(r.status, 403);
  assert.equal(r.body.connected, false);
  assert.equal(db.deals.filter((d) => d.source === 'live_cache').length, 0);
});

await testAsync('a connected agent can browse the feed', async () => {
  resetDb();
  makeTgClient();
  seedOfferCache({ 'offers:packages:ES': [cacheOffer({}), cacheOffer({ id: 'X2', pricePP: 350 })] });
  const r = await call(offerImport, { token: tokenA });
  assert.equal(r.status, 200);
  assert.equal(r.body.connected, true);
  assert.equal(r.body.offers.length, 2);
  assert.ok(r.body.offers.every((o) => o.ref && o.title));
  assert.ok(r.body.countries.some((c) => c.code === 'ES' && c.name === 'Spain'));
});

await testAsync('browsing writes nothing', async () => {
  resetDb();
  makeTgClient();
  seedOfferCache({ 'offers:packages:ES': [cacheOffer({})] });
  await call(offerImport, { token: tokenA });
  assert.equal(db.deals.filter((d) => d.source === 'live_cache').length, 0);
});

await testAsync('offers already imported are marked as such when browsing', async () => {
  resetDb();
  makeTgClient();
  seedOfferCache({ 'offers:packages:ES': [cacheOffer({})] });
  await call(offerImport, { method: 'POST', token: tokenA, body: { refs: [offerRef(cacheOffer({}))] } });
  const r = await call(offerImport, { token: tokenA });
  assert.equal(r.body.offers[0].imported, true);
});

await testAsync('importing a chosen offer builds the deal from the cache, stamped live_cache', async () => {
  resetDb();
  makeTgClient();
  seedOfferCache({ 'offers:packages:ES': [cacheOffer({})] });
  const r = await call(offerImport, {
    method: 'POST', token: tokenA, body: { refs: [offerRef(cacheOffer({}))] },
  });
  assert.equal(r.status, 200);
  assert.equal(r.body.created, 1);
  const made = db.deals.find((d) => d.source === 'live_cache');
  assert.equal(made.agent_id, AGENT_A);
  assert.equal(made.accommodation_name, 'Sol Pelicanos');
  assert.equal(made.price_from, 600);
  assert.equal(made.status, 'draft');
  assert.ok(made.synced_at);
});

await testAsync('a forged price in the request body is ignored — the cache is the source', async () => {
  resetDb();
  makeTgClient();
  seedOfferCache({ 'offers:packages:ES': [cacheOffer({})] });
  await call(offerImport, {
    method: 'POST',
    token: tokenA,
    body: {
      refs: [offerRef(cacheOffer({}))],
      deals: [{ price_from: 1, title: 'Forged' }],
      price_from: 1,
      title: 'Forged',
    },
  });
  const made = db.deals.find((d) => d.source === 'live_cache');
  assert.equal(made.price_from, 600);
  assert.notEqual(made.title, 'Forged');
});

await testAsync('a reference that is not in the feed is reported, not invented', async () => {
  resetDb();
  makeTgClient();
  seedOfferCache({ 'offers:packages:ES': [cacheOffer({})] });
  const r = await call(offerImport, {
    method: 'POST', token: tokenA, body: { refs: ['cache:MADE-UP||Packages'] },
  });
  assert.equal(r.body.created, 0);
  assert.equal(r.body.skipped, 1);
  assert.equal(db.deals.filter((d) => d.source === 'live_cache').length, 0);
});

await testAsync('importing with no choice made is refused', async () => {
  resetDb();
  makeTgClient();
  seedOfferCache({ 'offers:packages:ES': [cacheOffer({})] });
  assert.equal((await call(offerImport, { method: 'POST', token: tokenA, body: { refs: [] } })).status, 400);
});

await testAsync('importing the same offer twice refreshes it rather than failing', async () => {
  resetDb();
  makeTgClient();
  seedOfferCache({ 'offers:packages:ES': [cacheOffer({})] });
  const ref = offerRef(cacheOffer({}));
  await call(offerImport, { method: 'POST', token: tokenA, body: { refs: [ref] } });
  seedOfferCache({ 'offers:packages:ES': [cacheOffer({ pricePP: 425 })] });
  const r = await call(offerImport, { method: 'POST', token: tokenA, body: { refs: [ref] } });
  assert.equal(r.body.created, 0);
  assert.equal(r.body.updated, 1);
  assert.equal(db.deals.filter((d) => d.external_ref === ref).length, 1);
  assert.equal(db.deals.find((d) => d.external_ref === ref).price_from, 425);
});

await testAsync('a resync refreshes prices but keeps the agent\'s own copy', async () => {
  resetDb();
  makeTgClient();
  seedOfferCache({ 'offers:packages:ES': [cacheOffer({})] });
  const ref = offerRef(cacheOffer({}));
  await call(offerImport, { method: 'POST', token: tokenA, body: { refs: [ref] } });

  // The agent rewrites the headline and adds selling points.
  const mine = db.deals.find((d) => d.external_ref === ref);
  mine.title = 'My own headline';
  mine.selling_points = ['Handpicked by us'];

  seedOfferCache({ 'offers:packages:ES': [cacheOffer({ pricePP: 399 })] });
  const r = await call(offerImport, { method: 'POST', token: tokenA, body: { resync: true } });
  assert.equal(r.body.resynced, 1);
  const after = db.deals.find((d) => d.external_ref === ref);
  assert.equal(after.price_from, 399);              // refreshed
  assert.equal(after.title, 'My own headline');      // survived
  assert.deepEqual(after.selling_points, ['Handpicked by us']);
});

await testAsync('a resync pauses a live deal whose offer has left the feed', async () => {
  resetDb();
  makeTgClient();
  seedOfferCache({ 'offers:packages:ES': [cacheOffer({})] });
  const ref = offerRef(cacheOffer({}));
  await call(offerImport, { method: 'POST', token: tokenA, body: { refs: [ref], publish: true } });
  assert.equal(db.deals.find((d) => d.external_ref === ref).status, 'live');

  seedOfferCache({ 'offers:packages:ES': [] }); // the holiday is off sale
  const r = await call(offerImport, { method: 'POST', token: tokenA, body: { resync: true } });
  assert.equal(r.body.paused, 1);
  const after = db.deals.find((d) => d.external_ref === ref);
  assert.equal(after.status, 'paused');
  assert.equal(after.title, 'Sol Pelicanos, Benidorm, 7 nights all inclusive'); // not deleted
});

await testAsync('a resync with nothing imported yet is a clean no-op', async () => {
  resetDb();
  makeTgClient();
  seedOfferCache({ 'offers:packages:ES': [cacheOffer({})] });
  const r = await call(offerImport, { method: 'POST', token: tokenA, body: { resync: true } });
  assert.equal(r.status, 200);
  assert.equal(r.body.resynced, 0);
});

await testAsync('publishing from the feed is not capped by the plan either', async () => {
  resetDb();
  makeTgClient();
  db.agents[0].plan = 'Spark'; // the smallest plan, and agent A already has one live
  seedOfferCache({ 'offers:packages:ES': [cacheOffer({}), cacheOffer({ id: 'X2', pricePP: 350 })] });
  const r = await call(offerImport, {
    method: 'POST',
    token: tokenA,
    body: { refs: [offerRef(cacheOffer({})), offerRef(cacheOffer({ id: 'X2' }))], publish: true },
  });
  assert.equal(r.body.created, 2);
  assert.ok(db.deals.filter((d) => d.source === 'live_cache').every((d) => d.status === 'live'));
  assert.ok(!r.body.problems.some((p) => /live deals/.test(p.message)));
});

await testAsync('importing more than the per-request cap is refused with advice', async () => {
  resetDb();
  makeTgClient();
  seedOfferCache({ 'offers:packages:ES': [cacheOffer({})] });
  const many = Array.from({ length: 101 }, (_, i) => `cache:N${i}||Packages`);
  const r = await call(offerImport, { method: 'POST', token: tokenA, body: { refs: many } });
  assert.equal(r.status, 413);
});

await testAsync('an import from the feed leaves a history record', async () => {
  resetDb();
  makeTgClient();
  seedOfferCache({ 'offers:packages:ES': [cacheOffer({})] });
  await call(offerImport, { method: 'POST', token: tokenA, body: { refs: [offerRef(cacheOffer({}))] } });
  assert.equal(db.import_runs.length, 1);
  assert.equal(db.import_runs[0].source, 'live_cache');
  assert.equal(db.import_runs[0].created_count, 1);
});

await testAsync('an empty cache is reported honestly rather than as no offers', async () => {
  resetDb();
  makeTgClient();
  redisStore.clear();
  const r = await call(offerImport, { token: tokenA });
  assert.equal(r.status, 200);
  assert.equal(r.body.totalMatched, 0);
  assert.deepEqual(r.body.offers, []);
});

// ════════════════════════════════════════════════════════════════
console.log('\n─── pay per call: resolution and publish rules ───');

const { resolveBillingMode, publishBlockers } = await import('../api/_lib/tripbuster/deal-write.js');

const agentOn = (mode, extra = {}) => ({ billing_mode: mode, phone: '01204 555 118',
  default_clickout_url: 'https://agent-a.co.uk', ...extra });
const fields = (deal, agent) => publishBlockers(deal, agent).map((b) => b.field);

test('a deal with no mode of its own follows the agency', () => {
  assert.equal(resolveBillingMode({}, agentOn('call')), 'call');
  assert.equal(resolveBillingMode({ billing_mode: null }, agentOn('both')), 'both');
});

test('a deal can overrule the agency in either direction', () => {
  assert.equal(resolveBillingMode({ billing_mode: 'call' }, agentOn('click')), 'call');
  assert.equal(resolveBillingMode({ billing_mode: 'click' }, agentOn('call')), 'click');
});

test('an unknown or missing mode falls back to clicks rather than guessing', () => {
  assert.equal(resolveBillingMode({ billing_mode: 'carrier pigeon' }, agentOn('click')), 'click');
  assert.equal(resolveBillingMode({}, null), 'click');
});

test('a click-first deal still needs somewhere to send the traveller', () => {
  assert.deepEqual(fields({ price_from: 100 }, agentOn('click', { phone: null })), ['clickout_url']);
});

test('a call-first deal needs a number, not a link', () => {
  assert.deepEqual(fields({ price_from: 100 }, agentOn('call', { phone: null })), ['booking_phone']);
  // The agency's own number is enough; the deal need not repeat it.
  assert.deepEqual(fields({ price_from: 100 }, agentOn('call')), []);
});

test('a call-first deal can go live with no booking link at all', () => {
  assert.deepEqual(fields({ price_from: 100, booking_phone: '0141 555 907' },
    { billing_mode: 'call' }), []);
});

test('"both" publishes on either route, so a missing link is not a blocker', () => {
  assert.deepEqual(fields({ price_from: 100, clickout_url: 'https://x.co.uk' },
    agentOn('both', { phone: null })), []);
  assert.deepEqual(fields({ price_from: 100, booking_phone: '01273 555 240' },
    agentOn('both', { default_clickout_url: null, phone: null })), []);
});

test('"both" with neither route is still refused', () => {
  assert.deepEqual(fields({ price_from: 100 }, { billing_mode: 'both' }), ['clickout_url']);
});

test('a price is required whatever the mode', () => {
  assert.ok(fields({ booking_phone: '0141' }, agentOn('call')).includes('price_from'));
});

test('billing_mode is whitelisted, and an empty value clears the override', () => {
  assert.equal(validateDeal({ title: 'x', billing_mode: 'call' }).deal.billing_mode, 'call');
  assert.equal(validateDeal({ title: 'x', billing_mode: '' }).deal.billing_mode, null);
  assert.equal(validateDeal({ title: 'x', billing_mode: 'phone' }).ok, false);
});

// ════════════════════════════════════════════════════════════════
console.log('\n─── the account settings endpoint ───');

await testAsync('settings need a session', async () => {
  resetDb();
  assert.equal((await call(account)).status, 401);
});

await testAsync('an agency can read what it is charged for', async () => {
  resetDb();
  const r = await call(account, { token: tokenA });
  assert.equal(r.status, 200);
  assert.equal(r.body.billingMode, 'click');
  assert.equal(r.body.callMinSeconds, 60);
  assert.equal(r.body.dealsByMode.total, 1);
});

await testAsync('switching to calls is saved', async () => {
  resetDb();
  const r = await call(account, { method: 'PATCH', token: tokenA, body: { billingMode: 'call' } });
  assert.equal(r.status, 200);
  assert.equal(db.agents[0].billing_mode, 'call');
});

await testAsync('switching to calls without a number is refused with a reason', async () => {
  resetDb();
  const r = await call(account, { method: 'PATCH', token: tokenB, body: { billingMode: 'call' } });
  assert.equal(r.status, 422);
  assert.ok(r.body.errors.some((e) => e.field === 'phone'));
  assert.equal(db.agents[1].billing_mode, 'click', 'the change must not have been applied');
});

await testAsync('supplying a number alongside the switch is accepted', async () => {
  resetDb();
  const r = await call(account, {
    method: 'PATCH', token: tokenB, body: { billingMode: 'both', phone: '0141 555 907' },
  });
  assert.equal(r.status, 200);
  assert.equal(db.agents[1].billing_mode, 'both');
  // Spacing is kept on purpose: this number is shown to travellers.
  assert.equal(db.agents[1].phone, '0141 555 907');
});

await testAsync('clearing the number while charging for calls is refused', async () => {
  resetDb();
  const r = await call(account, {
    method: 'PATCH', token: tokenA, body: { billingMode: 'call', phone: '' },
  });
  assert.equal(r.status, 422);
});

await testAsync('a nonsense phone number is refused', async () => {
  resetDb();
  const r = await call(account, { method: 'PATCH', token: tokenA, body: { phone: 'ring me maybe' } });
  assert.equal(r.status, 422);
});

await testAsync('the qualifying length is bounded', async () => {
  resetDb();
  assert.equal((await call(account, {
    method: 'PATCH', token: tokenA, body: { billingMode: 'call', callMinSeconds: 9999 },
  })).status, 422);
});

await testAsync('an unknown mode is refused', async () => {
  resetDb();
  assert.equal((await call(account, {
    method: 'PATCH', token: tokenA, body: { billingMode: 'telepathy' },
  })).status, 422);
});

await testAsync('the plan cannot be upgraded through the settings screen', async () => {
  resetDb();
  const before = db.agents[0].plan;
  const r = await call(account, {
    method: 'PATCH', token: tokenA, body: { plan: 'Bespoke', billingMode: 'both' },
  });
  assert.equal(r.status, 200);
  assert.equal(db.agents[0].plan, before);
});

await testAsync('status and the Travelgenix link cannot be set here either', async () => {
  resetDb();
  await call(account, {
    method: 'PATCH', token: tokenA,
    body: { billingMode: 'click', status: 'suspended', tg_client_email: 'me@travelgenix.io' },
  });
  assert.equal(db.agents[0].status, 'active');
  assert.equal(db.agents[0].tg_client_email, undefined);
});

await testAsync('a settings change touches only the agency that asked', async () => {
  resetDb();
  await call(account, { method: 'PATCH', token: tokenA, body: { billingMode: 'both' } });
  assert.equal(db.agents[1].billing_mode, 'click');
});

await testAsync('a call-first agency can publish a deal that has no booking link', async () => {
  resetDb();
  db.agents[0].billing_mode = 'call';
  db.agents[0].default_clickout_url = null;
  const r = await call(myDeals, {
    method: 'POST', token: tokenA,
    body: { title: 'Ring us about Corfu', price_from: 449, status: 'live' },
  });
  assert.equal(r.status, 201);
  const made = db.deals.find((d) => d.title === 'Ring us about Corfu');
  assert.equal(made.status, 'live');
  // NOT copied onto the deal, which is the change migration 009 made. Copying it
  // would pin this deal to one number for good and defeat the opening-hours
  // routing; null means "use whichever of the agency's numbers applies now", and
  // the read path resolves it. What makes the deal publishable is that the agency
  // HAS a number, which publishBlockers checks against the agents row.
  assert.equal(made.booking_phone ?? null, null);
});

await testAsync('a number typed onto a deal is kept, because it is a deliberate override', async () => {
  resetDb();
  db.agents[0].billing_mode = 'call';
  const r = await call(myDeals, {
    method: 'POST', token: tokenA,
    body: { title: 'Ring the Corfu desk', price_from: 449, status: 'live',
      booking_phone: '01204 555 999' },
  });
  assert.equal(r.status, 201);
  const made = db.deals.find((d) => d.title === 'Ring the Corfu desk');
  assert.equal(made.booking_phone, '01204 555 999');
});

await testAsync('a click-first agency still cannot publish without a link', async () => {
  resetDb();
  db.agents[0].default_clickout_url = null;
  const r = await call(myDeals, {
    method: 'POST', token: tokenA,
    body: { title: 'Nowhere to go', price_from: 449, status: 'live' },
  });
  assert.equal(r.status, 422);
  assert.ok(r.body.errors.some((e) => e.field === 'clickout_url'));
});

await testAsync('a deal can charge for calls while the agency charges for clicks', async () => {
  resetDb();
  db.agents[0].default_clickout_url = null;
  const r = await call(myDeals, {
    method: 'POST', token: tokenA,
    body: { title: 'This one is phone only', price_from: 299, status: 'live', billing_mode: 'call' },
  });
  assert.equal(r.status, 201);
  assert.equal(db.deals.find((d) => d.title === 'This one is phone only').billing_mode, 'call');
});

// ════════════════════════════════════════════════════════════════
console.log('\n─── callback requests ───');

const A_DEAL = () => db.deals.find((d) => d.agent_id === AGENT_A).id;
const askForCall = (body) => callPublic(leadHandler, { body: { dealId: A_DEAL(), ...body } });

test('a name on its own is not a callback request', () => {
  const r = validateLead({ name: 'Jo Bloggs' });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => /phone number or an email/.test(e.message)));
});

test('a phone number alone is enough', () => {
  assert.equal(validateLead({ name: 'Jo Bloggs', phone: '07700 900123' }).ok, true);
});

test('an email address alone is enough', () => {
  assert.equal(validateLead({ name: 'Jo Bloggs', email: 'jo@example.co.uk' }).ok, true);
});

test('the phone number keeps its spacing, because a human reads it back', () => {
  assert.equal(validateLead({ name: 'Jo B', phone: '07700 900 123' }).lead.phone, '07700 900 123');
});

test('an email address is lower-cased', () => {
  assert.equal(validateLead({ name: 'Jo B', email: 'Jo.Bloggs@Example.CO.UK' }).lead.email,
    'jo.bloggs@example.co.uk');
});

test('a number too short to ring is refused', () => {
  assert.equal(validateLead({ name: 'Jo B', phone: '12345' }).ok, false);
});

test('nothing but the whitelisted fields survives', () => {
  const r = validateLead({
    name: 'Jo B', phone: '07700900123', agent_id: 'someone-else', status: 'booked', id: 'x',
  });
  assert.deepEqual(Object.keys(r.lead).sort(), ['name', 'phone']);
});

await testAsync('a callback request is stored and counted', async () => {
  resetDb();
  const r = await askForCall({ name: 'Jo Bloggs', phone: '07700 900123' });
  assert.equal(r.status, 200);
  assert.equal(db.leads.length, 1);
  assert.equal(db.leads[0].name, 'Jo Bloggs');
  assert.equal(db.leads[0].agent_id, AGENT_A);
  // The enquiry and the meter are written together.
  assert.ok(db.clicks.some((c) => c.event_type === 'lead' && c.is_billable));
});

await testAsync('the traveller is told who will ring, and nothing else', async () => {
  resetDb();
  const r = await askForCall({ name: 'Jo Bloggs', email: 'jo@example.co.uk' });
  assert.equal(r.body.agentName, 'Agent A');
  // Our business, not theirs.
  assert.equal(r.body.billable, undefined);
  assert.equal(r.body.leadId, undefined);
});

await testAsync('a request with no way to reply is refused', async () => {
  resetDb();
  const r = await askForCall({ name: 'Jo Bloggs' });
  assert.equal(r.status, 422);
  assert.equal(db.leads.length, 0);
});

await testAsync('the same person asking twice is stored but charged once', async () => {
  resetDb();
  await askForCall({ name: 'Jo Bloggs', phone: '07700 900123' });
  await askForCall({ name: 'Jo Bloggs', phone: '07700900123' });
  assert.equal(db.leads.length, 2, 'the agency should still see both');
  assert.equal(db.clicks.filter((c) => c.event_type === 'lead' && c.is_billable).length, 1);
});

await testAsync('a bot that fills in the hidden field is thanked and ignored', async () => {
  resetDb();
  const r = await askForCall({ name: 'Spam Bot', phone: '07700900123', website: 'http://spam.example' });
  assert.equal(r.status, 200);
  assert.equal(db.leads.length, 0);
});

await testAsync('an unknown deal cannot be used to accumulate enquiries', async () => {
  resetDb();
  const r = await callPublic(leadHandler, {
    body: { dealId: uuid(999), name: 'Jo Bloggs', phone: '07700900123' },
  });
  assert.equal(r.status, 404);
  assert.equal(db.leads.length, 0);
});

// ════════════════════════════════════════════════════════════════
console.log('\n─── the enquiries inbox ───');

await testAsync('the inbox needs a session', async () => {
  resetDb();
  assert.equal((await call(myLeads)).status, 401);
});

await testAsync('an agency sees its own enquiries with the contact details', async () => {
  resetDb();
  await askForCall({ name: 'Jo Bloggs', phone: '07700 900123' });
  const r = await call(myLeads, { token: tokenA });
  assert.equal(r.status, 200);
  assert.equal(r.body.leads.length, 1);
  assert.equal(r.body.leads[0].phone, '07700 900123');
  assert.equal(r.body.counts.new, 1);
});

await testAsync('one agency cannot see another\'s enquiries', async () => {
  resetDb();
  await askForCall({ name: 'Jo Bloggs', phone: '07700 900123' });
  const r = await call(myLeads, { token: tokenB });
  assert.equal(r.body.leads.length, 0);
});

await testAsync('marking an outcome sticks and stamps when it happened', async () => {
  resetDb();
  await askForCall({ name: 'Jo Bloggs', phone: '07700 900123' });
  const id = db.leads[0].id;
  const r = await call(myLeads, { method: 'PATCH', token: tokenA, query: { id }, body: { status: 'booked' } });
  assert.equal(r.status, 200);
  assert.equal(db.leads[0].status, 'booked');
  assert.ok(db.leads[0].contacted_at);
});

await testAsync('an invented outcome is refused', async () => {
  resetDb();
  await askForCall({ name: 'Jo Bloggs', phone: '07700 900123' });
  const r = await call(myLeads, {
    method: 'PATCH', token: tokenA, query: { id: db.leads[0].id }, body: { status: 'sold-them-a-yacht' },
  });
  assert.equal(r.status, 422);
});

await testAsync('one agency cannot mark another\'s enquiry', async () => {
  resetDb();
  await askForCall({ name: 'Jo Bloggs', phone: '07700 900123' });
  const id = db.leads[0].id;
  const r = await call(myLeads, { method: 'PATCH', token: tokenB, query: { id }, body: { status: 'junk' } });
  assert.equal(r.status, 404, 'same answer as an enquiry that does not exist');
  assert.equal(db.leads[0].status, 'new');
});

await testAsync('the inbox never hands over the visitor tracking columns', async () => {
  resetDb();
  await askForCall({ name: 'Jo Bloggs', phone: '07700 900123' });
  const r = await call(myLeads, { token: tokenA });
  const keys = Object.keys(r.body.leads[0]);
  for (const hidden of ['ip_hash', 'ua_family', 'referrer_host']) {
    assert.ok(!keys.includes(hidden), `${hidden} must not reach the agency`);
  }
});

// ════════════════════════════════════════════════════════════════
// OPENING HOURS
//
// The rules live in three places on purpose (the page shows, the API validates,
// the database charges) and the risk of that is drift. THE_CASES below is the
// shared truth: the same table is run against the JavaScript evaluator here and
// against the copy inside tb-site.js, and any disagreement fails. The SQL copy
// was checked against this same table by hand when 009 was applied.
// ════════════════════════════════════════════════════════════════
const hours = await import('../api/_lib/tripbuster/hours.js');
const { isOpenAt, openState, validateSchedule, toMinutes, phonesFor } = hours;

// Weekdays nine to half five, Saturday split around lunch, Sunday shut.
// Christmas Day closed outright, August bank holiday on short hours.
const SHOP = {
  hoursMode: 'scheduled',
  timeZone: 'Europe/London',
  hours: [1, 2, 3, 4, 5].map((d) => ({ day: d, opens: '09:00', closes: '17:30' }))
    .concat([{ day: 6, opens: '10:00', closes: '13:00' },
      { day: 6, opens: '14:00', closes: '16:00' }]),
  specialDays: [
    { date: '2026-12-25', opens: null, closes: null, note: 'Christmas Day' },
    { date: '2026-08-31', opens: '11:00', closes: '15:00', note: 'Bank holiday' },
  ],
  phones: [
    { label: 'Main number', phone: '01204 555 118', whenShown: 'always' },
    { label: 'Out of hours', phone: '07700 900123', whenShown: 'closed' },
    { label: 'Shop', phone: '01204 555 200', whenShown: 'open' },
  ],
};

const THE_CASES = [
  ['a Monday mid-morning in summer', '2026-07-27T09:00:00Z', true],
  ['half an hour before opening', '2026-07-27T07:30:00Z', false],
  ['the minute before closing', '2026-07-27T16:29:00Z', true],
  // Start inclusive, end exclusive. Without this a 17:30 close would be open at
  // 17:30, and the agency would be charged for a call as they locked the door.
  ['the closing instant itself', '2026-07-27T16:30:00Z', false],
  ['a Sunday, with no hours set for it', '2026-07-26T11:00:00Z', false],
  ['Saturday morning', '2026-08-01T10:00:00Z', true],
  ['Saturday, during the lunch break', '2026-08-01T12:30:00Z', false],
  ['Saturday afternoon, after the break', '2026-08-01T14:00:00Z', true],
  ['Christmas Day, a special day that closes all day', '2026-12-25T12:00:00Z', false],
  ['an August bank holiday, on special hours', '2026-08-31T11:00:00Z', true],
  ['that same bank holiday, before the special opening', '2026-08-31T09:00:00Z', false],
  // THE ONE THAT MATTERS. Times are stored as local wall-clock, so 09:30 is
  // inside 09:00-17:30 in January and in July alike. Storing UTC offsets would
  // have needed every agency's hours editing twice a year.
  ['half nine on a January Monday, in GMT', '2027-01-04T09:30:00Z', true],
  ['half eight on that same January Monday', '2027-01-04T08:30:00Z', false],
];

for (const [what, iso, expected] of THE_CASES) {
  test(`open or shut: ${what}`, () => {
    assert.equal(isOpenAt(SHOP, new Date(iso)), expected);
  });
}

test('an agency with no hours set is never closed', () => {
  assert.equal(isOpenAt({ hoursMode: 'always' }, new Date('2026-07-26T03:00:00Z')), true);
  assert.equal(isOpenAt(null, new Date('2026-07-26T03:00:00Z')), true);
});

test('a full 24 hour day is 00:00 to 24:00, not a magic flag', () => {
  // 1440, not 0. Read as midnight-at-the-start a 00:00-24:00 day would be a
  // zero-length day, and a round-the-clock agency would read as never open.
  assert.equal(toMinutes('24:00'), 1440, 'end of day, not midnight at the start');
  const allWeek = {
    hoursMode: 'scheduled',
    hours: [0, 1, 2, 3, 4, 5, 6].map((d) => ({ day: d, opens: '00:00', closes: '24:00' })),
  };
  // Every hour of a full day, including both midnights, which is where an
  // off-by-one in the boundary handling would show up.
  for (let h = 0; h < 24; h += 1) {
    const at = new Date(Date.UTC(2026, 6, 26, h, 0, 0));
    assert.equal(isOpenAt(allWeek, at), true, `should be open at ${h}:00 UTC`);
  }
  assert.equal(isOpenAt(allWeek, new Date('2026-07-26T23:59:59Z')), true);
});

test('closed now, and it says when it opens next', () => {
  const s = openState(SHOP, new Date('2026-08-01T12:30:00Z'));
  assert.equal(s.open, false);
  assert.equal(s.opensAt, '14:00', 'later the same day, not next week');
  assert.equal(s.opensDay, 6);
});

test('open now, and it says when it shuts', () => {
  const s = openState(SHOP, new Date('2026-07-27T09:00:00Z'));
  assert.equal(s.open, true);
  assert.equal(s.closesAt, '17:30');
});

test('the next opening skips over a day that is closed all day', () => {
  // Christmas Eve is a Thursday; Christmas Day is closed, so the answer is
  // Saturday morning rather than Friday.
  const s = openState(SHOP, new Date('2026-12-24T18:00:00Z'));
  assert.equal(s.open, false);
  assert.equal(s.opensDate, '2026-12-26');
  assert.equal(s.opensAt, '10:00');
});

test('which number shows depends on whether they are open', () => {
  const open = phonesFor(SHOP, true).map((p) => p.label);
  const shut = phonesFor(SHOP, false).map((p) => p.label);
  assert.deepEqual(open, ['Main number', 'Shop']);
  assert.deepEqual(shut, ['Main number', 'Out of hours']);
});

// ── the page's copy of the rules must agree with this one ────────
await testAsync('the consumer site and the API never disagree about opening hours', async () => {
  // tb-site.js used to be a browser IIFE and had to be run here inside a stubbed
  // window. It is an ES module now — the server renders pages with it — so it
  // imports directly, and that import doubles as the check that nothing in it
  // reaches for `window` at module scope.
  const TB = await import('../public/tripbuster/tb-site.js');
  assert.ok(typeof TB.openState === 'function', 'tb-site.js should export openState');

  for (const [what, iso, expected] of THE_CASES) {
    const mine = isOpenAt(SHOP, new Date(iso));
    const theirs = TB.openState(SHOP, new Date(iso)).open;
    assert.equal(theirs, expected, `tb-site.js disagrees on ${what}`);
    assert.equal(theirs, mine, `the two copies disagree on ${what}`);
  }
  // And the labels a traveller actually reads.
  assert.equal(TB.openLabel(SHOP, new Date('2026-07-27T09:00:00Z')), 'Open now, until 5:30pm');
  assert.equal(TB.openLabel(SHOP, new Date('2026-08-01T12:30:00Z')), 'Closed, opens at 2pm');
  assert.equal(TB.openLabel(SHOP, new Date('2026-07-26T20:30:00Z')), 'Closed, opens 9am tomorrow');
  assert.equal(TB.clockLabel('00:00'), 'midnight', 'because 12am reads as noon to half of everybody');
  assert.equal(TB.clockLabel('12:00'), 'midday');
});

// ── validation ──────────────────────────────────────────────────
const badSchedule = (body) => validateSchedule(body).errors.map((e) => e.field);

test('a closing time before its opening time is refused', () => {
  assert.deepEqual(badSchedule({ hours: [{ day: 1, opens: '17:00', closes: '09:00' }] }), ['hours[0]']);
});

test('two periods on the same day that overlap are refused, not merged', () => {
  // Merging would silently change what the agent typed. Somebody who meant
  // 09:00-17:00 and typed two overlapping shifts wants telling.
  const errs = badSchedule({
    hours: [{ day: 1, opens: '09:00', closes: '13:00' }, { day: 1, opens: '12:00', closes: '17:00' }],
  });
  assert.deepEqual(errs, ['hours[1]']);
});

test('two periods on the same day that merely touch are fine', () => {
  const r = validateSchedule({
    hours: [{ day: 1, opens: '09:00', closes: '13:00' }, { day: 1, opens: '13:00', closes: '17:00' }],
  });
  assert.equal(r.ok, true);
  assert.equal(r.clean.hours.length, 2);
});

test('a nonsense time is refused', () => {
  assert.deepEqual(badSchedule({ hours: [{ day: 1, opens: '25:00', closes: '26:00' }] }), ['hours[0]']);
  assert.deepEqual(badSchedule({ hours: [{ day: 1, opens: 'nine', closes: '17:00' }] }), ['hours[0]']);
});

test('a day that is not a day is refused', () => {
  assert.deepEqual(badSchedule({ hours: [{ day: 9, opens: '09:00', closes: '17:00' }] }), ['hours[0].day']);
});

test('turning hours on with nothing open is refused', () => {
  // Otherwise a half-finished form leaves the agency permanently shut, with every
  // call button swapped for a form and no obvious reason why.
  const errs = badSchedule({ hoursMode: 'scheduled', hours: [] });
  assert.deepEqual(errs, ['hours']);
});

test('an agency already on scheduled hours cannot clear its week either', () => {
  // The dangerous case: the mode is not resent, so only the stored one reveals it.
  const errs = badSchedule({ hours: [], currentHoursMode: 'scheduled' });
  assert.deepEqual(errs, ['hours']);
});

test('clearing the week while switching back to always available is fine', () => {
  const r = validateSchedule({ hoursMode: 'always', hours: [], currentHoursMode: 'scheduled' });
  assert.equal(r.ok, true);
});

test('a date that does not exist is refused', () => {
  // Date.parse accepts 31 February and rolls it into March, so the value is
  // round-tripped rather than merely parsed.
  assert.deepEqual(badSchedule({ specialDays: [{ date: '2026-02-31' }] }), ['specialDays[0].date']);
  assert.deepEqual(badSchedule({ specialDays: [{ date: '25/12/2026' }] }), ['specialDays[0].date']);
});

test('the same special day twice is refused', () => {
  const errs = badSchedule({
    specialDays: [{ date: '2026-12-25' }, { date: '2026-12-25', opens: '10:00', closes: '14:00' }],
  });
  assert.deepEqual(errs, ['specialDays[1].date']);
});

test('a special day with no times means closed all day', () => {
  const r = validateSchedule({ specialDays: [{ date: '2026-12-25', note: 'Christmas' }] });
  assert.equal(r.ok, true);
  assert.deepEqual(r.clean.specialDays[0], { date: '2026-12-25', opens: null, closes: null, note: 'Christmas' });
});

test('a special day with one time only is refused', () => {
  assert.deepEqual(badSchedule({ specialDays: [{ date: '2026-12-24', opens: '10:00' }] }), ['specialDays[0]']);
});

test('an extra number needs a label, because a bare number tells a traveller nothing', () => {
  assert.deepEqual(badSchedule({ phones: [{ phone: '07700 900123' }] }), ['phones[0].label']);
});

test('an extra number that is not a number is refused, naming the label', () => {
  const r = validateSchedule({ phones: [{ label: 'Out of hours', phone: 'ring us' }] });
  assert.deepEqual(r.errors.map((e) => e.field), ['phones[0].phone']);
  assert.match(r.errors[0].message, /Out of hours/);
});

test('an unknown "show it when" falls back to always rather than failing', () => {
  const r = validateSchedule({ phones: [{ label: 'Shop', phone: '01204 555 200', whenShown: 'sometimes' }] });
  assert.equal(r.ok, true);
  assert.equal(r.clean.phones[0].whenShown, 'always');
});

test('a made-up time zone is refused', () => {
  assert.deepEqual(badSchedule({ timeZone: 'Europe/Bolton' }), ['timeZone']);
  assert.equal(validateSchedule({ timeZone: 'Europe/London' }).ok, true);
});

test('spacing in an extra number is preserved, the same as the main one', () => {
  const r = validateSchedule({ phones: [{ label: 'Shop', phone: '01204 555 200' }] });
  assert.equal(r.clean.phones[0].phone, '01204 555 200');
});

// ── through the endpoint ────────────────────────────────────────
await testAsync('an agency can set its opening hours', async () => {
  resetDb();
  const r = await call(account, {
    method: 'PATCH', token: tokenA,
    body: {
      billingMode: 'call',
      hoursMode: 'scheduled',
      closedBehaviour: 'callback',
      hours: [{ day: 1, opens: '09:00', closes: '17:30' }],
      specialDays: [{ date: '2026-12-25', note: 'Christmas Day' }],
    },
  });
  assert.equal(r.status, 200);
  assert.equal(db.agents[0].hours_mode, 'scheduled');
  assert.equal(db.agent_hours.length, 1);
  assert.equal(db.agent_special_days.length, 1);
});

await testAsync('saving a week replaces the old one rather than adding to it', async () => {
  resetDb();
  const send = (hours) => call(account, {
    method: 'PATCH', token: tokenA, body: { hoursMode: 'scheduled', hours },
  });
  await send([{ day: 1, opens: '09:00', closes: '17:30' }, { day: 2, opens: '09:00', closes: '17:30' }]);
  await send([{ day: 1, opens: '10:00', closes: '16:00' }]);
  assert.equal(db.agent_hours.length, 1, 'Tuesday is gone, not still lurking');
  assert.equal(db.agent_hours[0].opens, '10:00');
});

await testAsync('an agency can hold several labelled numbers', async () => {
  resetDb();
  const r = await call(account, {
    method: 'PATCH', token: tokenA,
    body: {
      phones: [
        { label: 'Out of hours', phone: '07700 900123', whenShown: 'closed' },
        { label: 'Cruise desk', phone: '01204 555 300' },
      ],
    },
  });
  assert.equal(r.status, 200);
  assert.equal(db.agent_phones.length, 2);
  assert.equal(db.agent_phones[0].when_shown, 'closed');
  // The main number is still the agents row, and still comes first.
  assert.equal(db.agents[0].phone, '01204 555 118');
});

await testAsync('one agency cannot touch another agency\'s hours', async () => {
  resetDb();
  await call(account, {
    method: 'PATCH', token: tokenA,
    body: { hoursMode: 'scheduled', hours: [{ day: 1, opens: '09:00', closes: '17:30' }] },
  });
  assert.equal(db.agents[1].hours_mode, 'always');
  assert.equal(db.agent_hours.every((h) => h.agent_id === db.agents[0].id), true);
});

await testAsync('the settings screen still cannot upgrade a plan or set hours on someone else', async () => {
  resetDb();
  await call(account, {
    method: 'PATCH', token: tokenA,
    body: { plan: 'Bespoke', status: 'active', agentId: db.agents[1].id, hoursMode: 'scheduled',
      hours: [{ day: 1, opens: '09:00', closes: '17:30' }] },
  });
  assert.equal(db.agents[0].plan, 'Boost', 'the plan is not the agency\'s to change');
  assert.equal(db.agents[1].hours_mode, 'always', 'and neither is another agency\'s week');
});

await testAsync('the account screen hands back the same contact shape the site receives', async () => {
  resetDb();
  await call(account, {
    method: 'PATCH', token: tokenA,
    body: { hoursMode: 'scheduled', hours: [{ day: 1, opens: '09:00', closes: '17:30' }],
      phones: [{ label: 'Out of hours', phone: '07700 900123', whenShown: 'closed' }] },
  });
  const r = await call(account, { token: tokenA });
  assert.equal(r.status, 200);
  const c = r.body.contact;
  assert.equal(c.hoursMode, 'scheduled');
  assert.deepEqual(c.hours, [{ day: 1, opens: '09:00', closes: '17:30' }]);
  assert.deepEqual(c.phones.map((p) => p.label), ['Main number', 'Out of hours']);
  // And it evaluates with the same function the page uses, which is the point of
  // returning the same shape.
  assert.equal(isOpenAt(c, new Date('2026-07-27T09:00:00Z')), true);
  assert.equal(isOpenAt(c, new Date('2026-07-26T09:00:00Z')), false);
});

// ── report ──────────────────────────────────────────────────────
await new Promise((r) => fakeRedis.close(r));
await new Promise((r) => fakePg.close(r));
console.log(`\n${passed}/${passed + failures.length} passed`);
if (failures.length) {
  console.log('\nFailures:');
  for (const f of failures) console.log(`  ${f.name}: ${f.message}`);
  process.exit(1);
}
process.exit(0);
