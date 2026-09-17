/**
 * Every Travelify call carries a Referer (17 Sep 2026).
 *
 * Travelify lets a client lock an application to their own domains, and that
 * check reads the Referer. A server sends none unless it sets one, so a locked
 * application answers "Missing or invalid application credentials" — the same
 * words a wrong key gets. Better Lifestyle (app 474) was locked to tripgift.com
 * at 22:23 on 16 Sep 2026 and every order call for them died on the spot, while
 * the key itself was perfectly good.
 *
 * The offers search had already solved this on 14 Sep: SEARCH_REFERER, on
 * Andy's instruction. The order family never got it, because there was no one
 * place to put it — nine call sites had their own copy of the same four header
 * lines. Offers kept working. Orders, PDFs, amendments, cancellations and
 * balance payments did not.
 *
 * So there is one builder now, and this suite holds the line:
 *
 *   1. The builder sends the Referer, and it is the SAME value the offers
 *      search sends. Two localhost constants would drift.
 *   2. It really reaches the wire. Browsers forbid setting Referer; if Node
 *      stripped it too, this would look identical to still being broken.
 *   3. Nobody hand-rolls Travelify Token auth any more, so a tenth call site
 *      cannot quietly ship without it.
 *
 * Run: node test/travelify-referer-drift-smoke.mjs
 *      (npm run test:travelify-referer)
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import http from 'node:http';

let passed = 0, failed = 0;
const ok = (label, cond, detail) => {
  if (cond) { passed++; console.log('  ✓ ' + label); }
  else { failed++; console.error('  ✗ ' + label + (detail ? '\n      ' + detail : '')); }
};

const ROOT = new URL('../', import.meta.url).pathname;
const { travelifyAuthHeaders, TRAVELIFY_REFERER, TRAVELIFY_ORIGIN } =
  await import('../api/_lib/travelify.js');
const { SEARCH_REFERER, searchHeaders } =
  await import('../api/_lib/offers/travelify-search.js');

console.log('The builder sends what the domain lock reads');
{
  const h = travelifyAuthHeaders(474, 'C002FB96-KEY');
  ok('a Referer is present', !!h['Referer'], JSON.stringify(h));
  ok('the credentials still travel as Token appId:key',
    h['Authorization'] === 'Token 474:C002FB96-KEY', h['Authorization']);
  ok('the Origin is still sent, which Travelify also requires',
    h['Origin'] === TRAVELIFY_ORIGIN);
  ok('a number or a padded string both come out clean',
    travelifyAuthHeaders(' 474 ', ' KEY ')['Authorization'] === 'Token 474:KEY');
}

console.log('One Referer, not two that drift apart');
{
  // The offers search solved this three days earlier with its own constant.
  // If these two ever differ, one half of the product is locked out and the
  // other is not, which is exactly the state this bug was found in.
  ok('the order family and the offers search send the same value',
    TRAVELIFY_REFERER === SEARCH_REFERER, `order=${TRAVELIFY_REFERER} search=${SEARCH_REFERER}`);
  ok('and the offers search still sends its own',
    searchHeaders(250, 'k')['Referer'] === SEARCH_REFERER);
}

console.log('The four that matter cannot be overridden from a call site');
{
  const h = travelifyAuthHeaders(474, 'KEY', {
    'Accept': 'application/json',
    'Referer': 'https://example.invalid/',
    'Authorization': 'Token nonsense',
  });
  ok('an extra header is added', h['Accept'] === 'application/json');
  ok('but the Referer cannot be replaced', h['Referer'] === TRAVELIFY_REFERER, h['Referer']);
  ok('nor the credentials', h['Authorization'] === 'Token 474:KEY', h['Authorization']);
}

console.log('It survives the trip to the wire');
{
  // Browsers forbid scripts setting Referer. Node does not, but if that ever
  // changed the header would vanish silently and every locked client would go
  // down with a 401 that reads as a bad key. Assert on what is received.
  const received = await new Promise((resolve) => {
    const srv = http.createServer((req, res) => { res.end('ok'); srv.close(); resolve(req.headers); });
    srv.listen(0, '127.0.0.1', async () => {
      await fetch(`http://127.0.0.1:${srv.address().port}/`, {
        method: 'POST',
        headers: travelifyAuthHeaders(474, 'KEY'),
        body: '{}',
      }).catch(() => {});
    });
  });
  ok('the server actually receives the Referer', received.referer === TRAVELIFY_REFERER, received.referer);
  ok('and the Origin alongside it', received.origin === TRAVELIFY_ORIGIN, received.origin);
}

console.log('Nobody hand-rolls Travelify Token auth');
{
  // Two builders are allowed to contain the literal: they ARE the one place.
  // api/offers.js is a deliberate third: it is a browser proxy that forwards
  // the VISITOR's own Referer, which is the right answer for a domain lock
  // (the visitor really is on the client's site), and it refuses to fabricate
  // one when the browser sends none.
  const ALLOWED = new Set([
    'api/_lib/travelify.js',
    'api/_lib/offers/travelify-search.js',
    'api/offers.js',
  ]);
  const offenders = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) { walk(full); continue; }
      if (!name.endsWith('.js')) continue;
      const rel = relative(ROOT, full);
      if (ALLOWED.has(rel)) continue;
      if (/Token \$\{/.test(readFileSync(full, 'utf8'))) offenders.push(rel);
    }
  };
  walk(join(ROOT, 'api'));
  ok('every other caller goes through the builder', offenders.length === 0,
    'hand-rolled in: ' + offenders.join(', '));

  // And the order family really is wired to it.
  const wired = [
    'api/retrieve-order.js', 'api/booking-pdf.js', 'api/cancel-product.js',
    'api/amend-order.js', 'api/pay-balance.js', 'api/quote-pdf.js',
    'api/internal/retrieve-order-by-client.js', 'api/admin/clients/test-integration.js',
    'api/_lib/payment-reminders.js',
  ];
  for (const f of wired) {
    const src = readFileSync(join(ROOT, f), 'utf8');
    ok(f.replace('api/', '') + ' uses the builder',
      // The path differs by depth, and payment-reminders.js already lives
      // inside _lib, so match the module rather than one spelling of its path.
      /travelifyAuthHeaders\(/.test(src) && /from '[^']*travelify\.js'/.test(src));
  }
}

console.log('The admin test button fails for the same reasons the real call does');
{
  // This screen exists to tell an admin whether a client's credentials work.
  // While it sent no Referer it reported a locked client as broken credentials,
  // which is how a key that was fine got looked at for fifteen hours.
  const src = readFileSync(join(ROOT, 'api/admin/clients/test-integration.js'), 'utf8');
  ok('it sends the same headers as a real order lookup',
    /headers: travelifyAuthHeaders\(creds\.appId, creds\.apiKey\)/.test(src));
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
