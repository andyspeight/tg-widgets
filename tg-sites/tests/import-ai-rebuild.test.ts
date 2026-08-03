/**
 * The AI fallback for a weak import rebuild.
 *
 * The model call itself is not tested here, and cannot be without a key and a
 * bill. What IS tested is everything around it, which is where the behaviour
 * lives: the outline the model is handed, the test that decides when to reach
 * for it, the prompt that pins the client's words, and that a well-formed answer
 * becomes a real Section. The call in between is one line that uses the same ask
 * the section builder already does.
 */

import { describe, expect, it } from 'vitest';

import { importOutline, looksWeak, modelFromImport } from '../lib/import/rebuild';
import { REBUILD_RULES, rebuildSystemPrompt, rebuildUserPrompt } from '../lib/ai/import-rebuild';
import { sectionFromModel } from '../lib/ai/section-build';
import { parseSettings } from '../lib/settings/schema';

const svg = '<svg viewBox="0 0 24 24"><path d="M1 1"></path></svg>';
const wcard = (t: string, b: string) =>
  `<a href="#" class="c"><div class="flex">${svg}<div class="text"><span class="t">${t}</span><p class="b">${b}</p></div></div></a>`;
const LOVEHOLIDAYS =
  '<div class="band"><div class="head"><h2>Why book with us</h2>' +
  '<div class="hero"><img src="https://cdn.test/flamingo.svg" alt="A flamingo float"></div></div>' +
  `<div class="grid">${wcard('Loved by millions', 'Join over 19 million holidaymakers')}${wcard('ATOL protected', 'Financial cover for every package')}</div></div>`;

describe('the outline handed to the model', () => {
  it('pulls the content out as a clean, line-per-piece outline', () => {
    const outline = importOutline({ html: LOVEHOLIDAYS, fields: [], content: {}, label: '' });
    const lines = outline.split('\n');

    // The heading is marked, the picture is noted, and each title and body is
    // its own line, ready for the model to group.
    expect(lines).toContain('# Why book with us');
    expect(lines.some((line) => line.startsWith('[image:'))).toBe(true);
    expect(lines).toContain('Loved by millions');
    expect(lines).toContain('Join over 19 million holidaymakers');
    expect(lines).toContain('ATOL protected');
    // Nothing runs together across the two spans.
    expect(outline).not.toMatch(/millionsJoin|protectedFinancial/);
  });

  it('puts the client\'s current edits into the outline, not the originals', () => {
    const html = '<div><h2>{{tg:t1}}</h2></div>';
    const fields = [{ key: 't1', kind: 'text', label: 'H', value: 'Escape to Crete' }];
    const outline = importOutline({ html, fields, content: { t1: 'Escape to Rhodes' }, label: '' });
    expect(outline).toContain('# Escape to Rhodes');
    expect(outline).not.toContain('Crete');
  });
});

describe('deciding when the deterministic rebuild is too weak', () => {
  const sectionFrom = (model: unknown) => {
    const built = sectionFromModel(model);
    if (!built.ok) throw new Error('bad model in test');
    return built.section;
  };

  it('is weak when the whole design collapsed into one wall of text', () => {
    const blob = 'A long run of words that never became blocks. '.repeat(6);
    const section = sectionFrom({ rows: [{ columns: [{ blocks: [{ type: 'text', props: { html: `<p>${blob}</p>` } }] }] }] });
    expect(looksWeak(section)).toBe(true);
  });

  it('is weak when a section is nearly all prose with no structure', () => {
    const text = { type: 'text', props: { html: '<p>a short line</p>' } };
    const section = sectionFrom({ rows: [{ columns: [{ blocks: [text, text, text, text] }] }] });
    expect(looksWeak(section)).toBe(true);
  });

  it('is NOT weak when the deterministic pass read it well', () => {
    const model = modelFromImport({ html: LOVEHOLIDAYS, fields: [], content: {}, label: 'Why' });
    const built = sectionFromModel(model);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    // A heading, an image and two icon-and-text cards is a good read, not weak.
    expect(looksWeak(built.section)).toBe(false);
  });

  it('is weak when there is nothing at all', () => {
    const section = sectionFrom({ rows: [{ columns: [{ blocks: [{ type: 'heading', props: { html: 'x' } }] }] }] });
    // A single heading is fine; an empty section is the weak one.
    expect(looksWeak(section)).toBe(false);
    expect(looksWeak({ ...section, rows: [] })).toBe(true);
  });
});

describe('the rebuild prompt', () => {
  it('tells the model to rebuild with the exact words, and gives it the kit', () => {
    const system = rebuildSystemPrompt(parseSettings({}));
    expect(system).toContain('REBUILD');
    // The house rule against inventing is present.
    expect(REBUILD_RULES).toMatch(/do not invent|exactly as written/i);
    // The kit and the JSON contract are both in the system prompt.
    expect(system).toContain('icon-item');
    expect(system).toContain('Return ONE section as JSON');
  });

  it('wraps the outline as the content to rebuild', () => {
    const user = rebuildUserPrompt('# Why book with us\nLoved by millions');
    expect(user).toContain('<content>');
    expect(user).toContain('# Why book with us');
    expect(user).toContain('Loved by millions');
  });
});

describe('a well-formed model answer becomes a real section', () => {
  it('turns the JSON the model returns into a validated Section', () => {
    // What a good model would send back for the outline above.
    const answer = JSON.stringify({
      name: 'Why book with us',
      rows: [
        { columns: [{ blocks: [{ type: 'heading', props: { html: 'Why book with us' } }] }] },
        {
          columns: [
            { blocks: [{ type: 'icon-item', props: { icon: 'heart', title: 'Loved by millions', body: 'Join over 19 million holidaymakers' } }] },
            { blocks: [{ type: 'icon-item', props: { icon: 'shield-check', title: 'ATOL protected', body: 'Financial cover for every package' } }] },
          ],
        },
      ],
    });
    const built = sectionFromModel(answer);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const types = built.section.rows.flatMap((r) => r.columns.flatMap((c) => c.blocks.map((b) => b.type)));
    expect(types).toContain('heading');
    expect(types.filter((t) => t === 'icon-item').length).toBe(2);
  });
});
