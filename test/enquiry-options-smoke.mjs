/**
 * Enquiry Form — editable "trip type" options (interests).
 *
 * The agent can customise the Interests options per form. The widget renders
 * fieldSpec.choices when present (sanitised) and falls back to its built-in set
 * otherwise, so an untouched form is unchanged. The editor's choicesFor() seeds
 * the options editor from the saved list or the defaults.
 *
 * We extract and drive the REAL functions from the shipped files.
 * Run: node test/enquiry-options-smoke.mjs
 */
import { readFileSync } from 'node:fs';

let passed = 0, failed = 0;
const ok = (c, label) => { if (c) { passed++; } else { failed++; console.error('  FAIL:', label); } };

function sliceBalanced(src, fromIdx) {
  let i = src.indexOf('{', fromIdx); const open = i;
  let d = 0, str = null, line = false, block = false;
  for (; i < src.length; i++) {
    const c = src[i], n = src[i + 1];
    if (line) { if (c === '\n') line = false; continue; }
    if (block) { if (c === '*' && n === '/') { block = false; i++; } continue; }
    if (str) { if (c === '\\') { i++; continue; } if (c === str) str = null; continue; }
    if (c === '/' && n === '/') { line = true; i++; continue; }
    if (c === '/' && n === '*') { block = true; i++; continue; }
    if (c === '"' || c === "'" || c === '`') { str = c; continue; }
    if (c === '{') d++; else if (c === '}') { d--; if (d === 0) return src.slice(open, i + 1); }
  }
  throw new Error('unbalanced');
}
function ex(src, sig) { const at = src.indexOf(sig); if (at < 0) throw new Error('not found: ' + sig); return sig + sliceBalanced(src, at + sig.length); }

const widget = readFileSync(new URL('../public/widget-enquiry.js', import.meta.url), 'utf8');
const editor = readFileSync(new URL('../public/editor-enquiry.html', import.meta.url), 'utf8');

// sanitiseChoices closes over ICONS (icon whitelist).
const ICONS = { pin: 'p', heart: 'h', wave: 'w' };
// eslint-disable-next-line no-eval
const sanitiseChoices = eval('(' + ex(widget, 'function sanitiseChoices(raw)') + ')');

// choicesFor closes over DEFAULT_INTEREST_CHOICES.
const DEFAULT_INTEREST_CHOICES = [
  { value: 'beach', label: 'Beach' }, { value: 'city', label: 'City' }, { value: 'culture', label: 'Culture' },
  { value: 'food', label: 'Food & wine' }, { value: 'adventure', label: 'Adventure' }, { value: 'family', label: 'Family' },
  { value: 'wellness', label: 'Wellness' }, { value: 'honeymoon', label: 'Honeymoon' },
];
// eslint-disable-next-line no-eval
const choicesFor = eval('(' + ex(editor, 'function choicesFor(field)') + ')');

// ── sanitiseChoices: absence → null so the widget uses its defaults ──────────
ok(sanitiseChoices(null) === null, 'null → null (fall back to defaults)');
ok(sanitiseChoices([]) === null, 'empty array → null');
ok(sanitiseChoices('nope') === null, 'non-array → null');
ok(sanitiseChoices([{}, { value: '', label: '' }]) === null, 'all-empty rows → null');

// ── normalisation ────────────────────────────────────────────────────────────
let s = sanitiseChoices([{ value: 'cruise', label: 'River Cruise', icon: 'wave' }]);
ok(s.length === 1 && s[0].value === 'cruise' && s[0].label === 'River Cruise' && s[0].icon === 'wave', 'value/label/icon preserved');
ok(sanitiseChoices([{ label: 'Safari' }])[0].value === 'Safari', 'missing value → value = label');
ok(sanitiseChoices([{ value: 'x' }])[0].label === 'x', 'missing label → label = value');
ok(sanitiseChoices([{ value: 'a', label: 'A', icon: 'bogus' }])[0].icon === 'pin', 'unknown icon → pin');
ok(sanitiseChoices([{ value: 'a', label: 'A' }])[0].icon === 'pin', 'no icon → pin');

// ── caps count ───────────────────────────────────────────────────────────────
const many = Array.from({ length: 40 }, (_, i) => ({ value: 'v' + i, label: 'L' + i }));
ok(sanitiseChoices(many).length === 24, 'caps at 24 options');

// ── choicesFor (editor seed) ─────────────────────────────────────────────────
ok(choicesFor({}).length === 8, 'no field.choices → 8 built-in defaults');
ok(choicesFor({}).every((c, i) => c.label === DEFAULT_INTEREST_CHOICES[i].label), 'defaults match the built-in labels');
ok(choicesFor({ choices: [] }).length === 8, 'empty choices array → defaults');
ok(choicesFor({ choices: [{ value: 'Xtreme', label: 'Xtreme' }] }).length === 1, 'custom choices used when present');
ok(choicesFor({ choices: [{ value: 'a', label: '  ' }, { value: 'b', label: 'Real' }] }).length === 1, 'blank-label rows filtered out');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
