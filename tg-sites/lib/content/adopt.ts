import { createBlock, createRow, createSection } from './factory';
import { emptyItem, type CollectionItem } from './collection';
import { escapeHtml } from './sanitise';
import type { PhotoTarget } from './photo-plan';
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

/**
 * Two columns, weighted, for a picture beside its words.
 *
 * SIXTY FORTY, NOT FIFTY FIFTY, because that is what the site this seed has to
 * live on already does: every two-column row in the Coastwise build is 60/40 or
 * 70/30. Equal halves read as a grid rather than as a column of text with
 * something beside it, and a picture given the same width as the words competes
 * with them instead of supporting them.
 */
function pair(left: Block[], right: Block[]): Row[] {
  const row = createRow('60-40');
  row.columns[0].blocks = left;
  row.columns[1].blocks = right;
  return [row];
}

/**
 * One band of the page.
 *
 * NAMED, AND THAT IS NOT COSMETIC. Every section in the hand-built Coastwise
 * site carries a name, because the name is what the client sees in the editor's
 * section list. An unnamed band shows up as its first block's summary, so a page
 * of seven of them reads as a list of half-sentences and nobody can find the
 * one they want to change. A seed that is meant to be edited has to be
 * navigable.
 *
 * REVEAL ON BY DEFAULT, again following the build: 44 of its sections use it.
 * Free under prefers-reduced-motion, since the CMS blocks all honour it.
 */
function band(partial: Partial<Section> & { rows: Row[]; name: string }): Section {
  const section = createSection('1');
  return { reveal: true, ...section, ...partial } as Section;
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
export interface Seeded {
  item: CollectionItem;
  /**
   * The picture slots, for lib/media/photo-fill.ts to resolve and write in.
   *
   * Returned rather than filled here so this module stays pure and testable
   * without a network, exactly the split lib/content/photo-plan.ts draws for the
   * starter build: this half decides WHAT is wanted, the server half fetches it.
   */
  photos: PhotoTarget[];
}

export function seedItemFromCorpus(input: {
  name: string;
  prose?: CorpusProse;
  facts?: { lat?: number; lng?: number };
}): Seeded {
  const prose = input.prose ?? {};
  const name = input.name.trim().slice(0, 200) || 'Untitled';

  /*
   * WHAT EACH PICTURE SLOT ASKS THE PHOTO LIBRARY FOR.
   *
   * Andy, 25 Aug 2026: the images should be our stock or AI generated. The
   * corpus carries hotlinked stock URLs and they are the wrong thing to put on a
   * client's site twice over: the provider sees every visitor, and a hotlinked
   * file gets no responsive variants, so it arrives without the srcSet every
   * hand-placed picture on the site has.
   *
   * So the slots are planned here and filled by the same importer a starter or a
   * template uses (lib/media/photo-fill.ts), which copies the file into the
   * tenant's own media, measures it, keeps the photographer's credit and carries
   * their description as the alt text.
   *
   * THE SECONDARY QUERIES COME FROM THE HIGHLIGHTS rather than from a modifier
   * bolted onto the place name. "Hvar coastline" is a guess; "Pakleni Islands"
   * is a real thing the corpus already wrote about this place, so the picture
   * has some chance of showing what the page is discussing.
   */
  const photos: PhotoTarget[] = [];
  const highlightTitles = (prose.highlights ?? [])
    .map((h) => (typeof h?.title === 'string' ? h.title.trim() : ''))
    .filter(Boolean);
  const query = (n: number) => highlightTitles[n] ?? name;

  const sections: Section[] = [];

  /*
   * THE BANNER, BUILT THE WAY EVERY OTHER PAGE ON THIS KIND OF SITE BUILDS ONE.
   *
   * A section with the photograph behind it, its own breadcrumb trail, an
   * h1-styled heading and one line of copy. Taken from the hand-built pages
   * rather than designed here, down to the scrim strength and the height.
   *
   * WHY IT IS NOT THE ENTRY'S OWN HEADER. That header is blog furniture, drawn
   * from the row: a bare title in its own type treatment, a byline and a reading
   * time. Beside pages that open like this it read as a different page: the type
   * did not match, the automatic breadcrumb trail sat above the picture instead
   * of inside it, and a page about an island announced "3 min read". The header
   * stands down when the content carries its own h1, which is what this section
   * gives it. See carriesOwnBanner in collection-layout.ts.
   *
   * THE TRAIL IS A BLOCK HERE ON PURPOSE. The published route draws a trail
   * automatically between the header and the content, and a breadcrumbs block
   * does not add a second one, it MOVES that one. So putting it inside the
   * banner is what takes it off the top of the page.
   */
  sections.push(band({
    name: 'Banner',
    tone: 'dark',
    width: 'contained',
    paddingY: 'xl' as unknown as number,
    minHeight: 420,
    overlay: 45,
    // A reveal on the thing somebody lands on would fade in the page's own title.
    reveal: false,
    backgroundImage: '',
    kenBurns: true,
    rows: stack([
      withProps('breadcrumbs', { separator: 'slash', showHome: true, size: 's', align: 'left' }),
      withProps('heading', {
        // An h2 set at h1 size, exactly as the built pages do it: one h1 per
        // document belongs to the page, and the route already emits it.
        level: 'h2',
        style: 'h1',
        align: 'left',
        html: escapeHtml(name),
      }),
      ...(typeof prose.tagline === 'string' && prose.tagline.trim()
        ? [paragraphs(`<p>${escapeHtml(prose.tagline.trim())}</p>`)]
        : []),
    ]),
  }));
  photos.push({ query: name, section: sections.length - 1, place: { kind: 'background' } });

  /*
   * THE PLACE. The hero intro is the standfirst and the overview is the body,
   * which is the order they were written to be read in. A picture sits beside
   * them where the corpus has a second one, weighted 60/40 the way every
   * two-column row on this kind of site is.
   */
  const lead = proseToHtml(prose.heroIntro);
  const body = proseToHtml(prose.overview);
  if (lead || body) {
    const words = [
      ...(lead ? [paragraphs(lead, 'l')] : []),
      ...(body ? [paragraphs(body)] : []),
    ];
    sections.push(band({
      name: 'The place',
      tone: 'light',
      paddingY: 'xl' as unknown as number,
      rows: pair(words, [withProps('image', {
        src: '', alt: '', ratio: '3/4', fit: 'cover', radius: 'md',
      })]),
    }));
    photos.push({
      query: query(0),
      section: sections.length - 1,
      place: { kind: 'image', row: 0, column: 1, block: 0 },
    });
  }

  /*
   * THE HIGHLIGHTS. Two columns, not three: five items in threes leaves a
   * widowed row of two, and three equal cards is the first entry on this kind of
   * client's anti-reference list.
   */
  const highlights = (prose.highlights ?? []).filter((h) => h?.title && h?.description);
  if (highlights.length > 0) {
    sections.push(band({
      name: 'Highlights',
      tone: 'light',
      paddingY: 'xl' as unknown as number,
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
            src: '', alt: '', icon: icon(entry.icon), label: '',
            title: entry.title ?? '', body: entry.description ?? '',
            linkLabel: '', href: '',
          })),
        }),
      ]),
    }));
  }

  /*
   * A PICTURE, FULL WIDTH, WITH THE WATER MOVING. Ken Burns rather than
   * parallax because it drifts on its own clock: a reader who has stopped to
   * look at the photograph still sees it move. Both are pure CSS and both are
   * held back under prefers-reduced-motion.
   */
  /*
   * NOT WHEN IT WOULD LAND AGAINST THE BANNER. Both are dark photographs, so
   * with no opening prose between them the page opened with two picture bands
   * running together and the seam disappeared. A record thin enough to do that
   * does not need a second full-width photograph anyway.
   */
  if ((sections[sections.length - 1] as { tone?: string }).tone !== 'dark') {
    sections.push(band({
      name: 'The wide view',
      tone: 'dark',
      width: 'full',
      paddingY: 'xl' as unknown as number,
      minHeight: 420,
      backgroundImage: '',
      overlay: 30,
      kenBurns: true,
      // Nothing to reveal, and a reveal on a band with no words is a band that
      // fades in for no reason.
      reveal: false,
      rows: stack([]),
    }));
    photos.push({ query: query(1), section: sections.length - 1, place: { kind: 'background' } });
  }

  /*
   * WHERE IT IS. The map takes the place name rather than the coordinates,
   * because a name resolves to a pin more reliably than a decimal pair centres.
   * The coordinates go in the caption, which is where a mono face is legitimate
   * on a site like this: a ship's log, not a label maker.
   */
  const { lat, lng } = input.facts ?? {};
  const position = typeof lat === 'number' && typeof lng === 'number'
    ? `${Math.abs(lat).toFixed(4)}\u00b0 ${lat >= 0 ? 'N' : 'S'}, ${Math.abs(lng).toFixed(4)}\u00b0 ${lng >= 0 ? 'E' : 'W'}`
    : '';
  sections.push(band({
    name: 'Where it is',
    tone: 'light',
    paddingY: 'xl' as unknown as number,
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

  /* WORTH DOING. Numbered because the corpus ranks them, and the order is the
     author's judgement rather than an arbitrary sequence. */
  const doing = (prose.thingsToDo ?? []).filter(Boolean);
  if (doing.length > 0) {
    sections.push(band({
      name: 'Worth doing',
      tone: 'light',
      paddingY: 'xl' as unknown as number,
      rows: stack([
        heading('Worth doing'),
        withProps('list', { style: 'number', items: doing.map((text) => ({ text })) }),
      ]),
    }));
  }

  /*
   * WHEN TO GO. A month, a name and a paragraph is a list, not a table and not
   * cards: cards lead with a picture or an icon and have no third option, and a
   * table refuses to squash so a two-hundred-character cell scrolls the band
   * sideways. Both were tried on the page before this shape stuck.
   */
  const events = (prose.events ?? []).filter((e) => e?.month && e?.name);
  if (events.length > 0) {
    sections.push(band({
      name: 'When to go',
      tone: 'light',
      paddingY: 'xl' as unknown as number,
      rows: stack([
        heading('Worth timing a trip around'),
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
   * THE WAY IN, built the way the rest of this kind of site closes: centred,
   * on a paper ground, with the way to book first and the way to ask second.
   *
   * THE HEADING CARRIES NO PLACE NAME. "Thinking about Hvar?" reads fine and
   * "Thinking about Dalmatian Islands?" does not: a plural or a region wants
   * "the" in front of it, and which names take an article is not something a
   * rule can know. The corpus holds "The Azores" and "Dalmatian Islands" and
   * both are right. The button names the place instead, because a label is the
   * one place English lets you drop the article without it grating.
   */
  const short = shortName(name);
  sections.push(band({
    name: 'Closing',
    tone: 'light',
    paddingY: 'xl' as unknown as number,
    rows: stack([
      withProps('heading', {
        level: 'h2', style: 'h2', align: 'centre',
        html: escapeHtml('Ready when you are.'),
      }),
      withProps('button-group', {
        align: 'centre',
        buttons: [
          { label: `Enquire about ${short}`, href: '/contact', variant: 'primary', newTab: false },
          { label: 'Talk to us', href: '/contact', variant: 'secondary', newTab: false },
        ],
      }),
    ]),
  }));

  const item: CollectionItem = {
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
    /*
     * The card picture and the og:image are filled in by the caller once the
     * banner's photograph has been imported, since it is the same file.
     */
    image: '',
    alt: '',
    sections: alternate(sections),
  };

  return { item, photos };
}
