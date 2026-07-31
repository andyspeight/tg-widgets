/**
 * The rules that must not quietly break.
 *
 * Width normalisation and sanitisation get the most attention here, because
 * they are the two places where a bug is invisible until it is expensive:
 * a row that does not sum to 100 looks fine until a client drags it, and a
 * sanitiser hole looks fine until someone finds it.
 */

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SECTION_PADDING,
  LEGACY_PADDING,
  MAX_SECTION_PADDING,
  MIN_COLUMN_WIDTH,
  normaliseSectionPadding,
  normaliseWidths,
  parsePage,
  WIDTH_SUM_TOLERANCE,
  PADDING_PRESETS,
  boxIsEmpty,
  DEFAULT_GAP,
  EMPTY_BOX,
  LEGACY_GAP,
  MAX_GAP,
  MAX_PADDING,
  normaliseGap,
  px,
  safeColour,
  STACK_BREAKPOINTS,
} from '../lib/content/schema';
import { createColumn, createPage, createRow, createSectionFromLayout, newId } from '../lib/content/factory';
import {
  buildPresetSection,
  presetBars,
  presetById,
  presetsIn,
  PRESET_CATEGORIES,
  SECTION_PRESETS,
} from '../lib/content/presets';
import { LAYOUTS, layoutCells } from '../lib/content/layouts';
import {
  addBlock,
  addColumn,
  evenColumns,
  moveBlockTo,
  moveColumn,
  moveSection,
  parsePathKey,
  pathKey,
  removeColumn,
  resizeColumnBoundary,
} from '../lib/content/tree';
import { createBlock } from '../lib/content/factory';
import { sanitiseHtml, safeUrl } from '../lib/content/sanitise';
import { sanitiseStyle } from '../lib/content/styles';
import { sanitisePage } from '../lib/content/sanitise-page';
import { resolveVideo } from '../lib/content/video';
import { SEED_PAGE } from '../lib/content/seed';

const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);

// ---------------------------------------------------------------------------

describe('normaliseWidths', () => {
  it('always sums to 100', () => {
    const cases = [
      [50, 50],
      [1, 1, 1],
      [33.33, 33.33, 33.34],
      [10, 90],
      [70, 20, 10],
      [1, 2, 3, 4, 5, 6],
      [99.99, 0.01],
    ];
    for (const widths of cases) {
      expect(sum(normaliseWidths(widths))).toBeCloseTo(100, 2);
    }
  });

  it('lifts anything below the minimum', () => {
    const result = normaliseWidths([98, 2]);
    expect(Math.min(...result)).toBeGreaterThanOrEqual(MIN_COLUMN_WIDTH);
    expect(sum(result)).toBeCloseTo(100, 2);
  });

  it('survives NaN, zero and negatives without poisoning the row', () => {
    const result = normaliseWidths([Number.NaN, 0, -40]);
    expect(result.every((width) => Number.isFinite(width))).toBe(true);
    expect(Math.min(...result)).toBeGreaterThanOrEqual(MIN_COLUMN_WIDTH);
    expect(sum(result)).toBeCloseTo(100, 2);
  });

  it('handles an empty row', () => {
    expect(normaliseWidths([])).toEqual([]);
  });

  it('falls back to equal columns when the minimum cannot be met', () => {
    const result = normaliseWidths(Array.from({ length: 12 }, () => 1));
    expect(sum(result)).toBeCloseTo(100, 1);
  });
});

// ---------------------------------------------------------------------------

describe('resizeColumnBoundary', () => {
  const base = (() => {
    const page = createPage('Test');
    page.sections[0].rows[0] = createRow('1-1');
    return page;
  })();

  it('moves width between the two adjacent columns only', () => {
    const three = createPage('T');
    three.sections[0].rows[0] = createRow('1-1-1');
    const before = three.sections[0].rows[0].columns[2].width;

    const after = resizeColumnBoundary(three, 0, 0, 0, 10);
    const columns = after.sections[0].rows[0].columns;

    expect(columns[0].width).toBeGreaterThan(33);
    expect(columns[1].width).toBeLessThan(34);
    expect(columns[2].width).toBeCloseTo(before, 1);
    expect(sum(columns.map((c) => c.width))).toBeCloseTo(100, 2);
  });

  it('never drives a column below the minimum, however hard it is dragged', () => {
    let page = base;
    for (let i = 0; i < 20; i += 1) {
      page = resizeColumnBoundary(page, 0, 0, 0, 25);
    }
    const columns = page.sections[0].rows[0].columns;
    expect(Math.min(...columns.map((c) => c.width))).toBeGreaterThanOrEqual(MIN_COLUMN_WIDTH);
    expect(sum(columns.map((c) => c.width))).toBeCloseTo(100, 2);
  });

  it('is a no-op on a boundary that does not exist', () => {
    const after = resizeColumnBoundary(base, 0, 0, 5, 10);
    expect(after.sections[0].rows[0].columns.map((c) => c.width)).toEqual(
      base.sections[0].rows[0].columns.map((c) => c.width),
    );
  });
});

// ---------------------------------------------------------------------------

describe('columns', () => {
  it('adding a column keeps the row at 100', () => {
    let page = createPage('T');
    page = addColumn(page, 0, 0);
    page = addColumn(page, 0, 0);
    const columns = page.sections[0].rows[0].columns;
    expect(columns).toHaveLength(3);
    expect(sum(columns.map((c) => c.width))).toBeCloseTo(100, 2);
  });

  it('removing a column rescues its blocks rather than deleting them', () => {
    let page = createPage('T');
    page.sections[0].rows[0] = createRow('1-1');
    page = addBlock(page, 0, 0, 1, createBlock('heading'));
    page = addBlock(page, 0, 0, 1, createBlock('text'));

    page = removeColumn(page, 0, 0, 1);

    const columns = page.sections[0].rows[0].columns;
    expect(columns).toHaveLength(1);
    expect(columns[0].blocks.map((b) => b.type)).toEqual(['heading', 'text']);
    expect(columns[0].width).toBeCloseTo(100, 2);
  });

  it('refuses to remove the last column', () => {
    const page = createPage('T');
    expect(removeColumn(page, 0, 0, 0).sections[0].rows[0].columns).toHaveLength(1);
  });

  it('evens columns out', () => {
    let page = createPage('T');
    page.sections[0].rows[0] = createRow('3-1');
    page = evenColumns(page, 0, 0);
    const [a, b] = page.sections[0].rows[0].columns;
    expect(a.width).toBeCloseTo(b.width, 1);
  });
});

// ---------------------------------------------------------------------------

/*
 * Andy, 31 Jul 2026: move a column left and right; stack a row's columns
 * vertically; and the same for the content inside a column.
 */
describe('moveColumn', () => {
  const twoColumns = () => {
    const page = createPage('T');
    page.sections[0].rows[0] = createRow('3-1');
    return page;
  };

  it('takes the width with it', () => {
    // A 75/25 row whose wide column moves right becomes 25/75. The other
    // reading, where the contents swap but the widths stay, is the one that
    // surprises: a picture moved across should not arrive a different size.
    const before = twoColumns();
    const [wide, narrow] = before.sections[0].rows[0].columns;

    const after = moveColumn(before, 0, 0, 0, 1);
    const columns = after.sections[0].rows[0].columns;

    expect(columns.map((c) => c.id)).toEqual([narrow.id, wide.id]);
    expect(columns[1].width).toBeCloseTo(wide.width, 2);
    expect(columns[0].width).toBeCloseTo(narrow.width, 2);
  });

  it('still sums to 100, because the same widths in a new order do', () => {
    const after = moveColumn(twoColumns(), 0, 0, 0, 1);
    expect(sum(after.sections[0].rows[0].columns.map((c) => c.width))).toBeCloseTo(100, 2);
  });

  it('is a no-op off either end', () => {
    const before = twoColumns();
    const ids = before.sections[0].rows[0].columns.map((c) => c.id);

    for (const [from, to] of [[0, -1], [1, 2], [0, 9]]) {
      const after = moveColumn(before, 0, 0, from, to);
      expect(after.sections[0].rows[0].columns.map((c) => c.id)).toEqual(ids);
    }
  });

  it('leaves the blocks with their own column', () => {
    let page = twoColumns();
    page = addBlock(page, 0, 0, 0, createBlock('heading'));
    page = addBlock(page, 0, 0, 1, createBlock('text'));

    const after = moveColumn(page, 0, 0, 0, 1);
    const columns = after.sections[0].rows[0].columns;
    expect(columns[0].blocks.map((b) => b.type)).toEqual(['text']);
    expect(columns[1].blocks.map((b) => b.type)).toEqual(['heading']);
  });
});

describe('stacking a row always', () => {
  /** The seed page with one field on its first row changed, parsed. */
  const withRow = (patch: Record<string, unknown>) => {
    const raw = JSON.parse(JSON.stringify(SEED_PAGE));
    Object.assign(raw.sections[0].rows[0], patch);
    return parsePage(raw);
  };

  it('accepts always as a stacking point', () => {
    const result = withRow({ stackBelow: 'always' });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.page.sections[0].rows[0].stackBelow).toBe('always');
  });

  it('still refuses never, because a row that cannot stack breaks a phone', () => {
    // The whole reason stackBelow has no 'never': a row that stays side by side
    // runs off the edge of a phone, which is what the schema header is about.
    expect(withRow({ stackBelow: 'never' }).ok).toBe(false);
  });

  it('resolves always to a width nothing is wider than', () => {
    expect(STACK_BREAKPOINTS.always).toBe(Number.POSITIVE_INFINITY);
    expect(STACK_BREAKPOINTS.always).toBeGreaterThan(STACK_BREAKPOINTS.tablet);
  });
});

describe('how the content in a column sits', () => {
  const withColumn = (patch: Record<string, unknown>) => {
    const raw = JSON.parse(JSON.stringify(SEED_PAGE));
    Object.assign(raw.sections[0].rows[0].columns[0], patch);
    return parsePage(raw);
  };

  it('is stacked unless it says otherwise', () => {
    expect(createColumn(50).flow).toBe('stacked');
  });

  it('keeps side by side when that is what was saved', () => {
    const result = withColumn({ flow: 'row' });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.page.sections[0].rows[0].columns[0].flow).toBe('row');
  });

  it('refuses a flow it does not recognise', () => {
    expect(withColumn({ flow: 'diagonal' }).ok).toBe(false);
  });

  it('defaults it on a column saved before the field existed', () => {
    const raw = JSON.parse(JSON.stringify(SEED_PAGE));
    delete raw.sections[0].rows[0].columns[0].flow;

    const result = parsePage(raw);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.page.sections[0].rows[0].columns[0].flow).toBe('stacked');
  });
});

describe('paths', () => {
  it('round trips through pathKey and parsePathKey', () => {
    const paths = [
      { kind: 'page' as const },
      { kind: 'section' as const, section: 2 },
      { kind: 'row' as const, section: 1, row: 3 },
      { kind: 'column' as const, section: 0, row: 1, column: 2 },
      { kind: 'block' as const, section: 4, row: 5, column: 6, block: 7 },
    ];
    for (const path of paths) {
      expect(parsePathKey(pathKey(path))).toEqual(path);
    }
  });

  it('rejects rubbish', () => {
    for (const key of ['', 'nonsense', 's', 'sXrY', 'r1c2', null, undefined]) {
      expect(parsePathKey(key as string)).toBeNull();
    }
  });
});

// ---------------------------------------------------------------------------

describe('moveBlockTo', () => {
  it('reorders within a column without losing the block', () => {
    let page = createPage('T');
    page = addBlock(page, 0, 0, 0, createBlock('heading'));
    page = addBlock(page, 0, 0, 0, createBlock('text'));
    page = addBlock(page, 0, 0, 0, createBlock('button'));

    page = moveBlockTo(page, { section: 0, row: 0, column: 0, block: 0 }, { section: 0, row: 0, column: 0, index: 2 });

    expect(page.sections[0].rows[0].columns[0].blocks.map((b) => b.type)).toEqual([
      'text',
      'heading',
      'button',
    ]);
  });

  it('moves a block into another column', () => {
    let page = createPage('T');
    page.sections[0].rows[0] = createRow('1-1');
    page = addBlock(page, 0, 0, 0, createBlock('heading'));

    page = moveBlockTo(page, { section: 0, row: 0, column: 0, block: 0 }, { section: 0, row: 0, column: 1 });

    expect(page.sections[0].rows[0].columns[0].blocks).toHaveLength(0);
    expect(page.sections[0].rows[0].columns[1].blocks).toHaveLength(1);
  });
});

describe('moveSection', () => {
  it('reorders sections', () => {
    const page = moveSection(SEED_PAGE, 0, 2);
    expect(page.sections.map((s) => s.id)).toEqual(['sec_why', 'sec_cta', 'sec_hero']);
    // The original is untouched. Undo depends on this.
    expect(SEED_PAGE.sections[0].id).toBe('sec_hero');
  });
});

// ---------------------------------------------------------------------------

describe('parsePage', () => {
  it('accepts the seed page', () => {
    const result = parsePage(SEED_PAGE);
    expect(result.ok).toBe(true);
  });

  it('repairs widths that do not quite sum to 100', () => {
    const page = JSON.parse(JSON.stringify(SEED_PAGE));
    page.sections[0].rows[0].columns[0].width = 54.99;
    page.sections[0].rows[0].columns[1].width = 44.99;

    const result = parsePage(page);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const widths = result.page.sections[0].rows[0].columns.map((c) => c.width);
      expect(sum(widths)).toBeCloseTo(100, 2);
    }
  });

  it('rejects a tree that is actually malformed', () => {
    expect(parsePage({ version: 1 }).ok).toBe(false);
    expect(parsePage(null).ok).toBe(false);
    expect(parsePage({ version: 2, id: 'x', title: 'x', slug: '', sections: [] }).ok).toBe(false);
  });

  it('rejects a bad slug', () => {
    const page = { ...SEED_PAGE, slug: 'Not A Slug' };
    expect(parsePage(page).ok).toBe(false);
  });

  it('keeps an unknown block type rather than destroying it', () => {
    const page = JSON.parse(JSON.stringify(SEED_PAGE));
    page.sections[0].rows[0].columns[0].blocks.push({
      id: 'blk_future',
      type: 'something-from-the-future',
      props: { a: 1 },
    });

    const result = parsePage(page);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const types = result.page.sections[0].rows[0].columns[0].blocks.map((b) => b.type);
      expect(types).toContain('something-from-the-future');
    }
  });
});

// ---------------------------------------------------------------------------

describe('sanitiseHtml', () => {
  it('keeps ordinary rich text', () => {
    const html = '<p>Hello <strong>there</strong>, see <a href="/greece">Greece</a>.</p>';
    expect(sanitiseHtml(html)).toContain('<strong>there</strong>');
    expect(sanitiseHtml(html)).toContain('href="/greece"');
  });

  it('removes scripts and their contents', () => {
    const out = sanitiseHtml('<p>ok</p><script>alert(1)</script>');
    expect(out).not.toContain('script');
    expect(out).not.toContain('alert');
  });

  it('removes event handlers', () => {
    const out = sanitiseHtml('<p onclick="alert(1)">hi</p>');
    expect(out).not.toContain('onclick');
    expect(out).toContain('hi');
  });

  it('blocks javascript: and data: urls', () => {
    expect(sanitiseHtml('<a href="javascript:alert(1)">x</a>')).not.toContain('javascript');
    expect(sanitiseHtml('<a href="data:text/html,<script>">x</a>')).not.toContain('data:');
  });

  it('blocks protocol-relative urls', () => {
    expect(safeUrl('//evil.example.com')).toBeNull();
  });

  it('sees through control characters in a scheme', () => {
    expect(safeUrl('java\u0000script:alert(1)')).toBeNull();
    expect(safeUrl('java\tscript:alert(1)')).toBeNull();
  });

  it('drops tags that are not on the list but keeps their text', () => {
    const out = sanitiseHtml('<p>before <marquee>middle</marquee> after</p>');
    expect(out).not.toContain('marquee');
    expect(out).toContain('middle');
  });

  it('adds rel to links opening a new tab', () => {
    const out = sanitiseHtml('<a href="https://example.com" target="_blank">x</a>');
    expect(out).toContain('rel="noopener noreferrer"');
  });

  it('closes tags the author left open', () => {
    const out = sanitiseHtml('<p>one<p>two');
    expect((out.match(/<\/p>/g) ?? []).length).toBe(2);
  });

  it('does not allow iframes in rich text at all', () => {
    expect(sanitiseHtml('<iframe src="https://www.youtube.com/embed/x"></iframe>')).not.toContain('iframe');
  });

  it('allows an iframe in an embed only from an allowlisted host', () => {
    const good = sanitiseHtml('<iframe src="https://www.youtube.com/embed/abc"></iframe>', 'embed');
    expect(good).toContain('iframe');

    const bad = sanitiseHtml('<iframe src="https://evil.example.com/x"></iframe>', 'embed');
    expect(bad).not.toContain('iframe');
  });

  it('returns an empty string for anything that is not a string', () => {
    for (const value of [null, undefined, 42, {}, []]) {
      expect(sanitiseHtml(value)).toBe('');
    }
  });
});

// ---------------------------------------------------------------------------
// Inline styling
// ---------------------------------------------------------------------------

/*
 * The sanitiser used to drop every style attribute, which is why the toolbar had
 * no colour or size: they would have looked like they worked and then been lost
 * on save. Andy asked for them back on 30 Jul 2026, so `style` is admitted and
 * lib/content/styles.ts decides what may be inside it.
 *
 * The tests that matter are the ones about what does NOT get through. A closed
 * set is only closed if the things outside it stay outside.
 */
describe('sanitiseStyle', () => {
  it('keeps a hex colour', () => {
    expect(sanitiseStyle('color: #ff0000')).toBe('color: #ff0000');
    expect(sanitiseStyle('color: #F00')).toBe('color: #f00');
  });

  it('normalises the rgb() a browser hands back into hex', () => {
    // Setting #ff0000 and reading the style attribute afterwards gives this.
    // Rejecting it would mean every colour set through the toolbar was lost.
    expect(sanitiseStyle('color: rgb(255, 0, 0)')).toBe('color: #ff0000');
    expect(sanitiseStyle('background-color: rgb(0, 128, 255)')).toBe('background-color: #0080ff');
  });

  it('refuses an rgb() channel that is out of range', () => {
    expect(sanitiseStyle('color: rgb(300, 0, 0)')).toBe('');
  });

  it('keeps a theme colour token but not an invented one', () => {
    expect(sanitiseStyle('color: var(--tgs-accent)')).toBe('color: var(--tgs-accent)');
    expect(sanitiseStyle('color: var(--tgs-radius-lg)')).toBe('');
    expect(sanitiseStyle('color: var(--anything-else)')).toBe('');
  });

  it('keeps a size from the scale and refuses one off it', () => {
    expect(sanitiseStyle('font-size: 1.5rem')).toBe('font-size: 1.5rem');
    expect(sanitiseStyle('font-size: 400vw')).toBe('');
    expect(sanitiseStyle('font-size: 99rem')).toBe('');
  });

  it('keeps a font token and refuses a raw family name', () => {
    // A raw family is whatever the visitor's machine happens to have, which is
    // a different site on every screen. The library exists so it never is.
    expect(sanitiseStyle('font-family: var(--tgs-h2-font)')).toBe('font-family: var(--tgs-h2-font)');
    expect(sanitiseStyle('font-family: Georgia, serif')).toBe('');
  });

  it('refuses a url(), however it is spelled', () => {
    // A paragraph that fetches an image is a paragraph that reports back to
    // whoever wrote it every time the page is opened.
    expect(sanitiseStyle('background-color: url(https://tracker.example/p.gif)')).toBe('');
    expect(sanitiseStyle('color: #fff; background-color: URL("x")')).toBe('');
    expect(sanitiseStyle('color: \\75 rl(x)')).toBe('');
  });

  it('refuses the properties that let a paragraph cover the page', () => {
    const overlay = 'position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; z-index: 9999';
    expect(sanitiseStyle(overlay)).toBe('');
  });

  it('drops what it does not know and keeps what it does, in one declaration list', () => {
    expect(sanitiseStyle('color: #123456; position: fixed; font-size: 1rem')).toBe(
      'color: #123456; font-size: 1rem',
    );
  });

  /*
   * What this really proves is the ANCHORING, not the !important guard.
   *
   * Every validator matches end to end, so anything trailing a value makes the
   * whole declaration fail rather than being trimmed off and ignored. Deleting
   * the !important line in styles.ts changes nothing here, which is why that
   * line is commented as belt and braces rather than as the thing doing the
   * work. A test that credits the wrong line sends the next person to the wrong
   * place.
   */
  it('refuses a value with anything trailing it, such as !important', () => {
    expect(sanitiseStyle('color: #fff !important')).toBe('');
    expect(sanitiseStyle('color: #fff red')).toBe('');
    expect(sanitiseStyle('font-size: 1rem 2rem')).toBe('');
    expect(sanitiseStyle('text-align: left center')).toBe('');
  });

  it('refuses a comment, which is how a naive split gets fooled', () => {
    expect(sanitiseStyle('color: #fff /* ; position: fixed */')).toBe('');
  });

  it('refuses an at-rule and anything with angle brackets', () => {
    expect(sanitiseStyle('@import "evil.css"')).toBe('');
    expect(sanitiseStyle('color: #fff; </style><script>alert(1)</script>')).toBe('');
  });

  it('has a length limit, because a long one is not from our toolbar', () => {
    expect(sanitiseStyle(`color: #fff;${' '.repeat(700)}`)).toBe('');
  });

  it('returns an empty string for anything that is not a string', () => {
    for (const value of [null, undefined, 42, {}, []]) {
      expect(sanitiseStyle(value)).toBe('');
    }
  });
});

describe('styling through the whole sanitiser', () => {
  it('lets a coloured span survive a save', () => {
    const out = sanitiseHtml('<p>a <span style="color: #ff0000">red</span> word</p>');
    expect(out).toContain('style="color: #ff0000"');
  });

  it('keeps the words when the styling is refused', () => {
    // The formatting is lost, the writing is not. Losing somebody's sentence
    // because of an attribute is the worse of the two failures by a distance.
    const out = sanitiseHtml('<p>a <span style="position: fixed">word</span></p>');
    expect(out).toContain('word');
    expect(out).not.toContain('style');
  });

  it('emits no empty style attribute when nothing in it was allowed', () => {
    const out = sanitiseHtml('<span style="animation: spin 1s">x</span>');
    expect(out).not.toContain('style');
  });

  it('does not let a style attribute break out of its own quotes', () => {
    const out = sanitiseHtml('<span style="color: #fff&quot; onclick=&quot;alert(1)">x</span>');
    expect(out).not.toContain('onclick');
  });

  it('drops a font tag but keeps what it wrapped', () => {
    // The editor is told to use CSS, so a font tag did not come from us.
    const out = sanitiseHtml('<p><font color="#ff0000">words</font></p>');
    expect(out).toContain('words');
    expect(out).not.toContain('<font');
  });

  it('still refuses a style on an image or an iframe in an embed', () => {
    const out = sanitiseHtml(
      '<img src="https://x.test/a.png" style="position: fixed" alt="">',
      'embed',
    );
    expect(out).not.toContain('style');
  });
});

// ---------------------------------------------------------------------------

describe('resolveVideo', () => {
  it('handles the YouTube formats people actually paste', () => {
    for (const url of [
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      'https://youtu.be/dQw4w9WgXcQ',
      'https://m.youtube.com/watch?v=dQw4w9WgXcQ',
    ]) {
      const result = resolveVideo(url);
      expect(result?.kind).toBe('iframe');
      expect(result?.src).toContain('dQw4w9WgXcQ');
      expect(result?.src).toContain('youtube-nocookie.com');
    }
  });

  it('handles Vimeo', () => {
    const result = resolveVideo('https://vimeo.com/123456789');
    expect(result?.src).toBe('https://player.vimeo.com/video/123456789');
  });

  it('handles a direct file', () => {
    expect(resolveVideo('https://cdn.example.com/clip.mp4')).toEqual({
      kind: 'file',
      src: 'https://cdn.example.com/clip.mp4',
    });
  });

  it('rejects anything else', () => {
    expect(resolveVideo('javascript:alert(1)')).toBeNull();
    expect(resolveVideo('https://example.com/not-a-video')).toBeNull();
    expect(resolveVideo('')).toBeNull();
  });
});

// ---------------------------------------------------------------------------

describe('factory', () => {
  it('mints unique ids', () => {
    const ids = new Set(Array.from({ length: 500 }, () => newId('blk')));
    expect(ids.size).toBe(500);
  });

  it('builds row presets that sum to 100', () => {
    for (const preset of ['1', '1-1', '1-2', '2-1', '1-1-1', '1-1-1-1']) {
      const row = createRow(preset);
      expect(sum(row.columns.map((c) => c.width))).toBeCloseTo(100, 2);
    }
  });

  it('falls back to one column for a nonsense preset', () => {
    expect(createRow('nonsense').columns).toHaveLength(1);
  });

  it('gives every new block its type defaults', () => {
    expect(createBlock('heading').props.level).toBe('h2');
    expect(createBlock('button').props.variant).toBe('primary');
  });

  it('does not share default objects between two blocks', () => {
    const a = createBlock('list');
    const b = createBlock('list');
    (a.props.items as unknown[]).push({ text: 'extra' });
    expect((b.props.items as unknown[]).length).toBe(3);
  });
});

// ---------------------------------------------------------------------------

describe('layouts', () => {
  it('every layout builds a section matching its own shape', () => {
    for (const layout of LAYOUTS) {
      const section = createSectionFromLayout(layout);
      expect(section.rows.map((row) => row.columns.length)).toEqual(
        layout.rows.map((ratios) => ratios.length),
      );
      for (const row of section.rows) {
        expect(sum(row.columns.map((c) => c.width))).toBeCloseTo(100, 2);
      }
    }
  });

  it('respects the declared ratios', () => {
    const wide = createSectionFromLayout(
      LAYOUTS.find((l) => l.id === 'sidebar-right')!,
    );
    const [a, b] = wide.rows[0].columns;
    // 2:1 means the first column is twice the second.
    expect(a.width / b.width).toBeCloseTo(2, 1);
  });

  it('thumbnail cells stay inside the box and never overlap', () => {
    for (const layout of LAYOUTS) {
      const cells = layoutCells(layout);
      expect(cells).toHaveLength(layout.rows.flat().length);
      for (const cell of cells) {
        expect(cell.x).toBeGreaterThanOrEqual(0);
        expect(cell.y).toBeGreaterThanOrEqual(0);
        expect(cell.x + cell.width).toBeLessThanOrEqual(1.0001);
        expect(cell.y + cell.height).toBeLessThanOrEqual(1.0001);
        expect(cell.width).toBeGreaterThan(0);
        expect(cell.height).toBeGreaterThan(0);
      }
    }
  });

  it('has no duplicate ids or labels', () => {
    expect(new Set(LAYOUTS.map((l) => l.id)).size).toBe(LAYOUTS.length);
    expect(new Set(LAYOUTS.map((l) => l.label)).size).toBe(LAYOUTS.length);
  });
});

// ---------------------------------------------------------------------------

describe('sanitising a whole page on the way in', () => {
  function pageWith(type: string, props: Record<string, unknown>) {
    const page = createPage('Test', 'test');
    const section = createSectionFromLayout(LAYOUTS[0]);
    section.rows[0].columns[0].blocks = [{ id: newId('b'), type, props }];
    page.sections = [section];
    return page;
  }

  it('strips a script out of rich text before it is stored', () => {
    const clean = sanitisePage(pageWith('text', {
      html: '<p>Hello<script>alert(1)</script></p>',
    }));

    const props = clean.sections[0].rows[0].columns[0].blocks[0].props;
    expect(props.html).not.toContain('script');
    expect(props.html).toContain('Hello');
  });

  it('empties a javascript: link rather than storing it', () => {
    const clean = sanitisePage(pageWith('button', {
      label: 'Click',
      href: 'javascript:alert(1)',
    }));

    expect(clean.sections[0].rows[0].columns[0].blocks[0].props.href).toBe('');
  });

  it('reaches inside a repeater', () => {
    const clean = sanitisePage(pageWith('button-group', {
      buttons: [
        { label: 'Safe', href: 'https://example.com' },
        { label: 'Nasty', href: 'javascript:alert(1)' },
      ],
    }));

    const buttons = clean.sections[0].rows[0].columns[0].blocks[0].props
      .buttons as Array<Record<string, unknown>>;
    expect(buttons[0].href).toBe('https://example.com');
    expect(buttons[1].href).toBe('');
  });

  it('cleans a section background image', () => {
    const page = pageWith('text', { html: '<p>hi</p>' });
    page.sections[0].backgroundImage = 'javascript:alert(1)';

    expect(sanitisePage(page).sections[0].backgroundImage).toBe('');
  });

  it('cleans the SEO image and canonical URL', () => {
    const page = pageWith('text', { html: '<p>hi</p>' });
    page.seo = { noindex: false, ogImage: 'javascript:alert(1)', canonical: '//evil.com' };

    const clean = sanitisePage(page);
    expect(clean.seo.ogImage).toBe('');
    expect(clean.seo.canonical).toBe('');
  });

  it('leaves a block it does not recognise completely alone', () => {
    // A page saved by a newer build has to survive an older one. The
    // renderer refuses to draw an unknown block anyway, and it is sanitised
    // again on render once its build knows what it is.
    const clean = sanitisePage(pageWith('from-the-future', {
      html: '<p>Hello</p>',
      anything: { nested: true },
    }));

    expect(clean.sections[0].rows[0].columns[0].blocks[0].props).toEqual({
      html: '<p>Hello</p>',
      anything: { nested: true },
    });
  });

  it('is idempotent', () => {
    const once = sanitisePage(pageWith('text', { html: '<p onclick="x">Hi</p>' }));
    expect(sanitisePage(once)).toEqual(once);
  });

  it('leaves a legitimate page untouched', () => {
    const page = pageWith('text', { html: '<p>Greek islands, <strong>from £599</strong>.</p>' });
    expect(sanitisePage(page)).toEqual(page);
  });
});

// ---------------------------------------------------------------------------

describe('section height', () => {
  it('translates the old named sizes rather than losing them', () => {
    // paddingY used to be 'none' | 'xs' | ... | 'xl'. Content saved before the
    // change still says so, and throwing away a client's spacing on upgrade
    // would be unforgivable.
    for (const [name, pixels] of Object.entries(LEGACY_PADDING)) {
      expect(normaliseSectionPadding(name), name).toBe(pixels);
    }
  });

  it('snaps to the 4px grid so a site keeps its rhythm', () => {
    expect(normaliseSectionPadding(33)).toBe(32);
    expect(normaliseSectionPadding(35)).toBe(36);
    // Exactly between two steps. Ties round up, which is only worth stating
    // because it is the kind of thing a later refactor changes by accident.
    expect(normaliseSectionPadding(50)).toBe(52);
  });

  it('cannot be dragged below zero or past the ceiling', () => {
    expect(normaliseSectionPadding(-400)).toBe(0);
    expect(normaliseSectionPadding(99999)).toBe(MAX_SECTION_PADDING);
  });

  it.each([
    ['undefined', undefined],
    ['null', null],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['a nonsense name', 'enormous'],
    ['an object', { px: 40 }],
  ])('falls back to the default for %s', (_label, value) => {
    expect(normaliseSectionPadding(value)).toBe(DEFAULT_SECTION_PADDING);
  });

  it('every preset is already a legal value', () => {
    for (const preset of PADDING_PRESETS) {
      expect(normaliseSectionPadding(preset.value)).toBe(preset.value);
    }
  });

  it('a whole page of legacy sections survives a parse', () => {
    const page = createPage('Old', 'old');
    const section = createSectionFromLayout(LAYOUTS[0]);
    page.sections = [{ ...section, paddingY: 'xl' as unknown as number }];

    const parsed = parsePage(page);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.page.sections[0].paddingY).toBe(64);
  });
});

// ---------------------------------------------------------------------------

describe('box styling, shared by sections and columns', () => {
  it('is literally the same shape in both places', () => {
    // Not a tautology. Andy asked for the same controls on sections and on
    // columns, and the only durable way to guarantee that is one schema used
    // twice. If someone forks them, this fails.
    const page = createPage('T', 't');
    const section = createSectionFromLayout(LAYOUTS[0]);

    expect(Object.keys(section.box).sort())
      .toEqual(Object.keys(section.rows[0].columns[0].box).sort());

    // And a freshly created page's sections carry it too, so a new section is
    // stylable the moment it exists rather than after its first save.
    for (const created of page.sections) {
      expect(Object.keys(created.box).sort()).toEqual(Object.keys(section.box).sort());
    }
  });

  it.each([
    ['#fff', '#fff'],
    ['#1B2B5B', '#1b2b5b'],
    ['#11223344', '#11223344'],
    ['rgb(1,2,3)', 'rgb(1,2,3)'],
    ['rgba(1, 2, 3, 0.5)', 'rgba(1, 2, 3, 0.5)'],
    ['transparent', 'transparent'],
  ])('accepts the colour %s', (input, expected) => {
    expect(safeColour(input)).toBe(expected);
  });

  it.each([
    ['a url', 'url(https://evil.example/x.png)'],
    ['an escape out of the declaration', '#fff; background: url(x)'],
    ['a css expression', 'expression(alert(1))'],
    ['a var reference', 'var(--anything)'],
    ['a colour name', 'rebeccapurple'],
    ['empty', ''],
    ['a number', 123],
  ])('refuses %s', (_label, input) => {
    // The value goes straight into a CSS custom property the renderer emits,
    // so this is a whitelist and not a tidy-up.
    expect(safeColour(input)).toBeUndefined();
  });

  it.each([
    ['a negative', -20, 0],
    ['past the ceiling', 9999, MAX_PADDING],
    ['a fraction', 12.6, 13],
    ['a numeric string', '24', 24],
    ['nonsense', 'wide', 0],
    ['NaN', Number.NaN, 0],
  ])('clamps padding %s', (_label, input, expected) => {
    expect(px(input, MAX_PADDING)).toBe(expected);
  });

  it('translates the old named column gaps', () => {
    for (const [name, pixels] of Object.entries(LEGACY_GAP)) {
      expect(normaliseGap(name), name).toBe(pixels);
    }
    expect(normaliseGap(undefined)).toBe(DEFAULT_GAP);
    expect(normaliseGap(9999)).toBe(MAX_GAP);
  });

  it('a page written before any of this existed still parses', () => {
    // No box, no minHeight, gap and paddingY both still named sizes.
    const legacy = {
      version: 1, id: 'p', title: 'Old', slug: '', seo: {},
      sections: [{
        id: 's', tone: 'light', width: 'contained', paddingY: 'xl',
        rows: [{
          id: 'r', gap: 'l', stackBelow: 'tablet',
          columns: [{ id: 'c', width: 100, align: 'top', blocks: [] }],
        }],
      }],
    };

    const parsed = parsePage(legacy);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const section = parsed.page.sections[0];
    expect(section.paddingY).toBe(64);
    expect(section.minHeight).toBe(0);
    expect(section.box).toEqual(EMPTY_BOX);
    expect(section.rows[0].gap).toBe(32);
    expect(section.rows[0].columns[0].box).toEqual(EMPTY_BOX);
  });

  it('knows when a box would draw nothing', () => {
    expect(boxIsEmpty(EMPTY_BOX)).toBe(true);
    expect(boxIsEmpty({ ...EMPTY_BOX, radius: 8 })).toBe(false);
    expect(boxIsEmpty({ ...EMPTY_BOX, background: '#fff' })).toBe(false);
    expect(boxIsEmpty({ ...EMPTY_BOX, padding: { top: 4, right: 0, bottom: 0, left: 0 } }))
      .toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Designed sections
// ---------------------------------------------------------------------------

/**
 * THE ONE THAT MATTERS: every preset builds a section the schema accepts.
 *
 * A preset is hand-written data, so the ways it can be wrong are the ways
 * hand-written data is wrong: a widths array with three entries and a columns
 * array with two, a block type that no longer exists, ratios that normalise to
 * something other than 100. None of those show up until somebody clicks the
 * card, and then the editor throws while they are trying to add a section.
 *
 * Checking the built section rather than the description is deliberate. The
 * description is not what ships; the section is.
 */
describe('the designed section presets', () => {
  it.each(SECTION_PRESETS.map((preset) => [preset.label, preset] as const))(
    '%s builds a section the schema accepts',
    (_label, preset) => {
      const section = buildPresetSection(preset);

      const parsed = parsePage({
        version: 1,
        id: 'pg_test',
        title: 'Test',
        slug: '',
        seo: { noindex: false },
        sections: [section],
      });

      expect(parsed.ok ? [] : parsed.errors).toEqual([]);
    },
  );

  it('describes as many columns as it gives widths', () => {
    // An off-by-one here builds a section with an empty column in the middle
    // and no error anywhere, which reads as the preset being badly designed.
    const wrong = SECTION_PRESETS.flatMap((preset) =>
      preset.rows
        .filter((row) => row.widths.length !== row.columns.length)
        .map((row) => `${preset.id}: ${row.widths.length} widths, ${row.columns.length} columns`),
    );
    expect(wrong).toEqual([]);
  });

  it('gives every column a share of the row that adds up', () => {
    for (const preset of SECTION_PRESETS) {
      for (const row of buildPresetSection(preset).rows) {
        const sum = row.columns.reduce((total, column) => total + column.width, 0);
        expect(Math.abs(sum - 100), `${preset.id}`).toBeLessThanOrEqual(WIDTH_SUM_TOLERANCE);
      }
    }
  });

  /*
   * Adding the same preset twice must give two independent sections. A shared
   * id would collide in the outline's keys and make the editor's path lookups
   * ambiguous, and it would show up as the wrong block being edited rather than
   * as an error.
   */
  it('gives fresh ids every time, so the same preset can be added twice', () => {
    const preset = SECTION_PRESETS[0];
    const a = buildPresetSection(preset);
    const b = buildPresetSection(preset);

    const ids = (section: ReturnType<typeof buildPresetSection>) => [
      section.id,
      ...section.rows.flatMap((row) => [
        row.id,
        ...row.columns.flatMap((column) => [column.id, ...column.blocks.map((block) => block.id)]),
      ]),
    ];

    const all = [...ids(a), ...ids(b)];
    expect(new Set(all).size, 'an id is reused').toBe(all.length);
  });

  /*
   * Props MERGE over the block's defaults rather than replacing them. A preset
   * that says only { style: 'h1' } must still get the text, level and align the
   * block type defines, or a new field on a block type would arrive empty in
   * every preset that does not mention it.
   */
  it('keeps a block type defaults for anything the preset does not say', () => {
    const centred = presetById('text-centred-intro')!;
    const blocks = buildPresetSection(centred).rows[0].columns[0].blocks;

    // Three blocks: the small label, the title, then the line under it. Written
    // first as blocks[0] expecting the title, which is the eyebrow.
    const [eyebrow, title, body] = blocks;

    expect(eyebrow.props?.style).toBe('h6');
    expect(title.props?.style).toBe('h1');

    // The preset says nothing about the title's text length or its tag, so both
    // come from the block definition. That is what makes a new field on a block
    // type reach every preset without any of them being edited.
    expect(title.props).toHaveProperty('level');
    expect(title.props?.align).toBe('centre');
    expect(body.type).toBe('text');
  });

  it('puts every preset in a category the picker actually draws', () => {
    const known = new Set(PRESET_CATEGORIES.map((entry) => entry.id));
    for (const preset of SECTION_PRESETS) {
      expect(known.has(preset.category), `${preset.id} is in "${preset.category}"`).toBe(true);
    }
  });

  it('leaves no category with an empty grid', () => {
    for (const entry of PRESET_CATEGORIES) {
      expect(presetsIn(entry.id).length, `${entry.id} has nothing in it`).toBeGreaterThan(0);
    }
  });

  /*
   * The thumbnail is drawn from the same data that builds the section, which is
   * the reason this file is data at all. What it must not do is draw outside
   * its box: the SVG has no clipping, so a bar at y 1.2 renders over the card's
   * label.
   */
  it('draws every thumbnail inside its box', () => {
    for (const preset of SECTION_PRESETS) {
      for (const bar of presetBars(preset)) {
        expect(bar.x, `${preset.id} x`).toBeGreaterThanOrEqual(0);
        expect(bar.y, `${preset.id} y`).toBeGreaterThanOrEqual(0);
        expect(bar.x + bar.width, `${preset.id} right edge`).toBeLessThanOrEqual(1.001);
        expect(bar.y + bar.height, `${preset.id} bottom edge`).toBeLessThanOrEqual(1.001);
      }
    }
  });

  it('draws something for every preset', () => {
    // A preset whose blocks all fell through to nothing would show a blank card
    // and look like a loading bug.
    for (const preset of SECTION_PRESETS) {
      expect(presetBars(preset).length, `${preset.id} draws nothing`).toBeGreaterThan(0);
    }
  });

  it('centres a centred preset and does not centre a left-aligned one', () => {
    const centred = presetBars(presetById('text-centred-intro')!);
    const left = presetBars(presetById('text-intro')!);

    // A centred single-column preset has no bar starting hard against the left.
    expect(centred.every((bar) => bar.x > 0.001)).toBe(true);
    // The left-aligned one does.
    expect(left.some((bar) => bar.x < 0.001)).toBe(true);
  });
});
