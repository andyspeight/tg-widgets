/**
 * Events JSON — reading what is actually on the record.
 *
 * The Events field holds three shapes rather than one. The contract is
 * {month, name, description}; two batches were written to other shapes, and the
 * reader used to drop or blank them. These tests pin down that every shape we
 * hold reaches a traveller, and that nothing is invented on the way.
 *
 * Run: node tests/destinations-events.cjs
 */
const assert = require('node:assert');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; }
  catch (err) { fail++; console.error(`  FAIL  ${name}\n        ${err.message}`); }
}
const J = (v) => JSON.stringify(v);

(async () => {
  const { parseEvents } = await import(
    pathToFileURL(path.join(__dirname, '..', 'api', 'destination-content.js')).href
  );

  console.log('\nThe contract shape');

  t('a contract entry comes through whole', () => {
    const [e] = parseEvents(J([{ month: 'Jul-Aug', name: 'Sea Dance', description: 'Beach music at Jaz.' }]));
    assert.deepStrictEqual(e, { month: 'Jul-Aug', name: 'Sea Dance', description: 'Beach music at Jaz.' });
  });
  t('an entry with no name is dropped', () => {
    assert.deepStrictEqual(parseEvents(J([{ month: 'May', description: 'No name on it.' }])), []);
  });
  t('at most six events are returned', () => {
    const many = Array.from({ length: 9 }, (_, i) => ({ month: 'May', name: 'E' + i, description: 'x' }));
    assert.strictEqual(parseEvents(J(many)).length, 6);
  });
  t('broken JSON returns an empty list rather than throwing', () => {
    assert.deepStrictEqual(parseEvents('{not json'), []);
  });
  t('a JSON object rather than an array returns nothing', () => {
    assert.deepStrictEqual(parseEvents(J({ month: 'May', name: 'X' })), []);
  });
  t('a blank field returns nothing', () => {
    assert.deepStrictEqual(parseEvents('   '), []);
  });

  console.log('\nThe Highlights shape (15 resort records, F to G)');

  // These were written with the Highlights writer: {icon, title, description},
  // no month key, the date sitting at the front of the description. Before the
  // fix all 45 of them were filtered out and no traveller ever saw them.
  t('title is read where name is missing', () => {
    const [e] = parseEvents(J([{ icon: 'star', title: 'Sant Antoni', description: '17 January. Bonfires and horses.' }]));
    assert.strictEqual(e.name, 'Sant Antoni');
  });
  t('the month is recovered from the front of the description', () => {
    const [e] = parseEvents(J([{ icon: 'star', title: 'Sant Antoni', description: '17 January. Bonfires and horses.' }]));
    assert.strictEqual(e.month, '17 January');
  });
  t('a day range in front of the description is kept whole', () => {
    const [e] = parseEvents(J([{ icon: 'sun', title: 'Sant Joan', description: '23 to 25 June. The jaleo through Ciutadella.' }]));
    assert.strictEqual(e.month, '23 to 25 June');
  });
  t('a month range in front of the description is kept whole', () => {
    const [e] = parseEvents(J([{ icon: 'food', title: 'Lobster season', description: 'April to August. The fleet is at full capacity.' }]));
    assert.strictEqual(e.month, 'April to August');
  });
  t('name still wins over title when both are present', () => {
    const [e] = parseEvents(J([{ name: 'Real', title: 'Other', description: 'May. Something.' }]));
    assert.strictEqual(e.name, 'Real');
  });

  console.log('\nThe period and date shape (24 city records)');

  t('period is read where month is missing', () => {
    const [e] = parseEvents(J([{ name: 'Aoussou', period: 'July-August', description: 'Parades through the medina.' }]));
    assert.strictEqual(e.month, 'July-August');
  });
  t('date is read where month and period are missing', () => {
    const [e] = parseEvents(J([{ name: 'El Jem', date: 'July-August', description: 'Orchestras in the amphitheatre.' }]));
    assert.strictEqual(e.month, 'July-August');
  });
  t('month still wins over period and date', () => {
    const [e] = parseEvents(J([{ month: 'May', period: 'June', date: 'July', name: 'X', description: 'y' }]));
    assert.strictEqual(e.month, 'May');
  });

  console.log('\nNothing is invented, and nothing is cut short');

  t('a month longer than twenty characters survives intact', () => {
    // "Late November to early January" is 30 characters. The old cap served it
    // as "Late November to ea", which is how 37 records read in the app.
    const long = 'Late November to early January';
    const [e] = parseEvents(J([{ month: long, name: 'Winter Wonders', description: 'Chalets on the Grand Place.' }]));
    assert.strictEqual(e.month, long);
  });
  t('an absurdly long month is still capped', () => {
    const [e] = parseEvents(J([{ month: 'x'.repeat(200), name: 'X', description: 'y' }]));
    assert.strictEqual(e.month.length, 40);
  });
  t('no month anywhere stays blank rather than being guessed', () => {
    const [e] = parseEvents(J([{ name: 'Whenever', description: 'A festival with no date given at all.' }]));
    assert.strictEqual(e.month, '');
  });
  t('a description that merely mentions a month later is not mined for one', () => {
    // Only a date at the FRONT is a date. A month in the middle of a sentence
    // is prose, and reading it as the event month would be a guess.
    const [e] = parseEvents(J([{ name: 'Harvest', description: 'The vines are picked before the September rains arrive.' }]));
    assert.strictEqual(e.month, '');
  });
  t('markup is stripped out of every field', () => {
    const [e] = parseEvents(J([{ month: '<b>May</b>', name: '<i>Fair</i>', description: '<script>x</script>Bonfires.' }]));
    assert.strictEqual(e.month, 'May');
    assert.strictEqual(e.name, 'Fair');
    assert.strictEqual(e.description, 'xBonfires.');
  });
  t('a non-object entry in the array is dropped', () => {
    assert.deepStrictEqual(parseEvents(J(['just a string', null, 42])), []);
  });

  // --------------------------------------------------------------------
  // What the dashboard sees. Same field, same verdict, so the tool cannot
  // report a record as finished while the app serves nothing.
  // --------------------------------------------------------------------
  const { eventProblems, monthsNamedIn, tagCovers } =
    await import(pathToFileURL(path.join(__dirname, '..', 'api', '_lib', 'destination-events.js')).href);
  const { checkValue } = await import(
    pathToFileURL(path.join(__dirname, '..', 'api', '_lib', 'destination-coverage.js')).href);

  console.log('\nReading a month range');

  t('a single month covers only itself', () => {
    assert.deepStrictEqual([...tagCovers('May')], [4]);
  });
  t('a range covers everything between its ends', () => {
    assert.deepStrictEqual([...tagCovers('Jul-Aug')].sort((a, b) => a - b), [6, 7]);
  });
  t('a range that wraps the year end still counts forwards', () => {
    assert.deepStrictEqual([...tagCovers('Nov-Feb')], [10, 11, 0, 1]);
  });
  t('year-round covers all twelve', () => {
    assert.strictEqual(tagCovers('Year-round').size, 12);
  });
  t('a moving feast covers every month rather than contradicting one', () => {
    // "Variable (Islamic calendar)" is the honest answer for Eid. Reading it as
    // all twelve means it can never be flagged as disagreeing with its text.
    assert.strictEqual(tagCovers('Variable (Islamic calendar)').size, 12);
  });
  t('a month field holding something else entirely reads as no months', () => {
    assert.strictEqual(tagCovers('see website'), null);
  });
  t('an accented word is not mistaken for a month', () => {
    // The ASCII word boundary fired inside "Maré" and read it as March, which
    // flagged a perfectly good August festival as being tagged wrong.
    assert.deepStrictEqual(monthsNamedIn('Festival Maré de Agosto on Santa Maria').named, []);
  });
  t('a lowercase verb is not mistaken for a month', () => {
    assert.deepStrictEqual(monthsNamedIn('visitors may march up the hill').named, []);
  });
  t('prose that names a span covers the months inside it', () => {
    const { covered } = monthsNamedIn('runs from late June through early September');
    assert.ok(covered.has(6), 'July should sit inside June to September');
  });
  t('two months with prose between them are not a span', () => {
    const { covered } = monthsNamedIn('in early October, and the smaller version each September');
    assert.ok(!covered.has(7), 'August must not be swallowed by two unrelated months');
  });

  console.log('\nWhat counts as a problem');

  t('a sound events list has nothing wrong with it', () => {
    assert.deepStrictEqual(eventProblems(J([{ month: 'May', name: 'Feria', description: 'Horses in early May.' }])), []);
  });
  t('a tag that contradicts its own description is a problem', () => {
    // Andy's example. Tagged February, text says mid-January, so a February
    // traveller is sent to something that finished six weeks earlier.
    const p = eventProblems(J([{ month: 'Feb', name: 'Art Deco Weekend', description: 'The three-day festival in mid-January on Ocean Drive.' }]));
    assert.strictEqual(p.length, 1);
    assert.match(p[0], /tagged Feb but its own description says January/);
  });
  t('a tag inside a span the text names is not a problem', () => {
    assert.deepStrictEqual(eventProblems(J([{ month: 'Dec', name: 'Winter Wonders', description: 'Six weeks from late November through early January.' }])), []);
  });
  t('an entry with no name is reported as dropped', () => {
    assert.match(eventProblems(J([{ month: 'May', description: 'No name.' }]))[0], /no name, so it is dropped/);
  });
  t('an entry with no month anywhere is reported as undated', () => {
    assert.match(eventProblems(J([{ name: 'Whenever', description: 'A festival with no date.' }]))[0], /no month, so it shows undated/);
  });
  t('a month we cannot parse is accepted rather than called wrong', () => {
    // "Variable (Islamic calendar)" is the honest answer for a moving feast.
    assert.deepStrictEqual(eventProblems(J([{ month: 'Variable (Islamic calendar)', name: 'Eid', description: 'Dates move each year.' }])), []);
  });
  t('broken JSON is reported, not swallowed', () => {
    assert.match(eventProblems('{not json')[0], /not valid JSON/);
  });
  t('an empty array is reported', () => {
    assert.match(eventProblems('[]')[0], /empty/);
  });

  console.log('\nThe dashboard reaches the same verdict');

  t('a sound events field reads as filled', () => {
    assert.strictEqual(checkValue(J([{ month: 'May', name: 'Feria', description: 'Horses in early May.' }]), 'events'), 'filled');
  });
  t('a self-contradicting events field reads as needing a correction', () => {
    assert.strictEqual(checkValue(J([{ month: 'Feb', name: 'X', description: 'The festival in mid-January.' }]), 'events'), 'invalid');
  });
  t('a Highlights-shaped events field reads as filled now the month is recovered', () => {
    assert.strictEqual(checkValue(J([{ icon: 'star', title: 'Sant Antoni', description: '17 January. Bonfires and horses.' }]), 'events'), 'filled');
  });
  t('an events field that would serve nothing does not read as filled', () => {
    // A non-empty JSON array used to score as done. This is how 39 records
    // told the dashboard they were finished while the app served nothing.
    assert.strictEqual(checkValue(J([{ icon: 'star', description: 'No name and no month.' }]), 'events'), 'invalid');
  });
  t('a blank events field is still simply empty', () => {
    assert.strictEqual(checkValue('', 'events'), 'empty');
  });

  console.log(`\n  ${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
})();
