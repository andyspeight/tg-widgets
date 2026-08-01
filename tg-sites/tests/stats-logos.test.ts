/**
 * Key numbers, and the logo strip.
 *
 * TWO BLOCKS, ONE FILE, because they were built for the same reason: both were
 * being faked with a block that could not do the job, and in both cases the
 * fake was already shipped in a designed section.
 *
 * WHAT IS ACTUALLY AT RISK IN EACH, since it is different.
 *
 * For the stats row it is the DATA TYPE of the figure. It is text, and it looks
 * for all the world like it should be a number, so it is exactly the sort of
 * thing somebody tidies up later. The moment it becomes a number field, "12,000"
 * loses its comma, "24/7" is refused outright and "£2m" cannot be typed at all.
 * The test that pins this is the most valuable one in the file.
 *
 * For the logo strip it is the LINK WITHOUT A NAME. An anchor whose only child
 * is an image with no alt text is announced to a screen reader as "link" and
 * nothing else, and a row of six of those is six dead ends. The renderer refuses
 * to draw that combination, which is a rule that only exists in code and would
 * be silently undone by anybody simplifying the condition.
 *
 * Layout, heights and greyscale live in the browser harness, where laid-out
 * pixels can be measured.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { blockDefinition, defaultPropsFor, isKnownBlock } from '../lib/content/blocks';
import { sanitisePage } from '../lib/content/sanitise-page';
import { parsePage } from '../lib/content/schema';

function read(...parts: string[]): string {
  return readFileSync(join(__dirname, '..', ...parts), 'utf8');
}

/** The source of one exported renderer, from its signature to its closing brace. */
function renderer(name: string): string {
  const source = read('components', 'render', 'blocks.tsx');
  const start = source.indexOf(`export function ${name}`);
  expect(start, `no renderer called ${name}`).toBeGreaterThan(-1);

  const body = source.slice(start);
  const end = body.indexOf('\n}\n');
  expect(end, `${name} has no closing brace`).toBeGreaterThan(0);

  return body.slice(0, end);
}

/** Runs a block's props through parse and sanitise, exactly as a save does. */
function saved(type: string, props: Record<string, unknown>): Record<string, unknown> {
  const parsed = parsePage({
    version: 1,
    id: 'pg_test',
    title: 'Test',
    slug: '',
    seo: { noindex: false },
    sections: [
      {
        id: 's1',
        rows: [
          {
            id: 'r1',
            columns: [{ id: 'c1', width: 100, blocks: [{ id: 'b1', type, props }] }],
          },
        ],
      },
    ],
  });

  if (!parsed.ok) throw new Error(parsed.errors.join('; '));
  return sanitisePage(parsed.page).sections[0].rows[0].columns[0].blocks[0].props;
}

// ---------------------------------------------------------------------------
// Key numbers
// ---------------------------------------------------------------------------

describe('the key numbers block', () => {
  it('is in the registry, in with the text', () => {
    expect(isKnownBlock('stats')).toBe(true);
    expect(blockDefinition('stats')?.group).toBe('Text');
  });

  it('arrives with a few numbers in it, so it looks like what it is', () => {
    const items = defaultPropsFor('stats').items;
    expect(Array.isArray(items)).toBe(true);
    expect((items as unknown[]).length).toBeGreaterThanOrEqual(3);
  });

  /*
   * THE ONE THAT MATTERS. A figure is text, and the reason is in the values an
   * agency actually writes: three of these four are impossible in a number
   * input. If this ever becomes `kind: 'number'`, every one of them breaks and
   * the only symptom is a client's comma quietly disappearing on save.
   */
  it('takes the figure as text, because 12,000 and 24/7 and £2m are all figures', () => {
    const repeater = blockDefinition('stats')?.fields.find((field) => field.kind === 'repeater');
    const value = repeater?.kind === 'repeater'
      ? repeater.fields.find((field) => field.key === 'value')
      : undefined;

    expect(value?.kind).toBe('text');
  });

  it('keeps a comma, a decimal point, a slash and a currency sign through a save', () => {
    const props = saved('stats', {
      items: [
        { value: '12,000', label: 'Holidays' },
        { value: '4.9', suffix: '/5', label: 'Score' },
        { value: '24/7', label: 'Support' },
        { value: '2', prefix: '£', suffix: 'm', label: 'Held in trust' },
      ],
    });

    const items = props.items as Array<Record<string, unknown>>;
    expect(items.map((item) => item.value)).toEqual(['12,000', '4.9', '24/7', '2']);
    expect(items[1].suffix).toBe('/5');
    expect(items[3].prefix).toBe('£');
  });

  it('keeps the figure short enough to sit under its own label', () => {
    const repeater = blockDefinition('stats')?.fields.find((field) => field.kind === 'repeater');
    const value = repeater?.kind === 'repeater'
      ? repeater.fields.find((field) => field.key === 'value')
      : undefined;

    // A cap at all is the point. 12 characters holds "12,000,000" and refuses
    // the paragraph somebody would otherwise set at 67px.
    expect(value?.kind === 'text' ? value.max : undefined).toBeLessThanOrEqual(16);
  });
});

describe('what the key numbers renderer does', () => {
  const body = renderer('StatsBlock');

  /*
   * THE FIGURE IS FIRST IN THE MARKUP, not just first on the screen, so a screen
   * reader reads "twelve thousand plus, holidays booked" rather than the label
   * and then the number it belongs to. Asserted by position, because both
   * elements exist either way and only their order carries the meaning.
   */
  it('puts the figure before the label, which is the order it is read in', () => {
    const figure = body.indexOf('tgs-stats__figure');
    const label = body.indexOf('tgs-stats__label');

    expect(figure).toBeGreaterThan(-1);
    expect(label).toBeGreaterThan(figure);
  });

  it('drops an entry with no figure and no label, since it would draw an empty column', () => {
    expect(body).toContain("item.value !== '' || item.label !== ''");
  });

  /*
   * EITHER, NOT BOTH, and it is worth saying why in a test. Somebody filling in
   * a four-across row types the four figures and then goes back for the labels.
   * Demanding both would make three of the four vanish while they did it.
   */
  it('keeps an entry that has only one of the two, so a half-typed row survives', () => {
    expect(body).not.toContain("item.value !== '' && item.label !== ''");
  });

  it('says what to do when there is nothing in it yet', () => {
    expect(body).toContain('Add a number or two');
  });

  it('is an unordered list, since nothing about a stats row is a sequence', () => {
    expect(body).toContain('<ul');
    expect(body).not.toContain('<ol');
  });
});

// ---------------------------------------------------------------------------
// The logo strip
// ---------------------------------------------------------------------------

describe('the logo strip block', () => {
  it('is in the registry, in with the media', () => {
    expect(isKnownBlock('logos')).toBe(true);
    expect(blockDefinition('logos')?.group).toBe('Media');
  });

  /*
   * EMPTY, unlike the stats row. Placeholder copy is obviously copy and gets
   * rewritten; a placeholder PICTURE looks like a decision somebody made, and
   * the ones nobody notices are the ones that reach a live site. Same rule the
   * designed sections follow.
   */
  it('arrives with no logos in it at all', () => {
    expect(defaultPropsFor('logos').items).toEqual([]);
  });

  /*
   * THESE TWO WORDS ARE WHAT SANITISES THE BLOCK. lib/content/sanitise-page.ts
   * is driven by field kinds rather than by a list of block names, so declaring
   * either of these as `text` would sanitise nothing and nobody would notice
   * until somebody pasted a javascript: URL into a logo link.
   */
  it('declares the picture as an image and the link as a url', () => {
    const repeater = blockDefinition('logos')?.fields.find((field) => field.kind === 'repeater');
    const fields = repeater?.kind === 'repeater' ? repeater.fields : [];

    expect(fields.find((field) => field.key === 'src')?.kind).toBe('image');
    expect(fields.find((field) => field.key === 'href')?.kind).toBe('url');
  });

  it('tells the client the name is what makes a link possible', () => {
    const repeater = blockDefinition('logos')?.fields.find((field) => field.kind === 'repeater');
    const alt = repeater?.kind === 'repeater'
      ? repeater.fields.find((field) => field.key === 'alt')
      : undefined;

    expect(alt?.help ?? '').toMatch(/cannot be linked/i);
  });
});

describe('a logo on the way into the database', () => {
  it('keeps a real picture and a real link', () => {
    const props = saved('logos', {
      items: [{ src: 'https://cdn.example.com/abta.svg', alt: 'ABTA', href: 'https://abta.com' }],
    });

    const [item] = props.items as Array<Record<string, unknown>>;
    expect(item.src).toBe('https://cdn.example.com/abta.svg');
    expect(item.href).toBe('https://abta.com');
  });

  it('empties a javascript: link', () => {
    const props = saved('logos', {
      // eslint-disable-next-line no-script-url
      items: [{ src: 'https://cdn.example.com/a.svg', alt: 'A', href: 'javascript:alert(1)' }],
    });

    expect((props.items as Array<Record<string, unknown>>)[0].href).toBe('');
  });

  it('empties a javascript: picture, which is the one people forget', () => {
    const props = saved('logos', {
      // eslint-disable-next-line no-script-url
      items: [{ src: 'javascript:alert(1)', alt: 'A' }],
    });

    expect((props.items as Array<Record<string, unknown>>)[0].src).toBe('');
  });

  it('empties a data: picture, which is the other way to smuggle a script in', () => {
    const props = saved('logos', {
      items: [
        { src: 'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==', alt: 'A' },
      ],
    });

    expect((props.items as Array<Record<string, unknown>>)[0].src).toBe('');
  });
});

describe('what the logo strip renderer does', () => {
  const body = renderer('LogosBlock');

  /*
   * A LINK NEEDS A NAME, and an image with no alt text gives it none. This is
   * an AND on purpose and the reason is worth the test: relaxing it to just
   * `item.href !== ''` would look like a tidy-up and would put a row of
   * unnamed links on every client's about page.
   */
  it('links a logo only when it has both an address and a name', () => {
    expect(body).toContain("const linked = item.href !== '' && item.alt !== '';");
  });

  it('drops a logo with no picture, and keeps one with no link', () => {
    expect(body).toContain("item.src !== ''");
    expect(body).toContain('{linked ? (');
  });

  it('opens an outward link without handing over the referrer', () => {
    expect(body).toContain("rel={external ? 'noopener noreferrer' : undefined}");
  });

  it('says what to do when there is nothing in it yet', () => {
    expect(body).toContain('Add your badges and partner logos');
  });
});

describe('the logo strip stylesheet', () => {
  const css = read('app', 'globals.css');
  const block = css.slice(css.indexOf('.tgs-logos {'), css.indexOf('/* The header and the footer'));

  /*
   * THE WHOLE BLOCK IS THESE TWO LINES. A common HEIGHT with contained scaling
   * is the one thing the Gallery block cannot do and the only reason this
   * exists: a gallery crops to a shared ratio, and logos have no shared ratio,
   * so a cropped ABTA badge is what the alternative looks like.
   */
  it('gives every logo a common height and lets each keep its own width', () => {
    expect(block).toContain('object-fit: contain');
    expect(block).toContain('width: auto');

    /*
     * Sliced at the container query on purpose: the phone override sets a
     * height too, and matching across both would compare a desktop Large with
     * a phone Large and call the pair unsorted. The count assertion below is
     * also what stops this going vacuous if the slice ever misses.
     */
    const desktop = block.slice(0, block.indexOf('@container'));
    expect(desktop.length).toBeGreaterThan(0);

    const heights = [...desktop.matchAll(/data-height='([sml])'\] \.tgs-logos__img \{ height: (\d+)px/g)];
    expect(heights.length).toBe(3);
    // Ascending, because "Small, Medium, Large" that is not is a bug nobody reports.
    const px = heights.map((match) => Number(match[2]));
    expect(px).toEqual([...px].sort((a, b) => a - b));
  });

  it('shrinks the tallest setting on a phone, so six badges are not six rows', () => {
    const phone = block.slice(block.indexOf('@container'));
    expect(phone).toContain("data-height='l'");
    expect(phone).toMatch(/max-width: \d+px/);
  });

  it('caps the width, so one long wordmark cannot take the whole row', () => {
    expect(block).toMatch(/max-width: \d+px/);
  });

  /*
   * There is no hover on a touch screen, so the grey state has to be legible on
   * its own rather than treated as something you reveal. Focus gets the same
   * treatment as hover, or a keyboard is the one way round the row with no
   * feedback at all.
   */
  it('brings the colour back on focus as well as on hover', () => {
    expect(block).toContain(":focus-within .tgs-logos__img");
  });
});
