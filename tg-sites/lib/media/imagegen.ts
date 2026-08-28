/**
 * The only place an image is asked of a generation model.
 *
 * Confined the same way blob.ts confines the store: api.openai.com is not
 * reachable from where this was written, so the code that cannot be run here is
 * kept in one short file and everything around it (the prompt shaping, the
 * storing, the action) is pure or tested. When the first generation happens in
 * production and something is wrong, this is the file to read.
 *
 * WHY gpt-image-1. It takes one POST, returns the image as base64 in the
 * response so the server never has to fetch a second URL that might vanish, does
 * its own content moderation, and can emit webp directly, which is the format
 * the rest of this product prefers. The key is the one thing to add.
 *
 * COST IS REAL. Every call bills, so the caller meters volume through the same
 * daily claim the writer uses before it ever reaches here. This file just makes
 * the one picture.
 */

import 'server-only';

import type { ImageOrientation } from '../ai/image-prompt';
import type { MediaMime } from './limits';

/** The key, under the standard name Vercel and everyone else uses. */
function key(): string | undefined {
  return process.env.OPENAI_API_KEY;
}

/**
 * Whether generation can work at all. The picker checks this before offering the
 * tab, in the same shape as blobConfigured and pexelsConfigured, so a button
 * that could only disappoint is never shown.
 */
export function imageGenConfigured(): boolean {
  return Boolean(key());
}

/** Throw with something a person can act on, rather than an SDK error. */
function requireKey(): string {
  const value = key();
  if (!value) {
    throw new Error(
      'AI image generation is not switched on yet. Add an OPENAI_API_KEY to this '
        + 'project in Vercel and redeploy, and it will start working.',
    );
  }
  return value;
}

/**
 * The pixel size gpt-image-1 draws for each shape. Landscape is the hero size;
 * these are the only three the model offers, so the picker's shapes map onto
 * them exactly.
 */
const SIZE: Record<ImageOrientation, { size: string; width: number; height: number }> = {
  landscape: { size: '1536x1024', width: 1536, height: 1024 },
  portrait: { size: '1024x1536', width: 1024, height: 1536 },
  square: { size: '1024x1024', width: 1024, height: 1024 },
};

/**
 * webp, not png, and here is why. gpt-image-1 will return a multi-megabyte png
 * for a photographic hero; the same picture as webp at this compression is a few
 * hundred kilobytes, which is what a client's page can actually afford to serve.
 * The format is one the media table already allows.
 */
const OUTPUT_MIME: MediaMime = 'image/webp';

/**
 * A picture from a prompt, as bytes we own.
 *
 * The prompt is assumed already shaped by lib/ai/image-prompt: this function
 * spends money and does no judgement of its own beyond refusing an empty brief.
 * Throws on a missing key, a refusal, a timeout, or a malformed answer, each
 * with a message the action turns into something the person reads.
 */
export async function generateImageBytes(input: {
  prompt: string;
  orientation?: ImageOrientation;
  /**
   * How long to wait, in ms. Defaults to a generous window for the picker, where
   * generation is the whole point of the wait. The section builder passes less,
   * because there it runs AFTER a text build inside one serverless invocation and
   * the two together must finish before the platform's own ceiling.
   */
  timeoutMs?: number;
}): Promise<{ bytes: Buffer; contentType: MediaMime; width: number; height: number }> {
  const prompt = input.prompt.trim();
  if (!prompt) throw new Error('There is nothing to draw. Say what the picture should be.');

  const shape = SIZE[input.orientation ?? 'landscape'];

  const response = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${requireKey()}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-image-1',
      prompt,
      n: 1,
      size: shape.size,
      // A middle quality: a clean, publishable hero without the top tier's cost.
      quality: 'medium',
      output_format: 'webp',
      output_compression: 80,
      // The model's own safety pass. Left on, deliberately.
      moderation: 'auto',
    }),
    /*
     * Generation is slow, tens of seconds for a large image, and this runs
     * inside a serverless invocation with a hard ceiling. Being killed there is
     * a blank failure; timing out here is a message. Kept under the platform's
     * own function limit on purpose, and shorter still when a text build has
     * already spent part of the budget.
     */
    signal: AbortSignal.timeout(input.timeoutMs ?? 55_000),
  });

  if (!response.ok) {
    /*
     * The API returns a JSON error with a message, and for the two a person can
     * act on, a rejected prompt (moderation) and a spent key (billing), that
     * message is the useful thing. Anything unreadable falls back to the status.
     */
    let detail = '';
    try {
      const body = (await response.json()) as { error?: { message?: unknown } };
      if (typeof body?.error?.message === 'string') detail = body.error.message;
    } catch {
      // Body was not JSON. The status still tells the caller enough.
    }
    if (response.status === 400 && detail) {
      throw new Error(`That picture could not be generated: ${detail}`);
    }
    if (response.status === 401) {
      throw new Error('The image generation key was refused. Check OPENAI_API_KEY in Vercel.');
    }
    if (response.status === 429) {
      throw new Error('The image generator is busy or over its limit right now. Try again shortly.');
    }
    throw new Error(`The image could not be generated (${response.status}).`);
  }

  const body = (await response.json()) as { data?: Array<{ b64_json?: unknown }> };
  const b64 = body?.data?.[0]?.b64_json;
  if (typeof b64 !== 'string' || !b64) {
    throw new Error('The image generator returned nothing usable. Try again.');
  }

  const bytes = Buffer.from(b64, 'base64');
  if (bytes.byteLength === 0) throw new Error('The generated image came back empty.');

  return { bytes, contentType: OUTPUT_MIME, width: shape.width, height: shape.height };
}
