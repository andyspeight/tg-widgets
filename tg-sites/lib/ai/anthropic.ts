/**
 * The one place this application talks to Anthropic.
 *
 * SERVER ONLY, AND THAT IS THE FIRST THING TO PROTECT. The key bills to
 * Travelgenix, so it must never be in a bundle, a prop or a response. The
 * 'server-only' import above turns a mistaken import from a client component into
 * a build failure rather than a leaked key on a live site.
 *
 * WHICH MODEL, AND WHY
 *
 * Haiku 4.5. Andy asked for "a good but cheap AI option from Anthropic" on 31 Jul
 * 2026 and this is the honest answer for the job in front of it: the assistant
 * writes a heading or two or three short paragraphs from a profile that is already
 * in the prompt. That is not a reasoning problem, it is a writing problem with the
 * facts supplied, and the cheaper model does it about as well as the expensive one
 * while costing roughly a fifteenth as much per call. Spending Sonnet money on a
 * paragraph would be paying for capability the task never uses.
 *
 * The id is pinned to a dated version rather than an alias. An alias silently
 * moving under a feature whose whole job is the exact tone of a sentence is a
 * change nobody would notice until a client did.
 *
 * WHAT COMES BACK IS TREATED AS UNTRUSTED
 *
 * Not because Anthropic is untrusted, but because the prompt contains text typed by
 * clients, and the point of a prompt injection is to change what the model says.
 * So the answer is text, it is capped, and lib/ai/copy.ts is the only thing that
 * turns it into HTML. A model talked into misbehaving can produce a rude
 * paragraph. It cannot produce a script tag.
 */

import 'server-only';

const ENDPOINT = 'https://api.anthropic.com/v1/messages';

/** Pinned, not aliased. See the note above. */
export const MODEL = 'claude-haiku-4-5-20251001';

/**
 * The model the SECTION BUILDER uses, and why it is not the one above.
 *
 * Writing a paragraph from a profile is a writing problem, which is what Haiku
 * was chosen for. Building a whole section is a reasoning one: choose the right
 * blocks, structure a layout, honour a fixed palette, and come back as valid
 * JSON. That is worth the dearer model, and a section build is infrequent and
 * high-value where a copy tweak is neither. Andy chose Sonnet for it on 3 Aug
 * 2026, weighing quality against cost with the copy assistant left on Haiku.
 */
export const MODEL_BUILD = 'claude-sonnet-5';

/** The version of the request format, required on every call. */
const API_VERSION = '2023-06-01';

/**
 * Long enough for three paragraphs, short enough to bound a runaway.
 *
 * This is a ceiling on what one call can cost, not a target. The prompt asks for
 * one to three short paragraphs and normally gets four hundred tokens or so.
 */
const MAX_TOKENS = 1024;

/**
 * Twenty seconds, then give up.
 *
 * Somebody is looking at a spinner in a toolbar. A serverless function will be
 * killed before a minute anyway, and being killed produces a blank failure with no
 * message, so it is better to time out here where there is something to say.
 */
const TIMEOUT_MS = 20_000;

/** Whatever the answer runs to, this is where it stops. */
export const MAX_ANSWER = 8_000;

export interface Answer {
  text: string;
  inputTokens: number;
  outputTokens: number;
}

/** True when the key is set, so a screen can say the feature is off rather than broken. */
export function aiIsConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

/**
 * An error the caller may show to a person.
 *
 * The distinction matters: a rate limit from Anthropic and a bug in our request
 * both fail, and only one of them is worth telling somebody to try again about.
 * Everything not explicitly wrapped in one of these gets a generic message, because
 * an upstream error body can quote our own prompt back at us.
 */
export class AiError extends Error {
  readonly retryable: boolean;

  constructor(message: string, options: { retryable?: boolean } = {}) {
    super(message);
    this.name = 'AiError';
    this.retryable = options.retryable ?? false;
  }
}

/**
 * A picture to look at alongside the words, or nothing.
 *
 * A URL rather than base64, which the API accepts and which matters here: the
 * pictures are already on a public CDN, so sending the address is a few hundred
 * bytes where sending the file would be a megabyte from our server for every
 * description. It also means we are not reading a client's blob into memory.
 */
export interface AskImage {
  url: string;
}

/**
 * The knobs a caller may turn, all optional so the copy assistant's `ask(system,
 * user)` is unchanged. A section build passes a dearer model and a bigger ceiling
 * because a section of JSON is longer than three paragraphs of prose.
 */
export interface AskOptions {
  image?: AskImage;
  /** Defaults to MODEL (Haiku). The builder passes MODEL_BUILD. */
  model?: string;
  /** Defaults to MAX_TOKENS. The builder needs more room for a section. */
  maxTokens?: number;
}

/**
 * Ask the model, optionally about a picture.
 *
 * NO NEW MODEL FOR VISION. Haiku 4.5 is multimodal, so describing an image is
 * the same call with one more content block, at the same price and inside the
 * same daily allowance. That is worth stating because "we need alt text" reads
 * like it needs a second, dearer model and a separate budget, and it does not.
 */
export async function ask(
  system: string,
  user: string,
  opts: AskOptions = {},
): Promise<Answer> {
  const { image, model = MODEL, maxTokens = MAX_TOKENS } = opts;

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    throw new AiError('The writing assistant is not switched on for this site yet.');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': key,
        'anthropic-version': API_VERSION,
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        /*
         * The house rules and the client profile go in `system`, and only the
         * request goes in `messages`. That is not tidiness: the system prompt is
         * the strongest position in the conversation, and putting the rules a
         * client's typing must not override anywhere else would be handing them
         * the same footing as the rules.
         */
        system,
        /*
         * THE PICTURE FIRST, THEN THE REQUEST. The order is the documented one
         * and it is not arbitrary: a model reads the instruction better when it
         * already has the thing the instruction is about.
         */
        messages: [
          {
            role: 'user',
            content: image
              ? [
                  { type: 'image', source: { type: 'url', url: image.url } },
                  { type: 'text', text: user },
                ]
              : user,
          },
        ],
      }),
      signal: controller.signal,
      // Never cached. Two people asking for the same paragraph should get two.
      cache: 'no-store',
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new AiError('That took too long. Try again, or ask for something shorter.', {
        retryable: true,
      });
    }
    console.error('[tg-sites] the AI request could not be sent', error);
    throw new AiError('Could not reach the writing assistant. Try again in a moment.', {
      retryable: true,
    });
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    /*
     * Read and LOGGED, never returned. An upstream error body can quote the
     * request back, and the request contains the client's own profile. Andy can
     * read the log; the person at the keyboard gets a sentence.
     */
    const body = await response.text().catch(() => '');
    console.error(`[tg-sites] Anthropic returned ${response.status}`, body.slice(0, 500));

    if (response.status === 429) {
      throw new AiError('The assistant is busy right now. Try again in a moment.', {
        retryable: true,
      });
    }
    if (response.status >= 500) {
      throw new AiError('The assistant is having a moment. Try again shortly.', {
        retryable: true,
      });
    }
    // 400 and 401 are ours to fix, not theirs to retry.
    throw new AiError('The assistant could not answer that.');
  }

  const payload = (await response.json().catch(() => null)) as unknown;
  const text = readText(payload);

  if (!text) {
    throw new AiError('The assistant came back with nothing. Try asking again.', {
      retryable: true,
    });
  }

  const usage = readUsage(payload);
  return { text: text.slice(0, MAX_ANSWER), ...usage };
}

/**
 * The text out of a response, defensively.
 *
 * The shape is documented and stable, and this still walks it rather than reaching
 * for content[0].text. A shape change would otherwise throw a TypeError inside a
 * server action, which reaches the person as a blank failure rather than as the
 * "came back with nothing" above.
 */
function readText(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return '';
  const content = (payload as { content?: unknown }).content;
  if (!Array.isArray(content)) return '';

  return content
    .filter(
      (part): part is { type: string; text: string } =>
        Boolean(part)
        && typeof part === 'object'
        && (part as { type?: unknown }).type === 'text'
        && typeof (part as { text?: unknown }).text === 'string',
    )
    .map((part) => part.text)
    .join('')
    .trim();
}

function readUsage(payload: unknown): { inputTokens: number; outputTokens: number } {
  const usage =
    payload && typeof payload === 'object'
      ? ((payload as { usage?: unknown }).usage as Record<string, unknown> | undefined)
      : undefined;

  const count = (value: unknown) => (typeof value === 'number' && value >= 0 ? value : 0);
  return {
    inputTokens: count(usage?.input_tokens),
    outputTokens: count(usage?.output_tokens),
  };
}
