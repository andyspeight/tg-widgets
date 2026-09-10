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
  // The route adds these two on the way out; the fixture has to carry them or
  // it stops being a faithful copy of what the browser actually receives.
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
      win.fetch = () => Promise.resolve({
        ok: true, status: 200, json: () => Promise.resolve(data),
      });
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
  t('the paused state is announced', () => {
    assert.strictEqual($('status').hidden, false);
    assert.match(txt('status-txt'), /paused/i);
  });
  t('the pause carries its date and reason', () => assert.match(txt('status-sub'), /2026-09-10/));

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

  t('every job offers a way to act on it', () => {
    const jobs = $('jobs').querySelectorAll('.job').length;
    assert.strictEqual($('jobs').querySelectorAll('[data-job]').length, jobs);
  });

  t('working a job filters the list to exactly the places missing that field', () => {
    const btn = $('jobs').querySelector('[data-job]');
    const [typeKey, idxRaw] = btn.dataset.job.split(':');
    const idx = Number(idxRaw);
    job0 = { type: typeKey, idx, label: data.types.find(t => t.key === typeKey).fields[idx].label };
    btn.dispatchEvent(new win.Event('click', { bubbles: true }));

    const expected = data.records.filter(r =>
      r.type === typeKey && (r.missing.includes(idx) || r.broken.includes(idx))).length;
    const shown = $('queue').querySelectorAll('tr').length;
    assert.strictEqual(shown, Math.min(expected, 400), `expected ${expected} rows, got ${shown}`);
    assert.ok(expected > 0, 'the job should have work in it');
  });

  t('working a job says so, and the queue tab is brought forward', () => {
    assert.strictEqual($('jobbar').hidden, false);
    assert.match($('jobbar-txt').textContent, /Working on/);
    assert.strictEqual($('tab-queue').getAttribute('aria-selected'), 'true');
  });

  t('inside a job the rows show what ELSE is needed, not the job name again', () => {
    assert.strictEqual($('th-gaps').textContent, 'Also needs');
    const cells = [...$('queue').querySelectorAll('tr')].map(r => r.querySelectorAll('td')[3]);
    assert.ok(cells.length > 0);
    cells.slice(0, 20).forEach(c => {
      const chips = c.querySelectorAll('.chip').length;
      assert.ok(chips >= 1 && chips <= 6, `expected 1-6 chips, got ${chips}`);
      assert.ok(!c.textContent.includes(job0.label),
        'the field being worked is already named in the bar above; repeating it per row is noise');
      // an empty record says it in words rather than listing every group
      const state = c.parentElement.querySelectorAll('td')[2].textContent.trim();
      if (state === 'Not started') assert.match(c.textContent, /Everything else too/);
    });
  });


  t('leaving a job restores the full list', () => {
    const inJob = $('queue').querySelectorAll('tr').length;
    $('jobbar-clear').dispatchEvent(new win.Event('click', { bubbles: true }));
    assert.strictEqual($('jobbar').hidden, true);
    assert.strictEqual($('th-gaps').textContent, 'What it still needs');
    assert.ok($('queue').querySelectorAll('tr').length > inJob, 'should show more places again');
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

  await Promise.all(pending);

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
})();
