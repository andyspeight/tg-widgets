/**
 * The audio block.
 *
 * The player is the browser's native <audio controls>, so the DOM behaviour (a
 * link becomes a player, and it does not preload) is proven in the standalone
 * harness. What a unit test pins is the registry: the block exists, sits in
 * Media, and takes a link.
 */

import { describe, expect, it } from 'vitest';

import { blockDefinition, blocksByGroup, isKnownBlock } from '../lib/content/blocks';

describe('the audio block is registered', () => {
  it('is known, sits in Media, and has its icon', () => {
    expect(isKnownBlock('audio')).toBe(true);
    const def = blockDefinition('audio');
    expect(def?.group).toBe('Media');
    expect(def?.label).toBe('Audio');
    expect(def?.icon).toBe('audio');
  });

  it('appears in the picker, in the Media group', () => {
    const media = blocksByGroup(true).find((group) => group.group === 'Media');
    expect(media?.blocks.some((block) => block.type === 'audio')).toBe(true);
  });

  it('takes a link and starts empty', () => {
    const def = blockDefinition('audio');
    expect(def?.defaults.src).toBe('');
    const src = def?.fields.find((field) => field.key === 'src');
    expect(src?.kind).toBe('url');
  });
});
