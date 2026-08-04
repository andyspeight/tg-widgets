'use server';

/**
 * Adding a designed hero, with its photographs already in it.
 *
 * WHY A SERVER ACTION FOR SOMETHING THE BROWSER COULD BUILD. Building the section
 * is a pure function and the browser does it in the picker; what it cannot do is
 * reach the photo library or the client's media store, both of which are ours and
 * both of which are server only. So the picker asks here, the section comes back
 * with real travel pictures fetched into the client's own media, and the ordinary
 * page save writes it exactly as if it had been assembled by hand.
 *
 * THE SAME QUERY AS THE PREVIEW. The picker drew each hero picture from a search
 * term worked out by heroPhotoQuery; this resolves the very same term, so the
 * hero a client adds looks like the one they chose rather than a surprise.
 *
 * BEST EFFORT, ALWAYS. No key, no store, a search that finds nothing, any error
 * at all: the picture is left empty and the section comes back image-ready, the
 * same as picking it in the browser would have given. A good hero with an empty
 * frame is still a good hero, and it is one undo away either way. The picture is
 * never a reason the add fails.
 */

import { requireTenantId } from '../../lib/auth/session';
import { buildPresetSection, heroPhotoQuery, presetById } from '../../lib/content/presets';
import type { SectionPreset } from '../../lib/content/preset-types';
import type { Section } from '../../lib/content/schema';
import { searchPexels } from '../../lib/media/pexels';

import { importStockAction } from './media';

export type DesignedResult =
  | { ok: true; section: Section }
  | { ok: false; error: string };

/** One photograph for a term, copied into the client's media. Undefined on any miss. */
async function sourcePhoto(query: string): Promise<string | undefined> {
  try {
    const found = await searchPexels({ query, orientation: 'landscape' });
    const photo = found.photos[0];
    if (!photo) return undefined;
    const imported = await importStockAction(photo);
    return imported.ok ? imported.data.url : undefined;
  } catch {
    // No key, a rate limit, a store that is not connected, a size check: all of
    // them leave this picture empty rather than failing the hero.
    return undefined;
  }
}

/**
 * Fill a built hero's pictures from the palette, in place.
 *
 * The preset and the section are walked in lockstep, which is sound because
 * buildPresetSection keeps the shape one to one. The picture index is counted
 * the same way the preview counts it, so an image gets the subject its thumbnail
 * showed. The sources run together rather than one after another, because a hero
 * with a background and an image should not take twice as long as one with either.
 */
async function fillHeroPhotos(preset: SectionPreset, section: Section): Promise<void> {
  const targets: Array<{ query: string; apply: (url: string) => void }> = [];
  let imageIndex = 0;

  preset.rows.forEach((prow, rowIndex) => {
    prow.columns.forEach((pcol, columnIndex) => {
      pcol.forEach((pblock, blockIndex) => {
        const picture =
          pblock.type === 'image' || pblock.type === 'video' || pblock.type === 'gallery';
        if (!picture) return;

        const query =
          typeof pblock.photo === 'string' && pblock.photo.trim()
            ? pblock.photo.trim()
            : heroPhotoQuery(preset.id, imageIndex);
        imageIndex += 1;

        // Only single images are filled for now. A gallery is several pictures at
        // once and is left for the client to choose; the index still counts it so
        // the queries stay lined up with the preview.
        if (pblock.type !== 'image') return;

        const target = section.rows[rowIndex]?.columns[columnIndex]?.blocks[blockIndex];
        if (!target) return;
        targets.push({
          query,
          apply: (url) => {
            target.props = { ...target.props, src: url };
          },
        });
      });
    });
  });

  const backgroundQuery = preset.section?.backgroundQuery;
  if (backgroundQuery) {
    targets.push({
      query: backgroundQuery,
      apply: (url) => {
        section.backgroundImage = url;
        // A scrim, so white hero text stays readable over a bright photograph.
        const current = typeof section.overlay === 'number' ? section.overlay : 0;
        if (current < 30) section.overlay = 45;
      },
    });
  }

  if (!targets.length) return;
  const urls = await Promise.all(targets.map((target) => sourcePhoto(target.query)));
  urls.forEach((url, index) => {
    if (url) targets[index].apply(url);
  });
}

/**
 * Build a designed section and, for a hero, fetch its photographs.
 *
 * requireTenantId is the control, the same as every other action: the screen
 * that calls this is only reachable signed in with a site open, but nothing about
 * the shape of the call enforces that, so this does.
 */
export async function buildDesignedSectionAction(input: unknown): Promise<DesignedResult> {
  try {
    await requireTenantId();
  } catch {
    return { ok: false, error: 'Open a site first.' };
  }

  const presetId =
    input && typeof input === 'object' ? String((input as Record<string, unknown>).presetId ?? '') : '';
  const preset = presetById(presetId);
  if (!preset) return { ok: false, error: 'We could not find that design.' };

  const section = buildPresetSection(preset);

  if (preset.category === 'hero') {
    try {
      await fillHeroPhotos(preset, section);
    } catch {
      // The whole fill is best effort, so a failure here still hands back the
      // image-ready section rather than nothing.
    }
  }

  return { ok: true, section };
}
