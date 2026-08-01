/**
 * The designed sections: headers, footers, and the ten page categories.
 *
 * WHAT THIS FILE IS FOR THAT tests/content.test.ts IS NOT. That one already
 * checks the machinery: every preset builds a section the schema accepts, the
 * widths add up, the ids are fresh, the thumbnail stays in its box. Those held
 * for the whole library on the day it went from 24 presets to 81, which is
 * reassuring and is not the same as the library being right.
 *
 * THE HOLE THEY LEFT. A block's props are a loose record, so nothing in the
 * schema notices `ratio: '21/9'` on an image when the only shapes are 16/9,
 * 4/3, 1/1, 3/4 and auto. The section parses, the preset builds, and the
 * picture silently renders at its original size. I wrote exactly that on 1 Aug
 * 2026 and nothing caught it until I went looking at the option lists by hand.
 *
 * So the first half of this file checks the preset DATA against the block
 * registry: every type known, every prop key real, every select value one of
 * its own options, every number inside its own range. The second half checks
 * the two things the new categories added: which categories a screen is
 * offered, and that a header behaves like a header.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { blockDefinition, isKnownBlock } from '../lib/content/blocks';
import { isIconName } from '../lib/content/icons';
import { MAX_BORDER, MAX_RADIUS, safeColour } from '../lib/content/schema';
import {
  buildPresetSection,
  categoriesFor,
  categoriesFor as categories,
  presetBars,
  presetById,
  presetsIn,
  PRESET_CATEGORIES,
  SECTION_PRESETS,
  type PresetBlock,
  type SectionPreset,
} from '../lib/content/presets';
import { PAGE_PRESETS } from '../lib/content/presets-page';
import { REGION_PRESETS } from '../lib/content/presets-region';

/** Every block spec in every preset, with enough context to name the culprit. */
function everyBlock(): Array<{ preset: SectionPreset; spec: PresetBlock }> {
  return SECTION_PRESETS.flatMap((preset) =>
    preset.rows.flatMap((row) =>
      row.columns.flatMap((column) => column.map((spec) => ({ preset, spec }))),
    ),
  );
}

// ---------------------------------------------------------------------------
// The library against the block registry
// ---------------------------------------------------------------------------

describe('every preset is built from blocks that exist', () => {
  it('names no block type the registry does not know', () => {
    const unknown = everyBlock()
      .filter(({ spec }) => !isKnownBlock(spec.type))
      .map(({ preset, spec }) => `${preset.id}: ${spec.type}`);

    expect(unknown).toEqual([]);
  });

  /*
   * THE ONE THAT CATCHES A TYPO. Props are merged over the block's defaults, so
   * a key the block does not have is simply carried along: it reaches the
   * renderer, the renderer ignores it, and the preset quietly does not do the
   * thing it says it does. `slideWidth` on a cards block is the shape of it.
   */
  it('sets no prop the block does not have', () => {
    const strays = everyBlock().flatMap(({ preset, spec }) => {
      const definition = blockDefinition(spec.type);
      if (!definition) return [];

      return Object.keys(spec.props ?? {})
        .filter((key) => !(key in definition.defaults))
        .map((key) => `${preset.id}: ${spec.type} has no "${key}"`);
    });

    expect(strays).toEqual([]);
  });

  /*
   * AND THE ONE THAT CATCHES A WRONG VALUE, which is worse than a wrong key
   * because it looks right. An image with `ratio: '21/9'` parses, builds and
   * renders at its original size, and the only way to notice is to read the
   * option list.
   */
  it('gives every select prop one of that field own options', () => {
    const wrong = everyBlock().flatMap(({ preset, spec }) => {
      const definition = blockDefinition(spec.type);
      if (!definition) return [];

      return (definition.fields ?? []).flatMap((field) => {
        if (field.kind !== 'select') return [];
        const value = spec.props?.[field.key];
        if (value === undefined) return [];

        return field.options.some((option) => option.value === value)
          ? []
          : [`${preset.id}: ${spec.type}.${field.key} = ${JSON.stringify(value)}`];
      });
    });

    expect(wrong).toEqual([]);
  });

  /*
   * THE SAME TRAP AGAIN, ONE FIELD KIND ALONG. An icon prop is a plain string
   * and the renderer falls back to printing it as text when it names nothing,
   * which is exactly the behaviour that keeps every pre-1 Aug 2026 page
   * working and exactly the behaviour that would hide a typo in a preset: a
   * misspelt `plane-takoff` would draw the words "plane-takoff" in the tile
   * and nothing would fail.
   *
   * A PRESET IS HELD TO A HIGHER BAR THAN A CLIENT'S PAGE here, deliberately.
   * A client may type an emoji and should be allowed to. A designed section we
   * ship must name a real icon.
   */
  it('names a real icon everywhere a preset sets one', () => {
    const wrong = everyBlock().flatMap(({ preset, spec }) => {
      const definition = blockDefinition(spec.type);
      if (!definition) return [];

      return (definition.fields ?? []).flatMap((field) => {
        if (field.kind !== 'icon') return [];
        const value = spec.props?.[field.key];
        if (value === undefined) return [];

        return isIconName(value)
          ? []
          : [`${preset.id}: ${spec.type}.${field.key} = ${JSON.stringify(value)}`];
      });
    });

    expect(wrong).toEqual([]);
  });

  /*
   * THE SAME TRAP ONE LEVEL UP. A column's box takes a background, and
   * `safeColour` accepts hex, rgb and the three CSS keywords and quietly drops
   * anything else. `background: 'subtle'` on a pricing panel parsed, built and
   * rendered as no background at all: the panel meant to be picked out looked
   * exactly like the two beside it. Caught by reading safeColour, not by any
   * test, which is why this one exists.
   */
  it('gives every column box a background a colour it will accept', () => {
    const wrong = SECTION_PRESETS.flatMap((preset) =>
      preset.rows.flatMap((row) =>
        (row.columnBox ?? []).flatMap((box) => {
          const value = box?.background;
          if (value === undefined) return [];
          return safeColour(value) === undefined
            ? [`${preset.id}: background ${JSON.stringify(value)}`]
            : [];
        }),
      ),
    );

    expect(wrong).toEqual([]);
  });

  it('keeps every column box inside the limits the schema sets', () => {
    const wrong = SECTION_PRESETS.flatMap((preset) =>
      preset.rows.flatMap((row) =>
        (row.columnBox ?? []).flatMap((box, index) => {
          const problems: string[] = [];
          if ((box?.radius ?? 0) > MAX_RADIUS) problems.push(`radius ${box?.radius}`);
          if ((box?.borderWidth ?? 0) > MAX_BORDER) problems.push(`border ${box?.borderWidth}`);
          if (box?.shadow && !['none', 'soft', 'medium', 'strong'].includes(box.shadow)) {
            problems.push(`shadow ${box.shadow}`);
          }
          return problems.map((problem) => `${preset.id} column ${index}: ${problem}`);
        }),
      ),
    );

    expect(wrong).toEqual([]);
  });

  /*
   * AND ONE LEVEL DOWN AGAIN: the rows inside a repeater. A cards block's
   * `items` is a list of objects, and a key none of the repeater's fields
   * declares is carried into the database and ignored by the renderer exactly
   * as a stray top-level prop is. There are a lot of hand-written card and
   * accordion items in this library and no other check reads inside them.
   */
  it('gives every repeater row only the fields that repeater has', () => {
    const strays = everyBlock().flatMap(({ preset, spec }) => {
      const definition = blockDefinition(spec.type);
      if (!definition) return [];

      return (definition.fields ?? []).flatMap((field) => {
        if (field.kind !== 'repeater') return [];
        const rows = spec.props?.[field.key];
        if (!Array.isArray(rows)) return [];

        const allowed = new Set(field.fields.map((inner) => inner.key));
        return rows.flatMap((row) =>
          (row && typeof row === 'object' ? Object.keys(row) : [])
            .filter((key) => !allowed.has(key))
            .map((key) => `${preset.id}: ${spec.type}.${field.key} row has no "${key}"`),
        );
      });
    });

    expect(strays).toEqual([]);
  });

  it('keeps every number prop inside its own range', () => {
    const wrong = everyBlock().flatMap(({ preset, spec }) => {
      const definition = blockDefinition(spec.type);
      if (!definition) return [];

      return (definition.fields ?? []).flatMap((field) => {
        if (field.kind !== 'number') return [];
        const value = spec.props?.[field.key];
        if (typeof value !== 'number') return [];

        const low = typeof field.min === 'number' && value < field.min;
        const high = typeof field.max === 'number' && value > field.max;
        return low || high ? [`${preset.id}: ${spec.type}.${field.key} = ${value}`] : [];
      });
    });

    expect(wrong).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The library as a whole
// ---------------------------------------------------------------------------

describe('the library', () => {
  it('has no two presets sharing an id', () => {
    const ids = SECTION_PRESETS.map((preset) => preset.id);
    expect(new Set(ids).size, `duplicate id in ${ids.join(', ')}`).toBe(ids.length);
  });

  it('finds one by its id, and nothing by a made-up one', () => {
    expect(presetById('header-logo-menu')?.label).toBe('Logo left, menu right');
    expect(presetById('nothing-like-this')).toBeUndefined();
  });

  it('puts every preset in a category the picker knows', () => {
    const known = new Set(PRESET_CATEGORIES.map((entry) => entry.id));
    const orphans = SECTION_PRESETS
      .filter((preset) => !known.has(preset.category))
      .map((preset) => `${preset.id}: ${preset.category}`);

    expect(orphans).toEqual([]);
  });

  it('leaves no category empty, since an empty one is a tab that goes nowhere', () => {
    const empty = PRESET_CATEGORIES
      .filter((entry) => presetsIn(entry.id).length === 0)
      .map((entry) => entry.id);

    expect(empty).toEqual([]);
  });

  it('is the page library and the region library, with nothing else in it', () => {
    expect(SECTION_PRESETS).toHaveLength(PAGE_PRESETS.length + REGION_PRESETS.length);
  });

  /*
   * The copy is placeholder and gets replaced, but it is what a client reads
   * first, so it follows the house rules. An em dash in a preset is an em dash
   * on somebody's live site the day they leave a line in.
   */
  it('has no em dashes anywhere in it', () => {
    for (const file of ['presets-page.ts', 'presets-region.ts']) {
      const source = readFileSync(join(__dirname, '..', 'lib', 'content', file), 'utf8');
      expect(source.includes('—'), `${file} has an em dash`).toBe(false);
    }
  });

  it('gives every preset a name and a line saying what it is for', () => {
    const thin = SECTION_PRESETS
      .filter((preset) => preset.label.trim().length === 0 || preset.description.trim().length < 15)
      .map((preset) => preset.id);

    expect(thin).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Which categories belong on which screen
// ---------------------------------------------------------------------------

describe('the categories a screen is offered', () => {
  /*
   * A header preset and a page section are the same shape, so nothing in the
   * data stops a four-column footer landing in the middle of an About page.
   * This is the only thing that stops it.
   */
  it('never offers a header or a footer on a page', () => {
    const ids = categories('page').map((entry) => entry.id);
    expect(ids).not.toContain('header');
    expect(ids).not.toContain('footer');
  });

  it('offers only headers on the header screen, and only footers on the footer', () => {
    expect(categoriesFor('header').map((entry) => entry.id)).toEqual(['header']);
    expect(categoriesFor('footer').map((entry) => entry.id)).toEqual(['footer']);
  });

  it('offers the page categories on a page, and there are ten of them', () => {
    const ids = categoriesFor('page').map((entry) => entry.id);
    expect(ids).toEqual([
      'blank', 'text', 'features', 'cta', 'gallery',
      'testimonials', 'pricing', 'faq', 'team', 'contact',
    ]);
  });

  it('leads with Blank on a page, because that is where somebody starts', () => {
    expect(categoriesFor('page')[0].id).toBe('blank');
  });

  it('carries every category label through, so the picker has something to draw', () => {
    for (const entry of categoriesFor('page')) {
      expect(entry.label.length, entry.id).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// A header has to behave like a header
// ---------------------------------------------------------------------------

describe('the header presets', () => {
  const headers = presetsIn('header');

  it('there are enough of them to be a choice', () => {
    expect(headers.length).toBeGreaterThanOrEqual(5);
  });

  /*
   * WITHOUT THIS THE MENU CLINGS TO THE TOP OF THE LOGO. A row is top aligned by
   * default, which is right for two columns of words and wrong for a bar where
   * one side is a 60px picture and the other is a 20px line of links.
   */
  it('lines the columns up down the middle, on every row with more than one', () => {
    const flat = headers.flatMap((preset) =>
      preset.rows
        .filter((row) => row.widths.length > 1 && row.align !== 'centre')
        .map((row) => `${preset.id}: ${row.widths.length} columns, align ${row.align}`),
    );

    expect(flat).toEqual([]);
  });

  it('and that alignment reaches the columns, which is where it lives', () => {
    const built = buildPresetSection(presetById('header-logo-menu')!);
    for (const column of built.rows[0].columns) {
      expect(column.align).toBe('centre');
    }
  });

  it('is not as tall as a page section', () => {
    for (const preset of headers) {
      expect(preset.section?.paddingY, preset.id).toBeLessThanOrEqual(24);
    }
  });

  it('has a menu in it, since that is what a header is for', () => {
    const without = headers
      .filter((preset) => !preset.rows.some((row) =>
        row.columns.some((column) => column.some((spec) => spec.type === 'nav'))))
      .map((preset) => preset.id);

    expect(without).toEqual([]);
  });

  /*
   * Sticky and overlay are REGION settings, not section ones, so a preset could
   * not turn them on even if it wanted to. Asserted anyway: if a `section`
   * override ever grows them, a preset quietly deciding a client's header floats
   * over their hero is the sort of thing nobody would think to look for.
   */
  it('decides nothing about sticky or overlay, which are the client to set', () => {
    for (const preset of headers) {
      expect(Object.keys(preset.section ?? {}).sort())
        .toEqual(expect.not.arrayContaining(['sticky', 'overlay']));
    }
  });
});

describe('the footer presets', () => {
  const footers = presetsIn('footer');

  it('there are enough of them to be a choice', () => {
    expect(footers.length).toBeGreaterThanOrEqual(4);
  });

  /*
   * A FOOTER MENU MUST NOT COLLAPSE. The Menu block turns into a burger below
   * the breakpoint, which is right in a header and wrong at the bottom of a
   * page: it would hide the links somebody scrolled all the way down to find
   * behind a button they have to think about.
   */
  it('never lets a footer menu turn into a burger', () => {
    const collapsing = footers.flatMap((preset) =>
      preset.rows.flatMap((row) =>
        row.columns.flatMap((column) =>
          column
            .filter((spec) => spec.type === 'nav' && spec.props?.collapse !== false)
            .map(() => preset.id),
        ),
      ),
    );

    expect(collapsing).toEqual([]);
  });

  it('stacks its link lists downwards, not across', () => {
    const across = footers.flatMap((preset) =>
      preset.rows.flatMap((row) =>
        row.columns.flatMap((column) =>
          column
            .filter((spec) =>
              spec.type === 'nav'
              && row.widths.length > 1
              && spec.props?.layout !== 'column')
            .map(() => `${preset.id}: a menu across a multi-column footer row`),
        ),
      ),
    );

    expect(across).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The thumbnail
// ---------------------------------------------------------------------------

describe('the thumbnail', () => {
  /*
   * Every preset was text until 1 Aug 2026 and text is short, so nothing ever
   * came close to the bottom of the box. The picture categories broke it on the
   * first try: a heading over a two-deep gallery was taller than the half of
   * the box its row had. The suite in content.test.ts caught it, and this is
   * the rule that fixed it, asserted directly.
   */
  it('shrinks a row too tall for its share rather than drawing past the edge', () => {
    const tall: SectionPreset = {
      id: 'test-tall',
      category: 'gallery',
      label: 'Test',
      description: 'A row far taller than its share of the box.',
      rows: [
        { widths: [1], columns: [[{ type: 'image', props: { ratio: '3/4' } }]] },
        { widths: [1], columns: [[{ type: 'image', props: { ratio: '3/4' } }]] },
        { widths: [1], columns: [[{ type: 'image', props: { ratio: '3/4' } }]] },
        { widths: [1], columns: [[{ type: 'image', props: { ratio: '3/4' } }]] },
      ],
    };

    for (const bar of presetBars(tall)) {
      expect(bar.y + bar.height).toBeLessThanOrEqual(1.001);
    }
  });

  it('draws a picture as a block rather than as a line of text', () => {
    const bars = presetBars(presetById('gallery-single-wide')!);
    expect(bars.some((bar) => bar.tone === 'frame')).toBe(true);
  });

  /*
   * Twelve categories of near-identical grey bars would be a picker nobody can
   * use, which would undo the reason the library is data at all. A cheap proxy
   * for "these look different": across the whole library, more than one tone is
   * in use and the picture-heavy categories reach for the frame one.
   */
  it('uses all three tones across the library', () => {
    const tones = new Set(SECTION_PRESETS.flatMap((preset) =>
      presetBars(preset).map((bar) => bar.tone)));

    expect([...tones].sort()).toEqual(['frame', 'soft', 'strong']);
  });

  it('draws a right-aligned menu against the right edge of its column', () => {
    // The whole difference between "Logo left, menu right" and a preset that
    // puts them both on the left is where the second bar sits.
    const bars = presetBars(presetById('header-logo-menu')!);
    const rightmost = Math.max(...bars.map((bar) => bar.x + bar.width));
    expect(rightmost).toBeGreaterThan(0.98);
  });

  it('gives a preset with nothing in it no bars rather than throwing', () => {
    const empty: SectionPreset = {
      id: 'test-empty',
      category: 'blank',
      label: 'Test',
      description: 'A row with an empty column in it.',
      rows: [{ widths: [1], columns: [[]] }],
    };

    expect(presetBars(empty)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The seams, read as source
// ---------------------------------------------------------------------------

function read(...parts: string[]): string {
  return readFileSync(join(__dirname, '..', ...parts), 'utf8');
}

describe('the canvas draws a header as a header', () => {
  /*
   * A published header goes through RegionRenderer and gets a real
   * `<header class="tgs-page tgs-region" data-region="header">`. The canvas
   * renders the same sections through PageRenderer and got a bare `.tgs-page`,
   * so every rule keyed on a region missed it. The footer's hairline was
   * invisible in the editor from the day it shipped and nobody noticed, which
   * is exactly how a preview stops being a preview.
   */
  it('marks the wrapper as a region when it is editing one', () => {
    const renderer = read('components', 'render', 'PageRenderer.tsx');
    expect(renderer).toContain("region ? 'tgs-page tgs-region' : 'tgs-page'");
    expect(renderer).toContain('data-region={region ?? undefined}');
  });

  it('and the editor tells it which one', () => {
    expect(read('components', 'editor', 'Canvas.tsx')).toContain('region={region}');
    expect(read('components', 'editor', 'EditorShell.tsx')).toContain('region={region}');
  });

  /*
   * Sticky and overlay position the header against the document. A canvas has no
   * document to stick to, so carrying them across would lift the header out of
   * the flow of a preview with nothing underneath it.
   */
  it('does not carry sticky or overlay onto the canvas', () => {
    const renderer = read('components', 'render', 'PageRenderer.tsx');
    const wrapper = renderer.slice(renderer.indexOf('<div'), renderer.indexOf('{editable && <InsertPoint index={0} />}'));
    expect(wrapper).not.toContain('data-sticky');
    expect(wrapper).not.toContain('data-overlay');
  });
});

describe('a header bar stays a bar on a phone', () => {
  const css = read('app', 'globals.css');

  /*
   * Everything else stacks below 767px, deliberately, because two columns
   * sharing 390px is two columns nobody can read. A header bar is the one
   * exception: the menu has already collapsed itself to a burger by that width,
   * and stacking turns a 60px bar into a 120px one on the smallest screen there
   * is.
   */
  it('keeps the row holding the menu side by side', () => {
    expect(css).toContain(".tgs-region[data-region='header'] .tgs-row:has(.tgs-nav)");
  });

  /*
   * SCOPED TO THE ROW WITH THE MENU IN IT, not to every row in the header. The
   * two-tier preset has a slim strip carrying opening hours and a phone number
   * above the bar, and those two SHOULD stack: side by side they get 170px each
   * and wrap to three lines.
   */
  it('and only that row, so a strip above it still stacks', () => {
    const rule = css.slice(css.indexOf(".tgs-region[data-region='header'] .tgs-row:has(.tgs-nav)"));
    expect(rule.slice(0, rule.indexOf('}'))).toContain('justify-content: space-between');

    // The rule names :has(.tgs-nav) every time it appears, rather than once
    // followed by a looser selector that would catch the strip too.
    const mentions = css.match(/\.tgs-region\[data-region='header'\] \.tgs-row/g) ?? [];
    const scoped = css.match(/\.tgs-region\[data-region='header'\] \.tgs-row:has\(\.tgs-nav\)/g) ?? [];
    expect(scoped.length).toBe(mentions.length);
  });
});
