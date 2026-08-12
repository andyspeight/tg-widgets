/**
 * A whole site, arranged for you, in about ten seconds.
 *
 * WHY THIS IS THE THING WORTH BUILDING, rather than more blocks. The editor has
 * 73 section presets and 11 header and footer ones, which is plenty: Elementor
 * has hundreds and that is the disease rather than the cure. What it did NOT
 * have was an answer to "I have signed up, now what", and the honest answer was
 * one blank page and a picker. Wix answers that question with 800 templates you
 * then fight for a fortnight. This answers it with four questions.
 *
 * A STARTER NAMES PRESETS, IT DOES NOT CONTAIN MARKUP. That is the load-bearing
 * decision, and it is the same one lib/content/presets.ts made about thumbnails:
 * a starter cannot build a section the library cannot, and improving a preset
 * improves every starter that uses it. Adding a third starter is a data edit,
 * and tests/starters.test.ts fails the build if a starter names a preset that
 * does not exist.
 *
 * IT KNOWS IT IS BUILDING A TRAVEL SITE, which is the whole advantage over a
 * general purpose builder. A blank CMS cannot know that a travel agency needs a
 * page saying where it sends people, a page saying who is behind the desk, and a
 * page of the questions everybody asks before parting with three thousand
 * pounds. This does, because every client on this platform is one.
 *
 * THE QUESTIONS ARE NOT A THROWAWAY FORM. Company name, town and what you do are
 * site settings, saved as settings, and they are the same three the writing
 * assistant reads, the structured data publishes and the Being found report
 * complains about when they are empty. Somebody who fills them in here never
 * types them again.
 *
 * NOTHING HERE INVENTS A FACT. Every sentence below is either about the client
 * in words they gave us, or is placeholder copy that says what to write there.
 * A starter that guessed at a speciality, an award or a destination would be
 * putting words in a travel agent's mouth on their own website.
 */

import { buildPresetSection, presetById } from './presets';
import { newId } from './factory';
import { emptyRegion, type Block, type Page, type Region, type RegionName, type Section } from './schema';

// ---------------------------------------------------------------------------
// The shape of a starter
// ---------------------------------------------------------------------------

/** One section: which preset, and what to say at the top of it. */
export interface StarterSection {
  /** An id from lib/content/presets.ts. Checked by the tests. */
  preset: string;
  /**
   * Written into the section's TITLE heading, and only if it has one.
   *
   * Not by index and not simply the first heading: see titleBlock below for the
   * bug both of those cause. Left out entirely where the preset's own words are
   * already right, which is most of the time. A starter should only override
   * where it has something better to say than the library does.
   */
  heading?: string;
  /** Written into the section's first text block, if it has one. */
  body?: string;
}

export interface StarterPage {
  title: string;
  /** The address, with no leading slash. Empty is the home page. */
  slug: string;
  /** The search description. Templated, like everything else here. */
  description: string;
  /** Whether this page goes in the menu, and what it is called there. */
  menu?: string;
  sections: StarterSection[];
}

export interface Starter {
  id: string;
  label: string;
  /** One line in the picker. What kind of business it suits. */
  description: string;
  /** What they will get, listed, so nobody is surprised by five new pages. */
  summary: readonly string[];
  /** Region preset ids. */
  header: string;
  footer: string;
  pages: readonly StarterPage[];
}

/** What we know about the business, for the templates below. */
export interface StarterFacts {
  company: string;
  town: string;
  /** One line on what they do and who for. */
  about: string;
}

// ---------------------------------------------------------------------------
// Filling in the blanks
// ---------------------------------------------------------------------------

/**
 * Replace {{company}} and friends, with the fallback the template itself names.
 *
 * EVERY TOKEN CARRIES ITS OWN FALLBACK, written as {{company|our team}}, and
 * that is not decoration. A blank company name has to leave a sentence that
 * still reads, and only the author of that sentence knows what reads there: "us"
 * works in "Booked with {{company|us}}" and is nonsense in "{{company|Our
 * agency}} has been arranging holidays since". One global default would get one
 * of those two wrong on every site with an empty profile.
 *
 * A token nobody recognises is left exactly as typed rather than blanked,
 * because a visible {{oops}} in the editor is a bug somebody reports and a
 * silently empty heading is one nobody notices.
 */
export function fill(template: string, facts: StarterFacts): string {
  const values: Record<string, string> = {
    company: facts.company.trim(),
    town: facts.town.trim(),
    about: facts.about.trim(),
  };

  return template.replace(/\{\{([a-z]+)(?:\|([^}]*))?\}\}/g, (whole, key: string, fallback?: string) => {
    if (!(key in values)) return whole;
    return values[key] || (fallback ?? '');
  });
}

/** The tokens a template may use. Exported so a test can prove nothing else is. */
export const STARTER_TOKENS = ['company', 'town', 'about'] as const;

// ---------------------------------------------------------------------------
// Building
// ---------------------------------------------------------------------------

/** The first block of a type, anywhere in a section, in reading order. */
function firstBlock(section: Section, type: string): Block | null {
  for (const row of section.rows) {
    for (const column of row.columns) {
      for (const block of column.blocks) {
        if (block.type === type) return block;
      }
    }
  }
  return null;
}

/** The heading styles that are a section's TITLE rather than a label on it. */
const TITLE_STYLES = new Set(['h1', 'h2', 'h3']);

/**
 * The heading a section's title belongs in.
 *
 * NOT SIMPLY THE FIRST ONE, and this is a bug that shipped in the first version
 * of this file and was caught by reading what it built rather than by any
 * assertion. Several presets open with a small h6 TAGLINE above the real title,
 * so "the first heading" put a whole sentence into the eyebrow and left the h2
 * saying "Everything in one place". It looked deliberate and it was wrong.
 *
 * NULL WHEN THERE IS NO TITLE-LEVEL HEADING, rather than falling back to
 * whatever heading is there. The contact preset is three h5 column labels,
 * Opening hours, Talk to somebody, Find us, and a fallback overwrote the first
 * of those with the section's title. There is nowhere sensible to put a title in
 * a section that has no title, so the starter puts it nowhere.
 *
 * A heading override that lands nowhere is drift, so tests/starters.test.ts
 * fails the build if a starter sets one on a preset with no title heading.
 */
export function titleBlock(section: Section): Block | null {
  for (const row of section.rows) {
    for (const column of row.columns) {
      for (const block of column.blocks) {
        if (block.type !== 'heading') continue;
        if (TITLE_STYLES.has(String(block.props.style))) return block;
      }
    }
  }
  return null;
}

/**
 * One section, built and then given its words.
 *
 * MUTATES THE FRESH SECTION rather than rebuilding it, because
 * buildPresetSection has already minted new ids for everything and rebuilding
 * would mint a second set. The object is one this function just created, so
 * nothing else can be holding a reference to it.
 */
function buildSection(spec: StarterSection, facts: StarterFacts): Section | null {
  const preset = presetById(spec.preset);
  // Null rather than a throw: a starter naming a preset that has been renamed
  // should cost that section, not the whole site. The tests make sure it never
  // gets that far.
  if (!preset) return null;

  const section = buildPresetSection(preset);

  if (spec.heading) {
    const heading = titleBlock(section);
    if (heading) heading.props.html = fill(spec.heading, facts);
  }

  if (spec.body) {
    const text = firstBlock(section, 'text');
    if (text) text.props.html = `<p>${fill(spec.body, facts)}</p>`;
  }

  return section;
}

/** A whole page, ready to be saved as a draft. */
export function buildStarterPage(page: StarterPage, facts: StarterFacts): Page {
  return {
    version: 1,
    id: newId('pg'),
    title: fill(page.title, facts),
    slug: page.slug,
    seo: {
      // Left to fall back to the page's own title, which is what the renderer
      // already does and what the SEO assistant is there to improve on. Writing
      // a title here would put the same words in two places from the start.
      title: '',
      description: fill(page.description, facts),
      noindex: false,
    },
    sections: page.sections
      .map((spec) => buildSection(spec, facts))
      .filter((section): section is Section => section !== null),
  };
}

/**
 * The header or footer, with a menu of the pages this starter is creating.
 *
 * THE MENU IS THE BIT THAT FEELS LIKE MAGIC and it is the cheapest thing here.
 * The nav block ships with Home, Holidays, About us and Contact hardcoded as an
 * example, so without this every new site would launch with a menu pointing at
 * three pages that do not exist. A starter knows exactly which pages it is
 * about to make, so it can write the real one.
 */
export function buildStarterRegion(
  presetId: string,
  name: RegionName,
  pages: readonly StarterPage[],
  facts: StarterFacts,
): Region {
  const preset = presetById(presetId);
  if (!preset) return emptyRegion(name);

  const section = buildPresetSection(preset);

  const items = pages
    .filter((page) => page.menu)
    .map((page) => ({ label: page.menu as string, href: `/${page.slug}`, newTab: false }));

  if (items.length > 0) {
    // Every menu in the region, not just the first: a two-tier header has a
    // slim strip of links above the main bar and both are nav blocks.
    for (const row of section.rows) {
      for (const column of row.columns) {
        for (const block of column.blocks) {
          if (block.type === 'nav') block.props.items = items.map((item) => ({ ...item }));
        }
      }
    }
  }

  void facts;
  return { ...emptyRegion(name), sections: [section] };
}

// ---------------------------------------------------------------------------
// The starters themselves
// ---------------------------------------------------------------------------

/**
 * A page of questions and answers, which is not padding.
 *
 * An accordion on a published page becomes FAQPage structured data, which is a
 * direct answer in the format an AI engine wants, and "is my money protected"
 * is exactly what somebody asks an assistant before booking. Since 1 Aug 2026
 * the visibility report flags a page that answers no questions, so a starter
 * that did not include one would be building a site its own report marks down.
 */
const FAQ_PAGE: StarterPage = {
  title: 'Frequently asked questions',
  slug: 'faq',
  menu: 'FAQs',
  description:
    'The questions people ask {{company|us}} most often, answered plainly. '
    + 'Money protection, changes, and what happens after you book.',
  sections: [
    {
      preset: 'faq-title-beside',
      heading: 'Questions we are asked most',
      body:
        'Replace these with the questions you are actually asked on the phone. '
        + 'They are the ones worth answering, and we hand them to AI assistants '
        + 'as ready-made answers.',
    },
    /*
     * A CALL TO ACTION, NOT A SECOND ACCORDION, and the reason is structural
     * rather than editorial. faqLd reads the FIRST accordion on a page and only
     * that one, because two FAQPage nodes on one page is invalid markup. So a
     * second accordion here would be questions a client wrote that no AI engine
     * would ever be handed, which is the opposite of what this page is for.
     */
    {
      preset: 'cta-split',
      heading: 'Still not sure?',
      body: 'Ring us and ask. It is usually quicker than reading.',
    },
  ],
};

const CONTACT_PAGE: StarterPage = {
  title: 'Contact us',
  slug: 'contact',
  menu: 'Contact',
  description:
    'Talk to {{company|us}} about your next trip. No obligation and no hard sell, '
    + 'just someone who knows the places you are asking about.',
  sections: [
    {
      preset: 'contact-form-beside-details',
      body:
        'Tell us roughly where you fancy and when, and we will come back to you '
        + 'with something worth reading.',
    },
    /*
     * THE MAP, NOT A SECOND SET OF CONTACT DETAILS. This page used to end with
     * contact-hours-and-phone, which repeats the address and the hours that the
     * section above it already asks for. Two goes at the same information is
     * how a contact page ends up contradicting itself the first time somebody
     * changes their phone number.
     *
     * And no heading override: "Where to find us" is already the right words.
     */
    { preset: 'contact-map-beside' },
  ],
};

export const STARTERS: readonly Starter[] = [
  {
    id: 'agency',
    label: 'A full site',
    description:
      'Five pages, a header and a footer. For an agency that wants somewhere to '
      + 'send people and something for Google and the AI engines to read.',
    summary: [
      'Home, with an opener, what you do, why people book with you and a way to get in touch',
      'Holidays, for the trips and places you sell',
      'About us, which is the page that wins the trust',
      'Frequently asked questions, which AI assistants read as ready-made answers',
      'Contact, with your address, hours and phone number',
      'A header with a menu of all five, and a footer',
    ],
    header: 'header-cta-bar',
    footer: 'footer-tinted-four',
    pages: [
      {
        title: 'Home',
        slug: '',
        menu: 'Home',
        description:
          '{{about|Tailor-made holidays put together by people who have been there.}} '
          + 'Talk to {{company|us}} about your next trip.',
        sections: [
          {
            preset: 'blank-opener',
            heading: 'Holidays worth the time off',
            body:
              '{{about|Say in two sentences what you arrange and who for. '
              + 'The useful thing first, not the welcome.}}',
          },
          {
            preset: 'features-three-icons',
            heading: 'What we do',
            body:
              'Three things you are genuinely good at. Not everything you offer, '
              + 'the three somebody would choose you for.',
          },
          {
            preset: 'features-picture-beside-points',
            heading: 'Why people book with {{company|us}}',
            body:
              'The reasons a person picks a person over a website. Replace these '
              + 'with yours and keep them specific.',
          },
          // Three quotes under a title, and no paragraph between them. The
          // quotes the preset ships with are already the advice: a named
          // customer and a real trip, rather than five anonymous stars.
          { preset: 'testimonials-three', heading: 'What our travellers say' },
          {
            // No heading: this preset is a line of words over a row of logos and
            // has no heading in it at all.
            preset: 'features-badges',
            body:
              'Your ATOL, ABTA or trust account details. This is the section that '
              + 'answers the question everybody has and nobody asks.',
          },
          {
            preset: 'cta-centred',
            heading: 'Tell us where you fancy',
            body:
              'One line on what happens when they get in touch. No obligation, '
              + 'no hard sell, in your own words.',
          },
        ],
      },
      {
        title: 'Holidays',
        slug: 'holidays',
        menu: 'Holidays',
        /*
         * A TOKEN HAS TO READ WITH A VALUE AND WITH ITS FALLBACK, which is
         * easier to get wrong than it sounds. The first version of this said
         * "the kind of trips {{company|we}} put together", which reads fine as
         * "we put together" and badly as "Someshop Travel put together". So the
         * company name only ever sits where no verb has to agree with it, and
         * it appears once rather than twice in a sentence.
         */
        description:
          'Where we can take you, and the kind of trips we put together. '
          + 'Tailor-made holidays from {{company|us}}, planned by someone who has been.',
        sections: [
          {
            preset: 'text-intro',
            heading: 'Where we can take you',
            body:
              'A paragraph on the range. If you specialise, say so here rather '
              + 'than pretending to cover everywhere.',
          },
          {
            preset: 'features-cards-with-pictures',
            heading: 'Places we know well',
            body: 'Three destinations, with a picture and a line each.',
          },
          // "How it works" over a numbered list of steps is already what this
          // preset says, and there is no paragraph in it to write into.
          { preset: 'features-how-it-works' },
          {
            preset: 'cta-split',
            heading: 'Not seeing what you want?',
            body: 'Most of what we arrange is not on this page. Ask.',
          },
        ],
      },
      {
        title: 'About us',
        slug: 'about',
        menu: 'About us',
        // "{{town|where we are}}" produced a bare "Leeds" in the middle of a
        // sentence. The preposition belongs outside the token, and the fallback
        // has to fit the same slot.
        description:
          'Who we are, why we do it, and why booking a holiday through a person '
          + 'beats booking it through a website. Based in {{town|the UK}}.',
        sections: [
          {
            preset: 'blank-about',
            heading: 'About {{company|us}}',
            /*
             * NOT the profile again. The home page opener already carries it
             * word for word, and the same paragraph on two pages of one site is
             * duplicate content that helps nobody. This asks for the LONGER
             * version, which is what an about page is for.
             */
            body:
              'The long version. How you started, what you care about, and who '
              + 'you look after. The short version is already on the home page, '
              + 'so this is the place to say more than you can there.',
          },
          {
            preset: 'team-grid',
            body:
              'Faces and first names. This is the page that turns a website into '
              + 'somebody worth ringing.',
          },
          // The preset already titles itself "A few numbers" and holds no
          // paragraph, so there is nothing here worth saying differently.
          { preset: 'features-by-the-numbers' },
          { preset: 'cta-statement', heading: 'Come and say hello' },
        ],
      },
      FAQ_PAGE,
      CONTACT_PAGE,
    ],
  },

  {
    id: 'onepage',
    label: 'One page and a way to get in touch',
    description:
      'Everything on the home page, plus a contact page. For a small agency that '
      + 'wants to be online this week and grow the site later.',
    summary: [
      'A long home page with the opener, what you do, the trust and the ask',
      'Contact, with your address, hours and phone number',
      'A header and a simple footer',
      'You can add more pages whenever you like',
    ],
    header: 'header-phone-cta',
    footer: 'footer-centred-social',
    pages: [
      {
        title: 'Home',
        slug: '',
        menu: 'Home',
        description:
          '{{about|Tailor-made holidays put together by people who have been there.}} '
          + 'Talk to {{company|us}} about your next trip.',
        sections: [
          {
            preset: 'blank-opener',
            heading: 'Holidays worth the time off',
            body:
              '{{about|Say in two sentences what you arrange and who for. '
              + 'The useful thing first, not the welcome.}}',
          },
          {
            preset: 'features-three-icons',
            heading: 'What we do',
            body: 'The three things somebody would choose you for.',
          },
          {
            preset: 'blank-image-and-words',
            heading: 'Who we are',
            // NOT the profile again: the opener at the top of this same page
            // already carries it word for word.
            body:
              'A few sentences about the people behind the desk. On a one page '
              + 'site this is the whole about page, so it is worth the effort.',
          },
          // One quote, no heading and no paragraph. Nothing for a starter to
          // say here that the quote does not say better.
          { preset: 'testimonials-one-big' },
          // A title straight onto the accordion, with no paragraph in between.
          { preset: 'faq-simple', heading: 'Questions we are asked most' },
          { preset: 'features-badges', body: 'Your ATOL, ABTA or trust account details.' },
          {
            preset: 'cta-centred',
            heading: 'Tell us where you fancy',
            body: 'No obligation and no hard sell. Just a conversation.',
          },
        ],
      },
      CONTACT_PAGE,
    ],
  },
];

export function starterById(id: string): Starter | undefined {
  return STARTERS.find((starter) => starter.id === id);
}
