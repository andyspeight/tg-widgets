/**
 * The address, the phone number and the opening hours.
 *
 * WHY THIS IS ITS OWN FILE. Everything else built for visibility was assembled
 * out of things the client had already typed: the company name, the social
 * links, the accordion questions. This is the one part that asks them for
 * something new, and the deal that justifies asking is that it goes into the
 * structured data as a FACT about a real place. So the risk here is not a broken
 * screen, it is a document that states something untrue in a format written
 * specifically for a reader that cannot tell.
 *
 * THREE CLAIMS ARE WORTH MORE THAN THE REST:
 *
 * 1. Nothing is asserted that was not said. An empty address must produce NO
 *    address property, not an empty PostalAddress. An engine reading
 *    `address: {}` has been told this business has an address with nothing in
 *    it, which is a worse answer than silence and one nothing will flag.
 *
 * 2. A country on its own is not a location. It is the field most likely to be
 *    filled in alone, because it is the only one somebody can answer without
 *    thinking, and "United Kingdom" places a business nowhere.
 *
 * 3. A half-filled day is kept in the settings and counts for nothing in the
 *    markup. That looks like an inconsistency and is the fix for a real bug: a
 *    time input reports nothing until a whole time is entered, so throwing away
 *    the half would blank the field the instant it was filled in.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { auditSite } from '../lib/seo/audit';
import {
  openingHoursLd,
  organisationLd,
  pageJsonLd,
  postalAddressLd,
} from '../lib/seo/jsonld';
import {
  DEFAULT_SETTINGS,
  hasOpeningHours,
  hasPostalAddress,
  isOpenDay,
  parseSettings,
  type SiteSettings,
  WEEKDAYS,
} from '../lib/settings/schema';

const ORIGIN = 'https://someshop.test';

const FULL: SiteSettings = parseSettings({
  companyName: 'Someshop Travel',
  companyAbout: 'A high street agency in Leeds.',
  streetAddress: '14 Market Street',
  addressLocality: 'Leeds',
  addressRegion: 'West Yorkshire',
  postalCode: 'LS1 6DT',
  addressCountry: 'United Kingdom',
  telephone: '+44 113 496 0000',
  openingHours: [
    { day: 'Monday', opens: '09:00', closes: '17:30' },
    { day: 'Tuesday', opens: '09:00', closes: '17:30' },
    { day: 'Saturday', opens: '10:00', closes: '16:00' },
  ],
});

const ids = (findings: ReadonlyArray<{ id: string }>) => findings.map((f) => f.id);

// ---------------------------------------------------------------------------
// The parser
// ---------------------------------------------------------------------------

describe('reading contact details off whatever arrived', () => {
  it('is total, like every other parser here', () => {
    for (const rubbish of [null, undefined, 0, 'a string', [], { streetAddress: 42 }]) {
      expect(() => parseSettings(rubbish)).not.toThrow();
    }
    expect(parseSettings({ streetAddress: 42 }).streetAddress).toBe('');
    expect(parseSettings({ openingHours: 'Mondays' }).openingHours).toEqual([]);
  });

  it('keeps an address to one line, because a PostalAddress field is one', () => {
    const parsed = parseSettings({ streetAddress: '  14 Market Street\n\nSecond floor  ' });
    expect(parsed.streetAddress).toBe('14 Market Street Second floor');
  });

  it('takes control characters out, since they end up in a JSON document', () => {
    const parsed = parseSettings({
      addressLocality: `Le${String.fromCharCode(0)}eds${String.fromCharCode(127)}`,
    });
    expect(parsed.addressLocality).toBe('Le eds');
  });

  it('caps each line, since these arrive over the wire', () => {
    const parsed = parseSettings({
      streetAddress: 'x'.repeat(500),
      postalCode: 'y'.repeat(500),
    });
    expect(parsed.streetAddress.length).toBe(120);
    expect(parsed.postalCode.length).toBe(20);
  });

  /*
   * THE ONE REAL CHECK ON A PHONE NUMBER. Deliberately not a format match:
   * a UK-shaped regex would refuse a real Dublin number and this platform is
   * meant for more than one country. But a telephone property that holds no
   * digits is not a lax value, it is a false statement.
   */
  it('refuses a phone number with no digits in it, and only that', () => {
    expect(parseSettings({ telephone: 'call us' }).telephone).toBe('');
    expect(parseSettings({ telephone: '   ' }).telephone).toBe('');
    expect(parseSettings({ telephone: '+44 113 496 0000' }).telephone).toBe('+44 113 496 0000');
    // Written any way at all, as long as it has a number in it.
    expect(parseSettings({ telephone: '(0113) 496 0000 ext 2' }).telephone)
      .toBe('(0113) 496 0000 ext 2');
  });
});

describe('reading the week', () => {
  it('drops a day it has never heard of', () => {
    const parsed = parseSettings({
      openingHours: [
        { day: 'Caturday', opens: '09:00', closes: '17:00' },
        { day: 'Monday', opens: '09:00', closes: '17:00' },
      ],
    });
    expect(parsed.openingHours.map((h) => h.day)).toEqual(['Monday']);
  });

  it('keeps one entry per day, the first, so order cannot decide it', () => {
    const parsed = parseSettings({
      openingHours: [
        { day: 'Monday', opens: '09:00', closes: '17:00' },
        { day: 'Monday', opens: '11:00', closes: '13:00' },
      ],
    });
    expect(parsed.openingHours).toEqual([{ day: 'Monday', opens: '09:00', closes: '17:00' }]);
  });

  /*
   * SORTED HERE, ONCE. The screen renders from WEEKDAYS and the markup renders
   * from this list, and if the two could disagree about what order the week is
   * in, a client would see one thing and publish another.
   */
  it('puts the week back in order however it arrived', () => {
    const parsed = parseSettings({
      openingHours: [
        { day: 'Sunday', opens: '11:00', closes: '15:00' },
        { day: 'Wednesday', opens: '09:00', closes: '17:00' },
        { day: 'Monday', opens: '09:00', closes: '17:00' },
      ],
    });
    expect(parsed.openingHours.map((h) => h.day)).toEqual(['Monday', 'Wednesday', 'Sunday']);
  });

  it('pads a hand-edited time rather than dropping it', () => {
    const parsed = parseSettings({
      openingHours: [{ day: 'Monday', opens: '9:00', closes: '17:30' }],
    });
    expect(parsed.openingHours[0]).toEqual({ day: 'Monday', opens: '09:00', closes: '17:30' });
  });

  it('refuses a time that is not one', () => {
    for (const opens of ['25:00', '09:60', 'nine', '09:00:00', '', '9']) {
      const parsed = parseSettings({
        openingHours: [{ day: 'Monday', opens, closes: '17:00' }],
      });
      expect(parsed.openingHours[0]?.opens, opens).toBe('');
    }
  });

  /*
   * THE HALF-FILLED ROW, which is the reason OpeningHours allows an empty time.
   * A time input reports its value only once a whole time is entered, so
   * choosing an opening time arrives with the closing one still blank. Throwing
   * it away would blank the field the instant it was filled in.
   */
  it('keeps a day with only one of its two times', () => {
    const parsed = parseSettings({
      openingHours: [{ day: 'Monday', opens: '09:00', closes: '' }],
    });
    expect(parsed.openingHours).toEqual([{ day: 'Monday', opens: '09:00', closes: '' }]);
  });

  it('but a day with neither is not a row at all', () => {
    const parsed = parseSettings({
      openingHours: [{ day: 'Monday', opens: '', closes: '' }],
    });
    expect(parsed.openingHours).toEqual([]);
  });

  it('bounds the walk, because the dedupe bounds the output and nothing bounds a payload', () => {
    const huge = Array.from({ length: 5000 }, () => ({
      day: 'Monday',
      opens: '09:00',
      closes: '17:00',
    }));
    expect(parseSettings({ openingHours: huge }).openingHours.length).toBe(1);
  });
});

describe('what counts as being open', () => {
  it('needs both ends of the day', () => {
    expect(isOpenDay({ day: 'Monday', opens: '09:00', closes: '17:00' })).toBe(true);
    expect(isOpenDay({ day: 'Monday', opens: '09:00', closes: '' })).toBe(false);
    expect(isOpenDay({ day: 'Monday', opens: '', closes: '17:00' })).toBe(false);
  });

  /*
   * 09:00 to 09:00 is a slip, and published it would tell an engine the business
   * is open for no time at all, which is worse than saying nothing about Monday.
   */
  it('treats a day of zero length as nothing said', () => {
    expect(isOpenDay({ day: 'Monday', opens: '09:00', closes: '09:00' })).toBe(false);
  });

  it('allows a day that runs past midnight, which is a real thing and valid', () => {
    expect(isOpenDay({ day: 'Friday', opens: '18:00', closes: '02:00' })).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// What is an address
// ---------------------------------------------------------------------------

describe('whether there is an address at all', () => {
  it('is satisfied by a street, a town or a postcode', () => {
    expect(hasPostalAddress(parseSettings({ streetAddress: '14 Market Street' }))).toBe(true);
    expect(hasPostalAddress(parseSettings({ addressLocality: 'Leeds' }))).toBe(true);
    expect(hasPostalAddress(parseSettings({ postalCode: 'LS1 6DT' }))).toBe(true);
  });

  /*
   * THE ONE THAT MATTERS. Country is the field somebody fills in alone, because
   * it is the only one they can answer without looking anything up, and it
   * places the business nowhere. County is the same: West Yorkshire is not an
   * address.
   */
  it('is NOT satisfied by a country or a county on its own', () => {
    expect(hasPostalAddress(parseSettings({ addressCountry: 'United Kingdom' }))).toBe(false);
    expect(hasPostalAddress(parseSettings({ addressRegion: 'West Yorkshire' }))).toBe(false);
    expect(
      hasPostalAddress(
        parseSettings({ addressCountry: 'United Kingdom', addressRegion: 'West Yorkshire' }),
      ),
    ).toBe(false);
  });

  it('and nothing at all is nothing', () => {
    expect(hasPostalAddress(DEFAULT_SETTINGS)).toBe(false);
    expect(hasOpeningHours(DEFAULT_SETTINGS)).toBe(false);
  });

  it('counts a week of half-filled rows as no hours', () => {
    const settings = parseSettings({
      openingHours: WEEKDAYS.map((day) => ({ day, opens: '09:00', closes: '' })),
    });
    expect(settings.openingHours.length).toBe(7);
    expect(hasOpeningHours(settings)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The markup
// ---------------------------------------------------------------------------

describe('the address, as structured data', () => {
  it('carries every part that was filled in', () => {
    expect(postalAddressLd(FULL)).toEqual({
      '@type': 'PostalAddress',
      streetAddress: '14 Market Street',
      addressLocality: 'Leeds',
      addressRegion: 'West Yorkshire',
      postalCode: 'LS1 6DT',
      addressCountry: 'United Kingdom',
    });
  });

  it('leaves out a part that was not, rather than carrying an empty one', () => {
    const node = postalAddressLd(parseSettings({ addressLocality: 'Leeds' }));
    expect(node).toEqual({ '@type': 'PostalAddress', addressLocality: 'Leeds' });
    expect(node).not.toHaveProperty('streetAddress');
  });

  /*
   * NO NODE AT ALL when there is no location. `address: {}` would tell an engine
   * the business has an address containing nothing, and nothing anywhere would
   * flag it, because on the face of it the property is present.
   */
  it('is nothing when nobody has said where', () => {
    expect(postalAddressLd(DEFAULT_SETTINGS)).toBeNull();
    expect(postalAddressLd(parseSettings({ addressCountry: 'United Kingdom' }))).toBeNull();
  });
});

describe('the opening hours, as structured data', () => {
  it('groups the days that share their hours into one statement', () => {
    expect(openingHoursLd(FULL.openingHours)).toEqual([
      {
        '@type': 'OpeningHoursSpecification',
        dayOfWeek: ['Monday', 'Tuesday'],
        opens: '09:00',
        closes: '17:30',
      },
      {
        '@type': 'OpeningHoursSpecification',
        dayOfWeek: ['Saturday'],
        opens: '10:00',
        closes: '16:00',
      },
    ]);
  });

  /*
   * A single day still gets an array. Both shapes are legal and one shape means
   * nothing downstream has to handle two.
   */
  it('always uses a list of days, even for one day', () => {
    const nodes = openingHoursLd([{ day: 'Sunday', opens: '11:00', closes: '15:00' }]);
    expect(Array.isArray(nodes[0].dayOfWeek)).toBe(true);
  });

  it('groups days that are not next to each other, because that is what it means', () => {
    const nodes = openingHoursLd([
      { day: 'Monday', opens: '09:00', closes: '17:00' },
      { day: 'Wednesday', opens: '10:00', closes: '14:00' },
      { day: 'Friday', opens: '09:00', closes: '17:00' },
    ]);
    expect(nodes.length).toBe(2);
    expect(nodes[0].dayOfWeek).toEqual(['Monday', 'Friday']);
  });

  it('skips a half-filled day rather than guessing the other end', () => {
    expect(openingHoursLd([{ day: 'Monday', opens: '09:00', closes: '' }])).toEqual([]);
    expect(openingHoursLd([{ day: 'Monday', opens: '09:00', closes: '09:00' }])).toEqual([]);
  });

  it('is an empty list when nobody has said, not a list of closed days', () => {
    expect(openingHoursLd([])).toEqual([]);
  });
});

describe('the business node', () => {
  it('carries where it is, how to reach it and when it is open', () => {
    const node = organisationLd(FULL, ORIGIN, 'Someshop');

    expect(node?.['@type']).toBe('TravelAgency');
    expect(node?.telephone).toBe('+44 113 496 0000');
    expect((node?.address as Record<string, unknown>).addressLocality).toBe('Leeds');
    expect((node?.openingHoursSpecification as unknown[]).length).toBe(2);
  });

  /*
   * THE CLAIM THIS WHOLE FILE IS FOR. Absent means the key is not there, not
   * there and empty. Three separate ways to accidentally assert nothing: an
   * empty object, an empty string and an empty array.
   */
  it('says nothing at all about details that were never given', () => {
    const node = organisationLd(parseSettings({ companyName: 'Someshop' }), ORIGIN, 'Someshop');

    expect(node).not.toBeNull();
    expect(node).not.toHaveProperty('address');
    expect(node).not.toHaveProperty('telephone');
    expect(node).not.toHaveProperty('openingHoursSpecification');
  });

  it('reaches a published page through pageJsonLd', () => {
    const nodes = pageJsonLd({
      origin: ORIGIN,
      url: `${ORIGIN}/about`,
      path: 'about',
      siteName: 'Someshop',
      settings: FULL,
      pageTitle: 'About us',
    });

    const business = nodes.find((node) => node['@type'] === 'TravelAgency');
    expect((business?.address as Record<string, unknown>).postalCode).toBe('LS1 6DT');
    expect(business?.telephone).toBe('+44 113 496 0000');
  });
});

// ---------------------------------------------------------------------------
// The report
// ---------------------------------------------------------------------------

describe('what the report says about contact details', () => {
  /*
   * ONE FINDING, NOT THREE. Three fields, one panel, one job. As three separate
   * warnings a new site would open this report with six items, three of which
   * say "go to Settings, Contact details", and a list somebody skims is a list
   * that hides the one thing that mattered.
   */
  it('is a single line whether one thing is missing or all three', () => {
    const none = auditSite(DEFAULT_SETTINGS, 3).filter((f) => f.id.startsWith('contact-'));
    expect(none.length).toBe(1);
    expect(none[0].id).toBe('contact-missing');

    const some = auditSite(parseSettings({ streetAddress: '14 Market Street' }), 3)
      .filter((f) => f.id.startsWith('contact-'));
    expect(some.length).toBe(1);
    expect(some[0].id).toBe('contact-partial');
  });

  /*
   * THE VERB COMES FROM THE SUBJECT, not from how many items there are, and the
   * two are not the same thing. "Opening hours" is already plural, so the first
   * version of this said "Your opening hours is not set" while counting
   * correctly. Both singular cases and the plural one are checked here, because
   * the obvious rewrite is back to counting.
   */
  it('names what is actually missing, so the fix is not a hunt', () => {
    const hours = auditSite(
      parseSettings({ streetAddress: '14 Market Street', telephone: '0113 496 0000' }),
      3,
    ).find((f) => f.id === 'contact-partial');
    expect(hours?.title).toBe('Your opening hours are not set');

    const address = auditSite(
      { ...FULL, streetAddress: '', addressLocality: '', postalCode: '' },
      3,
    ).find((f) => f.id === 'contact-partial');
    expect(address?.title).toBe('Your address is not set');

    const phone = auditSite({ ...FULL, telephone: '' }, 3)
      .find((f) => f.id === 'contact-partial');
    expect(phone?.title).toBe('Your phone number is not set');
  });

  it('lists two or three of them in one sentence, house style, no Oxford comma', () => {
    const two = auditSite(parseSettings({ streetAddress: '14 Market Street' }), 3)
      .find((f) => f.id === 'contact-partial');

    expect(two?.title).toBe('Your phone number and opening hours are not set');
    expect(two?.title).not.toContain(', and');
  });

  it('is happy once all three are there', () => {
    const findings = auditSite(FULL, 3);
    expect(ids(findings)).toContain('contact-ok');
    expect(findings.find((f) => f.id === 'contact-ok')?.severity).toBe('good');
  });

  /*
   * A WARNING, NEVER A PROBLEM. An online-only agency has no shop and no
   * opening hours, and telling them their site is broken for not having one
   * would be the report being wrong about a real customer.
   */
  it('never calls a missing address a problem, because plenty of agencies have none', () => {
    const contact = auditSite(DEFAULT_SETTINGS, 3).filter((f) => f.id.startsWith('contact-'));
    expect(contact[0].severity).toBe('warning');
  });

  it('says where to go and what it buys, like every other finding', () => {
    for (const settings of [DEFAULT_SETTINGS, parseSettings({ telephone: '0113 496 0000' })]) {
      const found = auditSite(settings, 3).find((f) => f.id.startsWith('contact-'));
      expect(found?.fix).toContain('Contact details');
      expect(found?.severity === 'good' || found!.fix.length > 40).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// The screen, read as source
// ---------------------------------------------------------------------------

describe('the settings screen', () => {
  const source = readFileSync(
    join(__dirname, '..', 'components', 'settings', 'SettingsEditor.tsx'),
    'utf8',
  );
  // Comments out first: several of them explain the decisions below, so a match
  // against the raw file would read the explanation as the code.
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

  it('has a tab of its own rather than more boxes on the profile panel', () => {
    expect(code).toContain("{ id: 'contact', label: 'Contact details' }");
  });

  /*
   * autoComplete OFF, AND IT LOOKS LIKE A MISTAKE. These are the BUSINESS's
   * details. A browser offering to fill them from the address book of whoever
   * is signed in would put somebody's home address into the structured data of
   * a public website in one click, and nothing downstream would question it.
   */
  it('never lets a browser autofill a personal address into a business one', () => {
    const panel = code.slice(code.indexOf("tab === 'contact'"), code.indexOf("tab === 'analytics'"));
    const fields = panel.match(/<input/g) ?? [];
    const offs = panel.match(/autoComplete="off"/g) ?? [];

    expect(fields.length).toBeGreaterThan(0);
    expect(offs.length).toBe(fields.length);
  });

  it('names both time boxes, since one day label cannot say which is which', () => {
    expect(code).toContain('${day} opening time');
    expect(code).toContain('${day} closing time');
  });
});
