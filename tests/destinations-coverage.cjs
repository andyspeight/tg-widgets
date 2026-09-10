/**
 * Destination dashboard — value checking and scoring.
 *
 * The dashboard's whole claim is that it reports what is USABLE, not what is
 * non-blank. These tests pin that claim down: a Highlights JSON holding "[]",
 * eleven months of temperatures, two image URLs where three are required and a
 * coordinate at null island all have to read as problems rather than as content.
 *
 * Run: node tests/destinations-dashboard.cjs
 */
const assert = require('node:assert');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; }
  catch (err) { fail++; console.error(`  FAIL  ${name}\n        ${err.message}`); }
}

(async () => {
  const mod = await import(pathToFileURL(path.join(__dirname, '..', 'api', '_lib', 'destination-coverage.js')).href);
  const { checkValue } = mod;

  console.log('\nValue checking');

  // --- blanks -------------------------------------------------------------
  t('null is empty', () => assert.strictEqual(checkValue(null, 'text'), 'empty'));
  t('undefined is empty', () => assert.strictEqual(checkValue(undefined, 'prose'), 'empty'));
  t('whitespace-only string is empty', () => assert.strictEqual(checkValue('   ', 'text'), 'empty'));
  t('empty array is empty', () => assert.strictEqual(checkValue([], 'multi'), 'empty'));

  // --- prose --------------------------------------------------------------
  t('real prose is filled', () => assert.strictEqual(
    checkValue('Santorini earns its reputation the moment the ferry rounds the caldera wall.', 'prose'), 'filled'));
  t('a stub sentence is invalid, not filled', () => assert.strictEqual(checkValue('Nice place.', 'prose'), 'invalid'));

  // --- JSON arrays --------------------------------------------------------
  t('populated highlights array is filled', () => assert.strictEqual(
    checkValue('[{"icon":"beach","title":"Red Beach","description":"Iron-rich cliffs."}]', 'json'), 'filled'));
  t('empty JSON array is invalid', () => assert.strictEqual(checkValue('[]', 'json'), 'invalid'));
  t('malformed JSON is invalid', () => assert.strictEqual(checkValue('[{"icon":}]', 'json'), 'invalid'));
  t('a JSON object is invalid (an array is required)', () => assert.strictEqual(checkValue('{"a":1}', 'json'), 'invalid'));

  // --- twelve-month series ------------------------------------------------
  t('twelve temperatures are filled', () => assert.strictEqual(
    checkValue('11,11,13,16,20,24,26,27,24,20,16,13', 'csv12'), 'filled'));
  t('eleven temperatures are invalid', () => assert.strictEqual(
    checkValue('11,11,13,16,20,24,26,27,24,20,16', 'csv12'), 'invalid'));
  t('twelve season tokens are filled', () => assert.strictEqual(
    checkValue('off,off,off,shoulder,best,best,best,best,best,shoulder,off,off', 'csv12'), 'filled'));
  t('an unknown season token is invalid', () => assert.strictEqual(
    checkValue('off,off,off,shoulder,best,best,best,best,best,shoulder,off,peak', 'csv12'), 'invalid'));
  t('prose in a climate field is invalid', () => assert.strictEqual(
    checkValue('Warm and dry from May to September.', 'csv12'), 'invalid'));

  // --- image lines --------------------------------------------------------
  t('three image URLs are filled', () => assert.strictEqual(
    checkValue('https://a.test/1.jpg\nhttps://a.test/2.jpg\nhttps://a.test/3.jpg', 'lines3'), 'filled'));
  t('two image URLs are invalid', () => assert.strictEqual(
    checkValue('https://a.test/1.jpg\nhttps://a.test/2.jpg', 'lines3'), 'invalid'));
  t('a non-URL image line is invalid', () => assert.strictEqual(
    checkValue('https://a.test/1.jpg\nTBC\nhttps://a.test/3.jpg', 'lines3'), 'invalid'));

  // --- coordinates --------------------------------------------------------
  t('a real latitude is filled', () => assert.strictEqual(checkValue(37.9838, 'lat'), 'filled'));
  t('a real longitude is filled', () => assert.strictEqual(checkValue(-23.7275, 'lng'), 'filled'));
  t('latitude beyond 90 is invalid', () => assert.strictEqual(checkValue(120, 'lat'), 'invalid'));
  t('longitude beyond 180 is invalid', () => assert.strictEqual(checkValue(-190, 'lng'), 'invalid'));
  t('null island is invalid', () => assert.strictEqual(checkValue(0, 'lat'), 'invalid'));
  t('a non-numeric coordinate is invalid', () => assert.strictEqual(checkValue('north', 'lat'), 'invalid'));

  // --- other kinds --------------------------------------------------------
  t('a select object reads its name', () => assert.strictEqual(
    checkValue({ id: 'selX', name: 'Live', color: 'green' }, 'select'), 'filled'));
  t('a linked record array is filled', () => assert.strictEqual(checkValue(['recAbc'], 'link'), 'filled'));
  t('an https URL is filled', () => assert.strictEqual(checkValue('https://heathrow.com', 'url'), 'filled'));
  t('a bare domain is invalid as a URL', () => assert.strictEqual(checkValue('heathrow.com', 'url'), 'invalid'));
  t('an ISO date is filled', () => assert.strictEqual(checkValue('2026-08-14', 'date'), 'filled'));
  t('a nonsense date is invalid', () => assert.strictEqual(checkValue('soon', 'date'), 'invalid'));
  t('a three-letter IATA code is filled', () => assert.strictEqual(checkValue('LHR', 'iata'), 'filled'));
  t('a lower-case IATA code is invalid', () => assert.strictEqual(checkValue('lhr', 'iata'), 'invalid'));
  t('a four-letter code is invalid as IATA', () => assert.strictEqual(checkValue('EGLL', 'iata'), 'invalid'));

  console.log('\nThe distinction the dashboard is built on');
  t('a broken value is never counted as filled', () => {
    const broken = ['[]', '11,11,13', 'https://a.test/1.jpg'];
    const kinds = ['json', 'csv12', 'lines3'];
    broken.forEach((v, i) => assert.notStrictEqual(checkValue(v, kinds[i]), 'filled',
      `${JSON.stringify(v)} as ${kinds[i]} must not read as filled`));
  });
  t('a broken value is distinguishable from a blank one', () => {
    assert.strictEqual(checkValue('[]', 'json'), 'invalid');
    assert.strictEqual(checkValue('', 'json'), 'empty');
  });


  // ----------------------------------------------------------------------
  // Aggregation: the hierarchy walk, the tiers and the ranking.
  // ----------------------------------------------------------------------
  const { TYPES, aggregate, scoreRecord } = mod;
  const spec = k => TYPES.find(t => t.key === k);

  // Build a record whose named fields are filled and the rest left blank.
  function rec(id, typeKey, fill = {}, extra = {}) {
    const s = spec(typeKey);
    const fields = {};
    for (const [label, value] of Object.entries(fill)) {
      const f = s.fields.find(x => x.label === label);
      if (!f) throw new Error(`no field "${label}" on ${typeKey}`);
      fields[f.id] = value;
    }
    fields[s.nameField] = extra.name || id;
    if (extra.group && s.groupByField) fields[s.groupByField] = extra.group;
    if (extra.parent && s.parentLinkField) fields[s.parentLinkField] = [extra.parent];
    if (extra.children && s.childLinkField) fields[s.childLinkField] = extra.children;
    if (extra.status && s.statusField) fields[s.statusField] = extra.status;
    return { id, createdTime: extra.created || '2026-01-01T00:00:00.000Z', fields };
  }

  function everyField(typeKey, tier) {
    const s = spec(typeKey);
    const fill = {};
    const sample = {
      text: 'Filled', prose: 'A sentence long enough to count as genuine content rather than a stub.',
      select: 'Live', multi: ['Beach'], link: ['recParent1234567'],
      json: '[{"icon":"beach","title":"T","description":"D"}]',
      csv12: '11,11,13,16,20,24,26,27,24,20,16,13',
      lines3: 'https://a.test/1.jpg\nhttps://a.test/2.jpg\nhttps://a.test/3.jpg',
      url: 'https://a.test', date: '2026-08-14', iata: 'LHR', lat: 37.9838, lng: 23.7275,
    };
    for (const f of s.fields) {
      if (tier && f.tier !== tier) continue;
      fill[f.label] = sample[f.kind];
    }
    return fill;
  }

  console.log('\nScoring tiers');

  t('a record with every field is complete', () => {
    const s = scoreRecord(rec('r1', 'country', everyField('country')), spec('country'));
    assert.strictEqual(s.tier, 'complete');
    assert.strictEqual(s.score, 100);
    assert.strictEqual(s.missing.length, 0);
    assert.strictEqual(s.broken.length, 0);
  });

  t('every core field but no depth is ready, not complete', () => {
    const s = scoreRecord(rec('r2', 'country', everyField('country', 'core')), spec('country'));
    assert.strictEqual(s.tier, 'ready');
    assert.strictEqual(s.coreFilled, s.coreTotal);
    assert.ok(s.richFilled < s.richTotal, 'rich fields should still be missing');
  });

  t('a name and nothing else is a skeleton', () => {
    const s = scoreRecord(rec('r3', 'country', {}), spec('country'));
    assert.strictEqual(s.tier, 'skeleton');
    assert.strictEqual(s.score, 0);
  });

  t('one broken core field keeps a full record out of ready', () => {
    const fill = everyField('country');
    fill['Highlights JSON'] = '[]';
    const s = scoreRecord(rec('r4', 'country', fill), spec('country'));
    assert.notStrictEqual(s.tier, 'complete');
    assert.notStrictEqual(s.tier, 'ready');
    assert.strictEqual(s.broken.length, 1);
  });

  t('a broken field is reported separately from a missing one', () => {
    const fill = everyField('country');
    fill['Climate Temps'] = '11,11,13';   // broken
    delete fill['Events JSON'];           // missing
    const s = scoreRecord(rec('r5', 'country', fill), spec('country'));
    const label = i => spec('country').fields[i].label;
    assert.ok(s.broken.map(label).includes('Climate Temps'));
    assert.ok(s.missing.map(label).includes('Events JSON'));
  });

  console.log('\nAggregation and hierarchy');

  const scanned = [
    { spec: spec('country'), rows: [
        rec('recCountryGreece1', 'country', everyField('country'), { name: 'Greece', group: 'Europe', children: ['recCitySantorini'] }),
        rec('recCountrySpain111', 'country', {}, { name: 'Spain', group: 'Europe' }),
      ] },
    { spec: spec('city'), rows: [
        rec('recCitySantorini', 'city', everyField('city', 'core'), { name: 'Santorini', parent: 'recCountryGreece1', children: ['recResortOia12345'] }),
      ] },
    { spec: spec('resort'), rows: [
        rec('recResortOia12345', 'resort', {}, { name: 'Oia', parent: 'recCitySantorini' }),
      ] },
    { spec: spec('airport'), rows: [] },
    { spec: spec('attraction'), rows: [] },
  ];
  const out = aggregate(scanned);
  const find = n => out.records.find(r => r.name === n);

  t('every scanned record appears', () => assert.strictEqual(out.totals.records, 4));

  t('a resort two links down still rolls up to its continent', () => {
    const europe = out.continents.find(c => c.name === 'Europe');
    assert.ok(europe, 'Europe should be present');
    assert.strictEqual(europe.byType.resort, 1, 'Oia should be counted under Europe');
    assert.strictEqual(europe.count, 4);
  });

  t('a child names its parent', () => {
    assert.strictEqual(find('Oia').parent, 'Santorini');
    assert.strictEqual(find('Santorini').parent, 'Greece');
  });

  t('an empty country outranks an empty resort', () => {
    assert.ok(find('Spain').priority > find('Oia').priority,
      `Spain ${find('Spain').priority} should outrank Oia ${find('Oia').priority}`);
  });

  t('the queue is sorted by priority, worst first', () => {
    const p = out.records.map(r => r.priority);
    assert.deepStrictEqual(p, [...p].sort((a, b) => b - a));
  });

  t('a complete record scores no priority', () => assert.strictEqual(find('Greece').priority, 0));

  t('field fill rates are counted per type', () => {
    const countries = out.types.find(t => t.key === 'country');
    assert.strictEqual(countries.count, 2);
    const overview = countries.fields.find(f => f.label === 'Overview');
    assert.strictEqual(overview.filled, 1);
    assert.strictEqual(overview.empty, 1);
  });

  t('a record with no status is reported as such, not dropped', () => {
    const countries = out.types.find(t => t.key === 'country');
    const counted = Object.values(countries.statuses).reduce((a, b) => a + b, 0);
    assert.strictEqual(counted, countries.count);
    assert.ok(countries.statuses['No status'] >= 1);
  });

  t('reach counts what hangs off a record', () => {
    assert.ok(find('Greece').reach > find('Oia').reach);
  });

  t('an empty table does not break the aggregate', () => {
    const airports = out.types.find(t => t.key === 'airport');
    assert.strictEqual(airports.count, 0);
    assert.strictEqual(airports.avgScore, 0);
  });

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
})();
