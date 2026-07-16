/**
 * Enquiry Form — multiple free-text notes (max 3).
 *
 * A form may now carry up to three notes fields. Each renderNotes writeTo pushes
 * its { label, value } onto fieldValues.__notes__; mergeNotesFields collapses
 * that list into the single `notes` value the server stores:
 *   • one field  → its value verbatim (byte-identical to the single-notes era)
 *   • two/three  → each labelled, blank-line separated, so the agent can tell
 *                  them apart in the inbox and emails
 * The editor caps additions at 3 via fieldTypeLimit (every other type stays 1).
 *
 * We extract the REAL functions from the shipped files and drive them.
 * Run: node test/enquiry-notes-smoke.mjs
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

// eslint-disable-next-line no-eval
const mergeNotesFields = eval('(' + ex(widget, 'function mergeNotesFields(fieldValues)') + ')');
const NOTES_MAX = 3; // fieldTypeLimit closes over this
// eslint-disable-next-line no-eval
const fieldTypeLimit = eval('(' + ex(editor, 'function fieldTypeLimit(typeId)') + ')');

// ── merge: no notes at all ───────────────────────────────────────────────────
let fv = { first_name: 'A' };
mergeNotesFields(fv);
ok(fv.notes === undefined, 'no notes field → notes stays unset');
ok(!('__notes__' in fv), 'no notes → no leftover __notes__');

// ── one note → value verbatim, NO label (unchanged single-notes behaviour) ───
fv = { __notes__: [{ label: 'Anything else?', value: 'Window seat please' }] };
mergeNotesFields(fv);
ok(fv.notes === 'Window seat please', 'one note → value verbatim, no label prefix');
ok(!('__notes__' in fv), 'one note → __notes__ removed');

// ── two notes → each labelled, blank line between ────────────────────────────
fv = { __notes__: [
  { label: 'Dietary needs', value: 'Coeliac' },
  { label: 'Special occasion', value: 'Honeymoon' },
] };
mergeNotesFields(fv);
ok(fv.notes === 'Dietary needs:\nCoeliac\n\nSpecial occasion:\nHoneymoon', 'two notes → each labelled, blank line between');

// ── three notes → trailing-colon label stripped, blank label → "Notes" ───────
fv = { __notes__: [
  { label: 'One:', value: 'a' },
  { label: 'Two', value: 'b' },
  { label: '', value: 'c' },
] };
mergeNotesFields(fv);
ok(fv.notes === 'One:\na\n\nTwo:\nb\n\nNotes:\nc', 'three notes → colon stripped, empty label → "Notes"');

// ── editor cap: notes repeatable up to 3, everything else one-per-form ───────
ok(fieldTypeLimit('notes') === 3, 'notes limit = 3');
ok(fieldTypeLimit('destination') === 1, 'destination limit = 1');
ok(fieldTypeLimit('consent') === 1, 'consent limit = 1');
ok(fieldTypeLimit('interests') === 1, 'interests limit = 1');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
