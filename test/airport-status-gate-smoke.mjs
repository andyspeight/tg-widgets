/**
 * Smoke test for the Airports Status contract.
 *
 * Guards the fix made on 25 Aug 2026: neither the picker nor the content
 * endpoint looked at Status, so an airport record carrying narrative but no
 * coordinates and no cited source was pickable and embeddable on a client
 * site. The picker is now gated to servable records; the content endpoint
 * still serves everything (breaking live embeds would be worse) but marks
 * unfinished records provisional.
 *
 * Run: node test/airport-status-gate-smoke.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  isServableAirportStatus,
  servableStatusFormula,
  SERVABLE_AIRPORT_STATUSES,
} from '../api/_lib/airport-status.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0;
const fails = [];
function ok(label, cond) { if (cond) { pass++; } else { fails.push(label); } }

// --- the pure contract -----------------------------------------------------
ok('Done is servable', isServableAirportStatus('Done') === true);
ok('Live is servable', isServableAirportStatus('Live') === true);
ok('In progress is not servable', isServableAirportStatus('In progress') === false);
ok('Draft is not servable', isServableAirportStatus('Draft') === false);
ok('Todo is not servable', isServableAirportStatus('Todo') === false);
ok('blank is not servable', isServableAirportStatus('') === false);
ok('null is not servable', isServableAirportStatus(null) === false);
ok('undefined is not servable', isServableAirportStatus(undefined) === false);
ok('a select object is unwrapped', isServableAirportStatus({ id: 'sel1', name: 'Done' }) === true);
ok('an unknown select object is not servable', isServableAirportStatus({ name: 'Archived' }) === false);
ok('case and padding tolerated', isServableAirportStatus('  done  ') === true);
ok('a non-string is not servable', isServableAirportStatus(42) === false);
ok('exactly two servable statuses', SERVABLE_AIRPORT_STATUSES.length === 2);
ok('servable list is frozen', Object.isFrozen(SERVABLE_AIRPORT_STATUSES));

const formula = servableStatusFormula();
ok('formula covers Done', formula.includes("{Status}='Done'"));
ok('formula covers Live', formula.includes("{Status}='Live'"));
ok('formula is an OR', formula.startsWith('OR('));
ok('formula honours a custom field name', servableStatusFormula('Airport Status').includes('{Airport Status}'));

// --- the picker is gated ---------------------------------------------------
const search = readFileSync(path.join(root, 'api/airport-search.js'), 'utf8');
ok('picker imports the contract', /from '\.\/_lib\/airport-status\.js'/.test(search));
ok('picker calls servableStatusFormula', /servableStatusFormula\(\)/.test(search));
ok('picker ANDs the gate onto the match', /"AND\(" \+ matches \+ "," \+ servableStatusFormula\(\)/.test(search));
ok('picker still matches on name, iata and city', /Airport Name/.test(search) && /IATA Code/.test(search) && /City Served/.test(search));

// --- the content endpoint flags rather than refuses ------------------------
const content = readFileSync(path.join(root, 'api/airport-content.js'), 'utf8');
ok('content imports the contract', /isServableAirportStatus/.test(content));
ok('content payload carries provisional', /provisional: !isServableAirportStatus\(/.test(content));
ok('content reads Status for the flag', /provisional: !isServableAirportStatus\(fldSelect\(airportRec, AF\.status\)\)/.test(content));
ok('content does not 404 on an unservable record',
   !/isServableAirportStatus[\s\S]{0,200}?res\.status\(404\)/.test(content));

if (fails.length) {
  console.error(`FAIL ${fails.length} of ${pass + fails.length}`);
  for (const f of fails) console.error('  x ' + f);
  process.exit(1);
}
console.log(`PASS airport status gate: ${pass} assertions`);
