/**
 * Duda GEO builders — offline smoke tests (no network, no env).
 *
 *   node test/duda-geo-smoke.mjs
 *
 * Covers the security-critical paths: injection safety of the JSON-LD block,
 * URL/country/phone/email validation, SearchAction drop, empty-field omission,
 * and llms.txt / site_seo shape. Exits non-zero on any failure so it can gate
 * CI or a SessionStart hook.
 */

import {
  sanitiseText, validUrl, validCountry, validPhone, validEmail, validSameAs,
  validSearchTemplate, normaliseBusiness, buildStructuredData, escapeForScript,
  renderJsonLdScript, buildSiteSeo, buildLlmsTxt, buildContentUpdate, buildAssets,
} from '../api/_lib/duda/geo.js';

let pass = 0, fail = 0;
const fails = [];
function ok(name, cond) { if (cond) pass++; else { fail++; fails.push(name); console.error('  ✗ ' + name); } }
function eq(name, a, b) { ok(name + ` (got ${JSON.stringify(a)})`, a === b); }

const demo = {
  name: 'Traveldemo Holidays',
  url: 'https://www.traveldemo.site/',
  logo: 'https://www.traveldemo.site/logo.png',
  image: 'https://www.traveldemo.site/og.jpg',
  description: 'Luxury travel to Dubai and the Maldives, with trade prices and ATOL protection.',
  telephone: '+44 20 1234 5678',
  email: 'hello@traveldemo.site',
  address: { streetAddress: '1 High St', addressLocality: 'London', postalCode: 'W1 1AA', addressCountry: 'gb' },
  sameAs: ['https://facebook.com/traveldemo', 'https://instagram.com/traveldemo'],
  searchUrlTemplate: 'https://www.traveldemo.site/search?q={search_term_string}',
};

// ---------------------------------------------------------------- validators
console.log('validators');
eq('validUrl accepts https', validUrl('https://x.com/'), 'https://x.com/');
eq('validUrl rejects javascript:', validUrl('javascript:alert(1)'), '');
eq('validUrl rejects data:', validUrl('data:text/html,x'), '');
eq('validUrl rejects relative', validUrl('/foo'), '');
eq('validUrl rejects garbage', validUrl('not a url'), '');
eq('validCountry upcases 2-letter', validCountry('gb'), 'GB');
eq('validCountry rejects long', validCountry('GBR'), '');
eq('validPhone keeps plausible', validPhone('+44 20 1234 5678'), '+44 20 1234 5678');
eq('validPhone rejects tiny', validPhone('12'), '');
eq('validPhone strips letters', validPhone('call 020-1234-5678 now'), '020-1234-5678');
eq('validEmail accepts', validEmail('a@b.co'), 'a@b.co');
eq('validEmail rejects', validEmail('nope'), '');
eq('validSameAs dedupes + validates', JSON.stringify(validSameAs(['https://a.com/', 'https://a.com/', 'javascript:1'])), JSON.stringify(['https://a.com/']));
eq('validSearchTemplate needs placeholder', validSearchTemplate('https://x.com/search'), '');
eq('validSearchTemplate accepts placeholder', validSearchTemplate('https://x.com/s?q={search_term_string}'), 'https://x.com/s?q={search_term_string}');

// ---------------------------------------------------------------- sanitiseText
console.log('sanitiseText');
eq('trims + collapses', sanitiseText('  a   b  '), 'a b');
eq('clamps length', sanitiseText('x'.repeat(1000), 10).length, 10);
eq('non-string -> empty', sanitiseText(null), '');
ok('strips control chars', sanitiseText('a' + String.fromCodePoint(0) + String.fromCodePoint(7) + 'b') === 'a b' || sanitiseText('a' + String.fromCodePoint(0) + 'b').indexOf(String.fromCodePoint(0)) === -1);
ok('strips U+2028/2029', sanitiseText('a' + String.fromCodePoint(0x2028) + 'b' + String.fromCodePoint(0x2029) + 'c').indexOf(String.fromCodePoint(0x2028)) === -1);

// ---------------------------------------------------------------- normalise
console.log('normaliseBusiness');
ok('throws without name', (() => { try { normaliseBusiness({ url: 'https://x.com' }); return false; } catch { return true; } })());
ok('throws without valid url', (() => { try { normaliseBusiness({ name: 'X', url: 'nope' }); return false; } catch { return true; } })());
{
  const b = normaliseBusiness(demo);
  eq('country normalised', b.address.addressCountry, 'GB');
  eq('orgType default TravelAgency', b.orgType, 'TravelAgency');
  eq('inLanguage default', b.inLanguage, 'en-GB');
}

// ---------------------------------------------------------------- structured data
console.log('buildStructuredData');
{
  const data = buildStructuredData(demo);
  eq('graph has 2 nodes', data['@graph'].length, 2);
  const [org, site] = data['@graph'];
  eq('org type', org['@type'], 'TravelAgency');
  eq('org @id stable', org['@id'], 'https://www.traveldemo.site/#org');
  eq('org has PostalAddress', org.address['@type'], 'PostalAddress');
  eq('org address country', org.address.addressCountry, 'GB');
  eq('website publisher links org', site.publisher['@id'], 'https://www.traveldemo.site/#org');
  eq('website has SearchAction', site.potentialAction['@type'], 'SearchAction');
}
{
  // No search route -> potentialAction dropped.
  const noSearch = { ...demo, searchUrlTemplate: undefined };
  const site = buildStructuredData(noSearch)['@graph'][1];
  ok('SearchAction dropped when no search route', !site.potentialAction);
}
{
  // Empty optional fields must be omitted, not emitted as "".
  const minimal = buildStructuredData({ name: 'X', url: 'https://x.com/' });
  const org = minimal['@graph'][0];
  ok('no empty logo key', !('logo' in org));
  ok('no empty address key', !('address' in org));
  ok('no empty sameAs key', !('sameAs' in org));
}

// ---------------------------------------------------------------- injection safety
console.log('injection safety');
{
  // Business name attempting to break out of the <script> block.
  const evil = {
    name: 'Acme</script><script>alert(1)</script>',
    url: 'https://x.com/',
    description: 'break & out <!-- comment -->' + String.fromCodePoint(0x2028) + String.fromCodePoint(0x2029) + 'line',
  };
  const block = renderJsonLdScript(evil);
  // The only literal </script> must be the closing tag at the very end.
  const closes = block.match(/<\/script>/gi) || [];
  eq('exactly one literal </script>', closes.length, 1);
  ok('no raw <script> reopened inside', !/<script[^>]*>[\s\S]*<script/i.test(block.replace(/^<script[^>]*>/, '')));
  ok('angle brackets escaped in payload', block.includes('\\u003c') && block.includes('\\u003e'));
  ok('ampersand escaped', block.includes('\\u0026'));
  ok('no raw <!-- in payload body', !block.slice(block.indexOf('>') + 1).includes('<!--'));
  // Still valid JSON once we peel off the wrapper.
  const inner = block.replace(/^<script[^>]*>\n/, '').replace(/\n<\/script>$/, '');
  let reparsed;
  ok('escaped payload re-parses as JSON', (() => { try { reparsed = JSON.parse(inner); return true; } catch { return false; } })());
  ok('evil name preserved as data (not markup)', reparsed && JSON.stringify(reparsed).includes('Acme'));
}
{
  eq('escapeForScript neutralises all closers', escapeForScript('</script><!--&' + String.fromCodePoint(0x2028) + String.fromCodePoint(0x2029)),
     '\\u003c/script\\u003e\\u003c!--\\u0026\\u2028\\u2029');
}

// ---------------------------------------------------------------- site_seo
console.log('buildSiteSeo');
{
  const seo = buildSiteSeo(demo);
  eq('no_index false', seo.no_index, false);
  eq('title from name', seo.title, 'Traveldemo Holidays');
  eq('og_image prefers image', seo.og_image, 'https://www.traveldemo.site/og.jpg');
}

// ---------------------------------------------------------------- llms.txt
console.log('buildLlmsTxt');
{
  const txt = buildLlmsTxt({
    business: demo,
    pages: [
      { url: 'https://www.traveldemo.site/dubai', title: 'Dubai', description: 'Dubai holidays' },
      { url: 'javascript:1', title: 'Bad', description: 'dropped' },
      { url: 'https://www.traveldemo.site/maldives', title: 'Maldives' },
    ],
  });
  ok('has H1 name', txt.startsWith('# Traveldemo Holidays'));
  ok('has blockquote summary', txt.includes('> Luxury travel'));
  ok('lists valid page', txt.includes('[Dubai](https://www.traveldemo.site/dubai): Dubai holidays'));
  ok('drops invalid page', !txt.includes('Bad'));
  ok('page without desc still listed', txt.includes('[Maldives](https://www.traveldemo.site/maldives)'));
  ok('has contact phone', txt.includes('- Phone: +44 20 1234 5678'));
  ok('ends with single newline', txt.endsWith('\n') && !txt.endsWith('\n\n'));
}

// ---------------------------------------------------------------- content update
console.log('buildContentUpdate');
{
  const c = buildContentUpdate(demo);
  eq('phone in location_data', c.location_data.phones[0].phoneNumber, '+44 20 1234 5678');
  eq('city mapped', c.location_data.address_geolocation.city, 'London');
  eq('business name', c.business_data.name, 'Traveldemo Holidays');
  eq('logo mapped', c.business_data.logo_url, 'https://www.traveldemo.site/logo.png');
}
{
  // Partial profile must not emit empty containers.
  const c = buildContentUpdate({ name: 'X', url: 'https://x.com/' });
  ok('no location_data when nothing to set', !('location_data' in c));
}

// ---------------------------------------------------------------- buildAssets
console.log('buildAssets');
{
  const a = buildAssets(demo, [{ url: 'https://www.traveldemo.site/dubai', title: 'Dubai' }]);
  ok('has jsonLdScript', a.jsonLdScript.startsWith('<script type="application/ld+json">'));
  ok('has siteSeo', a.siteSeo.no_index === false);
  ok('has llmsTxt', a.llmsTxt.includes('# Traveldemo Holidays'));
  ok('has contentUpdate', !!a.contentUpdate.business_data);
}

// ---------------------------------------------------------------- summary
console.log(`\nDuda GEO smoke: ${pass} passed, ${fail} failed`);
if (fail) { console.error('FAILURES:\n  ' + fails.join('\n  ')); process.exit(1); }
process.exit(0);
