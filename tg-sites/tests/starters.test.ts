/**
 * A whole site, arranged for you.
 *
 * WHAT IS ACTUALLY AT RISK, and it is not whether the copy is any good.
 *
 * 1. DRIFT. A starter names presets by id, so renaming or removing a preset
 *    quietly costs a starter a section, and the symptom is a site that arrives
 *    with a hole in it that nobody notices until a client does. Nothing else in
 *    the product would fail. That is what the first block below is for, and it
 *    is the reason a starter is data rather than markup.
 *
 * 2. A TOKEN REACHING A CLIENT'S PAGE. {{company}} rendered literally in a
 *    heading on somebody's website is the most embarrassing failure available
 *    here, and it happens the moment a template forgets its fallback and the
 *    profile is empty. Every template is checked against an EMPTY profile,
 *    which is the state a brand new site is in.
 *
 * 3. THE MENU POINTING AT PAGES THAT DO NOT EXIST. The nav block ships with
 *    Home, Holidays, About us and Contact hardcoded as an example. A starter
 *    that did not overwrite that would launch every site with a menu of three
 *    dead links, and it would look deliberate.
 *
 * 4. PUBLISHING SOMETHING. Every page and both regions are drafts. A site
 *    appearing live on a client's domain, with placeholder copy in it, because
 *    somebody pressed a button in a wizard, is the worst thing this feature
 *    could do.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { buildPresetSection, presetById } from '../lib/content/presets';
import { parsePage, parseRegion, type Block, type Section } from '../lib/content/schema';
import { sanitisePage } from '../lib/content/sanitise-page';
import {
  buildStarterPage,
  buildStarterRegion,
  fill,
  STARTERS,
  STARTER_TOKENS,
  starterById,
  titleBlock,
  type StarterFacts,
} from '../lib/content/starters';

function read(...parts: string[]): string {
  return readFileSync(join(__dirname, '..', ...parts), 'utf8');
}

/** A brand new site: signed up, nothing typed. The state that finds the bugs. */
const EMPTY: StarterFacts = { company: '', town: '', about: '' };

const FILLED: StarterFacts = {
  company: 'Someshop Travel',
  town: 'Leeds',
  about: 'Tailor-made holidays to Greece, for couples and families.',
};

/** Every template string in a starter, wherever it lives. */
function templates(): string[] {
  const found: string[] = [];
  for (const starter of STARTERS) {
    for (const page of starter.pages) {
      found.push(page.title, page.description);
      if (page.menu) found.push(page.menu);
      for (const section of page.sections) {
        if (section.heading) found.push(section.heading);
        if (section.body) found.push(section.body);
      }
    }
  }
  return found;
}

function blocks(sections: readonly Section[]): Block[] {
  const found: Block[] = [];
  for (const section of sections) {
    for (const row of section.rows) {
      for (const column of row.columns) found.push(...column.blocks);
    }
  }
  return found;
}

// ---------------------------------------------------------------------------
// Drift
// ---------------------------------------------------------------------------

describe('a starter is built out of the library, not out of markup', () => {
  /*
   * THE ONE THIS FILE EXISTS FOR. A preset renamed in a tidy-up costs a starter
   * a section, silently, and the site simply arrives with a gap in it.
   */
  it('names only presets that exist', () => {
    const missing: string[] = [];

    for (const starter of STARTERS) {
      for (const id of [starter.header, starter.footer]) {
        if (!presetById(id)) missing.push(`${starter.id}: ${id}`);
      }
      for (const page of starter.pages) {
        for (const section of page.sections) {
          if (!presetById(section.preset)) missing.push(`${starter.id}/${page.slug}: ${section.preset}`);
        }
      }
    }

    expect(missing, 'these presets have been renamed or removed').toEqual([]);
  });

  /*
   * A HEADING OVERRIDE THAT LANDS NOWHERE IS DRIFT, and it is silent: the
   * section builds, the site looks complete, and the words the starter says it
   * writes are simply not there. This is the check for the second half of the
   * bug found by reading what the builder produced on 1 Aug 2026, where the
   * first version wrote a section title over "Opening hours" because that
   * preset has no title heading at all.
   */
  it('only sets a heading on a section that has somewhere to put one', () => {
    const nowhere: string[] = [];

    for (const starter of STARTERS) {
      for (const page of starter.pages) {
        for (const spec of page.sections) {
          if (!spec.heading) continue;
          const preset = presetById(spec.preset);
          if (!preset) continue;
          if (!titleBlock(buildPresetSection(preset))) {
            nowhere.push(`${starter.id}/${page.slug}: ${spec.preset}`);
          }
        }
      }
    }

    expect(nowhere, 'these headings are written and then never seen').toEqual([]);
  });

  /*
   * THE SAME CLAIM FOR THE BODY, and it found three more. A section built out
   * of a quote, or a heading over a row of numbers, has no paragraph in it, so
   * a body override on one is a sentence written in the library and never seen
   * on any site.
   */
  it('only sets a body on a section that has a paragraph in it', () => {
    const nowhere: string[] = [];

    for (const starter of STARTERS) {
      for (const page of starter.pages) {
        for (const spec of page.sections) {
          if (!spec.body) continue;
          const preset = presetById(spec.preset);
          if (!preset) continue;
          const has = blocks([buildPresetSection(preset)]).some((b) => b.type === 'text');
          if (!has) nowhere.push(`${starter.id}/${page.slug}: ${spec.preset}`);
        }
      }
    }

    expect(nowhere, 'these paragraphs are written and then never seen').toEqual([]);
  });

  /*
   * A starter should only override where it has something BETTER to say. An
   * override matching the preset's own words is noise in the data, and the one
   * that repeated "Still not sure?" twice on the FAQ page started as exactly
   * that.
   */
  it('never overrides a heading with the words the preset already used', () => {
    const pointless: string[] = [];

    for (const starter of STARTERS) {
      for (const page of starter.pages) {
        for (const spec of page.sections) {
          if (!spec.heading) continue;
          const preset = presetById(spec.preset);
          if (!preset) continue;
          const original = titleBlock(buildPresetSection(preset));
          if (original && String(original.props.html) === spec.heading) {
            pointless.push(`${starter.id}/${page.slug}: ${spec.preset}`);
          }
        }
      }
    }

    expect(pointless, 'these say what the preset already said').toEqual([]);
  });

  it('uses a header preset for the header and a footer one for the footer', () => {
    for (const starter of STARTERS) {
      expect(presetById(starter.header)?.category, starter.id).toBe('header');
      expect(presetById(starter.footer)?.category, starter.id).toBe('footer');
    }
  });

  /*
   * A page section is scoped to a page. Nothing in the data stops a starter
   * dropping a four-column footer into the middle of the home page, and the
   * result would look like a mistake because it would be one.
   */
  it('never puts site chrome in the middle of a page', () => {
    for (const starter of STARTERS) {
      for (const page of starter.pages) {
        for (const section of page.sections) {
          const category = presetById(section.preset)?.category;
          expect([category, `${starter.id}/${page.slug}`]).not.toContain('header');
          expect([category, `${starter.id}/${page.slug}`]).not.toContain('footer');
        }
      }
    }
  });
});

describe('the starters themselves', () => {
  it('each has an id nothing else uses, and can be looked up by it', () => {
    const ids = STARTERS.map((starter) => starter.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(starterById(id)?.id).toBe(id);
  });

  it('each builds exactly one home page', () => {
    for (const starter of STARTERS) {
      const home = starter.pages.filter((page) => page.slug === '');
      expect(home.length, `${starter.id} has ${home.length} home pages`).toBe(1);
    }
  });

  it('gives every page its own address', () => {
    for (const starter of STARTERS) {
      const slugs = starter.pages.map((page) => page.slug);
      expect(new Set(slugs).size, starter.id).toBe(slugs.length);
    }
  });

  /*
   * A page with no description is a page the visibility report immediately
   * marks as a problem, and a starter that produced those would be building a
   * site its own report tells the client off for.
   */
  it('gives every page a search description', () => {
    for (const starter of STARTERS) {
      for (const page of starter.pages) {
        expect(fill(page.description, FILLED).length, `${starter.id}/${page.slug}`)
          .toBeGreaterThan(40);
      }
    }
  });

  it('says what it will build, so five new pages are not a surprise', () => {
    for (const starter of STARTERS) {
      expect(starter.summary.length, starter.id).toBeGreaterThan(1);
    }
  });
});

// ---------------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------------

describe('filling in the blanks', () => {
  it('uses what it was given', () => {
    expect(fill('Booked with {{company|us}}', FILLED)).toBe('Booked with Someshop Travel');
    expect(fill('We are in {{town|the UK}}', FILLED)).toBe('We are in Leeds');
  });

  it('falls back to what the template itself names', () => {
    expect(fill('Booked with {{company|us}}', EMPTY)).toBe('Booked with us');
  });

  /*
   * EVERY TOKEN CARRIES ITS OWN FALLBACK, because one global default cannot be
   * right in two sentences: "us" works in "Booked with {{company}}" and is
   * nonsense in "{{company}} has been arranging holidays since 1994".
   */
  it('every template in the library names a fallback for every token', () => {
    const naked: string[] = [];

    for (const template of templates()) {
      for (const match of template.matchAll(/\{\{([a-z]+)(\|[^}]*)?\}\}/g)) {
        if (!match[2]) naked.push(`${match[1]} in "${template.slice(0, 50)}"`);
      }
    }

    expect(naked, 'these would leave a hole on a site with an empty profile').toEqual([]);
  });

  it('every token used is one it knows about', () => {
    const unknown: string[] = [];

    for (const template of templates()) {
      for (const match of template.matchAll(/\{\{([a-z]+)/g)) {
        if (!(STARTER_TOKENS as readonly string[]).includes(match[1])) unknown.push(match[1]);
      }
    }

    expect(unknown, 'these would be printed on the page exactly as typed').toEqual([]);
  });

  /*
   * THE MOST EMBARRASSING FAILURE AVAILABLE HERE: {{company}} rendered
   * literally, in a heading, on a travel agent's own website. Checked against
   * an EMPTY profile, which is the state a brand new site is in.
   */
  it('never leaves a token on a page, even with nothing filled in', () => {
    for (const starter of STARTERS) {
      for (const spec of starter.pages) {
        const page = buildStarterPage(spec, EMPTY);
        /*
         * The OPENER only. A closing }} appears all over the JSON as two nested
         * objects ending together, so looking for it finds every page and
         * proves nothing. A leftover token always starts with {{ and fill()
         * replaces a whole match, so it can never drop half of one.
         */
        expect(JSON.stringify(page), `${starter.id}/${spec.slug}`).not.toContain('{{');
      }
    }
  });

  it('leaves a token it does not recognise alone rather than blanking it', () => {
    // A visible {{oops}} is a bug somebody reports. A silently empty heading is
    // one nobody notices.
    expect(fill('A {{oops}} here', FILLED)).toBe('A {{oops}} here');
  });
});

// ---------------------------------------------------------------------------
// Building
// ---------------------------------------------------------------------------

describe('building a page', () => {
  const home = STARTERS[0].pages[0];

  it('produces a page the schema accepts and the sanitiser does not change', () => {
    for (const starter of STARTERS) {
      for (const spec of starter.pages) {
        const built = buildStarterPage(spec, FILLED);

        const parsed = parsePage(built);
        expect(parsed.ok, `${starter.id}/${spec.slug}: ${parsed.ok ? '' : parsed.errors.join('; ')}`)
          .toBe(true);

        if (!parsed.ok) continue;

        /*
         * IDENTICAL AFTER SANITISING, which is a stronger claim than "it
         * survives". A starter whose copy the sanitiser rewrote would be the one
         * page on the site that does not say what the library says it says, and
         * nothing would report it.
         */
        expect(sanitisePage(parsed.page), `${starter.id}/${spec.slug}`).toEqual(parsed.page);
      }
    }
  });

  it('writes the heading it was given into the section title', () => {
    const page = buildStarterPage(home, FILLED);
    const headings = blocks(page.sections).filter((block) => block.type === 'heading');
    expect(headings[0].props.html).toBe('Holidays worth the time off');
  });

  /*
   * THE BUG THAT SHIPPED IN THE FIRST VERSION OF THIS FILE, and it took reading
   * what the builder produced to find, because every assertion passed.
   *
   * features-picture-beside-points opens with a small h6 "Tagline here" ABOVE
   * its h2. Targeting the first heading put a whole sentence into the eyebrow
   * and left the real title saying "Everything in one place". It looked
   * deliberate. This is the behavioural check, not a claim about the data: it
   * fails the moment titleBlock goes back to being firstBlock.
   */
  it('goes into the title, not into the tagline sitting above it', () => {
    const built = buildStarterPage(
      {
        title: 'X',
        slug: 'x',
        description: 'A description long enough to be a real one for this check.',
        sections: [{ preset: 'features-picture-beside-points', heading: 'The real title' }],
      },
      FILLED,
    );

    const headings = blocks(built.sections).filter((block) => block.type === 'heading');
    expect(headings[0].props.style, 'the preset changed shape').toBe('h6');
    expect(headings[0].props.html, 'the title landed in the eyebrow').toBe('Tagline here');
    expect(headings[1].props.html).toBe('The real title');
  });

  /*
   * And the other half: a section with only column labels in it has nowhere to
   * put a title, so nothing is written rather than a label being overwritten.
   */
  it('writes nothing when a section has no title heading at all', () => {
    const built = buildStarterPage(
      {
        title: 'X',
        slug: 'x',
        description: 'A description long enough to be a real one for this check.',
        sections: [{ preset: 'contact-hours-and-phone', heading: 'Should not appear' }],
      },
      FILLED,
    );

    expect(JSON.stringify(built)).not.toContain('Should not appear');
    expect(JSON.stringify(built)).toContain('Opening hours');
  });

  it('wraps the body in a paragraph, since a text block holds markup', () => {
    const page = buildStarterPage(home, FILLED);
    const text = blocks(page.sections).find((block) => block.type === 'text');
    expect(String(text?.props.html)).toMatch(/^<p>/);
  });

  /*
   * Every id fresh, or two sections of the same site would share one and the
   * editor would edit the wrong one.
   */
  it('mints new ids every time it builds', () => {
    const a = buildStarterPage(home, FILLED);
    const b = buildStarterPage(home, FILLED);
    expect(a.id).not.toBe(b.id);
    expect(a.sections[0].id).not.toBe(b.sections[0].id);
  });

  it('leaves the search title empty, so it falls back to the page name', () => {
    // Writing one here would put the same words in two places from the start,
    // and the SEO assistant is what improves on it.
    expect(buildStarterPage(home, FILLED).seo?.title).toBe('');
  });
});

describe('the header and footer', () => {
  const starter = STARTERS[0];

  /*
   * THE MENU IS THE BIT THAT FEELS LIKE MAGIC and it is the cheapest thing in
   * the feature. Without it every new site launches with the nav block's own
   * example links: Home, Holidays, About us, Contact, three of which are dead.
   */
  it('writes a menu of the pages this starter is actually making', () => {
    const header = buildStarterRegion(starter.header, 'header', starter.pages, FILLED);
    const nav = blocks(header.sections).find((block) => block.type === 'nav');

    expect(nav, 'the header preset has no menu in it').toBeTruthy();

    const items = nav?.props.items as Array<{ label: string; href: string }>;
    const wanted = starter.pages.filter((page) => page.menu);

    expect(items.map((item) => item.href)).toEqual(wanted.map((page) => `/${page.slug}`));
    expect(items.map((item) => item.label)).toEqual(wanted.map((page) => page.menu));
  });

  it('points the first entry at the home page, not at /home', () => {
    const header = buildStarterRegion(starter.header, 'header', starter.pages, FILLED);
    const nav = blocks(header.sections).find((block) => block.type === 'nav');
    expect((nav?.props.items as Array<{ href: string }>)[0].href).toBe('/');
  });

  it('builds regions the schema accepts', () => {
    for (const entry of STARTERS) {
      for (const [id, name] of [[entry.header, 'header'], [entry.footer, 'footer']] as const) {
        const region = buildStarterRegion(id, name, entry.pages, FILLED);
        const parsed = parseRegion(region, name);
        expect(parsed.ok, `${entry.id} ${name}: ${parsed.ok ? '' : parsed.errors.join('; ')}`)
          .toBe(true);
      }
    }
  });

  it('gives back an empty region rather than throwing on an unknown preset', () => {
    expect(buildStarterRegion('no-such-preset', 'header', [], FILLED).sections).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// What is written, read as source
// ---------------------------------------------------------------------------

describe('what actually reaches the database', () => {
  const source = read('lib', 'db', 'starters.ts');

  /*
   * NOTHING IS PUBLISHED. A site appearing live on a client's own domain, with
   * placeholder copy still in it, because somebody pressed a button in a
   * wizard, is the worst thing this feature could do.
   */
  it('writes drafts and never publishes', () => {
    expect(source).toContain('draft_content');
    expect(source).not.toContain('published_content =');
    expect(source).not.toContain('publishPage');
    expect(source).not.toContain("status = 'published'");
  });

  /*
   * ALL OR NOTHING. Three of five pages, with a menu pointing at the two that
   * failed, is a mess somebody has to unpick by hand.
   */
  it('does the whole site in one transaction', () => {
    const apply = source.slice(source.indexOf('export async function applyStarter'));
    expect(apply).toContain('withTenant(tenantId, async (tx) => {');
    // One transaction, so the emptiness check and every write are in it.
    expect(apply).toContain('if (!(await isEmpty(tx))) return null;');
  });

  /*
   * THE REFUSAL IS ON THE SERVER. The dashboard only offers this on an empty
   * site, which is a courtesy to whoever is looking at the screen and no
   * obstacle to somebody calling the action directly.
   */
  it('checks the site is empty inside the transaction, not on the screen', () => {
    const apply = source.slice(source.indexOf('export async function applyStarter'));
    const check = apply.indexOf('isEmpty(tx)');
    const write = apply.indexOf('insert into public.pages');
    expect(check).toBeGreaterThan(-1);
    expect(check).toBeLessThan(write);
  });

  it('builds and validates everything before it opens a connection', () => {
    const apply = source.slice(source.indexOf('export async function applyStarter'));
    const validated = apply.indexOf('ready(buildStarterPage');
    // Checked for presence FIRST. Without this, deleting the ready() call makes
    // indexOf return -1, and -1 is less than everything, so the ordering
    // assertion below would pass with the validation gone.
    expect(validated, 'nothing validates the pages').toBeGreaterThan(-1);
    expect(validated).toBeLessThan(apply.indexOf('withTenant('));
  });

  /*
   * A new site already HAS a home page at the empty slug, and the unique index
   * refuses a second. Reusing it is also the kinder answer: the page they were
   * already looking at is the one that fills up.
   */
  it('reuses the blank home page rather than fighting the unique index', () => {
    expect(source).toContain('update public.pages set');
    expect(source).toContain('where parent_id is null and slug =');
  });

  it('counts a region somebody has already built as content', () => {
    // Otherwise a starter would overwrite a header an agency had spent an hour
    // on, because no PAGE had a section yet.
    expect(source).toContain('from public.site_regions');
  });
});

describe('the action around it', () => {
  const source = read('app', 'actions', 'starters.ts');

  it('never takes a tenant from the caller', () => {
    expect(source).toContain('await requireTenantId()');
    expect(source).not.toMatch(/tenantId[:,]\s*(input|raw|arg)/);
  });

  it('refuses a starter id it does not recognise', () => {
    expect(source).toContain('STARTERS.some((starter) => starter.id === id)');
  });

  /*
   * THE THREE ANSWERS ARE SITE SETTINGS, saved as settings. A wizard that used
   * a company name once and threw it away would be asking for it again on the
   * settings screen ten minutes later, and the two copies would disagree.
   */
  it('saves the profile to settings rather than using it and dropping it', () => {
    expect(source).toContain('await saveSettings(tenantId,');
    expect(source).toContain('companyName: given.company || current.companyName');
    expect(source).toContain('addressLocality: given.town || current.addressLocality');
    expect(source).toContain('companyAbout: given.about || current.companyAbout');
  });

  /*
   * MERGED, NEVER REPLACED. The profile has more fields than the three asked
   * for here, and a fresh object would wipe the tone of voice and the
   * words-to-avoid of anybody who had filled those in first.
   */
  it('merges over the existing settings instead of replacing them', () => {
    expect(source).toContain('...current,');
  });

  it('caps every answer before it is stored', () => {
    expect(source).toContain('.trim().slice(0, max)');
  });
});

describe('what the screen says', () => {
  const source = read('components', 'sites', 'StarterWizard.tsx');
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

  /*
   * SAID BEFORE THE BUTTON, not after. Somebody who thinks this puts a site
   * with placeholder copy on their live domain will not press it, and they
   * would be right not to.
   */
  it('promises nothing goes live, where it can be read before pressing anything', () => {
    expect(code).toContain('Nothing goes live');
    expect(code.indexOf('Nothing goes live')).toBeLessThan(code.indexOf('tg-visually-hidden'));
  });

  it('prefills from settings rather than asking twice', () => {
    expect(code).toContain('useState(profile.company)');
    expect(code).toContain('useState(profile.town)');
    expect(code).toContain('useState(profile.about)');
  });

  /*
   * A radio group, not clickable divs with aria-pressed. It announces "1 of 2",
   * moves on the arrow keys and submits with the form, for free.
   */
  it('offers the choice as a real radio group', () => {
    expect(code).toContain('type="radio"');
    expect(code).toContain('<fieldset');
    expect(code).toContain('<legend');
  });

  it('opens the editor at the new home page rather than a list of rows', () => {
    expect(code).toContain('router.push(`/editor?page=');
  });

  it('associates every field with its label', () => {
    for (const id of ['sw-company', 'sw-town', 'sw-about']) {
      expect(code, id).toContain(`htmlFor="${id}"`);
      expect(code, id).toContain(`id="${id}"`);
    }
  });
});

describe('where the wizard is offered', () => {
  const dashboard = read('components', 'sites', 'SiteDashboard.tsx')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');

  /*
   * WORKED OUT ON THE SERVER. "Empty" is a question about content and this
   * component only has a list of page names. A brand new site has one blank
   * home page, so anything keyed on pages.length would never offer the wizard
   * to the sites that need it most.
   */
  it('asks the server whether the site is empty, not the length of a list', () => {
    expect(dashboard).toContain('canStart');
    expect(dashboard).toContain('{canStart && (');
  });

  it('makes building the site the primary action, not the quiet one', () => {
    const panel = dashboard.slice(dashboard.indexOf('{canStart && ('));
    const build = panel.indexOf('Build me a site');
    const blank = panel.indexOf('Start from a blank page');
    expect(build).toBeGreaterThan(-1);
    expect(build).toBeLessThan(blank);
  });
});
