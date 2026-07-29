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
  MIN_COLUMN_WIDTH,
  normaliseWidths,
  parsePage,
} from '../lib/content/schema';
import { createPage, createRow, newId } from '../lib/content/factory';
import {
  addBlock,
  addColumn,
  evenColumns,
  moveBlockTo,
  moveSection,
  parsePathKey,
  pathKey,
  removeColumn,
  resizeColumnBoundary,
} from '../lib/content/tree';
import { createBlock } from '../lib/content/factory';
import { sanitiseHtml, safeUrl } from '../lib/content/sanitise';
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
    expect(safeUrl('java script:alert(1)')).toBeNull();
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
