/**
 * The whole-page starters a client can pick when they add a page (Andy, 14 Aug
 * 2026: page templates, ready-made pages first, AI from a brief later).
 *
 * A PAGE TEMPLATE NAMES AN EXISTING PAGE, it does not restate one. The designed
 * pages already exist in lib/content/starters.ts, proven by the whole-site
 * StarterWizard: a Home, a Holidays page, an About us and a Contact, each a stack
 * of designed section presets. This exposes those same pages one at a time for
 * the Add page flow, so a template and the site starter can never drift, and
 * improving a preset improves both. Same load-bearing decision as the starters
 * and the presets before them: name the thing, do not copy its markup.
 *
 * THE SECTIONS ARE BUILT WITH BLANK FACTS ON PURPOSE. Every {{token|fallback}}
 * resolves to its fallback, and the starter copy is written so the fallback is a
 * readable prompt ("Say in two sentences what you arrange and who for"). So a
 * client picking Home gets the shape and the prompts to fill in, never an
 * invented company name, town or speciality on their own site.
 */

import type { Section } from './schema';
import { STARTERS, buildStarterPage, type StarterFacts, type StarterPage } from './starters';

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

export interface PageTemplate {
  id: string;
  label: string;
  /** One line in the picker: what the page is for. */
  description: string;
  /** The StarterPage this builds, or null for a blank page. */
  page: StarterPage | null;
}

/**
 * Blank first, then the four Andy confirmed on 14 Aug 2026. More pages are a
 * data edit here: name a slug the agency starter already builds.
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
    id: 'holidays',
    label: 'Holidays',
    description: 'An intro, the places you know well, how it works, and a prompt to ask for the rest.',
    page: agencyPage('holidays'),
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
