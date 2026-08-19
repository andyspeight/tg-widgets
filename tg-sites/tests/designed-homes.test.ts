/**
 * The ten designed homepages, offered as get-started templates (Andy, 19 Aug
 * 2026).
 *
 * These carry each concept's OWN design, frozen through the import pipeline, so a
 * client who picks one gets it pixel for pixel with the words and pictures
 * editable. The risks are the import block's, plus the ones a shipped, seeded
 * design adds.
 *
 * 1. A DESIGN THAT WILL NOT SEED. Every home has to parse and come back from the
 *    sanitiser unchanged, on an empty profile, or a client picks a template and
 *    the create silently falls back to a blank page.
 *
 * 2. TWO SITES SHARING AN ID. The JSON is baked with fixed ids. If remint did not
 *    rewrite them, two sites seeded from one design would share section ids and
 *    the editor would edit the wrong one. The css scope has to move with the id.
 *
 * 3. A PICTURE THAT DOES NOT LOAD. A template meant to sell a look with an empty
 *    or unsafe image slot is a broken shop window. Every image slot is a real
 *    https or data picture.
 */

import { describe, expect, it } from 'vitest';

import { DESIGNED_HOME_META, designedHomeMeta } from '../lib/content/designed-homes-meta';
import { designedHomeSections } from '../lib/content/designed-homes';
import { designedHomeStarterPage } from '../lib/content/starters';
import { createPage as blankPage } from '../lib/content/factory';
import { parsePage, type Block, type Section } from '../lib/content/schema';
import { sanitisePage } from '../lib/content/sanitise-page';

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

describe('the ten designed homes, as metadata', () => {
  it('gives each a unique id and label, a description, a blurb and fonts', () => {
    const ids = DESIGNED_HOME_META.map((home) => home.id);
    const labels = DESIGNED_HOME_META.map((home) => home.label);
    expect(DESIGNED_HOME_META.length).toBe(10);
    expect(new Set(ids).size, 'two homes share an id').toBe(ids.length);
    expect(new Set(labels).size, 'two homes share a label').toBe(labels.length);
    for (const home of DESIGNED_HOME_META) {
      expect(home.description.length, home.id).toBeGreaterThan(0);
      // The blurb becomes a page's search description, which the report marks
      // down below about forty characters.
      expect(home.blurb.length, home.id).toBeGreaterThan(40);
      expect(home.fonts.length, `${home.id} names no fonts`).toBeGreaterThan(0);
      expect(designedHomeMeta(home.id)?.id).toBe(home.id);
    }
    expect(designedHomeMeta('no-such-home')).toBeUndefined();
  });
});

describe('the frozen sections a designed home builds', () => {
  it('gives back nothing for an id it does not know', () => {
    expect(designedHomeSections('no-such-home')).toEqual([]);
  });

  it('builds a real design of imported sections for every home', () => {
    for (const home of DESIGNED_HOME_META) {
      const sections = designedHomeSections(home.id);
      expect(sections.length, `${home.id} is empty`).toBeGreaterThan(0);
      // Each section is a single frozen imported block: that is what keeps the
      // design pixel for pixel with its words and pictures editable.
      for (const block of blocks(sections)) {
        expect(block.type, home.id).toBe('imported');
      }
    }
  });

  /*
   * THE SAFETY PROPERTY. Frozen or not, these seed a live page, so every one
   * parses and comes back from the sanitiser byte for byte. The bake sanitises
   * each block and remint keeps the css scoped to the block's id, so this holds.
   */
  it('parses and survives the sanitiser byte for byte', () => {
    for (const home of DESIGNED_HOME_META) {
      const parsed = seed(designedHomeSections(home.id));
      expect(parsed.ok, `${home.id}: ${parsed.ok ? '' : parsed.errors.join('; ')}`).toBe(true);
      if (!parsed.ok) continue;
      expect(sanitisePage(parsed.page), home.id).toEqual(parsed.page);
    }
  });

  /*
   * NO STARTER TOKEN ON THE PAGE. The frozen markup carries {{tg:...}} import
   * slots, which are meant to be there, so the check is for the starter tokens
   * fill() resolves ({{company}} and friends), which must never appear.
   */
  it('carries no unresolved starter token', () => {
    for (const home of DESIGNED_HOME_META) {
      const json = JSON.stringify(designedHomeSections(home.id));
      expect(json, home.id).not.toMatch(/\{\{\s*(company|town|about)\b/);
    }
  });

  /*
   * A FRESH TREE EACH TIME, ids and css scope together. Two sites seeded from one
   * design must not share a section id, and the imported block's styling must
   * follow its new id or the section would render unstyled.
   */
  it('mints new ids, and moves the css scope with them, on every build', () => {
    for (const home of DESIGNED_HOME_META) {
      const a = designedHomeSections(home.id);
      const b = designedHomeSections(home.id);
      expect(a[0].id, home.id).not.toBe(b[0].id);

      const blockA = a[0].rows[0].columns[0].blocks[0];
      expect(String(blockA.props.css), `${home.id} scope`).toContain(`tgi-${blockA.id}`);
      const blockB = b[0].rows[0].columns[0].blocks[0];
      expect(blockA.id, home.id).not.toBe(blockB.id);
      expect(String(blockB.props.css), `${home.id} scope b`).toContain(`tgi-${blockB.id}`);
    }
  });

  /*
   * EVERY PICTURE IS A REAL ONE. An imported block keeps its pictures as image
   * slots; an empty or unsafe one on a template meant to show a look is a bug.
   */
  it('names a real https or data picture in every image slot', () => {
    const bad: string[] = [];
    for (const home of DESIGNED_HOME_META) {
      for (const block of blocks(designedHomeSections(home.id))) {
        const fields = (block.props.fields as Array<{ kind: string; value: string }>) ?? [];
        for (const field of fields) {
          if (field.kind !== 'image') continue;
          if (!/^(https:\/\/|data:image\/)/.test(String(field.value ?? ''))) {
            bad.push(`${home.id}: "${String(field.value).slice(0, 40)}"`);
          }
        }
      }
    }
    expect(bad, 'these image slots are empty or unsafe on a template meant to show the look').toEqual([]);
  });
});

describe('a designed home as a StarterPage', () => {
  it('is the home page, in the menu, built by a hook and naming no preset', () => {
    for (const home of DESIGNED_HOME_META) {
      const page = designedHomeStarterPage(home);
      expect(page.slug, home.id).toBe('');
      expect(page.menu, home.id).toBe('Home');
      expect(page.sections, home.id).toEqual([]);
      expect(typeof page.build, home.id).toBe('function');
      expect(page.description, home.id).toBe(home.blurb);
    }
  });

  it('builds the same frozen sections through its hook as the direct call', async () => {
    const home = DESIGNED_HOME_META[0];
    const viaHook = await designedHomeStarterPage(home).build!({ company: '', town: '', about: '' });
    const direct = designedHomeSections(home.id);
    expect(viaHook.length).toBe(direct.length);
    expect(viaHook[0].rows[0].columns[0].blocks[0].type).toBe('imported');
  });
});
