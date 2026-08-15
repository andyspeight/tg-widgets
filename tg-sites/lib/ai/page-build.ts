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
export const PAGE_BUILD_MAX_TOKENS = 4096;

/**
 * Every page-section preset id, as a set, so a model that names something outside
 * the catalogue (a header, a footer, a preset that has been renamed, a made-up
 * id) is dropped rather than trusted. PAGE_PRESETS is page scope only, so site
 * chrome cannot land in the middle of a page.
 */
const PAGE_PRESET_IDS = new Set(PAGE_PRESETS.map((preset) => preset.id));

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
  for (const preset of PAGE_PRESETS) {
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
- For each section, write a "heading" (its title, one line, in the house voice, grounded in the brief) and, where a paragraph suits it, a short "body" of one or two sentences. Leave "body" out for a section that is a row of points, a set of logos or a bare call to action. Leave "heading" out to keep the section's own wording.`;

/** The output contract, so the model returns a JSON array and only that. */
export const PAGE_OUTPUT_SHAPE = `Return a JSON array and NOTHING else. No prose before or after, no markdown fences. Each item is one section, in the order it appears down the page:

[
  { "preset": "<an id from the catalogue>", "heading": "the section title", "body": "one or two sentences, or omit" },
  { "preset": "<another id>", "heading": "..." }
]

"preset" is required and must be one of the catalogue ids exactly. "heading" and "body" are optional plain text, no markup.`;

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

/** The brief the person typed, capped and stripped of our own prompt tags. */
export function buildPageUserPrompt(brief: string): string {
  const clean = brief.replace(/<\/?(company|tone|avoid|copy|request)>/gi, '').trim().slice(0, MAX_PAGE_BRIEF);
  return `Design this page:\n\n<request>\n${clean}\n</request>`;
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
export function sectionsFromPlan(plan: StarterSection[]): Section[] {
  return buildStarterPage({ title: '', slug: '', description: '', sections: plan }, BLANK_FACTS).sections;
}
