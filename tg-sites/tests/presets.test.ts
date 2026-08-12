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
  presetBlocks,
  presetById,
  presetRoles,
  presetSignature,
  presetsIn,
  presetThumb,
  PRESET_CATEGORIES,
  regionLayoutsFor,
  SECTION_PRESETS,
  type PresetBlock,
  type SectionPreset,
} from '../lib/content/presets';
import { PAGE_PRESETS } from '../lib/content/presets-page';
import { REGION_LAYOUTS, REGION_PRESETS } from '../lib/content/presets-region';

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

  /*
   * A PANEL NOBODY CAN SEE, which is how this failed for a fortnight.
   *
   * PANEL shipped as a radius, some padding and no background, because
   * `safeColour` took a hex and nothing else and a hex baked into a preset is a
   * colour that stops matching the day a client themes their site. A box with
   * no background, no border and no shadow renders as padding: the two presets
   * carrying one drew nothing, and nothing is not an error. The fix was to let
   * safeColour take the theme tokens it always claimed to; this is the check
   * that says so, for every box in the library rather than those two.
   */
  it('gives every column box something an eye can find', () => {
    const invisible = SECTION_PRESETS.flatMap((preset) =>
      preset.rows.flatMap((row) =>
        (row.columnBox ?? []).flatMap((box, index) => {
          if (!box) return [];
          /*
           * A WIDTH IS NOT A BORDER. This check read `borderWidth > 0` when it
           * was first written and passed the whole library, and CARD was
           * drawing `border: 1px solid transparent` at the time: a ring of
           * nothing, reserved and never painted, on all eleven carded presets.
           * The renderer falls back to `transparent` when no colour is set, so
           * the colour is the part that has to be there.
           */
          const bordered = (box.borderWidth ?? 0) > 0
            && Boolean(box.borderColour)
            && box.borderColour !== 'transparent';
          const draws = Boolean(box.background)
            || bordered
            || (box.shadow && box.shadow !== 'none');
          return draws ? [] : [`${preset.id}: column ${index} is padding and nothing else`];
        }),
      ),
    );

    expect(invisible).toEqual([]);
  });

  /*
   * THE SAME FAILURE ONE STEP ON. A panel tinted with the site's subtle surface
   * is exactly the colour a `subtle` section is painted, so the two together
   * are a panel drawn in the background's own colour. It parses, it renders,
   * and it looks like the preset forgot to card the row.
   */
  it('never tints a panel the colour of the section it sits on', () => {
    const TONE_BACKGROUND: Record<string, string> = {
      subtle: 'var(--tgs-surface-alt)',
      dark: 'var(--tgs-surface-dark)',
      accent: 'var(--tgs-primary)',
    };

    const lost = SECTION_PRESETS.flatMap((preset) => {
      const behind = TONE_BACKGROUND[preset.section?.tone ?? 'light'];
      if (!behind) return [];

      return preset.rows.flatMap((row) =>
        (row.columnBox ?? []).flatMap((box, index) =>
          box?.background === behind && !(box.borderWidth ?? 0)
            ? [`${preset.id}: column ${index} is the same colour as its section`]
            : [],
        ),
      );
    });

    expect(lost).toEqual([]);
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
    expect(presetById('header-cta-bar')?.label).toBe('Bar with a button');
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

  /*
   * PINNED, so adding a category is a decision rather than a side effect. Went
   * from ten to sixteen on 2 Aug 2026: hero, logos, stats, steps, blog and
   * banner, chosen against Relume's own taxonomy.
   *
   * THE ORDER IS THE ORDER SOMEBODY BUILDS A PAGE, which is why hero sits second
   * and banner sits late. Blank stays first because that is where a person who
   * knows what they want starts.
   */
  it('offers the page categories on a page, in build order', () => {
    const ids = categoriesFor('page').map((entry) => entry.id);
    expect(ids).toEqual([
      'blank', 'hero', 'text', 'features', 'cta', 'gallery',
      'testimonials', 'logos', 'stats', 'steps', 'pricing',
      'faq', 'team', 'blog', 'banner', 'contact',
    ]);
  });

  /*
   * Relume calls a hero a "Header Section" and we cannot, because `header`
   * already means the site's own navbar region. Two different things, one word.
   * This is here so a rename gets caught rather than quietly breaking the
   * header screen.
   */
  it('keeps hero and header as separate categories on separate screens', () => {
    expect(categoriesFor('page').some((entry) => entry.id === 'hero')).toBe(true);
    expect(categoriesFor('page').some((entry) => entry.id === 'header')).toBe(false);
    expect(categoriesFor('header').map((entry) => entry.id)).toEqual(['header']);
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
    const built = buildPresetSection(presetById('header-cta-bar')!);
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
// The region layouts: the bare shapes on the Layouts tab
// ---------------------------------------------------------------------------

describe('the region layouts', () => {
  it('offers header shapes on the header, footer shapes on the footer, none on a page', () => {
    expect(regionLayoutsFor('header').length).toBeGreaterThan(0);
    expect(regionLayoutsFor('footer').length).toBeGreaterThan(0);
    expect(regionLayoutsFor('header').every((preset) => preset.category === 'header')).toBe(true);
    expect(regionLayoutsFor('footer').every((preset) => preset.category === 'footer')).toBe(true);
    expect(regionLayoutsFor('page')).toEqual([]);
  });

  /*
   * A layout is on the Layouts tab and a designed preset is on the Designed tab,
   * and the whole point of the split is that a shape shows on one, not both. So
   * they must not share an id and a layout must never turn up in the designed
   * listing, or a client would meet the same thing twice with two different
   * promises about it.
   */
  it('is kept out of the designed listing, which is for the dressed ones', () => {
    const designed = new Set(SECTION_PRESETS.map((preset) => preset.id));
    const clash = REGION_LAYOUTS.filter((preset) => designed.has(preset.id)).map((preset) => preset.id);
    expect(clash).toEqual([]);
  });

  it('builds a real section, the same as any preset', () => {
    for (const layout of REGION_LAYOUTS) {
      expect(buildPresetSection(layout).rows.length, layout.id).toBeGreaterThan(0);
    }
  });

  it('gives every header layout a menu, since that is what a header is for', () => {
    const without = regionLayoutsFor('header')
      .filter((preset) => !preset.rows.some((row) =>
        row.columns.some((column) => column.some((spec) => spec.type === 'nav'))))
      .map((preset) => preset.id);

    expect(without).toEqual([]);
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
   * Eighteen categories of near-identical grey bars would be a picker nobody
   * can use, which would undo the reason the library is data at all. A cheap
   * proxy for "these look different": across the whole library every tone is in
   * use, the picture-heavy categories reach for the frame one and the ones
   * built on icons reach for the icon one.
   *
   * The fourth arrived on 2 Aug 2026. Before it, an icon tile drew as a short
   * strong bar, which is also what a button draws as.
   */
  it('uses all four bar tones across the library', () => {
    const tones = new Set(SECTION_PRESETS.flatMap((preset) =>
      presetBars(preset).map((bar) => bar.tone)));

    expect([...tones].sort()).toEqual(['frame', 'icon', 'soft', 'strong']);
  });

  it('draws a right-aligned menu against the right edge of its column', () => {
    // The whole difference between "Logo left, menu right" and a preset that
    // puts them both on the left is where the second bar sits. The logo-and-menu
    // shape is a layout now, so it is drawn the same way from there.
    const logoMenu = REGION_LAYOUTS.find((preset) => preset.id === 'layout-header-logo-menu')!;
    const bars = presetBars(logoMenu);
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

/*
 * ---------------------------------------------------------------------------
 * The rest of the thumbnail: the ground and the cards
 *
 * WHAT THESE ARE FOR. buildPresetSection has always understood `section.tone`
 * and buildRow has understood `columnBox` since the card presets landed, and
 * presetBars knew about neither, so a preset could gain a tinted background and
 * a row of cards and the picture in the picker would not move. Design that the
 * picker cannot show is design nobody sees, because the picker is where it is
 * chosen. These hold the two halves together.
 * ---------------------------------------------------------------------------
 */
describe('the thumbnail ground and panels', () => {
  it('reports the section tone the preset builds', () => {
    for (const preset of SECTION_PRESETS) {
      expect(presetThumb(preset).tone, preset.id)
        .toBe(buildPresetSection(preset).tone);
    }
  });

  it('draws a panel for every carded column, and none for a plain one', () => {
    const carded = SECTION_PRESETS.filter((preset) =>
      preset.rows.some((row) => row.columnBox?.some(Boolean)));

    // Worth knowing this is a real sample rather than a vacuous pass.
    expect(carded.length).toBeGreaterThan(5);

    for (const preset of carded) {
      const wanted = preset.rows.reduce(
        (sum, row) => sum + (row.columnBox?.filter(Boolean).length ?? 0),
        0,
      );
      expect(presetThumb(preset).panels.length, preset.id).toBe(wanted);
    }

    expect(presetThumb(presetById('text-intro')!).panels).toEqual([]);
  });

  it('tells a bordered card from a filled panel', () => {
    // CARD has a borderWidth, PANEL does not. The picker draws a hairline on
    // one and a tint on the other, so the difference has to survive to here.
    const cards = presetThumb(presetById('pricing-three-panels')!).panels;
    expect(cards.every((panel) => panel.tone === 'card')).toBe(true);

    const panels = presetThumb(presetById('faq-with-contact')!).panels;
    expect(panels.some((panel) => panel.tone === 'panel')).toBe(true);
  });

  it('keeps the panels inside the box and the bars inside their panel', () => {
    for (const preset of SECTION_PRESETS) {
      const { panels, bars } = presetThumb(preset);

      for (const panel of panels) {
        expect(panel.x, `${preset.id} panel x`).toBeGreaterThanOrEqual(0);
        expect(panel.y, `${preset.id} panel y`).toBeGreaterThanOrEqual(0);
        expect(panel.x + panel.width, `${preset.id} panel right`).toBeLessThanOrEqual(1.001);
        expect(panel.y + panel.height, `${preset.id} panel bottom`).toBeLessThanOrEqual(1.001);
      }

      /*
       * A bar drawn across a card's border is the failure this catches, and it
       * is the one insetting the content is for. Only bars that fall within a
       * panel's columns are checked: a heading in the row above a card grid is
       * legitimately outside every panel.
       */
      for (const panel of panels) {
        const inside = bars.filter((bar) =>
          bar.x >= panel.x - 0.001
          && bar.x + bar.width <= panel.x + panel.width + 0.001
          && bar.y >= panel.y - 0.001
          && bar.y + bar.height <= panel.y + panel.height + 0.001);

        for (const bar of inside) {
          expect(bar.x, `${preset.id} bar against the left edge of a card`)
            .toBeGreaterThan(panel.x + 0.004);
        }
      }
    }
  });

  /*
   * STRETCH IS THE DEFAULT AND IT IS WHAT A CARD GRID WANTS: three cards of
   * unequal wordiness still line up along the bottom, because on the page the
   * columns stretch to their row.
   *
   * This started life as a test that no preset both cards a row and aligns it,
   * written to hold an assumption the panel maths was built on. It failed on
   * the first run: "Three panels, one picked out" does exactly that, on purpose,
   * and the assumption was simply wrong. So the maths learned about align and
   * the test became this pair.
   */
  it('draws the cards in a stretched row at one height', () => {
    const panels = presetThumb(presetById('pricing-three-panels')!).panels;
    const heights = new Set(panels.map((panel) => panel.height.toFixed(4)));

    expect(panels.length).toBe(3);
    expect(heights.size).toBe(1);
  });

  it('lets the panels in an aligned row keep their own heights, centred', () => {
    const { panels } = presetThumb(presetById('pricing-one-picked-out')!);
    expect(panels.length).toBe(3);

    // The middle one carries an extra line and a bigger price, so it is taller.
    const [left, middle, right] = panels;
    expect(middle.height).toBeGreaterThan(left.height);
    expect(middle.height).toBeGreaterThan(right.height);

    // Centred against it rather than hanging from the top, which is what
    // align: 'centre' does on the page and what makes the lifted one sit proud.
    expect(left.y).toBeGreaterThan(middle.y);
    expect((left.y + left.height / 2) - (middle.y + middle.height / 2))
      .toBeCloseTo(0, 3);
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

/*
 * ---------------------------------------------------------------------------
 * The grid template
 *
 * A percentage grid track resolves against the whole content box and the gap is
 * then ADDED, so a row of `33.33% 33.33% 33.33%` with a 24px gap is 48px wider
 * than the thing containing it and its last column is cut off. That is what the
 * renderer emitted until 2 Aug 2026, on every multi-column row on every page,
 * and `overflow-x: hidden` on .tgs-page meant it never even showed a scrollbar.
 *
 * Measured in a browser to confirm it, and held here as source because the unit
 * suite has no layout engine in it. A fraction is the fix and it is one word, so
 * one word is what this guards.
 * ---------------------------------------------------------------------------
 */
describe('a row divides the space left after its gaps', () => {
  it('sizes its columns in fractions rather than percentages', () => {
    const renderer = read('components', 'render', 'PageRenderer.tsx');
    expect(renderer).toContain("`minmax(0, ${column.width}fr)`");
    expect(renderer).not.toContain('`${column.width}%`');
  });

  /*
   * minmax(0, Nfr) rather than a bare Nfr. A bare fraction has an `auto`
   * minimum, so one long word or a wide image pushes its track past its share
   * and the overflow comes straight back in a form that is harder to see.
   */
  it('floors every track at zero so content cannot widen it', () => {
    const renderer = read('components', 'render', 'PageRenderer.tsx');
    const line = renderer.split('\n').find((row) => row.includes("'--tgs-cols'"));
    expect(line).toBeDefined();
    expect(line).toContain('minmax(0,');
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

// ---------------------------------------------------------------------------
// The mapping contract
// ---------------------------------------------------------------------------

/**
 * What lets a design from Figma, Relume or the slicer be MAPPED onto a preset
 * rather than carried in frozen.
 *
 * A matcher can read a preset's shape off its rows, because the blocks are right
 * there. What it cannot read is INTENT: "there is an h6 and an h2" does not say
 * which is the section's title. So roles are derived, and a preset declares one
 * only to correct the derivation.
 *
 * THE DERIVATION IS THE RULE FROM starters.ts, which exists because a real bug:
 * firstBlock(section, 'heading') wrote the company name into the h6 eyebrow and
 * left the h2 saying "Everything in one place". Biggest heading, never first.
 */
describe('the mapping contract', () => {
  it('never finds two titles in one section', () => {
    for (const preset of SECTION_PRESETS) {
      const titles = [...presetRoles(preset).values()].filter((role) => role === 'title');
      expect(titles.length, `${preset.id} has ${titles.length} titles`).toBeLessThanOrEqual(1);
    }
  });

  it('gives every block a role, so nothing is invisible to a matcher', () => {
    for (const preset of SECTION_PRESETS) {
      const roles = presetRoles(preset);
      for (const block of presetBlocks(preset)) {
        expect(roles.get(block), `${preset.id}: ${block.type} has no role`).toBeTruthy();
      }
    }
  });

  /*
   * THE POINT OF THE WHOLE THING. A hero is the section a page opens with, so a
   * design being mapped onto one has to find a title and somewhere to go next.
   * A hero with no title is not a hero, and one with no action is a poster.
   */
  it('gives every hero a title', () => {
    const heroes = presetsIn('hero');
    expect(heroes.length).toBeGreaterThan(4);

    for (const hero of heroes) {
      const roles = [...presetRoles(hero).values()];
      expect(roles, `${hero.id} has no title`).toContain('title');
    }
  });

  /*
   * The media axis is what stops a Figma hero with the photograph on the right
   * landing in the preset that puts it on the left. Worth asserting that the
   * library actually covers the axis rather than happening to be all one way.
   */
  it('covers every media position across the heroes', () => {
    const seen = new Set(presetsIn('hero').map((preset) => presetSignature(preset).media));

    expect(seen).toContain('none');
    expect(seen).toContain('left');
    expect(seen).toContain('right');
    expect(seen).toContain('below');
  });

  it('covers both alignments across the heroes', () => {
    const seen = new Set(presetsIn('hero').map((preset) => presetSignature(preset).align));
    expect([...seen].sort()).toEqual(['centre', 'left']);
  });

  /*
   * A GRID IS TWO COLUMNS SAYING THE SAME THING, not just two columns. Without
   * that distinction every split hero would be reported as a repeater and a
   * matcher would try to fill it with a list of cards.
   */
  it('tells a grid from a split section', () => {
    const split = SECTION_PRESETS.find((preset) => preset.id === 'hero-split-right');
    expect(split && presetSignature(split).repeated).toBe(false);
    expect(split && presetSignature(split).media).toBe('right');

    const mirrored = SECTION_PRESETS.find((preset) => preset.id === 'hero-split-left');
    expect(mirrored && presetSignature(mirrored).media).toBe('left');
  });

  it('reads a category off the preset it came from', () => {
    for (const preset of SECTION_PRESETS) {
      expect(presetSignature(preset).category).toBe(preset.category);
    }
  });
});
