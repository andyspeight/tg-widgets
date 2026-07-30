/**
 * Form editor — shell contract, builder wiring and registration.
 *
 * The editor is a static page whose behaviour lives in the shell, so these are
 * contract guards rather than a DOM drive: they pin the things that silently
 * break an editor (boot race, wrong widget type, missing registration) and the
 * rules this editor must not violate.
 *
 * Verified separately by driving the real page in Chromium: the question list
 * renders, a card opens, typing a label updates the preview WITHOUT moving
 * focus out of the sidebar, the add menu seeds options, and the preview follows
 * the question being edited.
 *
 * Run: node test/form-editor-smoke.mjs
 */
import { readFileSync } from 'node:fs';

let passed = 0, failed = 0;
const ok = (c, label) => { if (c) { passed++; } else { failed++; console.error('  FAIL:', label); } };

const ED = readFileSync(new URL('../public/editor-form.html', import.meta.url), 'utf8');
const WIDGET = readFileSync(new URL('../public/widget-form.js', import.meta.url), 'utf8');
const INDEX = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const CFG = readFileSync(new URL('../api/widget-config.js', import.meta.url), 'utf8');
const VERCEL = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));

// ── Shell contract ───────────────────────────────────────────────────────────
ok(/tgse\.init\(\{|window\.tgse\.init\(\{/.test(ED), 'boots through tgse.init');
ok(/widgetType: 'Form'/.test(ED), "widgetType is 'Form' (must match the Airtable option exactly)");
ok(/widgetTag: 'form'/.test(ED), 'widgetTag is form');
ok(/scriptFile: 'widget-form\.js'/.test(ED), 'embed code points at widget-form.js');
ok(/getConfig: function/.test(ED) && /setConfig: function/.test(ED), 'provides getConfig + setConfig');

// The blank-page race: never call isLoggedIn() synchronously at load.
ok(/tgse\.onReady\(/.test(ED), 'boots via tgse.onReady (async cookie auth)');
const boot = ED.slice(ED.indexOf('onReady'));
ok(/onReady\(function \(\) \{ if \(window\.tgse\.isLoggedIn\(\)\) boot\(\); \}\)/.test(ED),
  'isLoggedIn is only consulted INSIDE onReady');

// Script order: shell first, then the widget, then the editor script.
const iShell = ED.indexOf('/editor-shell.js');
const iWidget = ED.indexOf('/widget-form.js');
const iInline = ED.indexOf('window.tgse.init');
ok(iShell > 0 && iWidget > iShell && iInline > iWidget, 'script order is shell, widget, then editor script');

// Auth is the shell's job.
ok(!/Authorization:/i.test(ED) && !/Bearer /.test(ED), 'sets no manual auth headers');
// The shell owns save/tabs/embed; the editor must not re-wire them.
ok(!/getElementById\('btn-save'\)/.test(ED) && !/getElementById\("btn-save"\)/.test(ED), 'does not re-wire the save button');
ok(!/getElementById\('btn-embed'\)/.test(ED), 'does not re-wire the embed modal');
ok(/id="btn-save"/.test(ED) && /id="save-label"/.test(ED) && /id="name-input"/.test(ED), 'provides the save/name elements the shell expects');
ok(/class="tgse-tabs"/.test(ED) && /data-tab="questions"/.test(ED), 'uses the shell tab markup');
ok(/class="tgse-panel/.test(ED) && /class="tgse-section/.test(ED), 'uses the shell panel + section markup');

// ── The render rule ──────────────────────────────────────────────────────────
// The preview must be refreshed with update(), not remounted, and moving the
// preview must never pull focus out of the sidebar the agent is typing in.
ok(/widget\.update\(previewConfig\(\)\)/.test(ED), 'preview refreshes via update(), not a remount');
ok(/widget\.goTo\(i\)/.test(ED), 'preview follows the question being edited');
ok(/goTo\(index, opts\)/.test(WIDGET), 'the widget exposes goTo');
ok(/this\._suppressFocus = !\(opts && opts\.focus === true\)/.test(WIDGET), 'goTo suppresses focus by default');
ok(/if \(this\._suppressFocus\) return;/.test(WIDGET), '_focusStep honours the suppression');

// ── Preview index alignment ──────────────────────────────────────────────────
// The widget drops label-less questions; without a stand-in the editor's
// indices drift and the preview jumps to the wrong question.
ok(/function previewConfig\(\)/.test(ED), 'the preview gets its own config');
ok(/if \(!q\.label\) q\.label = 'Untitled question';/.test(ED),
  'unlabelled questions get a preview stand-in so indices stay aligned');

// ── Save guard ───────────────────────────────────────────────────────────────
// A form with no email question cannot produce a valid lead, so every
// submission would be rejected and the answers lost.
ok(/canSave: canSave/.test(ED), 'a save guard is registered');
ok(/mapTo === 'email' \|\| q\.type === 'email'/.test(ED), 'the guard requires an email question');

// ── Question types match the widget ──────────────────────────────────────────
const edTypes = [...ED.matchAll(/\{ id: '([a-z-]+)',\s+name: '[^']+',\s+group:/g)].map((m) => m[1]);
const widgetTypes = [...(WIDGET.match(/const TYPES = \{[\s\S]*?\n  \};/) || [''])[0]
  .matchAll(/^\s{4}'?([a-z-]+)'?:\s*\{/gm)].map((m) => m[1]);
ok(edTypes.length >= 13, `the editor offers all 13 question types (has ${edTypes.length})`);
for (const t of edTypes) {
  ok(widgetTypes.includes(t), `editor type "${t}" exists in the widget`);
}

// mapTo targets must match the server whitelist, or the mapping is dropped.
const SUBMIT = readFileSync(new URL('../api/form-submit.js', import.meta.url), 'utf8');
const serverMappable = ((SUBMIT.match(/const MAPPABLE = new Set\(\[([^\]]+)\]/) || [])[1] || '')
  .split(',').map((s) => s.trim().replace(/'/g, '')).filter(Boolean);
// Scoped to the MAPPABLE list itself — the rule builder uses the same
// { id, name } shape, so an unscoped sweep would test operators as mapTo targets.
const mappableBlock = ED.slice(ED.indexOf('var MAPPABLE = ['), ED.indexOf('var DEFAULT_CONFIG'));
const edMappable = [...mappableBlock.matchAll(/\{ id: '([a-zA-Z]*)',\s+name: '[^']*' \}/g)].map((m) => m[1]).filter(Boolean);
ok(edMappable.length >= 6, `the editor offers the mapTo targets (has ${edMappable.length})`);
for (const m of edMappable) {
  ok(serverMappable.includes(m), `mapTo target "${m}" is on the server whitelist`);
}

// ── Rule builder (Phase 2 branching) ─────────────────────────────────────────
// Verified separately by driving the page in Chromium: adding a rule to a
// multiple-choice question offers is/is-not/answered/not-answered, the value is
// a dropdown of that question's own options, the target list is just "end", the
// Else row appears once a rule exists, the rule reaches the config, the preview
// counter drops its total, and changing the type clears the rules.
ok(/function logicFields\(q, qi\)/.test(ED), 'the builder renders a logic block per question');
ok(/data-act="rule-add"/.test(ED) && /data-act="rule-del"/.test(ED), 'rules can be added and removed');
ok(/Everyone goes to the next question\./.test(ED), 'a form with no rules says so in plain words');
ok(/Rules are checked in order and the first match wins\./.test(ED), 'rule order is explained where the rules are');

// Every operator the editor can write must exist in the widget's dispatch
// table, or the rule silently never matches.
const widgetOps = [...(WIDGET.match(/const LOGIC_OPS = \{[\s\S]*?\n  \};/) || [''])[0]
  .matchAll(/^\s{4}'?([a-z-]+)'?:\s*\(/gm)].map((m) => m[1]);
const opBlock = ED.slice(ED.indexOf('function opOptions('), ED.indexOf('function valueField('));
const edOps = [...opBlock.matchAll(/\{ id: '([a-z-]+)', name: '[^']+' \}/g)].map((m) => m[1]);
ok(edOps.length > 0, `the editor offers operators (has ${edOps.length})`);
for (const o of [...new Set(edOps)]) {
  ok(widgetOps.includes(o), `editor operator "${o}" exists in the widget's LOGIC_OPS`);
}
// Type-aware operators: text can "contain", a number cannot; a scale compares
// numerically rather than by string.
ok(/if \(def\.scale \|\| def\.id === 'number'\)/.test(opBlock), 'numeric questions get numeric comparisons');
ok(/\{ id: 'lte', name: 'is at most' \}/.test(opBlock) && /\{ id: 'gte', name: 'is at least' \}/.test(opBlock),
  'numeric questions offer at-most / at-least');
ok(/\{ id: 'contains'/.test(opBlock), 'free-text questions offer "contains"');
ok(/ops\.push\(\{ id: 'answered'/.test(opBlock) && /ops\.push\(\{ id: 'not-answered'/.test(opBlock),
  'every type can branch on answered / left blank');

// A rule must not be typed against a value the question cannot produce.
const valBlock = ED.slice(ED.indexOf('function valueField('), ED.indexOf('function targetOptions('));
ok(/def\.opts && Array\.isArray\(q\.options\) && q\.options\.length/.test(valBlock),
  'choice questions offer their own options as the rule value');
ok(/q\.type === 'yes-no'/.test(valBlock), 'a yes/no question offers its own two labels');
ok(/type="number"/.test(valBlock), 'numeric questions get a number input');

// Jump targets: only forwards, plus finishing. A backwards jump from the
// builder is an easy way to build a loop the visitor cannot escape.
const tgtBlock = ED.slice(ED.indexOf('function targetOptions('), ED.indexOf('function ensureLogic('));
ok(/for \(var i = qi \+ 1; i < C\.questions\.length; i\+\+\)/.test(tgtBlock),
  'only LATER questions are offered as jump targets');
ok(/value="end"/.test(tgtBlock), '"finish the form" is a target');
ok(/>the next question</.test(tgtBlock), 'the default target is the next question');

// Stale rules are worse than no rules: they look configured and never fire.
ok(/if \(q\.logic\) delete q\.logic;/.test(ED), 'changing a question type clears rules written for the old type');
ok(/if \(r\.goTo === goneId\) r\.goTo = '';/.test(ED), 'deleting a question clears rules pointing at it');
ok(/if \(other\.logic\.otherwise === goneId\) delete other\.logic\.otherwise;/.test(ED),
  'deleting a question clears an Else pointing at it');
ok(/function tidyLogic\(q\)/.test(ED) && /delete q\.logic;/.test(ED), 'an emptied logic block is dropped from the config');

// ── Registration (the 5 places + vercel) ─────────────────────────────────────
ok(/'Form',/.test(CFG), "'Form' is in ALLOWED_WIDGET_TYPES");
ok(/'Form':\s+\{ Spark: 0, Boost: 3, Ignite: -1, Bespoke: -1 \}/.test(CFG), 'plan limits are set (premium draw, locked on Spark)');
ok(/'form':\s+'Form'/.test(CFG), 'the tag maps to the type');
ok(/id: 'form',/.test(INDEX) && /airtableType: 'Form'/.test(INDEX), 'the dashboard registry has a Form entry');
ok(/editorUrl: '\/editor-form'/.test(INDEX) && /demoUrl: '\/demo-form'/.test(INDEX), 'the registry points at the editor + demo');
ok(/access: \{ Spark: 0, Boost: 3, Ignite: -1, Bespoke: -1 \}/.test(INDEX), 'registry access matches PLAN_WIDGET_LIMITS');
ok(/if \(w\.id === 'form'\) \{/.test(INDEX), 'the dashboard has a mini-preview branch');
// A static mock, so the tile never mounts a live widget or fetches a config.
const branch = INDEX.slice(INDEX.indexOf("if (w.id === 'form') {"), INDEX.indexOf("if (w.id === 'enquirypro') {"));
ok(/container\.innerHTML/.test(branch) && !/new TGFormWidget/.test(branch), 'the mini preview is a static mock, not a live mount');

const rw = (VERCEL.rewrites || []).map((r) => r.source);
ok(rw.includes('/editor-form'), 'vercel rewrites /editor-form');
ok(rw.includes('/demo-form'), 'vercel rewrites /demo-form');
ok((VERCEL.headers || []).some((h) => h.source === '/widget-form.js'), 'vercel serves widget-form.js with the widget headers');

// ── Safety ───────────────────────────────────────────────────────────────────
ok(!/\beval\s*\(/.test(ED) && !/new Function/.test(ED), 'no eval / Function constructor');
ok(/function esc\(/.test(ED), 'the editor escapes values before building markup');
ok(/esc\(q\.label \|\| ''\)/.test(ED), 'question labels are escaped into the builder fields');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
