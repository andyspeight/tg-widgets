/**
 * One set of passport rules, no drift (25 Sep 2026).
 *
 * public/_passport-rules.js decides who may add a passport to a flight, when,
 * and what counts as a valid one. /api/retrieve-order and /api/update-passport
 * import it. The My Booking widget is a single script on customer sites and
 * cannot, so it carries a VERBATIM copy of the core between two markers. This
 * suite fails the moment the two differ, and checks the server really does
 * read the module rather than a copy of its own.
 *
 * Run: node test/passport-rules-drift-smoke.mjs   (npm run test:passport-rules-drift)
 */
import { readFileSync } from 'node:fs';

const R = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const MOD = R('public/_passport-rules.js');
const WIDGET = R('public/widget-mybooking.js');
let passed = 0, failed = 0;
const ok = (name, cond) => { if (cond) { passed++; console.log('  ✓ ' + name); } else { failed++; console.error('  ✗ ' + name); } };

const START = '// >>> passport rules';
const END = '// <<< passport rules';
function core(src) {
  const a = src.indexOf(START), b = src.indexOf(END);
  if (a < 0 || b < 0) return null;
  return src.slice(a, b + END.length);
}

console.log('The widget carries the module core verbatim');
{
  const m = core(MOD), w = core(WIDGET);
  ok('the module marks its core', !!m);
  ok('the widget marks its copy', !!w);
  const dedented = w ? w.split('\n').map((l) => (l.startsWith('  ') ? l.slice(2) : l)).join('\n') : '';
  ok('the copy is byte for byte the module core (two spaces of indentation aside)', !!m && dedented === m);
  if (m && dedented !== m) {
    const ml = m.split('\n'), wl = dedented.split('\n');
    for (let i = 0; i < Math.max(ml.length, wl.length); i++) {
      if (ml[i] !== wl[i]) { console.error('    first difference at core line ' + (i + 1) + ':\n      module: ' + ml[i] + '\n      widget: ' + wl[i]); break; }
    }
  }
  ok('the widget has one copy, not two', WIDGET.split(START).length === 2);
}

console.log('\nThe server reads the module, never a copy of its own');
{
  const lib = R('api/_lib/passport-foid.js');
  ok('api/_lib/passport-foid.js imports the public module', /from '\.\.\/\.\.\/public\/_passport-rules\.js'/.test(lib));
  ok('and holds no rule of its own', !/function ppValidate|function ppEligibility|PASSPORT_COUNTRIES = /.test(lib));
  ok('retrieve-order builds the page\'s block from it', /import \{ passportState \} from '\.\/_lib\/passport-foid\.js'/.test(R('api/retrieve-order.js')));
  ok('update-passport checks against it', /from '\.\/_lib\/passport-foid\.js'/.test(R('api/update-passport.js')) && /ppEligibility\(dataObject, today\)/.test(R('api/update-passport.js')));
  ok('the module is runtime-neutral', !/^import /m.test(MOD) && !/process\.env/.test(MOD) && !/\bdocument\./.test(MOD) && !/\bwindow\./.test(MOD));
}

console.log('\n' + passed + ' passed, ' + failed + ' failed\n');
process.exit(failed ? 1 : 0);
