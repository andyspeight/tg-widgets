'use strict';
/**
 * scripts/benchmarks.js — the three known-good regression targets.
 * Run: node scripts/benchmarks.js [url ...]
 */
const engine = require('../lib/engine');

const TARGETS = process.argv.slice(2).length
  ? process.argv.slice(2)
  : ['https://travelgenix.io/', 'https://example.com/', 'https://www.bbc.co.uk/'];

(async () => {
  for (const target of TARGETS) {
    process.stdout.write(`\n${'='.repeat(70)}\n${target}\n${'='.repeat(70)}\n`);
    const started = Date.now();
    try {
      const r = await engine.scan(target);
      process.stdout.write(`overall : ${r.overall === null ? 'inconclusive' : r.overall}   band: ${r.band}   (${Date.now() - started}ms)\n`);
      process.stdout.write(`summary : ${r.summary}\n`);
      process.stdout.write(`control : reached=${r.scanned.control.reached} status=${r.scanned.control.status} challenge=${r.scanned.control.challenge} err=${r.scanned.control.error}\n`);
      process.stdout.write(`robots  : found=${r.scanned.robots.found} unknown=${r.scanned.robots.unknown} sitemaps=${r.scanned.robots.sitemaps.length}\n`);
      process.stdout.write('pillars :\n');
      for (const p of r.pillars) {
        process.stdout.write(`          ${p.id.padEnd(10)} ${p.inconclusive ? 'INCONCLUSIVE' : String(p.score).padStart(3)}\n`);
      }
      process.stdout.write('crawlers:\n');
      for (const c of r.crawlers) {
        process.stdout.write(`          ${c.token.padEnd(16)} ${c.state.padEnd(13)} ${c.source || ''} ${c.detail || ''}\n`);
      }
      process.stdout.write(`schema  : blocks=${r.details.schema.blocks} invalid=${r.details.schema.invalid} micro=${r.details.schema.microdata} types=[${r.details.schema.types.join(', ')}]\n`);
      process.stdout.write(`content : words=${r.details.content.words} h1=${r.details.content.h1Count} h2=${r.details.content.h2Count} q=${r.details.content.questionHeadings} desc=${r.details.content.descriptionLength} csr=${r.details.content.likelyClientRendered}\n`);
      process.stdout.write(`author. : ${JSON.stringify(r.details.authority)}\n`);
      process.stdout.write(`findings: ${r.findings.length}\n`);
      for (const f of r.findings.slice(0, 4)) process.stdout.write(`          [${f.severity}] ${f.title}\n`);
    } catch (err) {
      process.stdout.write(`ERROR ${err.code || ''} ${err.message}\n`);
    }
  }
})();
