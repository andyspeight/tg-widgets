/**
 * Reading a section captured by the Slicer.
 *
 * This is the join between the Slicer (which copies a section off any site as
 * one bundle) and the import screen (which wants the markup and the stylesheet
 * apart). It takes either thing the Slicer copies and refuses everything else,
 * so a plain HTML paste is left untouched. The shapes here are the exact shapes
 * the Slicer's copy buttons produce, so a change either side that broke the
 * handoff would fail a test rather than a demo.
 */

import { describe, expect, it } from 'vitest';

import { readSlice } from '../lib/import/slice';

describe('reading a Slicer bundle', () => {
  it('reads the { html, css } JSON the copy-for-sites button gives', () => {
    const bundle = JSON.stringify({
      html: '<section class="tgs-1"><h2 class="tgs-2">Hi</h2></section>',
      css: '.tgs-1{background:#052}.tgs-2{color:#fff}',
      meta: { source: 'https://example.com' },
    });
    const slice = readSlice(bundle);
    expect(slice).not.toBeNull();
    expect(slice?.html).toContain('<section');
    expect(slice?.css).toContain('.tgs-1');
    // meta is ignored; only the two fields the import needs come through.
  });

  it('lifts the styles out of a self-contained HTML+CSS copy', () => {
    const doc = '<style>.tgs-1{color:#052}</style>\n<section class="tgs-1">Hi</section>';
    const slice = readSlice(doc);
    expect(slice?.css).toBe('.tgs-1{color:#052}');
    // The style tag is gone from the markup, since the import cleaner refuses it.
    expect(slice?.html).not.toContain('<style');
    expect(slice?.html).toContain('<section');
  });

  it('lifts more than one style block', () => {
    const doc = '<style>.a{}</style><div class="a"></div><style>.b{}</style>';
    const slice = readSlice(doc);
    expect(slice?.css).toContain('.a{}');
    expect(slice?.css).toContain('.b{}');
    expect(slice?.html).not.toContain('<style');
  });

  it('gives a JSON bundle with no css an empty stylesheet, not a crash', () => {
    const slice = readSlice(JSON.stringify({ html: '<p>Hi</p>' }));
    expect(slice?.html).toBe('<p>Hi</p>');
    expect(slice?.css).toBe('');
  });

  it('leaves a plain HTML paste alone, so the normal path is unchanged', () => {
    expect(readSlice('<section><h2>A heading</h2></section>')).toBeNull();
  });

  it('is null for empty or junk input', () => {
    expect(readSlice('')).toBeNull();
    expect(readSlice('   ')).toBeNull();
    // A JSON object that is not a slice (no html) is not a slice.
    expect(readSlice('{"foo":"bar"}')).toBeNull();
    // Broken JSON with no style tag is just text, left to the plain path.
    expect(readSlice('{not json')).toBeNull();
  });
});
