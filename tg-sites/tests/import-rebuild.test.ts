/**
 * Rebuilding an imported design into native blocks.
 *
 * The recogniser is deterministic and content preserving, so it is exactly the
 * thing to pin with tests: given the markup a slice or a Relume export produces,
 * the same native blocks come out every time. These feed representative shapes
 * (a hero, a feature grid, a list, a stray blob) and assert the block types and
 * the words, which is the promise the feature makes: your content, rebuilt as
 * blocks you can edit, never rewritten.
 */

import { describe, expect, it } from 'vitest';

import { modelFromImport } from '../lib/import/rebuild';
import { sectionFromModel } from '../lib/ai/section-build';
import { isIconName } from '../lib/content/icons';

/** Every block in a model, flattened, for the assertions that do not care where. */
function allBlocks(model: ReturnType<typeof modelFromImport>) {
  if (!model) return [];
  return model.rows.flatMap((row) => row.columns.flatMap((column) => column.blocks));
}

describe('rebuilding an imported design', () => {
  it('turns a heading, a paragraph and a button into three native blocks', () => {
    const html =
      '<div><h1>Escape to Greece</h1><p>Small group trips through the islands.</p>' +
      '<a class="btn" href="/enquire">Start an enquiry</a></div>';
    const model = modelFromImport({ html, fields: [], content: {}, label: 'Hero' });
    const blocks = allBlocks(model);

    const heading = blocks.find((block) => block.type === 'heading');
    expect(heading?.props.html).toContain('Escape to Greece');
    // The source h1 keeps its big look but is tagged h2: the page title owns the h1.
    expect(heading?.props.style).toBe('h1');
    expect(heading?.props.level).toBe('h2');

    const text = blocks.find((block) => block.type === 'text');
    expect(text?.props.html).toContain('Small group trips');

    const button = blocks.find((block) => block.type === 'button');
    expect(button?.props.label).toBe('Start an enquiry');
    expect(button?.props.href).toBe('/enquire');
  });

  it('makes a feature grid into a heading and a row of icon-and-text blocks', () => {
    const html =
      '<section><h2>Why book with us</h2>' +
      '<div class="grid">' +
      '<div class="item"><svg></svg><h3>ATOL protected</h3><p>Every holiday covered.</p></div>' +
      '<div class="item"><svg></svg><h3>Real people</h3><p>On the phone while you travel.</p></div>' +
      '<div class="item"><svg></svg><h3>Best price promise</h3><p>We will beat it.</p></div>' +
      '</div></section>';
    const model = modelFromImport({ html, fields: [], content: {}, label: 'Why book with us' });

    expect(model).not.toBeNull();
    expect(model?.name).toBe('Why book with us');

    // The heading is its own full-width row.
    const headingRow = model?.rows.find((row) => row.columns.length === 1);
    expect(headingRow?.columns[0].blocks[0].type).toBe('heading');

    // The grid is a row of three columns, each an editable icon-and-text.
    const gridRow = model?.rows.find((row) => row.columns.length === 3);
    expect(gridRow).toBeTruthy();
    const items = gridRow!.columns.map((column) => column.blocks[0]);
    expect(items.every((block) => block.type === 'icon-item')).toBe(true);
    expect(items[0].props.title).toBe('ATOL protected');
    expect(items[0].props.body).toBe('Every holiday covered.');
    // The icon is guessed from the title and is always a real one.
    expect(items.every((block) => isIconName(block.props.icon))).toBe(true);
    expect(items[0].props.icon).toBe('shield-check');
  });

  it('splits six cards into two rows of three, not one row of six', () => {
    const card = (n: number) => `<div class="c"><h3>Point ${n}</h3><p>Body ${n}.</p></div>`;
    const html = `<section><div class="grid">${[1, 2, 3, 4, 5, 6].map(card).join('')}</div></section>`;
    const model = modelFromImport({ html, fields: [], content: {}, label: 'Points' });

    const gridRows = model?.rows.filter((row) => row.columns.length === 3) ?? [];
    expect(gridRows.length).toBe(2);
  });

  it('reads a list as a list block with each point kept', () => {
    const html = '<div><ul><li>Flights included</li><li>Transfers included</li><li>Bed and breakfast</li></ul></div>';
    const model = modelFromImport({ html, fields: [], content: {}, label: '' });
    const list = allBlocks(model).find((block) => block.type === 'list');

    expect(list?.props.style).toBe('bullet');
    expect((list?.props.items as { text: string }[]).map((item) => item.text)).toEqual([
      'Flights included',
      'Transfers included',
      'Bed and breakfast',
    ]);
  });

  it('reads an image with its alt text', () => {
    const html = '<div><img src="https://cdn.test/beach.jpg" alt="A quiet cove at dawn"></div>';
    const model = modelFromImport({ html, fields: [], content: {}, label: '' });
    const image = allBlocks(model).find((block) => block.type === 'image');

    expect(image?.props.src).toBe('https://cdn.test/beach.jpg');
    expect(image?.props.alt).toBe('A quiet cove at dawn');
  });

  it('puts the client\'s edited words in, not the design\'s originals', () => {
    // The tokenised shape lib/import/tokenise.ts produces, with an edit stored.
    const html = '<div><h2>{{tg:t1}}</h2><p>{{tg:t2}}</p></div>';
    const fields = [
      { key: 't1', kind: 'text', label: 'Heading', value: 'Escape to Crete' },
      { key: 't2', kind: 'text', label: 'Body', value: 'The original body.' },
    ];
    const model = modelFromImport({ html, fields, content: { t1: 'Escape to Rhodes' }, label: '' });
    const blocks = allBlocks(model);

    // The edited heading wins; the untouched paragraph falls back to the design.
    expect(blocks.find((block) => block.type === 'heading')?.props.html).toContain('Escape to Rhodes');
    expect(blocks.find((block) => block.type === 'text')?.props.html).toContain('The original body.');
  });

  it('escapes anything that looks like markup in the content', () => {
    const html = '<div><h2>Bed &amp; breakfast &lt;b&gt;</h2></div>';
    const model = modelFromImport({ html, fields: [], content: {}, label: '' });
    const heading = allBlocks(model).find((block) => block.type === 'heading');
    // The angle brackets come back escaped, so nothing can smuggle a tag through.
    expect(heading?.props.html).toContain('&lt;b&gt;');
    expect(heading?.props.html).not.toContain('<b>');
  });

  it('is null for a design with nothing we can rebuild', () => {
    expect(modelFromImport({ html: '<div><svg><path d="M0 0"></path></svg></div>', fields: [], content: {} })).toBeNull();
    expect(modelFromImport({ html: '', fields: [], content: {} })).toBeNull();
    expect(modelFromImport({ html: '   ', fields: [], content: {} })).toBeNull();
  });

  /*
   * THE JOIN THAT MATTERS. The recogniser produces a model, and sectionFromModel
   * is what turns it into a real Section: it validates the shape, squares the
   * column widths and sanitises every value. If the model it produced were not
   * one sectionFromModel accepts, the whole feature would fail at the last step,
   * so this proves the two halves fit.
   */
  it('produces a model sectionFromModel turns into a valid, editable Section', () => {
    const html =
      '<section><h2>Why book with us</h2>' +
      '<div class="grid">' +
      '<div class="item"><svg></svg><h3>ATOL protected</h3><p>Every holiday covered.</p></div>' +
      '<div class="item"><svg></svg><h3>Real people</h3><p>On the phone while you travel.</p></div>' +
      '<div class="item"><svg></svg><h3>Best price promise</h3><p>We will beat it.</p></div>' +
      '</div></section>';
    const model = modelFromImport({ html, fields: [], content: {}, label: 'Why book with us' });
    const built = sectionFromModel(model);

    expect(built.ok).toBe(true);
    if (!built.ok) return;

    // The name carries through, and every column width squares to 100.
    expect(built.section.name).toBe('Why book with us');
    for (const row of built.section.rows) {
      const sum = row.columns.reduce((total, column) => total + column.width, 0);
      expect(Math.abs(sum - 100)).toBeLessThan(0.5);
    }

    // The icon-and-text blocks survived validation and sanitising intact.
    const types = built.section.rows.flatMap((row) =>
      row.columns.flatMap((column) => column.blocks.map((block) => block.type)),
    );
    expect(types).toContain('heading');
    expect(types.filter((type) => type === 'icon-item').length).toBe(3);
  });
});
