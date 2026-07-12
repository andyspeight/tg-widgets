#!/usr/bin/env node
/**
 * Duda GEO remediation — verification probe (read-only, no credentials).
 *
 * Implements section 9 of the GEO handover. Safe to run against any live URL:
 * it only issues GET requests.
 *
 *   1. AI crawler UA probe — each of GPTBot / ClaudeBot / PerplexityBot /
 *      Google-Extended / Googlebot plus a browser baseline should return 200
 *      with a full body (not a JS shell or a truncated block page).
 *   2. JSON-LD present — the published HTML must contain at least one
 *      <script type="application/ld+json"> block, and each block must parse.
 *   3. robots.txt + sitemap — reachable and not disallowing everything.
 *
 * This does NOT call Google's Rich Results Test (no public no-auth API); it
 * validates that the JSON-LD parses and reports the @types found, then prints
 * the Rich Results Test URL for a manual confirmation.
 *
 * Usage:
 *   node scripts/duda-geo-verify.js https://www.traveldemo.site/
 *   node scripts/duda-geo-verify.js https://www.traveldemo.site/ --json
 *
 * Exit code is non-zero if any AI crawler probe fails or no JSON-LD is found,
 * so it can gate a rollout step.
 */

const UAS = {
  'GPTBot':          'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; GPTBot/1.2; +https://openai.com/gptbot',
  'ClaudeBot':       'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; ClaudeBot/1.0; +claudebot@anthropic.com',
  'PerplexityBot':   'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot',
  'Google-Extended': 'Mozilla/5.0 (compatible; Google-Extended/1.0; +http://www.google.com/bot.html)',
  'Googlebot':       'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
  'Browser':         'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
};

// AI retrieval crawlers we require access for. Googlebot + Browser are baselines.
const REQUIRED = ['GPTBot', 'ClaudeBot', 'PerplexityBot', 'Google-Extended'];

function parseArgs() {
  const args = { url: null, json: false, timeoutMs: 15000 };
  for (const a of process.argv.slice(2)) {
    if (a === '--json') args.json = true;
    else if (a.startsWith('--timeout=')) args.timeoutMs = parseInt(a.slice(10), 10) || 15000;
    else if (!a.startsWith('--')) args.url = a;
  }
  return args;
}

async function fetchWith(url, ua, timeoutMs) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      signal: ctl.signal,
      headers: { 'User-Agent': ua, 'Accept': 'text/html,application/xhtml+xml' },
    });
    const body = await res.text();
    return { status: res.status, bytes: Buffer.byteLength(body, 'utf8'), body };
  } finally {
    clearTimeout(t);
  }
}

function extractJsonLd(html) {
  const blocks = [];
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) {
    const raw = m[1].trim();
    try {
      blocks.push({ ok: true, data: JSON.parse(raw) });
    } catch (e) {
      blocks.push({ ok: false, error: e.message, snippet: raw.slice(0, 120) });
    }
  }
  return blocks;
}

function typesOf(data) {
  const out = [];
  const walk = (node) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) return node.forEach(walk);
    if (node['@type']) out.push(node['@type']);
    if (node['@graph']) walk(node['@graph']);
  };
  walk(data);
  return out;
}

async function main() {
  const opts = parseArgs();
  if (!opts.url) {
    console.error('Usage: node scripts/duda-geo-verify.js <url> [--json] [--timeout=ms]');
    process.exit(2);
  }
  let base;
  try {
    base = new URL(opts.url);
  } catch {
    console.error(`Invalid URL: ${opts.url}`);
    process.exit(2);
  }

  const report = { url: opts.url, crawlers: {}, jsonLd: null, robots: null, sitemap: null, pass: true };

  // 1. Crawler probes
  let browserBytes = 0;
  for (const [name, ua] of Object.entries(UAS)) {
    try {
      const r = await fetchWith(opts.url, ua, opts.timeoutMs);
      const entry = { status: r.status, bytes: r.bytes };
      if (name === 'Browser') browserBytes = r.bytes;
      report.crawlers[name] = entry;
    } catch (e) {
      report.crawlers[name] = { status: 0, bytes: 0, error: e.message };
    }
  }
  // A crawler passes if 200 and body is within 20% of the browser baseline size
  // (guards against silent block pages / JS shells served only to bots).
  for (const [name, entry] of Object.entries(report.crawlers)) {
    const okStatus = entry.status === 200;
    const okSize = browserBytes === 0 ? entry.bytes > 500 : entry.bytes >= browserBytes * 0.8;
    entry.pass = okStatus && okSize;
    if (REQUIRED.includes(name) && !entry.pass) report.pass = false;
  }

  // 2. JSON-LD on the page (browser UA fetch)
  try {
    const r = await fetchWith(opts.url, UAS.Browser, opts.timeoutMs);
    const blocks = extractJsonLd(r.body);
    report.jsonLd = {
      count: blocks.length,
      valid: blocks.filter(b => b.ok).length,
      invalid: blocks.filter(b => !b.ok),
      types: blocks.filter(b => b.ok).flatMap(b => typesOf(b.data)),
    };
    if (blocks.length === 0 || report.jsonLd.invalid.length > 0) report.pass = false;
  } catch (e) {
    report.jsonLd = { count: 0, valid: 0, error: e.message };
    report.pass = false;
  }

  // 3. robots.txt + sitemap
  try {
    const robotsUrl = `${base.origin}/robots.txt`;
    const r = await fetchWith(robotsUrl, UAS.Browser, opts.timeoutMs);
    const disallowAll = /User-agent:\s*\*/i.test(r.body) && /Disallow:\s*\/\s*$/im.test(r.body);
    const sitemap = (r.body.match(/Sitemap:\s*(\S+)/i) || [])[1] || null;
    report.robots = { status: r.status, disallowAll, sitemap };
  } catch (e) {
    report.robots = { error: e.message };
  }

  // Output
  if (opts.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`\nGEO verification — ${opts.url}\n`);
    console.log('Crawler probes (status / bytes / verdict):');
    for (const [name, e] of Object.entries(report.crawlers)) {
      const verdict = e.pass ? 'PASS' : (REQUIRED.includes(name) ? 'FAIL' : 'warn');
      console.log(`  ${name.padEnd(16)} ${String(e.status).padEnd(4)} ${String(e.bytes).padStart(7)}  ${verdict}${e.error ? '  ' + e.error : ''}`);
    }
    console.log('\nJSON-LD:');
    if (report.jsonLd && report.jsonLd.count) {
      console.log(`  blocks: ${report.jsonLd.count}, valid: ${report.jsonLd.valid}`);
      console.log(`  @types: ${[...new Set(report.jsonLd.types)].join(', ') || '(none)'}`);
      for (const bad of report.jsonLd.invalid || []) console.log(`  INVALID: ${bad.error} — ${bad.snippet}`);
    } else {
      console.log('  none found — GAP');
    }
    console.log('\nrobots.txt:');
    if (report.robots && report.robots.status) {
      console.log(`  status ${report.robots.status}, disallow-all: ${report.robots.disallowAll}, sitemap: ${report.robots.sitemap || 'none'}`);
    } else {
      console.log(`  ${report.robots && report.robots.error ? report.robots.error : 'unreachable'}`);
    }
    console.log('\nManual step: paste the page URL into Google Rich Results Test');
    console.log('  https://search.google.com/test/rich-results');
    console.log(`\nOVERALL: ${report.pass ? 'PASS' : 'FAIL'}\n`);
  }

  process.exit(report.pass ? 0 : 1);
}

main().catch(err => {
  console.error('verify fatal:', err.message);
  process.exit(2);
});
