/* Print a ledger for a human reviewer: old and new text side by side, then
   every kept claim with its sources and quotes, then every cut with its reason.

   Usage: node show.mjs <IATA>

   Flags sources worth a second look: an organisation that appears only once
   in the whole sweep (typos and one-off blogs), travel-guide and blog tiers,
   and time-sensitive claims with no date on any source. */
import fs from 'node:fs';
import path from 'node:path';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const code = (process.argv[2] || '').toUpperCase();
const L = JSON.parse(fs.readFileSync(path.join(HERE, 'ledger', code + '.json'), 'utf8'));
const w = s => s.trim().split(/\s+/).length;
const LOW = /blog|guide|tripadvisor|fandom|grokipedia|simple flying|travel and tour world|content|kupi|airportmap|wego|kayak|expedia|seatmaps|flightera/i;
const TIME = /passeng|million|airline|route|terminal|opened|opening|closed|renam|hub|base|fare|fee|taxi|price|works|construction|2025|2026|runway/i;

console.log(`\n${code}  ${L.name || '(no name)'}  ${L.country || ''}   ${w(L.before)} -> ${w(L.after)} words`);
console.log('\nOLD:\n' + L.before + '\n\nNEW:\n' + L.after + '\n');
for (const c of L.claims.filter(c => c.verdict !== 'cut')) {
  const orgs = (c.sources || []).map(s => s.org);
  const dated = (c.sources || []).some(s => s.dated);
  const flags = [];
  if ((c.sources || []).some(s => LOW.test(s.org))) flags.push('LOW-TIER SOURCE');
  if (TIME.test(c.claim + ' ' + c.inAfter) && !dated) flags.push('undated time-sensitive');
  console.log(`[${c.verdict}] ${c.claim}${flags.length ? '   <<' + flags.join(', ') + '>>' : ''}`);
  console.log(`   in text: "${c.inAfter}"`);
  if (c.note) console.log(`   note: ${c.note}`);
  for (const s of c.sources || []) {
    const q = (Array.isArray(s.quote) ? s.quote : [s.quote]).map(x => '"' + String(x).slice(0, 150) + (String(x).length > 150 ? '…' : '') + '"').join(' + ');
    console.log(`   - ${s.org}${s.dated ? ' (' + s.dated + ')' : ''} [${s.file}]: ${q}`);
  }
}
console.log('\nCUT:');
for (const c of L.claims.filter(c => c.verdict === 'cut')) console.log(`   - ${c.claim}: ${c.why}`);
if ((L.opinion || []).length) { console.log('\nOPINION:'); for (const o of L.opinion) console.log(`   - "${o.text}": ${o.why}`); }
