/**
 * The HTML block's sanitiser, which is the one place a client's own markup
 * reaches a live page.
 *
 * This file is the reason that block could be opened to every client on 20 Aug
 * 2026. It is written as an attacker would: each test is a payload that used to
 * work somewhere, or that works against a naive sanitiser, and the assertion is
 * that it does not survive here.
 *
 * THE PROPERTY UNDER TEST, above any individual payload: nothing from the input
 * is concatenated into the output. parse5 builds a tree, the walk rebuilds the
 * markup from names and values it checked itself. That is what closes off
 * mutation XSS, where a regex sanitiser and a browser disagree about where a tag
 * ends and the browser runs what the sanitiser waved through.
 */

import { describe, expect, it } from 'vitest';

import { cleanEmbedHtml, sanitiseEmbedHtml } from '../lib/content/sanitise-embed';
import { sanitiseHtml } from '../lib/content/sanitise';
import { WIDGET_ORIGIN } from '../lib/content/widgets';

/** Lowercased, so an assertion cannot be fooled by <SCRIPT> or onERROR. */
const clean = (input: string) => sanitiseEmbedHtml(input).toLowerCase();

describe('the payloads that must never survive', () => {
  it('drops inline script, and its body with it', () => {
    const out = clean('<div>Hello</div><script>alert(document.cookie)</script>');
    expect(out).not.toContain('<script');
    expect(out).not.toContain('alert');
    // The legitimate markup around it is untouched.
    expect(out).toContain('hello');
  });

  it('drops every on* handler, however it is spelled or spaced', () => {
    for (const payload of [
      '<img src="https://cdn.test/a.jpg" onerror="alert(1)">',
      '<img src="https://cdn.test/a.jpg" OnErRoR="alert(1)">',
      '<div onclick="alert(1)">x</div>',
      '<div onmouseover=alert(1)>x</div>',
      '<a href="https://ok.test" onfocus="alert(1)" autofocus>x</a>',
    ]) {
      const out = clean(payload);
      expect(out, payload).not.toContain('alert');
      expect(out, payload).not.toMatch(/on[a-z]+=/);
    }
  });

  it('refuses javascript: and data: urls, including the obfuscated ones', () => {
    for (const payload of [
      '<a href="javascript:alert(1)">x</a>',
      '<a href="JaVaScRiPt:alert(1)">x</a>',
      '<a href="java\u0000script:alert(1)">x</a>',
      '<a href="  javascript:alert(1)">x</a>',
      '<a href="data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==">x</a>',
      '<img src="data:text/html,<script>alert(1)</script>">',
    ]) {
      const out = clean(payload);
      expect(out, payload).not.toContain('javascript:');
      expect(out, payload).not.toContain('data:text/html');
      expect(out, payload).not.toContain('alert');
    }
  });

  /*
   * THE MUTATION XSS FAMILY. Each of these is malformed on purpose: a regex
   * sanitiser reads the tag boundary one way and a browser reads it another.
   * parse5 reads it the way a browser does, which is the whole point of using it.
   */
  it('is not fooled by malformed markup a regex would misread', () => {
    for (const payload of [
      '<div><p>x</div></p>',
      '<img src="x" alt="><script>alert(1)</script>">',
      '<a href="https://ok.test" title="\'><script>alert(1)</script>">x</a>',
      '<svg><script>alert(1)</script></svg>',
      '<math><mtext><script>alert(1)</script></mtext></math>',
      '<noscript><p title="</noscript><script>alert(1)</script>">',
      '<![CDATA[<script>alert(1)</script>]]>',
      '<!--><script>alert(1)</script>-->',
      '<style><script>alert(1)</script></style>',
    ]) {
      const out = clean(payload);

      /*
       * NO SCRIPT ELEMENT, which is the property that matters. Asserting the
       * absence of the string "alert(1)" would be the cruder test and a WRONG
       * one: parse5 reads the second payload's `><script>...` as the value of
       * the alt attribute, exactly as a browser does, and the walk writes it
       * back entity-escaped. The characters survive as visible text and cannot
       * execute, which is the correct outcome rather than a leak.
       *
       * The output is only ever written by our own walk, and the only <script
       * it can write is one whose src is ours, so "contains no <script" is the
       * whole claim. The ours-only rules are proved separately below.
       */
      expect(out, payload).not.toContain('<script');
      expect(out, payload).not.toContain('javascript:');
      // Nothing escaped its attribute: every angle bracket left in a value is
      // an entity, so no payload reopened the markup.
      expect(out.replace(/&lt;|&gt;|&amp;|&quot;|&#39;/g, ''), payload).not.toContain('alert(1)<');
    }

    // Said positively, on the one payload where the characters do survive: they
    // survive as escaped text, which is inert.
    const alt = sanitiseEmbedHtml('<img src="https://cdn.test/a.jpg" alt="><script>alert(1)</script>">');
    expect(alt).toContain('&lt;script&gt;');
    expect(alt).not.toContain('<script>');
  });

  it('drops the tags whose content is the danger', () => {
    const out = clean(
      '<style>body{display:none}</style>'
      + '<form action="https://evil.test"><input name="card"><button>Go</button></form>'
      + '<object data="x.swf"></object><base href="https://evil.test">',
    );
    expect(out).not.toContain('<style');
    expect(out).not.toContain('<form');
    expect(out).not.toContain('<input');
    expect(out).not.toContain('<object');
    expect(out).not.toContain('<base');
    expect(out).not.toContain('display:none');
  });

  it('refuses an id, so an embed cannot clobber the DOM or collide with another', () => {
    const out = clean('<div id="location">x</div>');
    expect(out).not.toContain('id=');
    expect(out).toContain('x');
  });

  it('never lets a raw angle bracket through as markup', () => {
    const out = sanitiseEmbedHtml('<p>5 < 6 & 7 > 2</p>');
    expect(out).toContain('&lt;');
    expect(out).toContain('&amp;');
    expect(out).toContain('&gt;');
  });
});

describe('scripts: ours run, everybody else\'s does not', () => {
  const widget =
    `<div data-tg-widget="offers" data-tg-id="tgw_abc123"></div>`
    + `<script src="${WIDGET_ORIGIN}/widget-offers.js" defer></script>`;

  it('keeps a Travelgenix widget embed exactly as pasted', () => {
    const out = sanitiseEmbedHtml(widget);
    // The container survives WITH the attributes the script looks for. Without
    // both of these the widget renders an empty box forever.
    expect(out).toContain('data-tg-widget="offers"');
    expect(out).toContain('data-tg-id="tgw_abc123"');
    expect(out).toContain(`<script src="${WIDGET_ORIGIN}/widget-offers.js" defer></script>`);
  });

  it('keeps the vercel spelling of our own origin too', () => {
    const out = sanitiseEmbedHtml('<script src="https://tg-widgets.vercel.app/widget-hours.js"></script>');
    expect(out).toContain('tg-widgets.vercel.app/widget-hours.js');
  });

  it('drops a script from anywhere else, and says so', () => {
    for (const src of [
      'https://evil.test/x.js',
      'https://widgets.travelify.io.evil.test/x.js',
      'https://evil.test/?x=widgets.travelify.io',
      'http://widgets.travelify.io/widget-offers.js',
      '//widgets.travelify.io/widget-offers.js',
    ]) {
      const result = cleanEmbedHtml(`<script src="${src}"></script>`);
      expect(result.html, src).toBe('');
      expect(result.removed, src).toContain('a script that was not one of ours');
    }
  });

  it('drops inline code even on a script pointing at our own origin', () => {
    const out = clean(`<script src="${WIDGET_ORIGIN}/widget-offers.js">alert(1)</script>`);
    expect(out).not.toContain('<script');
    expect(out).not.toContain('alert');
  });

  it('keeps no attribute on a script but src, defer and async', () => {
    const out = sanitiseEmbedHtml(
      `<script src="${WIDGET_ORIGIN}/widget-offers.js" onload="alert(1)" nonce="x" integrity="y"></script>`,
    );
    expect(out).not.toContain('onload');
    expect(out).not.toContain('nonce');
    expect(out).not.toContain('integrity');
    expect(out).toContain('src=');
  });
});

describe('what a client legitimately needs still works', () => {
  it('keeps ordinary markup, classes and safe links', () => {
    const out = sanitiseEmbedHtml(
      '<div class="promo"><h3>Book early</h3><p>Save <strong>10%</strong> until May.</p>'
      + '<a href="/offers" title="Our offers">See offers</a></div>',
    );
    expect(out).toContain('class="promo"');
    expect(out).toContain('<h3>Book early</h3>');
    expect(out).toContain('<strong>10%</strong>');
    expect(out).toContain('href="/offers"');
  });

  it('severs the opener on a new-tab link', () => {
    const out = sanitiseEmbedHtml('<a href="https://ok.test" target="_blank">x</a>');
    expect(out).toContain('rel="noopener noreferrer"');
  });

  it('keeps an allowlisted frame and drops the rest of the web', () => {
    expect(sanitiseEmbedHtml('<iframe src="https://www.youtube.com/embed/abc"></iframe>')).toContain('iframe');

    const bad = cleanEmbedHtml('<iframe src="https://evil.test/x"></iframe>');
    // The whole element goes, not just its address: an empty frame is a visible
    // empty box on a client's page, which reads as a fault rather than a refusal.
    expect(bad.html).toBe('');
    expect(bad.removed).toContain('a frame from a site we do not embed');
  });

  it('keeps an inline style only as far as the style allowlist does', () => {
    const out = sanitiseEmbedHtml('<p style="color:#ff0000;position:fixed;top:0">x</p>');
    expect(out).toContain('color');
    // position:fixed is how an embed would cover the page it sits on.
    expect(out).not.toContain('position');
  });

  it('unwraps a tag it has no opinion about rather than losing the words', () => {
    const out = clean('<my-widget><p>Keep me</p></my-widget>');
    expect(out).not.toContain('my-widget');
    expect(out).toContain('keep me');
  });

  it('survives junk without throwing, and returns a string every time', () => {
    for (const junk of ['', '<<<<', '<div', '</p>', '<p>'.repeat(200), '\u0000\u0001']) {
      expect(typeof sanitiseEmbedHtml(junk)).toBe('string');
    }
    expect(sanitiseEmbedHtml(null)).toBe('');
    expect(sanitiseEmbedHtml(undefined)).toBe('');
    expect(sanitiseEmbedHtml(42)).toBe('');
  });

  it('caps how deep and how large one embed may be', () => {
    const deep = cleanEmbedHtml('<div>'.repeat(80) + 'x' + '</div>'.repeat(80));
    expect(deep.removed).toContain('content nested too deeply');

    const wide = cleanEmbedHtml('<p>x</p>'.repeat(800));
    expect(wide.removed).toContain('the embed was larger than we allow in one block');
  });
});

describe('the one door', () => {
  /*
   * Both the save path and the renderer call sanitiseHtml(value, 'embed'). If
   * that stopped reaching the parser-backed module, everything above would still
   * pass while the live page went back through the tokeniser.
   */
  it('routes embed mode through the parser, not the tag walk', () => {
    const payload = '<div><p>x</div></p><script>alert(1)</script>';
    expect(sanitiseHtml(payload, 'embed')).toBe(sanitiseEmbedHtml(payload));
  });

  it('leaves rich text on its own allowlist, which admits no div', () => {
    expect(sanitiseHtml('<div>x</div>', 'richtext')).not.toContain('<div');
  });
});
