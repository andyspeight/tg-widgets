/**
 * The section rewrite: reword ONE section's slots on an instruction, design
 * untouched. The action itself is a thin money-and-network wrapper (asserted
 * from source); the pure parts - which slots are offered, that a rewrite lands
 * only in real slots and never the design - run for real here.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  buildImportedRewriteUserPrompt,
  buildRewriteUserPrompt,
  sectionIsImported,
} from '../lib/ai/section-rewrite';
import { slotsOf, applyFill, fillFromModel } from '../lib/ai/page-fill';
import { buildPresetSection } from '../lib/content/presets';
import { presetById } from '../lib/content/presets';
import { designedHomeSections } from '../lib/content/designed-homes';
import { homeTextSlots, homeCopyFromModel, applyHomeCopy, slotId } from '../lib/ai/home-personalise';

const ROOT = join(__dirname, '..');

describe('telling a native section from an imported one', () => {
  it('a preset section is native, a designed home block is imported', () => {
    const preset = buildPresetSection(presetById('features-three-icons')!);
    expect(sectionIsImported(preset)).toBe(false);
    const home = designedHomeSections('aurelia')[0];
    expect(sectionIsImported(home)).toBe(true);
  });
});

describe('rewriting a native preset section', () => {
  const section = buildPresetSection(presetById('features-three-icons')!);
  const slots = slotsOf([section]);

  it('offers the sections headings and text as slots', () => {
    expect(slots.length).toBeGreaterThan(0);
    for (const slot of slots) expect(['heading', 'text']).toContain(slot.kind);
  });

  it('the prompt carries the instruction and every slot', () => {
    const prompt = buildRewriteUserPrompt('warmer and shorter', slots);
    expect(prompt).toContain('warmer and shorter');
    for (const slot of slots) expect(prompt).toContain(slot.id);
  });

  it('a rewrite lands in the slots and changes nothing else', () => {
    const copy: Record<string, string> = {};
    for (const slot of slots) copy[slot.id] = `Reworded ${slot.id}`;
    const answer = JSON.stringify(copy);
    const filled = fillFromModel(answer, slots);
    if (!filled.ok) throw new Error(filled.error);
    const [out] = applyFill([section], filled.copy);
    // Same shape - same block count, same types, same row structure.
    expect(out.rows.length).toBe(section.rows.length);
    const before = section.rows.flatMap((r) => r.columns).flatMap((c) => c.blocks.map((b) => b.type)).join(',');
    const after = out.rows.flatMap((r) => r.columns).flatMap((c) => c.blocks.map((b) => b.type)).join(',');
    expect(after).toBe(before);
  });

  it('a forged slot id is refused, and a real one alongside it still lands', () => {
    // An all-forged answer is rejected outright; a real slot is kept and the
    // forged key never reaches applyFill.
    expect(fillFromModel(JSON.stringify({ blk_notreal: 'x' }), slots).ok).toBe(false);
    const good = fillFromModel(JSON.stringify({ [slots[0].id]: 'Real', blk_notreal: 'x' }), slots);
    if (!good.ok) throw new Error(good.error);
    expect(good.copy[slots[0].id]).toBe('Real');
    expect(Object.keys(good.copy)).not.toContain('blk_notreal');
  });
});

describe('rewriting an imported designed section', () => {
  const section = designedHomeSections('aurelia')[0];
  const slots = homeTextSlots([section]);

  it('offers text slots and the imported rewrite prompt carries them', () => {
    expect(slots.length).toBeGreaterThan(0);
    const prompt = buildImportedRewriteUserPrompt('more formal', slots, slotId);
    expect(prompt).toContain('more formal');
    for (const slot of slots) expect(prompt).toContain(slotId(slot));
  });

  it('a rewrite writes into content and never the markup', () => {
    const copy = JSON.stringify({ [slotId(slots[0])]: 'A quieter kind of luxury' });
    const rewritten = homeCopyFromModel(copy, slots);
    if (!rewritten.ok) throw new Error(rewritten.error);
    const [out] = applyHomeCopy([section], rewritten.copy);
    const block = out.rows[0].columns[0].blocks[slots[0].block] as { props: Record<string, unknown> };
    // The markup is byte-for-byte the design's own.
    const src = section.rows[0].columns[0].blocks[slots[0].block] as { props: Record<string, unknown> };
    expect(block.props.html).toBe(src.props.html);
  });
});

describe('the actions keep the money and validation discipline', () => {
  const src = readFileSync(join(ROOT, 'app', 'actions', 'ai.ts'), 'utf8');
  const rewrite = src.slice(src.indexOf('export async function rewriteSectionAction'), src.indexOf('export async function suggestNextSectionAction'));
  const suggest = src.slice(src.indexOf('export async function suggestNextSectionAction'), src.indexOf('// The page builder'));

  it('rewrite validates the incoming section, claims a slot, records tokens', () => {
    expect(rewrite).toContain('incomingSection(fields.section)');
    expect(rewrite).toContain('claimRequest(');
    expect(rewrite).toContain('recordTokens(');
  });
  it('suggest claims a slot and builds through the shared engine', () => {
    expect(suggest).toContain('claimRequest(');
    expect(suggest).toContain('buildOneSection(');
  });
  it('the incoming section is parsed and sanitised, never trusted raw', () => {
    expect(src).toContain('function incomingSection');
    const fn = src.slice(src.indexOf('function incomingSection'), src.indexOf('function sectionsOutline'));
    expect(fn).toContain('parsePage(');
    expect(fn).toContain('sanitisePage(');
  });
});
