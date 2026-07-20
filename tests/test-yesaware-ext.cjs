'use strict';
// YesAware extension — pure transform tests (tracking.js). No DOM, no chrome.
//   node tests/test-yesaware-ext.cjs
// tracking.js is a browser content script (attaches to `self`), so load it in a
// vm sandbox with a fake `self`, the same way the emailsig suite loads widgets.
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const sandbox = { self: {} };
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../extension/yesaware/tracking.js'), 'utf8'), sandbox);
const T = sandbox.self.YesAwareTracking;
if (!T) { console.error('tracking.js did not attach YesAwareTracking'); process.exit(1); }

let p = 0, f = 0;
function ok(n, c) { if (c) { p++; console.log('  ok   -', n); } else { f++; console.error('  FAIL -', n); } }
function eq(n, a, b) { ok(n + ' (got ' + JSON.stringify(a) + ')', JSON.stringify(a) === JSON.stringify(b)); }

// ── extractLinks ──────────────────────────────────────────────────────────────
eq('extract double-quoted', T.extractLinks('<a href="https://a.com/x">a</a>'), ['https://a.com/x']);
eq('extract single-quoted', T.extractLinks("<a href='https://b.com'>b</a>"), ['https://b.com']);
eq('extract dedupes', T.extractLinks('<a href="https://a.com">1</a><a href="https://a.com">2</a>'), ['https://a.com']);
eq('extract ignores mailto', T.extractLinks('<a href="mailto:x@y.com">m</a>'), []);
eq('extract ignores relative', T.extractLinks('<a href="/rel">r</a>'), []);
eq('extract keeps order', T.extractLinks('<a href="https://a.com">a</a> <a href="https://b.com">b</a>'), ['https://a.com', 'https://b.com']);
eq('extract handles attrs before href', T.extractLinks('<a target="_blank" href="https://a.com">a</a>'), ['https://a.com']);

// ── replaceHref ───────────────────────────────────────────────────────────────
eq('replace keeps double quotes',
  T.replaceHref('<a href="https://a.com/x">a</a>', 'https://a.com/x', 'https://trk/c?t=1'),
  '<a href="https://trk/c?t=1">a</a>');
eq('replace keeps single quotes',
  T.replaceHref("<a href='https://a.com'>a</a>", 'https://a.com', 'https://trk/c'),
  "<a href='https://trk/c'>a</a>");
ok('replace does not touch a longer URL that starts the same',
  T.replaceHref('<a href="https://a.com/xy">a</a>', 'https://a.com/x', 'https://trk') === '<a href="https://a.com/xy">a</a>');

// ── applyTracking ─────────────────────────────────────────────────────────────
var html = '<div>Hi <a href="https://a.com">here</a> and <a href="https://b.com">there</a></div>';
var map = { 'https://a.com': 'https://trk/c?t=1&l=0', 'https://b.com': 'https://trk/c?t=1&l=1' };
var px = '<img src="https://trk/o?t=1&s=x" width="1" height="1" alt="" style="display:none">';
var res = T.applyTracking(html, map, px);
ok('applyTracking rewrites both links', res.indexOf('https://trk/c?t=1&l=0') !== -1 && res.indexOf('https://trk/c?t=1&l=1') !== -1);
ok('applyTracking removes originals', res.indexOf('href="https://a.com"') === -1 && res.indexOf('href="https://b.com"') === -1);
ok('applyTracking appends the pixel once', res.split(px).length === 2);
ok('applyTracking is idempotent on the pixel', T.applyTracking(res, {}, px).split(px).length === 2);
ok('applyTracking with no links still adds pixel', T.applyTracking('<div>hi</div>', {}, px).indexOf(px) !== -1);

// ── urlMapFromLinks ───────────────────────────────────────────────────────────
eq('urlMapFromLinks builds the map',
  T.urlMapFromLinks([{ url: 'https://a.com', trackedUrl: 'https://t/1' }, { url: 'https://b.com', trackedUrl: 'https://t/2' }]),
  { 'https://a.com': 'https://t/1', 'https://b.com': 'https://t/2' });
eq('urlMapFromLinks skips incomplete', T.urlMapFromLinks([{ url: 'https://a.com' }, { trackedUrl: 'x' }, null]), {});

console.log('\nYesAware ext: ' + p + ' passed, ' + f + ' failed');
process.exit(f ? 1 : 0);
