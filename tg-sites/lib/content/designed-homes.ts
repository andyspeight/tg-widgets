/**
 * The ten travel homepage concepts, rebuilt as native pages a client can start
 * from (Andy, 19 Aug 2026).
 *
 * WHAT THESE ARE, AND HOW THEY DIFFER FROM A STARTER PAGE. A starter page NAMES
 * a preset and, at most, overrides its title and its first line, because a
 * starter is building a real client's site from four answers and must never put
 * words in their mouth (see starters.ts). These are the other thing: ten designed
 * homepages, each offered as a "start from this" template, carrying finished
 * sample copy and pictures the client then replaces. That is why they set card
 * items, steps and a hero picture, which a starter deliberately does not.
 *
 * STILL NATIVE, STILL EDITABLE, STILL THE HOUSE STYLE. Each one is built from the
 * SAME section presets the rest of the product uses, so it is native blocks the
 * client can pull apart, restyle and rewrite, and it takes the client's own
 * theme rather than the concept's bespoke type and colour. Andy chose that on 19
 * Aug 2026 over a pixel-faithful frozen import: the ten stop being ten separate
 * looks and become ten editable starting points. The distinct look lived in the
 * concept's own CSS, which a native rebuild does not carry.
 *
 * THE SAME BUILDER SERVES BOTH DOORS. A designed home is reached two ways, and
 * both go through buildStarterPage: as a PageTemplate in the add-a-page picker,
 * and as the home page of a Starter in the "build me a site" wizard. So a home
 * is a StarterPage whose `build` hook returns these sections, and nothing else in
 * either path had to learn a new shape.
 *
 * NOTHING BESPOKE IS HAND-WRITTEN AS SCHEMA. Every section starts life as
 * buildPresetSection, so the block shapes, ids and defaults are exactly the ones
 * the editor makes, and the setters below only ever change words, pictures and
 * links. tests/designed-homes.test.ts parses and sanitises every one, the same
 * gate a saved page passes.
 */

import { buildPresetSection, presetById } from './presets';
import type { Block, Section } from './schema';
import type { StarterFacts, StarterPage } from './starters';

// ---------------------------------------------------------------------------
// Small setters over a freshly built preset section.
//
// Each finds blocks in document order and changes only their content. A missing
// block is left alone rather than thrown on: a preset reworded under us should
// cost a line of copy, not the whole page, and the test suite is what makes sure
// it never actually goes missing.
// ---------------------------------------------------------------------------

function blocksOf(section: Section): Block[] {
  const out: Block[] = [];
  for (const row of section.rows) for (const col of row.columns) for (const block of col.blocks) out.push(block);
  return out;
}

function ofType(section: Section, type: string): Block[] {
  return blocksOf(section).filter((block) => block.type === type);
}

/** A built preset section, or a loud failure at build time. */
function preset(id: string): Section {
  const found = presetById(id);
  if (!found) throw new Error(`designed-homes: no preset "${id}"`);
  return buildPresetSection(found);
}

/** Set the section's headings, in order. Undefined skips a slot, keeping it. */
function headings(section: Section, values: (string | undefined)[]): void {
  const found = ofType(section, 'heading');
  values.forEach((html, index) => {
    if (html != null && found[index]) found[index].props.html = html;
  });
}

/** Set the section's paragraphs, in order. Each is wrapped as one <p>. */
function texts(section: Section, values: (string | undefined)[]): void {
  const found = ofType(section, 'text');
  values.forEach((html, index) => {
    if (html != null && found[index]) found[index].props.html = `<p>${html}</p>`;
  });
}

interface ButtonSpec {
  label: string;
  href?: string;
  variant?: 'primary' | 'secondary' | 'ghost';
}

/** Set the section's buttons, whether it uses a button group or single buttons. */
function buttons(section: Section, specs: ButtonSpec[]): void {
  const group = ofType(section, 'button-group')[0];
  if (group) {
    group.props.buttons = specs.map((spec) => ({
      label: spec.label,
      href: spec.href ?? '',
      variant: spec.variant ?? 'primary',
    }));
    return;
  }
  // A preset that uses single button blocks (cta-split) rather than a group.
  const singles = ofType(section, 'button');
  specs.forEach((spec, index) => {
    const block = singles[index];
    if (!block) return;
    block.props.label = spec.label;
    block.props.href = spec.href ?? '';
    if (spec.variant) block.props.variant = spec.variant;
  });
}

interface IconSpec {
  icon?: string;
  title: string;
  body: string;
}

/** Fill the icon items, in order. */
function iconItems(section: Section, specs: IconSpec[]): void {
  const found = ofType(section, 'icon-item');
  specs.forEach((spec, index) => {
    const block = found[index];
    if (!block) return;
    if (spec.icon) block.props.icon = spec.icon;
    block.props.title = spec.title;
    block.props.body = spec.body;
  });
}

interface CardSpec {
  label?: string;
  title: string;
  body: string;
  src?: string;
  alt?: string;
  linkLabel?: string;
  linkHref?: string;
}

/** Replace the first cards block's items, match its count, and set its columns. */
function cards(section: Section, specs: CardSpec[], columns?: '2' | '3' | '4'): void {
  const block = ofType(section, 'cards')[0];
  if (!block) return;
  block.props.items = specs.map((spec) => ({
    src: spec.src ?? '',
    alt: spec.alt ?? '',
    label: spec.label ?? '',
    title: spec.title,
    body: spec.body,
    linkLabel: spec.linkLabel ?? '',
    linkHref: spec.linkHref ?? '',
  }));
  block.props.count = specs.length;
  if (columns) block.props.columns = columns;
}

interface StatSpec {
  value: string;
  suffix?: string;
  label: string;
  detail?: string;
}

/** Replace the first stats block's figures. */
function stats(section: Section, specs: StatSpec[]): void {
  const block = ofType(section, 'stats')[0];
  if (!block) return;
  block.props.items = specs.map((spec) => ({
    value: spec.value,
    suffix: spec.suffix ?? '',
    label: spec.label,
    detail: spec.detail ?? '',
  }));
}

interface QuoteSpec {
  text: string;
  attribution?: string;
  role?: string;
}

/** Fill the quote blocks, in order. */
function quotes(section: Section, specs: QuoteSpec[]): void {
  const found = ofType(section, 'quote');
  specs.forEach((spec, index) => {
    const block = found[index];
    if (!block) return;
    block.props.text = spec.text;
    if (spec.attribution != null) block.props.attribution = spec.attribution;
    if (spec.role != null) block.props.role = spec.role;
  });
}

/** Replace the first gallery block's pictures. */
function gallery(section: Section, images: { src: string; alt: string }[]): void {
  const block = ofType(section, 'gallery')[0];
  if (!block) return;
  block.props.images = images.map((image) => ({ src: image.src, alt: image.alt }));
}

interface StepSpec {
  title: string;
  body: string;
}

/** Replace the first steps block's items. */
function steps(section: Section, specs: StepSpec[]): void {
  const block = ofType(section, 'steps')[0];
  if (!block) return;
  block.props.items = specs.map((spec) => ({ title: spec.title, body: spec.body }));
}

/** Set the nth image block's picture. */
function image(section: Section, index: number, src: string, alt: string): void {
  const block = ofType(section, 'image')[index];
  if (!block) return;
  block.props.src = src;
  block.props.alt = alt;
}

interface BackgroundSpec {
  src: string;
  overlay?: number;
  tone?: 'light' | 'dark' | 'subtle';
}

/** Put a picture behind the section, with its scrim and tone. */
function background(section: Section, spec: BackgroundSpec): void {
  section.backgroundImage = spec.src;
  if (spec.overlay != null) section.overlay = spec.overlay;
  if (spec.tone) section.tone = spec.tone;
}

/** Name the section, for the outline. */
function name(section: Section, label: string): Section {
  section.name = label;
  return section;
}

/** Remove blocks the design has no use for, so no preset prompt is left behind. */
function drop(section: Section, type: string, index: number): void {
  let seen = 0;
  for (const row of section.rows) {
    for (const col of row.columns) {
      const at = col.blocks.findIndex((block) => block.type === type && seen++ === index);
      if (at !== -1) {
        col.blocks.splice(at, 1);
        return;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// The concepts
// ---------------------------------------------------------------------------

/**
 * Concept 10 — Harlow & Wren, "Quiet Couture". A spare, editorial private-travel
 * house: a full-bleed hero, three promises, a stated line, three journeys as
 * picture cards, how-we-work as numbered steps, the studio beside a picture, and
 * a consultation prompt.
 */
function harlowWren(): Section[] {
  const hero = name(preset('hero-background'), 'Hero');
  headings(hero, ['A few journeys a year. <em>Each one entirely yours.</em>']);
  texts(hero, [
    'Harlow &amp; Wren compose private travel by hand, one designer to one traveller. '
    + 'No brochure, no shortlist, no two the same.',
  ]);
  buttons(hero, [
    { label: 'Request a consultation', href: '#consult', variant: 'primary' },
    { label: 'Read three journeys', href: '#journeys', variant: 'ghost' },
  ]);
  background(hero, {
    src: 'https://images.unsplash.com/photo-1547471080-7cc2caa01a7e?w=1800&h=1200&fit=crop&q=80&auto=format',
    overlay: 55,
    tone: 'dark',
  });

  const promises = name(preset('features-three-icons'), 'Our promises');
  headings(promises, ['The level at which we work']);
  texts(promises, ['A few things we hold to, on every journey that leaves the studio.']);
  iconItems(promises, [
    {
      icon: 'user',
      title: 'One designer, one traveller',
      body: 'The person who plans your journey is the person who answers when you call from the road.',
    },
    {
      icon: 'calendar',
      title: 'Around forty journeys a year',
      body: 'No more than that, so every one has the time it needs. No two have yet been the same.',
    },
    {
      icon: 'phone',
      title: 'A direct line, day and night',
      body: 'Your designer, reachable while you travel. Never a call centre, never a duty desk.',
    },
  ]);

  const stated = name(preset('text-statement'), 'A stated line');
  texts(stated, [
    'The corner room on the third floor, <em>because the second loses the light after four.</em>',
  ]);

  const journeys = name(preset('features-cards-with-pictures'), 'Journeys');
  headings(journeys, ['Three from this year’s book']);
  texts(journeys, ['Shown as they were composed. Every journey begins on a blank page.']);
  cards(journeys, [
    {
      label: 'Val d’Orcia, Tuscany',
      title: 'A private villa above the Val d’Orcia',
      body: 'Ten nights in a farmhouse taken in full, a cook three evenings a week, truffles dug before '
        + 'breakfast and the Brunello cellars opened by name.',
      src: 'https://images.unsplash.com/photo-1445019980597-93fa8acb246c?w=1100&h=825&fit=crop&q=80&auto=format',
      alt: 'First light across a stone loggia and cypress garden at a private Tuscan villa',
      linkLabel: 'Discuss this journey',
      linkHref: '#consult',
    },
    {
      label: 'The Grand Canal, Venice',
      title: 'A Venetian winter, the city returned to itself',
      body: 'Six nights on the quiet side of the water, the Accademia to yourself before it opens, and '
        + 'Torcello by private launch at eight.',
      src: 'https://images.unsplash.com/photo-1523906834658-6e24ef2386f9?w=1100&h=825&fit=crop&q=80&auto=format',
      alt: 'The Grand Canal seen from the Rialto in Venice in soft evening light',
      linkLabel: 'Discuss this journey',
      linkHref: '#consult',
    },
    {
      label: 'Higashiyama, Kyoto',
      title: 'Kyoto in the last of the maples',
      body: 'Twelve nights between a townhouse in the old weavers’ quarter and a ryokan on the Inland '
        + 'Sea, the moss garden at Saihoji reserved months ahead.',
      src: 'https://images.unsplash.com/photo-1493976040374-85c8e12f0c0e?w=1100&h=825&fit=crop&q=80&auto=format',
      alt: 'A lane in Higashiyama, Kyoto, leading up to the Yasaka pagoda at dusk',
      linkLabel: 'Discuss this journey',
      linkHref: '#consult',
    },
  ]);

  const how = name(preset('features-how-it-works'), 'How we work');
  // The preset leads with a small eyebrow line then the title. The concept has no
  // eyebrow, so the first heading is dropped and the title carries the section.
  drop(how, 'heading', 0);
  headings(how, ['The itinerary is the <em>last</em> thing we make.']);
  steps(how, [
    {
      title: 'A conversation, not a form',
      body: 'An hour with your designer, by telephone or at the studio. How you like to travel, who is '
        + 'coming, and what the journey is for. Nothing is booked, nothing is sold.',
    },
    {
      title: 'One proposal, fully priced',
      body: 'Within a week, a single considered journey, not three padded for choice, with every cost '
        + 'written down to the transfers. We revise it with you until it is right.',
    },
    {
      title: 'A hand on it while you travel',
      body: 'Your designer, reachable on a direct line day and night, so a closed airport becomes a fast '
        + 'train you are already on.',
    },
  ]);

  const studio = name(preset('hero-split-left'), 'The studio');
  image(
    studio,
    0,
    'https://images.unsplash.com/photo-1541432901042-2d8bd64b4a9b?w=1000&h=1250&fit=crop&q=80&auto=format',
    'Grand stone architecture at first light, domes and minarets against a pale early sky',
  );
  headings(studio, ['You deal with one person, start to finish.']);
  texts(studio, [
    'Harlow &amp; Wren is nine designers above a bookbinder’s in Fitzrovia. Each keeps a small book '
    + 'of travellers, stays with the regions they know in their bones, and answers their own telephone.',
  ]);
  buttons(studio, [{ label: 'Meet the studio', href: '#studio', variant: 'ghost' }]);

  const consult = name(preset('contact-form-beside-details'), 'Start a conversation');
  headings(consult, ['Start with a conversation.']);
  texts(consult, [
    'Tell us a little about the journey you have in mind, or the one you cannot quite picture yet, and '
    + 'the right designer will call you back within one working day. The first conversation costs nothing.',
    'Add your enquiry form here, or drop in the Form widget.',
    'Weekdays 9 to 6, Saturdays by appointment.',
  ]);
  iconItems(consult, [
    { title: 'The studio', body: '14 Colville Place, Fitzrovia, London W1T 2BG' },
    { title: 'By phone or email', body: '020 3670 4180 or studio@harlowandwren.co.uk' },
  ]);

  return [hero, promises, stated, journeys, how, studio, consult];
}

/** A full-bleed Unsplash picture at the size a slot wants. */
function unsplash(id: string, w: number, h: number): string {
  return `https://images.unsplash.com/photo-${id}?w=${w}&h=${h}&fit=crop&q=80&auto=format`;
}

/**
 * Concept 1 — Peak & Pass, small-group expeditions. A dark mountain hero, the
 * expedition book as picture cards, a sample traverse day by day, honest
 * grading, the guides, and a booking nudge.
 */
function peakAndPass(): Section[] {
  const hero = name(preset('hero-background'), 'Hero');
  headings(hero, ['Earn the view']);
  texts(hero, [
    'Small-group expeditions on foot, rope and water, capped at twelve. Proper distances, honest '
    + 'grades, qualified leaders. We plan the logistics, you carry your own pack.',
  ]);
  buttons(hero, [
    { label: 'View dates and availability', href: '#dates', variant: 'primary' },
    { label: 'How we grade a trip', href: '#grades', variant: 'ghost' },
  ]);
  background(hero, { src: unsplash('1506905925346-21bda4d32df4', 1800, 1200), overlay: 45, tone: 'dark' });

  const book = name(preset('features-cards-with-pictures'), 'The book');
  headings(book, ['Forty-one expeditions. No filler.']);
  texts(book, [
    'Every departure runs with a qualified leader, a stated grade and a hard cap on group size. '
    + 'If a trip is hard, the page says so.',
  ]);
  cards(book, [
    {
      label: 'Trek, Alps',
      title: "Walker's Haute Route",
      body: 'Twelve days between Chamonix and Zermatt, crossing eleven cols above 2,700m. You carry what '
        + 'you need, the huts do the rest.',
      src: unsplash('1551632811-561732d1e306', 1100, 825),
      alt: 'Two trekkers with large packs on a rocky trail beneath glaciated peaks',
      linkLabel: 'See dates',
      linkHref: '#dates',
    },
    {
      label: 'Trek, Nepal',
      title: 'Annapurna Sanctuary',
      body: 'Into the amphitheatre of peaks at 4,130m, teahouse to teahouse, on one of the great walks '
        + 'in the Himalaya.',
      src: unsplash('1526772662000-3f88f10405ff', 1100, 825),
      alt: 'A trekker beside a stone cairn facing the high Himalaya',
      linkLabel: 'See dates',
      linkHref: '#dates',
    },
    {
      label: 'Climb, Thailand',
      title: 'Railay Climbing Week',
      body: 'Learn to lead on warm limestone above the sea, with a qualified instructor and a two to one '
        + 'ratio all week.',
      src: unsplash('1522163182402-834f871fd851', 1100, 825),
      alt: 'A climber on a steep overhanging limestone cliff above the sea',
      linkLabel: 'See dates',
      linkHref: '#dates',
    },
    {
      label: 'Trek, Patagonia',
      title: 'Torres del Paine, the O Circuit',
      body: 'Eight days round the back of the towers, over the John Gardner pass and along the Grey '
        + 'glacier. The full loop, not the day-trip version.',
      src: unsplash('1544198365-f5d60b6d8190', 1100, 825),
      alt: 'First light striking the granite towers of Torres del Paine',
      linkLabel: 'See dates',
      linkHref: '#dates',
    },
  ], '2');

  const itinerary = name(preset('steps-itinerary'), 'Day by day');
  headings(itinerary, ['Jotunheimen Traverse, day by day']);
  steps(itinerary, [
    {
      title: 'Gjendesheim and the Besseggen ridge',
      body: 'Straight onto the range’s most famous line, the arete between green Gjende and blue '
        + 'Bessvatnet. Hands out of pockets for twenty minutes of easy scrambling.',
    },
    {
      title: 'Memurubu to Gjendebu',
      body: 'A high shoulder above the lake then a long descent through birch. A shorter day, and your '
        + 'legs will thank you by dinner.',
    },
    {
      title: 'Into the Svartdalen valley',
      body: 'The quiet heart of the range, a stone valley between glaciers, usually shared with nobody '
        + 'but reindeer.',
    },
    {
      title: 'Over the high col to Turtagro',
      body: 'The last big climb, then down to the old climbers’ hotel under the Skagastol spires. '
        + 'A proper end to the traverse.',
    },
  ]);

  const grades = name(preset('steps-down'), 'How hard is hard');
  headings(grades, ['How hard is hard?']);
  steps(grades, [
    {
      title: 'Grades 1 to 2, moderate',
      body: 'Full days out, good paths, no exposure. Fit enough to enjoy a long hilly weekend and you '
        + 'are fine.',
    },
    {
      title: 'Grade 3, energetic',
      body: 'Bigger days or new skills, a rope, a paddle, a heavier pack. Regular hill walkers and '
        + 'gym-fit beginners do well here.',
    },
    {
      title: 'Grades 4 to 5, serious',
      body: 'Altitude, exposure and long days. We would rather lose a booking than watch you have a '
        + 'miserable week high on a hill.',
    },
  ]);

  const guides = name(preset('text-intro'), 'Who leads');
  headings(guides, ['Qualified. Every trip. No exceptions.']);
  texts(guides, [
    'Eleven staff leaders, most of them ten years and more in. Their tickets are listed on every trip '
    + 'page, because you are trusting them with your week and occasionally your neck.',
  ]);

  const cta = name(preset('cta-split'), 'Book');
  headings(cta, ["Pick your grade. We'll hold the map."]);
  texts(cta, ['Departure lists for 2026 and 2027 are live. Most Grade 4 trips fill four to six months out.']);
  buttons(cta, [{ label: 'View dates and availability', href: '#dates', variant: 'primary' }]);

  return [hero, book, itinerary, grades, guides, cta];
}

/**
 * Concept 2 — Awaydays, cheap city and beach breaks. A punchy text hero, this
 * week's deals as cards, the deposit, festivals, a wall of travellers' photos,
 * and a last shout.
 */
function awaydays(): Section[] {
  const hero = name(preset('hero-centred'), 'Hero');
  headings(hero, ['Cheap now. Sorted in minutes.']);
  texts(hero, [
    'Prices per person, two sharing, this week’s cheapest dates. They move, that is how cheap '
    + 'works. Every one bookable with a 49 pound deposit.',
  ]);
  buttons(hero, [
    { label: "See this week's deals", href: '#deals', variant: 'primary' },
    { label: 'How the deposit works', href: '#deposit', variant: 'ghost' },
  ]);

  const deals = name(preset('features-cards-with-pictures'), "This week's deals");
  headings(deals, ["This week's cheapest"]);
  texts(deals, ['Flights and a place to crash, one price, one booking. Split it with the group in the app.']);
  cards(deals, [
    {
      label: 'Selling fast',
      title: 'Ibiza, from 249pp',
      body: '4 nights, flights and apartment, June to September, three minutes from the sunset strip.',
      src: unsplash('1516450360452-9312f5e86fc7', 1100, 825),
      alt: 'A packed club crowd dancing under pink stage lights',
      linkLabel: 'Grab it',
      linkHref: '#deals',
    },
    {
      label: 'Group fave',
      title: 'Zante, from 212pp',
      body: '7 nights, flights and hotel, strip-front, with the free breakfast you will need.',
      src: unsplash('1519046904884-53103b34b206', 1100, 825),
      alt: 'A white sand beach with a straw parasol and palm trees',
      linkLabel: 'Grab it',
      linkHref: '#deals',
    },
    {
      label: 'Quick weekend',
      title: 'Amsterdam, from 119pp',
      body: '2 nights, flights and hostel, right in the city centre.',
      src: unsplash('1534351590666-13e3e96b5017', 1100, 825),
      alt: 'An Amsterdam canal lined with boats and tall canal houses',
      linkLabel: 'Grab it',
      linkHref: '#deals',
    },
    {
      label: 'Wristband included',
      title: 'Croatia festival week, from 329pp',
      body: '5 nights, flights, apartment and a festival ticket. Split, in July.',
      src: unsplash('1506157786151-b8491531f063', 1100, 825),
      alt: 'A festival crowd with hands up in front of a huge lit stage',
      linkLabel: 'Grab it',
      linkHref: '#deals',
    },
    {
      label: 'Payday job',
      title: 'New York, from 486pp',
      body: '3 nights, flights and hostel, Manhattan, January to March.',
      src: unsplash('1519501025264-65ba15a82390', 1100, 825),
      alt: 'Looking down a dense city street between skyscrapers at dusk',
      linkLabel: 'Grab it',
      linkHref: '#deals',
    },
    {
      label: 'Proper skint',
      title: 'Albufeira, from 159pp',
      body: '4 nights, flights and hotel, old town strip.',
      src: unsplash('1522098543979-ffc7f79a56c4', 1100, 825),
      alt: 'Two friends messing about on the beach at sunset',
      linkLabel: 'Grab it',
      linkHref: '#deals',
    },
  ], '3');

  const deposit = name(preset('cta-split'), 'Deposit');
  headings(deposit, ['49 pounds locks it in.']);
  texts(deposit, [
    'Pay the rest whenever, right up to a few weeks before you fly. Split it with the group so nobody '
    + 'is chasing anybody.',
  ]);
  buttons(deposit, [{ label: 'How the deposit works', href: '#deposit', variant: 'primary' }]);

  const festival = name(preset('cta-split'), 'Festivals');
  headings(festival, ['Festival week, handled.']);
  texts(festival, [
    'Flights, apartment, wristband, boat party, one booking, one group link, everyone pays their own '
    + 'bit. You just turn up. From 329 pounds.',
  ]);
  buttons(festival, [{ label: 'See festival packages', href: '#deals', variant: 'primary' }]);

  const wall = name(preset('gallery-grid'), 'Traveller photos');
  headings(wall, ['Shot on phones, obviously.']);
  texts(wall, ["Tag @awaydaystravel and we'll stick you on here."]);
  gallery(wall, [
    { src: unsplash('1529156069898-49953e39b3ac', 640, 640), alt: 'A group of friends sat in a row with arms around each other' },
    { src: unsplash('1506869640319-fe1a24fd76dc', 640, 640), alt: 'Friends silhouetted against the sunset with their hands in the air' },
    { src: unsplash('1501281668745-f7f57925c3b4', 640, 640), alt: 'Filming a gig on a phone through pink smoke and stage lights' },
    { src: unsplash('1533174072545-7a4b6ad7a6c3', 640, 640), alt: 'Confetti falling over a packed gig crowd' },
    { src: unsplash('1429962714451-bb934ecdc4ec', 640, 640), alt: 'Hands making a heart shape at a concert' },
    { src: unsplash('1496843916299-590492c751f4', 640, 640), alt: 'Pineapples in sunglasses and party hats with balloons' },
  ]);

  const cta = name(preset('cta-centred'), 'See the lot');
  headings(cta, ['84 deals live right now.']);
  texts(cta, ['Ibiza to New York, every one bookable with a 49 pound deposit.']);
  buttons(cta, [
    { label: 'See the lot', href: '#deals', variant: 'primary' },
    { label: 'Give us a ring', href: '#contact', variant: 'ghost' },
  ]);

  return [hero, deals, deposit, festival, wall, cta];
}

/**
 * Concept 3 — Windward & West, Caribbean specialists. A turquoise hero, three
 * featured islands as cards, the numbers, an honest word on the season, and the
 * island-match nudge.
 */
function windwardWest(): Section[] {
  const hero = name(preset('hero-background'), 'Hero');
  headings(hero, ['The water really is this colour.']);
  texts(hero, [
    'Caribbean specialists since 2004. Twenty-one islands, all different, all ours. In February it is '
    + '28 degrees, warmer than your bath, eight and a half hours from Gatwick, direct.',
  ]);
  buttons(hero, [
    { label: 'Find my island', href: '#match', variant: 'primary' },
    { label: 'Or ring 01273 749 118', href: 'tel:+441273749118', variant: 'ghost' },
  ]);
  background(hero, { src: unsplash('1506929562872-bb421503ef21', 1800, 1200), overlay: 40, tone: 'dark' });

  const islands = name(preset('features-cards-with-pictures'), 'Featured islands');
  headings(islands, ['Marrying the wrong island is expensive. Meet three of ours.']);
  texts(islands, [
    'Every island has a personality, the party one, the quiet one, the one that shows off. We have '
    + 'stayed on all of them, so you do not have to guess.',
  ]);
  cards(islands, [
    {
      label: 'The reliable one',
      title: 'Barbados',
      body: 'Rum shops with dominoes clacking, flying-fish cutters at Oistins on a Friday, cricket on '
        + 'the radio all afternoon. It does not show off, it just works.',
      src: unsplash('1476673160081-cf065607f449', 1100, 825),
      alt: 'Golden evening light over a calm Barbados beach',
      linkLabel: 'Ask Marcia about Barbados',
      linkHref: '#match',
    },
    {
      label: 'The dramatic one',
      title: 'St Lucia',
      body: 'The Pitons fill your bedroom window here. Rainforest, sulphur springs, and the best sunset '
        + 'sail in the Caribbean.',
      src: unsplash('1540541338287-41700207dee6', 1100, 825),
      alt: 'A hillside resort pool ringed by palms looking out to sea',
      linkLabel: 'Ask Tom about St Lucia',
      linkHref: '#match',
    },
    {
      label: 'The one that smells of nutmeg',
      title: 'Grenada',
      body: 'Spice markets, a working nutmeg station, and Grand Anse, two miles of pale sand at the '
        + 'southern edge of the hurricane belt.',
      src: unsplash('1596040033229-a9821ebd058d', 1100, 825),
      alt: 'Nutmeg, mace and island spices laid out across a Grenadian stall',
      linkLabel: 'Ask Marcia about Grenada',
      linkHref: '#match',
    },
  ]);

  const numbers = name(preset('stats-three'), 'The numbers');
  stats(numbers, [
    { value: '28', suffix: '°C', label: 'The sea, in February' },
    { value: '8.5', suffix: ' hrs', label: 'Direct from Gatwick' },
    { value: '21', label: 'Islands, all ours' },
  ]);

  const season = name(preset('text-intro'), 'The honest version');
  headings(season, ['June to November is hurricane season. There, we said it.']);
  texts(season, [
    'Most agents whisper it. We would rather you knew. Most weeks inside it are still glorious, storms '
    + 'are tracked days out, and direct hits on any single island are rare. Barbados, Grenada and '
    + 'Tobago sit at the southern edge of the belt and are struck far less often.',
  ]);

  const match = name(preset('cta-split'), 'The island match');
  headings(match, ["Tell us who you are. We'll tell you where you land."]);
  texts(match, [
    'Two minutes of your time, one phone call back from someone who has been, and the right island, '
    + 'first time. No brochures posted, no mailing lists, no nonsense.',
  ]);
  buttons(match, [{ label: 'Start the island match', href: '#match', variant: 'primary' }]);

  return [hero, islands, numbers, season, match];
}

/**
 * Concept 4 — Harbourline, no-fly cruise specialists. A navy hero, ports as
 * cards, a benchmark itinerary day by day, the numbers, why a specialist, and a
 * search nudge.
 */
function harbourline(): Section[] {
  const hero = name(preset('hero-background'), 'Hero');
  headings(hero, ['Out with the evening tide. Home three countries later.']);
  texts(hero, [
    'No-fly cruising from Southampton, since 2004. Independent specialists, eleven of us, three '
    + 'hundred sailings between us. We plan by itinerary, not brochure, and there is a human who has '
    + 'been aboard on the end of the phone.',
  ]);
  buttons(hero, [
    { label: 'Find your cruise', href: '#find', variant: 'primary' },
    { label: 'Or ring 023 8022 4961', href: 'tel:+442380224961', variant: 'ghost' },
  ]);
  background(hero, { src: unsplash('1601439678777-b2b3c56fa627', 1800, 1200), overlay: 45, tone: 'dark' });

  const ports = name(preset('features-cards-with-pictures'), 'The ports');
  headings(ports, ['Ports worth the sea days in between']);
  texts(ports, [
    'Guest ratings from our own post-cruise questionnaires, and the months our team would actually go.',
  ]);
  cards(ports, [
    {
      label: 'No-fly from Southampton',
      title: 'Norwegian Fjords',
      body: 'Rated 4.9 by our guests. Best May to July, 8 to 15 nights, and no airport at either end.',
      src: unsplash('1601439678777-b2b3c56fa627', 1100, 825),
      alt: "A ship's wake curving through a steep-sided Norwegian fjord",
      linkLabel: 'See sailings',
      linkHref: '#find',
    },
    {
      label: 'Portugal',
      title: 'Lisbon',
      body: '61 sailings call. Rated 4.8. A morning in the Alfama and a pastel de nata before you sail.',
      src: unsplash('1536663815808-535e2280d2c2', 1100, 825),
      alt: "Terracotta rooftops and a white church in Lisbon's Alfama district",
      linkLabel: 'See sailings',
      linkHref: '#find',
    },
    {
      label: 'Greece',
      title: 'Santorini',
      body: '38 sailings call. Rated 4.9. Whitewashed houses stepping down the caldera at dusk.',
      src: unsplash('1570077188670-e3a8d69ac5ff', 1100, 825),
      alt: 'Whitewashed houses of Santorini stepping down the caldera',
      linkLabel: 'See sailings',
      linkHref: '#find',
    },
    {
      label: 'Italy',
      title: 'Venice',
      body: '29 sailings call. Rated 4.8. Gondolas under the Rialto and a spritz on the water.',
      src: unsplash('1523906834658-6e24ef2386f9', 1100, 825),
      alt: 'Gondolas passing under the Rialto Bridge in Venice',
      linkLabel: 'See sailings',
      linkHref: '#find',
    },
  ], '2');

  const spotlight = name(preset('steps-itinerary'), 'The benchmark itinerary');
  headings(spotlight, ['Fourteen nights, seven ports, one unpacking']);
  steps(spotlight, [
    { title: 'Southampton to Lisbon', body: 'Two sea days to settle in, then the Portuguese capital on the Tagus.' },
    { title: 'Gibraltar and Cartagena', body: 'The Rock, then a quiet Roman port on the Spanish coast.' },
    { title: 'Barcelona, overnight', body: 'A full day and a night alongside, long enough for the Sagrada Familia and dinner ashore.' },
    { title: 'Rome and Cadiz, then home', body: 'The Eternal City by tender, a last Andalusian port, and two sea days back to Southampton.' },
  ]);

  const numbers = name(preset('stats-three'), 'The numbers');
  stats(numbers, [
    { value: '4,200', label: 'Protected sailings we can book' },
    { value: '4.7', suffix: '/5', label: 'From 3,418 reviews' },
    { value: '2004', label: 'Southampton, since' },
  ]);

  const specialist = name(preset('text-intro'), 'Why a specialist');
  headings(specialist, ['Why book with a specialist instead of a screen']);
  texts(specialist, [
    'Cruise pricing has a reputation, and it is earned. Our quote is a single page that shows what the '
    + 'fare covers and prices anything it does not, before you commit a penny.',
  ]);

  const cta = name(preset('cta-split'), 'Find your cruise');
  headings(cta, ['Find your cruise']);
  texts(cta, ['Search 4,200 protected sailings, then talk it through with someone who has done the run.']);
  buttons(cta, [{ label: 'Talk to a specialist', href: 'tel:+442380224961', variant: 'primary' }]);

  return [hero, ports, spotlight, numbers, specialist, cta];
}

/**
 * Concept 5 — Bucket and Spade, family holiday specialists. A bright hero,
 * school-holiday dates, offers as cards, a row by age group, real reviews, and a
 * warm last word.
 */
function bucketAndSpade(): Section[] {
  const hero = name(preset('hero-background'), 'Hero');
  headings(hero, ['The family holiday, sorted properly.']);
  texts(hero, [
    'Free child places found, kids clubs checked by age, transfers under ninety minutes and no 6am '
    + 'flights unless you ask for them. We do the maths so you can just pack.',
  ]);
  buttons(hero, [
    { label: 'Find your holiday', href: '#offers', variant: 'primary' },
    { label: 'See dates and prices', href: '#dates', variant: 'ghost' },
  ]);
  background(hero, { src: unsplash('1602088113235-229c19758e9f', 1800, 1200), overlay: 40, tone: 'dark' });

  const dates = name(preset('features-four-cards'), 'School-holiday dates');
  drop(dates, 'heading', 0);
  headings(dates, ['School holiday dates, already priced']);
  iconItems(dates, [
    { icon: 'calendar', title: 'Easter', body: '27 Mar to 11 Apr 2027, 7 nights from 1,684 pounds total.' },
    { icon: 'calendar', title: 'May half term', body: '29 May to 6 Jun 2027, 7 nights from 1,893 pounds total.' },
    { icon: 'sun', title: 'Summer holidays', body: '17 Jul to 31 Aug 2026, 7 nights from 2,236 pounds total.' },
    { icon: 'calendar', title: 'October half term', body: '24 Oct to 1 Nov 2026, 7 nights from 1,412 pounds total.' },
  ]);

  const offers = name(preset('features-cards-with-pictures'), 'Offers');
  headings(offers, ["Offers our team would book for their own kids"]);
  texts(offers, ['Checked this week. Every price is the total for your whole party, flights, transfers and luggage in.']);
  cards(offers, [
    {
      label: 'Turkey, all inclusive',
      title: 'Sunmill Bay Resort and Splash Park',
      body: 'Sarigerme on the Dalaman coast, 7 nights for two adults and two children from Manchester.',
      src: unsplash('1520250497591-112f2f40a3f4', 1100, 825),
      alt: 'A resort pool with a winding waterslide and palm trees',
      linkLabel: 'View this holiday',
      linkHref: '#offers',
    },
    {
      label: 'Algarve, half board',
      title: 'Alvor Praia Aparthotel',
      body: 'A free child place and an October half term price. 7 nights, family of four.',
      src: unsplash('1602088113235-229c19758e9f', 1100, 825),
      alt: 'Children jumping into a sunlit hotel pool while parents watch',
      linkLabel: 'View this holiday',
      linkHref: '#offers',
    },
    {
      label: 'Crete, all inclusive',
      title: 'Porto Kalives Waterpark Hotel',
      body: 'A teen zone and six slides, summer dates. 7 nights, family of four.',
      src: unsplash('1507525428034-b723cf961d3e', 1100, 825),
      alt: 'A sandcastle on the beach with a red bucket beside it',
      linkLabel: 'View this holiday',
      linkHref: '#offers',
    },
  ]);

  const ages = name(preset('features-four-cards'), 'By age group');
  drop(ages, 'heading', 0);
  headings(ages, ["A trip that fits the ages you've actually got"]);
  iconItems(ages, [
    { icon: 'baby', title: 'Babies and tots, 0 to 3', body: 'Cots and bottle warmers confirmed before you book, short transfers, quiet pools, pram-friendly resorts.' },
    { icon: 'smile', title: 'Little ones, 4 to 7', body: 'Kids clubs that genuinely take four-year-olds, shallow splash zones, early teas, shows before bedtime.' },
    { icon: 'waves', title: 'Big kids, 8 to 12', body: 'Waterparks and slides, sports academies, all inclusive so the fourth ice cream is not a negotiation.' },
    { icon: 'wifi', title: 'Teens, 13 and up', body: 'Proper wifi, teen hangouts away from the toddler disco, watersports, and enough on that they leave the room.' },
  ]);

  const reviews = name(preset('testimonials-three'), 'Reviews');
  headings(reviews, ['From families like yours']);
  quotes(reviews, [
    { text: 'Told them our budget and the ages. Three options back the same afternoon, no upselling.', attribution: 'A parent of two', role: 'A week in the Algarve' },
    { text: 'Our flight got cancelled and they had rebooked us before I had even found the email.', attribution: 'A family of four', role: 'Half term in Lanzarote' },
    { text: 'The kids club at the hotel was exactly as described. That never happens.', attribution: 'A parent', role: 'Summer in Crete' },
  ]);

  const cta = name(preset('cta-centred'), 'Ready when you are');
  headings(cta, ["Tell us the ages. We'll do the rest."]);
  texts(cta, [
    'Search now, or send us the dates you are stuck with and the ages you are travelling with. We will '
    + 'come back the same day with three holidays that actually work.',
  ]);
  buttons(cta, [
    { label: 'Search family holidays', href: '#offers', variant: 'primary' },
    { label: 'Or call 01204 917 344', href: 'tel:+441204917344', variant: 'ghost' },
  ]);

  return [hero, dates, offers, ages, reviews, cta];
}

/**
 * Concept 6 — Sandpiper, a leaner family site. A warm hero, the priced dates, a
 * row by age group, the person on the phone, and an enquiry nudge.
 */
function sandpiper(): Section[] {
  const hero = name(preset('hero-background'), 'Hero');
  headings(hero, ["Pick the dates you're stuck with. We've done the maths."]);
  texts(hero, [
    'School holidays, already priced. Every price is the total for two adults and two children from '
    + 'your local airport, flights, transfers and luggage included.',
  ]);
  buttons(hero, [
    { label: 'See the dates', href: '#dates', variant: 'primary' },
    { label: 'Tell us your dates', href: '#enquire', variant: 'ghost' },
  ]);
  background(hero, { src: unsplash('1502086223501-7ea6ecd79368', 1800, 1200), overlay: 42, tone: 'dark' });

  const dates = name(preset('features-four-cards'), 'The dates');
  drop(dates, 'heading', 0);
  headings(dates, ['School holidays, already priced']);
  iconItems(dates, [
    { icon: 'calendar', title: 'Easter', body: '27 Mar to 11 Apr 2027, 7 nights, family of four, from 1,721 pounds.' },
    { icon: 'calendar', title: 'May half term', body: '29 May to 6 Jun 2027, 7 nights, family of four, from 1,908 pounds.' },
    { icon: 'sun', title: 'Summer holidays', body: '16 Jul to 31 Aug 2027, 7 nights, family of four, from 2,293 pounds.' },
    { icon: 'calendar', title: 'October half term', body: '23 to 31 Oct 2027, 7 nights, family of four, from 1,486 pounds.' },
  ]);

  const ages = name(preset('features-four-cards'), 'By age group');
  drop(ages, 'heading', 0);
  headings(ages, ["A trip that fits the ages you've actually got"]);
  iconItems(ages, [
    { icon: 'baby', title: 'Babies and tots, 0 to 3', body: 'Cots confirmed before booking, quiet pools, pram-friendly resorts, short transfers.' },
    { icon: 'smile', title: 'Little ones, 4 to 7', body: 'Kids clubs that really take four-year-olds, splash zones, early teas, evening shows.' },
    { icon: 'waves', title: 'Big kids, 8 to 12', body: 'Waterparks, sports academies, all inclusive so the fourth ice cream is not a debate.' },
    { icon: 'wifi', title: 'Teens, 13 and up', body: 'Proper wifi, teen zones away from the toddler disco, watersports worth leaving the room for.' },
  ]);

  const team = name(preset('text-intro'), 'Real people');
  headings(team, ["You'll speak to someone who's done the flight with a toddler"]);
  texts(team, [
    'Real people, real opinions, and a named adviser who picks up. 0191 248 0622, Monday to Saturday '
    + '9 to 7, Sunday 10 to 4.',
  ]);

  const cta = name(preset('cta-split'), 'Enquire');
  headings(cta, ["Send us your dates and your children's ages."]);
  texts(cta, [
    'We will come back today with three holidays that work. No call centre, no hold music, a named '
    + 'adviser replies the same working day.',
  ]);
  buttons(cta, [{ label: 'Tell us the ages', href: '#enquire', variant: 'primary' }]);

  return [hero, dates, ages, team, cta];
}

/**
 * Concept 7 — Harland & Vane, a private-travel studio. A dark hero, a stated
 * line, three journeys as cards, how we work as steps, the designers, a client
 * word, and a consultation.
 */
function harlandVane(): Section[] {
  const hero = name(preset('hero-background'), 'Hero');
  headings(hero, ['We plan very few trips each year. Yours would be one of them.']);
  texts(hero, [
    'Harland and Vane is a studio of eleven travel designers. Each takes on a small number of clients, '
    + 'travels their own regions every year, and answers their own phone.',
  ]);
  buttons(hero, [
    { label: 'Request a consultation', href: '#consult', variant: 'primary' },
    { label: "Or read three of this year's journeys", href: '#journeys', variant: 'ghost' },
  ]);
  background(hero, { src: unsplash('1445019980597-93fa8acb246c', 1800, 1200), overlay: 55, tone: 'dark' });

  const stated = name(preset('text-statement'), 'A stated line');
  texts(stated, [
    'A corner suite on the third floor of the Splendido, <em>because the second floor loses the light '
    + 'after four.</em> That is the level at which we work.',
  ]);

  const journeys = name(preset('features-cards-with-pictures'), 'Journeys');
  headings(journeys, ["Three journeys from this year’s book"]);
  texts(journeys, ['Shown as planned. Every itinerary is built from a blank page.']);
  cards(journeys, [
    {
      label: 'Italy, September',
      title: 'The Aeolian Islands by private motor-yacht',
      body: 'Seven nights between Salina and Stromboli aboard a crewed 24-metre yacht, with two nights '
        + 'ashore at the Capofaro estate among the malvasia vines.',
      src: unsplash('1582719508461-905c673771fd', 1100, 825),
      alt: 'The wake of a motor yacht crossing calm water between two volcanic islands',
      linkLabel: 'Discuss this journey',
      linkHref: '#consult',
    },
    {
      label: 'India, January to March',
      title: 'Rajasthan in the cool season',
      body: 'Twelve nights, Jodhpur to Jaipur by road with your own car and driver, staying in former '
        + 'private residences, including two nights as the only guests at a seventeenth-century fort.',
      src: unsplash('1477587458883-47145ed94245', 1100, 825),
      alt: 'A blue-washed stairway in the old city of Jodhpur, empty in the morning',
      linkLabel: 'Discuss this journey',
      linkHref: '#consult',
    },
    {
      label: 'Namibia, May to October',
      title: 'The Skeleton Coast by light aircraft',
      body: 'A week flown between desert camps, seal colonies and shipwrecks, landing where no road '
        + 'goes and walking with a Himba guide.',
      src: unsplash('1547471080-7cc2caa01a7e', 1100, 825),
      alt: "A light aircraft's shadow crossing dunes where the Namib meets the sea",
      linkLabel: 'Discuss this journey',
      linkHref: '#consult',
    },
  ]);

  const how = name(preset('steps-down'), 'How we work');
  headings(how, ['The itinerary is the last thing we produce.']);
  steps(how, [
    {
      title: 'A conversation, not a form',
      body: 'An hour with your designer, by phone or at the studio. How you like to travel, what you '
        + 'never want to do again, who is coming, what the trip is for. Nothing is booked, nothing is sold.',
    },
    {
      title: 'One proposal, fully priced',
      body: 'Within a week, a single considered itinerary, not three padded for choice, with every cost '
        + 'stated down to the transfers. We revise it with you until it is right.',
    },
    {
      title: 'While you travel',
      body: 'Your designer, reachable on a direct line day and night. When fog closed Venice last '
        + 'November, our clients were re-routed through Verona with a car waiting.',
    },
  ]);

  const designers = name(preset('features-cards-with-pictures'), 'The designers');
  headings(designers, ['You deal with one person']);
  texts(designers, ['Three of the eleven. Each keeps a small book of travellers and the regions they know in their bones.']);
  cards(designers, [
    {
      label: 'Italy and the Adriatic, 19 years',
      title: 'Eleanor Whitby',
      body: 'Spends every June driving the back roads between Puglia and the Marche, checking rooms.',
      src: unsplash('1560250097-0b93528c311a', 900, 1100),
      alt: 'Portrait of travel designer Eleanor Whitby',
      linkLabel: 'Ask for Eleanor',
      linkHref: '#consult',
    },
    {
      label: 'Southern and East Africa, 14 years',
      title: 'James Osei',
      body: 'Back in camp every dry season, from the Okavango to the Bale Mountains, walking the '
        + 'concessions he sends people to.',
      src: unsplash('1580489944761-15a19d654956', 900, 1100),
      alt: 'Portrait of travel designer James Osei',
      linkLabel: 'Ask for James',
      linkHref: '#consult',
    },
    {
      label: 'Japan and the Silk Road, 12 years',
      title: 'Marianne Faulks',
      body: 'Takes the slow trains each spring, from Kanazawa to Koya-san, for the inns worth the '
        + 'detour.',
      src: unsplash('1573496359142-b8d87734a5a2', 900, 1100),
      alt: 'Portrait of travel designer Marianne Faulks',
      linkLabel: 'Ask for Marianne',
      linkHref: '#consult',
    },
  ]);

  const word = name(preset('testimonials-one-big'), 'From a client');
  quotes(word, [
    {
      text: 'They moved our flights twice, re-booked the riad when the roof terrace flooded, and never '
        + 'once made any of it feel like our problem. We found out most of it had happened after we got home.',
      attribution: 'A client',
      role: 'Morocco, two weeks',
    },
  ]);

  const consult = name(preset('contact-form-beside-details'), 'Start a conversation');
  headings(consult, ['Start with a conversation']);
  texts(consult, [
    'Tell us a little about the trip you have in mind, or the one you cannot quite picture yet, and '
    + 'the right designer will call you back within one working day. The first conversation costs nothing.',
    'Add your enquiry form here, or drop in the Form widget.',
    'Weekdays 9 to 6, Saturdays 10 to 2.',
  ]);
  iconItems(consult, [
    { title: 'The studio', body: '61 Marylebone Lane, London W1U 2NX' },
    { title: 'By phone', body: '020 7183 4460, a designer answers, not a call centre' },
  ]);

  return [hero, stated, journeys, how, designers, word, consult];
}

/**
 * Concept 8 — Aurelia, a small luxury studio. A dark hero, three escapes as
 * cards, the promise, a guest word, and an enquiry.
 */
function aurelia(): Section[] {
  const hero = name(preset('hero-background'), 'Hero');
  headings(hero, ['Someone else, thinking of everything.']);
  texts(hero, [
    'Aurelia is a small London studio arranging a limited book of escapes each year. We sell fewer '
    + 'trips than we are asked to. It is the only way to keep the standard.',
  ]);
  buttons(hero, [
    { label: 'Begin', href: '#enquire', variant: 'primary' },
    { label: 'All escapes by conversation', href: '#escapes', variant: 'ghost' },
  ]);
  background(hero, { src: unsplash('1573843981267-be1999ff37cd', 1800, 1200), overlay: 48, tone: 'dark' });

  const escapes = name(preset('features-cards-with-pictures'), 'Escapes');
  headings(escapes, ['Three escapes we keep going back to.']);
  texts(escapes, ["This season’s book. Every one arranged around you, not a shortlist."]);
  cards(escapes, [
    {
      label: 'Maldives, November to April',
      title: 'The lagoon at your ladder',
      body: 'Seven nights from 9,400 pounds for two. An overwater villa with the reef a step from the '
        + 'deck, and a house reef you will not want to leave.',
      src: unsplash('1573843981267-be1999ff37cd', 1100, 825),
      alt: 'Overwater villas curving into a turquoise Maldivian lagoon',
      linkLabel: 'By conversation',
      linkHref: '#enquire',
    },
    {
      label: 'Oman, October to March',
      title: 'The canyon at breakfast',
      body: 'Five nights from 6,200 pounds for two. A cliff-edge suite above a wadi, the desert on one '
        + 'side and the mountains on the other.',
      src: unsplash('1445019980597-93fa8acb246c', 1100, 825),
      alt: 'A private terrace with daybeds above a mountain valley at first light',
      linkLabel: 'By conversation',
      linkHref: '#enquire',
    },
    {
      label: 'Santorini, May to early October',
      title: 'The caldera, kept private',
      body: 'Four nights from 4,850 pounds for two. A cave suite with a plunge pool over the water, and '
        + 'the sunset without the scrum.',
      src: unsplash('1540541338287-41700207dee6', 1100, 825),
      alt: 'A clifftop resort pool overlooking the open sea',
      linkLabel: 'By conversation',
      linkHref: '#enquire',
    },
  ]);

  const promise = name(preset('features-three-icons'), 'The Aurelia way');
  headings(promise, ['Luxury is someone else thinking of everything.']);
  texts(promise, ['Three things we hold to, on every escape we arrange.']);
  iconItems(promise, [
    { icon: 'map-pin', title: 'The right place, not a shortlist', body: 'One considered recommendation, chosen from villas and suites we have slept in, with the room that gets the evening light.' },
    { icon: 'plane', title: 'Met at the aircraft door', body: 'Fast-track on arrival, a named driver, cold towels in the car. The holiday starts at the gate, not the hotel.' },
    { icon: 'phone', title: 'One person, on a direct line', body: 'Your designer, reachable day and night while you are away. When a strike closed Santorini’s port, our guests were already on a private transfer.' },
  ]);

  const word = name(preset('testimonials-one-big'), 'From a guest');
  quotes(word, [
    {
      text: 'We did not book a single restaurant, arrange a single car, or queue once in ten days. I '
        + 'have never come home from a holiday less tired.',
      attribution: 'A guest',
      role: 'Ten nights in the Maldives',
    },
  ]);

  const enquire = name(preset('contact-form-beside-details'), 'Enquire');
  headings(enquire, ['Tell us when you can get away.']);
  texts(enquire, [
    'A month, an occasion, a feeling you are after, that is enough. Your designer calls back within one '
    + 'working day, and the first conversation costs nothing.',
    'Add your enquiry form here, or drop in the Form widget.',
    'Weekdays 9 to 6, Saturdays 10 to 2.',
  ]);
  iconItems(enquire, [
    { title: 'The studio', body: '3 Milner Street, Chelsea, London SW3 2QA' },
    { title: 'By phone', body: '020 7183 4571, a person, not a menu' },
  ]);

  return [hero, escapes, promise, word, enquire];
}

/**
 * Concept 9 — Fenwick & Hale, scholarly cultural touring. A quiet hero, the
 * collection as cards, the lecturers, a tour in detail day by day, a word on
 * travelling solo, and the brochure.
 */
function fenwickHale(): Section[] {
  const hero = name(preset('hero-background'), 'Hero');
  headings(hero, ['Travel with people who can read the stones.']);
  texts(hero, [
    'Small-group cultural touring, thirty-eight years. Every tour is planned and led by a historian, '
    + 'archaeologist or writer who has spent a working life on the subject. Groups of twenty-two at '
    + 'most, two-night minimum stays, luggage handled, and solo travellers warmly welcome.',
  ]);
  buttons(hero, [
    { label: 'Order the 2027 brochure', href: '#brochure', variant: 'primary' },
    { label: 'See the collection', href: '#tours', variant: 'ghost' },
  ]);
  background(hero, { src: unsplash('1467269204594-9661b134dd2b', 1800, 1200), overlay: 50, tone: 'dark' });

  const collection = name(preset('features-cards-with-pictures'), 'The 2027 Collection');
  headings(collection, ['The 2027 Collection']);
  texts(collection, [
    'Four of the forty-three. Every tour is listed in the brochure in full, day-by-day itinerary, '
    + 'hotels named, what is included and what is not.',
  ]);
  cards(collection, [
    {
      label: 'Turkey, 9 days',
      title: 'Constantinople: The Byzantine City',
      body: 'Hagia Sophia, the land walls and the Chora mosaics, with a Byzantine historian who has led '
        + 'this tour since 2009.',
      src: unsplash('1541432901042-2d8bd64b4a9b', 1100, 825),
      alt: 'The Blue Mosque in Istanbul at first light, its minarets against a pale sky',
      linkLabel: 'In the brochure',
      linkHref: '#brochure',
    },
    {
      label: 'Greece, 12 days',
      title: 'Attica and the Peloponnese: The Classical World',
      body: 'Athens, Mycenae, Olympia and Epidaurus, paced so there is time to look, to ask, and to sit '
        + 'a while.',
      src: unsplash('1555993539-1732b0258235', 1100, 825),
      alt: 'The Parthenon on the Acropolis in Athens, columns lit by late sun',
      linkLabel: 'In the brochure',
      linkHref: '#brochure',
    },
    {
      label: 'Japan, 13 days',
      title: 'Kyoto and Nara in Autumn',
      body: 'The temples and gardens of the old capitals in the last of the maples, led by an art '
        + 'historian who knows which gate to be at by eight.',
      src: unsplash('1493976040374-85c8e12f0c0e', 1100, 825),
      alt: 'A lane in the Higashiyama district of Kyoto leading to the Yasaka pagoda',
      linkLabel: 'In the brochure',
      linkHref: '#brochure',
    },
    {
      label: 'Portugal, 8 days',
      title: 'The Douro: Wine, Baroque and the Slow River',
      body: 'Porto, the baroque churches, and three nights on the river among the terraced quintas, with '
        + 'a Master of Wine aboard.',
      src: unsplash('1555881400-74d7acaacd8b', 1100, 825),
      alt: 'The Ribeira waterfront in Porto, tiled houses above a wooden boat',
      linkLabel: 'In the brochure',
      linkHref: '#brochure',
    },
  ], '2');

  const lecturers = name(preset('text-intro'), 'The lecturers');
  headings(lecturers, ['Led by scholars, not reps.']);
  texts(lecturers, [
    'Twenty-eight lecturers travel with us. They are chosen for two things, depth of knowledge, and '
    + 'the rarer gift of wearing it lightly.',
  ]);

  const detail = name(preset('steps-itinerary'), 'A tour in detail');
  headings(detail, ['A tour in detail: A Venetian Winter']);
  steps(detail, [
    { title: 'Arrive by water', body: 'Afternoon flight, a launch to the hotel, and a first walk to the Salute before dinner together.' },
    { title: 'Torcello, before the boats fill', body: 'A private launch at 8.40am to the cathedral and its Last Judgement. Lunch at a locanda, Burano optional.' },
    { title: 'The Accademia, slowly', body: 'A morning with the Bellinis and the Carpaccios, and an afternoon that is yours.' },
    { title: 'The Doge’s Venice', body: 'The Palazzo Ducale and San Marco out of season, then a free evening in the quiet city.' },
    { title: 'Ravenna, by coach', body: 'A day among the finest Byzantine mosaics outside Istanbul, before the journey home.' },
  ]);

  const solo = name(preset('text-intro'), 'Travelling solo');
  headings(solo, ['Included means included.']);
  texts(solo, [
    'Around a third of our guests travel alone. Dinner is at shared tables from the first evening, '
    + 'rooms are proper doubles for sole use, and a growing number of departures carry no single supplement.',
  ]);

  const brochure = name(preset('cta-split'), 'The brochure');
  headings(brochure, ['156 pages. Proper paper. In the post tonight.']);
  texts(brochure, [
    'All forty-three tours with full itineraries, hotel names, honest walking notes and every '
    + 'departure date, the kind of brochure you read with a pencil.',
  ]);
  buttons(brochure, [{ label: 'Order the brochure', href: '#brochure', variant: 'primary' }]);

  return [hero, collection, lecturers, detail, solo, brochure];
}

// ---------------------------------------------------------------------------
// The registry
// ---------------------------------------------------------------------------

export interface DesignedHome {
  /** The stable id used by a PageTemplate and a Starter. */
  id: string;
  /** The name in a picker. */
  label: string;
  /** One line: the kind of agency it suits. */
  description: string;
  /**
   * The home page's search description, written as a real one and carrying no
   * token, so it reads on a brand new site with an empty profile.
   */
  blurb: string;
  /** The home page's sections, built fresh each call. */
  build: (facts: StarterFacts) => Section[];
}

export const DESIGNED_HOMES: readonly DesignedHome[] = [
  {
    id: 'windward-west',
    label: 'Island Time',
    description: 'Warm and sunlit, for a Caribbean or beach specialist.',
    blurb: 'Caribbean and beach holidays from a specialist who has stayed on the islands. Start from this homepage and make it your own.',
    build: () => windwardWest(),
  },
  {
    id: 'bucket-and-spade',
    label: 'Family Favourites',
    description: 'Bright and practical, for a family holiday specialist.',
    blurb: 'Family holidays with free child places, kids clubs checked by age and no dawn flights. Start from this homepage and make it your own.',
    build: () => bucketAndSpade(),
  },
  {
    id: 'sandpiper',
    label: 'School-Holiday Ready',
    description: 'A leaner family site, built around the priced school holidays.',
    blurb: 'Family holidays built around the school-holiday dates, priced for the whole party. Start from this homepage and make it your own.',
    build: () => sandpiper(),
  },
  {
    id: 'harbourline',
    label: 'No-Fly Cruise',
    description: 'Deep and nautical, for a cruise specialist.',
    blurb: 'No-fly cruises from Southampton, planned by itinerary with a specialist on the phone. Start from this homepage and make it your own.',
    build: () => harbourline(),
  },
  {
    id: 'fenwick-hale',
    label: 'The Grand Tour',
    description: 'Considered and scholarly, for cultural and escorted touring.',
    blurb: 'Small-group cultural tours led by scholars, planned in full before you book. Start from this homepage and make it your own.',
    build: () => fenwickHale(),
  },
  {
    id: 'peak-and-pass',
    label: 'Earn the View',
    description: 'Bold and outdoorsy, for adventure, trekking and small-group expeditions.',
    blurb: 'Small-group treks, climbs and expeditions with qualified leaders and honest grades. Start from this homepage and make it your own.',
    build: () => peakAndPass(),
  },
  {
    id: 'awaydays',
    label: 'Cheap and Cheerful',
    description: 'Loud and fast, for budget city breaks and party trips.',
    blurb: 'Cheap city breaks, beach trips and festivals, bookable with a small deposit. Start from this homepage and make it your own.',
    build: () => awaydays(),
  },
  {
    id: 'harland-vane',
    label: 'The Travel Studio',
    description: 'A studio of designers, for bespoke private travel arranged one to one.',
    blurb: 'A studio of travel designers arranging bespoke private trips, one client at a time. Start from this homepage and make it your own.',
    build: () => harlandVane(),
  },
  {
    id: 'aurelia',
    label: 'By Invitation',
    description: 'A small luxury studio, for a limited book of high-end escapes.',
    blurb: 'A small studio arranging a limited book of luxury escapes each year. Start from this homepage and make it your own.',
    build: () => aurelia(),
  },
  {
    id: 'harlow-wren',
    label: 'Quiet Couture',
    description: 'Spare and editorial, for a private-travel house that takes a few clients a year.',
    blurb: 'Private travel composed by hand, one designer to one traveller. Start from this homepage and make it your own.',
    build: () => harlowWren(),
  },
];

export function designedHomeById(id: string): DesignedHome | undefined {
  return DESIGNED_HOMES.find((home) => home.id === id);
}

/**
 * A designed home as a StarterPage, for the two doors that build one.
 *
 * Always the home page: the empty slug, in the menu as "Home", its sections
 * coming from the build hook so nothing here names a preset. The search
 * description is the home's own blurb, which reads with an empty profile because
 * it carries no token.
 */
export function designedHomeStarterPage(home: DesignedHome): StarterPage {
  return {
    title: 'Home',
    slug: '',
    menu: 'Home',
    description: home.blurb,
    sections: [],
    build: home.build,
  };
}
