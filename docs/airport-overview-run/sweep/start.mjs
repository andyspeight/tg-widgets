/* Open an airport for audit.

   Usage: node start.mjs <IATA>

   Prints the record as it stands (from the 23 Sep snapshot), saves the
   Wikipedia text it was written from (wiki.mjs) and the coordinates check
   (geo.mjs), and creates ledger/<IATA>.json with "before" copied exactly from
   the snapshot so it can never drift. "after" starts as a copy of "before";
   the auditor edits "after" and fills "claims". Never overwrites a ledger. */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const SP = '/tmp/claude-0/-home-user-tg-widgets/aa74082d-0375-5ea9-97e1-bfee8cc3073d/scratchpad/sweep';
const code = (process.argv[2] || '').toUpperCase();
const snap = JSON.parse(fs.readFileSync(SP + '/snapshot-0923.json', 'utf8')).records;
const rec = snap.find(r => r.cellValuesByFieldId.fldcS9uu4NWMVaIVP === code);
if (!rec) { console.error(code + ' is not in the snapshot'); process.exit(1); }
const f = rec.cellValuesByFieldId;
if (f.fldjvujj14Q9QNLLq.name !== 'In progress') { console.error(code + ' is ' + f.fldjvujj14Q9QNLLq.name + ', not in the sweep'); process.exit(1); }

console.log(`${code}  ${f.fldlT6eApAdQHGYED || '(NO NAME ON RECORD)'}  |  ${f.fldjARk52dZi7TGGc}  |  City Served: ${f.fldgrJ2uFjzPcAxUx || '(blank)'}`);
console.log(`record ${rec.id}   Wikipedia: ${f.fldRqtt44nsacJCwq || '(none)'}\n`);
console.log('CURRENT OVERVIEW:\n' + f.fldmRELkLWrUGL5Ss + '\n');
console.log(execFileSync('node', [path.join(HERE, 'wiki.mjs'), code]).toString());
console.log(execFileSync('node', [path.join(HERE, 'geo.mjs'), code]).toString());
const lp = path.join(HERE, 'ledger', code + '.json');
if (fs.existsSync(lp)) console.log('ledger already exists: ' + lp + ' (left alone)');
else {
  fs.writeFileSync(lp, JSON.stringify({
    iata: code, id: rec.id, name: f.fldlT6eApAdQHGYED || null, country: f.fldjARk52dZi7TGGc,
    wikipedia: f.fldRqtt44nsacJCwq || null, audited: '2026-09-23',
    before: f.fldmRELkLWrUGL5Ss, after: f.fldmRELkLWrUGL5Ss, claims: [], opinion: [], tracerOk: {},
  }, null, 1));
  console.log('ledger created: ' + lp);
}
console.log('evidence folder: ' + SP + '/evidence/' + code + '/');
