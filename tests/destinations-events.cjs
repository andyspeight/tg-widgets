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

  console.log(`\n  ${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
})();
