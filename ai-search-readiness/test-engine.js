'use strict';

/**
 * test-engine.js — the suite that has to be green before anything ships.
 *
 * Run:  node test-engine.js
 *       node test-engine.js --live     (adds the three benchmark scans)
 *
 * The SSRF section is the important one. It runs first and it runs offline,
 * so a broken network cannot hide a broken guard.
 */

const net = require('./lib/net');
const access = require('./lib/access');
const onpage = require('./lib/onpage');
const score = require('./lib/score');
const ratelimit = require('./lib/ratelimit');

let passed = 0;
let failed = 0;
const failures = [];

function group(name) {
  process.stdout.write(`\n${name}\n${'-'.repeat(name.length)}\n`);
}

function ok(name, condition, detail) {
  if (condition) {
    passed += 1;
    process.stdout.write(`  pass  ${name}\n`);
  } else {
    failed += 1;
    failures.push(name + (detail ? ` — ${detail}` : ''));
    process.stdout.write(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}\n`);
  }
}

function eq(name, actual, expected) {
  ok(name, actual === expected, `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

async function throwsWith(name, fn, code) {
  try {
    await fn();
    ok(name, false, `expected ${code}, nothing thrown`);
  } catch (err) {
    ok(name, err && err.code === code, `expected ${code}, got ${err && (err.code || err.message)}`);
  }
}

/* ================================================================== *
 * 1. SSRF guard — IP classification
 * ================================================================== */

group('SSRF: IP classification');

const mustBlock = [
  ['127.0.0.1', 'loopback'],
  ['127.1.1.1', 'loopback range'],
  ['0.0.0.0', 'this network'],
  ['10.0.0.1', 'private 10/8'],
  ['10.255.255.254', 'private 10/8 upper'],
  ['172.16.0.1', 'private 172.16/12'],
  ['172.31.255.254', 'private 172.16/12 upper'],
  ['192.168.1.1', 'private 192.168/16'],
  ['169.254.169.254', 'cloud metadata'],
  ['169.254.0.1', 'link-local'],
  ['100.64.0.1', 'carrier-grade NAT'],
  ['192.0.2.1', 'TEST-NET-1'],
  ['198.51.100.1', 'TEST-NET-2'],
  ['203.0.113.1', 'TEST-NET-3'],
  ['198.18.0.1', 'benchmarking'],
  ['224.0.0.1', 'multicast'],
  ['240.0.0.1', 'reserved'],
  ['255.255.255.255', 'broadcast'],
  ['::1', 'IPv6 loopback'],
  ['::', 'IPv6 unspecified'],
  ['fc00::1', 'IPv6 unique local'],
  ['fd12:3456:789a::1', 'IPv6 unique local fd'],
  ['fe80::1', 'IPv6 link-local'],
  ['fe80::dead:beef', 'IPv6 link-local long'],
  ['ff02::1', 'IPv6 multicast'],
  ['::ffff:127.0.0.1', 'IPv4-mapped loopback'],
  ['::ffff:169.254.169.254', 'IPv4-mapped metadata'],
  ['::ffff:10.0.0.1', 'IPv4-mapped private'],
  ['64:ff9b::127.0.0.1', 'NAT64 loopback'],
  ['2002:7f00:0001::', '6to4'],
  ['2001:db8::1', 'documentation'],
  ['100::1', 'discard'],
];

for (const [addr, why] of mustBlock) {
  ok(`blocks ${addr} (${why})`, net.classifyIp(addr).public === false);
}

const mustAllow = [
  ['8.8.8.8', 'Google DNS'],
  ['1.1.1.1', 'Cloudflare DNS'],
  ['93.184.215.14', 'example.com'],
  ['172.32.0.1', 'just outside 172.16/12'],
  ['172.15.255.255', 'just below 172.16/12'],
  ['100.63.255.255', 'just below CGNAT'],
  ['100.128.0.1', 'just above CGNAT'],
  ['11.0.0.1', 'just above 10/8'],
  ['9.255.255.255', 'just below 10/8'],
  ['192.167.255.255', 'just below 192.168/16'],
  ['192.169.0.1', 'just above 192.168/16'],
  ['169.253.255.255', 'just below link-local'],
  ['169.255.0.1', 'just above link-local'],
  ['2606:4700:4700::1111', 'Cloudflare IPv6'],
  ['2a00:1450:4009:81f::200e', 'Google IPv6'],
];

for (const [addr, why] of mustAllow) {
  ok(`allows ${addr} (${why})`, net.classifyIp(addr).public === true);
}

ok('rejects non-addresses', net.classifyIp('not-an-ip').public === false);
ok('rejects empty string', net.classifyIp('').public === false);
ok('rejects hostname', net.classifyIp('example.com').public === false);

/* ================================================================== *
 * 2. SSRF guard — URL validation
 * ================================================================== */

group('SSRF: URL validation');

(async () => {
  await throwsWith('rejects ftp scheme', () => net.validateUrl('ftp://example.com/'), 'BAD_SCHEME');
  await throwsWith('rejects javascript scheme', () => net.validateUrl('javascript:alert(1)'), 'BAD_SCHEME');
  await throwsWith('rejects data scheme', () => net.validateUrl('data:text/html,<h1>x'), 'BAD_SCHEME');
  await throwsWith('rejects file scheme', () => net.validateUrl('file:///etc/passwd'), 'BAD_SCHEME');
  await throwsWith('rejects gopher scheme', () => net.validateUrl('gopher://example.com/'), 'BAD_SCHEME');
  await throwsWith('rejects non-standard port 8080', () => net.validateUrl('http://example.com:8080/'), 'BAD_PORT');
  await throwsWith('rejects redis port 6379', () => net.validateUrl('http://example.com:6379/'), 'BAD_PORT');
  await throwsWith('rejects literal 127.0.0.1', () => net.validateUrl('http://127.0.0.1/'), 'BLOCKED_IP');
  await throwsWith('rejects literal metadata IP', () => net.validateUrl('http://169.254.169.254/latest/meta-data/'), 'BLOCKED_IP');
  await throwsWith('rejects literal 10.0.0.1', () => net.validateUrl('http://10.0.0.1/'), 'BLOCKED_IP');
  await throwsWith('rejects literal [::1]', () => net.validateUrl('http://[::1]/'), 'BLOCKED_IP');
  await throwsWith('rejects literal [fd00::1]', () => net.validateUrl('http://[fd00::1]/'), 'BLOCKED_IP');
  await throwsWith('rejects empty input', () => net.validateUrl(''), 'BAD_URL');
  await throwsWith('rejects nonsense', () => net.validateUrl('not a url at all'), 'BAD_URL');
  await throwsWith('rejects over-long input', () => net.validateUrl('https://example.com/' + 'a'.repeat(3000)), 'BAD_URL');

  ok('accepts https public host', net.validateUrl('https://example.com/').hostname === 'example.com');
  ok('accepts http public host', net.validateUrl('http://example.com/').hostname === 'example.com');
  ok('accepts explicit port 443', net.validateUrl('https://example.com:443/').hostname === 'example.com');
  ok('accepts public IP literal', net.validateUrl('https://93.184.215.14/').hostname === '93.184.215.14');

  eq('normalises a bare hostname', net.normaliseInput('travelgenix.io').href, 'https://travelgenix.io/');
  eq('normalises with whitespace', net.normaliseInput('  travelgenix.io  ').href, 'https://travelgenix.io/');
  eq('keeps an explicit scheme', net.normaliseInput('http://travelgenix.io').href, 'http://travelgenix.io/');
  await throwsWith('normalise still rejects javascript', () => net.normaliseInput('javascript:alert(1)'), 'BAD_SCHEME');

  /* ================================================================== *
   * 3. SSRF guard — live connect attempts
   * ================================================================== */

  group('SSRF: connect-time guard');

  await throwsWith('blocks localhost by name', () => net.safeFetch('http://localhost/', { timeoutMs: 3000 }), 'BLOCKED_IP');
  await throwsWith('blocks 127.0.0.1 by literal', () => net.safeFetch('http://127.0.0.1/', { timeoutMs: 3000 }), 'BLOCKED_IP');
  await throwsWith('blocks metadata endpoint', () => net.safeFetch('http://169.254.169.254/', { timeoutMs: 3000 }), 'BLOCKED_IP');
  await throwsWith('blocks private 10/8 by literal', () => net.safeFetch('http://10.0.0.1/', { timeoutMs: 3000 }), 'BLOCKED_IP');

  /* ================================================================== *
   * 4. robots.txt parsing
   * ================================================================== */

  group('robots.txt parsing');

  const allowAll = access.parseRobots('User-agent: *\nDisallow:\n');
  eq('empty Disallow allows all', access.robotsVerdict(allowAll, 'GPTBot', '/').allowed, true);

  const blockAll = access.parseRobots('User-agent: *\nDisallow: /\n');
  eq('Disallow / blocks all', access.robotsVerdict(blockAll, 'GPTBot', '/').allowed, false);

  const specific = access.parseRobots('User-agent: *\nDisallow:\n\nUser-agent: GPTBot\nDisallow: /\n');
  eq('specific group beats wildcard', access.robotsVerdict(specific, 'GPTBot', '/').allowed, false);
  eq('other bots keep the wildcard', access.robotsVerdict(specific, 'PerplexityBot', '/').allowed, true);

  const caseTest = access.parseRobots('User-Agent: gptbot\nDisallow: /\n');
  eq('user-agent match is case-insensitive', access.robotsVerdict(caseTest, 'GPTBot', '/').allowed, false);

  const grouped = access.parseRobots('User-agent: GPTBot\nUser-agent: ClaudeBot\nDisallow: /\n');
  eq('stacked user-agents share rules (first)', access.robotsVerdict(grouped, 'GPTBot', '/').allowed, false);
  eq('stacked user-agents share rules (second)', access.robotsVerdict(grouped, 'ClaudeBot', '/').allowed, false);

  const longest = access.parseRobots('User-agent: *\nDisallow: /\nAllow: /blog\n');
  eq('longest match wins for Allow', access.robotsVerdict(longest, 'GPTBot', '/blog/post').allowed, true);
  eq('longest match wins for Disallow', access.robotsVerdict(longest, 'GPTBot', '/other').allowed, false);

  const tie = access.parseRobots('User-agent: *\nDisallow: /page\nAllow: /page\n');
  eq('equal-length tie goes to Allow', access.robotsVerdict(tie, 'GPTBot', '/page').allowed, true);

  const wildcardPath = access.parseRobots('User-agent: *\nDisallow: /*.pdf$\n');
  eq('path wildcards match', access.robotsVerdict(wildcardPath, 'GPTBot', '/files/x.pdf').allowed, false);
  eq('path wildcards do not over-match', access.robotsVerdict(wildcardPath, 'GPTBot', '/files/x.html').allowed, true);

  const comments = access.parseRobots('# a comment\nUser-agent: *  # trailing\nDisallow: /  # blocked\n');
  eq('comments are stripped', access.robotsVerdict(comments, 'GPTBot', '/').allowed, false);

  const noGroups = access.parseRobots('Sitemap: https://example.com/sitemap.xml\n');
  eq('a robots.txt with no groups allows all', access.robotsVerdict(noGroups, 'GPTBot', '/').allowed, true);
  eq('sitemap is captured', noGroups.sitemaps.length, 1);

  /* ================================================================== *
   * 5. Per-bot verdict logic — the false-positive guard
   * ================================================================== */

  group('Access verdicts: the credibility rules');

  const okControl = { reached: true, status: 200, challenge: false };
  const blockedControl = { reached: true, status: 403, challenge: true };

  let v = access.combineVerdict({
    robots: { allowed: false, rule: 'Disallow: /' },
    probe: { reached: true, status: 200, challenge: false },
    control: okControl,
  });
  eq('robots Disallow is a hard block even when the probe passes', v.state, 'blocked');
  eq('robots block is attributed to robots.txt', v.source, 'robots');

  v = access.combineVerdict({
    robots: { allowed: true },
    probe: { reached: true, status: 403, challenge: true },
    control: okControl,
  });
  eq('403 to bot + control OK = edge block', v.state, 'blocked');
  eq('edge block is attributed to the edge', v.source, 'edge');

  v = access.combineVerdict({
    robots: { allowed: true },
    probe: { reached: true, status: 403, challenge: true },
    control: blockedControl,
  });
  eq('403 to bot + 403 to control = inconclusive, never a block', v.state, 'inconclusive');

  v = access.combineVerdict({
    robots: { allowed: true },
    probe: { reached: true, status: 200, challenge: false },
    control: okControl,
  });
  eq('clean probe is a pass', v.state, 'pass');

  v = access.combineVerdict({
    robots: { allowed: true },
    probe: { reached: true, status: 429, challenge: false },
    control: okControl,
  });
  eq('429 is a warning not a block', v.state, 'warn');

  v = access.combineVerdict({
    robots: { allowed: true },
    probe: { reached: false, error: 'TIMEOUT' },
    control: okControl,
  });
  eq('timeout is a warning not a block', v.state, 'warn');

  v = access.combineVerdict({
    robots: { allowed: true },
    probe: { reached: false, error: 'TOO_MANY_REDIRECTS' },
    control: okControl,
  });
  eq('redirect loop is a warning not a block', v.state, 'warn');

  v = access.combineVerdict({
    robots: { allowed: true },
    probe: { reached: false, error: 'TIMEOUT' },
    control: { reached: false, error: 'TIMEOUT' },
  });
  eq('probe and control both unreachable = inconclusive', v.state, 'inconclusive');

  v = access.combineVerdict({
    robots: { allowed: true, unknown: true },
    probe: { reached: true, status: 200, challenge: false },
    control: okControl,
  });
  eq('unreadable robots.txt does not fail the bot', v.state, 'pass');

  v = access.combineVerdict({
    robots: { allowed: true },
    probe: { reached: true, status: 503, challenge: true },
    control: okControl,
  });
  eq('503 challenge page to bot + control OK = edge block', v.state, 'blocked');

  v = access.combineVerdict({
    robots: { allowed: true },
    probe: { reached: true, status: 500, challenge: false },
    control: okControl,
  });
  eq('plain 500 is a warning not a block', v.state, 'warn');

  group('Access: challenge-page detection');

  ok('spots the Cloudflare interstitial', access.looksLikeChallenge(403, '<title>Just a moment...</title><div id="cf-chl">'));
  ok('spots "Attention Required"', access.looksLikeChallenge(403, '<title>Attention Required! | Cloudflare</title>'));
  ok('spots the JS-and-cookies line', access.looksLikeChallenge(403, 'Enable JavaScript and cookies to continue'));
  ok('does not flag a normal 403', access.looksLikeChallenge(403, '<h1>Forbidden</h1><p>You do not have permission.</p>') === false);
  ok('does not flag a normal page', access.looksLikeChallenge(200, '<h1>Welcome to our travel agency</h1>') === false);

  /* ================================================================== *
   * 6. Whole-scan inconclusive rule
   * ================================================================== */

  group('Access: whole-scan honesty');

  const allInconclusive = access.summarise({
    control: { reached: true, status: 403, challenge: true },
    bots: [
      { id: 'oai-search', verdict: { state: 'inconclusive' } },
      { id: 'perplexity', verdict: { state: 'inconclusive' } },
    ],
    robotsUnknown: false,
  });
  eq('control blocked means the pillar is inconclusive', allInconclusive.inconclusive, true);
  eq('inconclusive pillar carries no score', allInconclusive.score, null);

  const mixed = access.summarise({
    control: { reached: true, status: 200, challenge: false },
    bots: [
      { id: 'oai-search', verdict: { state: 'pass' } },
      { id: 'chatgpt-user', verdict: { state: 'pass' } },
      { id: 'perplexity', verdict: { state: 'blocked' } },
      { id: 'claudebot', verdict: { state: 'pass' } },
      { id: 'google-extended', verdict: { state: 'warn' } },
      { id: 'googlebot', verdict: { state: 'pass' } },
    ],
    robotsUnknown: false,
  });
  eq('a mixed result is scored', mixed.inconclusive, false);
  ok('one block and one warning pulls the score below full', mixed.score < 100 && mixed.score > 0, `got ${mixed.score}`);

  const allPass = access.summarise({
    control: { reached: true, status: 200, challenge: false },
    bots: ['oai-search', 'chatgpt-user', 'perplexity', 'claudebot', 'google-extended', 'googlebot'].map((id) => ({
      id,
      verdict: { state: 'pass' },
    })),
    robotsUnknown: false,
  });
  eq('all six clean scores 100', allPass.score, 100);

  /* ================================================================== *
   * 7. On-page pillars
   * ================================================================== */

  group('On-page: structured data');

  const richHtml = `<!doctype html><html><head>
    <script type="application/ld+json">{"@context":"https://schema.org","@type":"TravelAgency","name":"Blue Horizon Travel","telephone":"+44 1234 567890","address":{"@type":"PostalAddress","addressLocality":"Leeds"}}</script>
    <script type="application/ld+json">{"@context":"https://schema.org","@type":"WebSite","potentialAction":{"@type":"SearchAction"}}</script>
    <script type="application/ld+json">{"@context":"https://schema.org","@type":"FAQPage","mainEntity":[{"@type":"Question","name":"Do you offer ATOL protection?"}]}</script>
    </head><body><h1>Blue Horizon Travel</h1></body></html>`;

  const rich = onpage.analyseSchema(richHtml);
  eq('finds every JSON-LD block', rich.blocks, 3);
  ok('spots the organisation type', rich.types.includes('TravelAgency'));
  ok('spots FAQPage', rich.types.includes('FAQPage'));
  ok('a rich page scores well', rich.score >= 70, `got ${rich.score}`);
  eq('no parse errors on valid JSON-LD', rich.invalid, 0);

  const graphHtml = `<script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"Organization","name":"X"},{"@type":"BreadcrumbList"}]}</script>`;
  const graph = onpage.analyseSchema(graphHtml);
  ok('unwraps @graph', graph.types.includes('Organization') && graph.types.includes('BreadcrumbList'));

  const arrayHtml = `<script type="application/ld+json">[{"@type":"Organization","name":"X"},{"@type":"WebSite"}]</script>`;
  ok('unwraps a top-level array', onpage.analyseSchema(arrayHtml).types.includes('WebSite'));

  const brokenHtml = `<script type="application/ld+json">{ this is not json }</script>`;
  const broken = onpage.analyseSchema(brokenHtml);
  eq('counts invalid JSON-LD', broken.invalid, 1);
  eq('invalid JSON-LD earns nothing', broken.score, 0);

  const microHtml = `<div itemscope itemtype="https://schema.org/LocalBusiness"><span itemprop="name">X</span></div>`;
  const micro = onpage.analyseSchema(microHtml);
  eq('finds microdata', micro.microdata, 1);
  ok('microdata alone still scores something', micro.score > 0);

  const noSchema = onpage.analyseSchema('<html><body><h1>Hello</h1></body></html>');
  eq('no schema scores zero', noSchema.score, 0);
  eq('no schema is not inconclusive', noSchema.inconclusive, false);

  group('On-page: answer-ready content');

  const thin = onpage.analyseContent('<html><head><title>Example Domain</title></head><body><h1>Example Domain</h1><p>This domain is for use in illustrative examples in documents.</p></body></html>');
  eq('a near-empty page is inconclusive, not a fake fail', thin.inconclusive, true);
  eq('inconclusive content carries no score', thin.score, null);

  const body = Array.from({ length: 40 }, (_, i) =>
    `<p>Paragraph ${i} about holidays in Greece with practical advice for travellers who want a quiet island break away from the crowds.</p>`
  ).join('');
  const goodHtml = `<!doctype html><html><head>
    <title>Quiet Greek islands for a slow holiday</title>
    <meta name="description" content="Where to go in Greece if you want small harbours, good food and no crowds. Practical advice from our team of travel specialists.">
    </head><body><h1>Quiet Greek islands for a slow holiday</h1>
    <h2>Which island is best for a first visit?</h2>${body}
    <h2>When should you go?</h2>${body}
    <h2>How much does it cost?</h2>${body}
    <ul><li>Paxos</li><li>Symi</li><li>Folegandros</li></ul>
    </body></html>`;
  const good = onpage.analyseContent(goodHtml);
  eq('a real page is scored', good.inconclusive, false);
  ok('a well-structured page scores well', good.score >= 70, `got ${good.score}`);
  ok('question headings are counted', good.signals.questionHeadings >= 3);

  const noH1 = onpage.analyseContent(goodHtml.replace(/<h1>.*?<\/h1>/, ''));
  ok('a missing h1 costs marks', noH1.score < good.score);

  const multiH1 = onpage.analyseContent(goodHtml.replace('<h1>', '<h1>Extra</h1><h1>'));
  ok('multiple h1s cost marks', multiH1.score < good.score);

  const scriptHeavy = onpage.analyseContent(
    `<html><head><title>App</title></head><body><div id="root"></div>${'<script>var x=1;</script>'.repeat(40)}</body></html>`
  );
  eq('a JS-rendered shell is flagged', scriptHeavy.signals.likelyClientRendered, true);

  ok('script and style text is not counted as content',
    onpage.analyseContent('<html><body><style>' + 'body{color:red} '.repeat(200) + '</style></body></html>').signals.words < 50);

  group('On-page: authority signals');

  const authHtml = `<html><body>
    <a href="tel:+441234567890">Call us</a>
    <a href="mailto:hello@example.com">Email us</a>
    <a href="/about">About us</a>
    <a href="/privacy-policy">Privacy policy</a>
    <a href="/terms">Terms</a>
    <a href="https://www.facebook.com/example">Facebook</a>
    <a href="https://uk.trustpilot.com/review/example.com">Read our reviews</a>
    <p>We are ABTA bonded (ABTA number Y1234) and ATOL protected.</p>
    <p>Registered in England, company number 09876543. VAT 123456789.</p>
    <p>12 Harbour Road, Leeds, LS1 4AB</p>
    </body></html>`;
  const auth = onpage.analyseAuthority(authHtml, { types: ['TravelAgency'], hasRating: true, hasSameAs: true });
  ok('a trust-rich page scores well', auth.score >= 70, `got ${auth.score}`);
  ok('spots ABTA', auth.signals.tradeBodies.includes('ABTA'));
  ok('spots ATOL', auth.signals.tradeBodies.includes('ATOL'));
  ok('spots a phone number', auth.signals.phone === true);
  ok('spots a review platform', auth.signals.reviewPlatform === true);

  const bare = onpage.analyseAuthority('<html><body><h1>Hello</h1></body></html>', { types: [], hasRating: false, hasSameAs: false });
  ok('a bare page scores near zero', bare.score <= 10, `got ${bare.score}`);

  ok('ABTA is not matched inside another word',
    onpage.analyseAuthority('<html><body><p>The cabtaxi service</p></body></html>', { types: [] }).signals.tradeBodies.length === 0);

  /* ================================================================== *
   * 8. Scoring and combination
   * ================================================================== */

  group('Scoring: inconclusive pillars are excluded');

  let s = score.combine({
    access: { score: 100, inconclusive: false },
    schema: { score: 0, inconclusive: false },
    content: { score: null, inconclusive: true },
    authority: { score: 8, inconclusive: false },
  });
  eq('three scored pillars average correctly', s.overall, 36);
  eq('the inconclusive pillar is named', s.inconclusivePillars.length, 1);
  eq('an inconclusive pillar is not counted as zero', s.scoredPillars, 3);

  s = score.combine({
    access: { score: 100, inconclusive: false },
    schema: { score: 40, inconclusive: false },
    content: { score: 76, inconclusive: false },
    authority: { score: 60, inconclusive: false },
  });
  eq('four scored pillars average correctly', s.overall, 69);
  eq('69 lands in Needs work', s.band, 'Needs work');

  s = score.combine({
    access: { score: null, inconclusive: true },
    schema: { score: null, inconclusive: true },
    content: { score: null, inconclusive: true },
    authority: { score: null, inconclusive: true },
  });
  eq('everything inconclusive gives no overall score', s.overall, null);
  eq('everything inconclusive says so', s.band, 'Inconclusive');

  group('Scoring: bands');

  eq('90 is Strong', score.bandFor(90), 'Strong');
  eq('85 is Strong', score.bandFor(85), 'Strong');
  eq('84 is Good', score.bandFor(84), 'Good');
  eq('70 is Good', score.bandFor(70), 'Good');
  eq('69 is Needs work', score.bandFor(69), 'Needs work');
  eq('50 is Needs work', score.bandFor(50), 'Needs work');
  eq('49 is At risk', score.bandFor(49), 'At risk');
  eq('30 is At risk', score.bandFor(30), 'At risk');
  eq('29 is Invisible', score.bandFor(29), 'Invisible');
  eq('0 is Invisible', score.bandFor(0), 'Invisible');

  group('Scoring: findings carry fixes');

  const report = score.buildReport({
    url: 'https://example.com/',
    accessResult: {
      score: 60,
      inconclusive: false,
      control: { reached: true, status: 200, challenge: false },
      bots: [
        { id: 'oai-search', label: 'ChatGPT Search', verdict: { state: 'blocked', source: 'edge', detail: 'HTTP 403' } },
        { id: 'perplexity', label: 'Perplexity', verdict: { state: 'blocked', source: 'robots', detail: 'Disallow: /' } },
        { id: 'claudebot', label: 'Claude', verdict: { state: 'warn', source: 'network', detail: 'timed out' } },
        { id: 'googlebot', label: 'Google index', verdict: { state: 'pass' } },
        { id: 'chatgpt-user', label: 'ChatGPT live fetch', verdict: { state: 'pass' } },
        { id: 'google-extended', label: 'Gemini and AI Overviews', verdict: { state: 'pass' } },
      ],
      robots: { found: true, sitemaps: [] },
    },
    schemaResult: { score: 0, inconclusive: false, types: [], blocks: 0, invalid: 0, microdata: 0 },
    contentResult: { score: null, inconclusive: true, signals: {} },
    authorityResult: { score: 8, inconclusive: false, signals: { tradeBodies: [] } },
  });

  ok('the report produces findings', report.findings.length > 0);
  ok('every finding carries a fix', report.findings.every((f) => typeof f.fix === 'string' && f.fix.length > 10),
    'a finding is missing its fix');
  ok('every finding has a pillar', report.findings.every((f) => typeof f.pillar === 'string' && f.pillar.length > 0));
  ok('the edge block is called out', report.findings.some((f) => /edge|network level|Cloudflare/i.test(f.detail)));
  ok('the robots block is called out', report.findings.some((f) => /robots\.txt/i.test(f.detail)));
  ok('the presence teaser is locked', report.presence.locked === true);
  ok('the presence teaser claims no result', report.presence.result === null);

  group('Copy: house style');

  const allCopy = report.findings
    .map((f) => `${f.title} ${f.detail} ${f.fix}`)
    .concat([report.summary, report.presence.blurb])
    .join(' ');
  ok('no em dashes in client-facing copy', allCopy.includes('—') === false, 'found an em dash');
  ok('no en dashes used as punctuation', /\s–\s/.test(allCopy) === false, 'found an en dash');
  ok('no AI filler', /delve|tapestry|in today's fast-paced|unlock the power|game-changer/i.test(allCopy) === false);
  ok('UK spelling for optimise', /optimize/i.test(allCopy) === false, 'found US spelling');
  ok('a clean pass is still honest about its limits',
    /not a guarantee|cannot promise|beyond the user agent|fingerprint/i.test(report.caveat));

  /* ================================================================== *
   * 9. Rate limiting
   * ================================================================== */

  group('Rate limiting');

  const limiter = ratelimit.createLimiter({ redisUrl: null, redisToken: null });
  const key = 'test-ip-1';
  let lastAllowed = true;
  for (let i = 0; i < 8; i += 1) {
    const r = await limiter.check(key);
    lastAllowed = r.allowed;
  }
  eq('eight requests inside the minute are allowed', lastAllowed, true);
  const ninth = await limiter.check(key);
  eq('the ninth request in a minute is refused', ninth.allowed, false);
  ok('a refusal says when to retry', typeof ninth.retryAfter === 'number' && ninth.retryAfter > 0);

  const other = await limiter.check('test-ip-2');
  eq('the limit is per key', other.allowed, true);

  const failOpen = ratelimit.createLimiter({
    redisUrl: 'https://unreachable.invalid',
    redisToken: 'x',
    fetchImpl: () => Promise.reject(new Error('down')),
  });
  const openResult = await failOpen.check('test-ip-3');
  eq('an unreachable Redis fails open', openResult.allowed, true);
  eq('a fail-open result is marked degraded', openResult.degraded, true);

  /* ================================================================== *
   * 10. The endpoint: guard ordering
   * ================================================================== */

  group('Endpoint: guards run in the right order');

  const handler = require('./api/check');

  function mockRes() {
    const r = {
      statusCode: null,
      headers: {},
      body: null,
      ended: false,
      setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
      status(code) { this.statusCode = code; return this; },
      json(payload) { this.body = payload; this.ended = true; return this; },
      end() { this.ended = true; return this; },
    };
    return r;
  }

  async function call(req) {
    const res = mockRes();
    await handler(Object.assign({ headers: {}, socket: { remoteAddress: '203.0.113.9' } }, req), res);
    return res;
  }

  let r = await call({ method: 'PUT', url: '/api/check?url=example.com' });
  eq('an unsupported method is refused', r.statusCode, 405);
  eq('the refusal advertises what is allowed', r.headers.allow, 'GET, POST, OPTIONS');

  r = await call({ method: 'OPTIONS' });
  eq('preflight is answered', r.statusCode, 204);

  r = await call({ method: 'GET', url: '/api/check' });
  eq('a missing url is refused before anything else', r.statusCode, 400);

  r = await call({ method: 'GET', url: '/api/check?url=' + encodeURIComponent('a'.repeat(2100)) });
  eq('an over-long url is refused', r.statusCode, 400);

  r = await call({ method: 'GET', url: '/api/check?url=' + encodeURIComponent('javascript:alert(1)'), headers: { 'x-forwarded-for': '198.51.100.7' } });
  eq('a javascript scheme is a 400', r.statusCode, 400);
  ok('the SSRF refusal says nothing internal',
    !/stack|Error:|\/home\/|node_modules|at Object/i.test(JSON.stringify(r.body)), JSON.stringify(r.body));

  r = await call({ method: 'GET', url: '/api/check?url=' + encodeURIComponent('http://169.254.169.254/latest/meta-data/'), headers: { 'x-forwarded-for': '198.51.100.8' } });
  eq('the metadata endpoint is a 400', r.statusCode, 400);

  r = await call({ method: 'GET', url: '/api/check?url=' + encodeURIComponent('http://127.0.0.1:80/'), headers: { 'x-forwarded-for': '198.51.100.10' } });
  eq('loopback is a 400', r.statusCode, 400);

  r = await call({ method: 'GET', url: '/api/check?url=' + encodeURIComponent('http://example.com:6379/'), headers: { 'x-forwarded-for': '198.51.100.11' } });
  eq('a non-web port is a 400', r.statusCode, 400);

  // Rate limiting has to bite before the fetch, so a single IP hammering
  // blocked URLs still gets cut off.
  let sawLimit = null;
  for (let i = 0; i < 12; i += 1) {
    const res = await call({
      method: 'GET',
      url: '/api/check?url=' + encodeURIComponent('javascript:alert(1)'),
      headers: { 'x-forwarded-for': '198.51.100.55' },
    });
    if (res.statusCode === 429) { sawLimit = res; break; }
  }
  ok('a hammering IP is rate limited', sawLimit !== null);
  if (sawLimit) {
    ok('the 429 carries Retry-After', Boolean(sawLimit.headers['retry-after']));
    ok('the 429 is not cacheable', String(sawLimit.headers['cache-control']).includes('no-store'));
  }

  group('Endpoint: CORS is an allowlist, never *');

  process.env.ALLOWED_ORIGINS = 'https://widgets.travelify.io';
  r = await call({ method: 'OPTIONS', headers: { origin: 'https://evil.example' } });
  eq('an unknown origin gets no CORS header', r.headers['access-control-allow-origin'], undefined);

  r = await call({ method: 'OPTIONS', headers: { origin: 'https://widgets.travelify.io' } });
  eq('an allowed origin is echoed back exactly', r.headers['access-control-allow-origin'], 'https://widgets.travelify.io');
  eq('the response varies on Origin', r.headers.vary, 'Origin');

  r = await call({ method: 'OPTIONS', headers: { origin: 'https://widgets.travelify.io.evil.example' } });
  eq('a lookalike origin gets nothing', r.headers['access-control-allow-origin'], undefined);
  delete process.env.ALLOWED_ORIGINS;

  group('Endpoint: no secret ever leaves the box');

  process.env.UPSTASH_REDIS_REST_TOKEN = 'test-secret-token-do-not-leak';
  process.env.UPSTASH_REDIS_REST_URL = 'https://fake.upstash.invalid';
  r = await call({ method: 'GET', url: '/api/check?url=' + encodeURIComponent('ftp://example.com/'), headers: { 'x-forwarded-for': '198.51.100.77' } });
  const serialised = JSON.stringify(r.body) + JSON.stringify(r.headers);
  ok('no Upstash token in the response', serialised.includes('test-secret-token-do-not-leak') === false);
  ok('no Upstash url in the response', serialised.includes('fake.upstash.invalid') === false);
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
  delete process.env.UPSTASH_REDIS_REST_URL;

  group('Repo hygiene');

  const fs = require('fs');
  const gitignore = fs.readFileSync(require('path').join(__dirname, '.gitignore'), 'utf8');
  ok('.env is gitignored', /^\.env$/m.test(gitignore));
  ok('.env.* is gitignored', /^\.env\.\*$/m.test(gitignore));
  ok('.env.example is kept', /^!\.env\.example$/m.test(gitignore));

  const envExample = fs.readFileSync(require('path').join(__dirname, '.env.example'), 'utf8');
  ok('the env example holds no filled-in values',
    envExample.split('\n').filter((l) => /^[A-Z_]+=.+/.test(l)).length === 0);

  const pkg = JSON.parse(fs.readFileSync(require('path').join(__dirname, 'package.json'), 'utf8'));
  eq('there are no runtime dependencies', Object.keys(pkg.dependencies || {}).length, 0);

  const publicFiles = fs.readdirSync(require('path').join(__dirname, 'public'));
  for (const file of publicFiles) {
    const body = fs.readFileSync(require('path').join(__dirname, 'public', file), 'utf8');
    ok(`no secret-shaped string in public/${file}`,
      /(sk-[A-Za-z0-9]{16,}|pat[A-Za-z0-9]{14,}|UPSTASH_REDIS_REST_TOKEN\s*=|AIRTABLE_API_KEY\s*=|ANTHROPIC_API_KEY\s*=)/.test(body) === false);
    ok(`no inline event handler in public/${file}`, /\son[a-z]+\s*=\s*["']/i.test(body) === false);
  }

  const vercelConfig = JSON.parse(fs.readFileSync(require('path').join(__dirname, 'vercel.json'), 'utf8'));
  eq('the function has a 30 second ceiling', vercelConfig.functions['api/check.js'].maxDuration, 30);
  const csp = vercelConfig.headers[0].headers.find((h) => h.key === 'Content-Security-Policy');
  ok('a CSP is set', Boolean(csp));
  ok('the CSP does not allow inline script', csp.value.includes("script-src 'self'") && !/script-src[^;]*unsafe-inline/.test(csp.value));
  ok('framing is denied', vercelConfig.headers[0].headers.some((h) => h.key === 'X-Frame-Options' && h.value === 'DENY'));
  ok('HSTS is set', vercelConfig.headers[0].headers.some((h) => h.key === 'Strict-Transport-Security'));

  /* ================================================================== *
   * 11. Live benchmarks (opt in with --live)
   * ================================================================== */

  if (process.argv.includes('--live')) {
    group('Live benchmarks');
    const engine = require('./lib/engine');
    for (const target of ['https://travelgenix.io/', 'https://example.com/', 'https://www.bbc.co.uk/']) {
      try {
        const result = await engine.scan(target);
        process.stdout.write(
          `  ${target}  overall=${result.overall === null ? 'inconclusive' : result.overall}` +
            `  band=${result.band}` +
            `  pillars=${result.pillars.map((p) => `${p.id}:${p.inconclusive ? 'inc' : p.score}`).join(' ')}\n`
        );
      } catch (err) {
        process.stdout.write(`  ${target}  ERROR ${err.code || err.message}\n`);
      }
    }
  }

  /* ------------------------------------------------------------------ */

  process.stdout.write(`\n${'='.repeat(52)}\n`);
  process.stdout.write(`  ${passed} passed, ${failed} failed\n`);
  if (failures.length) {
    process.stdout.write('\nFailures:\n');
    for (const f of failures) process.stdout.write(`  - ${f}\n`);
  }
  process.stdout.write(`${'='.repeat(52)}\n`);
  process.exit(failed === 0 ? 0 : 1);
})();
