/**
 * One turn of Luna Assist, from the claim to the answer.
 *
 * THE ORDER IS THE SAFETY. Nothing here reaches the model until the claim has
 * said yes: the ledger row exists, the limits have been counted and the
 * allowance checked, all in the database. Then the tools are filtered by mode
 * and capability, the system prompt is built from the mode and the tools
 * alone, and the site, the page and the request go in the user turn as data.
 * Only then does the loop start. tests/assist.test.ts drives this function with
 * fakes for every dependency and asserts on exactly that order.
 *
 * THE LOOP IS BOUNDED. A turn is at most MAX_ROUNDS calls to the model. A tool
 * the model names that is not in the list it was given is answered with an
 * error result and logged as refused, never run; a tool that exists is run
 * and its result handed back as data. ask_user ends the turn with a question
 * for the person, whose reply arrives as the next request.
 *
 * NO SERVER-ONLY IMPORT, on purpose: the pieces that touch the database or
 * the network arrive as dependencies, so this file is testable as it runs.
 */

import type { Capability } from '../auth/permissions';
import type { ConverseAnswer, ConverseMessage, ConverseTool } from '../ai/anthropic';
import type { AssistClaim, AssistLogEvent } from '../db/assist';
import type { Page } from '../content/schema';
import type { PageOutline } from './context';
import { refusalMessage } from './limits';
import { addUsage, costPence, noUsage, type TokenUsage } from './pricing';
import { applyOperations, parseOperation, type Change, type Operation } from './operations';
import { contextTurn, systemPrompt, threadMessages, type PriorTurn, type SiteContext } from './prompt';
import { isToolName, toApiTools, toolsFor, type Mode, type ToolDefinition, type ToolName } from './tools';

/** Calls to the model one turn may make. Read a page, read the results, answer: four is plenty. */
export const MAX_ROUNDS = 5;

/** Changes one proposal may carry. More than this is a plan, not a change. */
export const MAX_OPERATIONS = 8;

/** How hard the model thinks on a turn. Medium, as the builders found. */
export const ASSIST_EFFORT = 'medium' as const;

export interface ToolOutcome {
  content: string;
  isError: boolean;
  /** What the log records about the call: names, ids, counts. */
  detail: Record<string, unknown>;
}

export interface ServeInput {
  tenantId: string;
  userId: string;
  mode: Mode;
  model: string;
  message: string;
  pageId: string | null;
  /** The section the person has selected on the canvas, if any. */
  sectionId: string | null;
  thread: readonly PriorTurn[];
  site: SiteContext;
  page: PageOutline | null;
  /**
   * The open page itself, which propose_changes applies to. The outline is what
   * the model reads; this is what an operation is checked against, and it never
   * leaves the server.
   */
  pageTree: Page | null;
  caps: ReadonlySet<Capability>;
}

export interface ServeDeps {
  claim: () => Promise<AssistClaim>;
  converse: (
    system: string,
    messages: readonly ConverseMessage[],
    opts: { model: string; tools: readonly ConverseTool[]; effort: typeof ASSIST_EFFORT; onText: (delta: string) => void },
  ) => Promise<ConverseAnswer>;
  runTool: (name: ToolName, input: unknown) => Promise<ToolOutcome>;
  record: (usageId: string, usage: TokenUsage, pence: number) => Promise<void>;
  log: (event: AssistLogEvent) => Promise<void>;
  onText: (delta: string) => void;
}

export interface Question {
  question: string;
  options: string[];
}

export interface Proposal {
  /** What the person will see and apply, one entry per change. */
  changes: Change[];
  /** The operations themselves, which the editor applies if they say yes. */
  operations: Operation[];
  /** Anything the model asked for that was refused, so the panel can say so. */
  refused: string[];
}

export type ServeResult =
  | { kind: 'answer'; text: string; usage: TokenUsage; pence: number; toolsUsed: string[] }
  | { kind: 'question'; text: string; question: Question; usage: TokenUsage; pence: number; toolsUsed: string[] }
  | { kind: 'proposal'; text: string; proposal: Proposal; usage: TokenUsage; pence: number; toolsUsed: string[] }
  | { kind: 'refused'; message: string }
  | { kind: 'failed'; message: string; usage: TokenUsage; pence: number };

function textOf(answer: ConverseAnswer): string {
  return answer.content
    .filter((block): block is { type: 'text'; text: string } => block.type === 'text' && typeof (block as { text?: unknown }).text === 'string')
    .map((block) => block.text)
    .join('')
    .trim();
}

function toolUsesOf(answer: ConverseAnswer): Array<{ id: string; name: string; input: unknown }> {
  return answer.content
    .filter((block): block is { type: 'tool_use'; id: string; name: string; input: unknown } => block.type === 'tool_use')
    .map((block) => ({ id: String(block.id ?? ''), name: String(block.name ?? ''), input: block.input }));
}

/** A question the model asked, checked: one sentence and two to four options. */
export function readQuestion(input: unknown): Question | null {
  if (!input || typeof input !== 'object') return null;
  const raw = input as { question?: unknown; options?: unknown };
  const question = typeof raw.question === 'string' ? raw.question.trim().slice(0, 300) : '';
  const options = Array.isArray(raw.options)
    ? raw.options.filter((o): o is string => typeof o === 'string' && o.trim().length > 0).map((o) => o.trim().slice(0, 80)).slice(0, 4)
    : [];
  if (!question || options.length < 2) return null;
  return { question, options };
}

export async function serveAssist(input: ServeInput, deps: ServeDeps): Promise<ServeResult> {
  const base = { userId: input.userId, pageId: input.pageId, mode: input.mode };

  const claim = await deps.claim();
  if (!claim.allowed || !claim.id) {
    const reason = claim.reason ?? 'tenant';
    await deps.log({ ...base, usageId: null, kind: 'refused', detail: { reason } });
    return { kind: 'refused', message: refusalMessage(reason) };
  }
  const usageId = claim.id;

  const tools: ToolDefinition[] = toolsFor(input.mode, input.caps);
  const allowed = new Set(tools.map((tool) => tool.name));
  const system = systemPrompt(input.mode, tools);
  const messages: ConverseMessage[] = [
    ...threadMessages(input.thread),
    {
      role: 'user',
      content: contextTurn({
        site: input.site,
        page: input.page,
        message: input.message,
        selectedSectionId: input.sectionId,
      }),
    },
  ];

  await deps.log({
    ...base,
    usageId,
    kind: 'asked',
    detail: {
      tools: [...allowed],
      threadTurns: messages.length - 1,
      messageChars: input.message.length,
      hasPage: Boolean(input.page),
      hasSection: Boolean(input.sectionId),
    },
  });

  let usage = noUsage();
  const toolsUsed: string[] = [];
  const texts: string[] = [];
  const pence = () => costPence(input.model, usage);

  try {
    for (let round = 0; round < MAX_ROUNDS; round += 1) {
      const answer = await deps.converse(system, messages, {
        model: input.model,
        tools: toApiTools(tools),
        effort: ASSIST_EFFORT,
        onText: deps.onText,
      });
      usage = addUsage(usage, answer.usage);
      const text = textOf(answer);
      if (text) texts.push(text);

      const uses = toolUsesOf(answer);
      if (answer.stopReason !== 'tool_use' || uses.length === 0) break;

      const asked = uses.find((use) => use.name === 'ask_user' && allowed.has('ask_user'));
      if (asked) {
        const question = readQuestion(asked.input);
        if (question) {
          await deps.record(usageId, usage, pence());
          await deps.log({ ...base, usageId, kind: 'question', detail: { options: question.options.length, toolsUsed } });
          return { kind: 'question', text: texts.join('\n\n'), question, usage, pence: pence(), toolsUsed };
        }
      }

      const proposed = uses.find((use) => use.name === 'propose_changes' && allowed.has('propose_changes'));
      if (proposed) {
        const raw = (proposed.input as { changes?: unknown })?.changes;
        const operations = (Array.isArray(raw) ? raw : [])
          .map(parseOperation)
          .filter((op): op is Operation => op !== null)
          .slice(0, MAX_OPERATIONS);

        if (!input.pageTree) {
          messages.push({ role: 'assistant', content: answer.content });
          messages.push({
            role: 'user',
            content: [{
              type: 'tool_result',
              tool_use_id: proposed.id,
              content: 'No page is open, so there is nothing to change. Say what you would change instead.',
              is_error: true,
            }],
          });
          continue;
        }

        const outcome = applyOperations(input.pageTree, operations, input.caps);

        /* Nothing survived: hand the refusals back and let it correct one line
           rather than start again. That is what "returned to the model as an
           error to correct" means in the brief. */
        if (outcome.changes.length === 0) {
          await deps.log({ ...base, usageId, kind: 'refused', detail: { tool: 'propose_changes', refused: outcome.errors.length } });
          messages.push({ role: 'assistant', content: answer.content });
          messages.push({
            role: 'user',
            content: [{
              type: 'tool_result',
              tool_use_id: proposed.id,
              content: outcome.errors.length
                ? `None of those could be made:\n${outcome.errors.join('\n')}`
                : 'That proposal had no changes in it.',
              is_error: true,
            }],
          });
          continue;
        }

        await deps.record(usageId, usage, pence());
        await deps.log({
          ...base,
          usageId,
          kind: 'proposed',
          detail: {
            /* Labels and kinds, never the words themselves: the log says what
               was proposed, not what the client's page says. */
            changes: outcome.changes.map((change) => ({ kind: change.kind, label: change.label })),
            refused: outcome.errors.length,
            toolsUsed,
          },
        });
        return {
          kind: 'proposal',
          text: texts.join('\n\n'),
          proposal: { changes: outcome.changes, operations, refused: outcome.errors },
          usage,
          pence: pence(),
          toolsUsed,
        };
      }

      messages.push({ role: 'assistant', content: answer.content });
      const results: Array<Record<string, unknown>> = [];
      for (const use of uses) {
        if (!allowed.has(use.name) || !isToolName(use.name)) {
          await deps.log({ ...base, usageId, kind: 'refused', detail: { tool: use.name.slice(0, 60) } });
          results.push({ type: 'tool_result', tool_use_id: use.id, content: `There is no tool called ${use.name.slice(0, 60)} on this request.`, is_error: true });
          continue;
        }
        if (use.name === 'ask_user') {
          results.push({ type: 'tool_result', tool_use_id: use.id, content: 'A question needs a sentence and two to four options.', is_error: true });
          continue;
        }
        const outcome = await deps.runTool(use.name, use.input);
        toolsUsed.push(use.name);
        await deps.log({ ...base, usageId, kind: 'tool', detail: { tool: use.name, error: outcome.isError, ...outcome.detail } });
        results.push({ type: 'tool_result', tool_use_id: use.id, content: outcome.content, is_error: outcome.isError });
      }
      messages.push({ role: 'user', content: results });
    }
  } catch (error) {
    await deps.record(usageId, usage, pence());
    /* An AiError's sentence is written for a person; anything else may quote
       our own request back, so it is logged and a plain sentence is shown. */
    const message = error instanceof Error && error.name === 'AiError'
      ? error.message
      : 'The assistant could not answer that. Try again in a moment.';
    if (!(error instanceof Error && error.name === 'AiError')) console.error('[tg-sites] assistant turn failed', error);
    await deps.log({ ...base, usageId, kind: 'failed', detail: { toolsUsed, rounds: texts.length } });
    return { kind: 'failed', message, usage, pence: pence() };
  }

  await deps.record(usageId, usage, pence());
  const text = texts.join('\n\n') || 'I looked, but I could not put an answer together. Try asking in a different way.';
  await deps.log({ ...base, usageId, kind: 'answered', detail: { toolsUsed, chars: text.length, outputTokens: usage.outputTokens } });
  return { kind: 'answer', text, usage, pence: pence(), toolsUsed };
}
