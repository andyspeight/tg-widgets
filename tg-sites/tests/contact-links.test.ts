/**
 * Phone and email links, which a client can type into any link field.
 *
 * THE BUG THIS FILE EXISTS FOR (20 Aug 2026). safeUrl has always accepted tel:
 * and mailto: when asked, and the SAVE path always asked: sanitise-page.ts runs
 * every `url` field through it with the option set, so a phone number typed into
 * a Button stored perfectly.
 *
 * Seven of the eight renderers then called safeUrl WITHOUT the option. So the
 * link was dropped at the last step and a Button fell back to href="#". The
 * client typed a phone number, saw it save, and published a button that went
 * nowhere. Only the social row got it right, and only because an email link
 * there was obvious enough that somebody thought about it.
 *
 * The option was called `allowMailto` and gated tel: as well, which is how the
 * omission spread: it reads like an email-only flag, so nobody adding a link
 * field thought it had anything to do with a phone number.
 *
 * WHAT THIS PINS: that the save path and the render path agree. A test that only
 * checked one of them would have passed happily the whole time.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { safeUrl } from '../lib/content/sanitise';
import { parsePage, type Page } from '../lib/content/schema';
import { sanitisePage } from '../lib/content/sanitise-page';

function source(...parts: string[]): string {
  return readFileSync(join(__dirname, '..', ...parts), 'utf8');
}

const PHONE = 'tel:+441204123456';
const EMAIL = 'mailto:hello@example.com';

/** A sanitised page holding one block, so the SAVE path is what is under test. */
function saved(type: string, props: Record<string, unknown>): Page {
  const parsed = parsePage({
    version: 1,
    id: 'p1',
    title: 'Contact',
    slug: 'contact',
    seo: { noindex: false },
    sections: [
      {
        id: 's1',
        tone: 'light',
        rows: [{ id: 'r1', columns: [{ id: 'c1', width: 100, blocks: [{ id: 'b1', type, props }] }] }],
      },
    ],
  });
  if (!parsed.ok) throw new Error(parsed.errors.join('; '));
  return sanitisePage(parsed.page);
}

const props0 = (page: Page) => page.sections[0].rows[0].columns[0].blocks[0].props;

// ---------------------------------------------------------------------------

describe('safeUrl and the one option that gates both schemes', () => {
  it('lets a phone number and an email address through when asked', () => {
    expect(safeUrl(PHONE, { allowContact: true })).toBe(PHONE);
    expect(safeUrl(EMAIL, { allowContact: true })).toBe(EMAIL);
  });

  /* Unasked, they are refused, which is right for a field like an image source
     where a phone number is not a sensible answer. */
  it('refuses them by default', () => {
    expect(safeUrl(PHONE)).toBeNull();
    expect(safeUrl(EMAIL)).toBeNull();
  });

  /* Nothing was loosened. Everything that could execute is still refused,
     asked for or not. */
  it('still refuses every scheme that could run something', () => {
    for (const bad of [
      'javascript:alert(1)',
      'JaVaScRiPt:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'vbscript:msgbox(1)',
      'file:///etc/passwd',
      '//evil.test/x',
    ]) {
      expect(safeUrl(bad, { allowContact: true }), bad).toBeNull();
    }
  });
});

// ---------------------------------------------------------------------------

describe('the save path keeps a contact link', () => {
  it('keeps a phone number on a button', () => {
    expect(props0(saved('button', { label: 'Ring us', href: PHONE, variant: 'primary' })).href).toBe(PHONE);
  });

  it('keeps an email address on a button', () => {
    expect(props0(saved('button', { label: 'Email us', href: EMAIL, variant: 'primary' })).href).toBe(EMAIL);
  });

  it('still throws away anything that could run', () => {
    expect(props0(saved('button', { label: 'x', href: 'javascript:alert(1)' })).href).toBe('');
  });
});

// ---------------------------------------------------------------------------

describe('the render path keeps it too, which is where it went wrong', () => {
  const renderer = source('components', 'render', 'blocks.tsx');

  /*
   * ONE SHARED CONSTANT rather than the option written out eight times, so the
   * next link field cannot forget it the way seven of them did.
   */
  it('has one constant every href in the file uses', () => {
    expect(renderer).toContain('const CONTACT_OK = { allowContact: true } as const;');
  });

  /*
   * THE REAL ASSERTION. Every safeUrl call on something named href or linkHref
   * has to ask for contact schemes. A picture's `src` is deliberately excluded:
   * a phone number is not an image address, and that is the one place refusing
   * them is right.
   */
  it('asks for them at every link, with no exceptions left behind', () => {
    const linkCalls = [...renderer.matchAll(/safeUrl\((?:str\([^)]*, '(?:href|linkHref)'\)|crumb\.href)[^;]*/g)]
      .map((m) => m[0]);

    // Sanity: the sweep found the calls rather than silently matching nothing.
    expect(linkCalls.length).toBeGreaterThanOrEqual(7);

    for (const call of linkCalls) {
      /*
       * The breadcrumb trail is the one link that is ours rather than the
       * client's: it is built from the page's own address, so it is always a
       * path and never a phone number.
       */
      if (call.includes('crumb.href')) continue;
      expect(call, call).toMatch(/CONTACT_OK|allowContact/);
    }
  });

  /* The button was the worst of them: it does not just drop the link, it
     substitutes one that looks like it works. */
  it('no longer sends a button to the top of the page', () => {
    expect(renderer).toContain("const href = safeUrl(str(button, 'href'), CONTACT_OK) || '#';");
  });
});
