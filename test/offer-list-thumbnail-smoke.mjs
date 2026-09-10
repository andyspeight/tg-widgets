/**
 * The offers list must show a saved photo, and must not be an injection hole.
 *
 * The bug (Andy, 10 Sep 2026): a photo was added and saved, and the list still
 * showed the gradient placeholder, so it looked like the photo had been lost.
 * It had not — the live store held the Blob URL. The list payload from
 * summarise() carried no image field and the row markup hardcoded the
 * placeholder class, so no offer could ever show a thumbnail.
 *
 * Exercises the REAL summarise() from api/saved-offers.js and the REAL thumb()
 * from the editor page, driven in jsdom.
 *
 * Run: node test/offer-list-thumbnail-smoke.mjs  (also: npm run test:offer-list-thumb)
 */
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

let passed = 0, failed = 0;
const ok = (c, label) => { if (c) { passed++; } else { failed++; console.error('  FAIL:', label); } };

// ── The real summarise() from the save API ──────────────────────
const api = readFileSync(new URL('../api/saved-offers.js', import.meta.url), 'utf8');
function bodyOf(src, signature) {
  const i = src.indexOf(signature);
  if (i === -1) throw new Error('not found: ' + signature);
  const open = src.indexOf('{', i);
  let depth = 0, j = open;
  for (; j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') { depth--; if (depth === 0) break; }
  }
  return src.slice(open + 1, j);
}
const summarise = new Function('rec', bodyOf(api, 'function summarise(rec)'));

const withPhoto = { id: 'a1', offer: { fields: { title: 'Zanzibar' }, images: ['https://blob.example/one.jpg', 'https://blob.example/two.jpg'] } };
const noPhoto = { id: 'a2', offer: { fields: { title: 'Qatar' }, images: [] } };
const legacy = { id: 'a3', offer: { fields: { title: 'Old', image: 'https://blob.example/legacy.jpg' } } };

ok(summarise(withPhoto).image === 'https://blob.example/one.jpg', 'the summary carries the cover photo');
ok(summarise(noPhoto).image === '', 'an offer with no photos has an empty cover');
ok(summarise(legacy).image === 'https://blob.example/legacy.jpg', 'a legacy fields.image still resolves');
ok(!Array.isArray(summarise(withPhoto).image), 'the summary stays light: one URL, not the gallery');
ok(summarise(withPhoto).title === 'Zanzibar', 'the rest of the summary is unchanged');

// ── The real thumb() from the editor page ───────────────────────
const raw = readFileSync(new URL('../public/editor-offer-builder.html', import.meta.url), 'utf8');
const STUBS = `<script>
  window.tgse = { init:function(){}, onReady:function(){}, isLoggedIn:function(){return false;},
    setSaveState:function(){}, markDirty:function(){}, toast:function(){}, doSave:function(){} };
  window.TGOfferBuilderWidget = function () { this.submit = function () {}; };
  window.TGOfferBuilderWidget.offerMeta = { types:[], sheetColsFor:function(){return [];}, sheetColOrder:[], sheetColLabels:{}, numericKeys:[] };
  window.fetch = function(){ return Promise.resolve({ ok:true, json:function(){ return Promise.resolve({offers:[]}); } }); };
</script>`;
const html = raw.replace(/<script[^>]*\bsrc=[^>]*><\/script>/g, '').replace('</head>', STUBS + '</head>');
const { window } = new JSDOM(html, { runScripts: 'dangerously', url: 'https://widgets.travelify.io/editor-offer-builder' });

const draw = (image) => window.thumb({ id: 'x', image });

ok(/background-image:url\(https:\/\/blob\.example\/one\.jpg\)/.test(draw('https://blob.example/one.jpg')),
  'a saved photo is drawn as the row thumbnail');
ok(!/\bph\b/.test(draw('https://blob.example/one.jpg')), 'and it drops the placeholder class');
ok(/offer-thumb ph/.test(draw('')), 'no photo still gets the gradient placeholder');
ok(/offer-thumb ph/.test(draw(undefined)), 'a missing image field is handled');

// ── It must not become a style-attribute injection hole ─────────
const attacks = [
  'https://x/y.jpg)"onload="alert(1)',       // break out of url() and the attribute
  "https://x/y.jpg');background:url('evil",  // quote breakout
  'javascript:alert(1)',                      // wrong scheme
  'http://x/y.jpg',                           // plain http
  'https://x/y.jpg?a=1 b=2',                  // whitespace
  'https://x/\\y.jpg',                        // backslash
  'https://x/' + 'a'.repeat(1200) + '.jpg',   // over the length cap
];
attacks.forEach((a) => {
  const out = draw(a);
  ok(/offer-thumb ph/.test(out) && !/background-image/.test(out),
    'rejected and fell back to the placeholder: ' + a.slice(0, 40));
});

// Parse the rendered row: a valid URL must produce exactly one element with
// only the two attributes we wrote, so nothing has escaped the style value.
{
  const host = window.document.createElement('div');
  host.innerHTML = draw('https://blob.example/one.jpg');
  const node = host.firstElementChild;
  ok(host.children.length === 1 && node.tagName === 'DIV', 'one element, no injected siblings');
  ok(node.getAttributeNames().sort().join(',') === 'class,style', 'only class and style are set');
  ok(node.style.backgroundImage.includes('blob.example/one.jpg'), 'the cover URL landed in background-image');
  ok(!node.hasAttribute('onload') && !node.hasAttribute('onerror'), 'no event handler attribute was smuggled in');
}
// And the worst breakout attempt must not create an element with a handler.
{
  const host = window.document.createElement('div');
  host.innerHTML = draw('https://x/y.jpg)"onload="alert(1)');
  const node = host.firstElementChild;
  ok(!node.hasAttribute('onload'), 'a url() breakout attempt cannot add onload');
  ok(node.className.includes('ph'), 'and the row falls back to the placeholder');
}

// ── The row renderer must actually USE it ───────────────────────
// Calling thumb() directly proves nothing about the list: the row markup used
// to hardcode the placeholder. Drive the real renderCards() and read the DOM.
// `state` is a const, so it is script-scoped rather than on window. Drive the
// real loader instead, which exercises the whole list path end to end.
{
  window.fetch = () => Promise.resolve({
    ok: true,
    json: () => Promise.resolve({
      offers: [
        { id: 'a1', title: 'Zanzibar', price: '1700', image: 'https://blob.example/one.jpg' },
        { id: 'a2', title: 'Qatar', price: '1850', image: '' },
      ],
    }),
  });
  window.setView('cards');
  window.loadOffers();
  await new Promise((r) => setTimeout(r, 20));
  const rows = window.document.querySelectorAll('#offersList .offer-row');
  ok(rows.length === 2, 'both offers rendered as rows');
  const withImg = rows[0].querySelector('.offer-thumb');
  const without = rows[1].querySelector('.offer-thumb');
  ok(withImg && withImg.style.backgroundImage.includes('blob.example/one.jpg'),
    'the row for an offer WITH a photo shows that photo');
  ok(withImg && !withImg.classList.contains('ph'), 'and not the gradient placeholder');
  ok(without && without.classList.contains('ph'), 'the row for an offer with no photo keeps the placeholder');
}

console.log('\nOffer list thumbnail: ' + passed + ' passed, ' + failed + ' failed.');
process.exit(failed ? 1 : 0);
