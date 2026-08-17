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

import { modelFromImport, rebuildSection } from '../lib/import/rebuild';
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

  /*
   * THE REPEATED-TILE FIX. A grid of destination or offer cards, a picture, a
   * title and a link through, used to come back as a column of loose image and
   * heading blocks per card: accurate, but horrible to change, since a seventh
   * card meant building a seventh column by hand. It now becomes ONE Cards
   * block, a single editable list with an Add button, which is the block that
   * pattern is for. Gated on a picture AND a link, so a linkless badge row is
   * left alone (the test below).
   */
  it('turns a grid of linked picture cards into one editable Cards block', () => {
    const card = (img: string, title: string, href: string) =>
      `<div class="c"><a class="cover" href="${href}"></a>` +
      `<picture><img src="${img}" alt="${title}"></picture>` +
      `<div class="body"><h3>${title}</h3>` +
      `<a class="cta" href="${href}"><span>View deals</span></a></div></div>`;
    const html =
      '<section><div class="grid">' +
      card('https://cdn.test/palma.jpg', 'Palma de Mallorca', '/majorca/palma') +
      card('https://cdn.test/tenerife.jpg', 'Tenerife', '/canaries/tenerife') +
      card('https://cdn.test/benidorm.jpg', 'Benidorm', '/spain/benidorm') +
      card('https://cdn.test/dalaman.jpg', 'Dalaman', '/turkey/dalaman') +
      '</div></section>';
    const model = modelFromImport({ html, fields: [], content: {}, label: 'Popular destinations' });
    const blocks = allBlocks(model);

    // One Cards block, not four columns of image + heading.
    const cards = blocks.filter((block) => block.type === 'cards');
    expect(cards.length).toBe(1);
    expect(blocks.filter((block) => block.type === 'image').length).toBe(0);

    const items = cards[0].props.items as Array<Record<string, string>>;
    expect(items.length).toBe(4);
    expect(items[0].title).toBe('Palma de Mallorca');
    expect(items[0].src).toBe('https://cdn.test/palma.jpg');
    expect(items[0].linkHref).toBe('/majorca/palma');
    expect(items[0].linkLabel).toBe('View deals');
    // The link's words are not left crushed into the title or the body.
    expect(items[0].title).not.toContain('View deals');
    expect(String(items[0].body)).not.toContain('View deals');

    // And the model is one sectionFromModel turns into a real, editable Section.
    expect(sectionFromModel(model).ok).toBe(true);
  });

  it('leaves a linkless badge grid as its own blocks, not a Cards list', () => {
    const html =
      '<section><div class="grid">' +
      '<div class="b"><img src="https://cdn.test/atol.svg" alt="ATOL"><h3>ATOL protected</h3><p>Covered.</p></div>' +
      '<div class="b"><img src="https://cdn.test/trust.svg" alt="Trust"><h3>Trusted</h3><p>19 million.</p></div>' +
      '</div></section>';
    const blocks = allBlocks(modelFromImport({ html, fields: [], content: {}, label: '' }));
    expect(blocks.some((block) => block.type === 'cards')).toBe(false);
    expect(blocks.filter((block) => block.type === 'image').length).toBe(2);
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

  /*
   * THE ACTUAL LOVEHOLIDAYS SECTION, from the markup Andy captured on 3 Aug 2026.
   *
   * Its exact shape, and the one that beat two earlier attempts: an outer box
   * holds a heading and a hero image AND the card grid, and each card is a link
   * wrapping a flex box that holds an SVG icon and a text box of a bold title
   * span over a body paragraph, the title three wrappers deep. Two things had to
   * be right at once. The card extraction has to walk all the way to the leaves,
   * so the title and body come apart and the icon is found. And the grid test
   * has to be uniform, so the outer box (a heading beside six cards) is not read
   * as a two-column grid of its own.
   */
  it('rebuilds the real loveholidays "why book with us" section', () => {
    const svg = '<svg viewBox="0 0 24 24" role="img"><path d="M12 2"></path></svg>';
    const wcard = (title: string, body: string) =>
      `<a href="https://www.loveholidays.com/x/" class="c"><div class="flex">${svg}` +
      `<div class="text"><span class="t">${title}</span><p class="b">${body}</p></div></div></a>`;
    const html =
      '<div class="outer"><div class="head"><h2>Why book with us</h2>' +
      '<div class="hero"><img src="https://cdn.sanity.io/flamingo.svg" alt="icon"></div></div>' +
      '<div class="grid">' +
      wcard('Loved by millions', "Join over 19 million holidaymakers who've travelled with us") +
      wcard('ATOL protected', 'Financial cover for every single package holiday') +
      wcard('Super-flexible payments', 'Spread the cost of your holiday') +
      wcard('99% of flights, 1 search', "Once you've checked loveholidays, you've checked them all") +
      wcard('Best Price Promise', "Find a cheaper deal in 7 days - we'll beat it") +
      wcard('Support you can count on', "Help before you travel, plus 24/7 support") +
      '</div></div>';

    const model = modelFromImport({ html, fields: [], content: {}, label: 'Why book with us' });
    const blocks = allBlocks(model);

    // The heading is there and the six points are six icon-and-text cards.
    expect(blocks.some((block) => block.type === 'heading' && String(block.props.html).includes('Why book with us'))).toBe(true);
    const items = blocks.filter((block) => block.type === 'icon-item');
    expect(items.length).toBe(6);

    // Each card's title and body are SEPARATE and correct, never merged.
    const first = items.find((block) => String(block.props.title) === 'Loved by millions');
    expect(first?.props.body).toBe("Join over 19 million holidaymakers who've travelled with us");
    expect(items.every((block) => isIconName(block.props.icon))).toBe(true);
    // The exact break: a title running into a body somewhere.
    for (const block of blocks) {
      expect(JSON.stringify(block.props)).not.toMatch(/millionsJoin|protectedFinancial|paymentsSpread/);
    }

    // The outer wrapper is NOT read as a two-column grid: the cards land in
    // rows of three, and no row is the heading-beside-everything shape.
    expect(model?.rows.some((row) => row.columns.length === 3)).toBe(true);
    const built = sectionFromModel(model);
    expect(built.ok).toBe(true);
  });

  /*
   * RE-THEMING THE BAND. loveholidays' section is white text on a solid blue
   * band. Rebuilt to a white section it looked stripped, which is what Andy
   * reported; carrying the source's exact blue fixed the stripping but shipped a
   * competitor's colour on a client's page. Now a dark source band re-themes to
   * the SITE's own dark-band token, so it is still a band (not stripped) and it
   * takes the site's brand rather than the captured pixels. The tone stays dark
   * so the text is light. A white or transparent background is still nothing to
   * carry.
   */
  describe('re-theming a coloured band through rebuildSection', () => {
    it('maps a dark source band to the site dark-band token, tone dark', () => {
      const html = '<div class="root"><h2>Why book with us</h2><p>Some copy.</p></div>';
      const css = '.root { background-color: rgb(3, 116, 218); color: rgb(255,255,255); }';
      const result = rebuildSection({ html, css, fields: [], content: {}, label: 'Why' });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      // The band re-themes to the site's own dark band, not the source's blue.
      expect(result.section.box.background).toBe('var(--tgs-surface-dark)');
      expect(result.section.tone).toBe('dark');
    });

    it('leaves a plain white or transparent background alone', () => {
      const white = rebuildSection({
        html: '<div class="r"><h2>Hi</h2></div>',
        css: '.r { background-color: rgb(255, 255, 255); }',
        fields: [], content: {},
      });
      expect(white.ok && white.section.box.background).toBeFalsy();

      const clear = rebuildSection({
        html: '<div class="r"><h2>Hi</h2></div>',
        css: '.r { background-color: rgba(0, 0, 0, 0); }',
        fields: [], content: {},
      });
      expect(clear.ok && clear.section.box.background).toBeFalsy();
    });
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
