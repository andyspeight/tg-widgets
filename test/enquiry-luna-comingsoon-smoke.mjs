/**
 * Luna routing destinations are "coming soon" and cannot be enabled (24 Jul 2026).
 *
 * The enquiry editor offered Luna Chat / Luna Marketing / Luna Work as places to
 * send enquiries, but the code behind them was never built — a client could
 * switch them on and enquiries would silently never arrive. Until Luna routing
 * ships, all three must be marked coming-soon with a disabled, off toggle so no
 * client can enable a destination that does not work. This guards that.
 *
 * Run: node test/enquiry-luna-comingsoon-smoke.mjs
 */
import { readFileSync } from 'node:fs';

let passed = 0, failed = 0;
const ok = (c, label) => { if (c) { passed++; } else { failed++; console.error('  FAIL:', label); } };

const src = readFileSync(new URL('../public/editor-enquiry.html', import.meta.url), 'utf8');

// Every Luna destination definition must carry comingSoon: true.
for (const id of ['lunaChat', 'lunaMarketing', 'lunaWork']) {
  const i = src.indexOf(`id: '${id}'`);
  const block = i >= 0 ? src.slice(i, i + 400) : '';
  ok(/comingSoon:\s*true/.test(block), `${id} is marked comingSoon: true`);
}

// The renderer disables the toggle for a coming-soon destination…
ok(/if \(dest\.comingSoon\)[\s\S]{0,220}toggleInput\.disabled = true/.test(src),
  'a coming-soon destination renders a disabled toggle');
// …forces it off regardless of any stored config…
ok(/dest\.comingSoon[\s\S]{0,40}\?\s*false/.test(src),
  'a coming-soon destination is always shown off, never enable-able');
// …and its card cannot be opened to configure a non-existent destination.
ok(/if \(dest\.comingSoon\) return;/.test(src),
  'a coming-soon card does not open a config inspector');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
