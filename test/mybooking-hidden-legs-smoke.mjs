/**
 * Two My Booking layout faults, fixed 25 Sep 2026.
 *
 * 1. A BUTTON HIDDEN BY ITS OWN CLICK STAYED ON SCREEN. "Request a change" and
 *    "Pay balance" each hide themselves (`button.hidden = true`) when pressed
 *    and show their form instead. Both classes set `display: inline-flex`, and
 *    a class that sets display beats the browser's own `[hidden]` rule, so the
 *    button stayed where it was with the form open underneath it. One rule at
 *    the top of the widget's stylesheet makes hidden mean hidden everywhere in
 *    the widget: `[hidden] { display: none !important; }`. The same fault has
 *    been fixed the same way in the TG Slicer panel, Testimonials and the
 *    destinations dashboard.
 *
 * 2. ON A PHONE THE FLIGHT LEG'S MIDDLE WAS TURNED ON ITS SIDE. Below 480px (and
 *    in a narrow container such as the Luna chat bubble, via .tgm-narrow) a leg
 *    stacks, departure above arrival. The line between them was the desktop
 *    line rotated 90 degrees in a 24px box, which set "2h 30m" and "Direct" on
 *    their side and clipped the plane off the card's edge. It is now a real
 *    vertical line, the plane pointing down it, with the duration and stops
 *    reading normally beside it.
 *
 * Static checks always run. The measurements run when Playwright's Chromium is
 * here and skip cleanly otherwise.
 *
 * Run: node test/mybooking-hidden-legs-smoke.mjs   (npm run test:mybooking-hidden-legs)
 */
import { readFileSync, existsSync } from 'node:fs';

let passed = 0, failed = 0;
const ok = (name, cond, detail) => {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.error('  ✗ ' + name + (detail ? '  — ' + detail : '')); }
};
const SRC = readFileSync(new URL('../public/widget-mybooking.js', import.meta.url), 'utf8');

console.log('\nHidden means hidden');
ok('the stylesheet restores [hidden] with !important',
  /\n\s*\[hidden\] \{ display: none !important; \}/.test(SRC));
// The rule is only load-bearing while these classes set a display of their own.
ok('"Request a change" still sets its own display (so the rule is what hides it)',
  /\.tgm-amend-open \{[^}]*display: inline-flex/.test(SRC));
ok('"Pay balance" still sets its own display', /\.tgm-pay-cta \{[^}]*display: inline-flex/.test(SRC));

console.log('\nThe phone layout draws the leg line upright');
ok('nothing turns the leg line on its side any more', !/\.tgm-leg-line \{[^}]*rotate\(90deg\)/.test(SRC));
// There is more than one 480px block; the legs' is the one that stacks the route.
const media = (SRC.match(/@media \(max-width: 480px\) \{[\s\S]*?\n    \}/g) || []).find((b) => b.includes('.tgm-leg-route')) || '';
ok('the phone media query draws a vertical line', /\.tgm-leg-line-bar \{[^}]*width: 2px; height: 48px/.test(media));
ok('the narrow container draws the same line', /\.tgm-root\.tgm-narrow \.tgm-leg-line-bar \{[^}]*width: 2px; height: 48px/.test(SRC));

// A trimmed order as /api/retrieve-order sends it: one return flight, and a
// balance still to pay so the Pay balance button is drawn.
const seg = (from, fromName, to, toName, depart, arrive, no) => ({
  origin: { iataCode: from, name: fromName }, destination: { iataCode: to, name: toName },
  depart, arrive, duration: 150, marketingCarrier: { code: 'EZY', name: 'easyJet' }, flightNo: no,
});
const travellers = [
  { type: 'Adult', title: 'Mr', firstname: 'Daniel', surname: 'Reilly' },
  { type: 'Adult', title: 'Mrs', firstname: 'Sarah', surname: 'Reilly' },
];
const ORDER = {
  id: 122410, currency: 'GBP',
  items: [{
    id: 111371, status: 'Booked', product: 'Flights', price: 400, startDate: '2027-04-09T06:30:00',
    flights: {
      routes: [
        { direction: 'Outbound', duration: 150, segments: [seg('LGW', 'London Gatwick', 'PMI', 'Palma de Mallorca', '2027-04-09T06:30:00', '2027-04-09T09:40:00', 'EZY8021')] },
        { direction: 'Inbound', duration: 145, segments: [seg('PMI', 'Palma de Mallorca', 'LGW', 'London Gatwick', '2027-04-16T10:20:00', '2027-04-16T11:45:00', 'EZY8022')] },
      ],
      fareInformation: [], travellers, extras: [], cabins: [],
    },
  }],
  summary: { totalPrice: 400, hasFlights: true, flightItems: 1, earliestStart: '2027-04-09T06:30:00', travellers },
  money: { currency: 'GBP', digits: 2, total: 400, paid: 0, voucherCredit: 0, balance: 400, vouchers: [], excluded: [], status: 'open', settled: false, applied: false, hasSchedule: false, schedule: [], scheduleOutstanding: null, outstanding: 400, isInstalment: false, nextDue: { amount: 400, dueDate: null, remainingAmount: 0, isInstalment: false }, payable: 400 },
  paidToDate: 0, documents: [],
};

let chromium = null;
try { ({ chromium } = await import('playwright')); } catch { /* not installed */ }
const exe = process.env.TG_CHROMIUM || '/opt/pw-browsers/chromium';
if (!chromium || !existsSync(exe)) {
  console.log('\n(Playwright Chromium not available here: measurements skipped)');
} else {
  let browser = null;
  try { browser = await chromium.launch({ executablePath: exe, args: ['--no-sandbox', '--disable-gpu'] }); }
  catch (e) { console.log('  (browser would not launch: ' + String(e.message).split('\n')[0] + ')'); }
  if (browser) {
    // hostWidth narrows the container on a wide screen (the chat bubble case).
    const mount = async (viewport, hostWidth) => {
      const page = await browser.newPage({ viewport });
      const errors = []; page.on('pageerror', (e) => errors.push(e.message));
      await page.setContent('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head>'
        + '<body style="margin:0;padding:16px"><div id="h" style="' + (hostWidth ? 'width:' + hostWidth + 'px' : '') + '"></div></body></html>');
      await page.addScriptTag({ content: SRC });
      await page.evaluate((order) => {
        const w = new window.TGMyBookingWidget(document.getElementById('h'), { widgetId: 'tgw_test', support: { email: 'a@b.c' } });
        w.lookup = { email: 'daniel@example.com', date: '2027-04-09', ref: 'DEMO122410' };
        w.state = { stage: 'found', order, upsell: [], error: null };
        w._render();
        window.__w = w;
      }, ORDER);
      await page.waitForTimeout(200);
      return { page, errors };
    };
    const shown = (sel) => `(() => { const el = window.__w.shadow.querySelector('${sel}'); return !!el && getComputedStyle(el).display !== 'none' && el.getBoundingClientRect().height > 0; })()`;
    const press = (sel) => `window.__w.shadow.querySelector('${sel}').click()`;

    console.log('\nMeasured in Chromium: the buttons');
    {
      const { page, errors } = await mount({ width: 900, height: 900 });
      ok('"Request a change" is on screen to begin with', await page.evaluate(shown('[data-tgm-amend-open]')));
      await page.evaluate(press('[data-tgm-amend-open]'));
      ok('pressed, it leaves the screen', !(await page.evaluate(shown('[data-tgm-amend-open]'))));
      ok('and its form is there instead', await page.evaluate(shown('[data-tgm-amend-form]')));
      await page.evaluate(press('[data-tgm-amend-cancel]'));
      ok('Cancel brings the button back', await page.evaluate(shown('[data-tgm-amend-open]')));
      ok('and puts the form away', !(await page.evaluate(shown('[data-tgm-amend-form]'))));

      ok('"Pay balance" is drawn for a booking with money owed', await page.evaluate(shown('[data-tgm-pay-open]')));
      await page.evaluate(press('[data-tgm-pay-open]'));
      ok('pressed, it leaves the screen', !(await page.evaluate(shown('[data-tgm-pay-open]'))));
      ok('and the amount form is there instead', await page.evaluate(shown('[data-tgm-pay-form]')));
      await page.evaluate(press('[data-tgm-pay-cancel]'));
      ok('Cancel brings it back', await page.evaluate(shown('[data-tgm-pay-open]')));
      ok('no page errors', errors.length === 0, errors.join(' | '));
      await page.close();
    }

    const legs = async (label, viewport, hostWidth) => {
      console.log('\nMeasured in Chromium: the flight legs, ' + label);
      const { page, errors } = await mount(viewport, hostWidth);
      const m = await page.evaluate(() => {
        const s = window.__w.shadow;
        const card = s.querySelector('.tgm-flight-card').getBoundingClientRect();
        return [...s.querySelectorAll('.tgm-leg-line')].map((line) => {
          const box = (el) => { const r = el.getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom, w: r.width, h: r.height }; };
          return {
            transform: getComputedStyle(line).transform,
            bar: box(line.querySelector('.tgm-leg-line-bar')),
            dur: box(line.querySelector('.tgm-leg-line-dur')),
            stops: box(line.querySelector('.tgm-leg-stops')),
            icon: box(line.querySelector('.tgm-leg-line-icon svg')),
            card: { l: card.left, r: card.right },
            narrow: s.querySelector('.tgm-root').classList.contains('tgm-narrow'),
          };
        });
      });
      ok('both legs are drawn', m.length === 2, String(m.length));
      ok('the narrow layout is in force', m.every((x) => x.narrow));
      ok('the line is not rotated', m.every((x) => x.transform === 'none'), m.map((x) => x.transform).join(', '));
      ok('the line runs down the page (taller than it is wide)', m.every((x) => x.bar.h >= 40 && x.bar.w <= 4), JSON.stringify(m[0].bar));
      ok('"2h 30m" reads across, not down (wider than it is tall)', m.every((x) => x.dur.w > x.dur.h), JSON.stringify(m[0].dur));
      ok('"Direct" reads across too', m.every((x) => x.stops.w > x.stops.h), JSON.stringify(m[0].stops));
      ok('the words sit beside the line, not over it', m.every((x) => x.dur.l > x.bar.r && x.stops.l > x.bar.r));
      ok('the plane is whole, inside the card', m.every((x) => x.icon.l >= x.card.l && x.icon.r <= x.card.r && x.icon.w >= 14), JSON.stringify(m[0].icon));
      ok('and on the line', m.every((x) => x.icon.l <= x.bar.l && x.icon.r >= x.bar.r));
      ok('no page errors', errors.length === 0, errors.join(' | '));
      await page.close();
    };
    await legs('on a 360px phone', { width: 360, height: 1400 });
    await legs('in a narrow container on a wide screen', { width: 1200, height: 1400 }, 340);

    console.log('\nMeasured in Chromium: the desktop leg is unchanged');
    {
      const { page } = await mount({ width: 900, height: 900 });
      const d = await page.evaluate(() => {
        const s = window.__w.shadow;
        const line = s.querySelector('.tgm-leg-line');
        const bar = line.querySelector('.tgm-leg-line-bar').getBoundingClientRect();
        return { display: getComputedStyle(line).display, barW: bar.width, barH: bar.height, narrow: s.querySelector('.tgm-root').classList.contains('tgm-narrow') };
      });
      ok('wide, the line runs across between the two ends', !d.narrow && d.display === 'flex' && d.barW > 60 && d.barH <= 4, JSON.stringify(d));
      await page.close();
    }
    await browser.close();
  }
}

console.log('\n' + passed + ' passed, ' + failed + ' failed\n');
process.exit(failed ? 1 : 0);
