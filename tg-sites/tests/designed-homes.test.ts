/**
 * The ten designed homepages, offered as get-started templates (Andy, 19 Aug
 * 2026).
 *
 * These are not starter pages: they carry finished sample copy and pictures a
 * client replaces, rather than naming a preset and prompting for the words. So
 * the risks are the starter's, plus one of their own.
 *
 * 1. A HOLE IN A SHIPPED TEMPLATE. Because these fill blocks by walking a built
 *    preset, a block a builder forgets to fill keeps the preset's own prompt
 *    copy, and "Short title" or "One line on this point" would then ship on a
 *    client's page. starters.test.ts cannot catch that, because it only builds
 *    preset-named pages. The prompt-copy block below is the check that does.
 *
 * 2. A BROKEN PICTURE. A card or a hero with an empty src is a grey box on a
 *    template meant to sell the look. Every picture is checked to be a real
 *    https URL.
 *
 * 3. THE STARTER'S RISKS OVER AGAIN. The page has to parse and survive the
 *    sanitiser byte for byte, on an empty profile, with fresh ids each build.
 *    Held here directly as well as through the two doors, so a change to
 *    designed-homes.ts is caught even if the wiring changes.
 */

import { describe, expect, it } from 'vitest';

import {
  DESIGNED_HOMES,
  designedHomeById,
  designedHomeStarterPage,
} from '../lib/content/designed-homes';
import { createPage as blankPage } from '../lib/content/factory';
import { parsePage, type Block, type Section } from '../lib/content/schema';
import { sanitisePage } from '../lib/content/sanitise-page';
import type { StarterFacts } from '../lib/content/starters';

/** A brand new site: nothing typed. The state that finds the bugs. */
const EMPTY: StarterFacts = { company: '', town: '', about: '' };

function blocks(sections: readonly Section[]): Block[] {
  const found: Block[] = [];
  for (const section of sections) {
    for (const row of section.rows) {
      for (const column of row.columns) found.push(...column.blocks);
    }
  }
  return found;
}

/** Wrap sections in a blank page the way createPage does before it saves. */
function seed(sections: Section[]) {
  return parsePage({ ...blankPage('A page', 'a-page'), sections });
}

describe('the ten designed homes', () => {
  it('gives each a unique id and label, a description and a blurb', () => {
    const ids = DESIGNED_HOMES.map((home) => home.id);
    const labels = DESIGNED_HOMES.map((home) => home.label);
    expect(new Set(ids).size, 'two homes share an id').toBe(ids.length);
    expect(new Set(labels).size, 'two homes share a label').toBe(labels.length);
    for (const home of DESIGNED_HOMES) {
      expect(home.description.length, home.id).toBeGreaterThan(0);
      // The blurb becomes a page's search description, which the report marks
      // down below about forty characters.
      expect(home.blurb.length, home.id).toBeGreaterThan(40);
      expect(designedHomeById(home.id)?.id).toBe(home.id);
    }
    expect(designedHomeById('no-such-home')).toBeUndefined();
  });

  it('builds a real page of several sections each', () => {
    for (const home of DESIGNED_HOMES) {
      const sections = home.build(EMPTY);
      expect(sections.length, `${home.id} is too thin to be a homepage`).toBeGreaterThanOrEqual(4);
    }
  });

  /*
   * THE SAFETY PROPERTY, held here as well as through the two doors: every home
   * parses and comes back from the sanitiser unchanged, on an empty profile.
   */
  it('parses and survives the sanitiser byte for byte', () => {
    for (const home of DESIGNED_HOMES) {
      const parsed = seed(home.build(EMPTY));
      expect(parsed.ok, `${home.id}: ${parsed.ok ? '' : parsed.errors.join('; ')}`).toBe(true);
      if (!parsed.ok) continue;
      expect(sanitisePage(parsed.page), home.id).toEqual(parsed.page);
    }
  });

  it('leaves no {{token}} behind', () => {
    for (const home of DESIGNED_HOMES) {
      expect(JSON.stringify(home.build(EMPTY)), home.id).not.toContain('{{');
    }
  });

  /*
   * NO PRESET PROMPT LEFT UNFILLED. These build by walking a built preset and
   * changing its words, so a block a builder skips keeps the library's own
   * placeholder. Every one of these is a phrase the presets ship and a designed
   * home is meant to overwrite, so finding one is finding a hole.
   */
  it('overwrites every preset prompt it is built on', () => {
    const prompts = [
      'Tagline here',
      'Short title',
      'One line on this point',
      'One line under the title',
      'One line saying what these have in common',
      'One line saying whose pictures these are',
      'This is the text area for this paragraph',
      'One or two lines on who you are',
      'A sentence on what you do differently',
      'On a picture, fewer words is always better',
      'Browse destinations',
      'Where would you like to go?',
      'Start planning',
      'Add the Enquiry or Form widget',
      'Add the Opening Hours widget',
      'Your address, over two or three lines',
      'Your number, and the address people should write to',
    ];
    const left: string[] = [];
    for (const home of DESIGNED_HOMES) {
      const json = JSON.stringify(home.build(EMPTY));
      for (const prompt of prompts) {
        if (json.includes(prompt)) left.push(`${home.id}: "${prompt}"`);
      }
    }
    expect(left, 'these ship a preset prompt instead of the design copy').toEqual([]);
  });

  /*
   * EVERY PICTURE IS A REAL ONE. A card, hero background or gallery tile with an
   * empty src is a grey box on the very page meant to sell the look. Whatever a
   * block calls its picture, if it is empty on one of these it is a bug.
   */
  it('names a real https picture wherever it shows one', () => {
    const bad: string[] = [];
    for (const home of DESIGNED_HOMES) {
      const sections = home.build(EMPTY);

      for (const section of sections) {
        if (section.backgroundImage !== undefined && !/^https:\/\//.test(section.backgroundImage)) {
          bad.push(`${home.id}: section background "${section.backgroundImage}"`);
        }
      }

      for (const block of blocks(sections)) {
        if (block.type === 'image' && !/^https:\/\//.test(String(block.props.src ?? ''))) {
          bad.push(`${home.id}: image "${String(block.props.src)}"`);
        }
        if (block.type === 'cards') {
          for (const item of (block.props.items as Array<{ src?: string }>) ?? []) {
            if (!/^https:\/\//.test(String(item.src ?? ''))) bad.push(`${home.id}: card "${item.src}"`);
          }
        }
        if (block.type === 'gallery') {
          for (const image of (block.props.images as Array<{ src?: string }>) ?? []) {
            if (!/^https:\/\//.test(String(image.src ?? ''))) bad.push(`${home.id}: gallery "${image.src}"`);
          }
        }
      }
    }
    expect(bad, 'these picture slots are empty on a template meant to show the look').toEqual([]);
  });

  /*
   * A FRESH TREE EACH TIME. Two sites seeded from one home must not share a
   * section id, or the editor would edit the wrong one.
   */
  it('mints new ids on every build', () => {
    for (const home of DESIGNED_HOMES) {
      const a = home.build(EMPTY);
      const b = home.build(EMPTY);
      expect(a[0].id, home.id).toBeTruthy();
      expect(a[0].id, home.id).not.toBe(b[0].id);
    }
  });
});

describe('a designed home as a StarterPage', () => {
  it('is the home page, in the menu, built by its hook and naming no preset', () => {
    for (const home of DESIGNED_HOMES) {
      const page = designedHomeStarterPage(home);
      expect(page.slug, home.id).toBe('');
      expect(page.menu, home.id).toBe('Home');
      expect(page.sections, home.id).toEqual([]);
      expect(typeof page.build, home.id).toBe('function');
      expect(page.description, home.id).toBe(home.blurb);
    }
  });
});
