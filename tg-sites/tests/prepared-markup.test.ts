/**
 * Borrowed markup, cleaned on the server and drawn in the browser.
 *
 * The imported design and the embed block hold HTML somebody else wrote. They
 * used to clean themselves at render time, which is the right rule in the wrong
 * place: the editor canvas renders in the browser, so it shipped parse5 and
 * postcss to do it. The cleaning moved to the server and the result is threaded
 * to the renderer as plain strings (lib/content/prepared.ts, task #94).
 *
 * Two things are worth proving here and they pull in opposite directions. The
 * first is that the arrangement WORKS: the right blocks get prepared, nested ones
 * included. The second is that it STAYS: nothing puts a parser back into a module
 * the browser loads, which is a fact about imports rather than behaviour, so it is
 * read from source.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { needsPreparing, preparedFor, type PreparedMap } from '../lib/content/prepared';
import { prepareBlock, prepareSections } from '../lib/content/prepare-markup';
import { createBlock, createPage } from '../lib/content/factory';
import { addBlock } from '../lib/content/tree';
import { updateBlockPropsAtPath } from '../lib/content/tree';

function read(...parts: string[]): string {
  return readFileSync(join(__dirname, '..', ...parts), 'utf8');
}

describe('a block is prepared only if it holds somebody else’s markup', () => {
  it('names the two that do', () => {
    expect(needsPreparing('imported')).toBe(true);
    expect(needsPreparing('embed')).toBe(true);
  });

  it('and nothing else, including values that are not block types at all', () => {
    for (const type of ['text', 'heading', 'image', 'cards', '', 'Imported']) {
      expect(needsPreparing(type)).toBe(false);
    }
    expect(needsPreparing(null)).toBe(false);
    expect(needsPreparing(undefined)).toBe(false);
    expect(needsPreparing({ type: 'imported' })).toBe(false);
  });
});

describe('the lookup is total, because the map crosses a wire', () => {
  const good: PreparedMap = { a: { html: '<p>x</p>', css: '.a{color:red}' } };

  it('answers for a block it holds', () => {
    expect(preparedFor(good, 'a')).toEqual({ html: '<p>x</p>', css: '.a{color:red}' });
  });

  it('answers null rather than throwing for everything it does not', () => {
    expect(preparedFor(good, 'b')).toBeNull();
    expect(preparedFor(undefined, 'a')).toBeNull();
    expect(preparedFor(good, '')).toBeNull();
    // Shapes a truncated or older payload could arrive as.
    expect(preparedFor({ a: null } as unknown as PreparedMap, 'a')).toBeNull();
    expect(preparedFor({ a: 'x' } as unknown as PreparedMap, 'a')).toBeNull();
    expect(preparedFor({ a: {} } as unknown as PreparedMap, 'a')).toBeNull();
    expect(preparedFor({ a: { html: 1, css: 2 } } as unknown as PreparedMap, 'a')).toBeNull();
  });
});

describe('the server pass cleans what it should', () => {
  it('rebuilds an imported design’s markup and scopes its stylesheet to the block', () => {
    const ready = prepareBlock({
      id: 'abc',
      type: 'imported',
      props: { html: '<div onclick="evil()">hello<script>alert(1)</script></div>', css: '.x{color:red}' },
    } as Parameters<typeof prepareBlock>[0]);

    expect(ready).not.toBeNull();
    expect(ready!.html).toContain('hello');
    expect(ready!.html).not.toContain('onclick');
    expect(ready!.html).not.toContain('script');
    // Confined to this block's own class, so two designs cannot argue.
    expect(ready!.css).toContain('.tgi-abc');
  });

  it('runs an embed through the parser-backed sanitiser', () => {
    const ready = prepareBlock({
      id: 'e1',
      type: 'embed',
      props: { html: '<p>ok</p><script>alert(1)</script>' },
    } as Parameters<typeof prepareBlock>[0]);

    expect(ready).not.toBeNull();
    expect(ready!.html).toContain('ok');
    expect(ready!.html).not.toContain('alert(1)');
  });

  it('returns null for a block that needs none, and for one with nothing in it', () => {
    expect(prepareBlock(createBlock('text'))).toBeNull();
    expect(
      prepareBlock({ id: 'z', type: 'imported', props: { html: '', css: '' } } as Parameters<typeof prepareBlock>[0]),
    ).toBeNull();
  });
});

describe('the walk reaches every block, nested ones included', () => {
  const path = { kind: 'block' as const, section: 0, row: 0, column: 0, block: 0 };

  it('prepares an imported design sitting in an ordinary column', () => {
    let page = createPage();
    page = addBlock(page, 0, 0, 0, createBlock('imported'));
    page = updateBlockPropsAtPath(page, path, { html: '<p>plain</p>', css: '' });

    const id = page.sections[0].rows[0].columns[0].blocks[0].id;
    const map = prepareSections(page.sections);
    expect(Object.keys(map)).toEqual([id]);
    expect(map[id].html).toContain('plain');
  });

  it('and one dropped inside a container, where a rows-and-columns walk never looks', () => {
    let page = createPage();
    page = addBlock(page, 0, 0, 0, createBlock('container'));
    page = updateBlockPropsAtPath(page, path, {
      columns: [
        {
          blocks: [{ id: 'inner-1', type: 'imported', props: { html: '<p>nested</p>', css: '' } }],
        },
      ],
    });

    const map = prepareSections(page.sections);
    expect(map['inner-1']).toBeDefined();
    expect(map['inner-1'].html).toContain('nested');
  });

  it('survives a malformed tree rather than throwing part way down a page', () => {
    expect(prepareSections(undefined)).toEqual({});
    expect(prepareSections([] as never)).toEqual({});
    expect(prepareSections([{ rows: null }] as never)).toEqual({});
  });
});

describe('the parsers stay out of every module the browser loads', () => {
  /*
   * THE POINT OF THE WHOLE CHANGE, and the one part of it a behavioural test
   * cannot catch: everything below would still render correctly with parse5 back
   * in the bundle. Measured 23 Aug 2026, before: parse5 on /editor, /collections,
   * /settings and /sites; postcss on /editor. After: neither on any of them.
   */
  const HEAVY = [
    "from '../../lib/import/html'",
    "from '../../lib/import/css'",
    "from '../../lib/import/tokenise'",
    "from '../../lib/content/sanitise-embed'",
  ];

  it('the renderer imports none of the modules that carry one', () => {
    const blocks = read('components', 'render', 'blocks.tsx');
    for (const heavy of HEAVY) {
      expect(blocks).not.toContain(heavy);
    }
  });

  it('sanitise.ts does not reach the embed sanitiser, which is how it leaked to four routes', () => {
    const sanitise = read('lib', 'content', 'sanitise.ts');
    expect(sanitise).not.toMatch(/from '\.\/sanitise-embed'/);
    // Dropped from the type, so a leftover call is a build error rather than a
    // silent fall-through to the regex walk.
    expect(sanitise).toMatch(/export type SanitiseMode = 'richtext' \| 'heading';/);
  });

  it('the scope class and the slot substitution live in modules with no parser', () => {
    for (const file of [['lib', 'import', 'scope.ts'], ['lib', 'import', 'slots.ts']]) {
      const source = read(...file);
      expect(source).not.toMatch(/from 'parse5'/);
      expect(source).not.toMatch(/from 'postcss'/);
    }
  });

  it('the server pass is marked server-only, so importing it from a client fails the build', () => {
    expect(read('lib', 'content', 'prepare-markup.ts')).toMatch(/^import 'server-only';/m);
  });

  it('and the side channel itself stays light, since the renderer reads it', () => {
    const prepared = read('lib', 'content', 'prepared.ts');
    expect(prepared).not.toMatch(/from 'parse5'/);
    expect(prepared).not.toMatch(/from 'postcss'/);
    expect(prepared).not.toMatch(/from '\.\.\/import\//);
  });
});

describe('a block with no entry draws nothing, never the stored string', () => {
  it('the imported block reads the channel and not its own html prop', () => {
    const source = read('components', 'render', 'blocks.tsx');
    // The substitution runs against what the channel gave, so with no entry it
    // substitutes into '' and the block falls to its placeholder.
    expect(source).toContain("applyImportContent(ready?.html ?? ''");
    expect(source).toContain('const ready = preparedFor(prepared, blockId);');
  });

  it('the embed block does the same', () => {
    const source = read('components', 'render', 'blocks.tsx');
    expect(source).toContain('if (!ready?.html) return <div className="tgs-placeholder">Paste embed code</div>;');
  });
});
