/* The sweep's gate. Nothing is pushed to Airtable until this passes.

   Usage: node check.mjs <IATA> [<IATA> ...]     reads ledger/<IATA>.json

   For every claim in the ledger it proves, mechanically:
     1. each quoted source sentence is really on the saved page
        ($SWEEP_EVIDENCE/<IATA>/<file>.txt), after normalising case, accents,
        quotes, dashes and whitespace;
     2. a kept claim has at least two sources from DIFFERENT organisations
        (Wikipedia and Wikidata are both "Wikimedia", so they count once);
     3. the phrase that carries the claim (inAfter) is really in the new text,
        and a cut claim's phrase (wasBefore) is gone from it.
   Then, over the new Overview as a whole:
     4. every sentence is carried by at least one checked claim, or is listed
        in "opinion" with a reason, so nothing reaches Airtable unchecked;
     5. every number and multi-word proper name in it appears in the saved
        sources (the Sep run's tracer), and so does every compass bearing;
     6. house style: no em dash, no banned word, UK spelling, Oxford comma
        candidates listed for a human look.

   Exit code 0 only when every airport named passes. */
import fs from 'node:fs';
import path from 'node:path';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const EVIDENCE = process.env.SWEEP_EVIDENCE ||
  '/tmp/claude-0/-home-user-tg-widgets/aa74082d-0375-5ea9-97e1-bfee8cc3073d/scratchpad/sweep/evidence';

const norm = s => String(s)
  .normalize('NFKD').replace(/[̀-ͯ]/g, '')
  .replace(/[‘’‚‛′`´]/g, "'").replace(/[“”„″]/g, '"')
  .replace(/[‐-―−]/g, '-').replace(/­/g, '')
  .replace(/ /g, ' ').toLowerCase().replace(/\s+/g, ' ').trim();

const BANNED = ['leverage', 'holistic', 'robust', 'seamless', 'game-changer', 'paradigm', 'delve', 'tapestry',
  'unlock', 'cutting-edge', 'landscape', 'ecosystem', 'groundbreaking', 'nestled', 'vibrant', 'profound', 'pivotal',
  'crucial', 'vital', 'testament', 'underscores', 'fostering', 'garner', 'showcase', 'interplay', 'intricate',
  'enduring', 'additionally', 'furthermore', 'moreover', 'boasts', 'gateway to', 'in conclusion', 'deep dive'];
const US = [/\b\w+iz(e|es|ed|ing|ation)\b/gi, /\bcenter(s)?\b/gi, /\bcolor(s|ed)?\b/gi, /\bfavor(ite|s)?\b/gi,
  /\btraveler(s)?\b/gi, /\btraveling\b/gi, /\bprogram(s)?\b/gi, /\bkilometer(s)?\b/gi, /\bmeter(s)?\b/gi,
  /\blabor\b/gi, /\bharbor(s)?\b/gi, /\bneighbor(s|hood|ing)?\b/gi];
const US_OK = new Set(['size', 'sizes', 'sized', 'prize', 'prizes', 'seize', 'seized', 'citizen', 'citizens', 'capsize', 'baize', 'maize']);
const DIRRX = /\b(?:north|south)[\s-]?(?:east|west)(?:ern)?\b|\b(?:north|south|east|west)(?:ern|wards?)?\b/gi;
const dcanon = x => x.toLowerCase().replace(/[\s-]+/g, '').replace(/(ern|wards?)$/, '');

function loadEvidence(iata, file) {
  const p = path.join(EVIDENCE, iata, file + '.txt');
  if (!fs.existsSync(p)) return null;
  const raw = fs.readFileSync(p, 'utf8');
  const [head, ...rest] = raw.split('\n----\n');
  const url = (head.match(/^URL: (.*)$/m) || [])[1] || '';
  return { url, text: rest.join('\n----\n'), n: norm(rest.join(' ')) };
}

let failedAny = false;
for (const code of process.argv.slice(2).map(s => s.toUpperCase())) {
  const lp = path.join(HERE, 'ledger', code + '.json');
  if (!fs.existsSync(lp)) { console.log(code + '  NO LEDGER'); failedAny = true; continue; }
  const L = JSON.parse(fs.readFileSync(lp, 'utf8'));
  const errs = [], warns = [];
  const after = L.after, nAfter = norm(after), nBefore = norm(L.before || '');
  const used = new Map();
  const ev = f => { if (!used.has(f)) used.set(f, loadEvidence(code, f)); return used.get(f); };

  console.log(`\n=== ${code}  ${L.name || ''}  (${L.claims.length} claims)`);
  L.claims.forEach((c, i) => {
    const tag = `#${i + 1} [${c.verdict}] ${c.claim}`;
    const bad = [];
    if (c.verdict === 'cut') {
      if (!c.why) bad.push('cut without a reason');
      if (c.wasBefore && !nBefore.includes(norm(c.wasBefore))) bad.push('wasBefore not in old text');
      if (c.wasBefore && nAfter.includes(norm(c.wasBefore))) bad.push('cut phrase still in new text');
    } else {
      if (!c.inAfter || !nAfter.includes(norm(c.inAfter))) bad.push('inAfter phrase not found in new text');
      const orgs = new Set();
      for (const s of c.sources || []) {
        const e = ev(s.file);
        if (!e) { bad.push(`source file ${s.file} missing`); continue; }
        if (s.url && e.url && s.url !== e.url) bad.push(`${s.file}: url differs from the saved page`);
        const quotes = Array.isArray(s.quote) ? s.quote : [s.quote];
        for (const q of quotes) if (!q || !e.n.includes(norm(q))) bad.push(`${s.file}: quote NOT on page: "${String(q).slice(0, 90)}"`);
        orgs.add(s.org);
      }
      // Attributed statements ("the FCDO advises...") are checked against the
      // body the sentence names; that page is the primary source and nobody
      // is better placed to confirm what it says. Allowed only when the text
      // itself names the body and the one source is that body.
      const attributed = c.primary && c.attribution &&
        nAfter.includes(norm(c.inAfter)) && norm(c.inAfter).includes(norm(c.attribution)) &&
        (c.sources || []).some(s => norm(s.org).includes(norm(c.attribution)));
      if (c.primary && !attributed) bad.push('marked primary, but the text does not name the body it quotes, or no source is that body');
      if (orgs.size < 2 && !attributed) bad.push(`only ${orgs.size} independent organisation(s): ${[...orgs].join(', ')}`);
    }
    if (bad.length) { errs.push(tag); console.log('  FAIL ' + tag + '\n       ' + bad.join('\n       ')); }
    else console.log('  ok   ' + tag + (c.verdict === 'cut' ? '' : '  <- ' + (c.sources || []).map(s => s.org).join(' + ')));
  });

  // 4. every sentence carried by a checked claim or declared opinion
  const kept = L.claims.filter(c => c.verdict !== 'cut').map(c => norm(c.inAfter));
  const opinion = (L.opinion || []).map(o => norm(o.text));
  const sentences = after.split(/(?<=[.!?])\s+(?=[A-Z0-9"'])/).map(s => s.trim()).filter(Boolean);
  for (const s of sentences) {
    const ns = norm(s);
    if (!kept.some(k => ns.includes(k)) && !opinion.some(o => ns.includes(o))) {
      errs.push('uncovered sentence'); console.log('  FAIL uncovered sentence: "' + s.slice(0, 120) + '"');
    }
  }

  // 5. tracer: names, numbers and bearings must be in the saved sources
  const allEv = [...fs.readdirSync(path.join(EVIDENCE, code))].filter(f => f.endsWith('.txt'))
    .map(f => loadEvidence(code, f.replace(/\.txt$/, '')).n).join(' \n ');
  const ok = new Set(Object.keys(L.tracerOk || {}).map(norm));
  const names = [...new Set(after.match(/\b[A-ZÀ-Þ][a-zà-ÿ'’]+(?:\s+(?:[A-ZÀ-Þ][a-zà-ÿ'’]+|de|del|da|do|la|van|von|of|al|el))+\b/g) || [])];
  const nums = [...new Set((after.match(/\b\d[\d,.]*\b/g) || []).map(n => n.replace(/[.,]$/, '')))];
  const digitsEv = allEv.replace(/[^0-9 ]/g, '');
  for (const nm of names) if (!allEv.includes(norm(nm)) && !ok.has(norm(nm))) { errs.push('name'); console.log('  FAIL tracer: name not in any saved source: ' + nm); }
  for (const n of nums) {
    const bare = n.replace(/[^0-9]/g, '');
    if (bare.length < 2) continue;
    if (!allEv.includes(norm(n)) && !digitsEv.includes(bare) && !ok.has(norm(n))) { errs.push('num'); console.log('  FAIL tracer: number not in any saved source: ' + n); }
  }
  const srcD = new Set((allEv.match(DIRRX) || []).map(dcanon));
  for (const d of new Set((after.match(DIRRX) || []).map(dcanon))) if (!srcD.has(d)) { errs.push('dir'); console.log('  FAIL bearing not in any saved source: ' + d); }

  // 6. house style
  if (/—/.test(after)) { errs.push('em dash'); console.log('  FAIL em dash in new text'); }
  if (/\s–\s/.test(after)) warns.push('spaced en dash used as a dash');
  for (const w of BANNED) if (new RegExp('\\b' + w + '\\b', 'i').test(after)) { errs.push('banned'); console.log('  FAIL banned word: ' + w); }
  for (const rx of US) for (const m of after.match(rx) || []) if (!US_OK.has(m.toLowerCase())) warns.push('US spelling? ' + m);
  for (const m of after.match(/\b[\w'’-]+, [\w'’ -]{1,40}, (?:and|or) /g) || []) warns.push('Oxford comma? "' + m.trim() + '"');
  // house rule: no two consecutive sentences start with the same word (across paragraphs too)
  const firstWords = sentences.map(s => (s.match(/^["']?([\w'’]+)/) || [])[1] || '');
  for (let i = 1; i < firstWords.length; i++) {
    if (firstWords[i] && firstWords[i].toLowerCase() === firstWords[i - 1].toLowerCase()) warns.push(`two sentences in a row start with "${firstWords[i]}"`);
  }
  const words = after.trim().split(/\s+/).length;
  for (const w of warns) console.log('  look ' + w);
  console.log(`  ${words} words.  ${errs.length ? 'NOT READY (' + errs.length + ' problems)' : 'READY TO PUSH'}`);
  if (errs.length) failedAny = true;
}
process.exit(failedAny ? 1 : 0);
