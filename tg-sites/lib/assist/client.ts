/**
 * The client half of Luna Assist: reading the stream, and the shape of a thread.
 *
 * PURE, AND THAT IS THE POINT. The panel is a React component with a fetch, a
 * reader and a scroll position in it, none of which a unit test wants to know
 * about. Everything the panel decides rather than draws lives here: how a line
 * of the response becomes an event, which turns go back to the server as the
 * conversation so far, and how a list of tool names reads in a sentence. The
 * component is then thin enough to be read in one sitting.
 *
 * THE RESPONSE IS NEWLINE-DELIMITED JSON, one object per line (see
 * app/api/assist/route.ts). A chunk off the network can end mid-line, so
 * readEvents hands back whatever is left over for the next chunk to finish, and
 * a line that is not an event this version knows is dropped rather than thrown
 * over: a newer server may send a kind an older tab has never heard of.
 */

export type AssistEvent =
  | { type: 'text'; delta: string }
  | { type: 'answer'; text: string; pence?: number; toolsUsed?: string[] }
  | { type: 'question'; text: string; question: string; options: string[]; pence?: number; toolsUsed?: string[] }
  | { type: 'error'; message: string; pence?: number };

/** One turn as the panel holds it. */
export interface AssistTurn {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  /** Still being written. */
  streaming?: boolean;
  /** The tools that went into this answer, for the line under it. */
  tools?: string[];
  /** A question the assistant asked, with the options it offered. */
  question?: { question: string; options: string[] } | null;
  /** A failure notice rather than an answer. Never sent back as context. */
  failed?: boolean;
}

/** What the server takes as the conversation so far. */
export interface PriorTurn {
  role: 'user' | 'assistant';
  text: string;
}

/** Turns carried back to the server. The server caps this again; this is courtesy. */
export const MAX_THREAD_TURNS = 12;

function looksLikeEvent(value: unknown): value is AssistEvent {
  if (!value || typeof value !== 'object') return false;
  const event = value as { type?: unknown; delta?: unknown; message?: unknown; question?: unknown };
  switch (event.type) {
    case 'text':
      return typeof event.delta === 'string';
    case 'answer':
      return true;
    case 'question':
      return typeof event.question === 'string';
    case 'error':
      return typeof event.message === 'string';
    default:
      return false;
  }
}

/**
 * Whole lines in `buffer` as events, plus the part of the last line that has
 * not arrived yet. Pass the rest back in with the next chunk.
 */
export function readEvents(buffer: string): { events: AssistEvent[]; rest: string } {
  const lines = buffer.split('\n');
  const rest = lines.pop() ?? '';
  const events: AssistEvent[] = [];
  for (const line of lines) {
    const text = line.trim();
    if (!text) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      continue;
    }
    if (looksLikeEvent(parsed)) events.push(parsed);
  }
  return { events, rest };
}

/**
 * The conversation so far, as the server wants it: the last few turns, plain
 * text, no failures. A question the assistant asked goes back with its own
 * text, so that "the second one" means something on the next turn.
 */
export function trimThread(turns: readonly AssistTurn[], max = MAX_THREAD_TURNS): PriorTurn[] {
  const out: PriorTurn[] = [];
  for (const turn of turns) {
    if (turn.failed || turn.streaming) continue;
    const parts = [turn.text.trim()];
    if (turn.question) parts.push(turn.question.question);
    const text = parts.filter(Boolean).join('\n\n');
    if (!text) continue;
    out.push({ role: turn.role, text });
  }
  return out.slice(-max);
}

/**
 * What each tool read, as the THING rather than the doing of it. One verb for
 * the sentence and nouns after it, because a phrase each gives "read the page
 * and read the results board", which is how a machine lists rather than how a
 * person says it.
 */
const TOOL_THINGS: Readonly<Record<string, string>> = {
  read_page: 'the page',
  read_site: 'the site',
  read_catalogue: 'what it can build with',
  read_results: 'the results board',
  read_enquiries: 'the enquiries',
};

/**
 * "Read the page and the results board." Each thing once, in the order it was
 * first read, so three looks at one page do not read as three things. No
 * Oxford comma, like everything else this product writes.
 */
export function describeTools(names: readonly string[]): string {
  const things: string[] = [];
  for (const name of names) {
    const thing = TOOL_THINGS[name];
    if (thing && !things.includes(thing)) things.push(thing);
  }
  if (things.length === 0) return '';
  if (things.length === 1) return `Read ${things[0]}.`;
  const last = things[things.length - 1];
  return `Read ${things.slice(0, -1).join(', ')} and ${last}.`;
}

/** The body the route takes. */
export function assistRequest(input: {
  message: string;
  pageId: string | null;
  turns: readonly AssistTurn[];
}): { mode: 'plan'; message: string; pageId: string | null; thread: PriorTurn[] } {
  return {
    // Slice 1 is Plan mode. The switch arrives with slice 2, when Build has
    // something to do that Plan does not.
    mode: 'plan',
    message: input.message.trim(),
    pageId: input.pageId,
    thread: trimThread(input.turns),
  };
}
