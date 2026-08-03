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

  /*
   * THE REAL-WORLD SHAPES, and the ones that broke on the first cut.
   *
   * A live marketing page does not write an h3 and a p. A card is a div or a
   * link full of utility classes, its title and body are spans styled to look
   * like a heading, and its icon is an SVG in its own box. These pin that the
   * rebuilder reads structure rather than tags, so the loveholidays "why book
   * with us" section comes back as six icon-and-text cards, not one run-together
   * paragraph. This is the exact failure from 3 Aug 2026.
   */
  const wcard = (icon: string, title: string, body: string) =>
    `<a class="benefit" href="#"><span class="ic">${icon}</span>` +
    `<span class="t">${title}</span><span class="b">${body}</span></a>`;

  it('rebuilds link cards with span title and body, not one run-together blob', () => {
    const svg = '<svg><path d="M1 1"></path></svg>';
    const html =
      '<section><h2>Why book with us</h2><div class="grid">' +
      wcard(svg, 'Loved by millions', 'Join over 19 million holidaymakers') +
      wcard(svg, 'ATOL protected', 'Financial cover for every package') +
      wcard(svg, 'Best Price Promise', 'We will beat any cheaper deal') +
      '</div></section>';
    const model = modelFromImport({ html, fields: [], content: {}, label: 'Why book with us' });
    const blocks = allBlocks(model);

    // The heading is there, three icon-and-text cards are there, and crucially
    // there is NO single text block with everything crushed together.
    expect(blocks.filter((block) => block.type === 'icon-item').length).toBe(3);
    const items = blocks.filter((block) => block.type === 'icon-item');
    expect(items[0].props.title).toBe('Loved by millions');
    expect(items[0].props.body).toBe('Join over 19 million holidaymakers');
    // The words never run together across the two spans.
    for (const block of blocks) {
      const text = JSON.stringify(block.props);
      expect(text).not.toMatch(/millionsJoin|holidaymakersATOL|packageBest/);
    }
  });

  it('sees the icon and the words when each sits in its own wrapper box', () => {
    const card = (t: string, b: string) =>
      `<div class="benefit"><div class="icon"><svg><path d="M1 1"></path></svg></div>` +
      `<div class="text"><div class="t">${t}</div><div class="b">${b}</div></div></div>`;
    const html =
      `<section><h2>Why</h2><div class="grid">${card('ATOL protected', 'Covered.')}${card('Best price', 'We beat it.')}${card('Real people', 'On the phone.')}</div></section>`;
    const items = allBlocks(modelFromImport({ html, fields: [], content: {}, label: '' })).filter(
      (block) => block.type === 'icon-item',
    );
    expect(items.length).toBe(3);
    expect(items[0].props.title).toBe('ATOL protected');
    expect(items[0].props.body).toBe('Covered.');
  });

  it('keeps a real icon image, as a picture beside the words', () => {
    const html =
      '<section><div class="grid">' +
      '<div class="b"><img src="https://cdn.test/atol.svg" alt="ATOL"><h3>ATOL protected</h3><p>Covered.</p></div>' +
      '<div class="b"><img src="https://cdn.test/trust.svg" alt="Trust"><h3>Trusted</h3><p>19 million.</p></div>' +
      '</div></section>';
    const blocks = allBlocks(modelFromImport({ html, fields: [], content: {}, label: '' }));
    // The badge is preserved rather than guessed away.
    expect(blocks.filter((block) => block.type === 'image').length).toBe(2);
    expect(blocks.find((block) => block.type === 'image')?.props.src).toBe('https://cdn.test/atol.svg');
    expect(blocks.some((block) => block.type === 'heading' && String(block.props.html).includes('ATOL'))).toBe(true);
  });

  it('does not turn a row of nav links into a grid of columns', () => {
    const html =
      '<section><nav><a href="/a">Home</a><a href="/b">Holidays</a><a href="/c">Deals</a></nav>' +
      '<h2>Welcome</h2><p>The body.</p></section>';
    const model = modelFromImport({ html, fields: [], content: {}, label: '' });
    // No row of three single-word columns: the nav is not card content.
    const threeCols = model?.rows.filter((row) => row.columns.length === 3) ?? [];
    expect(threeCols.length).toBe(0);
    expect(allBlocks(model).some((block) => block.type === 'heading')).toBe(true);
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
