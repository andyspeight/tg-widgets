/**
 * Tour Builder editor smoke (headless Playwright).
 * Run: node test/tour-editor-smoke.mjs        (npm run test:tour-editor)
 *
 *   1. Signed-out boot redirects to sign-in (shell auth gate)
 *   2. Seeded-session boot: toolbar + builder sections render, preview shows the
 *      starter tour, no script errors
 *   3. Editing the title round-trips into the live preview
 *   4. Adding a day grows the itinerary and shows in the preview
 *   5. Build/Preview toggle works
 *   6. Plumbing consistency (registry / limits / rewrite / widgetType)
 */
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(__dirname, '..', 'public');
const ROOT = path.join(__dirname, '..');

let passed = 0, failed = 0;
const ok = (c, label) => { if (c) { passed++; } else { failed++; console.error('  FAIL:', label); } };

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json' };
function serve(dir, port) {
  return new Promise((res) => {
    const s = http.createServer((req, rsp) => {
      const p = decodeURIComponent(req.url.split('?')[0]);
      if (p.startsWith('/api/')) { rsp.statusCode = 404; rsp.setHeader('Content-Type', 'application/json'); rsp.setHeader('Access-Control-Allow-Origin', '*'); return rsp.end('{"error":"not here"}'); }
      const fp = path.join(dir, p === '/' ? 'index.html' : p);
      if (!fp.startsWith(dir) || !fs.existsSync(fp) || !fs.statSync(fp).isFile()) { rsp.statusCode = 404; return rsp.end('nf'); }
      rsp.setHeader('Content-Type', MIME[path.extname(fp)] || 'application/octet-stream');
      fs.createReadStream(fp).pipe(rsp);
    });
    s.listen(port, () => res(s));
  });
}

const PORT = 8126;
const BASE = `http://localhost:${PORT}`;
const server = await serve(PUBLIC, PORT);
const executablePath = process.env.TGS_CHROMIUM || undefined;
const browser = await chromium.launch({ executablePath, args: ['--no-sandbox', '--disable-dev-shm-usage'] });

const isNoise = (t) => /Failed to load resource|net::|ERR_|fonts\.googleapis|fonts\.gstatic|images\.unsplash|favicon|signin/i.test(t);
async function newPage() {
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e));
  page.on('console', (m) => { if (m.type() === 'error' && !isNoise(m.text())) errors.push('console: ' + m.text()); });
  await page.route('https://id.travelify.io/**', (r) => r.fulfill({ status: 401, contentType: 'application/json', body: '{"ok":false}' }));
  await page.route('https://fonts.googleapis.com/**', (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await page.route('https://fonts.gstatic.com/**', (r) => r.abort());
  await page.route('https://images.unsplash.com/**', (r) => r.abort());
  return { page, errors };
}

// ── 1. Signed-out boot redirects to sign-in ──────────────────────────────────
{
  const { page } = await newPage();
  await page.goto(`${BASE}/editor-tour.html`, { waitUntil: 'load', timeout: 20000 });
  await page.waitForURL('**/signin.html**', { timeout: 8000 }).catch(() => {});
  ok(/\/signin\.html\?next=%2Feditor-tour/.test(page.url()), `editor: signed-out boot redirects to sign-in (got "${page.url()}")`);
  await page.close();
}

// ── 2-5. Seeded-session boot + editing ───────────────────────────────────────
{
  const { page, errors } = await newPage();
  await page.addInitScript(() => {
    localStorage.setItem('tg_token', 'smoke-token');
    localStorage.setItem('tg_user', JSON.stringify({ email: 'smoke@test.local', plan: 'Bespoke' }));
  });
  await page.goto(`${BASE}/editor-tour.html`, { waitUntil: 'load', timeout: 20000 });
  await page.waitForFunction(() => document.querySelectorAll('#tb-build .sec').length >= 8, { timeout: 8000 }).catch(() => {});

  const boot = await page.evaluate(() => ({
    url: location.pathname,
    sections: document.querySelectorAll('#tb-build .sec').length,
    saveBtn: !!document.getElementById('btn-save'),
    nameInput: !!document.getElementById('name-input'),
    toggle: document.querySelectorAll('.tb-toggle button').length,
  }));
  ok(boot.url === '/editor-tour.html', 'editor: signed-in boot stays on the editor');
  ok(boot.sections >= 8, `editor: builder sections rendered (got ${boot.sections})`);
  ok(boot.saveBtn && boot.nameInput && boot.toggle === 2, 'editor: toolbar (save, name, view toggle) present');

  // Settings panel present (house pattern from the Group Trips editor): a
  // "Settings" section carrying the payments/enquiries callouts, no dead controls.
  const settings = await page.evaluate(() => {
    const sec = [...document.querySelectorAll('#tb-build .sec')].find(s => s.querySelector('h2')?.textContent === 'Settings');
    return { present: !!sec, notes: sec ? sec.querySelectorAll('.sec-note').length : 0 };
  });
  ok(settings.present, 'editor: Settings panel rendered');
  ok(settings.notes >= 2, `editor: Settings panel carries the payments + enquiries notes (got ${settings.notes})`);

  // Preview shows the starter tour
  await page.click('.tb-toggle button[data-view="preview"]');
  await page.waitForFunction(() => {
    const m = document.getElementById('tour-mount');
    return !!(m && m.shadowRoot && m.shadowRoot.querySelector('[data-role="title"]'));
  }, { timeout: 6000 }).catch(() => {});
  let previewTitle = await page.evaluate(() => document.getElementById('tour-mount')?.shadowRoot?.querySelector('[data-role="title"]')?.textContent || '');
  ok(previewTitle === 'Your escorted tour', `editor: preview renders the starter tour (got "${previewTitle}")`);

  // Edit the title, back to preview, confirm it flows through
  await page.click('.tb-toggle button[data-view="editor"]');
  await page.fill('input[placeholder*="Kenya Johari"]', 'Serengeti Grand Safari');
  await page.waitForTimeout(300);
  await page.click('.tb-toggle button[data-view="preview"]');
  await page.waitForTimeout(200);
  previewTitle = await page.evaluate(() => document.getElementById('tour-mount')?.shadowRoot?.querySelector('[data-role="title"]')?.textContent || '');
  ok(previewTitle === 'Serengeti Grand Safari', `editor: title edit flows into the preview (got "${previewTitle}")`);

  // Count days in preview (starter has 1), add a day, confirm 2
  const daysBefore = await page.evaluate(() => document.getElementById('tour-mount')?.shadowRoot?.querySelectorAll('[data-role="day"]').length || 0);
  ok(daysBefore === 1, `editor: starter has one day (got ${daysBefore})`);
  await page.click('.tb-toggle button[data-view="editor"]');
  await page.click('text=+ Add a day');
  await page.waitForTimeout(150);
  await page.click('.tb-toggle button[data-view="preview"]');
  await page.waitForTimeout(200);
  const daysAfter = await page.evaluate(() => document.getElementById('tour-mount')?.shadowRoot?.querySelectorAll('[data-role="day"]').length || 0);
  ok(daysAfter === 2, `editor: adding a day grows the itinerary (got ${daysAfter})`);

  // ── Image upload: a file uploads to Blob and its URL lands in the field ────
  await page.click('.tb-toggle button[data-view="editor"]');
  // Stub the Blob client CDN import so the upload is hermetic (no network).
  await page.route('https://esm.sh/**', (r) => r.fulfill({
    status: 200, contentType: 'text/javascript',
    body: 'export function upload(path, file, opts){ return Promise.resolve({ url: "https://blob.example/" + encodeURIComponent(path) }); }',
  }));
  const controls = await page.evaluate(() => ({
    files: document.querySelectorAll('#tb-build input[type=file]').length,
    ups: document.querySelectorAll('#tb-build .up-btn').length,
  }));
  ok(controls.files >= 3 && controls.ups >= 3, `editor: image fields expose upload controls (files=${controls.files}, buttons=${controls.ups})`);

  // Upload into the hero image field (first image field, in Tour basics).
  await page.locator('#tb-build input[type=file]').first().setInputFiles({
    name: 'hero.jpg', mimeType: 'image/jpeg', buffer: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]),
  });
  await page.waitForFunction(() => {
    const f = document.querySelector('#tb-build input[type=file]');
    const inp = f && f.parentElement.querySelector('.img-row .in');
    return inp && /^https:\/\/blob\.example\//.test(inp.value);
  }, { timeout: 6000 }).catch(() => {});
  const heroUrl = await page.evaluate(() => {
    const f = document.querySelector('#tb-build input[type=file]');
    const inp = f && f.parentElement.querySelector('.img-row .in');
    return inp ? inp.value : '';
  });
  ok(/^https:\/\/blob\.example\/offer-photos%2Ftour-/.test(heroUrl),
    `editor: uploading a file stores the returned Blob URL in the field (got "${heroUrl}")`);
  // And it flows into the live preview.
  await page.waitForFunction(() => !!document.getElementById('tour-mount')?.shadowRoot?.querySelector('img[src^="https://blob.example/"]'), { timeout: 4000 }).catch(() => {});
  const heroInPreview = await page.evaluate(() => !!document.getElementById('tour-mount')?.shadowRoot?.querySelector('img[src^="https://blob.example/"]'));
  ok(heroInPreview, 'editor: uploaded image flows into the live preview');

  ok(errors.length === 0, 'editor: no script errors (' + errors.join(' | ') + ')');
  await page.close();
}

// ── 7. Import from PDF: extract text → AI-structure → fill the builder ────────
// The browser reads the PDF locally (pdf.js from the CDN) and POSTs the plain
// text to /api/widget-ai; the endpoint returns a structured tour config which
// fills every field and the live preview. It must NEVER auto-save — the copy
// says "Review… then Save". Both the CDN module and the AI endpoint are stubbed
// so the test is hermetic.
{
  const { page, errors } = await newPage();
  await page.addInitScript(() => {
    localStorage.setItem('tg_token', 'smoke-token');
    localStorage.setItem('tg_user', JSON.stringify({ email: 'smoke@test.local', plan: 'Bespoke' }));
  });

  // Long readable text so extractPdfText clears its 200-char "scanned images" floor.
  const PDF_TEXT = 'Kilimanjaro Grand Trek. ' + 'Ten unforgettable days on the roof of Africa, from Arusha to Uhuru Peak, with Serengeti game drives to follow. '.repeat(6);

  // Fake pdf.js module served for the esm.sh import. getDocument yields one page
  // whose text is PDF_TEXT; GlobalWorkerOptions exists so the workerSrc set is a no-op.
  const FAKE_PDFJS =
    'export const GlobalWorkerOptions = {};' +
    'export function getDocument(){' +
    '  return { promise: Promise.resolve({' +
    '    numPages: 1,' +
    '    getPage(){ return Promise.resolve({ getTextContent(){ return Promise.resolve({ items: [{ str: ' + JSON.stringify(PDF_TEXT) + ' }] }); } }); },' +
    '    destroy(){ return Promise.resolve(); }' +
    '  }) };' +
    '}';
  await page.route('https://esm.sh/**', (r) => r.fulfill({ status: 200, contentType: 'text/javascript', body: FAKE_PDFJS }));

  // Mock the AI structuring endpoint exactly as api/widget-ai answers: { config }.
  const IMPORTED = {
    tour: { title: 'Imported Kilimanjaro Trek', subtitle: 'Ten days on the roof of Africa', summary: 'A faithful summary drawn from the brochure text, ready for review before saving.' },
    glance: [{ day: 'Day 1', date: '', destination: 'Arusha', accommodation: 'Mountain Lodge' }],
    highlights: ['Summit Uhuru Peak at dawn', 'Serengeti game drives'],
    days: [
      { label: 'Day 1', title: 'Arrive in Arusha', body: 'Welcome to Tanzania and transfer to your lodge.' },
      { label: 'Day 2', title: 'Trek to base camp', body: 'The ascent through rainforest begins.' },
      { label: 'Day 3', title: 'Summit day', body: 'Reach Uhuru Peak at sunrise.' },
    ],
    included: ['All meals on trek', 'Park and rescue fees'],
    excluded: ['International flights', 'Travel insurance'],
  };
  let aiCalls = 0, aiAction = '', savePosts = 0;
  await page.route('**/api/widget-ai', async (r) => {
    aiCalls++;
    try { aiAction = (r.request().postDataJSON() || {}).action || ''; } catch (e) { /* ignore */ }
    await r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ config: IMPORTED }) });
  });
  // Watch for any save — import populates for review and must not POST a save.
  page.on('request', (req) => { if (req.method() === 'POST' && /\/api\/widget-config(\?|$)/.test(req.url())) savePosts++; });

  await page.goto(`${BASE}/editor-tour.html`, { waitUntil: 'load', timeout: 20000 });
  await page.waitForFunction(() => document.querySelectorAll('#tb-build .sec').length >= 8, { timeout: 8000 }).catch(() => {});

  ok(await page.evaluate(() => !!document.getElementById('btn-import') && !!document.getElementById('import-file')),
    'import: toolbar exposes the Import PDF control');

  // Feed a PDF. The starter tour is pristine, so no replace-confirm dialog fires.
  await page.locator('#import-file').setInputFiles({
    name: 'brochure.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 pretend bytes for the smoke test'),
  });
  await page.waitForFunction(() => document.getElementById('name-input')?.value === 'Imported Kilimanjaro Trek', { timeout: 8000 }).catch(() => {});

  ok(aiCalls === 1, `import: one AI structuring call fired (got ${aiCalls})`);
  ok(aiAction === 'import-tour', `import: request carries action "import-tour" (got "${aiAction}")`);

  const nameVal = await page.evaluate(() => document.getElementById('name-input')?.value || '');
  ok(nameVal === 'Imported Kilimanjaro Trek', `import: tour title fills the name field (got "${nameVal}")`);

  // Builder fields populate from the imported config.
  const filled = await page.evaluate(() => {
    const vals = [...document.querySelectorAll('#tb-build input, #tb-build textarea')].map(el => el.value);
    return {
      hasTitle: vals.includes('Imported Kilimanjaro Trek'),
      hasDayTitle: vals.includes('Summit day'),
      hasHighlight: vals.some(v => /Uhuru Peak at dawn/.test(v)),
    };
  });
  ok(filled.hasTitle, 'import: tour title fills the builder');
  ok(filled.hasDayTitle, 'import: itinerary day titles fill the builder');
  ok(filled.hasHighlight, 'import: highlights fill the builder');

  // Live preview reflects the imported tour.
  await page.click('.tb-toggle button[data-view="preview"]');
  await page.waitForFunction(() => document.getElementById('tour-mount')?.shadowRoot?.querySelector('[data-role="title"]')?.textContent === 'Imported Kilimanjaro Trek', { timeout: 6000 }).catch(() => {});
  const pv = await page.evaluate(() => ({
    title: document.getElementById('tour-mount')?.shadowRoot?.querySelector('[data-role="title"]')?.textContent || '',
    days: document.getElementById('tour-mount')?.shadowRoot?.querySelectorAll('[data-role="day"]').length || 0,
  }));
  ok(pv.title === 'Imported Kilimanjaro Trek', `import: preview shows the imported title (got "${pv.title}")`);
  ok(pv.days === 3, `import: preview shows the imported itinerary (got ${pv.days} days)`);

  // The whole point: populate for review, never auto-save.
  ok(savePosts === 0, `import: import does not auto-save (saw ${savePosts} save POSTs)`);

  ok(errors.length === 0, 'import: no script errors (' + errors.join(' | ') + ')');
  await page.close();
}

await browser.close();
server.close();

// ── 6. Plumbing consistency ──────────────────────────────────────────────────
{
  const indexHtml = fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8');
  const widgetConfig = fs.readFileSync(path.join(ROOT, 'api', 'widget-config.js'), 'utf8');
  const vercel = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
  const editorHtml = fs.readFileSync(path.join(PUBLIC, 'editor-tour.html'), 'utf8');

  ok(/airtableType:\s*'Escorted Tour'/.test(indexHtml), 'plumbing: registry entry declares airtableType Escorted Tour');
  ok(indexHtml.includes('<script src="/widget-tour.js"></script>'), 'plumbing: dashboard loads widget-tour.js');
  ok(/'Escorted Tour',/.test(widgetConfig), 'plumbing: Escorted Tour in ALLOWED_WIDGET_TYPES');
  ok(/'Escorted Tour':\s*\{\s*Spark:\s*0,\s*Boost:\s*1,\s*Ignite:\s*-1,\s*Bespoke:\s*-1\s*\}/.test(widgetConfig), 'plumbing: PLAN_WIDGET_LIMITS matches registry access');
  const rw = vercel.rewrites || [];
  ok(rw.some(r => r.source === '/editor-tour' && r.destination === '/editor-tour.html'), 'plumbing: /editor-tour rewrite');
  ok(rw.some(r => r.source === '/demo-tour' && r.destination === '/demo-tour.html'), 'plumbing: /demo-tour rewrite');
  ok((vercel.headers || []).some(h => h.source === '/widget-tour.js'), 'plumbing: widget-tour.js CORS headers');
  ok(/widgetType:\s*'Escorted Tour'/.test(editorHtml), 'plumbing: editor inits with widgetType Escorted Tour');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
