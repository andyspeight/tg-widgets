/**
 * The Read more element.
 *
 * THE PROPERTY THAT MATTERS, and the reason this is not the usual read-more:
 * THE WHOLE TEXT IS ALWAYS IN THE HTML. Only its display is clamped. A scripted
 * read-more reveals or fetches the rest on click, which hides half a page's
 * words from a search engine, from a screen reader and from anybody with
 * JavaScript off. On a product whose whole job is being found, that is an odd
 * thing to do to yourself, so the tests below pin the text being present rather
 * than the fold being pretty.
 *
 * The second property is that it runs on no JavaScript at all, because a
 * published page ships none and could not run any if it did.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { blockDefinition, defaultPropsFor, isKnownBlock } from '../lib/content/blocks';
import { changeScope } from '../lib/content/change-scope';
import { parsePage, type Page } from '../lib/content/schema';
import { sanitisePage } from '../lib/content/sanitise-page';

function source(...parts: string[]): string {
  return readFileSync(join(__dirname, '..', ...parts), 'utf8');
}

function pageWith(props: Record<string, unknown>): Page {
  const parsed = parsePage({
    version: 1,
    id: 'p1',
    title: 'About',
    slug: 'about',
    seo: { noindex: false },
    sections: [
      {
        id: 's1',
        tone: 'light',
        rows: [
          {
            id: 'r1',
            columns: [{ id: 'c1', width: 100, blocks: [{ id: 'b1', type: 'read-more', props }] }],
          },
        ],
      },
    ],
  });
  if (!parsed.ok) throw new Error(parsed.errors.join('; '));
  return sanitisePage(parsed.page);
}

const props0 = (page: Page) => page.sections[0].rows[0].columns[0].blocks[0].props;

// ---------------------------------------------------------------------------

describe('the block', () => {
  const definition = blockDefinition('read-more')!;

  it('is in the library, under Text, and belongs to the client', () => {
    expect(isKnownBlock('read-more')).toBe(true);
    expect(definition.group).toBe('Text');
    expect(definition.staffOnly).toBeUndefined();
  });

  it('sets a default for every field the editor offers', () => {
    const props = defaultPropsFor('read-more');
    for (const field of definition.fields) {
      expect(props, `no default for "${field.key}"`).toHaveProperty(field.key);
    }
  });

  it('takes rich text, so a folded passage can have its own formatting', () => {
    expect(definition.fields.find((f) => f.key === 'html')?.kind).toBe('richtext');
  });

  it('lets the client choose both labels and how much shows', () => {
    const props = defaultPropsFor('read-more');
    expect(props.moreLabel).toBe('Read more');
    expect(props.lessLabel).toBe('Show less');
    expect(props.lines).toBe(4);
  });
});

// ---------------------------------------------------------------------------

describe('the words are never hidden from anything that reads them', () => {
  /*
   * THE TEST THIS FILE EXISTS FOR. If the renderer ever starts emitting only a
   * preview and holding the rest back, this fails, and so does the block's
   * reason for being built this way.
   */
  it('keeps the whole text in the markup, clamping only the display', () => {
    const renderer = source('components', 'render', 'blocks.tsx');
    expect(renderer).toContain('export function ReadMoreBlock(');
    // One body element, holding the sanitised html in full.
    expect(renderer).toMatch(
      /ReadMoreBlock[\s\S]*?className="tgs-readmore__body tgs-text"\s*dangerouslySetInnerHTML=\{\{ __html: html \}\}/,
    );
    // Nothing anywhere that cuts the text itself.
    expect(renderer).not.toMatch(/ReadMoreBlock[\s\S]{0,1500}html\.slice\(/);
  });

  it('folds in CSS, on a line boundary rather than a fixed height', () => {
    const css = source('app', 'globals.css');
    expect(css).toContain('-webkit-line-clamp: var(--tgs-rm-lines, 4);');
    expect(css).toContain('.tgs-readmore__toggle:checked ~ .tgs-readmore__body {');
  });

  /*
   * THE FADE IS MEASURED FROM THE BOTTOM OF THE BOX, and the alternative was
   * tried and rejected. Anchoring it to the fold (`calc(lines * 1lh)`) means a
   * passage shorter than the fold gets no fade, which is nicer — but `lh` counts
   * line boxes and knows nothing about the margins between paragraphs, so on any
   * text with more than one paragraph the stops land part-way up the last line
   * and take half of it with them. Multiple paragraphs is the ordinary case here.
   *
   * If this ever changes back, it should be because CSS gained a way to ask
   * "did this overflow", not because `1lh` looked tidier.
   */
  it('positions the fade against the box, not the line count', () => {
    const css = source('app', 'globals.css');
    expect(css).toContain('mask-image: linear-gradient(to bottom, #000 calc(100% - 1.1em), transparent 100%);');
    expect(css).not.toContain('* 1lh - ');
  });

  /* A mask, not an overlay: an overlay has to know the colour behind it, and
     this block sits on four section tones and over photographs. */
  it('fades with a mask so it works on any background', () => {
    expect(source('app', 'globals.css')).toMatch(/\.tgs-readmore\[data-fade='true'\][\s\S]{0,200}mask-image/);
  });
});

// ---------------------------------------------------------------------------

describe('it runs on no JavaScript', () => {
  const renderer = source('components', 'render', 'blocks.tsx');

  /*
   * The same hidden-input shape TabsBlock uses. The input comes FIRST because
   * the stylesheet reaches the body and the label with `:checked ~`, and the
   * general sibling combinator only looks forward.
   */
  it('toggles with a checkbox and a label, not a handler', () => {
    expect(renderer).toContain('className="tgs-readmore__toggle tgs-sr-only"');
    expect(renderer).toContain('<label className="tgs-readmore__control" htmlFor={id}>');
    expect(renderer).not.toMatch(/ReadMoreBlock[\s\S]{0,2000}onClick/);
  });

  it('shows one label at a time from the stylesheet, not by swapping text', () => {
    const css = source('app', 'globals.css');
    expect(css).toContain('.tgs-readmore__less { display: none; }');
    expect(css).toContain(
      '.tgs-readmore__toggle:checked ~ .tgs-readmore__control .tgs-readmore__more { display: none; }',
    );
  });

  /* The input is what takes focus; the label is what a person can see. The ring
     is drawn on the label so it appears where they are looking. */
  it('draws the focus ring where the control is', () => {
    expect(source('app', 'globals.css')).toContain(
      '.tgs-readmore__toggle:focus-visible ~ .tgs-readmore__control {',
    );
  });

  /* Clicking a preview to select the block must not also fold the text the
     agent is looking at. */
  it('makes the checkbox inert on the editor canvas', () => {
    expect(renderer).toContain('disabled={editing}');
    expect(source('components', 'render', 'BlockRenderer.tsx')).toContain(
      '<ReadMoreBlock props={props} blockId={block.id} editing={editable} />',
    );
  });

  /* Two blocks sharing an id would toggle each other. */
  it('ties the label to its own block, not to a generated name', () => {
    expect(renderer).toContain('const id = `tgs-rm-${blockId}`;');
  });
});

// ---------------------------------------------------------------------------

describe('on a saved page', () => {
  it('sanitises the text on the way in', () => {
    const props = props0(pageWith({ html: '<p>Hello<script>alert(1)</script></p>', lines: 3 }));
    expect(String(props.html)).not.toContain('<script');
    expect(String(props.html)).toContain('Hello');
  });

  it('counts rewriting the words as content', () => {
    const before = pageWith({ html: '<p>Before</p>', lines: 4 });
    const after = JSON.parse(JSON.stringify(before)) as Page;
    props0(after).html = '<p>After</p>';
    expect(changeScope(before, after).structure).toBe(false);
  });

  it('counts changing how much shows as structure', () => {
    const before = pageWith({ html: '<p>Words</p>', lines: 4 });
    const after = JSON.parse(JSON.stringify(before)) as Page;
    props0(after).lines = 8;
    expect(changeScope(before, after).structure).toBe(true);
  });
});
