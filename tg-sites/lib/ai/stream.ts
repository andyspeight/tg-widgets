/**
 * Reading a streamed answer from the Messages API, in pure code.
 *
 * The stream is server-sent events: `event:` and `data:` lines, a blank line
 * between events, JSON in the data. This file turns bytes into events and
 * events into the same message shape a non-streamed call returns (content
 * blocks, the stop reason, the usage), so the caller that assembles a tool
 * loop never knows it was streamed. The only extra is a callback for text as
 * it arrives, which is what the person at the keyboard is waiting for.
 *
 * EVERY BLOCK IS KEPT AS THE API SENT IT, including thinking blocks and their
 * signatures. A tool loop hands the assistant's turn back to the API to
 * continue, and a turn missing its thinking would be refused. Text is
 * accumulated from deltas, a tool's input from its JSON fragments, and a
 * fragment that never parses becomes an empty input rather than a throw,
 * because the model's next turn is where a bad input gets corrected.
 *
 * PURE: an async iterable of chunks in, a message out. Tested with fixtures.
 */

import type { TokenUsage } from '../assist/pricing';

export interface StreamEvent {
  event: string;
  data: unknown;
}

export type RawBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'thinking'; thinking: string; signature?: string }
  | { type: 'redacted_thinking'; data: string }
  | { type: string; [key: string]: unknown };

export interface AssembledMessage {
  content: RawBlock[];
  stopReason: string | null;
  usage: TokenUsage;
}

/** Bytes (or strings) to events. Handles events split across chunks. */
export async function* sseEvents(source: AsyncIterable<Uint8Array | string>): AsyncGenerator<StreamEvent> {
  const decoder = new TextDecoder();
  let buffer = '';
  const flush = function* (block: string): Generator<StreamEvent> {
    let event = 'message';
    const data: string[] = [];
    for (const line of block.split('\n')) {
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
    }
    if (data.length === 0) return;
    const text = data.join('\n');
    let parsed: unknown = text;
    try {
      parsed = JSON.parse(text);
    } catch {
      /* Not JSON: handed over as the string it was. */
    }
    yield { event, data: parsed };
  };
  for await (const chunk of source) {
    buffer += typeof chunk === 'string' ? chunk : decoder.decode(chunk, { stream: true });
    buffer = buffer.replace(/\r\n/g, '\n');
    let at = buffer.indexOf('\n\n');
    while (at !== -1) {
      const block = buffer.slice(0, at);
      buffer = buffer.slice(at + 2);
      yield* flush(block);
      at = buffer.indexOf('\n\n');
    }
  }
  buffer += decoder.decode();
  if (buffer.trim()) yield* flush(buffer);
}

function count(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}

function readUsage(usage: unknown, into: TokenUsage): void {
  if (!usage || typeof usage !== 'object') return;
  const u = usage as Record<string, unknown>;
  if ('input_tokens' in u) into.inputTokens = count(u.input_tokens);
  if ('output_tokens' in u) into.outputTokens = count(u.output_tokens);
  if ('cache_read_input_tokens' in u) into.cacheReadTokens = count(u.cache_read_input_tokens);
  if ('cache_creation_input_tokens' in u) into.cacheWriteTokens = count(u.cache_creation_input_tokens);
}

/** An error the stream reported, told apart from a transport failure. */
export class StreamError extends Error {
  constructor(readonly kind: string, message: string) {
    super(message);
    this.name = 'StreamError';
  }
}

/**
 * Fold events into one message. `onText` sees every text delta as it lands.
 */
export async function assembleMessage(
  events: AsyncIterable<StreamEvent>,
  onText?: (delta: string) => void,
): Promise<AssembledMessage> {
  const content: RawBlock[] = [];
  const partial = new Map<number, string>();
  const usage: TokenUsage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
  let stopReason: string | null = null;

  for await (const { data } of events) {
    if (!data || typeof data !== 'object') continue;
    const e = data as Record<string, unknown>;
    switch (e.type) {
      case 'message_start': {
        const message = e.message as Record<string, unknown> | undefined;
        readUsage(message?.usage, usage);
        break;
      }
      case 'content_block_start': {
        const index = Number(e.index);
        const block = (e.content_block ?? {}) as RawBlock;
        content[index] = { ...block } as RawBlock;
        if (block.type === 'text') (content[index] as { text: string }).text = '';
        if (block.type === 'thinking') (content[index] as { thinking: string }).thinking = '';
        if (block.type === 'tool_use') partial.set(index, '');
        break;
      }
      case 'content_block_delta': {
        const index = Number(e.index);
        const delta = (e.delta ?? {}) as Record<string, unknown>;
        const block = content[index];
        if (!block) break;
        if (delta.type === 'text_delta' && typeof delta.text === 'string') {
          (block as { text: string }).text += delta.text;
          onText?.(delta.text);
        } else if (delta.type === 'input_json_delta' && typeof delta.partial_json === 'string') {
          partial.set(index, (partial.get(index) ?? '') + delta.partial_json);
        } else if (delta.type === 'thinking_delta' && typeof delta.thinking === 'string') {
          (block as { thinking: string }).thinking += delta.thinking;
        } else if (delta.type === 'signature_delta' && typeof delta.signature === 'string') {
          (block as { signature?: string }).signature = delta.signature;
        }
        break;
      }
      case 'content_block_stop': {
        const index = Number(e.index);
        const block = content[index];
        if (block && block.type === 'tool_use') {
          const json = (partial.get(index) ?? '').trim();
          let input: unknown = {};
          if (json) {
            try {
              input = JSON.parse(json);
            } catch {
              input = {};
            }
          }
          (block as { input: unknown }).input = input;
          partial.delete(index);
        }
        break;
      }
      case 'message_delta': {
        const delta = e.delta as Record<string, unknown> | undefined;
        if (delta && typeof delta.stop_reason === 'string') stopReason = delta.stop_reason;
        readUsage(e.usage, usage);
        break;
      }
      case 'error': {
        const error = (e.error ?? {}) as Record<string, unknown>;
        throw new StreamError(String(error.type ?? 'error'), String(error.message ?? 'The stream reported an error.'));
      }
      default:
        break;
    }
  }

  return { content: content.filter(Boolean), stopReason, usage };
}
