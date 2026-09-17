/**
 * What the assistant may do: the tool registry, and the filter that decides
 * which of it a request carries.
 *
 * THE FILTER IS THE RULE. The brief's rule 4 (Plan mode is read-only in code,
 * not in the prompt) and rule 7 (role-scoped tools) both come down to one
 * function: toolsFor(mode, capabilities). A Plan request is built from a list
 * with no writer in it, so there is nothing a prompt could talk the model into
 * calling. A member without the theme capability is handed a list with no
 * theme tool in it, so the refusal happens before the request exists rather
 * than after the model has tried. tests/assist.test.ts proves both by looking
 * at what the filter returns, not at what the prompt says.
 *
 * Slice 2 added the first writer, propose_changes. Plan mode drops it, so a
 * Plan request is read-only in code and not merely in the prompt, which is the
 * whole of rule 4.
 *
 * PURE. The registry is data and the filter is a function of its arguments.
 */

import type { Capability } from '../auth/permissions';

export type Mode = 'plan' | 'build';

export const MODES: readonly Mode[] = ['plan', 'build'];

export function isMode(value: unknown): value is Mode {
  return value === 'plan' || value === 'build';
}

export type ToolName =
  | 'read_page'
  | 'read_site'
  | 'read_catalogue'
  | 'read_results'
  | 'read_enquiries'
  | 'ask_user'
  | 'propose_changes';

/** A JSON schema, as the API wants it. Kept loose on purpose. */
export type InputSchema = { type: 'object'; properties: Record<string, unknown>; required?: string[] };

export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: InputSchema;
  /** True for a tool that changes the site. None in slice 1. */
  writes: boolean;
  /** The capability a member needs before this tool is offered, or null for any member. */
  capability: Capability | null;
}

export const TOOLS: readonly ToolDefinition[] = [
  {
    name: 'read_page',
    description:
      'Read a page of this site in full: its outline and all of its words. Leave page_id out for the page the person has open. Use it before advising on a page you have only seen in outline.',
    input_schema: {
      type: 'object',
      properties: {
        page_id: { type: 'string', description: 'The id of the page, from read_site. Omit for the open page.' },
      },
    },
    writes: false,
    capability: null,
  },
  {
    name: 'read_site',
    description:
      'Read what the site is: the company profile, the site address, and every page with its path, whether it is published and its id.',
    input_schema: { type: 'object', properties: {} },
    writes: false,
    capability: null,
  },
  {
    name: 'read_catalogue',
    description:
      'List the sections and blocks a page can be built from, with what each one is for and the settings it has. Use it before suggesting a section or block by name.',
    input_schema: {
      type: 'object',
      properties: {
        group: { type: 'string', description: 'Only this group of blocks (for example "Text", "Media", "Cards and lists"). Omit for all.' },
      },
    },
    writes: false,
    capability: null,
  },
  {
    name: 'read_results',
    description:
      'Read what the results board says: the site health check with the things to fix first, how many people and which AI engines read the site, and the enquiries count for the last 30 or 90 days.',
    input_schema: {
      type: 'object',
      properties: {
        days: { type: 'integer', description: '30 or 90. Defaults to 30.' },
      },
    },
    writes: false,
    capability: null,
  },
  {
    name: 'read_enquiries',
    description:
      'Read what people have been asking through the site’s forms recently: counts by form and day, and the questions themselves with the people removed. Use it to say what people ask about, never to repeat an enquiry or identify a person.',
    input_schema: {
      type: 'object',
      properties: {
        days: { type: 'integer', description: 'How many days back, 1 to 90. Defaults to 30.' },
      },
    },
    writes: false,
    capability: null,
  },
  {
    /*
     * THE ONLY WRITER, and it does not write. It hands back a set of typed
     * operations which the person applies or skips, so the model's reach ends
     * at a proposal. Its capability is the floor rather than the whole of the
     * check: lib/assist/operations.ts asks again, field by field, because
     * rewording a heading and restyling the section it sits in are different
     * permissions and one tool covers both.
     */
    name: 'propose_changes',
    description:
      'Propose changes to the page the person has open. They see each one and apply or skip it; nothing changes until they do. Use it when they have asked for a change rather than for advice. Name blocks by the ids in the page outline.',
    input_schema: {
      type: 'object',
      properties: {
        changes: {
          type: 'array',
          description: 'One to eight changes, each with a one-line reason.',
          items: {
            type: 'object',
            properties: {
              kind: {
                type: 'string',
                enum: ['set_text', 'set_setting', 'set_page_seo'],
                description: 'set_text for a block\u2019s words, set_setting for one of its settings, set_page_seo for the page\u2019s search title and description.',
              },
              block: { type: 'string', description: 'The block id, for set_text and set_setting.' },
              text: { type: 'string', description: 'The new words, as plain text. For set_text.' },
              setting: { type: 'string', description: 'The setting\u2019s key, as read_catalogue lists it. For set_setting.' },
              value: { description: 'The new value: a string, a number or true/false. For set_setting.' },
              title: { type: 'string', description: 'The search title. For set_page_seo.' },
              description: { type: 'string', description: 'The search description. For set_page_seo.' },
              why: { type: 'string', description: 'One line: why this is better.' },
            },
            required: ['kind', 'why'],
          },
        },
      },
      required: ['changes'],
    },
    writes: true,
    capability: 'content',
  },
  {
    name: 'ask_user',
    description:
      'Ask the person one question with two to four short options, when a real choice would change your answer. Use it sparingly: usually make the sensible assumption and say so.',
    input_schema: {
      type: 'object',
      properties: {
        question: { type: 'string', description: 'The question, in one plain sentence.' },
        options: { type: 'array', items: { type: 'string' }, description: 'Two to four short options.' },
      },
      required: ['question', 'options'],
    },
    writes: false,
    capability: null,
  },
];

const NAMES = new Set(TOOLS.map((tool) => tool.name));

export function isToolName(value: unknown): value is ToolName {
  return typeof value === 'string' && NAMES.has(value);
}

/**
 * The tools a request carries. Plan mode drops every writer; every mode drops a
 * tool whose capability the member does not hold. A registry may be passed so
 * the tests can prove the filter against writers that do not exist yet.
 */
export function toolsFor(
  mode: Mode,
  caps: ReadonlySet<Capability>,
  registry: readonly ToolDefinition[] = TOOLS,
): ToolDefinition[] {
  return registry.filter((tool) => {
    if (mode === 'plan' && tool.writes) return false;
    if (tool.capability !== null && !caps.has(tool.capability)) return false;
    return true;
  });
}

/** The shape the Messages API takes: ours minus the fields that are ours. */
export function toApiTools(tools: readonly ToolDefinition[]): Array<{ name: string; description: string; input_schema: InputSchema }> {
  return tools.map(({ name, description, input_schema }) => ({ name, description, input_schema }));
}
