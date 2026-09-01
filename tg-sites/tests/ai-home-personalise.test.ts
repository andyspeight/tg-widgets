/**
 * Personalising a designed home, tested against the REAL frozen designs.
 *
 * WHAT IS AT RISK:
 *
 * 1. THE REWRITE REACHING THE MARKUP. It must not. A rewrite is a value in the
 *    block's `content` map, substituted and escaped by the renderer at draw
 *    time. This file proves applyHomeCopy only ever writes content overrides
 *    for real, offered text slots, and never the html, css or a forged key.
 *
 * 2. THE DESIGN SURVIVING. Layout, colour, type, pictures and links are the
 *    committed design; only text changes. So image and link slots are never
 *    offered, and a block the model said nothing about is returned untouched
 *    (identity), so a save is a fixpoint on everything it did not reword.
 *
 * 3. THE MODEL INVENTING KEYS. A hallucinated slot id, or a value that is not
 *    a string, writes nothing.
 */

import { describe, expect, it } from 'vitest';

import {
  applyHomeCopy,
  buildHomeUserPrompt,
  homeCopyFromModel,
  homeTextSlots,
  neutraliseFabricated,
  slotId,
} from '../lib/ai/home-personalise';
import { designedHomeSections } from '../lib/content/designed-homes';
import { importContent, importFields } from '../lib/content/imported';
import { FONT_PAIRINGS } from '../lib/ai/theme-design';

function blocksOf(sections: ReturnType<typeof designedHomeSections>) {
  return sections.flatMap((section) =>
    section.rows.flatMap((row) => row.columns.flatMap((column) => column.blocks)),
  );
}

describe('every pairing that names a home names a real one', () => {
  it('the ten designed pairs seed a non-empty page; the six extra name none', () => {
    for (const pairing of FONT_PAIRINGS) {
      if (pairing.home) {
        expect(designedHomeSections(pairing.home).length, pairing.home).toBeGreaterThan(0);
      }
    }
    // Exactly ten homes, one per designed pair.
    expect(FONT_PAIRINGS.filter((pairing) => pairing.home)).toHaveLength(10);
  });
});

describe('collecting the text slots of a real designed home', () => {
  const sections = designedHomeSections('aurelia');

  it('finds the words and never the pictures or links', () => {
    const slots = homeTextSlots(sections);
    expect(slots.length).toBeGreaterThan(20);

    // Every offered slot is a real text field on the block it names.
    const blocks = blocksOf(sections);
    for (const slot of slots) {
      const field = importFields(blocks[slot.block].props as Record<string, unknown>).find(
        (f) => f.key === slot.key,
      );
      expect(field, `${slot.key} on block ${slot.block}`).toBeTruthy();
      expect(field!.kind).toBe('text');
    }
  });

  it('offers the brand name slot, so the company name can land in it', () => {
    const slots = homeTextSlots(sections);
    expect(slots.some((slot) => slot.value === 'AURELIA')).toBe(true);
  });

  it('lists them for the model with a block-qualified id, label and words', () => {
    const slots = homeTextSlots(sections).slice(0, 3);
    const prompt = buildHomeUserPrompt('Halcyon Bay', slots);
    expect(prompt).toContain('Halcyon Bay');
    for (const slot of slots) expect(prompt).toContain(`- ${slotId(slot)} (`);
  });

  it('a key shared across blocks is two DISTINCT ids, not one', () => {
    // The bug the review caught: t1 is the nav brand on one block and a
    // heading on another. Qualified, they are b0-t1 and b2-t1, so a rewrite
    // for one never lands on the other.
    const slots = homeTextSlots(sections);
    const byKey = new Map<string, number[]>();
    for (const slot of slots) {
      byKey.set(slot.key, [...(byKey.get(slot.key) ?? []), slot.block]);
    }
    const shared = [...byKey.entries()].find(([, blocks]) => new Set(blocks).size > 1);
    expect(shared, 'a real designed home shares a key across blocks').toBeTruthy();
    const [key, blocks] = shared!;
    const ids = new Set(blocks.map((block) => `b${block}-${key}`));
    expect(ids.size).toBe(new Set(blocks).size);
  });
});

describe('applying the rewrite', () => {
  const sections = designedHomeSections('harland-vane');
  const slots = homeTextSlots(sections);

  it('writes the words into content, not the markup, and keeps everything else', () => {
    const brandSlot = slots.find((slot) => /vane|studio/i.test(slot.value)) ?? slots[0];
    const answer = JSON.stringify({ [slotId(brandSlot)]: 'Halcyon Bay' });
    const rewritten = homeCopyFromModel(answer, slots);
    if (!rewritten.ok) throw new Error(rewritten.error);

    const out = applyHomeCopy(sections, rewritten.copy);
    const before = blocksOf(sections)[brandSlot.block] as { props: Record<string, unknown> };
    const after = blocksOf(out)[brandSlot.block] as { props: Record<string, unknown> };

    // The override landed in content, on the right key.
    expect(importContent(after.props)[brandSlot.key]).toBe('Halcyon Bay');
    // The markup, css and fields are byte-for-byte the design's own.
    expect(after.props.html).toBe(before.props.html);
    expect(after.props.css).toBe(before.props.css);
    expect(JSON.stringify(after.props.fields)).toBe(JSON.stringify(before.props.fields));
  });

  it('leaves a block the model said nothing about exactly as it was (identity)', () => {
    const slot = slots[0];
    const out = applyHomeCopy(sections, { [slot.block]: { [slot.key]: 'New words' } });
    // Every OTHER block is the same object reference: copy on write.
    const src = blocksOf(sections);
    const dst = blocksOf(out);
    for (let i = 0; i < src.length; i += 1) {
      if (i !== slot.block) expect(dst[i]).toBe(src[i]);
    }
  });

  it('refuses a forged key, a non-string value, and a stale block index', () => {
    const slot = slots[0];
    const rewritten = homeCopyFromModel(
      // A real id, plus a bare (unqualified) key, the markup props, and an invention.
      JSON.stringify({ [slotId(slot)]: 'Real', [slot.key]: 'bare', html: 'hacked', css: 'x{}', 'b0-zzz9': 'nope' }),
      slots,
    );
    if (!rewritten.ok) throw new Error(rewritten.error);
    const allKeys = Object.values(rewritten.copy).flatMap((block) => Object.keys(block));
    // Only real slot keys, reached only through a valid qualified id.
    expect(allKeys).not.toContain('html');
    expect(allKeys).not.toContain('css');
    expect(allKeys).not.toContain('zzz9');
    // The one valid id wrote its slot.
    expect(rewritten.copy[slot.block]?.[slot.key]).toBe('Real');

    // A content write aimed at a block that does not offer the key writes nothing.
    const out = applyHomeCopy(sections, { 999: { [slot.key]: 'off the end' } });
    expect(JSON.stringify(out)).toBe(JSON.stringify(sections));
  });

  it('never writes an image or link slot even if the model returns one', () => {
    const blocks = blocksOf(sections);
    const imageKey = blocks
      .flatMap((block) => importFields(block.props as Record<string, unknown>))
      .find((field) => field.kind === 'image')?.key;
    if (!imageKey) return; // harland-vane has images, but guard anyway
    // The image key is not among the offered text slots, so any id built from it
    // (qualified or bare) is unknown and dropped.
    const rewritten = homeCopyFromModel(
      JSON.stringify({ [`b0-${imageKey}`]: 'https://evil/x.jpg', [imageKey]: 'https://evil/y.jpg' }),
      slots,
    );
    if (!rewritten.ok) throw new Error(rewritten.error);
    expect(Object.keys(rewritten.copy)).toHaveLength(0);
  });
});

describe('no fabricated regulated claim can ship', () => {
  it('scrubs a licence number to a general claim, in any wording', async () => {
    const { scrubLicenceNumber } = await import('../lib/ai/home-personalise');
    expect(scrubLicenceNumber('ATOL 11284')).toBe('ATOL protected');
    expect(scrubLicenceNumber('ATOL protected (ATOL 11371).')).toBe('ATOL protected.');
    expect(scrubLicenceNumber('· ABTA Y6427 · Virtuoso member')).toBe('· ABTA member · Virtuoso member');
    expect(scrubLicenceNumber('escapes are ATOL protected (ATOL 11371). Aurelia Travel Ltd is a member of ABTA (Y6512).'))
      .toBe('escapes are ATOL protected. Aurelia Travel Ltd is a member of ABTA.');
    expect(scrubLicenceNumber('Fully protected — ABTA No. Y6248 & ATOL 9417'))
      .toBe('Fully protected — ABTA member & ATOL protected');
    // A bare mention with no number is a real thing to say, kept.
    expect(scrubLicenceNumber('We are ATOL protected.')).toBe('We are ATOL protected.');
  });

  it('neutralises the design own licence slots even when the model changed nothing', () => {
    const sections = designedHomeSections('harland-vane');
    const before = JSON.stringify(sections);
    // The frozen harland-vane carries "ATOL 11284" / "ABTA Y6427" placeholders.
    const hasLicence = /ATOL\s*\d|ABTA\s*[A-Z]?\d/.test(before);
    const out = neutraliseFabricated(sections);
    const rendered = blocksOf(out)
      .filter((block) => (block as { type?: string }).type === 'imported')
      .map((block) => {
        const props = (block as { props: Record<string, unknown> }).props;
        const content = importContent(props);
        return importFields(props)
          .map((field) => content[field.key] ?? field.value)
          .join(' ');
      })
      .join(' ');
    if (hasLicence) {
      // No ATOL/ABTA followed by a number survives in the effective text.
      expect(/ATOL\s*\d/.test(rendered)).toBe(false);
      expect(/ABTA\s*[A-Z]?\d/.test(rendered)).toBe(false);
    }
  });

  it('the home page is saved with its own chrome, no site header on top', () => {
    const { readFileSync } = require('node:fs');
    const { join } = require('node:path');
    const action = readFileSync(join(__dirname, '..', 'app', 'actions', 'ai.ts'), 'utf8');
    expect(action).toContain('chrome: !carriesOwnChrome');
  });
});


describe('no fabricated contact detail can ship', () => {
  it('scrubs a placeholder email from text, and keeps a real one', async () => {
    const { scrubContactText } = await import('../lib/ai/home-personalise');
    expect(scrubContactText('Write to studio@aurelia-escapes.co.uk', '')).toBe('Write to Get in touch');
    expect(scrubContactText('Write to studio@aurelia-escapes.co.uk', 'hello@halcyonbay.com'))
      .toBe('Write to hello@halcyonbay.com');
    // The client's own address is kept as-is.
    expect(scrubContactText('Reach hello@halcyonbay.com', 'hello@halcyonbay.com'))
      .toBe('Reach hello@halcyonbay.com');
  });

  it('leaves ordinary copy with digits in parentheses untouched', async () => {
    const { scrubLicenceNumber } = await import('../lib/ai/home-personalise');
    for (const good of ['Four nights (7 days) away', 'Kids stay free (2 for 1 this May)', 'Award winner (2024)', 'Open (9am to 5pm)']) {
      expect(scrubLicenceNumber(good), good).toBe(good);
    }
  });

  it('neutralises a fabricated mailto/tel link across a real designed home', () => {
    const sections = designedHomeSections('aurelia');
    const out = neutraliseFabricated(sections, { ownPhone: '020 1234 5678', contactHref: '/contact' });
    // Gather the EFFECTIVE value of every link slot after the pass.
    const linkValues = blocksOf(out)
      .filter((block) => (block as { type?: string }).type === 'imported')
      .flatMap((block) => {
        const props = (block as { props: Record<string, unknown> }).props;
        const content = importContent(props);
        return importFields(props)
          .filter((field) => field.kind === 'link')
          .map((field) => content[field.key] ?? field.value);
      });
    // No mailto to the design's fictional domain survives.
    expect(linkValues.some((value) => /mailto:.*aurelia/i.test(value))).toBe(false);
    // A tel link now carries the client's own number (digits only).
    expect(linkValues.some((value) => value === 'tel:02012345678')).toBe(true);
  });

  it('a seeded aurelia home carries no fictional email anywhere after the pass', () => {
    const out = neutraliseFabricated(designedHomeSections('aurelia'), { contactHref: '/contact' });
    const rendered = blocksOf(out)
      .filter((block) => (block as { type?: string }).type === 'imported')
      .map((block) => {
        const props = (block as { props: Record<string, unknown> }).props;
        const content = importContent(props);
        return importFields(props).map((field) => content[field.key] ?? field.value).join(' ');
      })
      .join(' ');
    expect(/aurelia-escapes\.co\.uk/i.test(rendered)).toBe(false);
  });
});
