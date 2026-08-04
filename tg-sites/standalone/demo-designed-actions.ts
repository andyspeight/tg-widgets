/**
 * The review copy's stand-in for app/actions/designed.
 *
 * The real one fetches a photograph into the client's media, which needs a photo
 * library and a store the standalone build has neither of. So this hands back the
 * image-ready section, exactly what the real action falls back to when the
 * library is not connected. It is the same shape, so the editor cannot tell the
 * difference, and the pictures come up as their "Choose an image" prompts.
 */

import { buildPresetSection, presetById } from '../lib/content/presets';
import type { Section } from '../lib/content/schema';

export type DesignedResult =
  | { ok: true; section: Section }
  | { ok: false; error: string };

export async function buildDesignedSectionAction(input: unknown): Promise<DesignedResult> {
  const presetId =
    input && typeof input === 'object'
      ? String((input as Record<string, unknown>).presetId ?? '')
      : '';
  const preset = presetById(presetId);
  if (!preset) return { ok: false, error: 'We could not find that design.' };
  return { ok: true, section: buildPresetSection(preset) };
}
