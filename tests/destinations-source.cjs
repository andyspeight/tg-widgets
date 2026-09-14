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
    agreedFields, siteHost, wikiKey, reconcileWikidata, localSiteFromWikitext, sameSite,
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
    assert.match(why.country, /United Kingdom.*Ireland/);
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

  t('two different titles are not agreement on their own, but are worth resolving', () => {
    // agreedFields cannot know that one redirects to the other, so it holds and
    // hands the pair on. warmAirports asks Wikipedia and may then agree.
    const oa = { ...OA.INN, wiki: 'https://en.wikipedia.org/wiki/Taipei_Songshan_Airport' };
    const wd = { ...WD.INN, wiki: 'https://en.wikipedia.org/wiki/Songshan_Airport' };
    const r = agreedFields(oa, wd);
    assert.strictEqual(r.agreed.wiki, undefined, 'not agreed yet');
    assert.deepStrictEqual(r.pending.wiki, ['Taipei Songshan Airport', 'Songshan Airport'],
      'and handed on to be resolved rather than dropped');
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
    // No article text. Without this the tie-break reaches the live Wikipedia
    // API, and a test suite that touches the network is not a test suite.
    resolveArticles: async () => new Map(),
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

  /* ---------------------------------------------------------------- */
  console.log('\nTerritories, and airports that share a code');

  // Ten airports were held on 14 Sep 2026 saying "they disagree: TC against
  // GB". Neither source was wrong. OurAirports records the ISO territory an
  // airport sits in, Wikidata's P17 records the sovereign state, and both are
  // true of Providenciales. Checked against the live sources on the day.
  const terr = (oaCc, sovereign, chain) => ({
    ...WD.LHR, countryCode: sovereign, isoCodes: new Set([sovereign, ...chain]),
  });

  t('a dependent territory is not a disagreement', () => {
    const cases = [
      ['TC', 'GB', 'Turks and Caicos Islands'],
      ['VG', 'GB', 'British Virgin Islands'],
      ['PR', 'US', 'Puerto Rico'],
      ['GU', 'US', 'Guam'],
      ['GP', 'FR', 'Guadeloupe'],
      ['MO', 'CN', 'Macau'],
      ['PF', 'FR', 'French Polynesia'],
    ];
    for (const [code, sovereign, name] of cases) {
      const { agreed } = agreedFields({ ...OA.LHR, country: code },
        terr(code, sovereign, [code]));
      assert.strictEqual(agreed.country, name,
        code + ' inside ' + sovereign + ' should agree, and read as ' + name);
    }
  });

  t('the territory has to be one Wikidata actually places it in', () => {
    // Not "anything under the same flag". Wikidata never says this airport is
    // in Bermuda, so nothing is written.
    const { agreed, why } = agreedFields({ ...OA.LHR, country: 'BM' },
      terr('BM', 'GB', ['TC']));
    assert.strictEqual(agreed.country, undefined);
    assert.match(why.country, /Bermuda.*Turks and Caicos/);
  });

  t('two sources naming genuinely different countries are still held', () => {
    const { agreed, why } = agreedFields(OA.LHR,
      { ...WD.LHR, countryCode: 'IE', isoCodes: new Set(['IE']) });
    assert.strictEqual(agreed.country, undefined);
    assert.match(why.country, /United Kingdom.*Ireland/);
  });

  t('an airport with no territory above it is unchanged', () => {
    assert.strictEqual(agreedFields(OA.LHR, WD.LHR).agreed.country, 'United Kingdom');
    assert.strictEqual(agreedFields(OA.MUC, WD.MUC).agreed.country, 'Germany');
  });

  t('names are written the way the table already writes them', () => {
    const name = cc => agreedFields({ ...OA.LHR, country: cc },
      terr(cc, cc, [cc])).agreed.country;
    assert.strictEqual(name('US'), 'USA');            // not United States
    assert.strictEqual(name('AE'), 'UAE');            // not United Arab Emirates
    assert.strictEqual(name('HK'), 'Hong Kong');      // not Hong Kong SAR China
    assert.strictEqual(name('AG'), 'Antigua and Barbuda');  // not an ampersand
    assert.strictEqual(name('LC'), 'St Lucia');       // UK English drops the stop
    assert.strictEqual(name('VI'), 'US Virgin Islands');
  });

  t('the query asks Wikidata which territory it places the airport in', () => {
    const q = sparqlFor(['PLS']);
    assert.match(q, /P131\*/, 'without the chain only the sovereign state comes back');
    assert.match(q, /\?terr/);
  });

  // Faa'a: PPT is on both the civil airport and the airbase half a kilometre
  // away, so two entities carry the code and every field was being discarded as
  // ambiguous.
  const binding = (iata, entity, coord, iso) => ({
    iata: { value: iata }, airport: { value: entity },
    coord: { value: coord }, iso: { value: iso },
  });
  const results = rows => ({ results: { bindings: rows } });

  t('one airport recorded twice at the same spot is one place', () => {
    const m = reconcileWikidata(results([
      binding('PPT', 'http://www.wikidata.org/entity/Q1049719', 'Point(-149.611388 -17.556666)', 'FR'),
      binding('PPT', 'http://www.wikidata.org/entity/Q2886489', 'Point(-149.607 -17.5532)', 'FR'),
    ]), ['PPT']);
    const wd = m.get('PPT');
    assert.ok(Number.isFinite(wd.lat), 'half a kilometre apart is the same airport');
    assert.ok(Math.abs(wd.lat + 17.55) < 0.1);
  });

  t('two airports genuinely far apart stay ambiguous', () => {
    const m = reconcileWikidata(results([
      binding('XXX', 'http://www.wikidata.org/entity/Q1', 'Point(0 51)', 'GB'),
      binding('XXX', 'http://www.wikidata.org/entity/Q2', 'Point(10 45)', 'FR'),
    ]), ['XXX']);
    assert.ok(!Number.isFinite(m.get('XXX').lat),
      'a real code clash must not be resolved by picking one');
  });

  t('every ISO code Wikidata places it in is carried through', () => {
    const m = reconcileWikidata(results([
      { iata: { value: 'PLS' }, iso: { value: 'GB' }, terr: { value: 'TC' } },
      { iata: { value: 'PLS' }, iso: { value: 'GB' }, terr: { value: 'GB' } },
    ]), ['PLS']);
    const wd = m.get('PLS');
    assert.strictEqual(wd.countryCode, 'GB');
    assert.deepStrictEqual([...wd.isoCodes].sort(), ['GB', 'TC']);
  });

  /* ---------------------------------------------------------------- */
  console.log('\nThe third opinion, when two sources name different sites');

  const ARTICLE = 'https://en.wikipedia.org/wiki/Munich_Airport';
  const clash = (wikitext) => ({
    cacheGet: async () => null, cacheSet: async () => {},
    ourAirports: async () => ({ reachable: true, map: new Map([['MUC', OA.MUC]]) }),
    wikidata: async () => ({ reachable: true, map: new Map([['MUC', WD.MUC]]) }),
    resolveArticles: async () => new Map([['Munich Airport', wikitext]]),
  });

  await at('the article backing one of the two settles it, two to one', async () => {
    _resetSourceCache();
    await warmAirports(['MUC'], clash('| website = {{URL|www.munich-airport.de}}'));
    const r = sourceAirportField({ field: F('Official Website'), iata: 'MUC' });
    assert.strictEqual(r.ok, true, r.why);
    assert.match(r.value, /munich-airport\.de/);
    assert.match(r.evidence, /settles it two to one/);
    assert.match(r.evidence, /Munich_Airport/, 'the third source has to be named');
  });

  await at('it can back OurAirports just as readily', async () => {
    _resetSourceCache();
    await warmAirports(['MUC'], clash('| website = [https://www.munich-airport.com/ Munich]'));
    const r = sourceAirportField({ field: F('Official Website'), iata: 'MUC' });
    assert.strictEqual(r.ok, true, r.why);
    assert.match(r.value, /munich-airport\.com/);
  });

  /* THE ONE THAT MATTERS. {{Official URL}} reads the value out of Wikidata, so
     taking it would be Wikidata agreeing with itself and a single-sourced value
     written into a column that promises two. */
  await at('an article that takes its website from Wikidata is refused', async () => {
    _resetSourceCache();
    await warmAirports(['MUC'], clash('| website = {{Official URL}}'));
    const r = sourceAirportField({ field: F('Official Website'), iata: 'MUC' });
    assert.strictEqual(r.ok, false, 'Wikidata agreeing with Wikidata is not two sources');
    assert.match(r.why, /from Wikidata/);
  });

  await at('three different answers settle nothing', async () => {
    _resetSourceCache();
    await warmAirports(['MUC'], clash('| website = {{URL|www.somewhere-else.de}}'));
    const r = sourceAirportField({ field: F('Official Website'), iata: 'MUC' });
    assert.strictEqual(r.ok, false);
    assert.match(r.why, /all three sources name a different site/);
  });

  await at('an article with no website leaves it held, and says so', async () => {
    _resetSourceCache();
    await warmAirports(['MUC'], clash('| website =\n| iata = MUC'));
    const r = sourceAirportField({ field: F('Official Website'), iata: 'MUC' });
    assert.strictEqual(r.ok, false);
    assert.match(r.why, /lists no website/);
  });

  await at('breaking the site tie does not disturb the other fields', async () => {
    _resetSourceCache();
    await warmAirports(['MUC'], clash('| website = {{URL|www.munich-airport.de}}'));
    const lat = sourceAirportField({ field: F('Latitude'), iata: 'MUC' });
    assert.strictEqual(lat.ok, true, lat.why);
    assert.match(lat.evidence, /OurAirports and Wikidata agree/,
      'a field the first two agreed on must not be relabelled as a tie-break');
  });

  t('a website written into the article is read, however it is wrapped', () => {
    const cases = [
      ['| website = {{URL|www.x.com}}', 'https://www.x.com'],
      ['| website = {{URL|url=http://x.com/a}}', 'http://x.com/a'],
      ['| website = {{Official website |url=http://x.com/a |name=X}}', 'http://x.com/a'],
      ['| website = [https://x.com/a X]', 'https://x.com/a'],
      ['| website = https://x.com/a', 'https://x.com/a'],
    ];
    for (const [wt, want] of cases) {
      assert.strictEqual(localSiteFromWikitext(wt).url, want, wt);
    }
  });

  t('anything that resolves from Wikidata reads as no third opinion', () => {
    ['{{Official URL}}', '{{Official website}}', '{{URL}}'].forEach(v => {
      const out = localSiteFromWikitext('| website = ' + v);
      assert.strictEqual(out.url, '', v + ' comes from Wikidata');
      assert.match(out.why, /from Wikidata/);
    });
  });

  t('a site sitting under another is the same site, and unrelated ones are not', () => {
    assert.ok(sameSite('bari.airports.aeroportidipuglia.it', 'aeroportidipuglia.it'));
    assert.ok(sameSite('x.com', 'x.com'));
    assert.ok(!sameSite('rac.co.rw', 'kenyaairports.co.ke'),
      'two country-code domains must never be folded together');
    assert.ok(!sameSite('swedavia.se', 'swedavia.com'));
    assert.ok(!sameSite('', 'x.com'));
  });

  await Promise.all(pending);
  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
})();
