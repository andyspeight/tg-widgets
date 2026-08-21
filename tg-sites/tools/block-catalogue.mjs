/**
 * Build /block-catalogue.json from the CMS block registry.
 *
 * WHICH REGISTRY, AND WHY THIS ONE. There are two things in this repo that
 * could be called a block registry. public/index.html holds WIDGETS, the 40-odd
 * embeddable widgets of the widget suite, and its entries carry a name, a
 * category, a plan-tier map and a script file. They carry NO props, no variants
 * and no design tokens: a widget's settings live in its own editor page, one
 * HTML file each. tg-sites/lib/content/blocks.ts holds BLOCKS, the CMS block
 * library, and every entry there has typed fields with options and defaults,
 * and renders through .tgs-* classes styled entirely from --tgs-* tokens. The
 * asked-for shape fits the second exactly and the first not at all.
 *
 * WHAT IS RECORDED AND WHAT IS DERIVED. id, name, category, props, options,
 * defaults and sourcePath are read straight off the registry. THREE FIELDS ARE
 * DERIVED and should not be mistaken for recorded data:
 *
 *   role       from the field kind. Anything a client types, picks or uploads
 *              per page is content; anything that switches a variant, an
 *              alignment or a layout is config.
 *   required   the registry does not record it. Taken as the block's principal
 *              input: the first content field, plus any field whose absence
 *              makes the renderer draw a placeholder.
 *   tokensUsed read out of globals.css, from the rules whose selector mentions
 *              this block's own class.
 */

import { build } from 'esbuild';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const OUT = join(ROOT, '..', 'block-catalogue.json');

/*
 * --check REPORTS DRIFT INSTEAD OF WRITING, which is the whole reason this flag
 * exists.
 *
 * The committed catalogue went stale three times in two days in August 2026, at 26
 * blocks against a registry of 44, then 44 against 46, then 47 against 49. Nothing
 * ever failed when it drifted, so it was only ever noticed by somebody happening to
 * look, which is not a system.
 *
 * The check REGENERATES and compares rather than re-deriving the answer a second
 * way. role, required and tokensUsed are computed from the registry and globals.css
 * by the code below; a test that worked them out again would be a second
 * implementation free to disagree with this one, and then the two of them would need
 * a tie-breaker. Running the real generator cannot drift from the real generator.
 */
const CHECK_ONLY = process.argv.includes('--check');

// ---------------------------------------------------------------------------
// The registry
// ---------------------------------------------------------------------------

async function loadRegistry() {
  const dir = mkdtempSync(join(tmpdir(), 'tgcat-'));
  const file = join(dir, 'blocks.mjs');

  await build({
    entryPoints: [join(ROOT, 'lib/content/blocks.ts')],
    outfile: file,
    bundle: true,
    format: 'esm',
    platform: 'node',
    logLevel: 'silent',
  });

  return import(file);
}

// ---------------------------------------------------------------------------
// Field kinds
// ---------------------------------------------------------------------------

/** The registry's kind, as a type in the catalogue's vocabulary. */
const TYPE_OF = {
  text: 'text',
  textarea: 'text',
  richtext: 'richtext',
  url: 'url',
  image: 'image',
  icon: 'icon',
  select: 'enum',
  toggle: 'boolean',
  number: 'number',
  repeater: 'list',
  imported: 'slots',
};

/**
 * content or config.
 *
 * The line is the one asked for: anything a client edits per page is content.
 * A select is config because ours are all variant, alignment and layout
 * switches; a number is config because every number in the library is a count,
 * a gap or a height. The one that looks arguable is icon, and it is content: a
 * client picks a different icon for each point in a list.
 */
const ROLE_OF = {
  text: 'content',
  textarea: 'content',
  richtext: 'content',
  url: 'content',
  image: 'content',
  icon: 'content',
  repeater: 'content',
  imported: 'content',
  select: 'config',
  toggle: 'config',
  number: 'config',
};

/** Field keys that name a design variant rather than an ordinary setting. */
const VARIANT_KEYS = new Set(['variant', 'style', 'layout', 'preset', 'kind', 'shape']);

function propsOf(fields, defaults, prefix = '') {
  const out = [];

  for (const field of fields) {
    const name = prefix ? `${prefix}[].${field.key}` : field.key;
    const entry = {
      name,
      type: TYPE_OF[field.kind] ?? field.kind,
      role: ROLE_OF[field.kind] ?? 'config',
      required: false,
    };

    if (field.kind === 'select' && Array.isArray(field.options)) {
      entry.options = field.options.map((option) => option.value);
    }

    const fallback = prefix ? undefined : defaults?.[field.key];
    if (fallback !== undefined && typeof fallback !== 'object') entry.default = fallback;

    out.push(entry);

    // A repeater's own fields, flattened with a marker, so a catalogue reader
    // can see what one item holds without a second level of nesting.
    if (field.kind === 'repeater' && Array.isArray(field.fields)) {
      out.push(...propsOf(field.fields, undefined, field.key));
    }
  }

  return out;
}

// ---------------------------------------------------------------------------
// Tokens, and what is hardcoded instead
// ---------------------------------------------------------------------------

const CSS = readFileSync(join(ROOT, 'app/globals.css'), 'utf8');

/** Strip comments, so prose about a colour is not read as a colour. */
const CSS_CODE = CSS.replace(/\/\*[\s\S]*?\*\//g, '');

/** Every rule, as a selector and its body. */
const RULES = [...CSS_CODE.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((match) => ({
  selector: match[1].trim(),
  body: match[2],
}));

/** --tgs-space-m becomes space.m, --tgs-primary becomes colour.primary. */
function tokenName(raw) {
  const name = raw.replace(/^--tgs-/, '');
  if (/^space-/.test(name)) return `space.${name.slice(6)}`;
  if (/^radius-/.test(name)) return `radius.${name.slice(7)}`;
  if (/^width-/.test(name)) return `width.${name.slice(6)}`;
  if (/^(h[1-6]|p)-/.test(name)) return `type.${name}`;
  if (/^(text-[lms]|h-[a-z]+|leading-|font-)/.test(name)) return `type.${name}`;
  if (/^shadow-/.test(name)) return `shadow.${name.slice(7)}`;
  return `colour.${name}`;
}

/** Does this selector talk about this block's own class? */
function mentions(selector, className) {
  return new RegExp(`\\.${className.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w-])`).test(
    selector,
  );
}

/**
 * A literal colour, and a literal length where a token exists for the job.
 *
 * Deliberately narrow on lengths. A 1px border, a 0, a 100%, a 50% and a
 * line-height are not spacing and having a token for them would be worse than
 * not. What counts is padding, margin and gap written as a number when the
 * scale already has one.
 */
const SPACING_PROPS = /(^|[\s;])(padding|margin|gap|row-gap|column-gap)(-[a-z]+)?\s*:/;

function hardcoded(body) {
  const colours = new Set();
  const spacing = new Set();

  for (const declaration of body.split(';')) {
    const text = declaration.trim();
    if (!text) continue;

    for (const match of text.matchAll(/#[0-9a-f]{3,8}\b|\brgba?\([^)]*\)|\bhsla?\([^)]*\)/gi)) {
      colours.add(match[0]);
    }

    if (SPACING_PROPS.test(`;${text}`)) {
      for (const match of text.matchAll(/(?<![\w.-])(\d+(?:\.\d+)?)(px|rem|em)\b/g)) {
        // 0 and hairlines are not spacing decisions.
        if (Number(match[1]) === 0) continue;
        if (match[2] === 'px' && Number(match[1]) <= 2) continue;
        spacing.add(match[0]);
      }
    }
  }

  return { colours: [...colours], spacing: [...spacing] };
}

function styleFor(classNames) {
  const tokens = new Set();
  const colours = new Set();
  const spacing = new Set();
  let matched = 0;

  for (const rule of RULES) {
    if (!classNames.some((name) => mentions(rule.selector, name))) continue;
    matched += 1;

    for (const match of rule.body.matchAll(/var\(\s*(--tgs-[a-z0-9-]+)/g)) {
      tokens.add(tokenName(match[1]));
    }

    const literal = hardcoded(rule.body);
    literal.colours.forEach((value) => colours.add(`${rule.selector.split(',')[0].trim()}: ${value}`));
    literal.spacing.forEach((value) => spacing.add(`${rule.selector.split(',')[0].trim()}: ${value}`));
  }

  return { tokens: [...tokens].sort(), colours: [...colours], spacing: [...spacing], matched };
}

// ---------------------------------------------------------------------------
// Which blocks are about travel
// ---------------------------------------------------------------------------

/**
 * TRAVEL SPECIFIC MEANS THE BLOCK KNOWS SOMETHING ABOUT TRAVEL, not that a
 * travel agent would use it. A card row is generic even though every client
 * puts holidays in it; a Travelgenix widget block is travel specific because
 * the thing it draws is a search, a booking or an offer.
 */
const TRAVEL = new Set(['widget', 'embed-widget']);

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

const { BLOCKS } = await loadRegistry();

const RENDERER = readFileSync(join(ROOT, 'components/render/blocks.tsx'), 'utf8');

function componentName(type) {
  return type
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
}

/** The line the block's component is declared on, for sourcePath. */
function componentLine(type) {
  const index = RENDERER.indexOf(`export function ${componentName(type)}Block`);
  if (index === -1) return null;
  return RENDERER.slice(0, index).split('\n').length;
}

/**
 * The classes a block's renderer actually puts on the page.
 *
 * READ OUT OF THE COMPONENT, NOT GUESSED FROM THE TYPE. The obvious derivation
 * is `.tgs-<type>`, and it is wrong often enough to matter: the button-group
 * block renders .tgs-buttons, so guessing found no rules for it and reported it
 * as carrying no design tokens at all, when it uses six. Video renders
 * .tgs-image as well as its own class, and widget renders three.
 */
function classesOf(type) {
  const start = RENDERER.indexOf(`export function ${componentName(type)}Block`);
  if (start === -1) return [`tgs-${type}`];

  /*
   * Stop at the next TOP-LEVEL DECLARATION, not the next exported one. The
   * renderer keeps unexported helpers between components, and stopping only at
   * `export function` swallowed renderCard into GalleryBlock, which then
   * reported the gallery as using the card classes and carrying the card rules'
   * hardcoded colours. A wrong entry in a catalogue is worse than a missing one.
   */
  const rest = RENDERER.slice(start + 1);
  const next = rest.search(/\n(?:export )?(?:function|const|class|type|interface) /);
  const body = next === -1 ? RENDERER.slice(start) : RENDERER.slice(start, start + 1 + next);

  /*
   * Comments stripped first. The renderer's prose refers to other blocks'
   * classes by name to explain a decision, and reading those as markup credited
   * the gallery with the card rules because one comment says "see
   * .tgs-cards[data-whole] in globals.css".
   */
  const code = body.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

  const found = new Set();
  for (const match of code.matchAll(/tgs-[a-z0-9-]+/g)) found.add(match[0]);
  return found.size ? [...found] : [`tgs-${type}`];
}

/**
 * The props whose absence makes the renderer draw a placeholder instead.
 *
 * Read out of the component: the blocks all bind their props to locals with
 * str(props, 'name'), then guard on the local. So the bindings give a local to
 * prop map, and every `if (!local)` that leads to a tgs-placeholder names a prop
 * the block cannot do without.
 */
function guardedProps(type) {
  const start = RENDERER.indexOf(`export function ${componentName(type)}Block`);
  if (start === -1) return new Set();

  const rest = RENDERER.slice(start + 1);
  const next = rest.search(/\n(?:export )?(?:function|const|class|type|interface) /);
  const body = (next === -1 ? RENDERER.slice(start) : RENDERER.slice(start, start + 1 + next))
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');

  // local -> prop, from `const src = ... str(props, 'src') ...`
  const binding = new Map();
  for (const match of body.matchAll(/const\s+(\w+)\s*=\s*[^;]*?props,\s*'([^']+)'/g)) {
    binding.set(match[1], match[2]);
  }

  /*
   * One step of propagation, because a prop is not always guarded directly. The
   * imported block reads props.html into `cleaned`, derives `html` from it, and
   * guards on that. Two passes are enough for every chain in the library and
   * stop it turning into an interpreter.
   */
  for (let pass = 0; pass < 2; pass += 1) {
    for (const match of body.matchAll(/const\s+(\w+)\s*=\s*([^;]+);/g)) {
      const [, local, expression] = match;
      if (binding.has(local)) continue;
      for (const [known, prop] of binding) {
        if (new RegExp(`\\b${known}\\b`).test(expression)) {
          binding.set(local, prop);
          break;
        }
      }
    }
  }

  const found = new Set();
  let index = body.indexOf('tgs-placeholder');
  while (index !== -1) {
    const before = body.slice(Math.max(0, index - 400), index);
    for (const match of before.matchAll(/!\s*([A-Za-z_]\w*)/g)) {
      const prop = binding.get(match[1]);
      if (prop) found.add(prop);
    }
    index = body.indexOf('tgs-placeholder', index + 1);
  }

  return found;
}

const catalogue = [];
const issues = [];

for (const block of BLOCKS) {
  const props = propsOf(block.fields, block.defaults);

  /*
   * DERIVED, NOT RECORDED, and derived by ASKING THE CODE rather than guessing.
   *
   * The first version took the first content field, and got cards wrong: it
   * marked `collection`, which only matters when the source switch is set to a
   * collection, instead of `items`, which is what a card row actually holds.
   *
   * Every block with more than one field carries a summarise() that produces
   * its line in the outline, and that function reads exactly the props the block
   * is ABOUT. Handing it a recording proxy says which ones those are, straight
   * from the code, with nothing to keep in step. Blocks without one fall back to
   * the first content field, which for a single-input block is the same answer.
   */
  const read = new Set();
  if (typeof block.summarise === 'function') {
    const spy = new Proxy(
      { ...block.defaults },
      {
        get(target, key) {
          if (typeof key === 'string') read.add(key);
          return Reflect.get(target, key);
        },
      },
    );
    try {
      block.summarise(spy);
    } catch {
      // A summarise that cannot cope with its own defaults tells us nothing.
      read.clear();
    }
  }

  /*
   * THE SECOND SIGNAL, and the one summarise cannot give. summarise says what
   * NAMES a block; a placeholder says what a block NEEDS, and they are not the
   * same. An image is named by its alt text and its caption, and renders "Choose
   * an image" without a src. Reading only summarise marked alt and caption
   * required on the image block and left src optional, which is exactly
   * backwards for anybody using this catalogue to decide what to supply.
   */
  const needed = guardedProps(block.type);

  /*
   * A GUARD BEATS A NAME. The two signals answer different questions and only
   * one of them is what `required` means. A placeholder guard says the block
   * cannot render without this prop; summarise says the outline calls the block
   * after this prop. An image is NAMED by its alt text and NEEDS its src, and
   * reporting both as required tells a reader to supply two things when one
   * will do. So guards win outright, summarise is the fallback for the blocks
   * that draw something regardless, and the first content field is the last
   * resort.
   */
  const contentProps = props.filter(
    (prop) => prop.role === 'content' && !prop.name.includes('[]'),
  );

  const byGuard = contentProps.filter((prop) => needed.has(prop.name));
  const byName = contentProps.filter((prop) => read.has(prop.name));
  const principal = byGuard.length ? byGuard : byName;

  if (principal.length) {
    principal.forEach((prop) => {
      prop.required = true;
    });
  } else if (contentProps.length) {
    contentProps[0].required = true;
  }

  const variants = block.fields
    .filter((field) => field.kind === 'select' && VARIANT_KEYS.has(field.key))
    .flatMap((field) => field.options.map((option) => option.value));

  const classNames = classesOf(block.type);
  const style = styleFor(classNames);
  const line = componentLine(block.type);

  catalogue.push({
    id: block.type,
    name: block.label,
    category: block.group.toLowerCase(),
    travelSpecific: TRAVEL.has(block.type),
    staffOnly: Boolean(block.staffOnly),
    description: block.description,
    variants,
    props,
    classNames: classNames.sort(),
    tokensUsed: style.tokens,
    hardcoded: { colours: style.colours, spacing: style.spacing },
    cssRules: style.matched,
    sourcePath: line
      ? `tg-sites/components/render/blocks.tsx:${line}`
      : 'tg-sites/components/render/blocks.tsx',
    registryPath: 'tg-sites/lib/content/blocks.ts',
  });

  if (style.colours.length || style.spacing.length) {
    issues.push({ id: block.type, colours: style.colours, spacing: style.spacing });
  }
}

const rendered = `${JSON.stringify(
  {
    generatedFrom: 'tg-sites/lib/content/blocks.ts',
    generatedBy: 'tg-sites/tools/block-catalogue.mjs',
    note:
      'role, required and tokensUsed are DERIVED, not recorded in the registry. ' +
      'See the header of the generator for how.',
    blocks: catalogue,
  },
  null,
  2,
)}\n`;

if (CHECK_ONLY) {
  const committed = (() => {
    try {
      return readFileSync(OUT, 'utf8');
    } catch {
      return null;
    }
  })();

  if (committed === rendered) {
    console.log(`  PASS  block-catalogue.json is up to date (${catalogue.length} blocks)`);
    process.exit(0);
  }

  console.error('\n  block-catalogue.json is out of date.\n');

  if (committed === null) {
    console.error('    It is missing entirely. Run: node tools/block-catalogue.mjs');
    process.exit(1);
  }

  /*
   * Say WHAT drifted, not just that something did. A bare "the file differs" sends
   * the next person to a 3,000 line diff to find out that one block was added.
   */
  const before = JSON.parse(committed).blocks ?? [];
  const beforeIds = new Set(before.map((entry) => entry.id));
  const afterIds = new Set(catalogue.map((entry) => entry.id));

  const added = catalogue.filter((entry) => !beforeIds.has(entry.id)).map((entry) => entry.id);
  const removed = before.filter((entry) => !afterIds.has(entry.id)).map((entry) => entry.id);

  const changed = catalogue
    .filter((entry) => beforeIds.has(entry.id))
    .filter((entry) => {
      const was = before.find((other) => other.id === entry.id);
      return JSON.stringify(was) !== JSON.stringify(entry);
    })
    .map((entry) => entry.id);

  console.error(`    committed ${before.length} blocks, the registry has ${catalogue.length}`);
  if (added.length) console.error(`    added:   ${added.join(', ')}`);
  if (removed.length) console.error(`    removed: ${removed.join(', ')}`);
  if (changed.length) console.error(`    changed: ${changed.join(', ')}`);
  if (!added.length && !removed.length && !changed.length) {
    console.error('    the blocks match, so the difference is in the header or the formatting');
  }
  console.error('\n    Fix it by regenerating: node tools/block-catalogue.mjs\n');
  process.exit(1);
}

writeFileSync(OUT, rendered);

// ---------------------------------------------------------------------------
// The report
// ---------------------------------------------------------------------------

/* The report below is about a file just written, so --check never reaches it. */
const travel = catalogue.filter((entry) => entry.travelSpecific);
const noTokens = catalogue.filter((entry) => entry.tokensUsed.length === 0);
const noRules = catalogue.filter((entry) => entry.cssRules === 0);

console.log(`blocks: ${catalogue.length}`);
console.log(`travel specific: ${travel.length} (${travel.map((e) => e.id).join(', ')})`);
console.log(`generic: ${catalogue.length - travel.length}`);
console.log(`staff only: ${catalogue.filter((e) => e.staffOnly).map((e) => e.id).join(', ') || 'none'}`);
console.log(`\nno CSS rules at all: ${noRules.map((e) => e.id).join(', ') || 'none'}`);
console.log(`has rules but references no token: ${noTokens.filter((e) => e.cssRules > 0).map((e) => e.id).join(', ') || 'none'}`);

console.log('\nhardcoded values:');
if (!issues.length) console.log('  none');
for (const issue of issues) {
  console.log(`  ${issue.id}`);
  for (const value of issue.colours) console.log(`    colour   ${value}`);
  for (const value of issue.spacing) console.log(`    spacing  ${value}`);
}

console.log(`\nwritten to ${OUT}`);
