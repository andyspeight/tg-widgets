/**
 * "View as client" from Control (24 Sep 2026).
 *
 * Andy: "For the client's access to the control dashboard, I set up what they
 * can have access to here [Control's clients list]. I would like a button that
 * takes me to their logged-in control screen so I can be sure the correct
 * things are showing."
 *
 * The button opens /dashboard.html?viewAs=<client id> in a new tab. That tab
 * asks for a SCOPED act-as grant (POST /api/auth/act-as/start, staff only),
 * keeps it in its own sessionStorage and sends it only on its own request for
 * tiles. It never touches /api/auth/switch-client, the old whole-login switch
 * that re-mints the shared cookie and flipped every tool at once (the July 2026
 * calendar incident; docs/act-as-scoping-spec.md). So the preview is exactly as
 * wide as one tab, and Control, in the tab it came from, stays as Andy.
 *
 * Measured in Chromium against the real pages, with the APIs answered by this
 * test: /api/dashboard/me-products returns the CLIENT's tiles only when the
 * grant arrives on the request, the way requireAuth + me-products do.
 *
 * Run: node test/admin-view-as-client-smoke.mjs   (npm run test:view-as-client)
 */
import { readFileSync, existsSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';

let passed = 0, failed = 0;
const ok = (name, cond, detail) => {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.error('  ✗ ' + name + (detail ? '  — ' + detail : '')); }
};
const R = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');

console.log('\nThe pieces\n');
{
  const products = R('api/dashboard/me-products.js');
  ok('an explicit grant is always a preview, even of a client the staff member is linked to',
    /const impersonating = !!ctx\.actingAs\s*\n?\s*\|\|/.test(products));
  const branch = products.indexOf("resolvedFrom = 'preview_no_entitlements'");
  ok('a preview of a client with nothing switched on never falls back to the staff member\'s own permissions',
    branch > 0 && branch < products.indexOf("resolvedFrom = 'permissions_fallback'")
      && /\} else if \(ctx\.actingAs\) \{\s*\n(?:\s*\/\/.*\n)*\s*visibleSlugs = new Set\(\);/.test(products));
  const dash = R('public/dashboard.html');
  ok('the launchpad asks for the scoped grant', dash.includes("fetch('/api/auth/act-as/start'"));
  ok('keeps it in this tab only (sessionStorage, never localStorage)',
    /sessionStorage\.setItem\(PREVIEW_KEY/.test(dash) && !/localStorage\.setItem\(PREVIEW_KEY/.test(dash));
  const detail = R('public/admin/client-detail.html');
  ok('the client\'s own page in Control has the button, beside their name',
    /\$\{viewAsButton\(c\)\}/.test(detail) && /href="\/dashboard\.html\?viewAs=\$\{encodeURIComponent\(c\.id\)\}" target="_blank" rel="noopener"/.test(detail));
  ok('and so does every row of the clients list', /\$\{viewAsLink\(client\)\}/.test(R('public/admin/clients.html')));
}

let chromium = null;
try { ({ chromium } = await import('playwright')); } catch { /* not installed */ }
const exe = '/opt/pw-browsers/chromium';
if (!chromium || !existsSync(exe)) {
  console.log('\n(Playwright Chromium not available here: the browser half is skipped)');
} else {
  const CLIENT = 'recCLIENTAAAAAAAA';
  const CLIENT_2 = 'recCLIENTBBBBBBBB';
  const CLIENT_3 = 'recCLIENTCCCCCCCC';
  const GRANT = 'grant-for-' + CLIENT;
  const calls = [];
  const PUBLIC = new URL('../public/', import.meta.url).pathname;

  const srv = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    const json = (code, body) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
    if (u.pathname === '/api/auth/act-as/start') {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        const b = JSON.parse(body || '{}');
        calls.push({ path: u.pathname, clientId: b.clientId });
        if (b.clientId === CLIENT_2) return json(403, { ok: false, code: 'target_suspended', error: 'That company is suspended. Contact support.' });
        json(200, { ok: true, grant: 'grant-for-' + b.clientId, ttlMs: 30 * 60 * 1000,
          client: { recordId: b.clientId, clientName: 'Sunny <Days> Travel', plan: 'Boost', status: 'Active' } });
      });
      return;
    }
    if (u.pathname === '/api/dashboard/me-products') {
      const grant = req.headers['x-tg-act-as'] || '';
      calls.push({ path: u.pathname, grant });
      // What requireAuth + me-products do: the grant makes it the client.
      if (grant === 'grant-for-' + CLIENT_3) {
        return json(200, { user: { email: 'andy@travelgenix.io', fullName: 'Andy Speight' },
          client: { clientName: 'Brand New Travel', status: 'Onboarding', packageName: '' },
          products: [], _resolvedFrom: 'preview_no_entitlements' });
      }
      if (grant === GRANT) {
        return json(200, { user: { email: 'andy@travelgenix.io', fullName: 'Andy Speight' },
          client: { clientName: 'Sunny <Days> Travel', status: 'Active', packageName: 'Boost' },
          products: [{ slug: 'widget_suite', name: 'Widget Suite', description: 'Their widgets.', role: 'owner', roleLabel: 'Owner', url: '/index.html' }] });
      }
      return json(200, { user: { email: 'andy@travelgenix.io', fullName: 'Andy Speight' },
        client: { clientName: 'Travelgenix', status: 'Active', packageName: 'Bespoke' },
        products: [
          { slug: 'widget_suite', name: 'Widget Suite', description: 'Everything.', role: 'owner', roleLabel: 'Owner', url: '/index.html' },
          { slug: 'tg_control', name: 'TG Control', description: 'Staff only.', role: 'admin', roleLabel: 'Admin', url: '/admin/', staff: true }] });
    }
    if (u.pathname === '/api/auth/switch-client') { calls.push({ path: u.pathname }); return json(200, { ok: true }); }
    if (u.pathname === '/api/auth/companies') { calls.push({ path: u.pathname }); return json(200, { ok: true, companies: [], currentClientId: null }); }
    if (u.pathname === '/api/auth/staff-clients') return json(403, { ok: false });
    if (u.pathname === '/api/admin/clients/list') {
      return json(200, { total: 2, packages: [], clients: [
        { id: CLIENT, clientName: 'Sunny Days Travel', primaryEmail: 'a@b.c', status: 'Active', userCount: 2, entitlementCount: 3 },
        { id: CLIENT_2, clientName: 'Closed Shop Ltd', primaryEmail: 'x@y.z', status: 'Suspended', userCount: 1, entitlementCount: 1 }] });
    }
    // Static files from public/.
    const file = path.join(PUBLIC, decodeURIComponent(u.pathname));
    if (!file.startsWith(PUBLIC) || !existsSync(file)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': file.endsWith('.html') ? 'text/html' : file.endsWith('.js') ? 'application/javascript' : 'application/octet-stream' });
    res.end(readFileSync(file));
  });
  await new Promise((r) => srv.listen(8797, r));
  const base = 'http://127.0.0.1:8797';

  let browser = null;
  try { browser = await chromium.launch({ executablePath: exe, args: ['--no-sandbox'] }); }
  catch (e) { console.log('  (browser would not launch: ' + String(e.message).split('\n')[0] + ')'); }

  if (browser) {
    const ctx = await browser.newContext();

    console.log('\nThe clients list in Control');
    {
      const page = await ctx.newPage();
      await page.goto(base + '/admin/clients.html');
      await page.waitForSelector('tr[data-client-id]');
      const link = page.locator(`tr[data-client-id="${CLIENT}"] a.view-as`);
      ok('each client row has a "View as client" button', await link.count() === 1);
      ok('it opens their launchpad previewing that client',
        await link.getAttribute('href') === '/dashboard.html?viewAs=' + CLIENT);
      ok('in a new tab, with no link back to this one',
        await link.getAttribute('target') === '_blank' && await link.getAttribute('rel') === 'noopener');
      ok('a suspended client has none, since the server would refuse it',
        await page.locator(`tr[data-client-id="${CLIENT_2}"] a.view-as`).count() === 0);
      const [popup] = await Promise.all([ctx.waitForEvent('page'), link.click()]);
      await popup.close();
      ok('clicking it leaves this page on the list, rather than also opening the client underneath',
        page.url().endsWith('/admin/clients.html'));
      await page.close();
    }

    console.log('\nThe launchpad, previewing');
    {
      const page = await ctx.newPage();
      calls.length = 0;
      await page.goto(base + '/dashboard.html?viewAs=' + CLIENT);
      await page.waitForSelector('.product-tile');
      const start = calls.find((c) => c.path === '/api/auth/act-as/start');
      ok('it asks for a scoped grant for that client', start && start.clientId === CLIENT, JSON.stringify(calls));
      const tiles = calls.find((c) => c.path === '/api/dashboard/me-products');
      ok('and sends it on its request for tiles', tiles && tiles.grant === GRANT, JSON.stringify(tiles));
      ok('so it shows the client\'s tiles, not the staff view',
        (await page.locator('.product-tile').count()) === 1 && !(await page.content()).includes('TG Control'));
      ok('under the client\'s name', (await page.locator('.hero-title').innerText()).includes('Sunny <Days> Travel'));
      const bar = page.locator('#preview-bar');
      ok('with a bar that says who is being previewed', await bar.isVisible() && (await bar.innerText()).includes('Previewing Sunny <Days> Travel'));
      ok('and that it is this tab only', (await bar.innerText()).includes('only in this tab'));
      ok('the client name is escaped, not injected', (await bar.innerHTML()).includes('Sunny &lt;Days&gt; Travel'));
      ok('the address no longer carries ?viewAs', !page.url().includes('viewAs'));
      ok('tiles do not open during a preview, since a product would open as you',
        (await page.locator('a.product-tile').count()) === 0 && (await page.locator('div.product-tile.is-preview').count()) === 1);
      ok('the staff member\'s own company switcher is not loaded', !calls.some((c) => c.path === '/api/auth/companies'));
      ok('and the old whole-login switch is never called, so no other tool changes',
        !calls.some((c) => c.path === '/api/auth/switch-client'));
      const stored = await page.evaluate(() => ({ s: sessionStorage.getItem('tg_viewas'), l: localStorage.getItem('tg_viewas'), c: document.cookie }));
      ok('the grant lives in this tab\'s sessionStorage and nowhere else',
        !!stored.s && JSON.parse(stored.s).grant === GRANT && !stored.l && !stored.c.includes('grant'));

      calls.length = 0;
      await page.reload();
      await page.waitForSelector('.product-tile');
      ok('a reload keeps previewing, without asking for another grant',
        !calls.some((c) => c.path === '/api/auth/act-as/start')
          && calls.find((c) => c.path === '/api/dashboard/me-products').grant === GRANT);

      // Another tab in the same browser: its own sessionStorage, so it is you.
      const other = await ctx.newPage();
      calls.length = 0;
      await other.goto(base + '/dashboard.html');
      await other.waitForSelector('.product-tile');
      ok('another tab is still you: no grant sent, your own tiles',
        calls.find((c) => c.path === '/api/dashboard/me-products').grant === ''
          && (await other.content()).includes('TG Control') && await other.locator('#preview-bar').isHidden());
      await other.close();

      calls.length = 0;
      await page.click('#preview-stop');
      await page.waitForLoadState('load');
      await page.waitForSelector('.product-tile');
      ok('"Stop previewing" puts this tab back to you',
        calls.find((c) => c.path === '/api/dashboard/me-products').grant === ''
          && await page.locator('#preview-bar').isHidden()
          && (await page.locator('a.product-tile').count()) > 0);
      ok('and forgets the grant', await page.evaluate(() => sessionStorage.getItem('tg_viewas')) === null);
      await page.close();
    }

    console.log('\nPreviews that cannot show tiles');
    {
      const page = await ctx.newPage();
      calls.length = 0;
      await page.goto(base + '/dashboard.html?viewAs=' + CLIENT_2);
      await page.waitForSelector('.product-tile');
      ok('it says so plainly', (await page.locator('#preview-bar').innerText()).includes('The preview did not open'));
      ok('with the server\'s own reason', (await page.locator('#preview-bar').innerText()).includes('That company is suspended'));
      ok('and falls back to your own launchpad, never theirs',
        calls.find((c) => c.path === '/api/dashboard/me-products').grant === '');
      await page.close();

      const bare = await ctx.newPage();
      await bare.goto(base + '/dashboard.html?viewAs=' + CLIENT_3);
      await bare.waitForSelector('.empty-state');
      const empty = await bare.locator('.empty-state').innerText();
      ok('a client with nothing switched on says so, rather than looking empty by mistake',
        empty.includes('Nothing is switched on for this client') && empty.includes('Entitlements tab'));
      await bare.close();

      const junk = await ctx.newPage();
      calls.length = 0;
      await junk.goto(base + '/dashboard.html?viewAs=not-a-record-id');
      await junk.waitForSelector('.product-tile');
      ok('a viewAs that is not a record id is ignored without asking the server',
        !calls.some((c) => c.path === '/api/auth/act-as/start') && !junk.url().includes('viewAs'));
      await junk.close();
    }

    await browser.close();
  }
  srv.close();
}

console.log('\n' + passed + ' passed, ' + failed + ' failed\n');
process.exit(failed ? 1 : 0);
