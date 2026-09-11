/**
 * The two-source airport fixer.
 *
 * Andy's locked rule is no made-up data and double verification on everything.
 * That makes this file's job adversarial: every test below tries to get a
 * SINGLE-SOURCED or a DISAGREED value written, and every one of them must be
 * refused. A field two sources have not both seen is a hold, never an answer.
 *
 * The fixtures are real values pulled from OurAirports and Wikidata on
 * 11 Sep 2026, including the awkward ones: Heathrow, where Wikidata answers a
 * different question about the city, Munich, where the two name different
 * websites, and Beijing Daxing, where Wikidata returns three rows.
 *
 * Run: node tests/destinations-source.cjs
 */
const assert = require('node:assert');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

let pass = 0, fail = 0;
const pending = [];
function t(name, fn) {
  try {
    const out = fn();
    // An async assertion that is not awaited passes by default, which is worse
    // than no test at all.
    if (out && typeof out.then === 'function') {
      pending.push(out.then(() => { pass++; },
        err => { fail++; console.error(`  FAIL  ${name}\n        ${err.message}`); }));
    } else pass++;
  } catch (err) { fail++; console.error(`  FAIL  ${name}\n        ${err.message}`); }
}

/* Tests that reset and refill the module's own cache cannot be allowed to
   interleave, so they are awaited in order rather than collected. */
async function at(name, fn) {
  try { await fn(); pass++; }
  catch (err) { fail++; console.error(`  FAIL  ${name}\n        ${err.message}`); }
}

const load = f => import(pathToFileURL(path.join(__dirname, '..', 'api', '_lib', 'fill', f)).href);

(async () => {
  const {
    agreedFields, siteHost, wikiKey, reconcileWikidata,
    warmAirports, sourceAirportField, _resetSourceCache, AIRPORT_SOURCED, sparqlFor,
    wikiTitle, mergeWikiAnswer, articleUrl,
  } = await load('_source.js');

  const F = label => ({ label, kind: 'text' });

  /* Real OurAirports rows, 11 Sep 2026. */
  const OA = {
    LHR: { iata: 'LHR', name: 'London Heathrow Airport', city: 'London', country: 'GB',
           lat: 51.470748, lon: -0.459909, site: 'http://www.heathrow.com/',
           wiki: 'https://en.wikipedia.org/wiki/Heathrow_Airport' },
    MUC: { iata: 'MUC', name: 'Munich Airport', city: 'Munich', country: 'DE',
           lat: 48.353802, lon: 11.7861, site: 'https://www.munich-airport.com/',
           wiki: 'https://en.wikipedia.org/wiki/Munich_Airport' },
    INN: { iata: 'INN', name: 'Innsbruck Airport', city: 'Innsbruck', country: 'AT',
           lat: 47.260201, lon: 11.344, site: 'https://www.innsbruck-airport.com/',
           wiki: 'https://en.wikipedia.org/wiki/Innsbruck_Airport' },
  };
  const WD = {
    LHR: { iata: 'LHR', name: 'London Heathrow Airport', city: 'London Borough of Hillingdon',
           countryCode: 'GB', lat: 51.4775, lon: -0.461389, site: 'https://heathrow.com',
           wiki: 'https://en.wikipedia.org/wiki/Heathrow_Airport',
           entity: 'https://www.wikidata.org/wiki/Q8691' },
    MUC: { iata: 'MUC', name: 'Munich Airport', city: 'Munich', countryCode: 'DE',
           lat: 48.353889, lon: 11.786111, site: 'https://www.munich-airport.de',
           wiki: 'https://en.wikipedia.org/wiki/Munich_Airport',
           entity: 'https://www.wikidata.org/wiki/Q131402' },
    INN: { iata: 'INN', name: 'Innsbruck Airport', city: 'Innsbruck', countryCode: 'AT',
           lat: 47.260278, lon: 11.343889, site: 'https://www.innsbruck-airport.com/',
           wiki: 'https://en.wikipedia.org/wiki/Innsbruck_Airport',
           entity: 'https://www.wikidata.org/wiki/Q659372' },
  };

  console.log('\nComparing two sources, field by field');

  t('coordinates both sources agree on are written', () => {
    const { agreed } = agreedFields(OA.LHR, WD.LHR);
    assert.ok(Math.abs(agreed.lat - 51.470748) < 1e-6);
    assert.ok(Math.abs(agreed.lon - -0.459909) < 1e-6);
  });

  t('coordinates a long way apart are refused, with the distance said', () => {
    const far = { ...WD.LHR, lat: 40.6413, lon: -73.7781 };   // JFK's fix on LHR's record
    const { agreed, why } = agreedFields(OA.LHR, far);
    assert.strictEqual(agreed.lat, undefined);
    assert.match(why.lat, /km apart/);
  });

  t('a coordinate only one source has is never written', () => {
    const { agreed, why } = agreedFields(OA.LHR, { ...WD.LHR, lat: undefined, lon: undefined });
    assert.strictEqual(agreed.lat, undefined);
    assert.match(why.lat, /only one source/);
  });

  t('the country is agreed on its code and written as a readable name', () => {
    assert.strictEqual(agreedFields(OA.LHR, WD.LHR).agreed.country, 'United Kingdom');
    assert.strictEqual(agreedFields(OA.MUC, WD.MUC).agreed.country, 'Germany');
  });

  t('countries that disagree leave the field blank', () => {
    const { agreed, why } = agreedFields(OA.LHR, { ...WD.LHR, countryCode: 'IE' });
    assert.strictEqual(agreed.country, undefined);
    assert.match(why.country, /GB against IE/);
  });

  t('the same site written two ways still counts as agreement', () => {
    // OurAirports has http://www.heathrow.com/, Wikidata has https://heathrow.com
    const { agreed } = agreedFields(OA.LHR, WD.LHR);
    assert.strictEqual(agreed.site, 'https://heathrow.com');
  });

  t('two genuinely different sites are a hold, not a coin toss', () => {
    // Munich really is munich-airport.com to one and munich-airport.de to the other
    const { agreed, why } = agreedFields(OA.MUC, WD.MUC);
    assert.strictEqual(agreed.site, undefined, 'must not pick a winner');
    assert.match(why.site, /different sites/);
  });

  t('a website only one source has is never written', () => {
    const { agreed, why } = agreedFields(OA.INN, { ...WD.INN, site: '' });
    assert.strictEqual(agreed.site, undefined);
    assert.match(why.site, /only one source/);
  });

  t('a Wikipedia article both name is written, accents and all', () => {
    const oa = { ...OA.INN, wiki: 'https://en.wikipedia.org/wiki/Manuel_Crescencio_Rej%C3%B3n_International_Airport' };
    const wd = { ...WD.INN, wiki: 'https://en.wikipedia.org/wiki/Manuel_Crescencio_Rejón_International_Airport' };
    assert.ok(agreedFields(oa, wd).agreed.wiki, 'percent-encoding is not a disagreement');
  });

  t('different article titles are a hold, even when one redirects to the other', () => {
    const oa = { ...OA.INN, wiki: 'https://en.wikipedia.org/wiki/Taipei_Songshan_Airport' };
    const wd = { ...WD.INN, wiki: 'https://en.wikipedia.org/wiki/Songshan_Airport' };
    assert.strictEqual(agreedFields(oa, wd).agreed.wiki, undefined);
  });

  t('a city both sources name the same way is written', () => {
    assert.strictEqual(agreedFields(OA.MUC, WD.MUC).agreed.city, 'Munich');
  });

  t('Wikidata answering a different question is not agreement', () => {
    // Heathrow's P131 is the London Borough of Hillingdon, not "London"
    const { agreed, why } = agreedFields(OA.LHR, WD.LHR);
    assert.strictEqual(agreed.city, undefined);
    assert.match(why.city, /disagree/);
  });

  t('a place Wikidata lists several of is ambiguous, so it is left alone', () => {
    const { agreed, why } = agreedFields(OA.LHR, { ...WD.LHR, city: '', ambiguousCity: true });
    assert.strictEqual(agreed.city, undefined);
    assert.match(why.city, /several places/);
  });

  console.log('\nOne title is not one article');

  /* 11 Sep 2026. OurAirports says "Taipei Songshan Airport" and Wikidata says
     "Songshan Airport". Those are the same page, one redirecting to the other,
     and holding them was refusing about one airport in ten over a disagreement
     that did not exist. Resolving the redirect does not lower the bar: two
     sources still have to be pointing at the same article. */

  t('a title is read off the URL, underscores and escapes and all', () => {
    assert.strictEqual(wikiTitle('https://en.wikipedia.org/wiki/Heathrow_Airport'), 'Heathrow Airport');
    assert.strictEqual(
      wikiTitle('https://en.wikipedia.org/wiki/Manuel_Crescencio_Rej%C3%B3n_International_Airport'),
      'Manuel Crescencio Rejón International Airport');
    assert.strictEqual(wikiTitle('https://example.com/wiki/X'), '', 'only Wikipedia');
  });

  t('a redirect is followed to the page it lands on', () => {
    const answer = {
      query: {
        redirects: [{ from: 'Taipei Songshan Airport', to: 'Songshan Airport' }],
        pages: { 322418: { pageid: 322418, title: 'Songshan Airport' } },
      },
    };
    const out = mergeWikiAnswer(answer, ['Taipei Songshan Airport', 'Songshan Airport'], new Map());
    assert.strictEqual(out.get('Taipei Songshan Airport').pageid, 322418);
    assert.strictEqual(out.get('Songshan Airport').pageid, 322418,
      'both titles land on one page, so the two sources agree');
  });

  t('a title normalised and THEN redirected is still followed', () => {
    const answer = {
      query: {
        normalized: [{ from: 'songshan airport', to: 'Songshan airport' }],
        redirects: [{ from: 'Songshan airport', to: 'Songshan Airport' }],
        pages: { 322418: { pageid: 322418, title: 'Songshan Airport' } },
      },
    };
    const out = mergeWikiAnswer(answer, ['songshan airport'], new Map());
    assert.strictEqual(out.get('songshan airport').pageid, 322418);
  });

  t('a title with no article is not resolved to anything', () => {
    const answer = { query: { pages: { '-1': { title: 'No Such Airport Anywhere' } } } };
    const out = mergeWikiAnswer(answer, ['No Such Airport Anywhere'], new Map());
    assert.strictEqual(out.get('No Such Airport Anywhere'), undefined,
      'a missing page is reported as pageid -1 and must not count');
  });

  t('the canonical article URL is built from the page it resolved to', () => {
    assert.strictEqual(articleUrl('Songshan Airport'), 'https://en.wikipedia.org/wiki/Songshan_Airport');
    assert.match(articleUrl('Mérida International Airport'), /M%C3%A9rida_International_Airport$/);
  });

  await at('two titles on one page are written, as the canonical URL', async () => {
    _resetSourceCache();
    const oa = { ...OA.INN, wiki: 'https://en.wikipedia.org/wiki/Taipei_Songshan_Airport' };
    const wd = { ...WD.INN, wiki: 'https://en.wikipedia.org/wiki/Songshan_Airport' };
    await warmAirports(['INN'], {
      cacheGet: async () => null, cacheSet: async () => {},
      ourAirports: async () => ({ reachable: true, map: new Map([['INN', oa]]) }),
      wikidata: async () => ({ reachable: true, map: new Map([['INN', wd]]) }),
      resolveWiki: async () => new Map([
        ['Taipei Songshan Airport', { pageid: 322418, title: 'Songshan Airport' }],
        ['Songshan Airport', { pageid: 322418, title: 'Songshan Airport' }],
      ]),
    });
    const r = sourceAirportField({ field: F('Wikipedia URL'), iata: 'INN' });
    assert.strictEqual(r.ok, true, r.why);
    assert.strictEqual(r.value, 'https://en.wikipedia.org/wiki/Songshan_Airport');
  });

  await at('two titles on two different pages are still held', async () => {
    _resetSourceCache();
    const oa = { ...OA.INN, wiki: 'https://en.wikipedia.org/wiki/Innsbruck_Airport' };
    const wd = { ...WD.INN, wiki: 'https://en.wikipedia.org/wiki/Innsbruck' };
    await warmAirports(['INN'], {
      cacheGet: async () => null, cacheSet: async () => {},
      ourAirports: async () => ({ reachable: true, map: new Map([['INN', oa]]) }),
      wikidata: async () => ({ reachable: true, map: new Map([['INN', wd]]) }),
      resolveWiki: async () => new Map([
        ['Innsbruck Airport', { pageid: 1, title: 'Innsbruck Airport' }],
        ['Innsbruck', { pageid: 2, title: 'Innsbruck' }],
      ]),
    });
    const r = sourceAirportField({ field: F('Wikipedia URL'), iata: 'INN' });
    assert.strictEqual(r.ok, false, 'an airport and its city are two articles, not one');
    assert.match(r.why, /two different articles/);
  });

  await at('a resolver that cannot answer leaves the field held, not guessed', async () => {
    _resetSourceCache();
    const oa = { ...OA.INN, wiki: 'https://en.wikipedia.org/wiki/Taipei_Songshan_Airport' };
    const wd = { ...WD.INN, wiki: 'https://en.wikipedia.org/wiki/Songshan_Airport' };
    await warmAirports(['INN'], {
      cacheGet: async () => null, cacheSet: async () => {},
      ourAirports: async () => ({ reachable: true, map: new Map([['INN', oa]]) }),
      wikidata: async () => ({ reachable: true, map: new Map([['INN', wd]]) }),
      resolveWiki: async () => new Map(),          // Wikipedia did not answer
    });
    const r = sourceAirportField({ field: F('Wikipedia URL'), iata: 'INN' });
    assert.strictEqual(r.ok, false);
    assert.match(r.why, /different articles/);
  });

  console.log('\nURL folding');
  t('a host is compared without www or scheme', () => {
    assert.strictEqual(siteHost('http://www.Heathrow.com/x'), 'heathrow.com');
    assert.strictEqual(siteHost('https://heathrow.com'), 'heathrow.com');
  });
  t('rubbish is not a host', () => {
    assert.strictEqual(siteHost('not a url'), '');
    assert.strictEqual(siteHost(''), '');
  });
  t('a non-Wikipedia link never counts as a Wikipedia article', () => {
    assert.strictEqual(wikiKey('https://example.com/wiki/Heathrow'), '');
    assert.strictEqual(wikiKey('https://en.wikipedia.org.evil.test/wiki/X'), '');
  });
  t('underscores and spaces are the same article', () => {
    assert.strictEqual(
      wikiKey('https://en.wikipedia.org/wiki/Heathrow_Airport'),
      wikiKey('https://en.wikipedia.org/wiki/Heathrow%20Airport'));
  });

  console.log('\nReading Wikidata, which does not answer once per airport');

  t('several rows for one airport collapse to one answer', () => {
    // Beijing Daxing sits across three administrative areas, so P131 returns
    // three rows. Everything else on them is identical.
    const b = (place) => ({
      iata: { value: 'PKX' }, airport: { value: 'http://www.wikidata.org/entity/Q7062090' },
      airportLabel: { value: 'Beijing Daxing International Airport' },
      iso: { value: 'CN' }, placeLabel: { value: place },
      coord: { value: 'Point(116.410556 39.509167)' },
      site: { value: 'https://www.bdia.com.cn/' },
      article: { value: 'https://en.wikipedia.org/wiki/Beijing_Daxing_International_Airport' },
    });
    const out = reconcileWikidata({ results: { bindings: [b('Lixian'), b('Yufa'), b('Jiuzhou')] } }, ['PKX']);
    const wd = out.get('PKX');
    assert.strictEqual(wd.countryCode, 'CN', 'one country across three rows');
    assert.strictEqual(wd.city, '', 'three different places means no answer');
    assert.strictEqual(wd.ambiguousCity, true);
    assert.ok(wd.site, 'the site is the same on every row, so it survives');
    assert.match(wd.entity, /^https:\/\/www\.wikidata\.org\/wiki\/Q7062090$/);
  });

  t('an airport the query did not answer for is simply absent', () => {
    const out = reconcileWikidata({ results: { bindings: [] } }, ['ZZZ']);
    assert.strictEqual(out.get('ZZZ'), undefined);
  });

  console.log('\nEnd to end, with both sources stubbed');

  const CACHE = new Map();
  const deps = {
    cacheGet: async (iata) => CACHE.get(iata) || null,
    cacheSet: async (iata, pair) => { CACHE.set(iata, pair); },
    ourAirports: async (codes) => new Map(codes.filter(c => OA[c]).map(c => [c, OA[c]])),
    wikidata: async (codes) => new Map(codes.filter(c => WD[c]).map(c => [c, WD[c]])),
  };

  _resetSourceCache();
  CACHE.clear();
  await warmAirports(['LHR', 'MUC', 'ZZZ'], deps);

  t('a field both sources agree on comes back with its evidence', () => {
    const r = sourceAirportField({ field: F('Latitude'), iata: 'LHR' });
    assert.strictEqual(r.ok, true);
    assert.ok(Math.abs(r.value - 51.470748) < 1e-6);
    assert.match(r.evidence, /OurAirports and Wikidata agree/);
    assert.match(r.evidence, /LHR/);
  });

  t('a field they disagree on is held, and says what the disagreement was', () => {
    const r = sourceAirportField({ field: F('Official Website'), iata: 'MUC' });
    assert.strictEqual(r.ok, false);
    assert.match(r.why, /different sites/);
  });

  t('an airport neither source knows is held, not guessed', () => {
    const r = sourceAirportField({ field: F('Latitude'), iata: 'ZZZ' });
    assert.strictEqual(r.ok, false);
    assert.match(r.why, /OurAirports|Wikidata/);
  });

  t('a record with no IATA code cannot be verified at all', () => {
    const r = sourceAirportField({ field: F('Latitude'), iata: '' });
    assert.strictEqual(r.ok, false);
    assert.match(r.why, /no IATA code/);
  });

  t('a malformed code is refused rather than sent to the sources', () => {
    ['lhr1', 'LONDON', '12', null, undefined].forEach(bad => {
      assert.strictEqual(sourceAirportField({ field: F('Latitude'), iata: bad }).ok, false, String(bad));
    });
  });

  t('an airport nobody warmed is held rather than silently skipped', () => {
    const r = sourceAirportField({ field: F('Latitude'), iata: 'INN' });
    assert.strictEqual(r.ok, false, 'INN was never warmed in this batch');
    assert.match(r.why, /could not be reached/);
  });

  t('a field with no fixer is refused even for an airport we verified', () => {
    const r = sourceAirportField({ field: F('Terminals & Airlines'), iata: 'LHR' });
    assert.strictEqual(r.ok, false);
    assert.match(r.why, /no two-source fixer/);
  });

  t('the source URLs written are the two that were actually consulted', () => {
    const one = sourceAirportField({ field: F('Source 1 URL'), iata: 'LHR' });
    const two = sourceAirportField({ field: F('Source 2 URL'), iata: 'LHR' });
    assert.match(one.value, /ourairports/i);
    assert.match(two.value, /wikidata\.org/);
    assert.notStrictEqual(one.value, two.value, 'two sources means two different sources');
  });

  t('the verified date is the day it was actually checked', () => {
    const r = sourceAirportField({ field: F('Verified Date'), iata: 'LHR', nowIso: '2026-09-11T10:00:00.000Z' });
    assert.strictEqual(r.value, '2026-09-11');
  });

  t('a stamp is never written for an airport that failed verification', () => {
    ['Source 1 URL', 'Source 2 URL', 'Verified Date'].forEach(l => {
      assert.strictEqual(sourceAirportField({ field: F(l), iata: 'ZZZ' }).ok, false,
        l + ' must not claim a verification that did not happen');
    });
  });

  /* 11 Sep 2026. An edit deleted the query builder, wikidata() caught the
     ReferenceError, and forty airports Wikidata knows perfectly well were
     reported as "Wikidata does not have this code". warmAirports would then
     have cached that lie for thirty days. Unreachable is not the same answer
     as unknown, and it is never cached. */

  await at('a source that fails is reported as unreachable, not as having no record', async () => {
    _resetSourceCache();
    const store = new Map();
    await warmAirports(['LHR'], {
      cacheGet: async () => null,
      cacheSet: async (i, p) => { store.set(i, p); },
      ourAirports: async (c) => ({ reachable: true, map: new Map(c.map(x => [x, OA[x]])) }),
      wikidata: async () => ({ reachable: false, reason: 'Wikidata could not be reached: boom', map: new Map() }),
    });
    const r = sourceAirportField({ field: F('Latitude'), iata: 'LHR' });
    assert.strictEqual(r.ok, false);
    assert.match(r.why, /could not be reached/, 'must not claim the source has no record');
    assert.strictEqual(store.size, 0, 'a transient failure must never be cached');
  });

  await at('an unreachable dataset does not poison the other source either', async () => {
    _resetSourceCache();
    const store = new Map();
    await warmAirports(['LHR'], {
      cacheGet: async () => null,
      cacheSet: async (i, p) => { store.set(i, p); },
      ourAirports: async () => ({ reachable: false, reason: 'the OurAirports dataset could not be downloaded', map: new Map() }),
      wikidata: async (c) => ({ reachable: true, map: new Map(c.map(x => [x, WD[x]])) }),
    });
    assert.strictEqual(store.size, 0);
    assert.match(sourceAirportField({ field: F('Latitude'), iata: 'LHR' }).why, /could not be downloaded/);
  });

  t('a query is built only from codes that look like codes', () => {
    const q = sparqlFor(['LHR', 'lhr', 'nonsense', '', null, 'IN N']);
    assert.match(q, /VALUES \?iata \{ "LHR" "LHR" "INN" \}/,
      'anything that is not three letters after cleaning is dropped: ' + q.slice(0, 120));
    assert.ok(!/nonsense/i.test(q));
  });

  await at('a second warm costs no network, because the pair was cached', async () => {
    let calls = 0;
    const counting = { ...deps, ourAirports: async (c) => { calls++; return new Map(c.filter(x => OA[x]).map(x => [x, OA[x]])); } };
    _resetSourceCache();
    await warmAirports(['LHR'], counting);
    assert.strictEqual(calls, 0, 'the cached pair should have answered it');
  });

  console.log('\nThe map of what is covered');
  t('every sourced field is one the airports table actually has', async () => {
    const cov = await import(pathToFileURL(
      path.join(__dirname, '..', 'api', '_lib', 'destination-coverage.js')).href);
    const air = cov.TYPES.find(x => x.key === 'airport');
    const labels = new Set(air.fields.map(f => f.label));
    Object.keys(AIRPORT_SOURCED).forEach(l => {
      assert.ok(labels.has(l), l + ' is claimed as sourced but is not a field on the airports table');
    });
  });

  await Promise.all(pending);
  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
})();
