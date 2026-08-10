/**
 * Special Offers — cruise offer PAGE template (Andy, 10 Aug 2026, client design).
 *
 * A new selectable page template ("cruise") alongside classic/editorial/immersive
 * (nothing lost): hero → What's Included beside a sticky quote/call box (price,
 * offer details, quote reference, "Call us on…" + Enquire) → alternating image+
 * text story blocks → gallery/video/map → enquiry form → CTA. Built from existing
 * offer fields (reference, enquiryPhone, ship/cruise/cabin, itinerary, includes).
 *
 * Source guards (jsdom isn't available here): the whitelist in BOTH the widget and
 * the server, the render branch, the reused/added builders, i18n and styles.
 *
 * Run: node test/offer-cruise-page-smoke.mjs  (also: npm run test:offer-cruise-page)
 */
import { readFileSync } from 'node:fs';

let passed = 0, failed = 0;
const ok = (c, label) => { if (c) { passed++; } else { failed++; console.error('  FAIL:', label); } };

const page = readFileSync(new URL('../public/widget-offer-page.js', import.meta.url), 'utf8');
const server = readFileSync(new URL('../api/offer-page.js', import.meta.url), 'utf8');

// Whitelisted in BOTH the widget render gate and the server (miss the server one
// and ?template=cruise silently downgrades to classic).
ok(/const templates = \['classic', 'editorial', 'immersive', 'cruise'\]/.test(page), 'page whitelists the cruise template');
ok(/const TEMPLATES = \['classic', 'editorial', 'immersive', 'cruise'\]/.test(server), 'server whitelists the cruise template (so the query survives)');

// Render branch.
ok(/else if \(cfg\.template === 'cruise'\) \{/.test(page), 'render has a cruise branch');
{
  const b = page.slice(page.indexOf("cfg.template === 'cruise'"), page.indexOf('} else { // classic'));
  ok(/this\._cruiseBook\(d\)/.test(b), 'cruise aside uses the quote/call box');
  ok(/this\._cruiseStory\(d\)/.test(b), 'cruise page renders the story blocks');
  ok(/this\._enquiryForm\(d\)/.test(b), 'cruise page mounts the enquiry form (data-enquire target)');
  ok(/tgop-cruise-main/.test(b) && /tgop-cruise-aside/.test(b), 'What\'s-included beside a sticky aside');
}

// The form was extracted so both cards reuse it (one form, one enquiry target).
ok(/_enquiryForm\(d\) \{/.test(page), '_enquiryForm helper defined');
ok(/return '<div class="tgop-book">'[\s\S]{0,400}this\._enquiryForm\(d\)/.test(page), '_bookCard reuses _enquiryForm (no duplicate form)');

// Quote box pulls the offer's own reference + phone; phone-led call button.
{
  const b = page.slice(page.indexOf('_cruiseBook(d) {'), page.indexOf('_cruiseStory(d) {'));
  ok(/d\.reference/.test(b) && /quoteReference/.test(b), 'quote reference shown');
  ok(/callUsOn/.test(b) && /href="tel:/.test(b), '"Call us on" button links to the phone');
  ok(/data-enquire/.test(b), 'Enquire button (scrolls to the form)');
  ok(/tgop-btn outline block/.test(b), 'Enquire uses the light-surface outline button (visible on white)');
}

// Story blocks alternate image + text, pairing with gallery images.
{
  const b = page.slice(page.indexOf('_cruiseStory(d) {'), page.indexOf('_cruiseStory(d) {') + 1200);
  ok(/tgop-story--flip/.test(b), 'story sides alternate');
  ok(/d\.images\.slice\(1\)/.test(b), 'stories pair with gallery images (hero excluded)');
  ok(/tgop-story--solo/.test(b), 'a block with no image falls back to full-width prose');
}

// i18n + styles.
ok(/offerDetails: 'Offer details'/.test(page) && /callUsOn: 'Call us on \{phone\}'/.test(page) && /quoteReference: 'Quote reference'/.test(page), 'cruise labels present');
ok(/\.tgop-quote \{/.test(page) && /\.tgop-story \{/.test(page) && /\.tgop-cruise-top \{/.test(page), 'cruise styles present');
ok(/\.tgop-btn\.outline \{/.test(page), 'light-surface outline button style added');

// Version.
{
  const vm = page.match(/VERSION = '(\d+)\.(\d+)\.(\d+)'/);
  ok(vm && (+vm[1] > 0 || (+vm[1] === 0 && +vm[2] >= 3)), 'page version at or beyond 0.3');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
