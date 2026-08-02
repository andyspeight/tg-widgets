/**
 * The icon library a client can draw on.
 *
 * WHAT THIS REPLACES. Until now the only icon in the whole product was a
 * SINGLE CHARACTER typed into a text box, and the designed sections shipped a
 * tick, a star and a heart as their icons. That is the exact practice the note
 * at the top of components/editor/Icon.tsx bans for the editor, and for the
 * same reasons: a character renders differently on every platform, cannot be
 * given a weight or a size that matches anything around it, and reads as clip
 * art. It was banned in our own interface and left in the client's content.
 *
 * WHY LUCIDE, and not one of the bigger sets. The editor's own 67 icons were
 * hand drawn in the Lucide style, 24 by 24, 2px stroke, round caps and joins,
 * no fills, and that file says in as many words: swap to the real package if
 * the set grows much past this. So these 1,817 already match the interface a
 * client is looking at while they choose, and match each other, which the
 *200,000-icon aggregates cannot promise. ISC licence, so nothing has to be
 * attributed on a client's site.
 *
 * THE DATA NEVER REACHES A PUBLISHED PAGE. It is 84KB gzipped and it is
 * imported by the editor, where it is an authoring tool's cost, and by the
 * server renderer, where only the ~300 bytes of the ONE chosen icon is written
 * into the HTML. A published site still ships no JavaScript at all.
 *
 * NOTHING HERE GOES THROUGH innerHTML. The package hands back each icon as an
 * SVG fragment string, and putting a string into the DOM is the one thing this
 * codebase does not do. So `iconShapes` PARSES that string into a list of
 * elements and attributes, checked against the whitelist below, and the
 * component builds real React elements from it. That makes an injected script
 * structurally impossible rather than merely unlikely: the parser has no
 * branch that can emit anything but the five shapes it knows.
 *
 * The whitelist is not a guess. Every one of the 1,817 icons was scanned on
 * 1 Aug 2026 and between them they use exactly these five elements and these
 * seventeen attributes, with no script, no event handler and no url(). A test
 * runs that scan over the whole set so the day the package adds something new,
 * the suite says so rather than a client's page quietly losing an icon.
 */
import iconData from '@iconify-json/lucide/icons.json';

// ---------------------------------------------------------------------------
// The whitelist
// ---------------------------------------------------------------------------

/** The only elements an icon may be built from. */
export const ICON_ELEMENTS = ['circle', 'ellipse', 'g', 'path', 'rect'] as const;

/** The only attributes any of them may carry. All geometry and presentation. */
export const ICON_ATTRIBUTES = [
  'clip-rule', 'cx', 'cy', 'd', 'fill', 'fill-rule', 'height', 'r', 'rx', 'ry',
  'stroke', 'stroke-linecap', 'stroke-linejoin', 'stroke-width', 'width', 'x', 'y',
] as const;

export type IconElement = (typeof ICON_ELEMENTS)[number];

/**
 * The same attribute names in the spelling React wants.
 *
 * HERE RATHER THAN IN THE COMPONENT, so it sits next to the list it has to
 * agree with. An attribute whitelisted above and missing here is dropped by the
 * component for want of a spelling, which loses a shape's geometry and draws a
 * mangled icon: the two lists drifting apart is the failure, so they live in
 * one file and a test compares them.
 *
 * React does pass a hyphenated attribute straight through, so `stroke-width`
 * would render, but it warns about it in development and the warning is right.
 */
export const REACT_ATTRIBUTE_NAMES: Record<string, string> = {
  'clip-rule': 'clipRule',
  cx: 'cx',
  cy: 'cy',
  d: 'd',
  fill: 'fill',
  'fill-rule': 'fillRule',
  height: 'height',
  r: 'r',
  rx: 'rx',
  ry: 'ry',
  stroke: 'stroke',
  'stroke-linecap': 'strokeLinecap',
  'stroke-linejoin': 'strokeLinejoin',
  'stroke-width': 'strokeWidth',
  width: 'width',
  x: 'x',
  y: 'y',
};

/** One shape from an icon: what to draw, and the attributes to draw it with. */
export interface IconShape {
  element: IconElement;
  attributes: Record<string, string>;
}

// ---------------------------------------------------------------------------
// The set
// ---------------------------------------------------------------------------

interface IconSet {
  icons: Record<string, { body: string }>;
  aliases?: Record<string, { parent: string }>;
}

const SET = iconData as unknown as IconSet;

/**
 * Every name a client may store, the real ones and the aliases, sorted.
 *
 * The aliases matter more than they look. The package carries 217 of them and
 * they are the old names for icons that have since been renamed, so `alert-
 * circle` still finds `circle-alert`. Somebody searching for a word they
 * remember is exactly who the alias is for.
 */
export const ICON_NAMES: readonly string[] = Object.keys(SET.icons)
  .concat(Object.keys(SET.aliases ?? {}))
  .sort();

/**
 * Words a travel agent would actually type, mapped to what the set calls it.
 *
 * THIS EXISTS BECAUSE THE SET SHIPS NO TAGS. The package's metadata.json is
 * empty, so search has nothing but the names to go on, and the names are a
 * designer's vocabulary rather than a travel agent's. Somebody wanting a
 * picture for their holidays page types "holiday", and Lucide has no icon by
 * that name.
 *
 * Deliberately short, and ours. Every entry is a word somebody would type
 * about selling holidays, pointing at an icon that already exists.
 */
const SYNONYMS: Record<string, readonly string[]> = {
  holiday: ['palmtree', 'tree-palm', 'sun', 'umbrella', 'luggage'],
  holidays: ['palmtree', 'tree-palm', 'sun', 'umbrella'],
  flight: ['plane', 'plane-takeoff', 'plane-landing'],
  flights: ['plane', 'plane-takeoff', 'plane-landing'],
  fly: ['plane', 'plane-takeoff'],
  airport: ['plane', 'plane-takeoff', 'luggage'],
  beach: ['palmtree', 'tree-palm', 'umbrella', 'waves', 'sun'],
  cruise: ['ship', 'sailboat', 'anchor', 'ship-wheel'],
  cruises: ['ship', 'sailboat', 'anchor'],
  booking: ['calendar-check', 'ticket', 'circle-check'],
  book: ['calendar-check', 'ticket'],
  enquiry: ['message-circle', 'mail', 'phone'],
  quote: ['file-text', 'banknote', 'calculator'],
  price: ['banknote', 'tag', 'credit-card'],
  prices: ['banknote', 'tag', 'credit-card'],
  payment: ['credit-card', 'banknote', 'wallet'],
  deposit: ['piggy-bank', 'banknote', 'wallet'],
  protected: ['shield-check', 'shield', 'badge-check'],
  protection: ['shield-check', 'shield'],
  atol: ['shield-check', 'badge-check'],
  abta: ['shield-check', 'badge-check'],
  insurance: ['shield-check', 'umbrella', 'heart-pulse'],
  bonded: ['shield-check', 'lock'],
  accommodation: ['bed-double', 'hotel', 'house'],
  hotels: ['hotel', 'bed-double'],
  villa: ['house', 'home', 'key'],
  apartment: ['building', 'building-2'],
  transfer: ['car-taxi-front', 'bus', 'car'],
  transfers: ['car-taxi-front', 'bus'],
  hire: ['car', 'car-front', 'key'],
  parking: ['circle-parking', 'car'],
  family: ['users', 'baby', 'users-round'],
  couple: ['heart', 'users'],
  honeymoon: ['heart', 'heart-handshake', 'wine'],
  wedding: ['heart', 'church', 'wine'],
  adults: ['users', 'wine'],
  children: ['baby', 'users'],
  group: ['users', 'users-round'],
  food: ['utensils', 'utensils-crossed'],
  dining: ['utensils', 'wine'],
  allinclusive: ['utensils-crossed', 'wine', 'circle-check'],
  pool: ['waves', 'droplets'],
  spa: ['flower', 'sparkles', 'droplets'],
  golf: ['flag', 'target'],
  ski: ['snowflake', 'mountain-snow'],
  skiing: ['snowflake', 'mountain-snow'],
  weather: ['sun', 'cloud-sun', 'thermometer'],
  hot: ['sun', 'thermometer-sun'],
  destination: ['map-pin', 'map', 'globe'],
  destinations: ['map-pin', 'map', 'globe'],
  worldwide: ['globe', 'earth'],
  itinerary: ['map', 'route', 'list-checks'],
  passport: ['book-user', 'badge-check', 'id-card'],
  visa: ['id-card', 'file-check'],
  luggage: ['luggage', 'briefcase'],
  baggage: ['luggage', 'briefcase'],
  support: ['headphones', 'life-buoy', 'message-circle'],
  help: ['life-buoy', 'circle-help', 'headphones'],
  call: ['phone', 'phone-call'],
  open: ['clock', 'store'],
  hours: ['clock', 'calendar-clock'],
  shop: ['store', 'shopping-bag'],
  review: ['star', 'message-square-quote'],
  reviews: ['star', 'message-square-quote'],
  award: ['award', 'trophy', 'medal'],
  experience: ['award', 'sparkles', 'thumbs-up'],
  expert: ['award', 'graduation-cap', 'user-check'],
  saving: ['piggy-bank', 'percent', 'tag'],
  savings: ['piggy-bank', 'percent'],
  deal: ['percent', 'tag', 'ticket-percent'],
  deals: ['percent', 'tag', 'ticket-percent'],
  offer: ['percent', 'tag', 'gift'],
  offers: ['percent', 'tag', 'gift'],
};

// ---------------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------------

/**
 * A stored value reduced to something that could be an icon name.
 *
 * DELIBERATELY NOT A MEMBERSHIP CHECK, and that is the same arrangement the
 * widget blocks use: `safeWidgetId` makes the shape safe and `widgetKind` does
 * the closed-list lookup at render. Two reasons it is right here too. The
 * sanitiser runs on save and would then have to carry the whole 558KB set,
 * and a client on an older build saving a page that uses a NEWER icon would
 * have that icon silently deleted from their content rather than merely not
 * drawn today.
 *
 * Anything that is not a plausible name comes back unchanged, because the
 * icon field also still accepts a plain character. See iconShapes.
 */
export function safeIconName(value: unknown): string {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  return trimmed.length <= 60 ? trimmed : trimmed.slice(0, 60);
}

/** True when this names an icon this build can actually draw. */
export function isIconName(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  return value in SET.icons || value in (SET.aliases ?? {});
}

/** The real name behind an alias, or the name itself, or null. */
function resolve(name: string): string | null {
  if (name in SET.icons) return name;
  const alias = SET.aliases?.[name];
  if (alias && alias.parent in SET.icons) return alias.parent;
  return null;
}

// ---------------------------------------------------------------------------
// Parsing, which is the part that matters
// ---------------------------------------------------------------------------

/** An opening tag or a closing one. The `/` in group 1 says which. */
const TAG = /<(\/?)([a-zA-Z]+)\b([^>]*?)\/?>/g;
const ATTR = /([a-zA-Z-]+)="([^"]*)"/g;

/**
 * Attributes a `<g>` sets FOR THE SHAPES INSIDE IT rather than for itself.
 *
 * These are the inherited SVG presentation properties. Geometry is not on the
 * list and could not be: `cx` on a group means nothing to the circle in it.
 */
const INHERITED = new Set([
  'fill', 'fill-rule', 'clip-rule',
  'stroke', 'stroke-linecap', 'stroke-linejoin', 'stroke-width',
]);

/**
 * A string of SVG, reduced to the shapes it is allowed to contain.
 *
 * EXPORTED SEPARATELY FROM THE LOOKUP so it can be tested on markup the package
 * would never contain. That distinction is the whole argument for parsing
 * rather than using innerHTML: scanning the real set only proves the file is
 * clean today, and what has to be true is that it would not matter if it were
 * not. A test that can only feed this real icons cannot show that.
 *
 * The regex only ever matches a tag, and the element name is then checked
 * against ICON_ELEMENTS, so a `<script>` in the data matches the pattern and is
 * thrown away on the next line. Same for every attribute. Markup carrying
 * anything outside the whitelist loses that piece rather than the whole icon,
 * which is the right way round: a shape missing from a drawing is visible, a
 * silently empty icon is not.
 *
 * A GROUP IS FLATTENED INTO THE SHAPES IT HOLDS, and getting that wrong was a
 * real bug that shipped. 1,112 of the 1,817 icons are written as
 * `<g fill="none" stroke="currentColor" stroke-width="2"><circle/><path/></g>`,
 * with the drawing instructions on the group and only geometry on the children.
 * This returned a FLAT list, so the renderer drew the `<g>` as an empty element
 * and its two children as its SIBLINGS. A sibling inherits nothing, so both
 * fell back to what SVG does when told nothing: fill black, no stroke. Every
 * one of those icons drew as a solid black blob. Found on 2 Aug 2026 by looking
 * at a rendered page rather than by any assertion, which is why there is now a
 * test on the shapes themselves.
 *
 * FLATTENING RATHER THAN NESTING, and this is safe for a reason worth stating
 * rather than assuming: the only thing that would make a group more than a bag
 * of shared attributes is a `transform`, and `transform` is not in
 * ICON_ATTRIBUTES, so it is dropped before it reaches here whatever the data
 * says. A group can therefore only ever mean "these attributes, for everything
 * inside", which is exactly what pushing them down expresses.
 *
 * The child's own attribute wins, as it does in a browser.
 */
export function parseIconBody(body: unknown): IconShape[] {
  if (typeof body !== 'string') return [];

  const shapes: IconShape[] = [];

  // What the open groups are handing down, innermost last.
  const stack: Array<Record<string, string>> = [];

  for (const match of body.matchAll(TAG)) {
    const closing = match[1] === '/';
    const element = match[2].toLowerCase();

    if (closing) {
      if (element === 'g') stack.pop();
      continue;
    }

    if (!(ICON_ELEMENTS as readonly string[]).includes(element)) continue;

    const attributes: Record<string, string> = {};
    for (const attr of match[3].matchAll(ATTR)) {
      const key = attr[1].toLowerCase();
      if (!(ICON_ATTRIBUTES as readonly string[]).includes(key)) continue;
      // A value can only ever be geometry, a keyword or currentColor. Anything
      // with a bracket or a colon in it is not one of those.
      if (/[<>();]|javascript:|url\(/i.test(attr[2])) continue;
      attributes[key] = attr[2];
    }

    if (element === 'g') {
      /*
       * A self-closing group holds nothing, so it hands nothing down and there
       * is no `</g>` coming to pop it back off. `<g/>` does not appear in the
       * set; it is here because the stack going out of step would misdraw every
       * shape after it, which is a bad way to find out the data changed.
       */
      if (!/\/\s*>$/.test(match[0])) {
        const inherited: Record<string, string> = { ...(stack[stack.length - 1] ?? {}) };
        for (const [key, value] of Object.entries(attributes)) {
          if (INHERITED.has(key)) inherited[key] = value;
        }
        stack.push(inherited);
      }

      // Never emitted. A group with its children pulled out of it draws nothing.
      continue;
    }

    shapes.push({
      element: element as IconElement,
      attributes: { ...(stack[stack.length - 1] ?? {}), ...attributes },
    });
  }

  return shapes;
}

/** One named icon, as a list of shapes to draw. Never a string of markup. */
export function iconShapes(name: unknown): IconShape[] | null {
  if (typeof name !== 'string') return null;

  const resolved = resolve(name);
  if (!resolved) return null;

  const shapes = parseIconBody(SET.icons[resolved]?.body);
  return shapes.length > 0 ? shapes : null;
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

/**
 * Names matching what somebody typed, best first.
 *
 * The order is the whole value of this function. An exact name first, then the
 * ones that START with what was typed, then the ones that merely contain it,
 * because "car" should offer `car` before `shopping-cart`. Synonyms are folded
 * in at the front, since somebody who typed "holiday" got nothing at all
 * before.
 */
export function searchIcons(query: unknown, limit = 120): string[] {
  const q = typeof query === 'string' ? query.trim().toLowerCase() : '';
  if (q === '') return ICON_NAMES.slice(0, limit);

  const seen = new Set<string>();
  const out: string[] = [];

  const take = (name: string) => {
    if (seen.has(name) || !isIconName(name)) return;
    seen.add(name);
    out.push(name);
  };

  // Synonyms first, then the plain name matches, in the order described above.
  for (const suggestion of SYNONYMS[q.replace(/[^a-z]/g, '')] ?? []) take(suggestion);
  for (const name of ICON_NAMES) if (name === q) take(name);
  for (const name of ICON_NAMES) if (name.startsWith(q)) take(name);
  for (const name of ICON_NAMES) if (name.includes(q)) take(name);

  return out.slice(0, limit);
}

/** How many icons this build offers. For the picker's own wording. */
export const ICON_COUNT = Object.keys(SET.icons).length;
