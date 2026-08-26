/**
 * My Booking editor — the "Reminder emails" admin section (Andy/Lapland, Aug 2026).
 *
 * Clients write their own balance reminder wording per stage (interim / final)
 * in the My Booking editor, with clickable merge-tag chips and a live sample
 * preview. This is a source guard: the section is a template string inside the
 * editor's inline IIFE (booted through the shell's cookie SSO), so it has no
 * cheap DOM unit test — we assert the markup, the config default, the binding,
 * the load path and the chip/preview wiring are all present and consistent.
 *
 * The load-bearing check is the CROSS GUARD: every merge tag the editor offers
 * as a chip must be one the server renderer actually fills. If someone adds a
 * chip here without teaching payment-reminder-email.js the tag, this fails —
 * so a client can never be handed a tag that renders literally in a real email.
 *
 * Run: node test/reminder-email-editor-smoke.mjs   (npm run test:reminder-email-editor)
 */
import { readFileSync } from 'node:fs';

const EDITOR = readFileSync(new URL('../public/editor-mybooking.html', import.meta.url), 'utf8');
const RENDERER = readFileSync(new URL('../api/_lib/payment-reminder-email.js', import.meta.url), 'utf8');

let passed = 0, failed = 0;
const ok = (name, cond) => { if (cond) { passed++; console.log('  ✓ ' + name); } else { failed++; console.error('  ✗ ' + name); } };

console.log('The Reminder emails section is present in the editor');
{
  ok('an accordion section with data-section="reminder-emails" exists', /data-section="reminder-emails"/.test(EDITOR));
  ok('it is titled "Reminder emails"', /Reminder emails<\/h3>/.test(EDITOR));
  ok('the interim subject + body fields exist', /id="re-interim-subject"/.test(EDITOR) && /id="re-interim-body"/.test(EDITOR));
  ok('the final subject + body fields exist', /id="re-final-subject"/.test(EDITOR) && /id="re-final-body"/.test(EDITOR));
  ok('each stage has a live preview element', /id="re-interim-preview"/.test(EDITOR) && /id="re-final-preview"/.test(EDITOR));
  ok('the subject inputs are length-capped (maxlength 200, matches server)', /id="re-interim-subject"[^>]*maxlength="200"/.test(EDITOR));
}

console.log('The config carries a reminderEmails default so a fresh widget is well-formed');
{
  ok('reminderEmails default has interim + final subject/body',
    /reminderEmails:\s*\{\s*interim:\s*\{\s*subject:\s*''\s*,\s*body:\s*''\s*\}\s*,\s*final:\s*\{\s*subject:\s*''\s*,\s*body:\s*''\s*\}\s*\}/.test(EDITOR));
}

console.log('Editing a field persists into state.config.reminderEmails, and load repopulates it');
{
  ok('the four fields are bound in one forEach',
    /\['re-interim-subject',\s*'re-interim-body',\s*'re-final-subject',\s*'re-final-body'\]\.forEach/.test(EDITOR));
  ok('input writes state.config.reminderEmails[stage][part]',
    /state\.config\.reminderEmails\[parts\[1\]\]\[parts\[2\]\]\s*=\s*el\.value/.test(EDITOR));
  ok('editing marks the editor dirty', /window\.tgse\.markDirty\(\)/.test(EDITOR));
  ok('load repopulates the interim subject', /getElementById\('re-interim-subject'\)\.value\s*=\s*state\.config\.reminderEmails\.interim\.subject/.test(EDITOR));
  ok('load repopulates the final body', /getElementById\('re-final-body'\)\.value\s*=\s*state\.config\.reminderEmails\.final\.body/.test(EDITOR));
  ok('reEnsure() backfills a missing reminderEmails object', /function reEnsure\(\)/.test(EDITOR) && /state\.config\.reminderEmails\s*=\s*\{\}/.test(EDITOR));
}

console.log('The merge-tag chips insert at the cursor and the preview fills sample values');
{
  ok('chips are wired to insert their tag', /querySelectorAll\('\.re-tag'\)\.forEach/.test(EDITOR));
  ok('insertion splices the tag into the focused field', /el\.value\.slice\(0,\s*s\)\s*\+\s*tag\s*\+\s*el\.value\.slice\(e\)/.test(EDITOR));
  ok('a sample-value preview renderer exists', /function reRenderPreview\(\)/.test(EDITOR));
  ok('preview falls back to a "standard wording" note when blank',
    /Using our standard interim reminder wording\./.test(EDITOR) && /Using our standard final reminder wording\./.test(EDITOR));
  ok('the editor preview uses the SAME tag syntax as the server (\\{\\s*([a-zA-Z]+)\\s*\\})',
    /\/\\\{\\s\*\(\[a-zA-Z\]\+\)\\s\*\\\}\/g/.test(EDITOR));
}

// ── CROSS GUARD ──────────────────────────────────────────────────────────────
// Every tag the editor offers must be one the renderer fills. Derive the
// renderer's supported set from its mergeVars object, and the editor's offered
// set from the chip data-tag attributes, then assert offered ⊆ supported.
console.log('Every tag the editor offers is one the server renderer fills');
{
  const mv = RENDERER.slice(RENDERER.indexOf('const mergeVars = {'));
  const block = mv.slice(0, mv.indexOf('};') + 1);
  const supported = new Set((block.match(/([a-zA-Z]+)\s*:/g) || []).map(s => s.replace(/\s*:$/, '').toLowerCase()));
  ok('renderer exposes the core tags', ['firstname', 'amount', 'duedate', 'balance', 'bookingref', 'agencyname', 'agencyphone', 'instalmentnumber', 'instalmenttotal'].every(k => supported.has(k)));

  const offered = [...EDITOR.matchAll(/class="re-tag"\s+data-tag="\{([a-zA-Z]+)\}"/g)].map(m => m[1].toLowerCase());
  ok('the editor offers a set of chips', offered.length >= 8);
  const orphan = offered.filter(t => !supported.has(t));
  ok('no offered chip is unknown to the renderer (offered ⊆ supported)' + (orphan.length ? ' — orphan: ' + orphan.join(', ') : ''), orphan.length === 0);

  // ...and the editor's own sample-preview must have a value for every chip, so
  // the preview never shows an unmerged {tag} to the client.
  const sv = EDITOR.slice(EDITOR.indexOf('function reSampleVars()'));
  const svBlock = sv.slice(0, sv.indexOf('};') + 1);
  const sampled = new Set((svBlock.match(/([a-zA-Z]+)\s*:/g) || []).map(s => s.replace(/\s*:$/, '').toLowerCase()));
  const unSampled = offered.filter(t => !sampled.has(t));
  ok('every offered chip has a preview sample value' + (unSampled.length ? ' — missing: ' + unSampled.join(', ') : ''), unSampled.length === 0);
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
