'use strict';
// =============================================================================
//  YesAware unit tests — pure logic only (no network).
//    node tests/test-yesaware.cjs
//  The repo is type:module, so this .cjs loads the ESM lib via dynamic import().
// =============================================================================

process.env.TG_SESSION_SECRET =
  process.env.TG_SESSION_SECRET || 'test-secret-abcdefghijklmnopqrstuvwxyz-0123456789';
process.env.YESAWARE_PUBLIC_ORIGIN = 'https://widgets.travelify.io';

let passed = 0;
let failed = 0;
function ok(name, cond) {
  if (cond) { passed++; console.log('  ok   -', name); }
  else { failed++; console.error('  FAIL -', name); }
}
function eq(name, a, b) { ok(`${name} (got ${JSON.stringify(a)})`, a === b); }

(async () => {
  const y = await import('../api/_lib/yesaware.js');

  // ── tokens ────────────────────────────────────────────────────────────────
  const tok = y.newToken();
  ok('newToken is 30 hex chars', /^[a-f0-9]{30}$/.test(tok));
  ok('newToken is unique', y.newToken() !== y.newToken());
  eq('safeToken accepts a valid token', y.safeToken(tok), tok);
  eq('safeToken rejects punctuation', y.safeToken('bad token!'), '');
  eq('safeToken rejects empty', y.safeToken(''), '');
  eq('safeToken rejects overlong', y.safeToken('a'.repeat(100)), '');
  eq('safeToken rejects non-string', y.safeToken(null), '');

  // ── sign / verify ─────────────────────────────────────────────────────────
  const sig = y.sign(tok);
  ok('verifySig accepts our signature', y.verifySig(tok, sig) === true);
  ok('verifySig rejects a tampered value', y.verifySig(tok + 'x', sig) === false);
  ok('verifySig rejects a tampered signature',
    y.verifySig(tok, sig.slice(0, -1) + (sig.endsWith('A') ? 'B' : 'A')) === false);
  ok('verifySig rejects empty signature', y.verifySig(tok, '') === false);
  ok('verifySig rejects null signature', y.verifySig(tok, null) === false);
  ok('sign is deterministic', y.sign(tok) === sig);

  // ── classifyOpen ──────────────────────────────────────────────────────────
  eq('classify Apple MPP (17/8)', y.classifyOpen('17.58.1.2', 'Mozilla'), 'apple-mpp');
  eq('classify NOT Apple (170.x)', y.classifyOpen('170.1.2.3', 'Mozilla'), 'direct');
  eq('classify Google proxy UA',
    y.classifyOpen('66.102.1.1', 'Mozilla/5.0 (via ggpht.com GoogleImageProxy)'), 'google-proxy');
  eq('classify direct', y.classifyOpen('82.10.1.1', 'Mozilla/5.0 iPhone'), 'direct');
  eq('classify uses first x-forwarded-for ip', y.classifyOpen('17.1.1.1, 10.0.0.1', 'x'), 'apple-mpp');

  // ── pixelUrl ──────────────────────────────────────────────────────────────
  const px = y.pixelUrl(tok);
  ok('pixelUrl host + path', px.startsWith('https://widgets.travelify.io/api/track/open?'));
  const pxp = new URL(px).searchParams;
  eq('pixelUrl carries the token', pxp.get('t'), tok);
  ok('pixelUrl signature verifies', y.verifySig(tok, pxp.get('s')) === true);

  // ── trackedLinkUrl ────────────────────────────────────────────────────────
  const dest = 'https://example.com/path?a=1&b=2';
  const tl = y.trackedLinkUrl(tok, dest);
  ok('trackedLinkUrl host + path', tl.startsWith('https://widgets.travelify.io/api/track/click?'));
  const tlp = new URL(tl).searchParams;
  eq('trackedLinkUrl carries the token', tlp.get('t'), tok);
  const u = tlp.get('u');
  eq('trackedLinkUrl round-trips the url', u, dest);
  ok('trackedLinkUrl signature verifies', y.verifySig(tok + '|' + u, tlp.get('s')) === true);
  ok('signature does NOT verify for a swapped url',
    y.verifySig(tok + '|https://evil.example', tlp.get('s')) === false);
  eq('trackedLinkUrl rejects javascript: url', y.trackedLinkUrl(tok, 'javascript:alert(1)'), '');
  eq('trackedLinkUrl rejects mailto: url', y.trackedLinkUrl(tok, 'mailto:x@y.com'), '');
  eq('trackedLinkUrl rejects empty url', y.trackedLinkUrl(tok, ''), '');

  // ── seenRecently (dedupe) ──────────────────────────────────────────────────
  const k = 'open|' + tok + '|1.2.3.4';
  ok('seenRecently is false the first time', y.seenRecently(k) === false);
  ok('seenRecently is true the second time', y.seenRecently(k) === true);
  ok('seenRecently is false for a different key', y.seenRecently(k + '|x') === false);

  console.log(`\nYesAware: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
