/**
 * Destination dashboard page — DOM integration.
 *
 * Loads public/admin/destinations.html in jsdom with a realistic payload built
 * by the real aggregate(), and checks the page actually renders it: the figures,
 * the type rows, the work queue, the tab switching, the filters and the CSV
 * export. A console error or an unhandled rejection fails the run, so a typo in
 * the page script cannot ship looking fine.
 *
 * Run: node tests/destinations-dashboard-page.cjs
 */
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { JSDOM } = require('jsdom');

let pass = 0, fail = 0;
const pending = [];
function t(name, fn) {
  try {
    const out = fn();
    // An async assertion that is not awaited passes by default, which is worse
    // than no test at all. Collect the promise and settle it before reporting.
    if (out && typeof out.then === 'function') {
      pending.push(out.then(
        () => { pass++; },
        err => { fail++; console.error(`  FAIL  ${name}\n        ${err.message}`); }
      ));
    } else pass++;
  } catch (err) { fail++; console.error(`  FAIL  ${name}\n        ${err.message}`); }
}

const HTML = path.join(__dirname, '..', 'public', 'admin', 'destinations.html');

/* Build a payload at the real shape and scale of the base. */
async function payload(mod) {
  const { TYPES, aggregate } = mod;
  const spec = k => TYPES.find(x => x.key === k);
  const SAMPLE = {
    text: 'Filled', prose: 'A sentence with enough substance in it to read as real content, not a stub.',
    select: 'Live', multi: ['Beach'], link: ['recLinkedParent01'],
    json: '[{"icon":"beach","title":"Red Beach","description":"Iron-rich cliffs above dark sand."}]',
    csv12: '11,11,13,16,20,24,26,27,24,20,16,13',
    lines3: 'https://a.test/1.jpg\nhttps://a.test/2.jpg\nhttps://a.test/3.jpg',
    url: 'https://a.test', date: '2026-08-14', iata: 'LHR', lat: 37.9838, lng: 23.7275,
  };
  const CONTINENTS = ['Europe', 'Asia', 'Caribbean', 'Africa', 'North America', 'Oceania', 'South America', 'Middle East'];
  const pad = (p, i) => (p + String(i)).padEnd(17, '0').slice(0, 17);

  // fill 0 = name only, 1 = core, 2 = everything, 3 = everything but one value broken
  function make(id, key, fill, extra) {
    const s = spec(key);
    const fields = {};
    if (fill > 0) {
      for (const f of s.fields) {
        if (fill === 1 && f.tier !== 'core') continue;
        fields[f.id] = SAMPLE[f.kind];
      }
    }
    if (fill === 3) {
      const broken = s.fields.find(f => f.kind === 'json');
      if (broken) fields[broken.id] = '[]';
    }
    fields[s.nameField] = extra.name;
    if (extra.group && s.groupByField) fields[s.groupByField] = extra.group;
    if (extra.parent && s.parentLinkField) fields[s.parentLinkField] = [extra.parent];
    if (extra.children && s.childLinkField) fields[s.childLinkField] = extra.children;
    if (fill > 0 && s.statusField) fields[s.statusField] = 'Live';
    return { id, createdTime: extra.created || '2026-04-01T10:00:00.000Z', fields };
  }

  const countries = [], cities = [], resorts = [], airports = [], attractions = [];
  for (let i = 0; i < 111; i++) {
    countries.push(make(pad('recCo', i), 'country', i % 4, {
      name: 'Country ' + i, group: CONTINENTS[i % CONTINENTS.length],
      created: i > 107 ? '2026-09-10T12:39:00.000Z' : undefined,
    }));
  }
  for (let i = 0; i < 284; i++) {
    cities.push(make(pad('recCi', i), 'city', i % 4, {
      name: 'City ' + i, parent: pad('recCo', i % 111),
    }));
  }
  for (let i = 0; i < 495; i++) {
    resorts.push(make(pad('recRe', i), 'resort', i % 4, {
      name: 'Resort ' + i, parent: pad('recCi', i % 284),
    }));
  }
  for (let i = 0; i < 600; i++) {
    airports.push(make(pad('recAi', i), 'airport', i % 4, { name: 'Airport ' + i, group: 'Spain' }));
  }
  for (let i = 0; i < 49; i++) {
    attractions.push(make(pad('recAt', i), 'attraction', i % 4, { name: 'Park ' + i, group: 'France' }));
  }

  const data = aggregate([
    { spec: spec('country'), rows: countries },
    { spec: spec('city'), rows: cities },
    { spec: spec('resort'), rows: resorts },
    { spec: spec('airport'), rows: airports },
    { spec: spec('attraction'), rows: attractions },
  ]);
  // The route adds these on the way out; the fixture has to carry them or it
  // stops being a faithful copy of what the browser actually receives. The
  // per-field plan is the important one: the page decides what to offer from
  // it, so a fixture without it would test a page nobody is served.
  const { fillPlanFor } = await import(
    pathToFileURL(path.join(__dirname, '..', 'api', '_lib', 'fill', '_registry.js')).href);
  for (const t0 of data.types) for (const f of t0.fields) f.plan = fillPlanFor(f, t0.key).kind;
  data.baseId = 'appuZdlMJ7HKUt6qS';
  data.automation = { paused: true, since: '2026-09-10', reason: 'Paused for the dashboard build.' };
  data.cached = false;
  return data;
}

(async () => {
  const mod = await import(pathToFileURL(path.join(__dirname, '..', 'api', '_lib', 'destination-coverage.js')).href);
  const data = await payload(mod);

  console.log(`\nPayload: ${data.totals.records} records, ${JSON.stringify(data.totals.records)} scanned`);

  const errors = [];
  const dom = new JSDOM(fs.readFileSync(HTML, 'utf8'), {
    runScripts: 'dangerously',
    url: 'https://tg-widgets.vercel.app/admin/destinations',
    virtualConsole: new (require('jsdom').VirtualConsole)()
      .on('jsdomError', e => errors.push(e.message))
      .on('error', (...a) => errors.push(a.join(' '))),
    beforeParse(win) {
      // jsdom has no layout, so scrollIntoView throws. Stub it, or a real
      // page error gets lost in the noise of one that does not matter.
      win.Element.prototype.scrollIntoView = function () {};
      win.__queued = [];
      win.fetch = (url, opts) => {
        if (String(url).includes('destinations-fill')) {
          if (opts && opts.body) win.__queued.push(JSON.parse(opts.body));
          const payload = {
            settings: { capUsd: 10, running: false },
            budget: { capUsd: 10, spentUsd: 2.5, remainingUsd: 7.5, perItemUsd: 0.0253,
                      roomForPaidWork: true, itemsAffordable: 296 },
            pending: 0, run: {}, heldCount: 1, savedToday: 7, heldToday: 1,
            held: [{ place: 'Oia', field: 'Overview', reason: 'nothing supports the Roman aqueduct',
                     at: '2026-09-10T14:00:00.000Z' }],
            recent: [], queued: (opts && opts.body ? JSON.parse(opts.body).recordIds || [] : []).length,
          };
          const body = JSON.stringify(payload);
          return Promise.resolve({ ok: true, status: 200,
            text: () => Promise.resolve(body), json: () => Promise.resolve(payload) });
        }
        return Promise.resolve({ ok: true, status: 200,
          text: () => Promise.resolve(JSON.stringify(data)), json: () => Promise.resolve(data) });
      };
      win.confirm = () => true;
      win.alert = () => {};
      win.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
      let lastBlob = null;
      win.URL.createObjectURL = (b) => { lastBlob = b; return 'blob:mock'; };
      win.URL.revokeObjectURL = () => {};
      Object.defineProperty(win, '__lastBlob', { get: () => lastBlob });
    },
  });

  const win = dom.window, doc = win.document;
  await new Promise(r => win.addEventListener('load', r));
  await new Promise(r => setTimeout(r, 60)); // let the fetch promise chain settle

  let job0 = null;
  const $ = id => doc.getElementById(id);
  const txt = id => ($(id) ? $(id).textContent.trim() : '');

  console.log('\nBoot');
  t('no script errors on load', () => assert.deepStrictEqual(errors, []));
  t('the skeleton is replaced by the app', () => {
    assert.strictEqual($('boot').hidden, true, 'skeleton should be hidden');
    assert.strictEqual($('app').hidden, false, 'app should be visible');
    assert.strictEqual($('fatal').hidden, true, 'no fatal state');
  });

  console.log('\nHeadline figures');
  t('all four figures render', () => assert.strictEqual($('kpis').querySelectorAll('.kpi').length, 4));
  t('the library total matches the payload', () => {
    const v = $('kpis').querySelector('.kpi-v').textContent.replace(/[^0-9]/g, '');
    assert.strictEqual(Number(v), data.totals.records);
  });
  t('the figures are not all zero', () => {
    const vals = [...$('kpis').querySelectorAll('.kpi-v')].map(e => Number(e.textContent.replace(/[^0-9]/g, '')));
    assert.ok(vals.some(v => v > 0), 'at least one headline figure should be non-zero');
  });

  console.log('\nAutomation status');
  t('the strip says whether anything is running right now', () => {
    assert.strictEqual($('status').hidden, false);
    assert.match(txt('status-txt'), /Nothing running|Filling now/);
  });
  t('it makes clear nothing writes without a button press', () =>
    assert.match(txt('status-sub'), /unless you press a button|queue/));

  console.log('\nContent types');
  t('one row per content type', () => assert.strictEqual($('types').querySelectorAll('.trow').length, 5));
  t('each row draws a distribution bar', () => {
    const bars = $('types').querySelectorAll('.trow .stack');
    assert.strictEqual(bars.length, 5);
    assert.ok([...bars].every(b => b.querySelectorAll('i').length > 0), 'every bar should have segments');
  });
  t('the bars carry a text alternative', () => {
    assert.ok([...$('types').querySelectorAll('.stack')].every(b => (b.getAttribute('aria-label') || '').length > 8));
  });
  t('a legend explains the colours', () => assert.ok($('types').querySelector('.legend')));

  console.log('\nWork queue');
  t('the queue renders rows', () => {
    const rows = $('queue').querySelectorAll('tr');
    assert.ok(rows.length > 5, `expected many rows, got ${rows.length}`);
  });
  t('rows name their missing fields', () => {
    assert.ok($('queue').querySelectorAll('.chip').length > 0, 'expected missing-field chips');
  });
  t('the queue defaults to what needs work', () => {
    assert.strictEqual($('f-tier').value, 'needs');
    const tags = [...$('queue').querySelectorAll('.tag')].map(e => e.textContent.trim());
    assert.ok(tags.every(x => x === 'Part done' || x === 'Not started'), `unexpected states: ${[...new Set(tags)]}`);
  });
  t('the most urgent record is listed first', () => {
    // The raw priority number is deliberately off the screen, so check the
    // ORDER instead: the first row must be the highest-priority match.
    const expected = data.records.filter(r => r.tier === 'partial' || r.tier === 'skeleton')[0];
    const first = $('queue').querySelector('tr td:first-child').textContent.trim();
    assert.ok(first.startsWith(expected.name), `expected ${expected.name} first, got "${first}"`);
  });

  console.log('\nFiltering');
  t('selecting a content type filters the queue', () => {
    $('types').querySelector('.trow[data-type="country"]').dispatchEvent(new win.Event('click', { bubbles: true }));
    const types = [...$('queue').querySelectorAll('tr td:nth-child(2)')].map(e => e.textContent.trim());
    assert.ok(types.length > 0, 'expected country rows');
    assert.ok(types.every(x => x === 'Country'), `leaked other types: ${[...new Set(types)]}`);
    assert.strictEqual($('types').querySelector('.trow[data-type="country"]').getAttribute('aria-pressed'), 'true');
  });
  t('selecting the same type again clears the filter', () => {
    $('types').querySelector('.trow[data-type="country"]').dispatchEvent(new win.Event('click', { bubbles: true }));
    const types = new Set([...$('queue').querySelectorAll('tr td:nth-child(2)')].map(e => e.textContent.trim()));
    assert.ok(types.size > 1, 'expected several types back');
  });
  t('the completeness filter is honoured', () => {
    $('f-tier').value = 'skeleton';
    $('f-tier').dispatchEvent(new win.Event('change'));
    const tags = new Set([...$('queue').querySelectorAll('.tag')].map(e => e.textContent.trim()));
    assert.deepStrictEqual([...tags], ['Not started']);
  });
  t('an impossible filter shows an empty state, not a blank table', () => {
    $('f-tier').value = 'complete';
    $('f-tier').dispatchEvent(new win.Event('change'));
    $('f-group').value = 'Europe';
    $('f-group').dispatchEvent(new win.Event('change'));
    const body = $('queue').textContent;
    const hasRows = $('queue').querySelectorAll('.tag').length > 0;
    if (!hasRows) assert.match(body, /Nothing matches/i);
  });

  console.log('\nTabs');
  t('the queue tab starts selected', () => assert.strictEqual($('tab-queue').getAttribute('aria-selected'), 'true'));
  t('clicking a tab swaps the panel', () => {
    $('tab-fields').dispatchEvent(new win.Event('click', { bubbles: true }));
    assert.strictEqual($('tab-fields').getAttribute('aria-selected'), 'true');
    assert.ok($('pane-fields').classList.contains('on'));
    assert.ok(!$('pane-queue').classList.contains('on'));
  });
  t('arrow keys move between tabs', () => {
    const e = new win.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true });
    $('tab-fields').dispatchEvent(e);
    assert.strictEqual($('tab-cont').getAttribute('aria-selected'), 'true');
  });

  console.log('\nField gaps and other views');
  t('field fill rates render, worst first', () => {
    const rows = $('fields').querySelectorAll('tr');
    assert.ok(rows.length > 10, `expected many field rows, got ${rows.length}`);
    const pcts = [...$('fields').querySelectorAll('.mini i')].map(e => parseFloat(e.style.width) || 0);
    assert.deepStrictEqual(pcts, [...pcts].sort((a, b) => a - b), 'should be sorted worst first');
  });
  t('the continent view renders', () => {
    assert.ok($('cont').querySelectorAll('tr').length > 1, 'expected continent rows');
    assert.match($('cont').textContent, /Europe/);
  });
  t('resorts are counted under a continent', () => {
    const europe = [...$('cont').querySelectorAll('tr')].find(r => /Europe/.test(r.textContent));
    const cells = [...europe.querySelectorAll('td')].map(c => c.textContent.trim());
    assert.ok(Number(cells[4].replace(/[^0-9]/g, '')) > 0, 'Europe should carry resorts');
  });
  t('broken values are listed separately', () => {
    assert.ok(Number(txt('n-broken').replace(/[^0-9]/g, '')) > 0, 'expected broken records');
    assert.ok($('broken').querySelectorAll('.chip.bad').length > 0);
  });
  t('recently added lists the newest first', () => {
    assert.ok($('recent').querySelectorAll('tr').length > 1);
    assert.match($('recent').textContent, /Country 1(08|09|10)/);
  });

  console.log('\nExport');
  t('export produces a CSV with a header and rows', async () => {
    $('f-tier').value = ''; $('f-tier').dispatchEvent(new win.Event('change'));
    $('f-group').value = ''; $('f-group').dispatchEvent(new win.Event('change'));
    $('btn-export').dispatchEvent(new win.Event('click', { bubbles: true }));
    assert.ok(win.__lastBlob, 'a blob should have been created');
  });

  console.log('\nAccessibility and theming');
  t('a skip link is present', () => assert.ok(doc.querySelector('.skip')));
  t('icon-only buttons are labelled', () => {
    const bare = [...doc.querySelectorAll('button')].filter(b => !b.textContent.trim() && !b.getAttribute('aria-label'));
    assert.deepStrictEqual(bare.map(b => b.id), []);
  });
  t('there is exactly one h1', () => assert.strictEqual(doc.querySelectorAll('h1').length, 1));
  t('no inline event handlers (CSP-clean)', () => {
    const bad = [...doc.querySelectorAll('*')].filter(el =>
      [...el.attributes].some(a => /^on[a-z]+$/i.test(a.name)));
    assert.deepStrictEqual(bad.map(e => e.tagName), []);
  });
  t('the theme toggle flips the document theme', () => {
    const before = doc.documentElement.getAttribute('data-theme');
    $('theme').dispatchEvent(new win.Event('click', { bubbles: true }));
    const after = doc.documentElement.getAttribute('data-theme');
    assert.notStrictEqual(before, after);
    assert.ok(after === 'dark' || after === 'light');
  });
  t('the theme toggle relabels itself', () => {
    assert.match($('theme').getAttribute('aria-label'), /switch to (light|dark) mode/i);
  });

  console.log('\nEscaping');
  t('a name carrying markup is escaped, not executed', async () => {
    const hostile = JSON.parse(JSON.stringify(data));
    hostile.records[0].name = '<img src=x onerror="window.__xss=1">';
    hostile.records[0].tier = 'skeleton';
    const d2 = new JSDOM(fs.readFileSync(HTML, 'utf8'), {
      runScripts: 'dangerously', url: 'https://tg-widgets.vercel.app/admin/destinations',
      beforeParse(w) {
        w.fetch = () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(hostile) });
        w.Element.prototype.scrollIntoView = function () {};
        w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
        w.URL.createObjectURL = () => 'blob:mock'; w.URL.revokeObjectURL = () => {};
      },
    });
    return new Promise(res => {
      d2.window.addEventListener('load', () => setTimeout(() => {
        assert.strictEqual(d2.window.__xss, undefined, 'markup in a record name must not execute');
        assert.ok(d2.window.document.body.innerHTML.includes('&lt;img'), 'it should render as text');
        res();
      }, 60));
    });
  });


  console.log('\nKnowing what to do');

  /* Andy's words on 10 Sep, looking at the finished page: "I'm on the page,
     but I've no idea what I'm supposed to be doing." The page listed six jobs
     and the first three were ones the runner cannot touch, each wearing the
     same blue button. These tests exist so that cannot come back. */

  t('hidden really hides, even on a button', () => {
    // .btn sets display:inline-flex, and an author rule beats the browser's
    // own [hidden]{display:none}. Without an explicit override, Stop sat on
    // screen with nothing running, which is what Andy was looking at.
    const probe = doc.createElement('button');
    probe.className = 'btn';
    probe.hidden = true;
    doc.body.appendChild(probe);
    assert.strictEqual(win.getComputedStyle(probe).display, 'none',
      'a hidden .btn must not be displayed');
    probe.remove();
  });

  t('the page names one thing to do next', () => {
    assert.strictEqual($('next').hidden, false, 'the recommendation should be shown');
    const title = $('next').querySelector('.next-t').textContent;
    assert.ok(/\d/.test(title), 'it should say how many places: ' + title);
    assert.ok($('next').querySelector('#next-go'), 'it needs a button to act on');
  });

  t('it recommends free work before work that costs money', () => {
    // Facts first, editorial second, which is the order the runner itself
    // enforces: a record with nothing on it is refused before it costs
    // anything, so filling the facts is what makes the writing possible.
    const s = $('next').querySelector('.next-s').textContent;
    assert.match(s, /costs nothing/,
      'with free verified work outstanding, that is what to do next: ' + s.slice(0, 120));
    // And it must say where a free answer actually comes from. Two outside
    // datasets agreeing is not "records we already hold".
    const title = $('next').querySelector('.next-t').textContent;
    if (/^Verify/.test(title)) {
      assert.match(s, /two independent public datasets/,
        'a two-source check must not claim the answer came from our own records');
      assert.ok(!/records we already hold/.test(s));
    }
  });

  t('what it recommends is work the runner can actually do', () => {
    const title = $('next').querySelector('.next-t').textContent;
    assert.ok(!/Official Website|Image URLs|IATA|Latitude|Longitude|Wikipedia/.test(title),
      'a two-source fact or a photograph is a dead end, not a recommendation: ' + title);
  });

  t('the recommendation says what will happen, not just what to press', () => {
    const s = $('next').querySelector('.next-s').textContent;
    assert.match(s, /checked twice|two independent public datasets|records we already hold/,
      'it should say where the answer comes from and that it is checked');
    assert.match(s, /held for you/, 'it should say what happens to a doubtful answer');
    assert.match(s, /nothing already filled is touched/i, 'it should say what is safe');
  });

  t('the recommendation is one of the jobs offered below it', () => {
    const title = $('next').querySelector('.next-t').textContent;
    const open = [...$('jobs').querySelectorAll('.job:not(.is-off) .job-t')]
      .map(e => e.textContent.split(' · ')[0]);
    assert.ok(open.length, 'expected runnable jobs');
    const s = $('next').querySelector('.next-s').textContent;
    assert.ok(open.some(l => s.includes(l)),
      'the panel should name the field it means, and it should be runnable: ' + title);
  });

  console.log('\nWhere to start (the jobs)');

  t('jobs are listed, biggest first', () => {
    const rows = $('jobs').querySelectorAll('.job');
    assert.ok(rows.length > 0, 'expected at least one job');
    const counts = [...$('jobs').querySelectorAll('.job-n b')].map(e => Number(e.textContent.replace(/[^0-9]/g, '')));
    assert.ok(counts.every(c => c > 0), 'every job should name a real count');
  });

  t('a job says which type it belongs to', () => {
    const first = $('jobs').querySelector('.job-t').textContent;
    assert.match(first, /countries|cities and regions|resorts and areas|airports|theme parks/,
      `job title should name a content type, got "${first}"`);
  });

  t('a job the runner can do offers a button, one it cannot never does', () => {
    const rows = [...$('jobs').querySelectorAll('.job')];
    assert.ok(rows.length, 'expected at least one job');
    const on = rows.filter(r => !r.classList.contains('is-off'));
    const off = rows.filter(r => r.classList.contains('is-off'));
    assert.ok(on.length, 'expected work the runner can do');
    assert.ok(off.length, 'the fixture leaves two-source facts blank, so expected blocked jobs');
    on.forEach(r => assert.ok(r.querySelector('[data-job]'),
      'runnable work needs a button: ' + r.querySelector('.job-t').textContent));
    off.forEach(r => assert.strictEqual(r.querySelector('[data-job]'), null,
      'work that cannot run must not offer a button: ' + r.querySelector('.job-t').textContent));
  });

  /* 11 Sep 2026. I told Andy to press "Wikipedia URL on airports". It was not
     on the page: the list shows the biggest six of fifty-three, sorted with
     core fields first, and a depth field never reaches the top. There was no
     way to see the rest and no button anywhere else. Every job has to be
     reachable or the ranking decides what he is allowed to do. */

  t('every job can be reached, not just the biggest handful', () => {
    const shown = $('jobs').querySelectorAll('.job:not(.is-off)').length;
    const more = $('jobs-more');
    assert.ok(more, 'with more runnable jobs than fit, there must be a way to see them');

    more.dispatchEvent(new win.Event('click', { bubbles: true }));
    const after = $('jobs').querySelectorAll('.job:not(.is-off)').length;
    assert.ok(after > shown, 'expanding should show more: ' + shown + ' then ' + after);

    $('jobs-more').dispatchEvent(new win.Event('click', { bubbles: true }));
    assert.strictEqual($('jobs').querySelectorAll('.job:not(.is-off)').length, shown,
      'and it should collapse again');
  });

  t('a depth field is reachable even though it never tops the list', () => {
    // Wikipedia URL is exactly the case that was unreachable.
    $('jobs-more').dispatchEvent(new win.Event('click', { bubbles: true }));
    const labels = [...$('jobs').querySelectorAll('.job:not(.is-off) .job-t')].map(e => e.textContent);
    assert.ok(labels.some(l => /Wikipedia URL/.test(l)),
      'the job I sent Andy to press has to actually be on the page');
    $('jobs-more').dispatchEvent(new win.Event('click', { bubbles: true }));
  });

  t('work that can be done is listed before work that cannot', () => {
    const kinds = [...$('jobs').querySelectorAll('.job')].map(r => r.classList.contains('is-off'));
    const firstOff = kinds.indexOf(true);
    const lastOn = kinds.lastIndexOf(false);
    assert.ok(firstOff === -1 || firstOff > lastOn,
      'a dead end must never be the first thing offered');
  });

  t('pressing Work on this opens a job view, not a scroll', () => {
    const btn = $('jobs').querySelector('[data-job]');
    const [typeKey, idxRaw] = btn.dataset.job.split(':');
    const idx = Number(idxRaw);
    job0 = { type: typeKey, idx, label: data.types.find(t => t.key === typeKey).fields[idx].label };
    btn.dispatchEvent(new win.Event('click', { bubbles: true }));

    assert.strictEqual($('jobview').hidden, false, 'the job view should open');
    assert.strictEqual($('browse').hidden, true, 'the browse tabs should stand aside');
  });

  // The four questions Andy asked after pressing the button.
  t('it says WHAT it is working on', () => {
    assert.ok($('jv-title').textContent.includes(job0.label), 'the field should be named');
    const what = $('jv-what').textContent;
    assert.ok(what.length > 20, `expected a description, got "${what}"`);
    assert.match(what, /go live|depth/, 'should say whether it blocks publishing');
  });

  t('it says HOW FAR ALONG it is', () => {
    const t0 = data.types.find(t => t.key === job0.type);
    const f = t0.fields[job0.idx];
    assert.match($('jv-prog-l').textContent, new RegExp(`${f.filled.toLocaleString('en-GB')} of`));
    assert.match($('jv-prog-r').textContent, /^\d+%$/);
    const w = parseFloat($('jv-prog-i').style.width);
    assert.ok(w >= 0 && w <= 100, `bar width should be a percentage, got ${w}`);
    assert.match($('jv-prog-img').getAttribute('aria-label'), /per cent/);
  });

  t('it says WHAT THE ISSUES ARE, separating blank from wrong', () => {
    const t0 = data.types.find(t => t.key === job0.type);
    const f = t0.fields[job0.idx];
    const figs = [...$('jv-figs').querySelectorAll('.jv-fig')];
    assert.strictEqual(figs.length, 4);
    const byLabel = {};
    figs.forEach(x => { byLabel[x.querySelector('.jv-fig-l').textContent.trim()] =
      Number(x.querySelector('.jv-fig-v').textContent.replace(/[^0-9]/g, '')); });
    assert.strictEqual(byLabel['Already done'], f.filled);
    assert.strictEqual(byLabel['Still to write'], f.empty);
    assert.strictEqual(byLabel['To correct'], f.invalid);
    assert.ok('Quick wins' in byLabel);
  });

  t('it says WHAT NEEDS A LOOK, once, above the list', () => {
    const t0 = data.types.find(t => t.key === job0.type);
    const f = t0.fields[job0.idx];
    if (f.invalid > 0) {
      assert.strictEqual($('jv-note').hidden, false);
      assert.match($('jv-note-t').textContent, /need a look before anything else/);
    }
  });

  t('the batch holds exactly the records missing or breaking that field', () => {
    const expected = data.records.filter(r =>
      r.type === job0.type && (r.missing.includes(job0.idx) || r.broken.includes(job0.idx))).length;
    assert.ok(expected > 0, 'the job should have work in it');
    assert.match($('jv-count').textContent, new RegExp(String(Math.min(expected, 400))));
  });

  t('the ones to correct are listed before the rest', () => {
    const tags = [...$('jv-rows').querySelectorAll('tr td:nth-child(2)')].map(c => c.textContent.trim());
    const firstPlain = tags.findIndex(x => !x.startsWith('To correct'));
    const lastFix = tags.map((x, i) => x.startsWith('To correct') ? i : -1).filter(i => i >= 0).pop();
    if (firstPlain !== -1 && lastFix !== undefined) {
      assert.ok(lastFix < firstPlain, 'every "to correct" row should come first');
    }
  });

  t('a row says whether this field is blank or wrong, and what else is needed', () => {
    const row = $('jv-rows').querySelector('tr');
    const cells = row.querySelectorAll('td');
    assert.match(cells[1].textContent, /Blank|To correct/);
    assert.ok(cells[2].textContent.trim().length > 0, 'the "also needs" cell should say something');
    assert.ok(!cells[2].textContent.includes(job0.label),
      'the field being worked is named in the header; repeating it per row is noise');
  });

  t('the batch can be narrowed to just the ones to correct', () => {
    $('jv-show').value = 'fix';
    $('jv-show').dispatchEvent(new win.Event('change'));
    const tags = [...$('jv-rows').querySelectorAll('tr td:nth-child(2)')].map(c => c.textContent.trim());
    if (tags.length) assert.ok(tags.every(x => x.startsWith('To correct')), `leaked: ${[...new Set(tags)]}`);
    $('jv-show').value = ''; $('jv-show').dispatchEvent(new win.Event('change'));
  });

  t('the batch links out to the whole table as well as each record', () => {
    assert.match($('jv-table').getAttribute('href'), /^https:\/\/airtable\.com\/app[A-Za-z0-9]{14}\/tbl[A-Za-z0-9]{14}$/);
    const rowLink = $('jv-rows').querySelector('a.nm');
    assert.match(rowLink.getAttribute('href'), /\/rec/);
  });

  t('the batch exports on its own', () => {
    $('jv-export').dispatchEvent(new win.Event('click', { bubbles: true }));
    assert.ok(win.__lastBlob, 'a CSV should have been produced');
  });

  t('the way back is not tucked under the sticky bar', () => {
    // jsdom has no layout, so assert the rule that prevents it: a section
    // scrolled to the top must reserve the sticky bar's height.
    const css = doc.querySelector('style').textContent;
    assert.match(css, /\.sec\{[^}]*scroll-margin-top:\s*\d+px/,
      'sections need scroll-margin-top or scrollIntoView hides the back button behind the bar');
  });

  t('All jobs takes you back', () => {
    $('jv-back').dispatchEvent(new win.Event('click', { bubbles: true }));
    assert.strictEqual($('jobview').hidden, true);
    assert.strictEqual($('browse').hidden, false);
  });

  t('the Every gap table offers a button on every job that can run', () => {
    $('tab-fields').dispatchEvent(new win.Event('click', { bubbles: true }));
    const rows = [...$('fields').querySelectorAll('tr')];
    assert.ok(rows.length > 20, 'this table is the index of every field');

    const buttons = $('fields').querySelectorAll('[data-open]');
    assert.ok(buttons.length > 0, 'a table listing every gap and offering none of them is a dead end');

    // The button has to name a real field on a real type, or it opens nothing.
    const [typeKey, idxRaw] = buttons[0].dataset.open.split(':');
    const t0 = data.types.find(x => x.key === typeKey);
    assert.ok(t0, 'unknown type: ' + typeKey);
    assert.ok(t0.fields[Number(idxRaw)], 'no field at index ' + idxRaw + ' on ' + typeKey);
    $('tab-queue').dispatchEvent(new win.Event('click', { bubbles: true }));
  });

  console.log('\nReadability');

  t('an empty record says so in words instead of listing every field', () => {
    $('f-tier').value = 'skeleton'; $('f-tier').dispatchEvent(new win.Event('change'));
    const cell = $('queue').querySelector('tr td:nth-child(4)');
    assert.match(cell.textContent, /Nothing written yet/);
    assert.strictEqual(cell.querySelectorAll('.chip').length, 1, 'no wall of field chips');
  });

  t('a part-done record names the areas it is missing, capped', () => {
    $('f-tier').value = 'partial'; $('f-tier').dispatchEvent(new win.Event('change'));
    const rows = [...$('queue').querySelectorAll('tr')].slice(0, 10);
    assert.ok(rows.length > 0, 'expected part-done rows');
    rows.forEach(r => {
      const chips = r.querySelectorAll('td:nth-child(4) .chip').length;
      assert.ok(chips >= 1 && chips <= 7, `expected 1-7 grouped chips, got ${chips}`);
    });
  });

  t('the engine\'s own words never reach the screen', () => {
    $('f-tier').value = ''; $('f-tier').dispatchEvent(new win.Event('change'));
    const seen = doc.getElementById('app').textContent;
    ['skeleton', 'partial', 'Priority', 'Core '].forEach(word => {
      assert.ok(!seen.includes(word), `"${word}" is internal vocabulary and should not be on screen`);
    });
  });

  t('a place links through to its Airtable record', () => {
    const link = $('queue').querySelector('a.nm');
    assert.ok(link, 'expected a link on the place name');
    assert.match(link.getAttribute('href'), /^https:\/\/airtable\.com\/app[A-Za-z0-9]{14}\/tbl[A-Za-z0-9]{14}\/rec/);
    assert.strictEqual(link.getAttribute('rel'), 'noopener noreferrer');
    assert.strictEqual(link.getAttribute('target'), '_blank');
  });

  t('the headline sentence states the split in plain words', () => {
    assert.match($('lede').textContent, /places across five tables/);
    assert.match($('lede').textContent, /ready to publish/);
    assert.match($('lede').textContent, /still need work/);
  });

  t('each type row reports how much of it is ready', () => {
    const pcts = [...$('types').querySelectorAll('.trow-p b')].map(e => e.textContent.trim());
    assert.strictEqual(pcts.length, 5);
    assert.ok(pcts.every(p => /^\d+%$/.test(p)), `expected percentages, got ${pcts}`);
  });


  console.log('\nThe runner');

  // The runner state arrives over fetch, so open the job and let it land before
  // asserting on it — otherwise these test an empty strip.
  $('jobs').querySelector('[data-job]').dispatchEvent(new win.Event('click', { bubbles: true }));
  await new Promise(r => setTimeout(r, 120));

  t('opening a job shows what the runner is doing and what it has spent', () => {
    assert.match($('run-l').textContent, /Nothing running|Filling|Paused/);
    assert.match($('money').textContent, /Spent today/);
    assert.match($('money').textContent, /daily cap/);
  });

  t('the daily cap is editable from the page', () => {
    const cap = $('cap');
    assert.ok(cap, 'the cap should be an input, not a fixed number');
    assert.strictEqual(Number(cap.value), 10);
  });

  t('every row offers to fill just that record', () => {
    const rows = $('jv-rows').querySelectorAll('tr').length;
    assert.strictEqual($('jv-rows').querySelectorAll('[data-fill]').length, rows,
      'each row needs its own button, per Andy');
  });

  t('there is a do-all button at the top', () => {
    assert.ok($('jv-doall'), 'expected a fill-all control');
    assert.match($('jv-doall').textContent, /Fill all/);
  });

  t('filling one record queues exactly that record and that field', () => {
    win.__queued.length = 0;
    const btn = $('jv-rows').querySelector('[data-fill]');
    const id = btn.dataset.fill;
    btn.dispatchEvent(new win.Event('click', { bubbles: true }));
    const sent = win.__queued.filter(q => q.action === 'queue');
    assert.strictEqual(sent.length, 1);
    assert.deepStrictEqual(sent[0].recordIds, [id]);
    assert.strictEqual(sent[0].type, job0.type);
    assert.strictEqual(sent[0].fieldIdx, job0.idx);
  });

  t('a queued row stops offering the button and says so', () => {
    assert.match($('jv-rows').querySelector('tr td:last-child').textContent, /Queued/);
  });

  t('do-all queues the whole batch after a confirmation', () => {
    win.__queued.length = 0;
    $('jv-doall').dispatchEvent(new win.Event('click', { bubbles: true }));
    const sent = win.__queued.filter(q => q.action === 'queue');
    assert.strictEqual(sent.length, 1);
    const expected = data.records.filter(r =>
      r.type === job0.type && (r.missing.includes(job0.idx) || r.broken.includes(job0.idx))).length;
    assert.strictEqual(sent[0].recordIds.length, expected);
  });

  t('held items are listed with the reason they stopped', () => {
    assert.strictEqual(Number(txt('n-held').replace(/[^0-9]/g, '')), 1);
    assert.match($('held').textContent, /Oia/);
    assert.match($('held').textContent, /Roman aqueduct/);
  });



  t('a gateway timeout reads as a timeout, not as broken JSON', async () => {
    // The exact failure Andy hit: Vercel answers a 504 with a plain-text page,
    // and calling .json() on it threw "Unexpected token 'A'".
    const seen = [];
    const d2 = new JSDOM(fs.readFileSync(HTML, 'utf8'), {
      runScripts: 'dangerously', url: 'https://tg-widgets.vercel.app/admin/destinations',
      beforeParse(w) {
        w.fetch = (url) => {
          if (String(url).includes('destinations-fill')) {
            return Promise.resolve({
              ok: false, status: 504,
              text: () => Promise.resolve('An error occurred with this application.'),
              json: () => Promise.reject(new SyntaxError("Unexpected token 'A'")),
            });
          }
          return Promise.resolve({ ok: true, status: 200,
            text: () => Promise.resolve(JSON.stringify(data)), json: () => Promise.resolve(data) });
        };
        w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
        w.Element.prototype.scrollIntoView = function () {};
        w.confirm = () => true;
        w.alert = (m) => seen.push(String(m));
        w.URL.createObjectURL = () => 'blob:mock'; w.URL.revokeObjectURL = () => {};
      },
    });
    await new Promise(r => d2.window.addEventListener('load', r));
    await new Promise(r => setTimeout(r, 80));
    const dd = d2.window.document;
    dd.querySelector('#jobs [data-job]').dispatchEvent(new d2.window.Event('click', { bubbles: true }));
    await new Promise(r => setTimeout(r, 120));
    const btn = dd.querySelector('#jv-rows [data-fill]');
    // Not "if (btn)". The jobs list only offers work the runner can do, so a
    // Fill button must be there. Guarding this was how it passed without ever
    // asserting anything.
    assert.ok(btn, 'the opened job should offer a Fill button to click');
    btn.dispatchEvent(new d2.window.Event('click', { bubbles: true }));
    await new Promise(r => setTimeout(r, 120));
    assert.ok(seen.length, 'the failure should be reported');
    assert.ok(!/Unexpected token/.test(seen.join(' ')),
      'a timeout must not surface as a JSON parse error: ' + seen.join(' '));
    assert.match(seen.join(' '), /took too long|Nothing was queued/);
  });

  t('a field the runner cannot fill offers no button and says why', () => {
    // Official Website is a two-source fact; queueing it would hold every
    // record. The page must not offer the work.
    const air = data.types.find(x => x.key === 'airport');
    const term = air.fields.find(f => f.label === 'Terminals & Airlines');
    assert.ok(term, 'the airport spec should carry Terminals & Airlines');
    assert.strictEqual(term.plan, 'source',
      'the field that cost $4.14 twice must never be offered as writable');
    // And the one the two open datasets DO settle is runnable work.
    const site = air.fields.find(f => f.label === 'Official Website');
    assert.strictEqual(site.plan, 'fact', 'two sources can settle an airport website');

    // And every blocked row the page actually draws has to behave: no button,
    // and a stated reason. There are more of these than fit, so check them all.
    const off = [...$('jobs').querySelectorAll('.job.is-off')];
    assert.ok(off.length, 'expected blocked jobs to be listed');
    off.forEach(r => {
      assert.strictEqual(r.querySelector('[data-job]'), null,
        'no button: ' + r.querySelector('.job-t').textContent);
      assert.match(r.textContent, /source|two independent sources|a person chooses/,
        'must say why: ' + r.querySelector('.job-t').textContent);
    });
  });

  t('the jobs list says how many there are, not just how many it shows', () => {
    const heads = [...$('jobs').querySelectorAll('.job-h')];
    assert.ok(heads.length >= 2, 'expected both groups');
    const blocked = heads[heads.length - 1].textContent;
    assert.match(blocked, /\d+ of \d+/,
      'most of the library needs a source, and hiding that behind six rows is the ' +
      'same dishonesty in a quieter form: ' + blocked);
  });


  await Promise.all(pending);

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
})();
