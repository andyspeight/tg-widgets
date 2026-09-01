'use server';

/**
 * Adding a designed section, with its photographs already in it.
 *
 * WHY A SERVER ACTION FOR SOMETHING THE BROWSER COULD BUILD. Building the section
 * is a pure function and the browser does it in the picker; what it cannot do is
 * reach the photo library or the client's media store, both of which are ours and
 * both of which are server only. So the picker asks here, the section comes back
 * with real travel pictures fetched into the client's own media, and the ordinary
 * page save writes it exactly as if it had been assembled by hand.
 *
 * THE SAME QUERY AS THE PREVIEW. The picker drew each picture from a search term
 * worked out by the photo plan (lib/content/photo-plan.ts); this resolves the
 * very same terms, so the section a client adds looks like the one they chose
 * rather than a surprise. Heroes came first; any preset carrying photo queries
 * rides the same plan now, so the three destination cards arrive with Greece,
 * Italy and Portugal on them rather than three grey frames.
 *
 * BEST EFFORT, ALWAYS. No key, no store, a search that finds nothing, any error
 * at all: the picture is left empty and the section comes back image-ready, the
 * same as picking it in the browser would have given. A good section with an
 * empty frame is still a good section, and it is one undo away either way. The
 * picture is never a reason the add fails.
 */

import { requireTenantId } from '../../lib/auth/session';
import { buildPresetSection, presetById } from '../../lib/content/presets';
import { sectionPhotoTargets } from '../../lib/content/photo-plan';
import type { Section } from '../../lib/content/schema';
import { fillPlannedPhotos } from '../../lib/media/photo-fill';

export type DesignedResult =
  | { ok: true; section: Section }
  | { ok: false; error: string };

/**
 * Build a designed section and fetch the photographs its preset asks for.
 *
 * requireTenantId is the control, the same as every other action: the screen
 * that calls this is only reachable signed in with a site open, but nothing about
 * the shape of the call enforces that, so this does.
 */
export async function buildDesignedSectionAction(input: unknown): Promise<DesignedResult> {
  let tenantId: string;
  try {
    tenantId = await requireTenantId();
  } catch {
    return { ok: false, error: 'Open a site first.' };
  }

  const presetId =
    input && typeof input === 'object' ? String((input as Record<string, unknown>).presetId ?? '') : '';
  const preset = presetById(presetId);
  if (!preset) return { ok: false, error: 'We could not find that design.' };

  const section = buildPresetSection(preset);

  /*
   * EVERY PICTURE THE PRESET ASKS FOR, GALLERIES INCLUDED. Andy, 1 Sep 2026:
   * the designed layouts should arrive with real images in them so a client gets
   * a feel for the thing, and swaps what they do not want. Galleries used to be
   * held back here ("the client's to choose"), but a freshly inserted gallery
   * nobody has touched is exactly the case the AI page path already fills, for
   * the same reason: an empty grid ships the author-facing "Add some images"
   * prompt rather than a design. Every frame is one swap from the client's own,
   * so it fills like the rest now. Best effort throughout: no photo library, no
   * store, no match, and the frame stays empty and image-ready.
   */
  const plan = sectionPhotoTargets(preset, 0);
  if (plan.length > 0) {
    await fillPlannedPhotos(tenantId, plan, [section]);
  }

  return { ok: true, section };
}
