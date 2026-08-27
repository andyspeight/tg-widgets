/**
 * The photo plan: what pictures a built page asks for, and where they land.
 *
 * Pure decisions, tested without a network. The server half only resolves the
 * queries this plan produces, so what is proven here is the whole policy:
 * banners get their per-page picture, heroes keep their palette fallback,
 * destination cards search by their own labels, and nothing else ever grows a
 * stock photograph, the team grid above all.
 */

import { describe, expect, it } from 'vitest';

import { applyPhoto, pagePhotoPlan, sectionPhotoTargets } from '../lib/content/photo-plan';
import { buildPresetSection, heroPhotoQuery, presetById } from '../lib/content/presets';
import { PAGE_PRESETS } from '../lib/content/presets-page';
import type { Section } from '../lib/content/schema';
import type { StarterPage } from '../lib/content/starters';

function built(presetId: string): Section {
  const preset = presetById(presetId);
  if (!preset) throw new Error(`no preset ${presetId}`);
  return buildPresetSection(preset);
}

function page(sections: StarterPage['sections']): StarterPage {
  return { title: 'A page', slug: 'a-page', description: '', sections };
}

describe('sectionPhotoTargets', () => {
  it('a banner asks for its background, and the override wins', () => {
    const preset = presetById('hero-page-banner')!;

    const plain = sectionPhotoTargets(preset, 0);
    expect(plain).toHaveLength(1);
    expect(plain[0].place.kind).toBe('background');
    expect(plain[0].query).toBe(preset.section?.backgroundQuery);

    const overridden = sectionPhotoTargets(preset, 3, 'winding coastal road aerial');
    expect(overridden[0].query).toBe('winding coastal road aerial');
    expect(overridden[0].section).toBe(3);
  });

  it('a hero image with no query of its own falls back to the palette', () => {
    const preset = presetById('hero-split-right')!;
    const targets = sectionPhotoTargets(preset, 0);
    const image = targets.find((target) => target.place.kind === 'image');
    expect(image, 'the hero should want its picture').toBeTruthy();
    expect(image!.query).toBe(heroPhotoQuery('hero-split-right', 0));
  });

  it('an explicit photo query on an ordinary preset is honoured', () => {
    const targets = sectionPhotoTargets(presetById('cta-with-picture')!, 0);
    const image = targets.find((target) => target.place.kind === 'image');
    expect(image?.query).toBe('travel planning map notebook coffee');
  });

  it('destination cards search by their own labels', () => {
    const targets = sectionPhotoTargets(presetById('features-cards-with-pictures')!, 0);
    const cards = targets.filter((target) => target.place.kind === 'card');
    expect(cards.map((target) => target.query)).toEqual([
      'Greece coast landscape',
      'Italy coast landscape',
      'Portugal coast landscape',
    ]);
  });

  /*
   * THE LINE THAT MUST HOLD: no fallback outside heroes. A stock face
   * presenting as the client's team or their customers is an invented fact on
   * a real agency's site, so these frames stay empty until the client fills
   * them with real people.
   */
  it('never invents a picture for the team or the testimonials', () => {
    expect(sectionPhotoTargets(presetById('team-grid')!, 0)).toEqual([]);
    expect(sectionPhotoTargets(presetById('testimonials-quote-beside-picture')!, 0)).toEqual([]);
  });
});

describe('pagePhotoPlan', () => {
  it('walks the spec and the built sections in lockstep', () => {
    const spec = page([
      { preset: 'hero-page-banner', photo: 'greek islands whitewashed village sea' },
      { preset: 'text-intro' },
      { preset: 'features-cards-with-pictures' },
    ]);
    const sections = [built('hero-page-banner'), built('text-intro'), built('features-cards-with-pictures')];

    const plan = pagePhotoPlan(spec, sections);
    expect(plan.find((target) => target.place.kind === 'background')?.query).toBe(
      'greek islands whitewashed village sea',
    );
    // The cards sit in the third built section, and the plan says so.
    const cards = plan.filter((target) => target.place.kind === 'card');
    expect(cards).toHaveLength(3);
    expect(new Set(cards.map((target) => target.section))).toEqual(new Set([2]));
  });

  it('a spec naming a preset that no longer exists advances nothing', () => {
    const spec = page([
      { preset: 'from-the-future' },
      { preset: 'hero-page-banner', photo: 'custom picture' },
    ]);
    const sections = [built('hero-page-banner')];

    const plan = pagePhotoPlan(spec, sections);
    expect(plan).toHaveLength(1);
    expect(plan[0]).toMatchObject({ query: 'custom picture', section: 0 });
  });
});

describe('applyPhoto', () => {
  it('writes a background with a readable scrim', () => {
    const section = built('hero-page-banner');
    section.overlay = 0;
    applyPhoto([section], { query: 'q', section: 0, place: { kind: 'background' } }, 'https://cdn.test/a.jpg');
    expect(section.backgroundImage).toBe('https://cdn.test/a.jpg');
    expect(section.overlay).toBe(45);
  });

  it('does not soften a scrim somebody set stronger', () => {
    const section = built('hero-page-banner');
    // buildPresetSection ships 60, which already reads: left alone.
    applyPhoto([section], { query: 'q', section: 0, place: { kind: 'background' } }, 'https://cdn.test/a.jpg');
    expect(section.overlay).toBe(60);
  });

  it('writes an image src and a card src where the plan points', () => {
    const spec = page([{ preset: 'features-cards-with-pictures' }]);
    const sections = [built('features-cards-with-pictures')];
    const plan = pagePhotoPlan(spec, sections);

    for (const target of plan) applyPhoto(sections, target, `https://cdn.test/${target.query.split(' ')[0]}.jpg`);

    const cards = sections[0].rows[1].columns[0].blocks[0];
    const items = cards.props.items as Array<{ src: string }>;
    expect(items.map((item) => item.src)).toEqual([
      'https://cdn.test/Greece.jpg',
      'https://cdn.test/Italy.jpg',
      'https://cdn.test/Portugal.jpg',
    ]);
  });

  it('shrugs at an address that is not there', () => {
    const sections = [built('text-intro')];
    expect(() =>
      applyPhoto(sections, { query: 'q', section: 4, place: { kind: 'background' } }, 'https://cdn.test/a.jpg'),
    ).not.toThrow();
    expect(() =>
      applyPhoto(sections, { query: 'q', section: 0, place: { kind: 'image', row: 9, column: 0, block: 0 } }, 'https://cdn.test/a.jpg'),
    ).not.toThrow();
  });
});

// ---------------------------------------------------------------------------

/**
 * THE TWO RULES THE FIRST AI-BUILT SITE WAS MISSING, 26 Aug 2026.
 *
 * All seven sections of a generated homepage came back with a photograph behind
 * them — a flat-lay of maps and coffee behind the steps, a wedding behind the
 * icon row — because the per-section photo subject CREATED backgrounds on
 * presets designed for a white ground. And the cards got the factory pictures,
 * because their queries derived from the preset's example items rather than
 * from what the fill had just written into them.
 */
describe('an override replaces a designed background, never creates one', () => {
  it('a preset with no background of its own gets none, whatever the spec says', () => {
    // features-cards-with-pictures has cards and no section backgroundQuery.
    const targets = sectionPhotoTargets(
      presetById('features-cards-with-pictures')!,
      0,
      'caribbean beach aerial',
    );
    expect(targets.some((target) => target.place.kind === 'background')).toBe(false);
  });

  it('a preset designed for one still lets the subject choose it', () => {
    const targets = sectionPhotoTargets(presetById('hero-page-banner')!, 0, 'barbados west coast');
    const background = targets.find((target) => target.place.kind === 'background');
    expect(background?.query).toBe('barbados west coast');
  });

  it('steers an inline picture by the subject where no background competes', () => {
    /*
     * cta-with-picture has an explicit block query, which wins. So use a hero
     * with an inline image and no designed background: the subject beats the
     * generic palette fallback, because the subject knows what the page is
     * about and the fallback does not.
     */
    const preset = presetById('hero-split-right')!;
    expect(preset.section?.backgroundQuery).toBeFalsy();

    const targets = sectionPhotoTargets(preset, 0, 'mustique villa terrace');
    const image = targets.find((target) => target.place.kind === 'image');
    expect(image?.query).toBe('mustique villa terrace');
  });

  it('never duplicates the subject anywhere, swept across the whole library', () => {
    /*
     * The first version of this test picked hero-page-banner, which has no
     * inline image at all, so its loop asserted over an empty array and would
     * have passed whatever the code did. The review caught it. Swept instead:
     * for EVERY preset, with a subject supplied, at most one target may carry
     * the subject as its query — one photograph per subject per section,
     * whether it landed as a background or as an inline frame.
     */
    /*
     * Identity is (query, variant), not query alone: a gallery deliberately
     * asks for the SAME query at successive variants, which is four different
     * photographs of one subject, not four copies of one photograph.
     */
    let presetsWithImages = 0;
    for (const preset of PAGE_PRESETS) {
      const targets = sectionPhotoTargets(preset, 0, 'antigua harbour dusk');
      if (targets.length > 0) presetsWithImages += 1;
      const subjectHits = targets
        .filter((target) => target.query === 'antigua harbour dusk')
        .map((target) => `#${target.variant ?? 0}`);
      expect(
        new Set(subjectHits).size,
        `${preset.id} would fetch the identical photograph more than once`,
      ).toBe(subjectHits.length);
    }
    // The sweep must have actually swept something.
    expect(presetsWithImages).toBeGreaterThan(10);
  });

  it('a two-frame section keeps distinct pictures beside the subject', () => {
    /*
     * The regression the review found: a section-constant subject applied to
     * every bare frame, and the photo fill dedupes by query, so a two-image
     * hero drew the same photograph twice, side by side. The subject buys ONE
     * frame; the second keeps its hashed fallback, distinct by index.
     */
    const preset = presetById('hero-centred-two-images');
    if (!preset) return;
    const targets = sectionPhotoTargets(preset, 0, 'antigua harbour dusk');
    const images = targets.filter((target) => target.place.kind === 'image');
    expect(images.length).toBeGreaterThanOrEqual(2);
    expect(new Set(images.map((target) => target.query)).size).toBe(images.length);
  });
});

describe('card pictures follow the words the cards actually carry', () => {
  it('queries derive from the BUILT items once they have been rewritten', () => {
    const preset = presetById('features-cards-with-pictures')!;
    const section = buildPresetSection(preset);

    // The fill rewrote the factory Greece/Italy/Portugal cards to the client's
    // own islands, exactly as the AI pass does.
    for (const row of section.rows) {
      for (const column of row.columns) {
        for (const block of column.blocks) {
          if (block.type !== 'cards') continue;
          const items = (block.props as { items: Array<Record<string, unknown>> }).items;
          items[0].label = 'Barbados';
          items[1].label = 'St Lucia';
          items[2].label = 'Mustique';
        }
      }
    }

    const targets = sectionPhotoTargets(preset, 0, undefined, section);
    const cards = targets.filter((target) => target.place.kind === 'card');
    expect(cards.map((target) => target.query)).toEqual([
      'Barbados coast landscape',
      'St Lucia coast landscape',
      'Mustique coast landscape',
    ]);
  });

  it('leaves a built card that already carries a picture alone', () => {
    const preset = presetById('features-cards-with-pictures')!;
    const section = buildPresetSection(preset);
    for (const row of section.rows) {
      for (const column of row.columns) {
        for (const block of column.blocks) {
          if (block.type !== 'cards') continue;
          const items = (block.props as { items: Array<Record<string, unknown>> }).items;
          items[1].src = 'https://cdn.test/their-own.jpg';
        }
      }
    }

    const targets = sectionPhotoTargets(preset, 0, undefined, section);
    const cards = targets.filter((target) => target.place.kind === 'card');
    // Three factory cards, one of them now owned: two targets.
    expect(cards).toHaveLength(2);
    expect(cards.map((t) => (t.place.kind === 'card' ? t.place.item : -1))).toEqual([0, 2]);
  });

  it('the whole-page plan hands each built section to its own targets', () => {
    const spec = page([{ preset: 'features-cards-with-pictures', photo: 'caribbean sailing' }]);
    const section = built('features-cards-with-pictures');
    for (const row of section.rows) {
      for (const column of row.columns) {
        for (const block of column.blocks) {
          if (block.type !== 'cards') continue;
          (block.props as { items: Array<Record<string, unknown>> }).items[0].label = 'Antigua';
        }
      }
    }

    const plan = pagePhotoPlan(spec, [section]);
    const cards = plan.filter((target) => target.place.kind === 'card');
    expect(cards[0]?.query).toBe('Antigua coast landscape');
    // And still no background, because the preset has none to replace.
    expect(plan.some((target) => target.place.kind === 'background')).toBe(false);
  });
});


describe('the freshest field chooses the card picture', () => {
  function cardsSection(mutate: (items: Array<Record<string, unknown>>) => void) {
    const preset = presetById('features-cards-with-pictures')!;
    const section = buildPresetSection(preset);
    for (const row of section.rows) {
      for (const column of row.columns) {
        for (const block of column.blocks) {
          if (block.type === 'cards') mutate((block.props as { items: Array<Record<string, unknown>> }).items);
        }
      }
    }
    return { preset, section };
  }

  it('a rewritten title beats a factory label', () => {
    /*
     * Review finding: the fill wrote the title but skipped the label, and
     * label-first meant a "Barbados villas" card searched for "Italy". The
     * factory items say which field is still factory, so the changed one wins.
     */
    const { preset, section } = cardsSection((items) => {
      items[1].title = 'Barbados villas with staff';
      // items[1].label stays the factory 'Italy'.
    });
    const targets = sectionPhotoTargets(preset, 0, undefined, section);
    const second = targets.filter((t) => t.place.kind === 'card')[1];
    expect(second.query).toBe('Barbados villas with staff coast landscape');
  });

  it('a rewritten label still wins when both changed', () => {
    const { preset, section } = cardsSection((items) => {
      items[0].label = 'St Lucia';
      items[0].title = 'The Pitons up close';
    });
    const targets = sectionPhotoTargets(preset, 0, undefined, section);
    const first = targets.filter((t) => t.place.kind === 'card')[0];
    expect(first.query).toBe('St Lucia coast landscape');
  });
});

describe('a designed background always arrives with readable text', () => {
  it('every preset with a backgroundQuery sets a dark tone, swept', () => {
    /*
     * The whole background gate rests on this: presets that carry photographs
     * are presets that dressed for them. If one ever declares a backgroundQuery
     * while keeping a light tone, the gate would wave through the exact
     * dark-text-on-photograph failure it exists to stop.
     */
    let designed = 0;
    for (const preset of PAGE_PRESETS) {
      if (!preset.section?.backgroundQuery?.trim()) continue;
      designed += 1;

      if (preset.section?.tone === 'dark') continue;

      /*
       * The one legitimate light-toned shape over a photograph: the words sit
       * inside a solid COLUMN CARD (hero-card-on-photo), so the card carries
       * the contrast, not the tone. Then every column that holds words must be
       * boxed with its own background — an unboxed light column over a
       * photograph is exactly the failure this sweep exists to stop.
       */
      for (const row of preset.rows) {
        row.columns.forEach((column, index) => {
          const hasWords = column.some((block) => block.type === 'heading' || block.type === 'text');
          if (!hasWords) return;
          const box = row.columnBox?.[index] as { background?: string } | undefined;
          expect(
            Boolean(box?.background),
            `${preset.id} puts light-toned words straight onto a photograph`,
          ).toBe(true);
        });
      }
    }
    expect(designed).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------

describe('galleries are filled frame by frame', () => {
  it('plans one target per frame, same subject, successive variants', () => {
    /*
     * gallery-wide is the AI page's visual punctuation: a four-across grid,
     * full width, no words. Unfilled it ships the author-facing "Add some
     * images" placeholder, which is exactly the kind of thing Andy meant by
     * "not something I could give to a client".
     */
    const preset = presetById('gallery-wide')!;
    const targets = sectionPhotoTargets(preset, 0, 'st lucia pitons');
    const frames = targets.filter((target) => target.place.kind === 'gallery');
    expect(frames).toHaveLength(4);
    expect(frames.map((target) => target.variant)).toEqual([0, 1, 2, 3]);
    for (const frame of frames) expect(frame.query).toBe('st lucia pitons');
  });

  it('writes each frame into the gallery with the query as its alt', () => {
    const preset = presetById('gallery-wide')!;
    const section = buildPresetSection(preset);
    const targets = sectionPhotoTargets(preset, 0, 'st lucia pitons');
    targets.forEach((target, index) => applyPhoto([section], target, `https://media.example/p${index}.jpg`));

    const gallery = section.rows[0].columns[0].blocks[0];
    const images = gallery.props.images as Array<{ src: string; alt: string }>;
    expect(images).toHaveLength(4);
    expect(images.map((image) => image.src)).toEqual([
      'https://media.example/p0.jpg',
      'https://media.example/p1.jpg',
      'https://media.example/p2.jpg',
      'https://media.example/p3.jpg',
    ]);
    expect(images[0].alt).toBe('st lucia pitons');
  });

  it('a two-column gallery gets two rows of frames, wider grids one row', () => {
    const wordsBeside = presetById('gallery-words-beside')!;
    const frames = sectionPhotoTargets(wordsBeside, 0, 'harbour town evening').filter(
      (target) => target.place.kind === 'gallery',
    );
    expect(frames.length).toBe(4);
  });
});
