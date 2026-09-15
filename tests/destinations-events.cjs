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
const ORDER = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
let cov;   // set once tagCovers is imported: a tag as a readable list of months

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
  cov = (tag) => { const s = tagCovers(tag); return s ? [...s].sort((a, b) => a - b).map(i => ORDER[i]) : null; };

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

  // --------------------------------------------------------------------
  // Rebuilding a tag from the description under it. Andy's call, 15 Sep 2026.
  // The bar is that every month written back was already in the record.
  // --------------------------------------------------------------------
  const { monthTagFromText, proposedRetag } = await import(
    pathToFileURL(path.join(__dirname, '..', 'api', '_lib', 'destination-events.js')).href);

  console.log('\nReading a date out of a description');

  t('one month in a date position', () => {
    assert.strictEqual(monthTagFromText('The three-day festival in mid-January on Ocean Drive.'), 'Jan');
  });
  t('a day number in front of a month is a date', () => {
    assert.strictEqual(monthTagFromText('18 February celebrates the 1965 independence from Britain.'), 'Feb');
  });
  t('a day range in front of a month is a date', () => {
    assert.strictEqual(monthTagFromText('The spring festival of 22-24 April celebrates the Reconquista.'), 'Apr');
  });
  t('a hyphenated month range needs no cue in front of it', () => {
    assert.strictEqual(monthTagFromText('The traditional April-June Almadraba tuna harvest.'), 'Apr-Jun');
  });
  t('"or" between two months is a range', () => {
    assert.strictEqual(monthTagFromText('Three days of late March or early April at the stadium.'), 'Mar-Apr');
  });
  t('"and" between two months is a range', () => {
    // "across October and November" is Oct-Nov. Narrowing it to October would
    // be true but less use to somebody deciding when to go.
    assert.strictEqual(monthTagFromText('The olive harvest runs across October and November.'), 'Oct-Nov');
  });
  t('a span written out in full is a range', () => {
    assert.strictEqual(monthTagFromText('Runs from late June through early September in the Arsenal.'), 'Jun-Sep');
  });
  t('a year with no month yields nothing', () => {
    assert.strictEqual(monthTagFromText('Celebrates the 1276 Reconquista with 5,000 residents in costume.'), null);
  });
  t('two unrelated dates in one description yield nothing', () => {
    // A contest in October with a smaller version each September is two
    // answers, and picking one of them would be a guess.
    assert.strictEqual(monthTagFromText('The contest in early October, with the smaller version each September.'), null);
  });
  t('a month that is only part of a name yields nothing', () => {
    assert.strictEqual(monthTagFromText('Festival Mare de Agosto on Santa Maria island, at Praia Formosa.'), null);
  });

  console.log('\nProposing a retag');

  const RETAG = { month: 'Feb', name: 'Art Deco Weekend', description: 'The three-day festival in mid-January on Ocean Drive.' };

  t('a contradicted tag is rebuilt from its own text', () => {
    assert.deepStrictEqual(proposedRetag(RETAG), { key:'month', was:'Feb', next:'Jan', name:'Art Deco Weekend' });
  });
  t('a tag that already agrees is left alone', () => {
    assert.strictEqual(proposedRetag({ month:'Jan', name:'X', description:'The festival in mid-January.' }), null);
  });
  t('a tag inside a span the text names is left alone', () => {
    assert.strictEqual(proposedRetag({ month:'Dec', name:'X', description:'From late November through early January.' }), null);
  });
  t('a description leaning on a movable feast is left alone', () => {
    // Diwali moves between October and November, so a description naming one of
    // them is dating a year rather than the event.
    assert.strictEqual(proposedRetag({ month:'Nov', name:'Diwali in Grand Bassin',
      description:'The Hindu Festival of Lights in late October turns the sacred lake into a sea of diyas.' }), null);
  });
  t('a description with no month is left alone', () => {
    assert.strictEqual(proposedRetag({ month:'Jun', name:'X', description:'A festival with no date in it at all.' }), null);
  });
  t('an entry with no month tag is left alone', () => {
    // Undated entries are a different problem and are not this job.
    assert.strictEqual(proposedRetag({ name:'X', description:'The festival in mid-January.' }), null);
  });
  t('a month field that is not a month is left alone', () => {
    assert.strictEqual(proposedRetag({ month:'Variable (Islamic calendar)', name:'Eid', description:'Falls in March this year.' }), null);
  });
  t('the retag is written to whichever key held the month', () => {
    const p = proposedRetag({ period:'Feb', name:'X', description:'The festival in mid-January.' });
    assert.strictEqual(p.key, 'period');
    assert.strictEqual(p.next, 'Jan');
  });
  t('a rebuilt tag always agrees with the text it came from', () => {
    // The guard that stops a future change writing a fresh contradiction.
    const p = proposedRetag(RETAG);
    assert.deepStrictEqual(eventProblems(JSON.stringify([{ ...RETAG, month: p.next }])), []);
  });
  t('retagging fixes the record the dashboard was flagging', () => {
    const fixed = JSON.stringify([{ ...RETAG, month: proposedRetag(RETAG).next }]);
    assert.strictEqual(checkValue(fixed, 'events'), 'filled');
  });


  console.log('\nFeasts that do not move, and feasts that do');

  t('Christmas Eve closes a span that started in November', () => {
    // Berlin. The tag said December and the text said November, and the two
    // only agree once Christmas Eve is read as the date it is.
    const { covered } = monthsNamedIn('80+ markets from late November through Christmas Eve.');
    assert.deepStrictEqual([...covered].sort((a, b) => a - b), [10, 11]);
  });
  t("New Year's Day closes a span into January", () => {
    const { covered } = monthsNamedIn('Markets from late November through New Year\'s Day.');
    assert.deepStrictEqual([...covered].sort((a, b) => a - b), [0, 10, 11]);
  });
  t('a bare New Year claims only the December half', () => {
    // It could be the 31st or the 1st. Under-claiming a day beats over-claiming
    // a month.
    assert.strictEqual(monthTagFromText('Lights from mid-November through to New Year.'), 'Nov-Dec');
  });
  t('Boxing Day is a date on its own', () => {
    assert.strictEqual(monthTagFromText('The street carnival on Boxing Day sees masked dancers parade.'), 'Dec');
  });
  t('Orthodox Christmas is not December', () => {
    // Tbilisi holds this on 7 January and the tag says so. Reading the name as
    // a date would have overwritten a correct tag.
    assert.strictEqual(proposedRetag({ month:'7 January', name:'Christmas (Old Calendar)',
      description:'Orthodox Christmas with the Alilo procession through the old town.' }), null);
  });
  t("somebody else's new year is not December", () => {
    // Nyepi is in March and Mwaka Kogwa is in July. Both call themselves a new
    // year, and a capitalised word in front of the phrase is what says so.
    assert.strictEqual(proposedRetag({ month:'Mar', name:'Nyepi (Day of Silence)',
      description:"Bali's New Year. The whole island shuts down for 24 hours." }), null);
    assert.strictEqual(proposedRetag({ month:'Jul', name:'Mwaka Kogwa',
      description:'A four-day Persian-origin New Year festival in Makunduchi.' }), null);
  });
  t('a named month still beats a movable feast in the same sentence', () => {
    // Chinese New Year moves, but "late January or early February" covers the
    // whole of where it moves to, so the text is honest and May is not.
    const { covered } = monthsNamedIn('The Chinatown festival in late January or early February.');
    assert.ok(covered.has(0) && covered.has(1));
  });

  console.log('\nReading a month that has no cue word in front of it');

  t('a month in front of the event is the date', () => {
    // "Hokitika's March Wildfoods Festival" was tagged November. A scan of all
    // 2,589 descriptions found 336 months written this way and one exception.
    assert.strictEqual(monthTagFromText("Hokitika's March Wildfoods Festival serves whitebait fritters."), 'Mar');
    assert.strictEqual(monthTagFromText('The September Berber tribal festival in the Middle Atlas.'), 'Sep');
    assert.strictEqual(monthTagFromText('The Delta celebrates the November full moon at Tra Vinh.'), 'Nov');
  });
  t("Trinidad's Road March is not a month", () => {
    // The one exception in the library. The word in front of it is neither
    // "the" nor a possessive nor the start of a sentence.
    assert.strictEqual(monthTagFromText('Soca music, Road March competition and the J\'Ouvert parade.'), null);
  });
  t('a short month name in prose is not a month', () => {
    // All seven short forms in the library are the word for sea: Avenida do
    // Mar, Semana del Mar, Viña del Mar. Not one is March.
    assert.deepStrictEqual(monthsNamedIn("Costumes lining the Avenida do Mar.").named, []);
    assert.strictEqual(proposedRetag({ month:'Feb', name:'Carnaval da Madeira',
      description:"Funchal's carnival runs over two weeks along the Avenida do Mar." }), null);
  });

  console.log('\nA start with no finish');

  t('a hyphen after early, mid or late still makes a span', () => {
    // "late November to mid-January" was reading as two unrelated dates,
    // because the gap being tested was " to mid-".
    const { covered } = monthsNamedIn('From late November to mid-January the canals are lit.');
    assert.deepStrictEqual([...covered].sort((a, b) => a - b), [0, 10, 11]);
    assert.strictEqual(monthTagFromText('The late-July to early-August national festival.'), 'Jul-Aug');
  });
  t('a start with no finish cannot take a month away', () => {
    // "Christmas markets from late November" would have narrowed three country
    // records from December to November, losing the month they are known for.
    assert.strictEqual(proposedRetag({ month:'Dec', name:'Krakow Christmas Market',
      description:'Six weeks of wooden stalls fill Rynek Glowny from late November with pierogi.' }), null);
  });
  t('a closed span is still rebuilt', () => {
    assert.strictEqual(monthTagFromText('Late May to mid-June\'s SIFF is the largest film festival.'), 'May-Jun');
  });


  console.log('\nA date written into the front of a description');

  t('a qualified leading date is still a date', () => {
    // 23 Highlights entries reached the app undated because the reader wanted a
    // bare month. "Late October to early November" is the same date with a
    // qualifier on it.
    const [a] = parseEvents(J([{ icon:'sun', title:'Belfast International Arts Festival',
      description:'Late October to early November. Theatre, music and dance across the city.' }]));
    assert.strictEqual(a.month, 'Late October to early November');
    const [b] = parseEvents(J([{ icon:'sun', title:'Feria del Rosario',
      description:"Early October. Fuengirola's biggest fiesta, a week of flamenco." }]));
    assert.strictEqual(b.month, 'Early October');
  });
  t('a bracketed aside after the date does not hide it', () => {
    const [e] = parseEvents(J([{ icon:'sun', title:'Maskanoo',
      description:"26 December (Boxing Day). Providenciales' biggest street festival." }]));
    assert.strictEqual(e.month, '26 December');
  });
  t('a slash joins two halves of a date', () => {
    const [e] = parseEvents(J([{ icon:'sun', title:'Flower Festival',
      description:'Late April / early May. The streets fill with flower carpets.' }]));
    assert.strictEqual(e.month, 'Late April / early May');
  });
  t('prose that merely mentions a month is still not a date', () => {
    const [e] = parseEvents(J([{ icon:'sun', title:'Mating displays',
      description:'Blue-footed booby courtship dances peak May to June on Espanola.' }]));
    assert.strictEqual(e.month, '');
  });

  console.log('\nReading a tag that was never written in the house shape');

  t('a qualifier in front of the month is not the month', () => {
    // 52 tag shapes in the library read as nothing at all, because the first
    // word was taken as the month and the first word was "Late".
    assert.deepStrictEqual(cov('Late October to early November'), ['Oct', 'Nov']);
    assert.deepStrictEqual(cov('Mid-April'), ['Apr']);
    assert.deepStrictEqual(cov('Third Sunday of July'), ['Jul']);
    assert.deepStrictEqual(cov('Full moon in November'), ['Nov']);
  });
  t('a day range does not need a month of its own', () => {
    assert.deepStrictEqual(cov('23 to 25 June'), ['Jun']);
    assert.deepStrictEqual(cov('13-15 April'), ['Apr']);
  });
  t('a hyphen inside Mid-December is not a span', () => {
    assert.deepStrictEqual(cov('Mid-December to February'), ['Jan', 'Feb', 'Dec']);
    assert.deepStrictEqual(cov('June to mid-September'), ['Jun', 'Jul', 'Aug', 'Sep']);
  });
  t('a season with two halves keeps both of them whole', () => {
    // Split on the comma and the hyphen at once and "Jun-Aug, Dec-Feb" loses
    // the July and the January it exists to claim.
    assert.deepStrictEqual(cov('Jun-Aug, Dec-Feb'), ['Jan', 'Feb', 'Jun', 'Jul', 'Aug', 'Dec']);
    assert.deepStrictEqual(cov('Apr-Jun, Sep-Oct'), ['Apr', 'May', 'Jun', 'Sep', 'Oct']);
  });
  t('two separate months stay two separate months', () => {
    // Ibiza's opening and closing parties are May and October, not the summer
    // in between.
    assert.deepStrictEqual(cov('May, Oct'), ['May', 'Oct']);
  });
  t('a tag that is not months at all still reads as nothing', () => {
    assert.strictEqual(tagCovers('Jun-Xyz'), null);
    assert.strictEqual(tagCovers('whenever'), null);
  });

  console.log(`\n  ${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
})();
