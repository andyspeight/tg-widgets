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
      events: '[{"month":"May","name":"Feria","description":"Horses and sherry in early May."}]',
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
  /* 14 Sep 2026. The airports bulk-added on 26 and 27 Aug carry "CN", "RW",
     "MX" in Country Text where the May ones carry China, Rwanda, Mexico. Both
     are non-empty, so roughly 370 records scored as done while rendering a
     two-letter code on the page. */

  t('a country code in the country name column is broken, not filled', () => {
    ['CN', 'RW', 'mx', 'Gb'].forEach(v => {
      assert.strictEqual(checkValue(v, 'countryname'), 'invalid',
        v + ' is a code, not a name a page can show');
    });
  });

  t('a real country name is filled, however it is spelled', () => {
    ['China', 'United Kingdom', 'USA', 'UAE', 'Turks and Caicos Islands']
      .forEach(v => assert.strictEqual(checkValue(v, 'countryname'), 'filled', v));
  });

  t('an empty country name is still empty, not broken', () => {
    [null, '', '   '].forEach(v =>
      assert.strictEqual(checkValue(v, 'countryname'), 'empty'));
  });

  /* 15 Sep 2026. The airport tiers were re-cut because the dashboard was asking
     for three prose fields no fixer can supply, and so reported 16% whatever was
     run. These pin the new shape: core is what makes a record publishable, and
     nothing sits in core that the runner has no route to. */

  t('the three unfillable prose fields are depth, not core', () => {
    const ap = TYPES.find(t => t.key === 'airport');
    for (const label of ['Terminals & Airlines', 'Distance & Drive Time', 'Parking']) {
      const f = ap.fields.find(x => x.label === label);
      assert.ok(f, label + ' should still be on the airport spec');
      assert.strictEqual(f.tier, 'rich', label + ' has no fixer, so it cannot be core');
    }
  });

  t('Overview stays core, because the runner can write it', () => {
    const ap = TYPES.find(t => t.key === 'airport');
    assert.strictEqual(ap.fields.find(x => x.label === 'Overview').tier, 'core');
  });

  t('every other type still treats Overview as core', () => {
    // The reason Overview was kept: demoting it would make airports the odd one
    // out, and it buys nothing (118 either way on the live data).
    for (const key of ['country', 'city', 'resort']) {
      const spec = TYPES.find(t => t.key === key);
      const ov = spec.fields.find(x => x.label === 'Overview');
      if (ov) assert.strictEqual(ov.tier, 'core', key + ' Overview should be core');
    }
  });

  t('what is left in airport core is identity, geo, a summary and evidence', () => {
    const ap = TYPES.find(t => t.key === 'airport');
    const core = ap.fields.filter(f => f.tier === 'core').map(f => f.label).sort();
    assert.deepStrictEqual(core, [
      'Airport Role', 'City Served', 'Country Text', 'IATA Code', 'Latitude',
      'Longitude', 'Official Website', 'Overview', 'Source 1 URL', 'Source 2 URL',
      'Verified Date',
    ]);
  });

  /* WHAT STOPS A RECORD BEING READY, 15 Sep 2026. Only a broken CORE field.
     A broken rich field means some depth needs a correction, which is a
     different question from whether the page can go out, and it already has
     its own answers: no "complete", a lower fill rate, and a line on the To
     correct tab. Five island airports were held off the list by a Parking note
     of 37 characters that was the complete truth. */

  t('a broken core field still stops a record being ready', () => {
    const sp = spec('resort');
    const core = sp.fields.find(f => f.tier === 'core' && f.kind === 'prose');
    const fill = everyField('resort');
    fill[core.label] = 'too short';          // prose under the floor reads as broken
    const s2 = scoreRecord(rec('r1', 'resort', fill), sp);
    assert.ok(s2.broken.length, 'the field should read as broken');
    assert.strictEqual(s2.brokenCore, 1);
    assert.notStrictEqual(s2.tier, 'ready');
    assert.notStrictEqual(s2.tier, 'complete');
  });

  t('a broken rich field does not', () => {
    const sp = spec('resort');
    const rich = sp.fields.find(f => f.tier === 'rich' && f.kind === 'prose');
    const fill = everyField('resort');
    fill[rich.label] = 'too short';
    const s2 = scoreRecord(rec('r1', 'resort', fill), sp);
    assert.ok(s2.broken.length, 'the field should still read as broken');
    assert.strictEqual(s2.brokenCore, 0);
    assert.strictEqual(s2.tier, 'ready', 'the page can still go out');
  });

  t('but a broken rich field does keep a record out of complete', () => {
    // Nothing is hidden. "Complete" means every field including the extras, and
    // a field holding a stub is not one of them.
    const sp = spec('resort');
    const rich = sp.fields.find(f => f.tier === 'rich' && f.kind === 'prose');
    const fill = everyField('resort');
    fill[rich.label] = 'too short';
    assert.strictEqual(scoreRecord(rec('r1', 'resort', fill), sp).tier, 'ready');
    assert.strictEqual(scoreRecord(rec('r2', 'resort', everyField('resort')), sp).tier, 'complete');
  });

  t('a broken rich field is still counted and still reported', () => {
    const sp = spec('resort');
    const rich = sp.fields.find(f => f.tier === 'rich' && f.kind === 'prose');
    const fill = everyField('resort');
    fill[rich.label] = 'too short';
    const out = aggregate([{ spec: sp, rows: [rec('r1', 'resort', fill)] }]);
    const t0 = out.types.find(x => x.key === 'resort');
    const stat = t0.fields.find(f => f.label === rich.label);
    assert.strictEqual(stat.invalid, 1, 'it must still show on the To correct tab');
    assert.ok(t0.fillRate < 100, 'and it must still count against the fill rate');
  });

  /* THE FILL RATE, 15 Sep 2026. The tier count is all-or-nothing, so a table
     whose last gaps sit in fields with no fixer reports the same percentage
     however much real work lands. Airports read "16% ready" through a day of
     successful runs. The fill rate cannot do that, and these pin the property
     that makes it useful: one more filled cell always moves it. */

  t('a type reports how many of its cells are filled', () => {
    const only = aggregate([{ spec: spec('resort'), rows: [
      rec('recR1', 'resort', everyField('resort'), { name: 'Oia' }),
    ] }]).types.find(x => x.key === 'resort');
    assert.strictEqual(only.filledCells, only.cells, 'a record with everything is fully filled');
    assert.strictEqual(only.fillRate, 100);
  });

  t('an empty table reports nought rather than dividing by zero', () => {
    const none = aggregate([{ spec: spec('resort'), rows: [] }]).types.find(x => x.key === 'resort');
    assert.strictEqual(none.fillRate, 0);
    assert.strictEqual(none.cells, 0);
  });

  t('filling one more field always moves the fill rate', () => {
    // This is the whole reason the number exists. Build a record that can never
    // be "ready" because one core field stays blank, then fill a different
    // field: the tier does not budge and the fill rate does.
    const sp = spec('resort');
    const core = sp.fields.filter(f => f.tier === 'core');
    const blockedForever = core[0].label;   // stays empty in both runs
    const justFilled = core[1].label;       // empty in the first, filled in the second

    const build = (withExtra) => {
      const fill = everyField('resort');
      delete fill[blockedForever];
      if (!withExtra) delete fill[justFilled];
      return aggregate([{ spec: sp, rows: [rec('recR1', 'resort', fill, { name: 'Oia' })] }])
        .types.find(x => x.key === 'resort');
    };
    const before = build(false), after = build(true);

    assert.strictEqual(before.tiers.ready + before.tiers.complete, 0, 'not ready before');
    assert.strictEqual(after.tiers.ready + after.tiers.complete, 0, 'still not ready after');
    assert.ok(after.fillRate > before.fillRate,
      'the fill rate must move even when the tier cannot: ' + before.fillRate + ' -> ' + after.fillRate);
  });

  t('the fill rate counts core and rich alike', () => {
    // avgScore already weights core double. This one answers a different
    // question, how much of the table is done, so it must not weight anything.
    const sp = spec('resort');
    const rich = sp.fields.find(f => f.tier === 'rich');
    const core = sp.fields.find(f => f.tier === 'core');
    const oneOnly = (label) => {
      const fill = {};
      fill[label] = everyField('resort')[label];
      return aggregate([{ spec: sp, rows: [rec('recR1', 'resort', fill, { name: 'Oia' })] }])
        .types.find(x => x.key === 'resort').filledCells;
    };
    assert.strictEqual(oneOnly(rich.label), oneOnly(core.label),
      'one rich field filled should count the same as one core field');
  });

  t('the airports table uses that check, or none of this applies', () => {
    const ap = TYPES.find(t => t.key === 'airport');
    const f = ap.fields.find(x => x.label === 'Country Text');
    assert.ok(f, 'airports should carry Country Text');
    assert.strictEqual(f.kind, 'countryname');
  });


  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
})();
