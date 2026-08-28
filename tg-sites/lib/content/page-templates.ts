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
  designedHomeStarterPage,
  type StarterFacts,
  type StarterPage,
} from './starters';
import { DESIGNED_HOME_META } from './designed-homes-meta';

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

/** Services / what we offer: the range, the detail, the proof, then a nudge. */
const SERVICES_PAGE: StarterPage = {
  title: 'Services',
  slug: 'services',
  description:
    'The trips and extras {{company|we}} can arrange, and how it works from the '
    + 'first phone call to coming home. Tailor-made travel with a person on the end of it.',
  sections: [
    {
      preset: 'hero-page-banner',
      photo: 'aeroplane wing above clouds sunset',
      heading: 'What we can arrange',
      body: 'From a weekend away to the trip of a lifetime.',
    },
    {
      preset: 'text-intro',
      heading: 'The range, honestly',
      body:
        'A short paragraph on the range of what you do. Tailor-made trips, flights, '
        + 'cruises, groups, honeymoons, whatever it actually is. Saying what you do '
        + 'not do builds trust too.',
    },
    // A fuller list than the home page's three. This preset titles a row of six
    // points and has no paragraph, so a heading is set and no body.
    { preset: 'features-six-points', tone: 'subtle', heading: 'The things we look after' },
    // The two things worth explaining properly, each beside its photograph. The
    // preset's own words are prompts, so nothing is overridden.
    { preset: 'features-two-rows-alternating' },
    // Three steps and you are booked, on its own tinted band.
    { preset: 'features-three-steps-across' },
    {
      preset: 'cta-split',
      tone: 'light',
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
      // Scenery, not stock faces: the real faces are the client's to add below.
      preset: 'hero-page-banner',
      photo: 'sunlit harbour cafe morning',
      heading: 'The people behind the trips',
      body: 'Booking through a person, not a website.',
    },
    {
      preset: 'text-intro',
      heading: 'Why a person matters',
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
    // The statement close, lifted onto the accent band so the page ends on a
    // moment rather than trailing off in white.
    { preset: 'cta-statement', tone: 'accent', heading: 'Come and say hello' },
  ],
};

/** Reviews: an invitation, the wall of quotes, trust, a way to start their own. */
const REVIEWS_PAGE: StarterPage = {
  title: 'Reviews',
  slug: 'reviews',
  description:
    'What travellers say after booking with {{company|us}}, in their own words. '
    + 'The reason the next person picks up the phone.',
  sections: [
    {
      preset: 'hero-page-banner',
      photo: 'sunset beach walk golden hour',
      heading: 'In their own words',
      body: 'What travellers say when they come home.',
    },
    // A wall of quotes with a couple of headline numbers. It ships its own, and
    // has neither a title heading nor a paragraph to write into.
    { preset: 'testimonials-with-stats' },
    // More voices, on the tinted band so the two quote sections read as two.
    { preset: 'testimonials-rail', heading: 'More from our travellers' },
    // The trust strip, on the plain page between the tint and the accent close.
    { preset: 'features-badges', tone: 'light', body: 'Your ATOL, ABTA or trust account details.' },
    {
      preset: 'cta-centred',
      heading: 'Start your own trip',
      body: 'One line on what happens when they get in touch. No obligation, no hard sell.',
    },
  ],
};

// ---------------------------------------------------------------------------
// Destination guides, added 28 Aug 2026.
//
// A page ABOUT A PLACE, the prose frame around the facts. An adopted
// destination carries the corpus facts (flight time, currency, the climate
// year) which the site route draws for itself beside the entry; these
// templates are the words a person writes around them: the name, the feeling,
// what not to miss, and a way to ask about a trip. Four distinct shapes, so a
// country, a city and a resort do not all read as the same page reskinned.
//
// SAME RULES AS EVERY TEMPLATE. Nothing invents a place: the hero heading is a
// prompt to name it, every {{token}} carries its fallback, and a heading is set
// only where a preset has a title, a body only where it has a paragraph.
// ---------------------------------------------------------------------------

/** The standard guide: name it, why go, what not to miss, a shape for the days, ask. */
const DESTINATION_GUIDE: StarterPage = {
  title: 'Destination guide',
  slug: 'destination',
  description:
    'A guide to one place: why go, what not to miss, and how a trip might come '
    + 'together. The words around the facts, ready to make your own.',
  sections: [
    {
      preset: 'hero-page-banner',
      photo: 'coastal old town golden hour',
      heading: 'Name the place this guide is about',
      body: 'One line on why it is worth the journey.',
    },
    {
      preset: 'text-intro',
      heading: 'Why go',
      body:
        'A short paragraph on what makes this place special and who it suits, '
        + 'written like you have been. The bit a search result cannot tell them.',
    },
    {
      preset: 'features-cards-with-pictures',
      tone: 'subtle',
      heading: 'What not to miss',
      body: 'Three or four things worth building a trip around.',
    },
    {
      preset: 'steps-itinerary',
      heading: 'A few days here',
    },
    {
      preset: 'cta-centred',
      tone: 'accent',
      heading: 'Plan a trip here',
      body: 'Tell us roughly what you are after and we will put it together. No obligation.',
    },
  ],
};

/** Picture-led: a full-bleed opener, the feeling of the place, a gallery, a bold ask. */
const DESTINATION_IMMERSIVE: StarterPage = {
  title: 'Destination, picture-led',
  slug: 'destination-immersive',
  description:
    'The same guide, led by the pictures: a full-bleed opener, the feeling of '
    + 'the place, and a wall of photographs. For a destination that sells itself '
    + 'on the view.',
  sections: [
    {
      preset: 'hero-background',
      photo: 'dramatic coastline aerial blue hour',
      heading: 'The place, in one bold line',
      body: 'A short, evocative hook under the name.',
    },
    {
      preset: 'text-centred-intro',
      heading: 'The feeling of the place',
      body: 'Two sentences that set the scene. The sound of it, the light, the pace.',
    },
    { preset: 'gallery-grid', tone: 'subtle' },
    { preset: 'features-picture-beside-points' },
    {
      preset: 'cta-split',
      tone: 'accent',
      heading: 'Take me there',
      body: 'One line, one button. We will do the rest.',
    },
  ],
};

/** At a glance: a split opener, quick orientation, the highlights as a list, a statement close. */
const DESTINATION_GLANCE: StarterPage = {
  title: 'Destination, at a glance',
  slug: 'destination-at-a-glance',
  description:
    'A quicker read: the place, a short orientation, and the highlights as a '
    + 'list. Sits well above the facts panel, which answers the practical '
    + 'questions on its own.',
  sections: [
    {
      preset: 'hero-split-right',
      photo: 'sunlit street market morning',
      heading: 'The place, and the one reason to go',
      body: 'A sentence a visitor could not get anywhere else.',
    },
    {
      preset: 'text-intro',
      heading: 'Getting your bearings',
      body: 'A sentence or two to orient a visitor: where it is, when to go, the shape of a trip.',
    },
    {
      preset: 'features-six-points',
      tone: 'subtle',
      heading: 'The highlights',
    },
    { preset: 'gallery-two-up' },
    {
      preset: 'cta-statement',
      tone: 'accent',
      heading: 'Somewhere here take your eye?',
    },
  ],
};

/** Where to stay: a resort or area, who it suits, the place and the stays, then a call. */
const DESTINATION_STAY: StarterPage = {
  title: 'Where to stay',
  slug: 'where-to-stay',
  description:
    'For a resort or an area: who it suits, what the place is like and where you '
    + 'might stay, then a person to talk it through with.',
  sections: [
    {
      preset: 'hero-page-banner',
      photo: 'resort pool palm trees evening',
      heading: 'Name the resort or area',
      body: 'A line on who has the best time here.',
    },
    {
      preset: 'text-intro',
      heading: 'Who it suits',
      body:
        'A short paragraph on the kind of trip this place is for. Families, '
        + 'couples, a quiet week or a lively one. Saying who it is NOT for helps too.',
    },
    { preset: 'features-two-rows-alternating' },
    { preset: 'features-three-steps-across' },
    {
      preset: 'cta-phone',
      tone: 'accent',
      heading: 'Rather talk it through?',
      body: 'A real person who knows the place, on the end of the phone.',
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
/**
 * The ten designed homepages as add-a-page templates.
 *
 * The same designed homes the starter wizard offers as whole sites, offered
 * here as a single page a client can add to a site they have already started.
 * Each is a build page, so picking one seeds the concept's finished home
 * sections; the id is looked up server side against this closed list exactly as
 * every other template is.
 */
const DESIGNED_TEMPLATES: readonly PageTemplate[] = DESIGNED_HOME_META.map((meta) => ({
  id: `design-${meta.id}`,
  label: meta.label,
  description: meta.description,
  page: designedHomeStarterPage(meta),
}));

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
  {
    id: 'destination-guide',
    label: 'Destination guide',
    description: 'A page about one place: why go, what not to miss, a shape for the days, and a way to ask about a trip.',
    page: DESTINATION_GUIDE,
  },
  {
    id: 'destination-immersive',
    label: 'Destination, picture-led',
    description: 'The same guide led by the pictures: a full-bleed opener, the feeling of the place, and a wall of photographs.',
    page: DESTINATION_IMMERSIVE,
  },
  {
    id: 'destination-glance',
    label: 'Destination, at a glance',
    description: 'A quicker read: the place, a short orientation, and the highlights as a list, above the facts panel.',
    page: DESTINATION_GLANCE,
  },
  {
    id: 'destination-stay',
    label: 'Where to stay',
    description: 'For a resort or an area: who it suits, what the place is like and where to stay, then a person to talk it through with.',
    page: DESTINATION_STAY,
  },
  ...DESIGNED_TEMPLATES,
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
export async function pageTemplateSections(id: string): Promise<Section[] | null> {
  const template = pageTemplateById(id);
  if (!template || !template.page) return null;
  return (await buildStarterPage(template.page, BLANK_FACTS)).sections;
}

/**
 * The StarterPage behind a template id, for the photo fill.
 *
 * The fill (lib/media/photo-fill.ts) walks the SPEC beside the built sections
 * to learn which photographs each one wants, so the action that adds a page
 * needs the spec as well as the sections. Null for Blank and for an unknown
 * id, exactly as pageTemplateSections is.
 */
export function pageTemplateSpec(id: string): StarterPage | null {
  return pageTemplateById(id)?.page ?? null;
}
