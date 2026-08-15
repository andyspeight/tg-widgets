/**
 * The whole-page starters a client can pick when they add a page (Andy, 14 Aug
 * 2026: page templates, ready-made pages first, AI from a brief later; more
 * pages 15 Aug).
 *
 * A PAGE TEMPLATE NAMES SECTIONS, it does not restate them. Two kinds sit here
 * and both obey that rule:
 *
 *  - The site pages the whole-site starter already builds (Home, Holidays, About
 *    us, FAQ, Contact). These NAME an existing StarterPage in lib/content/
 *    starters.ts, the same defs the StarterWizard ships, so a template and the
 *    site starter can never drift and improving a preset improves both.
 *
 *  - Extra pages a single-page add wants that the five-page site does not
 *    include (Services, Meet the team, Reviews). These are their own StarterPage
 *    defs BELOW, assembled from the designed section presets exactly the way a
 *    starter is. They are deliberately NOT bolted onto the agency starter, which
 *    is a chosen five-page shape the "Build me a site" wizard promises by name.
 *
 * Either way the load-bearing decision is the same one the starters and the
 * presets made before them: name the thing, do not copy its markup. A page def
 * is data that names presets, and tests/page-templates.test.ts holds the same
 * drift and placement guarantees over these pages that starters.test.ts holds
 * over the site ones.
 *
 * THE SECTIONS ARE BUILT WITH BLANK FACTS ON PURPOSE. Every {{token|fallback}}
 * resolves to its fallback, and the copy is written so the fallback is a
 * readable prompt ("Say in two sentences what you arrange and who for"). So a
 * client picking a page gets the shape and the prompts to fill in, never an
 * invented company name, town or speciality on their own site.
 */

import type { Section } from './schema';
import {
  STARTERS,
  buildStarterPage,
  type StarterFacts,
  type StarterPage,
} from './starters';

const AGENCY = STARTERS.find((starter) => starter.id === 'agency');

/**
 * A page from the full-site starter, by its address.
 *
 * Throws at module load if the slug is not there, so renaming a starter page
 * fails the build loudly rather than silently dropping a template. Picked by
 * SLUG rather than title because the address is the stable handle: the title is
 * client-facing copy that could be reworded, the slug is a route.
 */
function agencyPage(slug: string): StarterPage {
  const page = AGENCY?.pages.find((candidate) => candidate.slug === slug);
  if (!page) throw new Error(`page-templates: the agency starter has no page at "/${slug}"`);
  return page;
}

// ---------------------------------------------------------------------------
// Extra pages the five-page site does not carry, built the way a starter is.
//
// Every heading is set ONLY on a preset that has a title, every body ONLY on one
// with a paragraph, and every token names a fallback. tests/page-templates.test.ts
// enforces all three, the same checks starters.test.ts runs on the site pages.
// ---------------------------------------------------------------------------

/** Services / what we offer: the range, then how it works, then a nudge. */
const SERVICES_PAGE: StarterPage = {
  title: 'Services',
  slug: 'services',
  description:
    'The trips and extras {{company|we}} can arrange, and how it works from the '
    + 'first phone call to coming home. Tailor-made travel with a person on the end of it.',
  sections: [
    {
      preset: 'text-intro',
      heading: 'What we can arrange',
      body:
        'A short paragraph on the range of what you do. Tailor-made trips, flights, '
        + 'cruises, groups, honeymoons, whatever it actually is. Saying what you do '
        + 'not do builds trust too.',
    },
    // A fuller list than the home page's three. This preset titles a row of six
    // points and has no paragraph, so a heading is set and no body.
    { preset: 'features-six-points', heading: 'The things we look after' },
    // "How it works" over its own numbered steps is already the right words, and
    // there is no paragraph in it to write into, so nothing is overridden.
    { preset: 'features-how-it-works' },
    {
      preset: 'cta-split',
      heading: 'Not sure where to start?',
      body: 'Tell us roughly what you are after and we will point you the right way. No obligation.',
    },
  ],
};

/** Meet the team: why a person, the faces, some proof, a hello. */
const TEAM_PAGE: StarterPage = {
  title: 'Meet the team',
  slug: 'team',
  description:
    'The people you will deal with at {{company|our agency}}, and why booking a '
    + 'holiday through a person beats booking it through a website.',
  sections: [
    {
      preset: 'text-intro',
      heading: 'The people behind the trips',
      body:
        'A line or two on why it matters that a real person plans your holiday. '
        + 'This is the part a website cannot do.',
    },
    {
      preset: 'team-grid',
      heading: 'Say hello to the team',
      body: 'Faces and first names. Swap in your own and keep the titles plain.',
    },
    // A row of named quotes as proof about the people, not the trips. Titled, no
    // paragraph in it.
    { preset: 'testimonials-three', heading: 'What it is like to book with us' },
    // The preset ends the page on a statement with no paragraph, so a heading only.
    { preset: 'cta-statement', heading: 'Come and say hello' },
  ],
};

/** Reviews: an invitation, the wall of quotes, a way to start their own. */
const REVIEWS_PAGE: StarterPage = {
  title: 'Reviews',
  slug: 'reviews',
  description:
    'What travellers say after booking with {{company|us}}, in their own words. '
    + 'The reason the next person picks up the phone.',
  sections: [
    {
      preset: 'text-centred-intro',
      heading: 'In their own words',
      body: 'A short line inviting people to read on, or to add their own once they are home.',
    },
    // A wall of quotes with a couple of headline numbers. It ships its own, and
    // has neither a title heading nor a paragraph to write into.
    { preset: 'testimonials-with-stats' },
    {
      preset: 'cta-centred',
      heading: 'Start your own trip',
      body: 'One line on what happens when they get in touch. No obligation, no hard sell.',
    },
  ],
};

export interface PageTemplate {
  id: string;
  label: string;
  /** One line in the picker: what the page is for. */
  description: string;
  /** The StarterPage this builds, or null for a blank page. */
  page: StarterPage | null;
}

/**
 * Blank first, then the pages in the order a site tends to read: the spine
 * (Home, About us, Services, Holidays), then the pages that earn trust (Reviews,
 * the team, the questions), then Contact at the end. More pages are a data edit
 * here: name a slug the agency starter builds, or add a StarterPage above.
 */
export const PAGE_TEMPLATES: readonly PageTemplate[] = [
  {
    id: 'blank',
    label: 'Blank page',
    description: 'Start from an empty page and build it yourself.',
    page: null,
  },
  {
    id: 'home',
    label: 'Home',
    description: 'An opener, what you do, why people book with you, what travellers say, and a way to get in touch.',
    page: agencyPage(''),
  },
  {
    id: 'about',
    label: 'About us',
    description: 'Who you are, the team, a few numbers, and an invitation to come and say hello.',
    page: agencyPage('about'),
  },
  {
    id: 'services',
    label: 'Services',
    description: 'What you offer and how it works, from the range of trips to the steps from first call to coming home.',
    page: SERVICES_PAGE,
  },
  {
    id: 'holidays',
    label: 'Holidays',
    description: 'An intro, the places you know well, how it works, and a prompt to ask for the rest.',
    page: agencyPage('holidays'),
  },
  {
    id: 'reviews',
    label: 'Reviews',
    description: 'A wall of traveller quotes with a couple of headline numbers, and a prompt to start their own trip.',
    page: REVIEWS_PAGE,
  },
  {
    id: 'team',
    label: 'Meet the team',
    description: 'A short intro, a grid of faces and first names, and a come and say hello. The page that turns a website into someone worth ringing.',
    page: TEAM_PAGE,
  },
  {
    id: 'faq',
    label: 'FAQ',
    description: 'The questions people ask most, answered plainly, with a nudge to call. Doubles as ready-made answers for AI assistants.',
    page: agencyPage('faq'),
  },
  {
    id: 'contact',
    label: 'Contact',
    description: 'A short enquiry prompt beside your details, and a map of where to find you.',
    page: agencyPage('contact'),
  },
];

export function pageTemplateById(id: string): PageTemplate | undefined {
  return PAGE_TEMPLATES.find((template) => template.id === id);
}

/** Blank facts: every token falls back to its own written prompt. */
const BLANK_FACTS: StarterFacts = { company: '', town: '', about: '' };

/**
 * The sections for a chosen template, ready to seed a new page.
 *
 * Null for Blank, and for an unknown id, which is treated as Blank so a bad or
 * stale pick never blocks adding a page. The id is the only thing that crosses
 * from the browser, and it is looked up here against the closed list above, so
 * nothing a caller sends becomes page content except by naming a template we
 * built.
 */
export function pageTemplateSections(id: string): Section[] | null {
  const template = pageTemplateById(id);
  if (!template || !template.page) return null;
  return buildStarterPage(template.page, BLANK_FACTS).sections;
}
