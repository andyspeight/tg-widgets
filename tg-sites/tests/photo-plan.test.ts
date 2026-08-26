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

  it('does not point the inline picture at the background it is already steering', () => {
    // One subject, one background: the same photograph twice on one section is
    // the failure the precedence exists to avoid.
    const preset = presetById('hero-page-banner')!;
    const targets = sectionPhotoTargets(preset, 0, 'antigua harbour dusk');
    const images = targets.filter((target) => target.place.kind === 'image');
    for (const image of images) {
      expect(image.query).not.toBe('antigua harbour dusk');
    }
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
