import { createBlock, createRow, createSection } from './factory';
import { emptyItem, type CollectionItem } from './collection';
import { escapeHtml } from './sanitise';
import type { Block, Row, Section } from './schema';

/**
 * Turning a corpus record into the client's own destination page.
 *
 * WHAT ADOPTION PRODUCES. Not a blank page and not a stub: a finished magazine
 * spread the client can publish as it stands and then make theirs. Banner
 * photograph, the opening, what the place is actually like, the highlights, a
 * picture band, where it is on a map, what is worth doing, when to go, and a way
 * to get in touch. Every word and every picture in it comes from the corpus.
 *
 * WHY IT IS A FULL PAGE RATHER THAN A SEED OF TWO PARAGRAPHS. Andy, 25 Aug 2026:
 * a client should choose a destination and get a fully built page. The earlier
 * version dropped in the hero intro and the overview and left them to build the
 * rest, which is most of the work and exactly the part an agency has no time
 * for. The corpus already holds the material for the whole spread, so the seed
 * uses it.
 *
 * WHAT IT STILL WILL NOT DO IS WRITE FOR THEM. Everything here is seeded ONCE
 * and never synced again, so the day after adoption it is the client's page:
 * their words, their pictures, their order. That is what stops forty agencies
 * publishing the same page. The facts panel is the deliberate exception, and it
 * is not in here at all: it lives on the corpus row the item points at and the
 * renderer joins it, so a visa rule that changes changes on every site at once.
 *
 * THE SHAPE IS TENANT-NEUTRAL, THE LOOK IS NOT. Nothing here sets a colour or a
 * typeface. The bands are the section tones every theme already defines, so the
 * same seed comes out as Coastwise's bone against sea-slate on one site and as
 * somebody else's palette on the next. That is the only way one builder can
 * serve every tenant without a fork per client.
 */

/** The seedable prose an exported corpus record carries. */
export interface CorpusProse {
  tagline?: string;
  heroIntro?: string;
  overview?: string;
  /** Up to three picture URLs, https only, validated by the exporter. */
  images?: string[];
  /** Photographer credits, in the same order as the pictures. */
  credits?: string[];
  highlights?: Array<{ icon?: string; title?: string; description?: string }>;
  events?: Array<{ month?: string; name?: string; description?: string }>;
  thingsToDo?: string[];
}

/* --------------------------------------------------------------------------
 * Text
 * ----------------------------------------------------------------------- */

/**
 * Corpus text, ready to sit inside a block's `html` prop.
 *
 * ESCAPED, NOT SANITISED, AND THE DIFFERENCE MATTERS. The prose is plain text
 * written by a person into an Airtable cell, and it reaches this process over
 * the network from another deployment. It is not markup and was never meant to
 * be, so the right treatment is to make it inert rather than to decide which of
 * its tags are permissible. An ampersand in "Sun & Sand" must survive as an
 * ampersand; anything that looks like a tag must arrive as the characters
 * somebody typed. sanitiseHtml would do the opposite job, keeping markup it
 * recognised, which is the wrong answer for a field that should contain none.
 *
 * Blank lines become paragraph breaks, because that is how the prose is written
 * and a wall of text is not what the author meant.
 */
export function proseToHtml(value: unknown): string {
  if (typeof value !== 'string') return '';
  const clean = value.replace(/\r\n?/g, '\n').trim();
  if (!clean) return '';

  return clean
    .split(/\n{2,}/)
    .map((para) => para.trim())
    .filter(Boolean)
    // A single newline inside a paragraph is a soft wrap in the source, not a
    // new paragraph, so it becomes a space rather than a <br>.
    .map((para) => `<p>${escapeHtml(para.replace(/\n/g, ' '))}</p>`)
    .join('');
}

/**
 * Alt text for a corpus photograph, recovered from its credit line.
 *
 * THE CREDIT CARRIES A DESCRIPTION AND ALMOST NOBODY NOTICES. A stock credit
 * reads "Photo by Lawrence Krowdeed on Unsplash
 * (https://unsplash.com/photos/a-group-of-people-sitting-on-a-pier-next-to-a-body-of-water-G8T7njOVE6Y)",
 * and that slug is a real description of the picture written by a person. It is
 * a far better alt than the place name, which describes the page rather than the
 * image and tells a screen reader nothing it did not already have from the
 * heading.
 *
 * The trailing token is the photo id and is dropped. Falls back to the place
 * name, because empty alt on a content photograph is worse than a general one.
 */
export function altFromCredit(credit: unknown, fallback: string): string {
  const text = typeof credit === 'string' ? credit : '';
  const slug = /unsplash\.com\/photos\/([a-z0-9-]+)/i.exec(text)?.[1] ?? '';
  const words = slug.split('-').filter(Boolean);
  /*
   * Strip the opaque id off the end. Every word Unsplash puts in a slug is plain
   * lower-case, so a part carrying a capital, a digit or an underscore is the id
   * rather than the description.
   *
   * A LOOP RATHER THAN ONE POP, because the id itself can contain a hyphen and
   * therefore arrive as more than one part. "Ch-odXM4SCg" split to ["Ch",
   * "odXM4SCg"], a single pop left the "Ch", and the alt text on the Dalmatian
   * Islands banner read "...during daytime Ch".
   */
  while (words.length > 2 && /[A-Z0-9_]/.test(words[words.length - 1])) words.pop();
  const phrase = words.join(' ').trim();
  if (phrase.length < 8) return fallback;
  return phrase.charAt(0).toUpperCase() + phrase.slice(1);
}

/**
 * The corpus icon vocabulary, mapped onto the one tg-sites draws.
 *
 * TWO SETS THAT WERE NEVER GOING TO MATCH. The corpus was written for the
 * Spotlight widget in the other repo and its field help lists seventeen names
 * ("mountain", "palm", "temple"). tg-sites draws a Lucide-derived set with
 * different names for the same ideas ("mountain-snow", "palmtree"). An unmapped
 * name is not an error anywhere, it is simply a blank space where an icon should
 * be, which is why this is a table rather than a hope.
 */
const ICON_MAP: Record<string, string> = {
  mountain: 'mountain-snow',
  sunset: 'sun',
  sun: 'sun',
  wine: 'wine',
  water: 'waves',
  palm: 'palmtree',
  beach: 'umbrella',
  city: 'building-2',
  building: 'building',
  temple: 'church',
  food: 'utensils',
  star: 'star',
  heart: 'heart',
  map: 'map',
  compass: 'route',
  snowflake: 'snowflake',
  // No camera in the tg-sites set. A photograph stop is a place worth going to,
  // which is what a pin says.
  camera: 'map-pin',
};

/**
 * The short form of a destination's name, for a sentence.
 *
 * THE CORPUS NAMES A RECORD, IT DOES NOT WRITE A SENTENCE. "Split Old Town &
 * Diocletian's Palace" is exactly right as the title of the page and absurd in
 * a button: "Enquire about Split Old Town & Diocletian's Palace" is not a line
 * anybody would say out loud. Same for "Sousse & Port El Kantaoui" and
 * "Patagonia, Mendoza & the Andes".
 *
 * The first segment before an ampersand, a comma or a trailing "and" is the
 * place; what follows is the rest of the area it covers. The page title keeps
 * the full name, because that is what the destination is called.
 */
export function shortName(name: string): string {
  const first = name.split(/\s+(?:&|and)\s+|,\s*/)[0].trim();
  // Only if something is actually left. A name that is all separator keeps itself.
  return first.length >= 2 ? first : name.trim();
}

function icon(name: unknown): string {
  const key = typeof name === 'string' ? name.trim().toLowerCase() : '';
  return ICON_MAP[key] ?? 'map-pin';
}

/* --------------------------------------------------------------------------
 * Building blocks
 * ----------------------------------------------------------------------- */

function withProps(type: string, props: Record<string, unknown>): Block {
  const block = createBlock(type);
  block.props = { ...block.props, ...props };
  return block;
}

/** One full-width row holding these blocks. */
function stack(blocks: Block[]): Row[] {
  const row = createRow('1');
  row.columns[0].blocks = blocks;
  return [row];
}

/** Two columns, for a picture beside its words. */
function pair(left: Block[], right: Block[]): Row[] {
  const row = createRow('1-1');
  row.columns[0].blocks = left;
  row.columns[1].blocks = right;
  return [row];
}

function band(partial: Partial<Section> & { rows: Row[] }): Section {
  const section = createSection('1');
  return { ...section, ...partial } as Section;
}

/**
 * Alternate the paper grounds so the page bands.
 *
 * WHY THIS IS A PASS OVER THE FINISHED LIST rather than a tone written on each
 * band as it is made. Sections are skipped when the corpus has nothing for them,
 * so the neighbours are not known until the page is assembled: writing "subtle"
 * on the events band is right after a light one and wrong after another subtle
 * one, and which it gets depends on whether the record happened to have a things
 * to do list. The first version did exactly that and produced two adjacent
 * subtle bands, which is not a band at all, it is one taller band with a heading
 * stranded in the middle of it. Invisible on screen, obvious in the data.
 *
 * The dark bands are left alone. They are the picture and the closing call, and
 * they are dark because of what they are rather than because of where they fell.
 */
function alternate(sections: Section[]): Section[] {
  let previous = '';
  return sections.map((section) => {
    if (section.tone === 'dark' || section.tone === 'accent') {
      previous = section.tone;
      return section;
    }
    const tone = previous === 'light' ? 'subtle' : 'light';
    previous = tone;
    return { ...section, tone } as Section;
  });
}

function heading(text: string): Block {
  return withProps('heading', { level: 'h2', style: 'h2', html: escapeHtml(text), align: 'left' });
}

function paragraphs(html: string, size = 'm'): Block {
  return withProps('text', { html, align: 'left', size });
}

/* --------------------------------------------------------------------------
 * The page
 * ----------------------------------------------------------------------- */

/**
 * The first draft of an adopted destination: a whole magazine page.
 *
 * A SECTION IS SKIPPED RATHER THAN LEFT EMPTY whenever the corpus has nothing
 * for it. An airport carries no highlights and no overview, so it comes out as a
 * short page with a banner, a map and the facts panel, which is honest. A
 * heading with nothing underneath it reads as a fault the client has to tidy up,
 * and the whole promise here is that they do not have to.
 */
export function seedItemFromCorpus(input: {
  name: string;
  prose?: CorpusProse;
  facts?: { lat?: number; lng?: number };
}): CollectionItem {
  const prose = input.prose ?? {};
  const name = input.name.trim().slice(0, 200) || 'Untitled';
  const images = Array.isArray(prose.images) ? prose.images.filter((url) => typeof url === 'string') : [];
  const credits = Array.isArray(prose.credits) ? prose.credits : [];

  const sections: Section[] = [];

  /*
   * THE OPENING. The hero intro is the standfirst and the overview is the body,
   * which is the order they were written to be read in. Set on the page's own
   * ground rather than a band, so the banner above it is the only dark thing at
   * the top of the page.
   */
  const lead = proseToHtml(prose.heroIntro);
  const body = proseToHtml(prose.overview);
  if (lead || body) {
    sections.push(band({
      tone: 'light',
      paddingY: 64,
      rows: stack([
        ...(lead ? [paragraphs(lead, 'l')] : []),
        ...(body ? [paragraphs(body)] : []),
      ]),
    }));
  }

  /*
   * THE HIGHLIGHTS, on the alternate ground so the page bands rather than runs
   * on. Two columns, not three: five items in threes leaves a widowed row of
   * two, and three equal cards is the first thing on this client's
   * anti-reference list.
   */
  const highlights = (prose.highlights ?? []).filter((h) => h?.title && h?.description);
  if (highlights.length > 0) {
    sections.push(band({
      tone: 'light',
      paddingY: 64,
      rows: stack([
        heading('What you will remember'),
        withProps('cards', {
          source: 'typed',
          columns: '2',
          design: 'stacked',
          style: 'plain',
          lead: 'icon',
          iconAlign: 'left',
          align: 'left',
          gap: 'l',
          wholeCardLinks: false,
          items: highlights.map((entry) => ({
            src: '',
            alt: '',
            icon: icon(entry.icon),
            label: '',
            title: entry.title ?? '',
            body: entry.description ?? '',
            linkLabel: '',
            href: '',
          })),
        }),
      ]),
    }));
  }

  /*
   * A PICTURE, FULL WIDTH, WITH THE WATER MOVING. The one place the seed asks
   * for motion. Ken Burns rather than parallax because it drifts on its own
   * clock: a reader who has stopped to look at the photograph still sees it
   * move. Both are pure CSS and both are held back under prefers-reduced-motion.
   */
  if (images[1]) {
    sections.push(band({
      tone: 'dark',
      width: 'full',
      paddingY: 120,
      minHeight: 420,
      backgroundImage: images[1],
      overlay: 30,
      kenBurns: true,
      rows: stack([]),
    }));
  }

  /*
   * WHERE IT IS. The map is the product's own block: keyless, host-fixed, and it
   * takes the place name rather than the coordinates because Google resolves a
   * name to a pin more reliably than it centres on a decimal pair. The
   * coordinates go in the caption, which is where this client's design world
   * says a mono face is legitimate: a ship's log, not a label maker.
   */
  const { lat, lng } = input.facts ?? {};
  const position = typeof lat === 'number' && typeof lng === 'number'
    ? `${Math.abs(lat).toFixed(4)}° ${lat >= 0 ? 'N' : 'S'}, ${Math.abs(lng).toFixed(4)}° ${lng >= 0 ? 'E' : 'W'}`
    : '';
  sections.push(band({
    tone: 'light',
    paddingY: 64,
    rows: stack([
      heading('Where it is'),
      withProps('map', {
        address: name,
        // Wide enough to show where the place sits rather than its street plan,
        // which is the question somebody has on a destination page.
        zoom: 9,
        height: 420,
        radius: 'md',
        caption: position,
      }),
    ]),
  }));

  /*
   * WORTH DOING. A numbered list because the corpus writes it as one and the
   * order is the author's ranking, not an arbitrary sequence. Beside the third
   * picture where there is one, so the band is not a column of text on its own.
   */
  const doing = (prose.thingsToDo ?? []).filter(Boolean);
  if (doing.length > 0) {
    const list = [
      heading('Worth doing'),
      withProps('list', {
        style: 'number',
        items: doing.map((text) => ({ text })),
      }),
    ];
    sections.push(band({
      tone: 'light',
      paddingY: 64,
      rows: images[2]
        ? pair(list, [withProps('image', {
            src: images[2],
            alt: altFromCredit(credits[2], name),
            ratio: '3/4',
            fit: 'cover',
            radius: 'md',
            caption: '',
          })])
        : stack(list),
    }));
  }

  /*
   * WHEN TO GO. The month leads each one because that is what the reader is
   * scanning for, and the climate chart in the facts panel above has already
   * told them which months are worth it.
   */
  const events = (prose.events ?? []).filter((e) => e?.month && e?.name);
  if (events.length > 0) {
    sections.push(band({
      tone: 'light',
      paddingY: 64,
      rows: stack([
        heading('Worth timing a trip around'),
        /*
         * A STACKED LIST, AND IT TOOK TWO WRONG ANSWERS TO GET HERE.
         *
         * Cards first: the block leads with a picture or an icon and has no
         * third option, so three events with neither drew three cards each with
         * an empty picture frame on top. Three equal cards is also the first
         * entry on this client's anti-reference list.
         *
         * Then a table, which is genuinely the right shape for a month against
         * an event, and wrong here for a reason only the render showed: the
         * corpus descriptions run past two hundred characters, the table
         * correctly refuses to squash, and the whole band ended up scrolling
         * sideways inside its own box. Handled, but not something to put on a
         * magazine page on purpose.
         *
         * A month, a name and a paragraph is what icon-item is for. It reads
         * down, which is how somebody scans for the month that suits them, and
         * it holds at one event or at six.
         */
        ...events.map((entry) => withProps('icon-item', {
          icon: 'calendar-check',
          // The month leads, because it is the thing being scanned for.
          title: `${entry.month} \u00b7 ${entry.name}`,
          body: entry.description ?? '',
          align: 'left',
        })),
      ]),
    }));
  }

  /*
   * THE WAY IN. One button, one destination, on the dark ground the rest of the
   * site closes on. The label names the place rather than saying "enquire",
   * because a page about one destination should ask about that destination.
   */
  const short = shortName(name);
  sections.push(band({
    tone: 'dark',
    paddingY: 80,
    rows: stack([
      heading(`Thinking about ${short}?`),
      paragraphs('<p>Tell us roughly when and for how long, and we will come back with what it would take.</p>'),
      withProps('button-group', {
        align: 'left',
        buttons: [
          { label: `Enquire about ${short}`, href: '/contact', variant: 'primary', newTab: false },
        ],
      }),
    ]),
  }));

  return {
    ...emptyItem(),
    title: name,
    /*
     * The tagline is the card line and the search description, which is what
     * summary is for. Trimmed to the schema's own limit here rather than left
     * to be truncated on the way in, so what the client sees in the editor is
     * what was stored rather than a longer string that quietly lost its end.
     */
    summary: typeof prose.tagline === 'string' ? prose.tagline.trim().slice(0, 400) : '',
    /*
     * The banner photograph. The entry's own picture rather than a section
     * background, because the "Picture first" entry layout exists for exactly
     * this and draws the title over it.
     */
    image: images[0] ?? '',
    alt: images[0] ? altFromCredit(credits[0], name) : '',
    sections: alternate(sections),
  };
}
