/**
 * Adding a page, started from a ready-made one (Andy, 14 Aug 2026).
 *
 * A page template does not restate a page, it NAMES one the site starter
 * already builds. So the risks here are the starter's risks over again, plus
 * the ones this thin layer adds on top.
 *
 * 1. DRIFT. A template points at an agency starter page by its slug. Rename or
 *    drop that page and the template points at nothing. It is built to throw at
 *    module load if so, and this file proves the throw does not fire for the set
 *    we ship, so a rename is caught here rather than at a client's Add page
 *    click.
 *
 * 2. A TOKEN OR A BAD SECTION REACHING A NEW PAGE. The sections seed a real
 *    page, so a {{company}} left in a heading, or a section the schema rejects,
 *    would land on somebody's site. Every template is built with an EMPTY
 *    profile, the state a brand new site is in, and checked to parse and survive
 *    the sanitiser unchanged.
 *
 * 3. THE BROWSER CHOOSING THE CONTENT. The id is the only thing that crosses
 *    from the page. It is looked up against the closed list server side, so a
 *    caller cannot post markup of their own and have it seeded. The last block
 *    reads the action and the query to hold that line.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { createPage as blankPage } from '../lib/content/factory';
import { parsePage, type Section } from '../lib/content/schema';
import { sanitisePage } from '../lib/content/sanitise-page';
import {
  PAGE_TEMPLATES,
  pageTemplateById,
  pageTemplateSections,
} from '../lib/content/page-templates';

function read(...parts: string[]): string {
  return readFileSync(join(__dirname, '..', ...parts), 'utf8');
}

/** Every template that builds a page, i.e. not Blank. */
const DESIGNED = PAGE_TEMPLATES.filter((template) => template.page);

/** Wrap a set of sections in a blank page the way createPage does before it saves. */
function seed(sections: Section[]) {
  return parsePage({ ...blankPage('A page', 'a-page'), sections });
}

// ---------------------------------------------------------------------------
// The registry
// ---------------------------------------------------------------------------

describe('the list of templates', () => {
  /*
   * BLANK FIRST, and it is the only one with no page. The composer opens on it,
   * so the safe do-nothing choice is the default and the eye lands on it first.
   */
  it('opens with a blank page that builds nothing', () => {
    expect(PAGE_TEMPLATES[0].id).toBe('blank');
    expect(PAGE_TEMPLATES[0].page).toBeNull();
  });

  /*
   * THE ONE THIS FILE EXISTS FOR. agencyPage() throws at module load on a slug
   * the starter no longer has, so merely importing the module above already
   * proves every designed template resolves. This states it as a claim: a
   * designed template carries a real page with sections in it.
   */
  it('names starter pages that exist, each with sections', () => {
    expect(DESIGNED.length).toBeGreaterThan(0);
    for (const template of DESIGNED) {
      expect(template.page, template.id).toBeTruthy();
      expect(template.page!.sections.length, template.id).toBeGreaterThan(0);
    }
  });

  it('gives every template its own id, and a label and a line to read', () => {
    const ids = PAGE_TEMPLATES.map((template) => template.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const template of PAGE_TEMPLATES) {
      expect(template.label.length, template.id).toBeGreaterThan(0);
      expect(template.description.length, template.id).toBeGreaterThan(0);
    }
  });

  it('can be looked up by id, and says nothing for one it does not know', () => {
    for (const template of PAGE_TEMPLATES) {
      expect(pageTemplateById(template.id)?.id).toBe(template.id);
    }
    expect(pageTemplateById('no-such-template')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// The sections it hands to a new page
// ---------------------------------------------------------------------------

describe('the sections a template seeds', () => {
  /*
   * BLANK, AND ANYTHING UNKNOWN, BUILD NOTHING. Null is the signal db/pages.ts
   * reads to take its old blank path untouched. An unknown id folding to Blank
   * is what stops a stale or hostile pick from blocking a create.
   */
  it('is null for a blank page', () => {
    expect(pageTemplateSections('blank')).toBeNull();
  });

  it('is null for an id it does not recognise', () => {
    expect(pageTemplateSections('no-such-template')).toBeNull();
    expect(pageTemplateSections('')).toBeNull();
  });

  /*
   * THE SAFETY PROPERTY. These sections seed a live page, so for every designed
   * template they must parse and come through the sanitiser byte for byte. Built
   * with an EMPTY profile, since that is the state of the brand new site doing
   * the adding.
   */
  it('seeds a page the schema accepts and the sanitiser leaves alone', () => {
    for (const template of DESIGNED) {
      const sections = pageTemplateSections(template.id);
      expect(sections, template.id).toBeTruthy();

      const parsed = seed(sections!);
      expect(parsed.ok, `${template.id}: ${parsed.ok ? '' : parsed.errors.join('; ')}`).toBe(true);
      if (!parsed.ok) continue;

      expect(sanitisePage(parsed.page), template.id).toEqual(parsed.page);
    }
  });

  /*
   * NEVER A TOKEN ON THE PAGE. {{company}} printed literally in a heading on a
   * travel agent's own new page is the most embarrassing thing this can do, and
   * an empty profile is exactly when it would happen.
   */
  it('leaves no {{token}} behind on an empty profile', () => {
    for (const template of DESIGNED) {
      const sections = pageTemplateSections(template.id);
      expect(JSON.stringify(sections), template.id).not.toContain('{{');
    }
  });

  /*
   * A FRESH TREE EACH TIME. Two pages seeded from one template must not share a
   * section id, or the editor would edit the wrong one.
   */
  it('mints new ids on every build', () => {
    const a = pageTemplateSections('home');
    const b = pageTemplateSections('home');
    expect(a?.[0]?.id).toBeTruthy();
    expect(a?.[0]?.id).not.toBe(b?.[0]?.id);
  });
});

// ---------------------------------------------------------------------------
// The line held on the server, read as source
// ---------------------------------------------------------------------------

describe('the id is the only thing that crosses from the browser', () => {
  const action = read('app', 'actions', 'pages.ts');
  const panel = read('components', 'editor', 'PagesPanel.tsx');

  /*
   * THE ACTION LOOKS THE ID UP, it does not take sections from the caller.
   * createPageAction reads a template id and asks the closed registry for the
   * sections, so nothing a caller posts becomes page content except by naming a
   * template we built.
   */
  it('builds the sections from the id, not from the request', () => {
    expect(action).toContain('pageTemplateSections(String(input.template');
    // The action's input is a title, a slug, a parent and a template id. A
    // caller-supplied `sections` on the action would be the hole this closes.
    expect(action).not.toMatch(/input\.sections/);
  });

  /*
   * THE BROWSER SENDS AN ID, nothing more. The composer posts the selected
   * template's id string; the page objects live server side.
   */
  it('has the composer send a template id string', () => {
    expect(panel).toContain('onCreatePage(title, template)');
    expect(panel).toContain("useState('blank')");
  });
});

describe('what reaches the database, read as source', () => {
  const source = read('lib', 'db', 'pages.ts');
  const create = source.slice(source.indexOf('export async function createPage'));

  /*
   * TEMPLATE SECTIONS ARE STILL PARSED AND SANITISED. Ours or not, they are
   * treated like every other write before a byte is stored.
   */
  it('parses and sanitises the seeded sections before saving', () => {
    expect(create).toContain('parsePage({ ...base, sections: input.sections })');
    expect(create).toContain('content = sanitisePage(parsed.page)');
  });

  /*
   * AND FALLS BACK TO BLANK. A section set that somehow fails the schema builds
   * the blank page rather than refusing the create, and the blank path is
   * byte-for-byte what it always was.
   */
  it('keeps the untouched blank page when there are no sections or they fail', () => {
    expect(create).toContain('let content = sanitisePage(base);');
    expect(create).toContain('if (input.sections && input.sections.length > 0)');
    expect(create).toContain('if (parsed.ok) content = sanitisePage(parsed.page);');
  });
});
