/**
 * The Preview button: see the site as it will publish, and interact with it.
 *
 * Andy, 11 Aug 2026: "add a preview button so that whilst in the editor you can
 * see the site exactly as it would be when published, and that you can interact
 * with it as if it were 'live'. The sidebars should disappear so you can see the
 * site in the full canvas." So preview is one flag: the shell hides both side
 * panels and folds the editing-only controls, and the canvas renders the same
 * in-memory draft with editable=false, which is the exact published DOM, with
 * its editing interactions off and links left to behave. It reflects the current
 * work, edits not yet saved included, because it is the SAME page object.
 *
 * These read the wiring from source, as the other editor-interaction suites do;
 * the toggle and the full-canvas layout are driven in a browser by
 * verify-standalone.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

function read(...parts: string[]): string {
  return readFileSync(join(__dirname, '..', ...parts), 'utf8');
}

describe('the shell drives a preview mode from a top-bar button', () => {
  const shell = read('components', 'editor', 'EditorShell.tsx');

  it('holds a preview flag and marks the root with it', () => {
    expect(shell).toContain('const [preview, setPreview] = useState(false)');
    expect(shell).toContain("data-preview={preview ? 'true' : undefined}");
  });

  it('offers a Preview button that toggles the mode and reads its state', () => {
    expect(shell).toContain('<Icon name="eye"');
    expect(shell).toContain('onClick={preview ? exitPreview : enterPreview}');
    expect(shell).toContain("{preview ? 'Exit preview' : 'Preview'}");
  });

  it('clears everything that floats over the canvas on entering preview', () => {
    const fn = shell.slice(shell.indexOf('const enterPreview = useCallback('));
    const body = fn.slice(0, fn.indexOf('}, []);'));
    // The selection and its toolbar, the popover, the picker, the section
    // inserter and the history panel all belong to editing, not to a preview.
    expect(body).toContain('setSelected(null)');
    expect(body).toContain('setPicker(null)');
    expect(body).toContain('setInsertAt(null)');
    expect(body).toContain('setHistoryOpen(false)');
    expect(body).toContain('setPreview(true)');
  });

  it('leaves preview on Escape', () => {
    expect(shell).toContain("if (event.key === 'Escape') setPreview(false)");
  });

  it('hands the flag to the canvas and folds the editing-only controls away', () => {
    expect(shell).toContain('preview={preview}');
    // Undo, redo, publish and the panel toggles carry the class the preview CSS
    // hides. The Preview button and the device switcher are NOT among them, so
    // there is always a way back out and a way to check each screen size.
    expect(shell).toContain('ed-btn ed-editing-only');
    expect(shell).toContain('ed-seg ed-desktop-only ed-editing-only');
  });
});

describe('the canvas renders the published DOM in preview, and lets links behave', () => {
  const canvas = read('components', 'editor', 'Canvas.tsx');

  it('renders editable=false, so no data-path, insert points or edit hosts', () => {
    // The one lever: editable=false is exactly what the published routes pass,
    // so preview draws the published DOM. It even plays a background video, which
    // the editor only ever shows a poster for.
    expect(canvas).toContain('editable={!preview}');
  });

  it('drops the editing interactions and swaps in the link-only click', () => {
    expect(canvas).toContain('onClick={preview ? onPreviewClick : onClick}');
    expect(canvas).toContain('onInput={preview ? undefined : onInput}');
    expect(canvas).toContain('onPointerDown={preview ? undefined : onPointerDown}');
  });

  it('opens a link in a new tab so the editor and its unsaved edits survive', () => {
    const fn = canvas.slice(canvas.indexOf('const onPreviewClick = useCallback('));
    const body = fn.slice(0, fn.indexOf('}, []);'));
    // An in-page anchor is left to scroll; anything else opens away from the
    // editor rather than navigating the one tab that holds the unsaved page.
    expect(body).toContain("href.startsWith('#')");
    expect(body).toContain("window.open(link.href, '_blank'");
  });
});

describe('the stylesheet makes preview the whole canvas', () => {
  const css = read('components', 'editor', 'editor.css');

  it('collapses the grid to one column and hides both side panels', () => {
    expect(css).toMatch(/\.ed-root\[data-preview='true'\] \{[\s\S]*?grid-template-columns: 1fr/);
    expect(css).toContain("[data-preview='true'] .ed-outline");
    expect(css).toContain("[data-preview='true'] .ed-props");
  });

  it('steps the editing-only top-bar controls aside', () => {
    expect(css).toContain("[data-preview='true'] .ed-editing-only");
  });
});

describe('the icon set gained an eye for it', () => {
  const icon = read('components', 'editor', 'Icon.tsx');

  it('declares the eye name and a path for it', () => {
    expect(icon).toContain("| 'eye'");
    expect(icon).toMatch(/eye:\s*'M/);
  });
});
