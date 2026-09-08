/**
 * Club Picker — the title follows the competition, and the dropdown has its own
 * wording (Andy, 8 Sep 2026).
 *
 * Two reports from the editor:
 *   1. "No matter what events you select it always shows Scottish Premiership
 *      as the title." The title only followed a newly picked competition while
 *      it was blank or still read "Premier League", so from the second pick on
 *      it stuck at whatever the first pick made it.
 *   2. The dropdown's placeholder borrowed the GRID prompt ("Pick a badge to
 *      see their fixtures"), which reads wrongly on a <select>. It now carries
 *      its own line: the client's, or a standard one for the kind of grid.
 *
 * Drives the REAL widget in jsdom against a mocked feed, and the REAL title
 * rule lifted from the editor, then guards the sources.
 *
 * Run: node test/clubpicker-wording-smoke.mjs   (npm run test:clubpicker-wording)
 */
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const R = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const WIDGET = R('public/widget-clubpicker.js');
const EDITOR = R('public/editor-clubpicker.html');

let passed = 0, failed = 0;
const ok = (name, cond) => { if (cond) { passed++; console.log('  ✓ ' + name); } else { failed++; console.error('  ✗ ' + name); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const ITEMS = [
  { key: 'celtic', name: 'Celtic', initials: 'CE', hue: 120, home: 19, away: 19, events: 38, homeVenueName: 'Celtic Park' },
  { key: 'rangers', name: 'Rangers', initials: 'RA', hue: 210, home: 19, away: 19, events: 38, homeVenueName: 'Ibrox' },
];

function mount(cfg) {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { runScripts: 'dangerously', pretendToBeVisual: true });
  const { window } = dom;
  window.fetch = async (url) => {
    const u = String(url);
    if (/[?&]view=(teams|performers|venues)(&|$)/.test(u)) return { ok: true, json: async () => ({ items: ITEMS }) };
    return { ok: true, json: async () => ({ events: [] }) };
  };
  const s = window.document.createElement('script'); s.textContent = WIDGET; window.document.body.appendChild(s);
  const el = window.document.createElement('div');
  window.document.body.appendChild(el);
  const w = new window.TGClubPickerWidget(el, Object.assign({ gridOf: 'team', competition: 'scottish-premiership', selectorMode: 'dropdown' }, cfg));
  return { window, w };
}
const placeholderOf = (w) => { const o = w.shadow.querySelector('.tgcp-select option[disabled]'); return o ? o.textContent : null; };

console.log('The dropdown carries its own line, not the grid prompt');
{
  const { w } = mount({});
  await sleep(10);
  ok('a team dropdown says "Choose a team to see their fixtures"', placeholderOf(w) === 'Choose a team to see their fixtures');
  ok('the grid prompt is not borrowed even though the config carries it', placeholderOf(w) !== 'Pick a badge to see their fixtures' && w.cfg.prompt === 'Pick a badge to see their fixtures');
  ok('the select is labelled with the same line', w.shadow.querySelector('.tgcp-select').getAttribute('aria-label') === 'Choose a team to see their fixtures');
}
{
  const { w } = mount({ gridOf: 'performer', competition: '' });
  await sleep(10);
  ok('an artists dropdown says "Choose an act to see their tour dates"', placeholderOf(w) === 'Choose an act to see their tour dates');
}
{
  const { w } = mount({ gridOf: 'venue', competition: '' });
  await sleep(10);
  ok('a venues dropdown says "Choose a venue to see what is on"', placeholderOf(w) === 'Choose a venue to see what is on');
}
{
  const { w } = mount({ dropdownPrompt: '  Pick your club  ' });
  await sleep(10);
  ok("the client's own dropdown wording wins, trimmed", placeholderOf(w) === 'Pick your club');
  w.update({ dropdownPrompt: '' });
  ok('clearing it goes back to the standard line', placeholderOf(w) === 'Choose a team to see their fixtures');
  w.update({ dropdownPrompt: '<b>x</b>'.padEnd(120, 'y') });
  const p = placeholderOf(w);
  ok('own wording is escaped and capped at 80 characters', p && p.length === 80 && !w.shadow.querySelector('.tgcp-select b'));
}
{
  const { w } = mount({ selectorMode: 'both' });
  await sleep(10);
  ok('in "both" mode the dropdown uses the dropdown line', placeholderOf(w) === 'Choose a team to see their fixtures');
  ok('and no grid prompt paragraph is added above the grid', !w.shadow.querySelector('.tgcp-prompt') && !!w.shadow.querySelector('.tgcp-grid'));
}
{
  const { w } = mount({ selectorMode: 'grid' });
  await sleep(10);
  const para = w.shadow.querySelector('.tgcp-prompt');
  ok('grid mode still shows the grid prompt above the badges', para && para.textContent === 'Pick a badge to see their fixtures');
}
{
  const { window } = mount({});
  const f = window.TGClubPickerWidget.dropdownPromptFor;
  ok('the standard line is exposed for the editor placeholder', typeof f === 'function' && f('team') === 'Choose a team to see their fixtures' && f('venue') === 'Choose a venue to see what is on');
}

console.log('\nThe title follows the competition until the client writes their own');
{
  const m = EDITOR.match(/function headingFollowsCompetition\(c\) \{[\s\S]*?\n  \}/);
  ok('the rule is a named function in the editor', !!m);
  const follows = new Function(m[0] + '\nreturn headingFollowsCompetition;')();
  ok('a blank title follows', follows({ heading: '', competitionLabel: 'Premier League' }));
  ok('the starter "Premier League" follows', follows({ heading: 'Premier League', competitionLabel: '' }));
  ok('a title that mirrors the current competition follows (the Scottish Premiership case)',
    follows({ heading: 'Scottish Premiership', competitionLabel: 'Scottish Premiership' }));
  ok("a title the client wrote stays put", !follows({ heading: 'Our football trips', competitionLabel: 'Scottish Premiership' }));
  ok('the decision is taken BEFORE the label changes',
    /var follows = headingFollowsCompetition\(C\);\n\s+C\.competition = v;\n\s+C\.competitionLabel = l;\n\s+if \(follows\) \{ C\.heading = l;/.test(EDITOR));
  ok('the old literal-only rule is gone', !/C\.heading === 'Premier League'\) \{ C\.heading = l;/.test(EDITOR));
}

console.log('\nThe editor carries the dropdown wording');
{
  ok('the config has a dropdownPrompt slot', /dropdownPrompt: '',/.test(EDITOR));
  ok('a "Prompt in the dropdown" field exists', /<label class="tgse-field-label" for="f-dropdownPrompt">Prompt in the dropdown<\/label>/.test(EDITOR) && /id="f-dropdownPrompt" maxlength="80"/.test(EDITOR));
  ok('it is bound and hydrated', /c\.text\('f-dropdownPrompt', 'dropdownPrompt'\);/.test(EDITOR) && /\$\('f-dropdownPrompt'\)\.value = C\.dropdownPrompt \|\| '';/.test(EDITOR));
  ok('the fields follow the selector mode', /function syncPromptUi\(\)/.test(EDITOR) && /c\.seg\('f-selector', 'selectorMode', function \(\) \{ syncPromptUi\(\); \}\);/.test(EDITOR));
  ok('its placeholder is the standard line for the kind of grid', /\$\('f-dropdownPrompt'\)\.placeholder = std\(C\.gridOf\);/.test(EDITOR));
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
