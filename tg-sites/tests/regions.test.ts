/**
 * The header, the footer and the menu.
 *
 * WHAT IS WORTH TESTING HERE, given a region is deliberately made of the same
 * parts a page is: the SEAMS. The places where the two are joined together are
 * the only places a bug can live that the page suite would not already catch.
 *
 *   1. That a region really does share the page's normalising and upgrading,
 *      rather than having quietly grown a second copy of it.
 *   2. That the wrapper the editor sees round-trips, and throws away exactly
 *      the fields it claims to throw away.
 *   3. That the sanitiser reaches into a header. A header is on every URL, so
 *      it is the worse of the two places to leave a hole.
 *   4. That the public role cannot read a draft header.
 *
 * The menu's markup is checked in the browser harness rather than here: this
 * runner has no JSX, by the deliberate choice in vitest.config.ts.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { blockDefinition, defaultPropsFor, isKnownBlock } from '../lib/content/blocks';
import { pageAsRegion, regionAsPage, REGION_TITLES } from '../lib/content/region-page';
import { sanitiseRegion } from '../lib/content/sanitise-page';
import {
  CONTENT_VERSION,
  emptyRegion,
  parsePage,
  parseRegion,
  REGIONS,
  type Region,
} from '../lib/content/schema';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SECTION = {
  id: 'sec_1',
  tone: 'light',
  width: 'contained',
  paddingY: 48,
  minHeight: 0,
  rows: [
    {
      id: 'row_1',
      gap: 16,
      stackBelow: 'mobile',
      reverseOnStack: false,
      columns: [
        { id: 'col_1', width: 100, align: 'top', flow: 'stacked', blocks: [] },
      ],
    },
  ],
};

function withBlocks(blocks: unknown[]) {
  return {
    version: 1,
    sections: [
      {
        ...SECTION,
        rows: [{ ...SECTION.rows[0], columns: [{ ...SECTION.rows[0].columns[0], blocks }] }],
      },
    ],
  };
}

// ---------------------------------------------------------------------------

describe('parseRegion', () => {
  it('stamps the name from the caller and ignores what the JSON claims', () => {
    const parsed = parseRegion({ version: 1, region: 'footer', sections: [] }, 'header');

    expect(parsed.ok).toBe(true);
    // The name comes from the row's primary key. A blob sitting in the header
    // row does not get to say it is the footer.
    expect(parsed.ok && parsed.region.region).toBe('header');
  });

  it('defaults the two header settings to off', () => {
    const parsed = parseRegion({ version: 1, sections: [] }, 'header');
    expect(parsed.ok && parsed.region.sticky).toBe(false);
    expect(parsed.ok && parsed.region.overlay).toBe(false);
  });

  it('survives a stored blob with nothing in it', () => {
    const parsed = parseRegion({}, 'footer');
    expect(parsed.ok).toBe(true);
    expect(parsed.ok && parsed.region.sections).toEqual([]);
  });

  /*
   * THE POINT OF THIS ONE. preNormalise keys off `sections` rather than off
   * anything page-shaped, which is what lets a region share it. If somebody
   * later narrows that function to a Page, this fails and says why.
   */
  it('repairs column widths, exactly as a page does', () => {
    const untidy = {
      version: 1,
      sections: [
        {
          ...SECTION,
          rows: [
            {
              ...SECTION.rows[0],
              columns: [
                { id: 'a', width: 33.33, align: 'top', flow: 'stacked', blocks: [] },
                { id: 'b', width: 33.33, align: 'top', flow: 'stacked', blocks: [] },
                { id: 'c', width: 33.33, align: 'top', flow: 'stacked', blocks: [] },
              ],
            },
          ],
        },
      ],
    };

    const parsed = parseRegion(untidy, 'header');
    expect(parsed.ok, parsed.ok ? '' : parsed.errors.join('; ')).toBe(true);

    if (!parsed.ok) return;
    const widths = parsed.region.sections[0].rows[0].columns.map((c) => c.width);
    expect(widths.reduce((sum, w) => sum + w, 0)).toBeCloseTo(100, 2);
  });

  /* The same argument for upgradeBlock: a heading in a header written before
     31 Jul 2026 has its words in `text`, and must come back with `html`. */
  it('upgrades an old heading, exactly as a page does', () => {
    const parsed = parseRegion(
      withBlocks([{ id: 'b1', type: 'heading', props: { text: 'Sunshine & sea', level: 'h2' } }]),
      'header',
    );

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const block = parsed.region.sections[0].rows[0].columns[0].blocks[0];
    expect(block.props.html).toBe('Sunshine &amp; sea');
    // Left in place so a rollback still renders. Same rule as a page.
    expect(block.props.text).toBe('Sunshine & sea');
  });

  it('refuses a malformed tree rather than salvaging one', () => {
    const parsed = parseRegion({ version: 1, sections: 'not an array' }, 'header');
    expect(parsed.ok).toBe(false);
  });

  it('emptyRegion is a region the parser accepts', () => {
    for (const name of REGIONS) {
      const empty = emptyRegion(name);
      expect(empty.version).toBe(CONTENT_VERSION);
      expect(parseRegion(empty, name).ok).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------

describe('the wrapper the editor sees', () => {
  const region: Region = {
    version: 1,
    region: 'header',
    sticky: true,
    overlay: true,
    sections: [],
  };

  it('is a Page the page parser accepts', () => {
    // If this ever stops being true the editor would be handed something its
    // own save path would then refuse, which is the worst place to find out.
    expect(parsePage(regionAsPage(region)).ok).toBe(true);
  });

  it('round trips the sections untouched', () => {
    const parsed = parseRegion(withBlocks([{ id: 'b1', type: 'text', props: { html: '<p>Hi</p>' } }]), 'header');
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const back = pageAsRegion(regionAsPage(parsed.region), 'header', {
      sticky: false,
      overlay: false,
    });
    expect(back.sections).toEqual(parsed.region.sections);
  });

  it('throws the fake title, address and search listing away', () => {
    const edited = {
      ...regionAsPage(region),
      title: 'Somebody typed this',
      slug: 'and-this',
      seo: { title: 'and this', noindex: true },
    };

    const back = pageAsRegion(edited, 'header', { sticky: false, overlay: false });

    // The editor hides those fields precisely because of this. The assertion is
    // that the region shape has nowhere for them to go, so nothing is silently
    // carried into the database.
    expect(Object.keys(back).sort()).toEqual(
      ['overlay', 'region', 'sections', 'sticky', 'version'],
    );
  });

  it('names the region in words the top bar can show', () => {
    expect(REGION_TITLES.header).toBe('Header');
    expect(REGION_TITLES.footer).toBe('Footer');
  });

  /*
   * Sticky and overlay are both about a bar at the top of the screen. A footer
   * pinned to the top of the window is not a footer, and the editor does not
   * offer the toggles there, but the editor is not the only thing that can call
   * this.
   */
  it('refuses sticky and overlay on a footer whatever it is passed', () => {
    const back = pageAsRegion(regionAsPage(region), 'footer', { sticky: true, overlay: true });
    expect(back.sticky).toBe(false);
    expect(back.overlay).toBe(false);
    expect(back.region).toBe('footer');
  });
});

// ---------------------------------------------------------------------------

describe('sanitising a region', () => {
  /*
   * A header is on EVERY url. If the sanitiser reached a page and not a header,
   * the one place a payload would do the most damage is the one place it would
   * survive. This is the test that says the two share an implementation.
   */
  it('strips a script from a text block, as it would on a page', () => {
    const parsed = parseRegion(
      withBlocks([
        { id: 'b1', type: 'text', props: { html: '<p>Hello<script>alert(1)</script></p>' } },
      ]),
      'header',
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const clean = sanitiseRegion(parsed.region);
    const html = clean.sections[0].rows[0].columns[0].blocks[0].props.html as string;

    expect(html).not.toContain('<script');
    expect(html).toContain('Hello');
  });

  it('strips a javascript: address out of a menu link', () => {
    const parsed = parseRegion(
      withBlocks([
        {
          id: 'b1',
          type: 'nav',
          props: {
            layout: 'row',
            items: [
              { label: 'Fine', href: '/about' },
              // eslint-disable-next-line no-script-url
              { label: 'Not fine', href: 'javascript:alert(1)' },
            ],
          },
        },
      ]),
      'header',
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const clean = sanitiseRegion(parsed.region);
    const items = clean.sections[0].rows[0].columns[0].blocks[0].props.items as Array<
      Record<string, unknown>
    >;

    expect(items[0].href).toBe('/about');
    expect(items[1].href).toBe('');
  });

  it('leaves a section background image it cannot vouch for as an empty string', () => {
    const parsed = parseRegion(
      { version: 1, sections: [{ ...SECTION, backgroundImage: 'javascript:alert(1)' }] },
      'footer',
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    expect(sanitiseRegion(parsed.region).sections[0].backgroundImage).toBe('');
  });
});

// ---------------------------------------------------------------------------

describe('the menu block', () => {
  it('is in the library, in Navigation, and is not staff only', () => {
    expect(isKnownBlock('nav')).toBe(true);
    const definition = blockDefinition('nav')!;
    expect(definition.group).toBe('Navigation');
    // Navigation is the client's own. Nothing they type here becomes code.
    expect(definition.staffOnly).toBeUndefined();
  });

  it('its own defaults survive a parse and a sanitise unchanged', () => {
    const parsed = parseRegion(
      withBlocks([{ id: 'b1', type: 'nav', props: defaultPropsFor('nav') }]),
      'header',
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const items = sanitiseRegion(parsed.region).sections[0].rows[0].columns[0].blocks[0].props
      .items as Array<Record<string, unknown>>;

    // Four ordinary internal links. If the sanitiser ever started refusing a
    // relative address, the block's own defaults would be the first casualty.
    expect(items).toHaveLength(4);
    expect(items.every((item) => typeof item.href === 'string' && item.href !== '')).toBe(true);
  });

  it('collapses to a menu button by default, because a phone is the common case', () => {
    // 'phone' since 20 Aug 2026, when the toggle became a three-way choice so a
    // header could ask for a burger at every width. The DEFAULT did not change,
    // only how it is spelled: burgerMode reads the old `true` as this.
    expect(defaultPropsFor('nav').collapse).toBe('phone');
  });

  it('offers font controls for the links, drawn from the site whitelists', () => {
    const definition = blockDefinition('nav')!;
    const keys = definition.fields.map((field) => field.key);
    expect(keys).toEqual(expect.arrayContaining(['linkFont', 'linkSize', 'linkWeight', 'linkColour']));

    const font = definition.fields.find((field) => field.key === 'linkFont') as
      | { kind: string; options: Array<{ value: string }> }
      | undefined;
    expect(font?.kind).toBe('select');
    const fontValues = font!.options.map((option) => option.value);
    // The two site fonts and a "follow the theme" default, and nothing else, so a
    // family the site has not loaded cannot be chosen and render differently on
    // every visitor's machine.
    expect(fontValues).toContain('');
    expect(fontValues).toContain('var(--tgs-font-body)');
    expect(fontValues).toContain('var(--tgs-font-display)');

    expect(definition.fields.find((field) => field.key === 'linkColour')?.kind).toBe('colour');
  });

  it('validates the links type against the whitelist before it reaches the page', () => {
    // The renderer cannot be imported into this suite (its JSX is not transformed
    // here, the same reason every render test in this repo reads the source), so
    // the guarantee is asserted on the source: each value is checked against the
    // sets built from the same whitelists the fields offer, the colour goes
    // through safeColour, and the result is emitted only as custom properties, so
    // nothing off-list can reach font-family, font-size, font-weight or color.
    const nav = source('components', 'render', 'blocks.tsx');
    expect(nav).toContain('const NAV_FONT_VALUES = new Set(FONT_CHOICES.map((choice) => choice.value))');
    expect(nav).toContain('const NAV_SIZE_VALUES = new Set(FONT_SIZES.map((size) => size.value))');
    expect(nav).toContain("NAV_WEIGHTS.has(str(props, 'linkWeight'))");
    expect(nav).toContain('safeColour(props.linkColour)');
    expect(nav).toContain("'--tgs-nav-font': linkFont");
    expect(nav).toContain("'--tgs-nav-colour': linkColour");
  });
});

// ---------------------------------------------------------------------------
// The query layer, against a fake driver. Same shape as tests/db.test.ts.
// ---------------------------------------------------------------------------

interface Statement {
  role: string;
  sql: string;
  params: unknown[];
}

let log: Statement[] = [];
let responses: Array<{ match: string; rows: Record<string, unknown>[] }> = [];

function respond(match: string, rows: Record<string, unknown>[]): void {
  responses.push({ match, rows });
}

function fakeSql(role: string) {
  function query(
    strings: TemplateStringsArray | string,
    ...args: unknown[]
  ): Promise<Record<string, unknown>[]> {
    const text = typeof strings === 'string'
      ? strings
      : strings.raw.join(' ? ').replace(/\s+/g, ' ').trim();

    log.push({ role, sql: text, params: args });

    const index = responses.findIndex((r) => text.includes(r.match));
    if (index === -1) return Promise.resolve([]);
    return Promise.resolve(responses.splice(index, 1)[0].rows);
  }

  const sql = query as unknown as Record<string, unknown> & typeof query;
  sql.json = (value: unknown) => ({ __json: value });
  sql.begin = async (fn: (tx: unknown) => Promise<unknown>) => {
    log.push({ role, sql: 'BEGIN', params: [] });
    try {
      const result = await fn(sql);
      log.push({ role, sql: 'COMMIT', params: [] });
      return result;
    } catch (error) {
      log.push({ role, sql: 'ROLLBACK', params: [] });
      throw error;
    }
  };

  return sql;
}

vi.mock('../lib/db/client', () => ({
  db: (role: string) => fakeSql(role),
  usernameFrom: () => null,
}));

const ALPHA = '11111111-1111-1111-1111-111111111111';

beforeEach(() => {
  log = [];
  responses = [];
});

/** The JSON a write handed the driver, unwrapped from the fake's marker. */
function writtenJson(statement: Statement): unknown {
  const wrapped = statement.params.find(
    (param): param is { __json: unknown } =>
      !!param && typeof param === 'object' && '__json' in param,
  );
  return wrapped?.__json;
}

describe('region queries', () => {
  it('answers with an empty region when the tenant has never had one', async () => {
    const { getRegion } = await import('../lib/db/regions');

    // No respond() call, so the fake returns no rows.
    const record = await getRegion(ALPHA, 'header');

    expect(record.region.sections).toEqual([]);
    expect(record.publishedAt).toBeNull();
    // Nothing to publish is not the same as changes waiting to be published.
    expect(record.hasUnpublishedChanges).toBe(false);
  });

  it('reads the draft as the app role, inside a transaction', async () => {
    const { getRegion } = await import('../lib/db/regions');

    respond('draft_content', [{
      draft_content: { version: 1, sections: [] },
      published_at: null,
      updated_at: '2026-07-31T00:00:00Z',
      has_unpublished_changes: true,
    }]);

    await getRegion(ALPHA, 'header');

    const read = log.find((s) => s.sql.includes('from public.site_regions'))!;
    expect(read.role).toBe('app');
    expect(log.findIndex((s) => s.sql === 'BEGIN')).toBeLessThan(log.indexOf(read));
    // No tenant in the WHERE. The policy does the scoping, as everywhere else.
    expect(read.sql).not.toContain('tenant_id =');
  });

  /*
   * THE ONE THAT MATTERS MOST. A visitor's request must not be able to reach an
   * unfinished header. The database enforces it with a column grant, and this
   * asserts the query never asks for the column in the first place, so the two
   * halves cannot drift into a permission error nobody notices.
   */
  it('reads the live copy as the READ-ONLY role and never asks for the draft', async () => {
    const { getPublishedRegions } = await import('../lib/db/regions');

    respond('published_content', [
      { region: 'header', published_content: { version: 1, sections: [] } },
    ]);

    await getPublishedRegions(ALPHA);

    const read = log.find((s) => s.sql.includes('from public.site_regions'))!;
    expect(read.role).toBe('renderer');
    expect(read.sql).not.toContain('draft_content');
  });

  it('fetches the header and the footer in one query rather than two', async () => {
    const { getPublishedRegions } = await import('../lib/db/regions');

    respond('published_content', [
      { region: 'header', published_content: { version: 1, sections: [] } },
      { region: 'footer', published_content: { version: 1, sections: [] } },
    ]);

    const both = await getPublishedRegions(ALPHA);

    expect(both.header).not.toBeNull();
    expect(both.footer).not.toBeNull();
    expect(log.filter((s) => s.sql.includes('from public.site_regions'))).toHaveLength(1);
  });

  it('ignores a region name the schema does not know', async () => {
    const { getPublishedRegions } = await import('../lib/db/regions');

    respond('published_content', [
      { region: 'sidebar', published_content: { version: 1, sections: [] } },
    ]);

    const both = await getPublishedRegions(ALPHA);
    expect(both.header).toBeNull();
    expect(both.footer).toBeNull();
  });

  it('sanitises before the bytes reach the database, not after', async () => {
    const { saveRegionDraft } = await import('../lib/db/regions');

    respond('insert into public.site_regions', [{
      draft_content: { version: 1, sections: [] },
      published_at: null,
      updated_at: '2026-07-31T00:00:00Z',
      has_unpublished_changes: true,
    }]);

    await saveRegionDraft(
      ALPHA,
      'header',
      withBlocks([
        { id: 'b1', type: 'text', props: { html: '<p>Hi<script>alert(1)</script></p>' } },
      ]),
      'user-1',
    );

    const write = log.find((s) => s.sql.includes('insert into public.site_regions'))!;
    expect(JSON.stringify(writtenJson(write))).not.toContain('<script');
  });

  it('refuses to save a malformed region rather than storing it', async () => {
    const { saveRegionDraft } = await import('../lib/db/regions');

    await expect(
      saveRegionDraft(ALPHA, 'header', { version: 1, sections: 'nope' }),
    ).rejects.toThrow(/Refusing to save/);

    expect(log.some((s) => s.sql.includes('insert into public.site_regions'))).toBe(false);
  });

  it('upserts rather than needing a row to exist first', async () => {
    const { saveRegionDraft } = await import('../lib/db/regions');

    respond('insert into public.site_regions', [{
      draft_content: { version: 1, sections: [] },
      published_at: null,
      updated_at: '2026-07-31T00:00:00Z',
      has_unpublished_changes: true,
    }]);

    await saveRegionDraft(ALPHA, 'footer', { version: 1, sections: [] });

    const write = log.find((s) => s.sql.includes('insert into public.site_regions'))!;
    expect(write.sql).toContain('on conflict (tenant_id, region) do update');
  });

  /*
   * The live copy is set from the row that is already there, not from a
   * parameter, so it is exactly the bytes of the draft and cannot drift from
   * them by passing through JavaScript.
   */
  it('publishes the stored draft rather than a copy sent from here', async () => {
    const { publishRegion } = await import('../lib/db/regions');

    respond('published_content', [{
      draft_content: { version: 1, sections: [] },
      published_at: '2026-07-31T00:00:00Z',
      updated_at: '2026-07-31T00:00:00Z',
      has_unpublished_changes: false,
    }]);

    await publishRegion(ALPHA, 'header', 'user-1');

    const write = log.find((s) => s.sql.includes('insert into public.site_regions'))!;
    expect(write.sql).toContain('published_content = site_regions.draft_content');
    expect(write.sql).toContain('published_at = now()');
  });

  /*
   * The insert branch has to name published_content itself. Left to the column
   * default it would write NULL, and NULL is how this table says "never
   * published", so a publish that inserted a row would have published nothing.
   */
  it('publishing a region with no row writes a live copy rather than a NULL', async () => {
    const { publishRegion } = await import('../lib/db/regions');

    respond('published_content', [{
      draft_content: { version: 1, sections: [] },
      published_at: '2026-07-31T00:00:00Z',
      updated_at: '2026-07-31T00:00:00Z',
      has_unpublished_changes: false,
    }]);

    await publishRegion(ALPHA, 'footer');

    const write = log.find((s) => s.sql.includes('insert into public.site_regions'))!;
    expect(write.sql).toContain('published_content, published_at');
    expect(writtenJson(write)).toMatchObject({ version: 1, region: 'footer', sections: [] });
  });
});

// ---------------------------------------------------------------------------
// The published page.
//
// This runner has no JSX, by the deliberate choice in vitest.config.ts, and the
// browser harness only ever renders the EDITOR. So the claims below are read out
// of the source, the same way tests/content.test.ts reads the sandbox tokens.
// That is weaker than exercising them and it is not nothing: each one is an
// invariant somebody could undo in a tidy-up without noticing, and each says in
// its message what would break.
// ---------------------------------------------------------------------------

function source(...parts: string[]): string {
  return readFileSync(join(__dirname, '..', ...parts), 'utf8');
}

describe('the header and footer on a published page', () => {
  const renderer = source('components', 'render', 'RegionRenderer.tsx');

  it('uses the real landmarks rather than a div with a class', () => {
    expect(renderer).toContain("region.region === 'header' ? 'header' : 'footer'");
  });

  it('renders nothing at all for a region nobody has filled in', () => {
    // Otherwise a site with no footer ships an empty <footer> landmark, which
    // a screen reader announces and then finds nothing in.
    expect(renderer).toContain('if (!region || region.sections.length === 0) return null;');
  });

  it('carries the theme itself, because there is no shared wrapper to put it on', () => {
    expect(renderer).toContain('style={theme}');
  });

  for (const [label, route] of [
    ['the public site', ['app', 'site', '[host]', '[[...path]]', 'page.tsx']],
    ['the preview', ['app', 'preview', '[[...path]]', 'page.tsx']],
  ] as const) {
    /*
     * SIBLINGS, NOT NESTED, and this is the check that says why.
     *
     * `.tgs-page` carries `overflow-x: hidden`, and an overflow ancestor is
     * exactly what stops `position: sticky` sticking. Wrapping the three in one
     * would look tidier and would quietly break every sticky header.
     */
    it(`${label} renders the header, the page and the footer as siblings`, () => {
      const text = source(...route);
      // The header and footer are drawn through fillNavRegion, which fills a Menu
      // link that points at a folder with the pages inside it. That wrapper is
      // unique to the RegionRenderer calls, unlike the bare regions.footer which
      // also appears earlier in the JSON-LD social scan.
      const header = text.indexOf('fillNavRegion(found.regions.header');
      const page = text.indexOf('<PageRenderer');
      const footer = text.indexOf('fillNavRegion(found.regions.footer');

      expect(header, 'no header on this route').toBeGreaterThan(-1);
      expect(footer, 'no footer on this route').toBeGreaterThan(-1);
      expect(header).toBeLessThan(page);
      expect(page).toBeLessThan(footer);
    });

    it(`${label} loads the header and footer alongside the page, not after it`, () => {
      // In the same Promise.all. Sequentially it is another round trip to
      // eu-west-2 before a byte of HTML reaches somebody who is waiting.
      const text = source(...route);
      // Terminated on `]);` rather than `])`. The first version stopped at the
      // `[]` inside `(path ?? []).join('/')` and matched almost nothing.
      const parallel = /await Promise\.all\(\[([\s\S]*?)\]\);/.exec(text)?.[1] ?? '';
      expect(parallel).toContain('getPublishedRegions');
    });
  }
});

describe('one widget script, however many trees it appears in', () => {
  it('the page renderer no longer emits its own', () => {
    // It did until the regions arrived. Left in place, a widget in the header
    // and the same widget on the page would fetch the file twice.
    const text = source('components', 'render', 'PageRenderer.tsx');
    expect(text).not.toContain('widgetScriptsFor');
  });

  it('the collector takes every tree and de-duplicates across them', () => {
    const text = source('components', 'render', 'WidgetScripts.tsx');
    expect(text).toContain('new Set<string>()');
    expect(text).toContain('for (const tree of trees)');
    // A null region is the normal case for a site with no footer.
    expect(text).toContain('if (!tree) continue;');
  });

  /*
   * Asserted as three claims rather than one exact string, because the middle
   * tree stopped being a fixed expression on 31 Jul 2026: an address that
   * resolves to a blog entry rather than a page hands the ENTRY's sections in
   * that slot. A widget dropped into a blog post has to load its script the
   * same way one on a page does.
   */
  for (const [label, route] of [
    ['the public site', ['app', 'site', '[host]', '[[...path]]', 'page.tsx']],
    ['the preview', ['app', 'preview', '[[...path]]', 'page.tsx']],
  ] as const) {
    it(`${label} hands it all three trees`, () => {
      const text = source(...route).replace(/\s+/g, ' ');
      const call = text.slice(text.indexOf('<WidgetScripts'));
      const trees = call.slice(0, call.indexOf('/>'));

      expect(trees).toContain('found.regions.header');
      expect(trees).toContain('found.regions.footer');
      // Whatever is between the two, the content tree is in it: the public site
      // resolves page, entry or tag archive into a single `contentTree` first;
      // the preview, which has no archive, still passes the page inline.
      expect(trees).toMatch(/found\.page|contentTree/);
    });
  }

  it('the public site hands over an entry body as readily as a page', () => {
    const text = source('app', 'site', '[host]', '[[...path]]', 'page.tsx').replace(/\s+/g, ' ');
    // The content tree the scripts are handed resolves to the entry's own body
    // when it is an entry, the same way it resolves to the page's content.
    expect(text).toContain('found.entry ? found.entry.item');
  });
});

describe('the stylesheet', () => {
  const css = source('app', 'globals.css');

  it('sticks only a header, never a footer', () => {
    expect(css).toContain(".tgs-region[data-region='header'][data-sticky='true']");
    expect(css).not.toContain(".tgs-region[data-region='footer'][data-sticky='true']");
  });

  it('makes an overlaid header see-through, or it is not an overlay', () => {
    expect(css).toContain(".tgs-region[data-overlay='true'] .tgs-section { background: transparent; }");
  });

  it('hides whichever copy of the menu is not in use, rather than moving it off screen', () => {
    /*
     * `display: none` and nothing else. A visually-hidden trick would leave both
     * copies in the accessibility tree and a screen reader would read the menu
     * twice, which is the one cost the duplicated markup must not have.
     */
    expect(css).toContain(".tgs-nav__list[data-collapse='true'] { display: none; }");
    expect(css).toContain('.tgs-nav__disclosure { display: none; }');
  });

  it('drops the browser marker so the burger is not a triangle beside a burger', () => {
    expect(css).toContain('.tgs-nav__burger::-webkit-details-marker { display: none; }');
  });

  it('lets a menu set its links font, size, weight and colour, each falling back to the header', () => {
    // The block sets these as custom properties; the fallback is what the links
    // inherited before, so a menu that sets nothing renders exactly as it did.
    expect(css).toContain('color: var(--tgs-nav-colour, inherit)');
    expect(css).toContain('font-family: var(--tgs-nav-font, inherit)');
    expect(css).toContain('font-size: var(--tgs-nav-size, inherit)');
    expect(css).toContain('font-weight: var(--tgs-nav-weight, 500)');
  });
});

// ---------------------------------------------------------------------------

describe('the site_regions migration', () => {
  const sql = readFileSync(
    join(__dirname, '..', 'db', 'migrations', '0016_site_regions.sql'),
    'utf8',
  );

  it('forces row level security, not merely enables it', () => {
    // Without FORCE the table owner bypasses every policy, and the owner is
    // who the migration runs as.
    expect(sql).toContain('force row level security');
  });

  it('grants the renderer only the published columns', () => {
    const grant = sql
      .split('\n')
      .find((line) => line.includes('grant select (') && line.includes('tenant_id'));

    expect(grant, 'the renderer has no column grant at all').toBeTruthy();
    expect(grant!).toContain('published_content');
    expect(grant!).not.toContain('draft_content');
  });

  it('revokes from the roles a request could otherwise arrive as', () => {
    expect(sql).toContain('revoke all on public.site_regions from public, anon, authenticated');
  });

  it('lets a tenant have exactly one header and one footer', () => {
    expect(sql).toContain('primary key (tenant_id, region)');
    expect(sql).toContain("check (region in ('header', 'footer'))");
  });
});
