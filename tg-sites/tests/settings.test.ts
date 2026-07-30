/**
 * Site settings.
 *
 * ONE PROPERTY IN HERE MATTERS MORE THAN THE REST: a client can change which
 * analytics container their pages report to, and cannot change what runs. That
 * rests entirely on the id format check, because the id is interpolated into a
 * script string. So the first block below is not "does the regex work", it is "can
 * anything a client types get out of that string".
 *
 * The second thing worth real attention is the split between the two settings
 * shapes. A client's settings are parsed by parseSettings and cannot contain head
 * or body HTML at all, whatever they send.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { isStaffEmail, STAFF_DOMAINS } from '../lib/auth/staff';
import { isAppHost } from '../middleware';

import {
  analytics,
  iconLinks,
  manifest,
  socialMetas,
} from '../lib/settings/head';
import {
  DEFAULT_LOCALE,
  DEFAULT_SETTINGS,
  LOCALE_IDS,
  MAX_RAW_HTML,
  parseSettings,
  parseStaffSettings,
  settingsAreEmpty,
  type SiteSettings,
} from '../lib/settings/schema';

const withSettings = (patch: Partial<SiteSettings>): SiteSettings =>
  parseSettings({ ...DEFAULT_SETTINGS, ...patch });

// ---------------------------------------------------------------------------
// The one that matters
// ---------------------------------------------------------------------------

describe('analytics ids', () => {
  it('accepts the formats Google actually issues', () => {
    expect(parseSettings({ gtmId: 'GTM-ABC1234' }).gtmId).toBe('GTM-ABC1234');
    expect(parseSettings({ ga4Id: 'G-ABC1234567' }).ga4Id).toBe('G-ABC1234567');
  });

  it('forgives what a paste does to them', () => {
    expect(parseSettings({ gtmId: '  gtm-abc1234 ' }).gtmId).toBe('GTM-ABC1234');
    expect(parseSettings({ ga4Id: 'g-abc1234567\n' }).ga4Id).toBe('G-ABC1234567');
    // A space in the middle is a paste artefact too, not a different container.
    expect(parseSettings({ gtmId: 'GTM- ABC1234' }).gtmId).toBe('GTM-ABC1234');
  });

  /*
   * THE INJECTION CASE.
   *
   * lib/settings/head.ts interpolates the id into a script string, and the format
   * check is the only thing that makes that safe. Every one of these has to come
   * back null, because a null is never emitted at all.
   */
  it('refuses anything that could escape the script string', () => {
    const hostile = [
      "GTM-A'});alert(1);//",
      'GTM-A";alert(1);//',
      'GTM-A</script><script>alert(1)</script>',
      'GTM-A\\',
      'GTM-A;alert(1)',
      'GTM-A+B',
      'GTM-A B',
      "G-ABC1234'});alert(1);//",
    ];

    for (const value of hostile) {
      expect(parseSettings({ gtmId: value }).gtmId, value).toBeNull();
      expect(parseSettings({ ga4Id: value }).ga4Id, value).toBeNull();
    }
  });

  /*
   * And the belt to that brace: whatever a client sends, nothing dangerous can
   * reach the emitted snippet, because the emitter is fed the PARSED value.
   */
  it('never emits a snippet containing anything a client typed unchecked', () => {
    const settings = withSettings({
      gtmId: "GTM-A'});alert('pwned');//" as unknown as string,
      ga4Id: 'G-XYZ9876543',
    });

    const out = analytics(settings);
    const everything = [...out.headInline, ...out.headSrc, ...out.bodyMarkup].join('\n');

    expect(everything).not.toContain('pwned');
    expect(everything).not.toContain('alert');
    // The valid one still made it through, so this is not passing by emitting
    // nothing at all.
    expect(everything).toContain('G-XYZ9876543');
  });

  it('refuses the old UA ids rather than pretending they work', () => {
    // These properties stopped collecting data in 2023. Accepting one would give
    // somebody a screen saying tracking is on and a site reporting nothing.
    expect(parseSettings({ ga4Id: 'UA-12345678-1' }).ga4Id).toBeNull();
    expect(parseSettings({ gtmId: 'UA-12345678-1' }).gtmId).toBeNull();
  });

  it('does not confuse the two id types', () => {
    expect(parseSettings({ gtmId: 'G-ABC1234567' }).gtmId).toBeNull();
    expect(parseSettings({ ga4Id: 'GTM-ABC1234' }).ga4Id).toBeNull();
  });

  it('is total', () => {
    for (const value of [null, undefined, 42, {}, [], '']) {
      expect(parseSettings({ gtmId: value }).gtmId).toBeNull();
      expect(parseSettings({ ga4Id: value }).ga4Id).toBeNull();
    }
  });
});

describe('the analytics snippets', () => {
  it('emits nothing at all when nothing is configured', () => {
    const out = analytics(DEFAULT_SETTINGS);
    expect(out.headInline).toEqual([]);
    expect(out.headSrc).toEqual([]);
    expect(out.bodyMarkup).toEqual([]);
    expect(out.bothConfigured).toBe(false);
  });

  it('gives tag manager its head snippet and its noscript fallback', () => {
    const out = analytics(withSettings({ gtmId: 'GTM-ABC1234' }));
    expect(out.headInline.join()).toContain('GTM-ABC1234');
    expect(out.headInline.join()).toContain('gtm.js');
    expect(out.bodyMarkup.join()).toContain('<noscript>');
    expect(out.bodyMarkup.join()).toContain('GTM-ABC1234');
  });

  it('gives GA4 an external script and a config call', () => {
    const out = analytics(withSettings({ ga4Id: 'G-ABC1234567' }));
    expect(out.headSrc).toEqual(['https://www.googletagmanager.com/gtag/js?id=G-ABC1234567']);
    expect(out.headInline.join()).toContain("gtag('config','G-ABC1234567')");
    // No noscript: GA4 has no non-JavaScript fallback to offer.
    expect(out.bodyMarkup).toEqual([]);
  });

  /*
   * Not an error, but worth saying out loud on the screen. The usual arrangement is
   * to configure Analytics inside Tag Manager, so setting both here loads the tag
   * twice and double-counts every page view.
   */
  it('notices when both are set, so the screen can warn about double counting', () => {
    expect(analytics(withSettings({ gtmId: 'GTM-ABC1234' })).bothConfigured).toBe(false);
    expect(analytics(withSettings({ ga4Id: 'G-ABC1234567' })).bothConfigured).toBe(false);
    expect(
      analytics(withSettings({ gtmId: 'GTM-ABC1234', ga4Id: 'G-ABC1234567' })).bothConfigured,
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Images
// ---------------------------------------------------------------------------

describe('the icon and social image URLs', () => {
  it('takes an https URL or a path on this site', () => {
    expect(parseSettings({ faviconUrl: 'https://cdn.test/icon.png' }).faviconUrl)
      .toBe('https://cdn.test/icon.png');
    expect(parseSettings({ faviconUrl: '/icon.png' }).faviconUrl).toBe('/icon.png');
  });

  /*
   * These end up in a link or meta tag on every page of a client's site, so the
   * same whitelist that guards an image block guards them.
   */
  it('refuses a scheme that has no business in a link tag', () => {
    for (const value of [
      'javascript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      '//evil.test/icon.png',
      'vbscript:msgbox',
    ]) {
      expect(parseSettings({ faviconUrl: value }).faviconUrl, value).toBeNull();
      expect(parseSettings({ socialImageUrl: value }).socialImageUrl, value).toBeNull();
      expect(parseSettings({ touchIconUrl: value }).touchIconUrl, value).toBeNull();
    }
  });

  it('offers no manifest when there is no icon to put in it', () => {
    // An empty manifest makes Android offer to install the site and then show a
    // screenshot of the page as its icon.
    expect(iconLinks(DEFAULT_SETTINGS)).toEqual([]);
    expect(manifest(DEFAULT_SETTINGS, 'Demo Travel').icons).toEqual([]);
  });

  it('adds the manifest only alongside a home screen icon', () => {
    const favicon = iconLinks(withSettings({ faviconUrl: '/f.png' }));
    expect(favicon.map((l) => l.rel)).toEqual(['icon']);

    const both = iconLinks(withSettings({ faviconUrl: '/f.png', touchIconUrl: '/t.png' }));
    expect(both.map((l) => l.rel)).toEqual(['icon', 'apple-touch-icon', 'manifest']);
  });
});

// ---------------------------------------------------------------------------
// Sharing
// ---------------------------------------------------------------------------

describe('social meta tags', () => {
  const page = { title: 'Ten nights in the Maldives', description: 'Overwater villas.' };

  /*
   * og: is RDFa and uses `property`; Twitter cards are plain meta names and use
   * `name`. They look interchangeable and are not: swap them and you get two tags
   * that validate and neither of which is read by anything.
   */
  it('uses property for Open Graph and name for Twitter', () => {
    const metas = socialMetas(withSettings({ socialImageUrl: '/s.png' }), page);

    for (const meta of metas) {
      if (meta.property) expect(meta.property.startsWith('og:'), meta.property).toBe(true);
      if (meta.name) expect(meta.name.startsWith('twitter:'), meta.name).toBe(true);
      // Never both, and never neither.
      expect(Boolean(meta.property) !== Boolean(meta.name)).toBe(true);
    }
  });

  it('lets a page image beat the site default', () => {
    const metas = socialMetas(withSettings({ socialImageUrl: '/site.png' }), {
      ...page,
      image: '/page.png',
    });
    const image = metas.find((m) => m.property === 'og:image');
    expect(image?.content).toBe('/page.png');
  });

  it('falls back to the site image when the page has none', () => {
    const metas = socialMetas(withSettings({ socialImageUrl: '/site.png' }), page);
    expect(metas.find((m) => m.property === 'og:image')?.content).toBe('/site.png');
  });

  /*
   * Asking for the large card with no image gives a card with a blank grey
   * rectangle, which looks worse than the plain summary the absence would produce.
   */
  it('does not ask for a large image card when there is no image', () => {
    const metas = socialMetas(DEFAULT_SETTINGS, page);
    expect(metas.find((m) => m.name === 'twitter:card')?.content).toBe('summary');
    expect(metas.find((m) => m.property === 'og:image')).toBeUndefined();
  });

  it('writes the locale the way Open Graph wants it', () => {
    // en-GB in our settings, en_GB in the tag. Underscore, not hyphen.
    const metas = socialMetas(withSettings({ locale: 'fr-FR' }), page);
    expect(metas.find((m) => m.property === 'og:locale')?.content).toBe('fr_FR');
  });
});

// ---------------------------------------------------------------------------
// Language
// ---------------------------------------------------------------------------

describe('the site language', () => {
  it('accepts a code from the list', () => {
    for (const id of LOCALE_IDS) {
      expect(parseSettings({ locale: id }).locale).toBe(id);
    }
  });

  it('falls back rather than claiming a language it does not have', () => {
    for (const value of ['klingon', 'en', '', null, 42, {}]) {
      expect(parseSettings({ locale: value }).locale, String(value)).toBe(DEFAULT_LOCALE);
    }
  });
});

// ---------------------------------------------------------------------------
// The client and staff split
// ---------------------------------------------------------------------------

describe('staff settings are a different shape entirely', () => {
  /*
   * The reason the columns are separate. Whatever a client sends, parseSettings
   * produces an object with no head or body HTML in it, so there is nothing for a
   * save action to accidentally persist.
   */
  it('a client cannot smuggle head or body HTML through the client parser', () => {
    const parsed = parseSettings({
      gtmId: 'GTM-ABC1234',
      headHtml: '<script>alert(1)</script>',
      bodyHtml: '<script>alert(2)</script>',
      staffSettings: { headHtml: '<script>alert(3)</script>' },
    });

    expect(Object.keys(parsed).sort()).toEqual([
      'faviconUrl',
      'ga4Id',
      'gtmId',
      'locale',
      'socialImageUrl',
      'touchIconUrl',
    ]);
    expect(JSON.stringify(parsed)).not.toContain('script');
  });

  /*
   * And the other half of the same claim: the staff parser deliberately does NOT
   * sanitise. A sanitised head injection would strip the script tag that is the
   * only reason the field exists, so the protection is who can reach it.
   */
  it('keeps a script tag, because that is the whole point of the field', () => {
    const staff = parseStaffSettings({
      headHtml: '<script src="https://chat.test/w.js" async></script>',
      bodyHtml: '<div id="chat"></div>',
    });
    expect(staff.headHtml).toContain('<script');
    expect(staff.bodyHtml).toContain('<div id="chat">');
  });

  it('keeps newlines and tabs, because a pasted snippet is formatted', () => {
    const staff = parseStaffSettings({ headHtml: '<script>\n\tvar a = 1;\n</script>' });
    expect(staff.headHtml).toBe('<script>\n\tvar a = 1;\n</script>');
  });

  it('strips the control characters that are never intentional', () => {
    // Escaped, not literal: a raw control byte in a source file parses fine in
    // Node and gets mangled by a bundler, which is what the source-hygiene check
    // in tests/db.test.ts exists to catch. Writing it this way also makes what
    // goes in and what comes out both readable.
    const staff = parseStaffSettings({
      headHtml: '<meta\u0000 name=\u0001"a\u001F">',
    });
    expect(staff.headHtml).toBe('<meta name="a">');
  });

  it('caps the length so a paste accident cannot land on every page', () => {
    const staff = parseStaffSettings({ headHtml: 'x'.repeat(MAX_RAW_HTML * 2) });
    expect(staff.headHtml.length).toBe(MAX_RAW_HTML);
  });

  it('is total', () => {
    for (const value of [null, undefined, 42, 'nonsense', []]) {
      expect(parseStaffSettings(value)).toEqual({ headHtml: '', bodyHtml: '' });
    }
  });
});

describe('settingsAreEmpty', () => {
  it('is true for a site nobody has configured', () => {
    expect(settingsAreEmpty(parseSettings({}))).toBe(true);
    expect(settingsAreEmpty(parseSettings(null))).toBe(true);
  });

  it('is false as soon as anything is set', () => {
    expect(settingsAreEmpty(withSettings({ gtmId: 'GTM-ABC1234' }))).toBe(false);
    expect(settingsAreEmpty(withSettings({ faviconUrl: '/f.png' }))).toBe(false);
    expect(settingsAreEmpty(withSettings({ locale: 'fr-FR' }))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Who counts as staff
// ---------------------------------------------------------------------------

describe('the staff check', () => {
  it('recognises a Travelgenix address and nothing else', () => {
    for (const email of [
      'andy.speight@agendas.group',
      'someone@travelgenix.com',
      'someone@travelgenix.io',
      'Someone@TravelGenix.IO',
      '  someone@travelgenix.io  ',
    ]) {
      expect(isStaffEmail(email), email).toBe(true);
    }

    for (const email of [
      'owner@someagency.co.uk',
      // The domain is what counts, and it is what comes after the LAST @.
      'agendas.group@gmail.com',
      'someone@notagendas.group',
      'someone@agendas.group.evil.test',
      'agendas.group',
      // No local part, so not an address. This is where the check is
      // deliberately stricter than the widget suite's, which grants it.
      '@agendas.group',
      '@travelgenix.io',
      '',
      null,
      undefined,
      42,
      {},
    ]) {
      expect(isStaffEmail(email as unknown), String(email)).toBe(false);
    }
  });

  /*
   * An address may legally contain more than one @ inside a quoted local part, so
   * the domain is whatever follows the LAST one. Splitting on the first would read
   * this as the domain "b".
   */
  it('reads the domain after the last @, not the first', () => {
    expect(isStaffEmail('"a@b"@travelgenix.io')).toBe(true);
    expect(isStaffEmail('"a@travelgenix.io"@evil.test')).toBe(false);
  });

  /*
   * THE DRIFT CATCHER.
   *
   * api/_lib/auth/staff.js in the widget suite is the original and its header says
   * never to re-implement the check, so the rule cannot drift. That cannot be
   * followed literally across two runtimes: it is JavaScript in the repository root
   * with its own imports, this is a TypeScript app in a subdirectory with its own
   * build. So the definition is mirrored and this test is what keeps the mirror
   * honest. If somebody adds a domain over there and not here, a Travelgenix person
   * would silently not be staff in this product.
   */
  it('agrees with the widget suite about which domains are Travelgenix', () => {
    const source = readFileSync(
      join(__dirname, '..', '..', 'api', '_lib', 'auth', 'staff.js'),
      'utf8',
    );

    const match = source.match(/export const STAFF_DOMAINS = \[([^\]]+)\]/);
    expect(match, 'STAFF_DOMAINS moved or was renamed in the widget suite').toBeTruthy();

    const theirs = [...match![1].matchAll(/'([^']+)'/g)].map((m) => m[1]).sort();
    expect(theirs).toEqual([...STAFF_DOMAINS].sort());
  });
});

// ---------------------------------------------------------------------------
// Which product a hostname gets
// ---------------------------------------------------------------------------

/**
 * The routing decision, tested because getting it wrong is invisible in one
 * direction and catastrophic in the other.
 *
 * Wrong towards "app": a client's real domain serves the Travelgenix front door,
 * which they and their customers see immediately.
 *
 * Wrong towards "site": a preview deployment 404s, which reads as the branch being
 * broken and sends somebody looking in the wrong place for an hour.
 */
describe('isAppHost', () => {
  it('keeps our own hostnames on the editor', () => {
    for (const host of [
      'localhost',
      'localhost:3100',
      '127.0.0.1:3100',
      'tg-sites-shell.vercel.app',
      // Every preview deployment gets its own generated name under vercel.app, so
      // the whole suffix is ours. A list would be one nobody could keep current.
      'tg-sites-shell-71ajh2qpp-agendasgroup.vercel.app',
    ]) {
      expect(isAppHost(host), host).toBe(true);
    }
  });

  it('sends a client domain to their website', () => {
    for (const host of [
      'www.demotravel.co.uk',
      'demotravel.co.uk',
      'kuoni.com',
      'www.demotravel.co.uk:443',
    ]) {
      expect(isAppHost(host), host).toBe(false);
    }
  });

  /*
   * THE CASE THAT WOULD HAVE BROKEN THE FEATURE.
   *
   * A preview subdomain is a client's SITE, not the editor. Checked before the
   * suffix rules for exactly this reason, and it would be easy to get wrong later
   * by adding a rule above it.
   */
  it('treats a preview subdomain as a site, not as the editor', () => {
    expect(isAppHost('demo-travel.sites.travelify.io')).toBe(false);
    expect(isAppHost('kuoni.sites.travelify.io')).toBe(false);
    expect(isAppHost('DEMO-TRAVEL.SITES.TRAVELIFY.IO')).toBe(false);
  });

  /*
   * A hostname that merely ends with the right text is a different host. The check
   * is on a leading dot, so this cannot be spoofed by registering a domain that
   * ends in the same letters.
   */
  it('is not fooled by a lookalike suffix', () => {
    expect(isAppHost('evil-vercel.app')).toBe(false);
    expect(isAppHost('notlocalhost')).toBe(false);
    // And the reserved suffix cannot be faked into being a site either way round.
    expect(isAppHost('sites.travelify.io.evil.test')).toBe(false);
  });

  it('is case and port insensitive', () => {
    expect(isAppHost('LOCALHOST:3100')).toBe(true);
    expect(isAppHost('TG-Sites-Shell.Vercel.App')).toBe(true);
  });

  it('fails towards the site for an empty or nonsense host', () => {
    // An empty Host header is not ours, so it renders as a site and 404s. Better
    // than serving the editor to something that could not name us.
    expect(isAppHost('')).toBe(false);
  });
});
