/**
 * Club Picker editor: choosing featured clubs, their photos and the card style,
 * in a real browser (25 Sep 2026).
 *
 * What an agent does: open Featured, choose clubs from this competition's own
 * list, put them in the client's order, give one a photo, switch the rest of
 * the grid to banners, save. Every step must land in the saved config and in
 * the live preview.
 *
 * It also holds a bug found while building this: applying a template replaced
 * the editor's config object, while every control kept writing to the old one,
 * so each edit after a template vanished from the preview and from Save.
 *
 * Run: node test/clubpicker-featured-editor-smoke.mjs   (npm run test:clubpicker-featured-editor)
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const ROOT = new URL('../public/', import.meta.url).pathname;
let passed = 0, failed = 0;
const ok = (label, cond, detail) => {
  if (cond) { passed++; console.log('  ✓ ' + label); }
  else { failed++; console.error('  ✗ ' + label + (detail ? '  — ' + detail : '')); }
};

const TEAMS = ['Arsenal', 'Aston Villa', 'Chelsea', 'Liverpool', 'Manchester City', 'Manchester United', 'Tottenham Hotspur']
  .map((n, i) => ({ key: n.toLowerCase().replace(/ /g, '-'), name: n, initials: n.slice(0, 2).toUpperCase(), hue: i * 40, home: 17, away: 17, homeVenueName: 'Ground' }));
const SAVED = { gridOf: 'team', competition: 'english-premier-league', competitionLabel: 'Premier League', heading: 'Premier League' };

const browser = await chromium.launch({
  executablePath: process.env.TG_CHROMIUM || '/opt/pw-browsers/chromium',
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
});

async function open() {
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  const posts = [];
  await page.route('**/*', async (route) => {
    const url = route.request().url();
    const path = url.replace(/^https?:\/\/[^/]+/, '');
    if (/img\.example\.com/.test(url)) return route.fulfill({ status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"/>' });
    if (path.startsWith('/api/events-feed')) {
      if (/[?&]view=teams(&|$)/.test(path)) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: TEAMS }) });
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ categories: [], competitions: [] }) });
    }
    if (path.startsWith('/api/widget-config?id=')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ name: 'League page', config: SAVED, ...SAVED }) });
    }
    if (route.request().method() === 'POST' && path.startsWith('/api/widget-config')) {
      try { posts.push(JSON.parse(route.request().postData() || '{}')); } catch { posts.push({}); }
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, widgetId: 'tgw_probe' }) });
    }
    if (path.startsWith('/api/auth/me')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ user: { email: 'p@example.com', plan: 'Ignite' } }) });
    if (path.startsWith('/api/')) return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    if (/fonts\.(googleapis|gstatic)/.test(url)) return route.fulfill({ status: 200, contentType: 'text/css', body: '' });
    let file = path.split('?')[0].replace(/^\//, '');
    if (!/\.[a-z0-9]+$/i.test(file)) file += '.html';
    try {
      const body = readFileSync(ROOT + file, 'utf8');
      return route.fulfill({ status: 200, contentType: file.endsWith('.js') ? 'application/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html', body });
    } catch { return route.fulfill({ status: 404, body: '' }); }
  });
  await page.addInitScript(() => {
    try { localStorage.setItem('tg_token', 'p'); localStorage.setItem('tg_user', JSON.stringify({ email: 'p@example.com', plan: 'Ignite' })); } catch (e) { /* none */ }
  });
  await page.goto('https://tg-widgets.vercel.app/editor-clubpicker?id=tgw_probe', { timeout: 20000 });
  await page.waitForTimeout(2200);
  return { page, errs, posts };
}

// What the live preview shows, read out of the widget's shadow root.
const preview = (page) => page.evaluate(() => {
  const root = document.querySelector('#widget-mount').shadowRoot;
  return {
    featured: [...root.querySelectorAll('.tgcp-feat [data-key]')].map((n) => n.getAttribute('data-key')),
    heading: root.querySelector('.tgcp-feat .tgcp-sh')?.textContent || null,
    rest: [...root.querySelectorAll('.tgcp-feat ~ * [data-key], .tgcp-feat ~ [data-key]')].map((n) => n.getAttribute('data-key')),
    restBanners: root.querySelectorAll('.tgcp-bgrid').length,
    img: root.querySelector('.tgcp-feat .tgcp-banner[data-key="liverpool"] img')?.getAttribute('src') || null,
  };
});
const save = async (page, posts) => {
  const before = posts.length;
  await page.click('#btn-save');
  for (let i = 0; i < 30 && posts.length === before; i++) await page.waitForTimeout(100);
  return posts[posts.length - 1] || null;
};

console.log('\nChoosing featured clubs from the competition\'s own list');
{
  const { page, errs, posts } = await open();
  await page.click('#sec-featured .tgse-section-head');
  await page.click('#feat-rows .fr-add-row button');
  await page.waitForTimeout(300);
  const offered = await page.$$eval('#feat-rows .fr-opt .fr-name', (n) => n.map((x) => x.textContent));
  ok('the list offers this competition\'s clubs, A to Z', offered.join('|') === TEAMS.map((t) => t.name).join('|'), offered.join('|'));
  ok('and the search box has the cursor', await page.evaluate(() => document.activeElement?.type === 'search'));
  await page.keyboard.type('liv');
  await page.waitForTimeout(300);
  ok('typing narrows it', (await page.$$eval('#feat-rows .fr-opt .fr-name', (n) => n.map((x) => x.textContent))).join('|') === 'Liverpool');
  await page.click('#feat-rows .fr-opt');
  await page.waitForTimeout(200);
  ok('a pick goes back to the search box, ready for the next', await page.evaluate(() => document.activeElement?.type === 'search'));
  await page.fill('#feat-rows input[type="search"]', 'arsenal');
  await page.waitForTimeout(300);
  await page.click('#feat-rows .fr-opt');
  await page.waitForTimeout(200);
  await page.fill('#feat-rows input[type="search"]', '');
  await page.waitForTimeout(300);
  const left = await page.$$eval('#feat-rows .fr-opt .fr-name', (n) => n.map((x) => x.textContent));
  ok('a club already chosen is not offered again', !left.includes('Liverpool') && !left.includes('Arsenal') && left.length === TEAMS.length - 2, left.join('|'));
  await page.click('#feat-rows .tgse-btn');   // Done
  await page.waitForTimeout(300);
  let p = await preview(page);
  ok('the preview shows them featured, in the order picked', p.featured.join('|') === 'liverpool|arsenal', p.featured.join('|'));
  ok('headed "Featured clubs"', p.heading === 'Featured clubs', p.heading);
  ok('and they left the grid below', !p.rest.includes('liverpool') && !p.rest.includes('arsenal') && p.rest.length === TEAMS.length - 2, p.rest.join('|'));

  await page.click('#feat-rows .fr-row:nth-child(2) button[aria-label^="Move Arsenal up"]');
  await page.waitForTimeout(250);
  p = await preview(page);
  ok('moving Arsenal up puts it first', p.featured.join('|') === 'arsenal|liverpool', p.featured.join('|'));

  await page.fill('#feat-rows .fr-row:nth-child(2) input[type="url"]', 'https://img.example.com/anfield.jpg');
  await page.waitForTimeout(250);
  p = await preview(page);
  ok('a photo address shows on Liverpool\'s banner', p.img === 'https://img.example.com/anfield.jpg', p.img);
  ok('and typing it kept the cursor in the box', await page.evaluate(() => document.activeElement?.type === 'url'));
  await page.fill('#feat-rows .fr-row:nth-child(2) input[type="url"]', 'http://not-secure.example.com/a.jpg');
  await page.waitForTimeout(200);
  ok('an address that will not show says so', await page.evaluate(() => !document.querySelector('#feat-rows .fr-row:nth-child(2) .fr-warn').hidden));
  await page.fill('#feat-rows .fr-row:nth-child(2) input[type="url"]', 'https://img.example.com/anfield.jpg');

  await page.fill('#f-featHeading', 'Utvalda klubbar');
  await page.fill('#f-restHeading', 'Alla klubbar');
  await page.click('.tgse-tabs button[data-tab="design"]');
  await page.click('#sec-cardstyle .tgse-section-head');
  await page.click('#f-gridstyle button[data-v="banner"]');
  await page.waitForTimeout(300);
  p = await preview(page);
  ok('switching everything else to Banner draws the rest as banners too', p.restBanners === 2, String(p.restBanners));
  ok('and offers photos for the other clubs', await page.evaluate(() => !document.getElementById('photos-field').hidden));

  const body = await save(page, posts);
  const c = body && body.config || {};
  ok('Save sends the featured clubs, in order, with the photo',
    JSON.stringify(c.featured) === JSON.stringify([{ key: 'arsenal', name: 'Arsenal', image: '' }, { key: 'liverpool', name: 'Liverpool', image: 'https://img.example.com/anfield.jpg' }]),
    JSON.stringify(c.featured));
  ok('and the headings and card styles', c.featuredHeading === 'Utvalda klubbar' && c.restHeading === 'Alla klubbar'
    && c.featuredStyle === 'banner' && c.gridStyle === 'banner', JSON.stringify({ a: c.featuredHeading, b: c.restHeading, s: c.featuredStyle, g: c.gridStyle }));
  ok('and it kept what was already saved', c.competition === 'english-premier-league' && c.heading === 'Premier League');

  await page.click('.tgse-tabs button[data-tab="content"]');
  await page.click('#feat-rows .fr-row:nth-child(1) .fr-del');
  await page.waitForTimeout(250);
  p = await preview(page);
  ok('removing Arsenal sends it back to the grid', p.featured.join('|') === 'liverpool' && p.rest.includes('arsenal'), p.featured.join('|') + ' / ' + p.rest.join('|'));
  ok('no errors in the editor', errs.length === 0, errs.join(' | '));
  await page.close();
}

console.log('\nBadge tile featured clubs hide the photo fields');
{
  const { page } = await open();
  await page.click('#sec-featured .tgse-section-head');
  await page.click('#feat-rows .fr-add-row button');
  await page.waitForTimeout(300);
  await page.click('#feat-rows .fr-opt');
  await page.click('#feat-rows .tgse-btn');
  await page.click('.tgse-tabs button[data-tab="design"]');
  await page.click('#sec-cardstyle .tgse-section-head');
  await page.click('#f-featstyle button[data-v="tile"]');
  await page.waitForTimeout(250);
  ok('no photo box on a featured row once they are tiles', await page.evaluate(() => !document.querySelector('#feat-rows input[type="url"]')));
  ok('and no banner settings while nothing is a banner', await page.evaluate(() => document.getElementById('banner-opts').hidden));
  await page.close();
}

console.log('\nEdits after a template reach the preview and the save');
{
  const { page, posts } = await open();
  await page.evaluate(() => document.getElementById('btn-templates').click());
  await page.waitForTimeout(300);
  const picked = await page.evaluate(() => {
    const b = [...document.querySelectorAll('button, [role="button"], .tpl, [data-tpl]')]
      .find((x) => /Home games only/.test(x.textContent || ''));
    if (b) b.click();
    return !!b;
  });
  await page.waitForTimeout(300);
  ok('a template was applied', picked);
  await page.evaluate(() => document.getElementById('f-heading').closest('.tgse-section').classList.add('is-open'));
  await page.fill('#f-heading', 'After the template');
  await page.waitForTimeout(250);
  const heading = await page.evaluate(() => document.querySelector('#widget-mount').shadowRoot.querySelector('.tgcp-h')?.textContent);
  ok('the preview shows an edit made after it', heading === 'After the template', heading);
  const body = await save(page, posts);
  ok('and Save sends it', body && body.config && body.config.heading === 'After the template', body && body.config && body.config.heading);
  ok('along with the template\'s own settings', body && body.config && body.config.side === 'home');
  await page.close();
}

console.log('\nSwitching the grid to artists clears the featured clubs');
{
  const { page } = await open();
  await page.click('#sec-featured .tgse-section-head');
  await page.click('#feat-rows .fr-add-row button');
  await page.waitForTimeout(300);
  await page.click('#feat-rows .fr-opt');
  await page.click('#feat-rows .tgse-btn');
  await page.click('#f-gridof button[data-v="performer"]');
  await page.waitForTimeout(250);
  ok('no featured rows left', await page.evaluate(() => !document.querySelector('#feat-rows .fr-row')));
  ok('and the wording follows: artists', await page.evaluate(() => /artists/.test(document.getElementById('feat-hint').textContent)
    && document.getElementById('f-featHeading').placeholder === 'Featured artists'));
  await page.close();
}

await browser.close();
console.log('\n' + passed + ' passed, ' + failed + ' failed\n');
process.exit(failed ? 1 : 0);
