/**
 * The Social links block.
 *
 * WHAT IS ACTUALLY AT RISK HERE, because it is not the layout.
 *
 * A block whose whole job is to put pictures on a page next to client-supplied
 * addresses has exactly two ways to go wrong, and both are security rather than
 * design. The first is the picture: SVG carries script, so if a client could
 * influence which markup is drawn this block would be an injection route. The
 * second is the address, which IS client input and which has to go through
 * safeUrl like every other link, with mailto and tel allowed for this one block
 * because a "follow us" row usually ends with an email and a phone number.
 *
 * So this file checks the closed list, the two files that have to agree about
 * it, and the source of the renderer for the handful of decisions that cannot
 * be asserted without a DOM. The layout and the tap targets are in the browser
 * harness, where laid-out pixels can be measured.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { blockDefinition, defaultPropsFor, isKnownBlock } from '../lib/content/blocks';
import { sanitisePage } from '../lib/content/sanitise-page';
import { parsePage } from '../lib/content/schema';
import { SOCIAL_NETWORKS, SOCIAL_OPTIONS, socialNetwork } from '../lib/content/social';

function read(...parts: string[]): string {
  return readFileSync(join(__dirname, '..', ...parts), 'utf8');
}

// ---------------------------------------------------------------------------
// The closed list
// ---------------------------------------------------------------------------

describe('the networks a client can pick', () => {
  it('resolves an id to its network, and nothing else to anything', () => {
    expect(socialNetwork('facebook')?.label).toBe('Facebook');
    expect(socialNetwork('myspace')).toBeUndefined();
    expect(socialNetwork('')).toBeUndefined();
    expect(socialNetwork(null)).toBeUndefined();
    expect(socialNetwork(42)).toBeUndefined();
    // The one that matters: an object cannot smuggle itself in as an id.
    expect(socialNetwork({ id: 'facebook' })).toBeUndefined();
  });

  it('has no two networks sharing an id', () => {
    const ids = SOCIAL_NETWORKS.map((network) => network.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('gives every network a name, which is what a screen reader reads', () => {
    for (const network of SOCIAL_NETWORKS) {
      expect(network.label.trim().length, network.id).toBeGreaterThan(0);
    }
  });

  it('offers the picker the same list, in the same order', () => {
    expect(SOCIAL_OPTIONS.map((option) => option.value))
      .toEqual(SOCIAL_NETWORKS.map((network) => network.id));
  });

  it('covers the ones a travel agency actually has', () => {
    const ids = SOCIAL_NETWORKS.map((network) => network.id);
    for (const wanted of ['facebook', 'instagram', 'tripadvisor', 'whatsapp', 'email', 'phone']) {
      expect(ids, `no ${wanted}`).toContain(wanted);
    }
  });

  /*
   * THE TWO FILES THAT HAVE TO AGREE. The list is data in lib/ and the drawings
   * are JSX next door, which is the split the rest of lib/content uses. A
   * network added to one and forgotten in the other would render a link with
   * nothing in it, which is invisible in a row of icons.
   */
  it('has a drawing for every network, and no drawing for a network that is gone', () => {
    const icons = read('components', 'render', 'social-icons.tsx');
    const drawn = [...icons.matchAll(/^ {2}([a-z]+): \(/gm)].map((match) => match[1]);

    expect(drawn.sort()).toEqual(SOCIAL_NETWORKS.map((network) => network.id).sort());
  });
});

// ---------------------------------------------------------------------------
// The block
// ---------------------------------------------------------------------------

describe('the block definition', () => {
  it('is in the registry, in with the other links', () => {
    expect(isKnownBlock('social')).toBe(true);
    expect(blockDefinition('social')?.group).toBe('Actions');
  });

  it('arrives with a few accounts in it, so it looks like what it is', () => {
    const defaults = defaultPropsFor('social');
    expect(Array.isArray(defaults.items)).toBe(true);
    expect((defaults.items as unknown[]).length).toBeGreaterThanOrEqual(3);
  });

  /*
   * EMPTY ADDRESSES, ON PURPOSE. A default of facebook.com/travelgenix would be
   * our account on a client's site, and the ones nobody notices are the ones
   * that get published.
   */
  it('and none of them points anywhere yet', () => {
    for (const item of defaultPropsFor('social').items as Array<Record<string, unknown>>) {
      expect(item.href).toBe('');
    }
  });

  it('offers the network as a picker rather than a box to type into', () => {
    const repeater = blockDefinition('social')?.fields
      .find((field) => field.kind === 'repeater');
    const network = repeater?.kind === 'repeater'
      ? repeater.fields.find((field) => field.key === 'network')
      : undefined;

    expect(network?.kind).toBe('select');
  });

  /*
   * THE ADDRESS IS A `url` FIELD, and that single word is what puts it through
   * safeUrl on the way into the database: lib/content/sanitise-page.ts is
   * driven by field kinds rather than by a list of block names. Declaring it as
   * `text` would sanitise nothing and nobody would notice.
   */
  it('declares the address as a url, which is what gets it sanitised', () => {
    const repeater = blockDefinition('social')?.fields
      .find((field) => field.kind === 'repeater');
    const href = repeater?.kind === 'repeater'
      ? repeater.fields.find((field) => field.key === 'href')
      : undefined;

    expect(href?.kind).toBe('url');
  });
});

// ---------------------------------------------------------------------------
// Sanitising, through the real page path
// ---------------------------------------------------------------------------

function pageWithSocial(items: Array<Record<string, unknown>>) {
  const parsed = parsePage({
    version: 1,
    id: 'pg_test',
    title: 'Test',
    slug: '',
    seo: { noindex: false },
    sections: [
      {
        id: 's1',
        rows: [
          {
            id: 'r1',
            columns: [
              {
                id: 'c1',
                width: 100,
                blocks: [{ id: 'b1', type: 'social', props: { items } }],
              },
            ],
          },
        ],
      },
    ],
  });

  if (!parsed.ok) throw new Error(parsed.errors.join('; '));
  const clean = sanitisePage(parsed.page);
  return clean.sections[0].rows[0].columns[0].blocks[0].props.items as Array<Record<string, unknown>>;
}

describe('an address on the way into the database', () => {
  it('keeps a real one', () => {
    const [item] = pageWithSocial([{ network: 'facebook', href: 'https://facebook.com/someshop' }]);
    expect(item.href).toBe('https://facebook.com/someshop');
  });

  it('empties a javascript: one', () => {
    // eslint-disable-next-line no-script-url
    const [item] = pageWithSocial([{ network: 'facebook', href: 'javascript:alert(1)' }]);
    expect(item.href).toBe('');
  });

  it('empties a data: one, which is the other way to smuggle a script in', () => {
    const [item] = pageWithSocial([
      { network: 'x', href: 'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==' },
    ]);
    expect(item.href).toBe('');
  });

  /*
   * These two are refused by safeUrl by default and this block asks for them,
   * so they are worth pinning: a change to the default would silently empty
   * every footer's email link.
   */
  it('keeps an email address and a phone number, which this block allows', () => {
    const items = pageWithSocial([
      { network: 'email', href: 'mailto:hello@someshop.co.uk' },
      { network: 'phone', href: 'tel:01234567890' },
    ]);
    expect(items[0].href).toBe('mailto:hello@someshop.co.uk');
    expect(items[1].href).toBe('tel:01234567890');
  });
});

// ---------------------------------------------------------------------------
// The renderer, read as source
// ---------------------------------------------------------------------------

describe('what the renderer does with what it is given', () => {
  const source = read('components', 'render', 'blocks.tsx');
  const block = source.slice(source.indexOf('export function SocialBlock'));
  const body = block.slice(0, block.indexOf('\n}\n'));

  it('looks the network up in the closed list rather than trusting the id', () => {
    expect(body).toContain("socialNetwork(str(item, 'network'))");
    expect(body).toContain('if (!network) return null;');
  });

  it('runs the address through safeUrl, with mailto asked for explicitly', () => {
    expect(body).toContain("safeUrl(str(item, 'href'), { allowMailto: true })");
    expect(body).toContain('if (!href) return null;');
  });

  /*
   * A row of icon-only links has no text content at all: every anchor's child is
   * an SVG, which a screen reader announces as nothing. The name has to come
   * from somewhere and aria-label is that somewhere. With the names showing the
   * visible text IS the name, so the label is dropped rather than read twice.
   */
  it('gives an icon-only link an accessible name, and does not double it up', () => {
    expect(body).toContain('aria-label={showLabels ? undefined : network.label}');
  });

  it('opens an outward link in a new tab without handing over the referrer', () => {
    expect(body).toContain("rel={external ? 'noopener noreferrer' : undefined}");
    // mailto: and tel: are not "external" in this sense: a new tab for an email
    // client is a blank tab left behind.
    expect(body).toContain('const external = /^https?:/i.test(href);');
  });

  it('says what to do when nothing has an address yet', () => {
    expect(body).toContain('Add the addresses of your accounts');
  });
});

describe('the drawings', () => {
  const icons = read('components', 'render', 'social-icons.tsx');

  /*
   * currentColor, never a brand colour. Eleven fixed brand colours in a footer
   * look like a sticker sheet, and they would fight whatever tone the section
   * is set to. A hex anywhere in this file is the mistake to catch.
   */
  it('takes the colour of the text around it rather than a brand colour', () => {
    expect(icons).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(icons).toContain('stroke="currentColor"');
  });

  it('marks every one as decorative, since the link carries the name', () => {
    expect(icons).toContain('aria-hidden="true"');
    expect(icons).not.toContain('<title');
  });

  /*
   * A drawing is markup we wrote. Nothing in here may interpolate, or the
   * closed list stops being closed.
   */
  it('interpolates nothing into the markup', () => {
    const glyphs = icons.slice(icons.indexOf('const ICONS'), icons.indexOf('export function SocialIcon'));
    expect(glyphs).not.toContain('${');
    expect(glyphs).not.toContain('dangerouslySetInnerHTML');
  });

  it('answers with nothing for a network it cannot draw', () => {
    expect(icons).toContain('return ICONS[network] ?? null;');
  });
});
