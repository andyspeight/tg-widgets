/**
 * The fill runner's judgement: what gets derived, and what is allowed to save.
 *
 * Andy's rule is that passing content saves itself and he only sees the
 * exceptions. That makes the gate the only thing between a model and live
 * client data, so these tests are written to try to get bad values PAST it.
 * Every one of them should be held.
 *
 * Run: node tests/destinations-fill.cjs
 */
const assert = require('node:assert');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

let pass = 0, fail = 0;
const pending = [];
function t(name, fn) {
  try {
    const out = fn();
    if (out && typeof out.then === 'function') {
      pending.push(out.then(() => { pass++; },
        err => { fail++; console.error(`  FAIL  ${name}\n        ${err.message}`); }));
    } else pass++;
  } catch (err) { fail++; console.error(`  FAIL  ${name}\n        ${err.message}`); }
}
const load = f => import(pathToFileURL(path.join(__dirname, '..', 'api', '_lib', 'fill', f)).href);

(async () => {
  const { slugify, derive, ancestorsOf } = await load('_derive.js');
  const { fillPlanFor, isAutomatable, estimatePence, hasEnoughToWriteFrom } = await load('_registry.js');
  const { gate, shapeCheck, styleBreaches, formatBreaches } = await load('_gate.js');

  const F = (label, kind, tier) => ({ label, kind, tier: tier || 'core' });

  /* ---------------------------------------------------------------- */
  console.log('\nWhat kind of work is each gap');

  t('a slug is derived, never written', () => {
    assert.strictEqual(fillPlanFor(F('URL Slug', 'text')).kind, 'derive');
  });
  t('a resort inherits its country facts rather than researching them', () => {
    ['Time Zone', 'Currency', 'Language', 'Voltage And Plug'].forEach(l => {
      const p = fillPlanFor(F(l, 'text'));
      assert.strictEqual(p.kind, 'derive', l + ' should be inherited');
      assert.strictEqual(p.how.from, 'country');
    });
  });
  /* 'fact' means two independent sources can settle it AND the fixer exists.
     It does not mean "could be settled in principle": that distinction is the
     whole reason 498 airports were queued for Official Website on 10 Sep and
     held every one. So the content type is part of the question. */

  t('an airport fact the two datasets cover is runnable work', () => {
    ['Latitude', 'Longitude', 'Country Text', 'City Served',
     'Official Website', 'Wikipedia URL', 'Source 1 URL', 'Verified Date'].forEach(l => {
      assert.strictEqual(fillPlanFor(F(l, 'text'), 'airport').kind, 'fact',
        l + ' on an airport should be two-source work');
    });
  });

  t('the same field on a resort is not, because neither source knows it', () => {
    ['Latitude', 'Longitude', 'Official Website'].forEach(l => {
      const p = fillPlanFor(F(l, 'text'), 'resort');
      assert.strictEqual(p.kind, 'source', l + ' on a resort has no fixer');
      assert.match(p.why, /not built yet/);
    });
  });

  t('climate has no fixer wired to the queue, so it is not offered', () => {
    ['Climate Temps', 'Climate Season', 'Climate Rainfall'].forEach(l => {
      assert.strictEqual(fillPlanFor(F(l, 'csv12'), 'airport').kind, 'source',
        l + ' must not be offered until its fixer is wired up');
    });
  });

  t('an IATA code is never invented, because everything is keyed on it', () => {
    assert.strictEqual(fillPlanFor(F('IATA Code', 'iata'), 'airport').kind, 'source',
      'both sources are looked up BY the code, so it cannot be derived from them');
  });
  t('prose is written', () => {
    ['Overview', 'Hero Intro', 'Tagline', 'Highlights JSON'].forEach(l => {
      assert.strictEqual(fillPlanFor(F(l, 'prose')).kind, 'write', l + ' should be written');
    });
  });
  t('photography and audience fit are never generated', () => {
    ['Image URLs', 'Image Attribution', 'Best For Tags', 'Who Is It Best For'].forEach(l => {
      assert.strictEqual(fillPlanFor(F(l, 'text')).kind, 'manual', l + ' must stay manual');
      assert.strictEqual(isAutomatable(F(l, 'text')), false);
    });
  });
  t('linked records are never set by the runner', () => {
    assert.strictEqual(fillPlanFor(F('Country', 'link')).kind, 'manual');
  });
  t('only written fields cost anything', () => {
    assert.strictEqual(estimatePence(F('URL Slug', 'text')), 0);
    assert.strictEqual(estimatePence(F('Climate Temps', 'csv12')), 0);
    assert.strictEqual(estimatePence(F('Image URLs', 'lines3')), 0);
    assert.ok(estimatePence(F('Overview', 'prose')) > 0);
  });
  t('strict-format fields carry a brief so the shape is not left to chance', () => {
    assert.match(fillPlanFor(F('Highlights JSON', 'json')).brief, /JSON array/);
    assert.match(fillPlanFor(F('Tagline', 'text')).brief, /40 to 70/);
  });

  /* 11 Sep 2026. Andy ran Terminals & Airlines over 375 airports, twice. Every
     item was held, $4.14 went, nothing was written. The cause was this file:
     anything not explicitly classified fell through to "a model writes it", so
     operational facts about named airports were handed to a writer with no
     source. The default is closed now, and these tests hold it closed. */

  t('an operational fact about a place is never handed to a writer', () => {
    ['Terminals & Airlines', 'Parking', 'Lounges', 'Drop-off & Pick-up',
     'Special Assistance', 'Recommended Arrival Time', 'Getting There By Train',
     'Distance & Drive Time', 'Airport Hotels', 'Tickets and Prices'].forEach(l => {
      const p = fillPlanFor(F(l, 'prose'));
      assert.strictEqual(p.kind, 'source',
        l + ' is a fact we hold no source for, so it must not be written: got ' + p.kind);
    });
  });

  t('an unknown field fails closed rather than defaulting to written', () => {
    const p = fillPlanFor(F('Some Field Nobody Has Classified', 'prose'));
    assert.strictEqual(p.kind, 'source', 'the default must be closed');
    assert.match(p.why, /fact about the place/);
  });

  t('a field needing a source costs nothing, because it never runs', () => {
    assert.strictEqual(estimatePence(F('Terminals & Airlines', 'prose')), 0);
    assert.strictEqual(isAutomatable(F('Terminals & Airlines', 'prose')), false,
      'queueing it would hold every record, so it is not something the runner can attempt');
    assert.strictEqual(isAutomatable(F('IATA Code', 'iata')), false,
      'a fact whose fixer is not built is not automatable either');
    assert.strictEqual(isAutomatable(F('Overview', 'prose')), true);
    assert.strictEqual(isAutomatable(F('URL Slug', 'text')), true);
  });

  t('what the runner writes is interpretation, never a new fact', () => {
    // The allow-list is small on purpose. If this grows, every addition has to
    // be answerable: could it be written from what the record already holds?
    ['Overview', 'Tagline', 'Hero Intro', 'Highlights JSON',
     'Character and Vibe', 'What Makes It Special'].forEach(l => {
      assert.strictEqual(fillPlanFor(F(l, 'prose')).kind, 'write', l + ' should be written');
    });
  });

  console.log('\nIs there anything to write from');

  const bare = { name: 'Some Airport', values: { 'Country Text': 'ES' } };
  const rich = { name: 'Nerja', values: {
    'Country Text': 'Spain', 'Airport Role': 'Regional', 'Region': 'Andalusia',
    'Best Time to Visit': 'May to October', 'Tagline': 'Where the mountains meet the sea' } };
  const parentWithProse = [{ name: 'Spain', values: {
    Overview: 'Spain runs from the green, wet north through the high central plateau to the ' +
              'dry south, and the coast changes character every hundred miles or so.' } }];

  t('an almost empty record is refused before any money is spent', () => {
    const r = hasEnoughToWriteFrom({ rec: bare, ancestors: [] });
    assert.strictEqual(r.ok, false);
    assert.match(r.why, /facts need filling first/);
  });
  t('a record with real content can be written from', () => {
    assert.strictEqual(hasEnoughToWriteFrom({ rec: rich, ancestors: [] }).ok, true);
  });

  /* 11 Sep 2026. The first version counted FILLED FIELDS, so Estonia, Serbia
     and Ethiopia were refused a Hero Intro despite each carrying a
     two-hundred-word Overview: one rich field scored lower than four holding a
     currency code. How much is there, not how many boxes are ticked. */

  t('one long overview is enough on its own', () => {
    const estonia = { name: 'Estonia', values: { Overview:
      'Estonia brings together forested landscapes, bogs, islands and cultural traditions. ' +
      'More than half of its territory is forested, no point is more than ten kilometres from ' +
      'a bog, and the country has 2,317 islands. Wildlife preserves make up a quarter of it.' } };
    const r = hasEnoughToWriteFrom({ rec: estonia, ancestors: [] });
    assert.strictEqual(r.ok, true,
      'a record with a real paragraph on it has plenty to write two sentences from');
  });

  t('a handful of one-word fields is still not enough', () => {
    const thin = { name: 'Somewhere', values: {
      'Time Zone': 'GMT +1', 'Currency': 'Euro', 'Language': 'German', 'Voltage And Plug': 'C' } };
    assert.strictEqual(hasEnoughToWriteFrom({ rec: thin, ancestors: [] }).ok, false,
      'a currency and a plug type say nothing about what a place is like');
  });

  t('a link the runner wrote itself is not evidence about the place', () => {
    const linksOnly = { name: 'X', values: {
      'Official Website': 'https://www.example-airport-with-a-very-long-name.com/en/home/index',
      'Wikipedia URL': 'https://en.wikipedia.org/wiki/Some_Airport_With_A_Long_Name_Indeed' } };
    assert.strictEqual(hasEnoughToWriteFrom({ rec: linksOnly, ancestors: [] }).ok, false,
      'two long URLs are plenty of characters and no information');
  });
  t('a bare record inherits enough from a parent that has prose', () => {
    assert.strictEqual(hasEnoughToWriteFrom({ rec: bare, ancestors: parentWithProse }).ok, true);
  });
  t('a parent with only short values is not enough', () => {
    const thin = [{ name: 'Spain', values: { Overview: 'Sunny.' } }];
    assert.strictEqual(hasEnoughToWriteFrom({ rec: bare, ancestors: thin }).ok, false);
  });
  t('bookkeeping fields do not count as something to write from', () => {
    const admin = { name: 'X', values: {
      'Status': 'Live', 'URL Slug': 'x', 'Verified Date': '2026-01-01',
      'Source 1 URL': 'https://a.test', 'Source 2 URL': 'https://b.test' } };
    assert.strictEqual(hasEnoughToWriteFrom({ rec: admin, ancestors: [] }).ok, false,
      'five admin fields are not evidence about a place');
  });

  /* ---------------------------------------------------------------- */
  console.log('\nDeriving from what we already hold');

  const spain = { id: 'recSpain', type: 'country', name: 'Spain', parentId: null,
                  values: { 'Time Zone': 'GMT +1', 'Currency': 'Euro (€)', 'Region': 'Iberia · Southern Europe' } };
  const costa = { id: 'recCosta', type: 'city', name: 'Costa del Sol', parentId: 'recSpain', values: {} };
  const nerja = { id: 'recNerja', type: 'resort', name: 'Nerja', parentId: 'recCosta', values: {} };
  const orphan = { id: 'recOrphan', type: 'resort', name: 'Nowhere', parentId: null, values: {} };
  const byId = new Map([[spain.id, spain], [costa.id, costa], [nerja.id, nerja]]);

  t('a slug comes from the name', () => {
    const out = derive({ field: F('URL Slug', 'text'), how: { from: 'slug' }, rec: costa, byId });
    assert.strictEqual(out.value, 'costa-del-sol');
  });
  t('a resort two levels down still inherits its country currency', () => {
    const out = derive({ field: F('Currency', 'text'), how: { from: 'country' }, rec: nerja, byId });
    assert.strictEqual(out.ok, true);
    assert.strictEqual(out.value, 'Euro (€)');
    assert.match(out.evidence, /Spain/);
  });
  t('inheritance says where it came from, so a wrong value is traceable', () => {
    const out = derive({ field: F('Time Zone', 'text'), how: { from: 'country' }, rec: nerja, byId });
    assert.strictEqual(out.inheritedFrom, 'recSpain');
  });
  t('an empty parent value is a hold, not a blank save', () => {
    const out = derive({ field: F('Language', 'text'), how: { from: 'country' }, rec: nerja, byId });
    assert.strictEqual(out.ok, false);
    assert.match(out.why, /fill the country first/);
  });
  t('a record with no ancestors holds rather than guesses', () => {
    const out = derive({ field: F('Currency', 'text'), how: { from: 'country' }, rec: orphan, byId });
    assert.strictEqual(out.ok, false);
  });
  t('the ancestor walk terminates on a cycle', () => {
    const a = { id: 'a', type: 'city', name: 'A', parentId: 'b', values: {} };
    const b = { id: 'b', type: 'city', name: 'B', parentId: 'a', values: {} };
    const m = new Map([['a', a], ['b', b]]);
    assert.ok(ancestorsOf(a, m).length <= 4, 'must not loop forever');
  });
  t('a nameless record cannot be given a slug', () => {
    const out = derive({ field: F('URL Slug', 'text'), how: { from: 'slug' }, rec: { name: '   ' }, byId });
    assert.strictEqual(out.ok, false);
  });

  /* ---------------------------------------------------------------- */
  console.log('\nThe gate: shape');

  const prose = F('Overview', 'prose');
  const okText = 'Nerja sits at the eastern end of the Costa del Sol, where the mountains come down close to the sea and the beaches are coves rather than long strands.';

  t('an empty answer is held', () => {
    assert.strictEqual(shapeCheck({ value: '', field: prose }).ok, false);
    assert.strictEqual(shapeCheck({ value: null, field: prose }).ok, false);
  });
  t('an empty JSON array cannot satisfy a JSON field', () => {
    const r = shapeCheck({ value: '[]', field: F('Highlights JSON', 'json') });
    assert.strictEqual(r.ok, false);
    assert.match(r.why, /same fault the dashboard flags/);
  });
  t('eleven months of temperatures cannot satisfy a climate field', () => {
    assert.strictEqual(shapeCheck({ value: '11,12,13', field: F('Climate Temps', 'csv12') }).ok, false);
  });
  t('a real value passes shape', () => {
    assert.strictEqual(shapeCheck({ value: okText, field: prose }).ok, true);
  });

  console.log('\nThe gate: the shape the brief promised');

  /* 11 Sep 2026. A Tagline is a text field, and "filled" for a text field means
     non-empty, so nothing stopped a two-hundred-character tagline saving itself
     into a slot that sits beside the place name on a client site. A rule told
     to a model and not checked is not a rule. */

  const TAG = F('Tagline', 'text');
  const GOOD = 'Where forest gives way to bog, and bog gives way to sea';

  t('the tagline Estonia actually got is accepted', () => {
    const r = shapeCheck({ value: GOOD, field: TAG, place: 'Estonia' });
    assert.strictEqual(r.ok, true, r.why);
    assert.ok(GOOD.length >= 40 && GOOD.length <= 70, 'and it is in range: ' + GOOD.length);
  });

  t('a tagline far over the limit is refused, with the count', () => {
    const r = shapeCheck({ value: 'A line that runs on and on '.repeat(8), field: TAG, place: 'Estonia' });
    assert.strictEqual(r.ok, false);
    assert.match(r.why, /at most 70/);
  });

  t('a tagline too short to be a line is refused', () => {
    const r = shapeCheck({ value: 'Sun and sea', field: TAG, place: 'Estonia' });
    assert.strictEqual(r.ok, false);
    assert.match(r.why, /at least 40/);
  });

  t('a tagline that ends with a full stop is refused, as the brief says', () => {
    const r = shapeCheck({ value: GOOD + '.', field: TAG, place: 'Estonia' });
    assert.strictEqual(r.ok, false);
    assert.match(r.why, /full stop/);
  });

  t('a tagline that repeats the place name is refused', () => {
    const r = shapeCheck({ value: 'Estonia, where forest gives way to bog and then sea', field: TAG, place: 'Estonia' });
    assert.strictEqual(r.ok, false);
    assert.match(r.why, /place name/);
  });

  t('a name inside a longer word is not a repeat', () => {
    assert.deepStrictEqual(
      formatBreaches('Where the cormorants gather on the bog margins at dusk', { noPlaceName: true }, 'Cor'),
      [], 'matching on a word boundary, not a substring');
  });

  t('the format rules only apply where a brief promised one', () => {
    const long = 'A sentence with enough substance in it to read as real content, not a stub at all.';
    assert.strictEqual(shapeCheck({ value: long, field: F('Overview', 'prose'), place: 'Estonia' }).ok, true,
      'an Overview has no character limit, so it must not inherit the Tagline rules');
  });

  console.log('\nThe gate: house style');
  t('an em dash is caught', () => assert.ok(styleBreaches('It is lovely — truly.').length));
  t('US spelling is caught', () => assert.ok(styleBreaches('The harbor color').length));
  t('AI cliche is caught', () => {
    ['a hidden gem', 'nestled in the hills', 'a vibrant tapestry', 'bustling markets']
      .forEach(s => assert.ok(styleBreaches(s).length, s + ' should be caught'));
  });
  t('clean UK prose passes', () => assert.deepStrictEqual(styleBreaches(okText), []));
  t('a style breach never reaches the model layers', () => {
    // long enough to clear the length check, so it is style that stops it
    const r = shapeCheck({
      value: 'Nerja is a hidden gem on the eastern Costa del Sol, well worth a visit for its coves.',
      field: prose });
    assert.strictEqual(r.ok, false);
    assert.match(r.why, /house style/);
  });

  /* ---------------------------------------------------------------- */
  console.log('\nThe gate: verification');

  const asking = (grounding, adversarial) => {
    let n = 0;
    return async () => { n++; return JSON.stringify(n === 1 ? grounding : adversarial); };
  };
  const SUPPORTED = { supported: true, unsupported: [], note: 'fine' };
  const PUBLISH = { publish: true, faults: [], risk: 'low' };

  t('a derived value skips the model entirely', async () => {
    let called = false;
    const r = await gate({ value: 'costa-del-sol', field: F('URL Slug', 'text'), kind: 'derive',
      ask: async () => { called = true; return '{}'; } });
    assert.strictEqual(r.save, true);
    assert.strictEqual(called, false, 'inheritance is not a claim to verify');
  });

  t('a two-source fact skips the model entirely', async () => {
    let called = false;
    const r = await gate({ value: '11,11,13,16,20,24,26,27,24,20,16,13', field: F('Climate Temps', 'csv12'),
      kind: 'fact', ask: async () => { called = true; return '{}'; } });
    assert.strictEqual(r.save, true);
    assert.strictEqual(called, false);
  });

  t('written copy that passes both checks saves', async () => {
    const r = await gate({ value: okText, field: prose, kind: 'write', evidence: 'Nerja is on the Costa del Sol.',
      place: 'Nerja', ask: asking(SUPPORTED, PUBLISH) });
    assert.strictEqual(r.save, true);
    assert.strictEqual(r.checks.grounding, 'pass');
    assert.strictEqual(r.checks.adversarial, 'pass');
  });

  t('an unsupported claim is held, and the claim is named', async () => {
    const r = await gate({ value: okText, field: prose, kind: 'write', evidence: '', place: 'Nerja',
      ask: asking({ supported: false, unsupported: ['the Roman aqueduct'] }, PUBLISH) });
    assert.strictEqual(r.save, false);
    assert.match(r.reason, /Roman aqueduct/);
    assert.strictEqual(r.risk, 'high');
  });

  t('the second check can veto something the first passed', async () => {
    const r = await gate({ value: okText, field: prose, kind: 'write', evidence: 'x', place: 'Nerja',
      ask: asking(SUPPORTED, { publish: false, faults: ['contradicts the stored climate'], risk: 'high' }) });
    assert.strictEqual(r.save, false);
    assert.match(r.reason, /contradicts/);
  });

  t('a price claim saves but is flagged for a spot-check', async () => {
    const r = await gate({ value: 'Entry costs £12 for adults and the museum opens daily.', field: prose,
      kind: 'write', evidence: 'x', place: 'Nerja', ask: asking(SUPPORTED, PUBLISH) });
    assert.strictEqual(r.save, true);
    assert.strictEqual(r.risk, 'high');
    assert.match(r.reason, /spot-check/);
  });

  console.log('\nThe gate fails closed');

  t('no verifier means hold, never trust', async () => {
    const r = await gate({ value: okText, field: prose, kind: 'write', place: 'Nerja' });
    assert.strictEqual(r.save, false);
    assert.match(r.reason, /held rather than trusted/);
  });
  t('a verifier that throws means hold', async () => {
    const r = await gate({ value: okText, field: prose, kind: 'write', place: 'Nerja',
      ask: async () => { throw new Error('upstream down'); } });
    assert.strictEqual(r.save, false);
    assert.match(r.reason, /could not run/);
  });
  t('an unreadable verdict means hold', async () => {
    const r = await gate({ value: okText, field: prose, kind: 'write', place: 'Nerja',
      ask: async () => 'I think it is probably fine?' });
    assert.strictEqual(r.save, false);
    assert.match(r.reason, /did not answer clearly/);
  });
  t('a verdict missing its field means hold', async () => {
    const r = await gate({ value: okText, field: prose, kind: 'write', place: 'Nerja',
      ask: async () => JSON.stringify({ note: 'looks good' }) });
    assert.strictEqual(r.save, false);
  });
  t('a fenced JSON reply is still read', async () => {
    let n = 0;
    const r = await gate({ value: okText, field: prose, kind: 'write', evidence: 'x', place: 'Nerja',
      ask: async () => { n++; return '```json\n' + JSON.stringify(n === 1 ? SUPPORTED : PUBLISH) + '\n```'; } });
    assert.strictEqual(r.save, true);
  });
  t('the second check is never reached once the first fails', async () => {
    let calls = 0;
    await gate({ value: okText, field: prose, kind: 'write', place: 'Nerja',
      ask: async () => { calls++; return JSON.stringify({ supported: false, unsupported: ['x'] }); } });
    assert.strictEqual(calls, 1, 'a failed grounding check should not pay for a second call');
  });


  /* ---------------------------------------------------------------- */
  console.log('\nOne item, end to end');

  const { runItem } = await load('_run.js');
  const cov = await import(pathToFileURL(path.join(__dirname, '..', 'api', '_lib', 'destination-coverage.js')).href);
  const resortSpec = cov.TYPES.find(x => x.key === 'resort');
  const idxOf = label => resortSpec.fields.findIndex(f => f.label === label);

  const SLUG = idxOf('URL Slug');
  const CURRENCY = idxOf('Currency');
  const OVERVIEW = idxOf('Overview');
  const IMAGES = idxOf('Image URLs');
  const CLIMATE = idxOf('Climate Temps');

  const spainRec = { id: 'recSpain0000000AA', type: 'country', name: 'Spain', parentId: null,
                     values: { Currency: 'Euro (€)', Overview: 'Spain is large and varied.' }, fields: {} };
  function resortRec(fields = {}) {
    return { id: 'recNerja0000000AA', type: 'resort', name: 'Nerja', parentId: spainRec.id,
             group: null, values: {}, fields };
  }
  const chain = () => new Map([[spainRec.id, spainRec]]);

  function writer(sink) {
    return async (args) => { sink.push(args); };
  }

  t('a derivable field is filled with no model call and no cost', async () => {
    const wrote = [];
    const out = await runItem({
      item: { type: 'resort', recordId: 'recNerja0000000AA', fieldIdx: SLUG },
      spec: resortSpec, record: resortRec(), byId: chain(), writeBack: writer(wrote),
    });
    assert.strictEqual(out.result, 'saved');
    assert.strictEqual(out.costUsd, 0);
    assert.strictEqual(wrote.length, 1);
    assert.strictEqual(wrote[0].value, 'nerja');
    assert.strictEqual(wrote[0].fieldId, resortSpec.fields[SLUG].id);
  });

  t('an inherited field takes its parent country value', async () => {
    const wrote = [];
    const out = await runItem({
      item: { type: 'resort', recordId: 'recNerja0000000AA', fieldIdx: CURRENCY },
      spec: resortSpec, record: resortRec(), byId: chain(), writeBack: writer(wrote),
    });
    assert.strictEqual(out.result, 'saved');
    assert.strictEqual(wrote[0].value, 'Euro (€)');
  });

  t('a field that is already good is left alone, never overwritten', async () => {
    const wrote = [];
    const already = {};
    already[resortSpec.fields[SLUG].id] = 'nerja-old-slug';
    const out = await runItem({
      item: { type: 'resort', recordId: 'recNerja0000000AA', fieldIdx: SLUG },
      spec: resortSpec, record: resortRec(already), byId: chain(), writeBack: writer(wrote),
    });
    assert.strictEqual(out.result, 'skipped');
    assert.strictEqual(wrote.length, 0, 'nothing may be written over a good value');
  });

  t('a field a person owns is never filled by the runner', async () => {
    const wrote = [];
    const out = await runItem({
      item: { type: 'resort', recordId: 'recNerja0000000AA', fieldIdx: IMAGES },
      spec: resortSpec, record: resortRec(), byId: chain(), writeBack: writer(wrote),
    });
    assert.strictEqual(out.result, 'held');
    assert.strictEqual(wrote.length, 0);
  });

  t('a factual gap is held honestly rather than guessed by a model', async () => {
    const wrote = [];
    const out = await runItem({
      item: { type: 'resort', recordId: 'recNerja0000000AA', fieldIdx: CLIMATE },
      spec: resortSpec, record: resortRec(), byId: chain(), writeBack: writer(wrote),
    });
    assert.strictEqual(out.result, 'held');
    assert.match(out.reason, /two independent sources/);
    assert.strictEqual(wrote.length, 0);
    assert.strictEqual(out.costUsd, 0);
  });

  t('a missing record is held, not written blind', async () => {
    const wrote = [];
    const out = await runItem({
      item: { type: 'resort', recordId: 'recGone00000000AA', fieldIdx: SLUG },
      spec: resortSpec, record: null, byId: chain(), writeBack: writer(wrote),
    });
    assert.strictEqual(out.result, 'held');
    assert.strictEqual(wrote.length, 0);
  });

  t('with the budget spent, paid work waits and is marked retryable', async () => {
    const wrote = [];
    const out = await runItem({
      item: { type: 'resort', recordId: 'recNerja0000000AA', fieldIdx: OVERVIEW },
      spec: resortSpec, record: resortRec(), byId: chain(), writeBack: writer(wrote),
      allowPaid: false,
    });
    assert.strictEqual(out.result, 'held');
    assert.match(out.reason, /budget/);
    assert.strictEqual(out.retryable, true);
    assert.strictEqual(wrote.length, 0);
  });

  t('a write that Airtable rejects is held, and says so', async () => {
    const out = await runItem({
      item: { type: 'resort', recordId: 'recNerja0000000AA', fieldIdx: SLUG },
      spec: resortSpec, record: resortRec(), byId: chain(),
      writeBack: async () => { throw new Error('422 INVALID_VALUE'); },
    });
    assert.strictEqual(out.result, 'held');
    assert.match(out.reason, /write to Airtable failed/);
  });

  t('every outcome names the place and the field, so the log reads', async () => {
    const out = await runItem({
      item: { type: 'resort', recordId: 'recNerja0000000AA', fieldIdx: SLUG },
      spec: resortSpec, record: resortRec(), byId: chain(), writeBack: async () => {},
    });
    assert.strictEqual(out.place, 'Nerja');
    assert.strictEqual(out.field, 'URL Slug');
  });


  await Promise.all(pending);
  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
})();
