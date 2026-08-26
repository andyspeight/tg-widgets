/**
 * The page builder's engine: the prompt it sends, and the safety net that turns
 * whatever the model says back into a real page made of our own sections.
 *
 * SPLIT FROM THE ACTION, exactly like the section builder (lib/ai/section-build.ts).
 * The action (app/actions/ai.ts) owns the money and the membership and makes the
 * one network call. Everything here is pure, so it is the part testable without a
 * login, a database or a penny spent.
 *
 * WHY A PAGE PLAN, NOT PAGE MARKUP. A model asked to emit a whole page of blocks
 * is a model asked to get forty things right at once, and every one it invents is
 * something the normaliser has to catch. So it is asked for far less: an ORDERED
 * LIST OF OUR DESIGNED SECTIONS, by id, each with a heading and a short paragraph
 * in the house voice. That is the same {preset, heading?, body?} shape a template
 * uses (lib/content/page-templates.ts), and buildStarterPage turns it into real,
 * already-valid sections. The model chooses from a closed vocabulary and writes
 * words; it cannot reach the page any other way.
 *
 * THE COPY IS ESCAPED BEFORE IT BECOMES A HEADING. buildSection writes a heading
 * straight into a block's html and wraps a body in one <p>, so the model's words
 * are escaped here first (escape-first, the same rule lib/ai/copy.ts follows), and
 * the whole page goes through parse + sanitise when it is saved. Belt and braces.
 */

import { escapeHtml } from '../content/sanitise';
import type { Section } from '../content/schema';
import { PAGE_PRESETS } from '../content/presets-page';
import {
  buildStarterPage,
  type StarterFacts,
  type StarterSection,
} from '../content/starters';
import { extractJson } from './section-build';
import { HOUSE_RULES, profileBlock } from './prompt';
import { toText } from './copy';
import type { SiteSettings } from '../settings/schema';

/** The brief cap, applied here and again at the action boundary. */
export const MAX_PAGE_BRIEF = 800;

/** The most sections a built page may have, so a runaway plan cannot land. */
export const MAX_PLAN_SECTIONS = 12;

/** Long enough for a plan of eight sections with copy, capped so it cannot run away. */
/**
 * A ceiling that has to cover the THINKING as well as the answer.
 *
 * Same correction as SITE_BUILD_MAX_TOKENS, for the same reason and on the
 * same model: no `thinking` parameter is sent, so adaptive thinking is on and
 * is charged here. 4096 was sized for the visible output alone, which is the
 * cap that returned an empty answer on the planner once a prompt got harder.
 */
export const PAGE_BUILD_MAX_TOKENS = 8192;

/**
 * Every page-section preset id, as a set, so a model that names something outside
 * the catalogue (a header, a footer, a preset that has been renamed, a made-up
 * id) is dropped rather than trusted. PAGE_PRESETS is page scope only, so site
 * chrome cannot land in the middle of a page.
 */
/**
 * Presets an AI BUILD may not choose, because their content can only be true.
 *
 * Found by scanning the presets rather than by naming them, so a new
 * testimonial or stats preset is excluded the day it is written. Three kinds:
 *
 *   QUOTES. Every quote block in the library is a factory testimonial from
 *   "A customer" — "We have used them four times now and I would not go
 *   anywhere else." On a template a person fills in, that is an example. On a
 *   page a builder hands over finished, it is a fabricated review on a real
 *   company's website.
 *
 *   STATS. "4.9/5 across 300 reviews", "12,000 holidays booked", "100% ATOL
 *   protected" — invented numbers, and the last one is an invented protection
 *   claim, which is the single worst thing this feature could publish.
 *
 *   LOGOS. The badge strips deliberately ship EMPTY (a badge is never a
 *   placeholder), so on a built page they render as "Add your badges" over
 *   trust copy like "Your money is protected. Here is who by." — a claim with
 *   a hole where the evidence goes.
 *
 *   The testimonial RAIL carries its quotes inside a slider block, which is why
 *   the category is checked as well as the block types.
 *
 * These sections are not gone from the product: a client can add them by hand
 * and fill them with their real reviews, real numbers and real memberships.
 * They are gone from what a machine is allowed to assert on a client's behalf.
 */
const FABRICATION_BLOCKS = new Set(['quote', 'stats', 'logos', 'table']);
/*
 * PRICING AND BANNERS JOINED THE LIST after the review round. The pricing
 * presets ship "From £549 / £699 / £899" with invented inclusions, and a
 * banner's whole reason to exist is an announcement — the factory one reads
 * "Book by 31 August and the deposit is half price", a fabricated dated offer.
 * A machine has no prices and no announcements; both are the client's alone.
 * Tables ride along in FABRICATION_BLOCKS because the only tables in the
 * library are price grids.
 */
const FABRICATION_CATEGORIES = new Set(['testimonials', 'stats', 'logos', 'pricing', 'banner']);

function needsRealContent(preset: (typeof PAGE_PRESETS)[number]): boolean {
  if (FABRICATION_CATEGORIES.has(preset.category)) return true;
  return preset.rows.some((row) =>
    row.columns.some((column) => column.some((block) => FABRICATION_BLOCKS.has(block.type))),
  );
}

/** The presets the model may build from: the library minus what must be true. */
export const BUILDABLE_PRESETS = PAGE_PRESETS.filter((preset) => !needsRealContent(preset));

const PAGE_PRESET_IDS = new Set(BUILDABLE_PRESETS.map((preset) => preset.id));

/** Blank facts: an AI page names no company, so no {{token}} needs a real value. */
const BLANK_FACTS: StarterFacts = { company: '', town: '', about: '' };

// ---------------------------------------------------------------------------
// The prompt
// ---------------------------------------------------------------------------

/**
 * The catalogue the model chooses from, built from the live registry so it never
 * drifts. Grouped by category, because a model picking a varied page reads better
 * from "here are the heroes, here are the feature layouts" than from a flat list.
 */
export function pageCatalogue(): string {
  const byCategory = new Map<string, string[]>();
  for (const preset of BUILDABLE_PRESETS) {
    const line = `- ${preset.id}: ${preset.label}. ${preset.description}`;
    const list = byCategory.get(preset.category) ?? [];
    list.push(line);
    byCategory.set(preset.category, list);
  }

  const blocks: string[] = [];
  for (const [category, lines] of byCategory) {
    blocks.push(`${category.toUpperCase()}\n${lines.join('\n')}`);
  }
  return blocks.join('\n\n');
}

/** What the page builder is, over the house voice. The travel-and-structure layer. */
export const PAGE_RULES = `Your job here is to DESIGN ONE PAGE of a travel company's website, by choosing an ordered list of ready-made sections from the catalogue below and writing the words for each.

You are building for a travel business: an agency, a tour operator or a travel adviser. So think like one.
- These sites sell an ENQUIRY, not a checkout. The natural call to action is "Start an enquiry", "Talk to us", "Get a quote", never "Buy now".
- Trust is the currency: ABTA and ATOL protection, years in business, real people who have been to the places.
- The subject is places and trips. Keep it concrete.
- Invent no facts. No company name, location, price, award or number that the brief and the profile did not give you. Write around what you do not have.

How to plan a page:
- Choose 4 to 8 sections that form a coherent page. Usually open with a hero or opener, put the substance in the middle, and end with a way to get in touch.
- Pick section ids ONLY from the catalogue. Use each id at most once unless a repeat genuinely helps.
- Order matters: the list is the order the sections appear down the page, top to bottom.
- For each section, write a "heading" (its title, one line, in the house voice, grounded in the brief) and, where a paragraph suits it, a short "body" of one or two sentences. Leave "body" out for a section that is a row of points, a set of logos or a bare call to action. Leave "heading" out to keep the section's own wording.
- Give each section a "photo": two or three words naming what a photograph behind it should SHOW. Name the real subject, so a page about Barbados says "Barbados beach villa" and not "travel" or "holiday". This is a search against a stock library, so it wants a thing that can be photographed, not a mood: "Antigua harbour at dusk" finds pictures, "unforgettable memories" does not.`;

/** The output contract, so the model returns a JSON array and only that. */
export const PAGE_OUTPUT_SHAPE = `Return a JSON array and NOTHING else. No prose before or after, no markdown fences. Each item is one section, in the order it appears down the page:

[
  { "preset": "<an id from the catalogue>", "heading": "the section title", "body": "one or two sentences, or omit", "photo": "what a picture here shows" },
  { "preset": "<another id>", "heading": "..." }
]

"preset" is required and must be one of the catalogue ids exactly. "heading" and "body" are optional plain text, no markup. Give EVERY section a "photo": a section without one falls back to stock imagery chosen for nobody's page.`;

/** The system prompt: house voice, the builder's job, the catalogue, the shape, the brand. */
export function buildPageSystemPrompt(settings: SiteSettings): string {
  return [
    HOUSE_RULES,
    PAGE_RULES,
    `SECTIONS you may use:\n${pageCatalogue()}`,
    PAGE_OUTPUT_SHAPE,
    profileBlock(settings),
  ].join('\n\n');
}

/**
 * The brief the person typed, capped and stripped of our own prompt tags.
 *
 * When a picture is attached (slice 2), the model is told to read it and to open
 * with a hero so the photo has somewhere to sit. The brief becomes optional then:
 * an image on its own is a brief a model can work from.
 */
export function buildPageUserPrompt(brief: string, hasImage = false): string {
  const clean = brief.replace(/<\/?(company|tone|avoid|copy|request)>/gi, '').trim().slice(0, MAX_PAGE_BRIEF);
  const parts: string[] = [];

  if (hasImage) {
    parts.push(
      'A photograph has been provided with this request. Read it: let what it shows and its mood guide the KIND of page you design and the words you write. The photo will be placed behind the opening section, so open the page with a hero or a bold opener that reads well as a full-width band behind a picture.',
    );
  }

  if (clean) {
    parts.push(`Design this page:\n\n<request>\n${clean}\n</request>`);
  } else if (hasImage) {
    parts.push('Design a page that suits the photograph provided.');
  } else {
    parts.push('Design a page.');
  }

  return parts.join('\n\n');
}

/** The follow-up when the first answer would not parse. One repair, then stop. */
export function repairPagePrompt(reason: string): string {
  return `That was not valid. ${reason}\n\nSend the page again as a JSON array only, in the exact shape you were given, using only the listed section ids.`;
}

// ---------------------------------------------------------------------------
// The normaliser
// ---------------------------------------------------------------------------

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/**
 * The model's answer to a validated {preset, heading?, body?} plan, or a reason
 * it could not be.
 *
 * Lenient about the wrapper (a bare array, or {sections|page|plan: [...]}), strict
 * about everything inside: a preset id not in the catalogue is dropped, and every
 * heading and body is run to plain text and escaped, so nothing the model wrote
 * can arrive as markup when buildSection puts it into a block.
 */
export type PlanResult =
  | { ok: true; plan: StarterSection[] }
  | { ok: false; error: string };

export function planFromModel(answer: unknown): PlanResult {
  const parsed = typeof answer === 'string' ? extractJson(answer) : answer;
  if (parsed == null) return { ok: false, error: 'the answer was not JSON' };

  const root = Array.isArray(parsed)
    ? parsed
    : (() => {
        const record = asRecord(parsed);
        for (const key of ['sections', 'page', 'plan', 'items']) {
          if (Array.isArray(record[key])) return record[key] as unknown[];
        }
        return [];
      })();

  const plan: StarterSection[] = [];
  for (const raw of root) {
    if (plan.length >= MAX_PLAN_SECTIONS) break;
    const item = asRecord(raw);
    const preset = typeof item.preset === 'string' ? item.preset : '';
    // The one gate that matters: an id we did not build is not a section.
    if (!PAGE_PRESET_IDS.has(preset)) continue;

    const spec: StarterSection = { preset };
    // toText strips any markup and markers to plain words; escapeHtml then makes
    // even a stray angle bracket inert, since buildSection writes a heading raw
    // into html. A heading that comes back empty is simply left off.
    const heading = escapeHtml(toText(item.heading));
    if (heading) spec.heading = heading;
    const body = escapeHtml(toText(item.body));
    if (body) spec.body = body;

    /*
     * The photograph's SUBJECT, not its copy, so it is not escaped: it becomes a
     * search term against the stock library and never reaches a page as markup.
     * Capped because a search term is two or three words and a sentence here is
     * a query that finds nothing.
     */
    const photo = toText(item.photo).slice(0, 60).trim();
    if (photo) spec.photo = photo;

    plan.push(spec);
  }

  if (plan.length === 0) return { ok: false, error: 'none of the sections were ones you can use' };
  return { ok: true, plan };
}

/**
 * A validated plan to real sections.
 *
 * Reuses buildStarterPage, the same builder templates go through: each spec's
 * preset is built fresh with new ids, the heading is written into the section's
 * title (and only if it has one), the body into its first paragraph (and only if
 * it has one). A heading or body with nowhere to go is silently dropped, so a bad
 * pick costs that wording, not the build. The page's own title and address are set
 * by the action from what the client named it, so blanks here are fine.
 */
/**
 * The copy a preset ships with to show an author what goes where.
 *
 * NOT A STYLE LIST AND NOT A BLOCKLIST OF BAD WRITING. Every one of these is a
 * literal string in lib/content/presets-page.ts, written as an instruction to
 * the person filling the preset in. They are fine in the editor, where somebody
 * is about to replace them, and they are not fine on a page a builder just
 * produced and handed over.
 */
const PLACEHOLDER_COPY: readonly string[] = [
  'add title here',
  'add your medium length title here',
  'add your title here',
  'an intro title here',
  'tagline here',
  'this is a short title',
  'this is a title',
  'write down an introduction title here',
  'write the opening title here',
  'a line or two on what this is and why it matters.',
  'another one. three or four of these is usually enough.',
  'the answer, in a sentence or two. short answers get read.',
  'their role, and a sentence or two on what they know.',
  'add the enquiry or form widget below this line and delete this paragraph.',
  'add the maps widget here and delete this paragraph.',
  'add the enquiry widget below this line and delete this paragraph.',
  'one line saying what these have in common.',
];

/** The words a block shows, with any markup taken off. */
function visibleText(block: { props?: Record<string, unknown> }): string {
  const props = block.props ?? {};
  const raw = typeof props.html === 'string' ? props.html : '';
  return raw.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * Take out the preset copy the builder never filled in.
 *
 * WHY THIS IS NEEDED AT ALL. buildSection writes exactly two things: the plan's
 * heading into the section's title, and its body into the first paragraph.
 * Everything else a preset contains keeps the factory copy, so a section with a
 * tagline, three feature items or a list of questions arrives with a real
 * headline sitting on top of "This is a short title" and "Another one. Three or
 * four of these is usually enough."
 *
 * Andy, 26 Aug 2026, on the first full site the builder produced: "it's very
 * poor. No images. Placeholder text. Short pages." Nine of the twelve pages
 * carried at least one of these.
 *
 * THE BACKSTOP, AND IT RUNS LAST. lib/ai/page-fill.ts now writes every slot, so
 * most of these are replaced before this ever sees them. What is left is what
 * the fill could not reach: a slot past the cap, a page whose fill call failed,
 * a block the model skipped. Better a shorter page than one carrying
 * instructions to the author, which tells a client the tool does not work.
 *
 * ORDER MATTERS AND IT BIT ME. This lived inside sectionsFromPlan first, which
 * put it BEFORE the fill and deleted the very slots the fill existed to write.
 *
 * Conservative on purpose: it removes a block whose whole visible text IS one of
 * these, never one that merely contains a phrase, so real copy that happens to
 * echo a placeholder survives. Emptied columns, rows and sections go with it,
 * since an empty band is its own kind of broken.
 */
export function stripPlaceholders(sections: Section[]): Section[] {
  const kept: Section[] = [];

  for (const section of sections) {
    const rows = section.rows
      .map((row) => ({
        ...row,
        columns: row.columns
          .map((column) => ({
            ...column,
            blocks: column.blocks.filter(
              (block) =>
                /*
                 * The fabrication backstop. The catalogue no longer offers the
                 * presets these blocks live in, but a block-level guard costs
                 * nothing and holds even if one arrives some other way — a
                 * repair answer, a preset that gains a quote block later.
                 */
                !FABRICATION_BLOCKS.has(block.type)
                && !PLACEHOLDER_COPY.includes(visibleText(block)),
            ),
          }))
          .filter((column) => column.blocks.length > 0),
      }))
      .filter((row) => row.columns.length > 0);

    if (rows.length > 0) kept.push({ ...section, rows });
  }

  return kept;
}

export async function sectionsFromPlan(plan: StarterSection[]): Promise<Section[]> {
  return (await buildStarterPage({ title: '', slug: '', description: '', sections: plan }, BLANK_FACTS))
    .sections;
}

/**
 * Place an uploaded photograph behind the opening section (slice 2).
 *
 * The image is the client's own, resolved to a blob URL by the ACTION, since
 * finding it is a tenant query that does not belong in a pure function. Here it
 * is only placed: on the first section, as its background, with the tone turned
 * dark and a scrim raised to at least 45 so whatever text the section carries
 * stays readable over a photo. The prompt asks the model to open with a hero when
 * an image is given, so the first section is usually the right home for it, and
 * darkening it makes it read as one even when the model opens with something
 * plainer. The URL is validated once more by createPage's sanitiser, like every
 * other stored URL.
 */
export function featurePageImage(sections: Section[], url: string): Section[] {
  if (sections.length === 0 || !url) return sections;
  const [first, ...rest] = sections;
  const overlay = typeof first.overlay === 'number' && first.overlay >= 45 ? first.overlay : 45;
  return [{ ...first, backgroundImage: url, tone: 'dark' as Section['tone'], overlay }, ...rest];
}
