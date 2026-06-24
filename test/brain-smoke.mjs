/**
 * Luna Brain smoke tests — pure-logic assertions that run offline (no network,
 * no env). Covers the security- and correctness-critical paths that decide
 * whether a fact is trusted, deduped, fetched, or matched.
 *
 *   node test/brain-smoke.mjs
 *
 * Exits non-zero on any failure so it can gate CI / a SessionStart hook.
 * The live HTTP + Airtable + Anthropic paths cannot run here; those are
 * validated separately against a deploy.
 */

import { decide } from '../api/brain/_gate.js';
import { similarity, tokens } from '../api/brain/_text.js';
import { safeUrl, htmlToText } from '../api/_lib/webfetch.js';
import { matchEntities, formatContext, shapeMatches } from '../api/reference/_index.js';

let pass = 0, fail = 0;
const fails = [];
function ok(name, cond) { if (cond) { pass++; } else { fail++; fails.push(name); console.error('  ✗ ' + name); } }
function eq(name, a, b) { ok(name + ` (got ${JSON.stringify(a)})`, a === b); }

// ---------------------------------------------------------------- decide()
console.log('gate.decide');
{
  const A_ok = { hasCheckableClaims: true, supported: true };
  const A_soft = { hasCheckableClaims: false, supported: false };
  const A_bad = { hasCheckableClaims: true, supported: false, reasoning: 'x' };
  const B_low = { pass: true, contradiction: false, risk: 'low' };
  const B_high = { pass: true, contradiction: false, risk: 'high' };
  const B_fail = { pass: false, contradiction: false, risk: 'low', reasons: 'x' };
  const B_contra = { pass: true, contradiction: true, risk: 'low' };

  eq('both pass + low risk -> publish', decide(A_ok, B_low).outcome, 'publish');
  eq('both pass + low risk -> no spotcheck', decide(A_ok, B_low).spotCheck, false);
  eq('both pass + high risk -> publish', decide(A_ok, B_high).outcome, 'publish');
  eq('both pass + high risk -> spotcheck', decide(A_ok, B_high).spotCheck, true);
  eq('soft claims (no grounding needed) + pass -> publish', decide(A_soft, B_low).outcome, 'publish');
  eq('unsupported checkable claim -> escalate', decide(A_bad, B_low).outcome, 'escalate');
  eq('adversarial fail -> escalate', decide(A_ok, B_fail).outcome, 'escalate');
  eq('contradiction -> escalate', decide(A_ok, B_contra).outcome, 'escalate');
}

// ---------------------------------------------------------------- safeUrl (SSRF)
console.log('webfetch.safeUrl (SSRF guard)');
{
  const allow = ['https://www.dublinairport.com', 'http://example.com/x', 'https://en.wikipedia.org/wiki/Dublin_Airport'];
  const block = [
    'http://localhost/x', 'http://127.0.0.1/', 'http://169.254.169.254/latest/meta-data',
    'http://metadata.google.internal/', 'https://10.0.0.5', 'http://192.168.1.1',
    'http://172.16.0.1', 'http://172.31.255.255', 'ftp://example.com', 'file:///etc/passwd',
    'javascript:alert(1)', 'http://service.internal/', 'http://[::1]/', 'not a url',
  ];
  for (const u of allow) ok('allow ' + u, !!safeUrl(u));
  for (const u of block) ok('block ' + u, safeUrl(u) === null);
  // 172.32 is public (outside 16-31 range)
  ok('allow http://172.32.0.1 (public)', !!safeUrl('http://172.32.0.1'));
}

// ---------------------------------------------------------------- htmlToText
console.log('webfetch.htmlToText');
{
  eq('strips tags + script', htmlToText('<p>Hi <b>there</b></p><script>bad()</script>'), 'Hi there');
  eq('decodes entities', htmlToText('Tom &amp; Jerry &lt;3'), 'Tom & Jerry <3');
  eq('collapses whitespace', htmlToText('a\n\n   b\t c'), 'a b c');
}

// ---------------------------------------------------------------- similarity
console.log('text.similarity (dedupe)');
{
  ok('identical -> 1', similarity('cancellation policy details', 'cancellation policy details') === 1);
  ok('disjoint -> 0', similarity('opening hours', 'pet friendly dogs') === 0);
  ok('near-paraphrase high', similarity("What is your cancellation policy", "What's the cancellation policy") >= 0.5);
  ok('different topics low', similarity('do you sell travel insurance', 'can I bring my dog') < 0.3);
  ok('empty -> 0', similarity('', 'anything') === 0);
  ok('tokens drops short words', !tokens('a to be or').has('to') && tokens('cancellation').has('cancellation'));
}

// ---------------------------------------------------------------- reference matcher
console.log('reference.matchEntities + format');
{
  const C = { name: 'flddJJrpwcXOwWIow', visaStatus: 'fldmKvRkDDRjj7PT2', currency: 'fldoe2LemU2kZS3EP' };
  const A = { name: 'fldlT6eApAdQHGYED', iata: 'fldcS9uu4NWMVaIVP', cityServed: 'fldgrJ2uFjzPcAxUx', countryText: 'fldjARk52dZi7TGGc', distance: 'fldk6vN66c33umyEP' };
  const mkC = (n, x) => ({ id: 'c_' + n, fields: { [C.name]: n, ...x } });
  const mkA = (n, i, city, x) => ({ id: 'a_' + i, fields: { [A.name]: n, [A.iata]: i, [A.cityServed]: city, ...x } });
  const index = {
    countryByName: new Map([
      ['thailand', mkC('Thailand', { [C.visaStatus]: { name: 'Not required' }, [C.currency]: 'Thai Baht' })],
      ['uae', mkC('UAE', {})], ['greece', mkC('Greece', {})], ['usa', mkC('USA', {})],
    ]),
    airportByIata: new Map([['DLM', mkA('Dalaman', 'DLM', 'Dalaman', { [A.distance]: '6km' })], ['LHR', mkA('London Heathrow', 'LHR', 'London')]]),
    airportByCity: new Map([['dalaman', mkA('Dalaman', 'DLM', 'Dalaman', {})], ['london', mkA('London Heathrow', 'LHR', 'London')]]),
  };
  const m1 = matchEntities(index, 'Do I need a visa for Thailand?');
  ok('visa Thailand -> country', m1.countries.length === 1 && m1.countries[0].fields[C.name] === 'Thailand');
  ok('visa Thailand -> no airport', m1.airports.length === 0);
  const m2 = matchEntities(index, 'How do I get from DLM to my hotel?');
  ok('DLM -> airport', m2.airports.length === 1 && m2.airports[0].fields[A.iata] === 'DLM');
  ok('flights to Dalaman -> airport by city', matchEntities(index, 'cheap flights to Dalaman').airports.length === 1);
  ok('Dubai alias -> UAE', matchEntities(index, 'a trip to Dubai').countries.some(c => c.fields[C.name] === 'UAE'));
  ok('no false positive on prose', matchEntities(index, 'the cat sat on the mat').countries.length === 0 && matchEntities(index, 'the cat sat on the mat').airports.length === 0);
  ok('multiple countries', matchEntities(index, 'visa for the USA and Greece').countries.length === 2);
  const ctx = formatContext(m1);
  ok('context labels trusted', ctx.includes('VERIFIED TRAVEL REFERENCE') && ctx.includes('Thailand'));
  ok('empty match -> empty context', formatContext({ countries: [], airports: [] }) === '');
  const shaped = shapeMatches(m1);
  ok('shape has visaStatusUK', shaped.countries[0].visaStatusUK === 'Not required');
}

// ---------------------------------------------------------------- summary
console.log(`\n${pass} passed, ${fail} failed`);
if (fail) { console.error('FAILURES:\n  ' + fails.join('\n  ')); process.exit(1); }
console.log('All Luna Brain smoke tests passed.');
