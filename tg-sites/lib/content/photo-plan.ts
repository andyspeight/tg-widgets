/**
 * What photographs a built page wants, and where each one goes.
 *
 * PURE PLANNING, SPLIT FROM THE FETCHING. This walks a starter page spec and
 * the sections built from it, and says "this section wants a background found
 * by this query; that image block wants a picture found by that one". The
 * server half (lib/media/photo-fill.ts) resolves the queries against the photo
 * library and writes the URLs in; this half owns every decision about WHAT is
 * wanted, so the decisions are testable without a network.
 *
 * Grown out of fillHeroPhotos in app/actions/designed.ts, which walked one
 * hero at a time and only when it was added singly from the section drawer.
 * That left every page built from a template or the starter wizard with all
 * its frames empty, which is the single biggest reason a fresh site looked
 * amateur (Andy, 19 Aug 2026). The drawer action now plans through here too,
 * so the two doors cannot drift.
 *
 * WHAT GETS A PICTURE, AND WHAT NEVER DOES
 *
 *  - A section background: the spec's own `photo` override first, else the
 *    preset's backgroundQuery. The banner every template page opens with works
 *    this way, so an About banner and a Holidays banner get different pictures
 *    from the same preset.
 *  - An image block: its explicit `photo` query; on a HERO preset an image
 *    with no query falls back to heroPhotoQuery by position, exactly as the
 *    drawer has always behaved.
 *  - A cards block with a `photo` SUFFIX: each card whose src is empty
 *    searches as its own label plus the suffix, so the pictures match the
 *    places the sample copy names.
 *  - Everything else stays empty. In particular there is no fallback outside
 *    heroes: a team grid or a testimonial must never grow a stock face, which
 *    would be inventing people (see the pictures note in presets-page.ts).
 */

import { heroPhotoQuery, presetById } from './presets';
import type { PresetBlock, SectionPreset } from './preset-types';
import type { Section } from './schema';
import type { StarterPage } from './starters';

export interface PhotoTarget {
  /** The search term, ready for the photo library. */
  query: string;
  /**
   * Which of the query's results this target wants. A gallery is several
   * frames of ONE subject, and the same query resolves to the same first
   * photo every time - so each frame asks for the next result instead of
   * four copies of one picture. Absent means the first, as it always did.
   */
  variant?: number;
  /** Index into the built sections array. */
  section: number;
  /** Where the picture lands inside that section. */
  place:
    | { kind: 'background' }
    | { kind: 'image'; row: number; column: number; block: number }
    | { kind: 'card'; row: number; column: number; block: number; item: number }
    | { kind: 'gallery'; row: number; column: number; block: number; frame: number };
}

/**
 * The per-card queries for a cards block carrying a photo suffix.
 *
 * READS THE BUILT ITEMS WHEN IT IS GIVEN THEM, and that is the fix for a fault
 * found on the first AI-built site (26 Aug 2026). The queries used to derive
 * from the PRESET's factory items, and the plan was applied positionally with
 * no re-check — so a card the AI had rewritten to say "Barbados" still received
 * the photograph found for "Italy coast landscape", because Italy is what the
 * factory card said. On a starter build the two are identical, since nothing
 * rewrites the items between build and photos, so starters behave exactly as
 * before.
 *
 * The empty-frame guard runs against the same items for the same reason: it is
 * the BUILT card's src that says whether somebody already gave it a picture.
 */
function cardQueries(
  spec: PresetBlock,
  builtItems?: ReadonlyArray<Record<string, unknown>>,
): Array<string | null> {
  const suffix = spec.photo?.trim();
  if (!suffix) return [];
  const factory = Array.isArray(spec.props?.items) ? (spec.props.items as Array<Record<string, unknown>>) : [];
  const items = builtItems ?? factory;

  const text = (item: Record<string, unknown> | undefined, field: string): string => {
    const value = item?.[field];
    return typeof value === 'string' && value.trim() ? value.trim() : '';
  };

  return items.map((item, index) => {
    // Only a card still showing its empty frame. One that already carries a
    // picture, from the preset or from a pass before this one, is left alone.
    if (typeof item.src === 'string' && item.src.trim()) return null;

    const label = text(item, 'label');
    const title = text(item, 'title');
    /*
     * PREFER THE FIELD THE FILL ACTUALLY CHANGED. A fill that rewrote the title
     * to "Barbados villas" but skipped the label leaves the factory "Italy"
     * sitting there, and label-first would search for Italy on a Barbados card.
     * The factory items say which fields are still factory, so the freshest
     * field wins; when both changed or neither did, label-first as always.
     */
    const was = builtItems ? factory[index] : undefined;
    const labelFresh = was ? label !== text(was, 'label') : true;
    const titleFresh = was ? title !== text(was, 'title') : true;
    const subject =
      (labelFresh ? label : '')
      || (titleFresh ? title : '')
      || label
      || title;
    return subject ? `${subject} ${suffix}` : suffix;
  });
}

/** The items array of the block at this address in the BUILT section, if any. */
function builtItemsAt(
  built: Section | undefined,
  rowIndex: number,
  columnIndex: number,
  blockIndex: number,
): ReadonlyArray<Record<string, unknown>> | undefined {
  const block = built?.rows[rowIndex]?.columns[columnIndex]?.blocks[blockIndex];
  if (!block || block.type !== 'cards') return undefined;
  const items = (block.props as Record<string, unknown> | undefined)?.items;
  return Array.isArray(items) ? (items as Array<Record<string, unknown>>) : undefined;
}

/**
 * The targets for ONE preset-built section.
 *
 * `backgroundOverride` is the starter spec's per-use photo, which wins over the
 * preset's own backgroundQuery. The walk mirrors buildPresetSection exactly, so
 * a row/column/block address computed here lands on the block the preset put
 * there; the image index counts image, video and gallery blocks the same way
 * the picker's preview does, so a hero's fallback pictures match its thumbnail.
 *
 * ONE CAVEAT ON THE AI PATH: stripEyebrows removes eyebrow-role heading blocks
 * from the built sections before photos run, so the mirror holds there only
 * while no image, video, gallery or cards block sits AFTER an eyebrow in the
 * title's own column. True across the whole library today, and pinned by a
 * sweep in tests/ai-page-build.test.ts so the preset that breaks it fails a
 * test instead of quietly dropping its photographs.
 */
export function sectionPhotoTargets(
  preset: SectionPreset,
  sectionIndex: number,
  backgroundOverride?: string,
  built?: Section,
): PhotoTarget[] {
  const targets: PhotoTarget[] = [];
  const isHero = preset.category === 'hero';
  /*
   * WHETHER THIS SECTION WAS DESIGNED TO CARRY A BACKGROUND AT ALL.
   *
   * Decided once, from the preset, because it also decides what the override
   * below is allowed to do and where a subject may steer an inline image.
   */
  const designedBackground = preset.section?.backgroundQuery?.trim() ?? '';
  const subject = backgroundOverride?.trim() ?? '';
  let imageIndex = 0;
  /*
   * THE SUBJECT IS ONE PICTURE, NOT A WALLPAPER ROLL. Review finding, 26 Aug:
   * a section-constant subject applied to every bare frame meant a two-image
   * hero fetched the identical photograph twice, side by side, because the
   * photo fill deduplicates by query. So the subject steers the FIRST bare
   * frame only; the rest keep the hero fallback, whose queries are hashed per
   * index and therefore distinct, exactly as they were before any of this.
   */
  let subjectSpent = false;

  preset.rows.forEach((row, rowIndex) => {
    row.columns.forEach((column, columnIndex) => {
      column.forEach((block, blockIndex) => {
        if (block.type === 'cards') {
          cardQueries(block, builtItemsAt(built, rowIndex, columnIndex, blockIndex)).forEach((query, itemIndex) => {
            if (!query) return;
            targets.push({
              query,
              section: sectionIndex,
              place: { kind: 'card', row: rowIndex, column: columnIndex, block: blockIndex, item: itemIndex },
            });
          });
          return;
        }

        const picture = block.type === 'image' || block.type === 'video' || block.type === 'gallery';
        if (!picture) return;

        const explicit = typeof block.photo === 'string' && block.photo.trim() ? block.photo.trim() : '';
        /*
         * WHAT AN INLINE PICTURE SEARCHES FOR, in order of who knows best.
         *
         * The preset author's explicit query first: it names a specific thing.
         * Then the SECTION SUBJECT (the spec's photo field), but only when the
         * preset has no designed background — where it has one, the subject is
         * already steering that background, and pointing the inline image at
         * the same query would put the same photograph on the section twice.
         * The generic hero fallback comes last, as it always did.
         */
        const steer = !designedBackground && subject && !subjectSpent ? subject : '';
        const query = explicit || steer || (isHero ? heroPhotoQuery(preset.id, imageIndex) : '');
        if (steer && query === steer) subjectSpent = true;
        imageIndex += 1;

        if (!query) return;

        /*
         * A GALLERY IS FILLED FRAME BY FRAME, with the query's successive
         * results. It used to stay empty ("several pictures at once and the
         * client's to choose") - the right answer in the editor, and the wrong
         * one on the AI path, where an unfilled gallery ships the author-facing
         * "Add some images" placeholder on a page nobody has edited yet. Frames
         * follow the grid: a two-column gallery gets four (two rows), wider
         * grids get one row.
         */
        if (block.type === 'gallery') {
          const columns = block.props?.columns === '2' ? 2 : block.props?.columns === '4' ? 4 : 3;
          const frames = columns === 2 ? 4 : columns;
          for (let frame = 0; frame < frames; frame += 1) {
            targets.push({
              query,
              variant: frame,
              section: sectionIndex,
              place: { kind: 'gallery', row: rowIndex, column: columnIndex, block: blockIndex, frame },
            });
          }
          return;
        }

        if (block.type !== 'image') return;

        targets.push({
          query,
          section: sectionIndex,
          place: { kind: 'image', row: rowIndex, column: columnIndex, block: blockIndex },
        });
      });
    });
  });

  /*
   * AN OVERRIDE MAY REPLACE A DESIGNED BACKGROUND, NEVER CREATE ONE.
   *
   * The old line was `backgroundOverride || preset.backgroundQuery`, which let
   * a per-section photo subject CREATE a background on any preset at all. The
   * first AI-built site showed what that means: all seven sections of a
   * homepage got photographs behind them — a flat-lay of maps and coffee
   * behind the steps, a wedding behind the icon row — while their tone stayed
   * light, because those presets were designed for a white ground and nothing
   * else about them changed. Dark text on a darkened photograph, everywhere.
   *
   * A preset that wants a background says so with its own backgroundQuery, and
   * those presets also set the dark tone and the overlay that make text on a
   * photograph readable. So the design question "does this section carry a
   * background" belongs to the preset alone; the override only answers "of
   * what", which is exactly what its doc comment always claimed: it "wins
   * over the preset's own backgroundQuery". Winning over one requires one.
   */
  const background = designedBackground ? (subject || designedBackground) : '';
  if (background) {
    targets.push({ query: background, section: sectionIndex, place: { kind: 'background' } });
  }

  return targets;
}

/**
 * The targets for a whole starter page.
 *
 * The spec's sections and the built ones are walked in lockstep the same way
 * buildStarterPage builds them: a spec whose preset does not exist built
 * nothing, so it advances no section index. A build page (a designed home)
 * names no presets and gets no targets, which is right: its imagery is its own.
 */
export function pagePhotoPlan(spec: StarterPage, sections: readonly Section[]): PhotoTarget[] {
  const targets: PhotoTarget[] = [];
  let sectionIndex = 0;

  for (const entry of spec.sections) {
    const preset = presetById(entry.preset);
    if (!preset) continue;
    if (sectionIndex >= sections.length) break;
    targets.push(...sectionPhotoTargets(preset, sectionIndex, entry.photo, sections[sectionIndex]));
    sectionIndex += 1;
  }

  return targets;
}

/**
 * Write one resolved photograph into the built sections, in place.
 *
 * In place, like every starter mutation: the sections were just built and
 * nothing else holds them. Address misses are ignored rather than thrown,
 * because a plan is advisory and a page without one picture is still a page.
 */
export function applyPhoto(sections: Section[], target: PhotoTarget, url: string): void {
  const section = sections[target.section];
  if (!section) return;

  if (target.place.kind === 'background') {
    section.backgroundImage = url;
    // A scrim, so light hero text stays readable over a bright photograph.
    if ((section.overlay ?? 0) < 30) section.overlay = 45;
    return;
  }

  const { row, column, block } = target.place;
  const found = section.rows[row]?.columns[column]?.blocks[block];
  if (!found) return;

  if (target.place.kind === 'image') {
    if (found.type !== 'image') return;
    found.props = { ...found.props, src: url };
    return;
  }

  if (target.place.kind === 'gallery') {
    if (found.type !== 'gallery') return;
    const images = Array.isArray(found.props.images)
      ? [...(found.props.images as Array<Record<string, unknown>>)]
      : [];
    // Frames land in order; the query doubles as the alt, since it names
    // exactly what the picture was chosen to show.
    images[target.place.frame] = { src: url, alt: target.query };
    found.props = { ...found.props, images };
    return;
  }

  if (found.type !== 'cards') return;
  const items = Array.isArray(found.props.items) ? [...(found.props.items as Array<Record<string, unknown>>)] : [];
  const item = items[target.place.item];
  if (!item) return;
  items[target.place.item] = { ...item, src: url };
  found.props = { ...found.props, items };
}
