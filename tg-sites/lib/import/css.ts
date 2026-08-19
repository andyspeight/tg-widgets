/**
 * Turning somebody else's stylesheet into CSS this product will serve.
 *
 * THE ONE PROPERTY EVERYTHING ELSE RESTS ON: after this runs, no rule from the
 * import can match an element outside the imported section. Every selector gets
 * an ancestor put in front of it, so matching requires being inside that
 * ancestor's subtree. There is no selector syntax that escapes a descendant
 * combinator, which is why the confinement is structural rather than a list of
 * things we remembered to ban.
 *
 * WHY THE SELECTORS ARE NOT REWRITTEN BEYOND THAT, AND CLASS NAMES ARE LEFT
 * ALONE. An earlier sketch prefixed every class so `.container` became
 * `.tgi_container`. Two things killed it. Our own CSS is namespaced end to end
 * (.tgs-* for the rendered page, .ed-* for the editor chrome, and not one bare
 * element rule in globals.css), so the ancestor scope already does the whole
 * job of keeping the two apart. And a Relume export is Tailwind: `md:flex`,
 * `w-1/2`, `p-[10px]`, `[&>*]:mt-2`. Prefixing those means unescaping the CSS
 * form, prefixing, then re-escaping, in a security-critical path, to solve a
 * collision that cannot happen. So: scope by ancestor, leave the names.
 *
 * MIS-PARSING IS FAIL-SAFE, WHICH IS THE REASON THIS IS HAND-ROLLED RATHER THAN
 * ANOTHER DEPENDENCY. Splitting a selector list is the only parsing done here.
 * If the split is ever wrong, both halves are still given the ancestor and both
 * are syntactically broken, so the browser drops the rule. The failure mode is
 * a lost style, never a rule that reaches the rest of the page.
 *
 * WHAT IT REFUSES OUTRIGHT: @import (a stylesheet that fetches more stylesheets
 * is a network dependency we cannot see the far end of), @font-face (this
 * product downloads and self-hosts every font on purpose, which is what
 * lib/fonts/preview.ts and the font-preview route exist for; an imported face
 * would put the visitor's browser back on somebody else's origin), expression(),
 * -moz-binding, behavior:, progid:, and any url() whose scheme we do not vouch
 * for.
 */

import { parse, type AtRule, type ChildNode, type Container, type Declaration, type Rule } from 'postcss';

import { safeImportUrl } from './html';

export interface ScopeOptions {
  /** The selector everything is confined to, e.g. `.tgi-a1b2c3`. */
  scope: string;
  /** How many rules to keep. A guard against a pasted megabyte. */
  maxRules?: number;
  /** How much CSS to accept at all. */
  maxBytes?: number;
}

export interface ScopeResult {
  css: string;
  /** What was thrown away, so the screen can say so rather than silently differ. */
  removed: string[];
}

/**
 * The class that confines one import.
 *
 * ONE PLACE DECIDES IT, because the block that writes this class onto its
 * wrapper and the stylesheet that depends on it being there have to agree, and
 * a rendered section whose CSS is scoped to a class it does not carry is an
 * unstyled section with no error anywhere.
 */
export function importScopeClass(id: string): string {
  const safe = String(id).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40);
  return `tgi-${safe || 'x'}`;
}

// ---------------------------------------------------------------------------
// Selector lists
// ---------------------------------------------------------------------------

/**
 * Split `a, b:not(c, d), [x="e,f"]` into its three parts.
 *
 * Depth and quote aware, because a comma inside `:not()`, `:is()` or an
 * attribute value is not a separator. Getting this wrong costs a style; see the
 * header for why it cannot cost containment.
 */
export function splitSelectorList(value: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let current = '';

  for (let i = 0; i < value.length; i += 1) {
    const ch = value[i];

    if (quote) {
      current += ch;
      if (ch === '\\') {
        current += value[i + 1] ?? '';
        i += 1;
      } else if (ch === quote) {
        quote = null;
      }
      continue;
    }

    if (ch === '\\') {
      current += ch + (value[i + 1] ?? '');
      i += 1;
      continue;
    }

    if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
      continue;
    }

    if (ch === '(' || ch === '[') depth += 1;
    else if (ch === ')' || ch === ']') depth -= 1;
    else if (ch === ',' && depth <= 0) {
      parts.push(current);
      current = '';
      continue;
    }

    current += ch;
  }

  parts.push(current);
  return parts;
}

/**
 * The document-level selectors, which mean something different once a design is
 * a section inside a page.
 *
 * `:root` is where a Tailwind build puts its custom properties, and the whole
 * palette lives on it. Scoping it as a descendant would give `.tgi-x :root`,
 * which matches nothing, and the design would arrive with every colour
 * undefined. It has to BECOME the scope element instead, which is also exactly
 * where those properties should be inherited from.
 */
const ROOTISH = /^(:root|:where\(:root\)|html|body)(?![\w-])/i;

/**
 * The characters that can follow a class name without continuing it.
 *
 * `-` and `_` are missing on purpose, because they DO continue one: without
 * this, `.tgi-x` would look like a prefix of `.tgi-xyz` and a rule scoped to a
 * different block would be mistaken for one already scoped to this one.
 */
const AFTER_SCOPE = new Set([' ', '\t', '\n', '.', '#', ':', '[', '>', '+', '~', ',']);

/**
 * Whether a selector is already confined to exactly this scope.
 *
 * WHY THIS IS NEEDED AT ALL: an imported design is scoped twice, once on the
 * way into the database and again on the way out, because stored CSS is never
 * trusted. Without this the second pass would produce `.tgi-x .tgi-x .a`, which
 * needs two nested elements carrying the class and therefore matches nothing.
 * The design would arrive unstyled, and only after a save, which is the worst
 * kind of bug to find.
 *
 * It is not a hole. The selector has to begin with the EXACT scope this call
 * was asked for, and the character after it has to be one that cannot continue
 * a class name, so the containment claim is checked rather than assumed.
 */
function alreadyScoped(selector: string, scope: string): boolean {
  if (!selector.startsWith(scope)) return false;
  const next = selector.charAt(scope.length);
  return next === '' || AFTER_SCOPE.has(next);
}

/** One selector, confined. Null when there is nothing usable in it. */
export function scopeSelectorPart(part: string, scope: string): string | null {
  const trimmed = part.trim();
  if (!trimmed) return null;
  if (trimmed.length > 1000) return null;

  if (alreadyScoped(trimmed, scope)) return trimmed;

  const match = ROOTISH.exec(trimmed);
  if (!match) return `${scope} ${trimmed}`;

  /*
   * NOT TRIMMED YET, AND THAT IS THE WHOLE POINT. `body.dark` is one element
   * carrying two conditions; `body .dark` is an ancestor and a descendant. The
   * only thing telling them apart is the space, so the space has to be read
   * before it is thrown away. Trimming first turned `body .card` into
   * `.tgi-x.card`, which quietly asked for a section that was itself a card
   * instead of the cards inside it.
   */
  const after = trimmed.slice(match[0].length);
  const rest = after.trim();
  if (!rest) return scope;

  const sameElement = !/^\s/.test(after) && /^[.#:[]/.test(rest);
  return sameElement ? `${scope}${rest}` : `${scope} ${rest}`;
}

// ---------------------------------------------------------------------------
// Values
// ---------------------------------------------------------------------------

const URL_PATTERN = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)"']*))\s*\)/gi;

/**
 * Everything a declaration value is not allowed to contain, checked AFTER the
 * url() calls have been lifted out and replaced with placeholders.
 *
 * The order is the point. Checking first would refuse a perfectly good
 * `url(data:image/png;base64,...)`; checking after means a `data:` left in the
 * value is one that was NOT inside a url() and has not been through
 * safeImportUrl, which is the case worth refusing. A surviving `url(` means the
 * pattern above failed to match it, i.e. it was malformed, which is also worth
 * refusing.
 */
const DANGEROUS_VALUE =
  /expression\s*\(|javascript\s*:|vbscript\s*:|-moz-binding|progid\s*:|behaviou?r\s*:|data\s*:|@import|url\s*\(/i;

/** Properties that do something other than style, in browsers that still read them. */
const REFUSED_PROPS = new Set(['behavior', 'behaviour', '-ms-behavior', '-moz-binding']);

/**
 * A URL, made safe to sit inside `url("...")`.
 *
 * Written as a loop over characters rather than a regex, deliberately. The
 * range that needs escaping here is the control characters, and writing that
 * range in a character class is how a literal control byte ends up in the
 * source file, invisible in every diff and mangled by the bundler. Same reason
 * safeImportUrl carries the same warning.
 */
function cssQuote(url: string): string {
  let out = '';
  for (const ch of url) {
    const code = ch.charCodeAt(0);
    if (ch === '\\' || ch === '"') out += `\\${ch}`;
    else if (code < 0x20 || code === 0x7f) out += ' ';
    else out += ch;
  }
  return out;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ---------------------------------------------------------------------------
// The walk
// ---------------------------------------------------------------------------

interface Context {
  scope: string;
  suffix: string;
  maxRules: number;
  rules: number;
  keyframes: Map<string, string>;
  note: (what: string) => void;
}

/** At-rules whose contents are ordinary rules that still need scoping. */
const NESTING_AT_RULES = new Set(['media', 'supports', 'container', 'layer', 'scope']);

function isKeyframesName(name: string): boolean {
  return name === 'keyframes' || name.endsWith('-keyframes');
}

function handleDeclaration(decl: Declaration, ctx: Context): void {
  const prop = decl.prop.toLowerCase();

  if (REFUSED_PROPS.has(prop)) {
    ctx.note('styles that run code');
    decl.remove();
    return;
  }

  // A value that already contains our placeholder would have a real URL put
  // where the design asked for text. Nothing legitimate looks like this.
  if (decl.value.includes('#TGURL')) {
    decl.remove();
    return;
  }

  const urls: (string | null)[] = [];
  let value = decl.value.replace(URL_PATTERN, (_whole, dq?: string, sq?: string, bare?: string) => {
    urls.push(safeImportUrl(dq ?? sq ?? bare ?? ''));
    return `#TGURL${urls.length - 1}#`;
  });

  if (urls.some((url) => url === null)) {
    ctx.note('links we could not vouch for');
    decl.remove();
    return;
  }

  if (DANGEROUS_VALUE.test(value)) {
    ctx.note('styles that run code');
    decl.remove();
    return;
  }

  if (value.length > 4000) {
    decl.remove();
    return;
  }

  /*
   * position: fixed, downgraded rather than kept.
   *
   * A fixed element is positioned against the viewport, so it leaves the
   * section entirely: an imported overlay with inset:0 and a high z-index would
   * cover the editor chrome, and the client would have no way to click their
   * way back out of the design they had just added. Absolute keeps the
   * intention and keeps it inside the section. Sticky is left alone, because it
   * is already confined to its own scroll container.
   */
  if (prop === 'position' && value.trim().toLowerCase() === 'fixed') {
    ctx.note('fixed positioning');
    value = 'absolute';
  }

  decl.value = value.replace(/#TGURL(\d+)#/g, (_whole, index: string) => {
    const url = urls[Number(index)];
    return url === null || url === undefined ? 'none' : `url("${cssQuote(url)}")`;
  });
}

function handleAtRule(rule: AtRule, ctx: Context, insideRule: boolean, insideKeyframes: boolean): void {
  const bare = rule.name.toLowerCase();
  // -webkit-keyframes and friends. The vendor prefix decides nothing here.
  const name = bare.replace(/^-[a-z]+-/, '');

  if (bare === 'import') {
    ctx.note('@import (a stylesheet that fetches more stylesheets)');
    rule.remove();
    return;
  }

  if (bare === 'font-face') {
    ctx.note('web fonts (add them in Theme, where we host them ourselves)');
    rule.remove();
    return;
  }

  if (isKeyframesName(bare)) {
    const original = rule.params.trim().replace(/^['"]|['"]$/g, '');
    if (!/^-?[A-Za-z_][A-Za-z0-9_-]*$/.test(original)) {
      rule.remove();
      return;
    }
    // Idempotent: scoping an already-scoped stylesheet must not append the
    // suffix a second time. Without this, re-cleaning on every save (and the
    // renderer re-cleaning on every render) would grow `fade` into
    // `fade-tgi-x-tgi-x-tgi-x`, and a frozen imported design could never be a
    // sanitiser fixpoint.
    const renamed = original.endsWith(`-${ctx.suffix}`) ? original : `${original}-${ctx.suffix}`;
    ctx.keyframes.set(original, renamed);
    rule.params = renamed;
    processContainer(rule, ctx, insideRule, true);
    return;
  }

  if (!rule.nodes) {
    // @charset, @namespace, a bare @layer. Nothing they can do is wanted in a
    // fragment, and @namespace changes how every selector after it matches.
    rule.remove();
    return;
  }

  if (!NESTING_AT_RULES.has(bare) && !NESTING_AT_RULES.has(name)) {
    ctx.note(`@${bare}`);
    rule.remove();
    return;
  }

  processContainer(rule, ctx, insideRule, insideKeyframes);

  if (!rule.nodes?.length) {
    rule.remove();
    return;
  }

  /*
   * @layer is UNWRAPPED rather than kept, and this is a fidelity fix rather
   * than a safety one.
   *
   * A layered rule loses to an unlayered one no matter how specific it is. Our
   * own page CSS is unlayered, and a Tailwind build puts nearly everything it
   * emits inside @layer, so keeping the wrapper would mean an import arriving
   * with our defaults winning every argument it was never meant to be in.
   * Lifting the children into the parent leaves them in source order, which for
   * a generated stylesheet is already the order the cascade was designed
   * around.
   */
  if (name === 'layer') rule.replaceWith(...(rule.nodes as ChildNode[]));
}

function handleRule(rule: Rule, ctx: Context, insideRule: boolean, insideKeyframes: boolean): void {
  if (ctx.rules >= ctx.maxRules) {
    ctx.note('the design had more styles than we import in one go');
    rule.remove();
    return;
  }
  ctx.rules += 1;

  /*
   * SCOPED ONLY AT THE TOP LEVEL, and both exceptions are load-bearing.
   *
   * A nested rule's selector starts with `&`, so it is already confined by
   * whatever confined its parent; putting the scope in front again would give
   * `.tgi-x .tgi-x &`. And the children of @keyframes are `from`, `to` and
   * `40%`, which are not selectors at all and mean nothing scoped.
   */
  if (!insideRule && !insideKeyframes) {
    const parts = splitSelectorList(rule.selector)
      .map((part) => scopeSelectorPart(part, ctx.scope))
      .filter((part): part is string => part !== null);

    if (!parts.length) {
      rule.remove();
      return;
    }

    rule.selector = parts.join(', ');
  }

  processContainer(rule, ctx, true, insideKeyframes);

  // Everything in it was refused, so the rule is now an empty pair of braces.
  if (!rule.nodes?.length) rule.remove();
}

function processContainer(
  container: Container,
  ctx: Context,
  insideRule: boolean,
  insideKeyframes: boolean,
): void {
  // A copy, because each branch may remove the node it is looking at.
  for (const node of [...((container.nodes ?? []) as ChildNode[])]) {
    if (node.type === 'comment') {
      node.remove();
      continue;
    }
    if (node.type === 'decl') {
      handleDeclaration(node, ctx);
      continue;
    }
    if (node.type === 'atrule') {
      handleAtRule(node, ctx, insideRule, insideKeyframes);
      continue;
    }
    if (node.type === 'rule') {
      handleRule(node, ctx, insideRule, insideKeyframes);
    }
  }
}

/**
 * Clean and confine somebody else's stylesheet.
 *
 * Returns CSS that is safe to put in a `<style>` on a page that also carries
 * our own, and a list of what went, so the import screen can say what changed
 * rather than quietly handing back something different from what was pasted.
 */
export function scopeImportCss(source: string, options: ScopeOptions): ScopeResult {
  const removed: string[] = [];
  const note = (what: string) => {
    if (!removed.includes(what)) removed.push(what);
  };

  const maxBytes = options.maxBytes ?? 500_000;
  if (typeof source !== 'string' || source.trim() === '') return { css: '', removed };

  if (source.length > maxBytes) {
    note('the stylesheet was too large to import');
    return { css: '', removed };
  }

  const scope = options.scope.trim();
  if (!scope) return { css: '', removed };

  const ctx: Context = {
    scope,
    // The keyframe suffix, so two imports that both animate `fade` do not
    // overwrite each other's definition.
    suffix: scope.replace(/[^A-Za-z0-9_-]/g, '') || 'import',
    maxRules: options.maxRules ?? 4000,
    rules: 0,
    keyframes: new Map(),
    note,
  };

  let root;
  try {
    root = parse(source);
  } catch {
    note('the stylesheet could not be read');
    return { css: '', removed };
  }

  /*
   * TWO PASSES, because an animation can be declared before the @keyframes it
   * names. The first collects and renames every keyframe block; the second is
   * the one that rewrites `animation: fade 1s` to point at the new name. Doing
   * it in one pass silently breaks every animation declared above its
   * definition, which in a minified export is most of them.
   */
  processContainer(root, ctx, false, false);

  if (ctx.keyframes.size) {
    root.walkDecls((decl) => {
      const prop = decl.prop.toLowerCase();
      if (prop !== 'animation' && prop !== 'animation-name' && !prop.endsWith('-animation') && !prop.endsWith('-animation-name')) {
        return;
      }
      let value = decl.value;
      for (const [from, to] of ctx.keyframes) {
        value = value.replace(
          new RegExp(`(^|[^\\w-])${escapeRegex(from)}(?![\\w-])`, 'g'),
          (_match, before: string) => `${before}${to}`,
        );
      }
      decl.value = value;
    });
  }

  return { css: closeTagSafe(root.toString()), removed };
}

/**
 * The class names a selector mentions, as the MARKUP writes them.
 *
 * Tailwind escapes the characters that are illegal in a CSS identifier, so the
 * stylesheet says `.md\:flex` where the class attribute says `md:flex`. Undoing
 * the backslashes is the whole translation, and getting it wrong means a rule
 * that cannot be matched to the element it styles.
 */
function classesIn(selector: string): string[] {
  const found: string[] = [];
  for (const match of selector.matchAll(/\.((?:[\w-]|\\.)+)/g)) {
    found.push(match[1].replace(/\\(.)/g, '$1'));
  }
  return found;
}

/**
 * Only the rules that can reach a given set of classes.
 *
 * WHY THIS EXISTS. A pasted page is cut into sections and each one carries its
 * own copy of the stylesheet, because a section has to be movable and deletable
 * on its own. Without trimming, eight sections off one Relume export would put
 * eight copies of a Tailwind build on a single page: most of a megabyte of CSS
 * to draw something that needs a few kilobytes of it.
 *
 * THE UNCERTAIN CASE KEEPS THE RULE. A selector with no class in it at all is
 * kept, because it is an element or attribute rule and there is no cheap way to
 * know whether it applies. So is anything inside @keyframes, and so are the
 * custom properties on the scope element, which is where a Tailwind build puts
 * its entire palette. Dropping a rule that was needed shows up as a section that
 * looks wrong; keeping one that was not costs a line of CSS.
 */
export function trimCssToClasses(css: string, classes: ReadonlySet<string>): string {
  if (typeof css !== 'string' || css.trim() === '') return '';

  let root;
  try {
    root = parse(css);
  } catch {
    return '';
  }

  const prune = (container: Container): void => {
    for (const node of [...((container.nodes ?? []) as ChildNode[])]) {
      if (node.type === 'atrule') {
        /*
         * Keyframes are referenced by name from rules we may be keeping, and
         * their children are `from`, `to` and `50%` rather than selectors.
         *
         * Belt and braces: a step carries no class, so the no-class rule below
         * would keep every one of them anyway. Said explicitly because "why is
         * this at-rule different" is a question worth answering once, rather
         * than leaving somebody to work out that it happens to fall through
         * correctly.
         */
        if (isKeyframesName(node.name.toLowerCase())) continue;
        prune(node);
        if (!node.nodes?.length) node.remove();
        continue;
      }

      if (node.type !== 'rule') continue;

      const wanted = splitSelectorList(node.selector)
        .map((part) => part.trim())
        .filter(Boolean)
        .filter((part) => {
          const names = classesIn(part);
          return names.length === 0 || names.some((name) => classes.has(name));
        });

      if (!wanted.length) {
        node.remove();
        continue;
      }

      node.selector = wanted.join(', ');
    }
  };

  prune(root);
  return root.toString();
}

/**
 * CSS that cannot climb out of the `<style>` element it is about to sit in.
 *
 * THE HOLE THIS CLOSES. Everything above makes the CSS safe as CSS, and that is
 * not the same as safe as the CONTENTS OF A TAG. An HTML parser looks for the
 * closing tag before it hands anything to the CSS parser, so a declaration of
 * `content: "</style><img src=x onerror=alert(1)>"` is a perfectly ordinary
 * string to postcss and the end of the stylesheet to a browser. Everything
 * after it is markup, on the page, with a handler on it. A selector can carry
 * the same payload inside an attribute value, which is why this runs over the
 * whole output rather than over declaration values.
 *
 * ESCAPED RATHER THAN REFUSED, and it costs nothing. The only place a `</` can
 * legally appear in a stylesheet is inside a string, and inside a string `\/`
 * is a valid escape for `/` meaning exactly the same character. So the CSS is
 * unchanged and the HTML parser no longer sees a closing tag. Same trick as
 * escaping `</script>` inside embedded JSON, for the same reason.
 */
function closeTagSafe(css: string): string {
  return css.replace(/<\//g, '<\\/');
}
