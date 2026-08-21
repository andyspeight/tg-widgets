/**
 * Two business elements: a discount code, and a list of branches.
 *
 * THE COUPON'S ONE REAL RISK is the date. An offer that ended in March and is
 * still on the page in July is a customer ringing up to argue about it, and the
 * client will not notice because they never visit their own offers page. So the
 * expiry is decided when the page is drawn, and the decision is a pure function
 * that takes TODAY as an argument — otherwise these tests could only ever ask
 * what happens on the day somebody runs them.
 *
 * THE LOCATIONS BLOCK'S is not framing six maps. That is the whole reason it is
 * a separate block from Location rather than that one repeated.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { blockDefinition, defaultPropsFor, isKnownBlock } from '../lib/content/blocks';
import { couponDate, couponEndsLabel, couponExpired, todayUtc } from '../lib/content/coupon';
import { mapDirectionsUrl } from '../lib/content/map';

function source(...parts: string[]): string {
  return readFileSync(join(__dirname, '..', ...parts), 'utf8');
}

// ---------------------------------------------------------------------------

describe('when a coupon has run out', () => {
  it('is not expired before its date, and not on the day itself', () => {
    expect(couponExpired('2026-09-30', '2026-09-01')).toBe(false);
    /*
     * THE LAST DAY IS INCLUDED. "Ends 30 September" means you can still use it
     * on the 30th, which is what a customer reading it believes.
     */
    expect(couponExpired('2026-09-30', '2026-09-30')).toBe(false);
  });

  it('is expired the day after', () => {
    expect(couponExpired('2026-09-30', '2026-10-01')).toBe(true);
    expect(couponExpired('2026-09-30', '2027-01-01')).toBe(true);
  });

  /* An offer with no end date runs until somebody takes it down. */
  it('never expires without a date', () => {
    expect(couponExpired('', '2030-01-01')).toBe(false);
    expect(couponExpired(null, '2030-01-01')).toBe(false);
  });

  /*
   * REFUSING TO HIDE ON A DATE WE CANNOT READ is the safer direction to fail.
   * Hiding a live offer because a client typed the date oddly is a worse
   * outcome than showing one a day too long.
   */
  it('does not hide anything over a date it cannot read', () => {
    for (const bad of ['30/09/2026', 'September', '2026-9-3', '2026-13-01', '2026-02-31', 'soon']) {
      expect(couponDate(bad), bad).toBeNull();
      expect(couponExpired(bad, '2030-01-01'), bad).toBe(false);
    }
  });

  /*
   * "2026-02-31" is the one that would slip past a shape check: it matches the
   * pattern and is not a date, and left alone it compares as later than the end
   * of February, quietly extending an offer by three days.
   */
  it('checks the day is real, not just the right shape', () => {
    expect(couponDate('2026-02-28')).toBe('2026-02-28');
    expect(couponDate('2026-02-29')).toBeNull();
    // 2028 is a leap year, so this one IS a day.
    expect(couponDate('2028-02-29')).toBe('2028-02-29');
  });

  /* Compared as a calendar DAY, never as a moment. A Date would make an offer
     ending on the 30th stop at 1am on the 30th for anybody east of London. */
  it('compares days rather than moments', () => {
    expect(source('lib', 'content', 'coupon.ts')).toContain('return today > end;');
    expect(source('lib', 'content', 'coupon.ts')).not.toContain('getTime()');
  });

  it('writes the end date the way a person would', () => {
    expect(couponEndsLabel('2026-09-30')).toBe('Ends 30 September 2026');
    expect(couponEndsLabel('2026-01-01')).toBe('Ends 1 January 2026');
    expect(couponEndsLabel('')).toBe('');
  });

  it('reads today as the same plain day a client typed', () => {
    expect(todayUtc(new Date('2026-09-30T23:59:00Z'))).toBe('2026-09-30');
    expect(todayUtc(new Date('2026-10-01T00:01:00Z'))).toBe('2026-10-01');
  });
});

// ---------------------------------------------------------------------------

describe('the Coupon block', () => {
  const definition = blockDefinition('coupon')!;

  it('is in the library, under Actions and contact, and belongs to the client', () => {
    expect(isKnownBlock('coupon')).toBe(true);
    expect(definition.group).toBe('Actions and contact');
    expect(definition.staffOnly).toBeUndefined();
  });

  it('sets a default for every field the editor offers', () => {
    const props = defaultPropsFor('coupon');
    for (const field of definition.fields) {
      expect(props, `no default for "${field.key}"`).toHaveProperty(field.key);
    }
  });

  /* On by default because the failure it prevents is expensive and the one it
     causes is visible in the editor immediately. */
  it('hides an expired offer by default', () => {
    expect(defaultPropsFor('coupon').hideExpired).toBe(true);
  });

  const renderer = source('components', 'render', 'blocks.tsx');

  /*
   * NO COPY BUTTON, and that is the design. Copying needs a script and a
   * published page ships none; `user-select: all` selects the whole code on one
   * click, which works with no JavaScript and cannot fail silently the way a
   * clipboard call does when a browser refuses it.
   */
  it('selects the code on one click instead of shipping a copy button', () => {
    expect(source('app', 'globals.css')).toMatch(/\.tgs-coupon__value \{[^}]*user-select: all/);
    expect(renderer).not.toMatch(/CouponBlock[\s\S]{0,2500}clipboard/i);
  });

  /* A client editing last season's coupon has to see the thing they are
     editing, so the canvas keeps it and says it has ended. */
  it('keeps an expired coupon on the canvas and drops it from a live page', () => {
    expect(renderer).toContain('if (expired && hideExpired && !editing) return null;');
    expect(renderer).toContain('this has ended');
  });
});

// ---------------------------------------------------------------------------

describe('the Multi Location block', () => {
  const definition = blockDefinition('locations')!;

  it('is in the library, under Actions and contact, and belongs to the client', () => {
    expect(isKnownBlock('locations')).toBe(true);
    expect(definition.group).toBe('Actions and contact');
    expect(definition.staffOnly).toBeUndefined();
  });

  it('sets a default for every field the editor offers', () => {
    const props = defaultPropsFor('locations');
    for (const field of definition.fields) {
      expect(props, `no default for "${field.key}"`).toHaveProperty(field.key);
    }
  });

  it('takes a repeater of branches with the fields a branch needs', () => {
    const field = definition.fields.find((f) => f.key === 'items');
    expect(field?.kind).toBe('repeater');
    const keys = field && 'fields' in field ? field.fields.map((f) => f.key) : [];
    expect(keys).toEqual(['name', 'address', 'phone', 'email', 'hours']);
  });

  /*
   * THE REASON THIS IS NOT THE LOCATION BLOCK REPEATED. Six frames is six
   * third-party page loads before a visitor has decided which branch they want.
   * A link costs nothing until it is clicked and opens the maps app on a phone.
   */
  it('links to directions rather than framing a map per branch', () => {
    const renderer = source('components', 'render', 'blocks.tsx');
    expect(renderer).not.toMatch(/LocationsBlock[\s\S]{0,3000}<iframe/);
    expect(renderer).toMatch(/LocationsBlock[\s\S]{0,3000}mapDirectionsUrl\(address\)/);
  });

  /* Host is a literal and the address is encoded, the same rule the map embed
     keeps: nothing a client types can become a different origin. */
  it('builds a directions link nothing typed can redirect', () => {
    expect(mapDirectionsUrl('12 Bridge St, Bolton')).toBe(
      'https://www.google.com/maps/dir/?api=1&destination=12%20Bridge%20St%2C%20Bolton',
    );
    expect(mapDirectionsUrl('')).toBeNull();
    // An address that tries to add a parameter or a second URL comes out encoded.
    expect(mapDirectionsUrl('x&q=https://evil.test')).toContain('x%26q%3Dhttps%3A%2F%2Fevil.test');
  });

  /* A tap rings the branch: built from the digits so "01204 123 456" dials,
     while the visible text stays in the form somebody recognises. */
  it('dials the digits and shows what the client typed', () => {
    const renderer = source('components', 'render', 'blocks.tsx');
    expect(renderer).toContain('`tel:${phone.replace(/[^\\d+]/g, \'\')}`');
  });

  /* Six branches must not give a screen reader six links all called
     "Directions". */
  it('names each directions link for its branch', () => {
    expect(source('components', 'render', 'blocks.tsx')).toContain(
      '<span className="tgs-sr-only"> to {name}</span>',
    );
  });
});
