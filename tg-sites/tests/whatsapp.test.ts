/**
 * WhatsApp click to chat.
 *
 * THE NUMBER IS THE WHOLE JOB, and the reason this element earns its place over
 * a Button with a wa.me address pasted into it. wa.me wants digits, the country
 * code, and no leading zero. Every form a client will actually type — "+44 1204
 * 123456", "(01204) 123 456", "01204-123456" — breaks at least one of those.
 *
 * AND THE FAILURE IS INVISIBLE FROM OUR SIDE. The link builds, the page
 * publishes, nothing looks wrong, and the visitor gets "phone number shared via
 * url is invalid" from WhatsApp. The client never sees it because they never
 * press their own button. So the normalising is tested here rather than trusted.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { blockDefinition, defaultPropsFor, isKnownBlock } from '../lib/content/blocks';
import { whatsappHref, whatsappNumber, WHATSAPP_MESSAGE_MAX } from '../lib/content/whatsapp';

function source(...parts: string[]): string {
  return readFileSync(join(__dirname, '..', ...parts), 'utf8');
}

// ---------------------------------------------------------------------------

describe('the number', () => {
  it('takes every way somebody writes an international number', () => {
    for (const written of [
      '+441204123456',
      '+44 1204 123456',
      /*
       * THE BRACKETED TRUNK ZERO, which is how a UK business writes its number
       * on a letterhead. Stripping non-digits alone keeps it and gives
       * 4401204123456 — one digit too long, reaching nobody, from an input the
       * client would swear was right. This case failed on the first run of this
       * file and is the reason the step exists.
       */
      '+44 (0)1204 123456',
      '+44 ( 0 ) 1204 123456',
      '44 1204 123456',
      '44-1204-123456',
      '  +44 1204 123456  ',
    ]) {
      expect(whatsappNumber(written), written).toBe('441204123456');
    }
  });

  /*
   * A LEADING ZERO IS REFUSED, NOT REPAIRED. "01204 123456" is a real UK number
   * and "1204123456" is not the international form of it — that needs 44 on the
   * front, and we have no way to know a client is in the UK. Dropping the zero
   * would build a link that looks right and reaches nobody.
   */
  it('refuses a national number rather than guessing its country', () => {
    expect(whatsappNumber('01204 123456')).toBeNull();
    expect(whatsappNumber('0161 234 5678')).toBeNull();
    expect(whatsappNumber('0')).toBeNull();
  });

  /* A typo that builds a link is worse than one that does not. */
  it('refuses something too short or too long to be a number', () => {
    expect(whatsappNumber('12345')).toBeNull();
    expect(whatsappNumber('4412041234567890123')).toBeNull();
    expect(whatsappNumber('')).toBeNull();
    expect(whatsappNumber(null)).toBeNull();
    expect(whatsappNumber('call us')).toBeNull();
  });
});

// ---------------------------------------------------------------------------

describe('the link', () => {
  it('carries the first message, encoded', () => {
    expect(whatsappHref('+44 1204 123456', 'Hello, about Greece')).toBe(
      'https://wa.me/441204123456?text=Hello%2C%20about%20Greece',
    );
  });

  it('opens an empty chat when there is no message', () => {
    expect(whatsappHref('+441204123456', '')).toBe('https://wa.me/441204123456');
    expect(whatsappHref('+441204123456', '   ')).toBe('https://wa.me/441204123456');
  });

  /* The host is a literal and the message is encoded, so nothing a client types
     can become a different origin or a second parameter. */
  it('cannot be redirected by anything typed into the message', () => {
    const href = whatsappHref('+441204123456', 'x&phone=999&hello=https://evil.test');
    expect(href).toContain('https://wa.me/441204123456?text=');
    expect(href).not.toContain('&phone=');
    expect(href).toContain('%26phone%3D999');
  });

  it('caps a pathological message rather than building a giant URL', () => {
    const href = whatsappHref('+441204123456', 'a'.repeat(5000)) ?? '';
    expect(href.length).toBeLessThan(WHATSAPP_MESSAGE_MAX * 4);
  });

  it('is null when the number cannot be used, so nothing draws a dead link', () => {
    expect(whatsappHref('01204 123456', 'Hello')).toBeNull();
    expect(whatsappHref('', 'Hello')).toBeNull();
  });
});

// ---------------------------------------------------------------------------

describe('the block', () => {
  const definition = blockDefinition('whatsapp')!;

  it('is in the library, under Actions, and belongs to the client', () => {
    expect(isKnownBlock('whatsapp')).toBe(true);
    expect(definition.group).toBe('Actions');
    expect(definition.staffOnly).toBeUndefined();
  });

  it('sets a default for every field the editor offers', () => {
    const props = defaultPropsFor('whatsapp');
    for (const field of definition.fields) {
      expect(props, `no default for "${field.key}"`).toHaveProperty(field.key);
    }
  });

  /* WhatsApp was already one icon in the Social links row. This is a different
     thing: a button that opens a chat with the message already written. */
  it('does not replace the WhatsApp entry in the social row', () => {
    expect(source('lib', 'content', 'social.ts')).toContain("{ id: 'whatsapp', label: 'WhatsApp' }");
  });

  const renderer = source('components', 'render', 'blocks.tsx');

  /* A link that builds and reaches nobody is the worst outcome, because the page
     publishes and nothing looks wrong. */
  it('draws its empty state rather than a dead link', () => {
    expect(renderer).toContain('Add a WhatsApp number, with its country code');
  });

  /* A bubble has no visible words, so its name has to come from aria-label; the
     button already says WhatsApp beside the mark, so the mark is hidden there. */
  it('names the bubble for a screen reader and hides the mark in the button', () => {
    expect(renderer).toMatch(/tgs-whatsapp__bubble"[^>]*aria-label=\{label\}/);
    expect(renderer).toMatch(/tgs-whatsapp__mark[\s\S]{0,400}aria-hidden="true"/);
  });

  /* No script, no scroll listener, no timed entrance. */
  it('floats with CSS alone', () => {
    const css = source('app', 'globals.css');
    expect(css).toMatch(/\.tgs-whatsapp\[data-look='floating'\] \.tgs-whatsapp__bubble \{[^}]*position: fixed/);
    expect(renderer).not.toMatch(/WhatsAppBlock[\s\S]{0,3000}addEventListener/);
  });

  /*
   * THE ONE HARDCODED BRAND COLOUR IN THE STYLESHEET, and it is deliberate: a
   * WhatsApp button in a client's navy is a button nobody recognises at a
   * glance, and recognition is the whole reason somebody presses it.
   */
  it('keeps WhatsApp green rather than taking the site palette', () => {
    expect(source('app', 'globals.css')).toContain('background: #25d366;');
  });
});
