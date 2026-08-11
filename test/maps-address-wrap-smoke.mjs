/**
 * Maps widget — long addresses must wrap, not overflow (Andy, 11 Aug 2026).
 *
 * A long location address (e.g. "6 Parvis Notre-Dame – Place Jean-Paul II,
 * 75004") ran on a single line and overflowed the list column, spilling toward
 * the map with no spacing and a horizontal scrollbar. Cause: the title and
 * address were inline <span>s with white-space:nowrap on the address, so its
 * overflow/ellipsis were inert (they need a block box) and it never wrapped.
 *
 * Fix: title + address are block-level and wrap (overflow-wrap:break-word), and
 * the body flexes to fill the column so wrapping happens at the right width.
 * Verified visually (long address wraps to two lines inside the column).
 *
 * Source guards over public/widget-maps.js.
 *
 * Run: node test/maps-address-wrap-smoke.mjs  (also: npm run test:maps-wrap)
 */
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../public/widget-maps.js', import.meta.url), 'utf8');

let passed = 0, failed = 0;
const ok = (name, cond) => { if (cond) { passed++; console.log('  ✓ ' + name); } else { failed++; console.error('  ✗ ' + name); } };

const rule = (sel) => {
  const m = src.match(new RegExp(sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{([^}]*)\\}'));
  return m ? m[1] : '';
};

console.log('The address wraps instead of forcing one line');
{
  const sub = rule('.tgm-li-sub');
  ok('.tgm-li-sub exists', !!sub);
  ok('no white-space:nowrap on the address', !/white-space\s*:\s*nowrap/.test(sub));
  ok('no single-line ellipsis truncation left on it', !/text-overflow\s*:\s*ellipsis/.test(sub));
  ok('address wraps long tokens (overflow-wrap:break-word)', /overflow-wrap\s*:\s*break-word/.test(sub));
  ok('address is block-level so it sits on its own line', /display\s*:\s*block/.test(sub));
}

console.log('Title sits on its own line and can wrap too');
{
  const title = rule('.tgm-li-title');
  ok('.tgm-li-title is block-level', /display\s*:\s*block/.test(title));
  ok('.tgm-li-title wraps long titles', /overflow-wrap\s*:\s*break-word/.test(title));
}

console.log('The body fills the column so wrapping happens at the right width');
{
  const body = rule('.tgm-li-body');
  ok('.tgm-li-body flexes to fill', /flex\s*:\s*1/.test(body));
  ok('.tgm-li-body can shrink (min-width:0)', /min-width\s*:\s*0/.test(body));
}

console.log('Version bumped');
{
  const vm = src.match(/VERSION = '(\d+)\.(\d+)\.(\d+)'/);
  ok('version >= 1.0.2', vm && (+vm[1] > 1 || (+vm[1] === 1 && (+vm[2] > 0 || (+vm[2] === 0 && +vm[3] >= 2)))));
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
