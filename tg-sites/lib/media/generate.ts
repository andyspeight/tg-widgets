/**
 * Generating one image and keeping it in a tenant's own media.
 *
 * The generation counterpart to stock.ts. Where importStockPhoto copies a
 * photograph in from a provider, this asks a model to draw one and stores the
 * bytes it gets back. Same destination and same shape of row, so a generated
 * picture is a first-class member of the image bank: selectable, deletable, and
 * eligible for the phone-size backfill like any other. The one difference is its
 * source, 'ai', which owes no credit.
 *
 * PROMPT IS ASSUMED SHAPED. The words are wrapped with the photo rules by
 * lib/ai/image-prompt before they reach here; this module spends money and does
 * the storing, not the judgement. The alt text is the person's own brief, the
 * honest description of what they asked for.
 */

import 'server-only';

import type { ImageOrientation } from '../ai/image-prompt';
import { insertMedia } from '../db/media';
import { storeBytes } from './blob';
import { generateImageBytes } from './imagegen';
import { filenameStem, MAX_UPLOAD_BYTES, MEDIA_MIME, tenantPrefix } from './limits';
import type { MediaItem } from './types';

export async function generateAndStore(
  tenantId: string,
  input: { prompt: string; orientation?: ImageOrientation; alt?: string; timeoutMs?: number },
): Promise<MediaItem> {
  const { bytes, contentType, width, height } = await generateImageBytes({
    prompt: input.prompt,
    orientation: input.orientation,
    timeoutMs: input.timeoutMs,
  });

  // A readable, tenant-scoped name from the brief. The store adds a random
  // suffix, so two pictures from the same words never collide.
  const alt = (input.alt ?? '').trim().slice(0, 300);
  const stem = filenameStem(alt || 'generated-image');
  const stored = await storeBytes(
    bytes,
    `${tenantPrefix(tenantId)}${stem}.${MEDIA_MIME[contentType]}`,
    contentType,
    MAX_UPLOAD_BYTES,
  );

  return insertMedia(tenantId, {
    storageKey: stored.pathname,
    url: stored.url,
    filename: `${stem}.${MEDIA_MIME[stored.contentType]}`,
    mime: stored.contentType,
    bytes: stored.size,
    // Measured from the very bytes stored, with the model's declared size as a
    // fallback for a format the reader cannot measure.
    width: stored.pixels?.width ?? width,
    height: stored.pixels?.height ?? height,
    // The brief IS the description: it is exactly what the picture is of, so it
    // starts the alt text off honestly rather than empty.
    alt,
    source: 'ai',
    // Nobody else made it, so there is nothing to attribute.
    credit: {},
    variants: [],
  });
}
