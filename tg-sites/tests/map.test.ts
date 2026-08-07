/**
 * The Location map.
 *
 * The whole safety of this block is in one pure function: it turns an address
 * into a sealed, host-fixed embed URL. A client only ever supplies the address,
 * so the tests that matter are that the host cannot be steered, a second
 * parameter cannot be smuggled in, and the zoom and length are pinned. The block
 * component draws the frame around whatever this returns; there is nothing to
 * sanitise on the way in, because the address is percent-encoded on the way out.
 */

import { describe, expect, it } from 'vitest';

import {
  mapEmbedSrc,
  MAP_EMBED_HOST,
  MAP_ADDRESS_MAX,
  MAP_DEFAULT_ZOOM,
} from '../lib/content/map';
import { blockDefinition, blocksByGroup, isKnownBlock } from '../lib/content/blocks';

describe('the map embed URL', () => {
  it('builds a keyless, host-fixed embed from an address', () => {
    const src = mapEmbedSrc('10 Downing Street, London', 14);
    expect(src).toBeTruthy();
    expect(src!.startsWith(`${MAP_EMBED_HOST}?`)).toBe(true);
    expect(src).toContain('output=embed');
    expect(src).toContain(`q=${encodeURIComponent('10 Downing Street, London')}`);
    expect(src).toContain('z=14');
  });

  it('is empty when there is no address', () => {
    expect(mapEmbedSrc('', 14)).toBeNull();
    expect(mapEmbedSrc('   ', 14)).toBeNull();
    expect(mapEmbedSrc(undefined, 14)).toBeNull();
    expect(mapEmbedSrc(null, 14)).toBeNull();
  });

  it('cannot be steered to another host or a second parameter', () => {
    const src = mapEmbedSrc('x&output=evil&q=https://evil.example//', 14)!;
    // Exactly one output param, and it is ours: the hostile one is encoded
    // inside the q value, not a parameter of its own.
    expect(src.match(/output=/g)!.length).toBe(1);
    const url = new URL(src);
    expect(url.origin + url.pathname).toBe(MAP_EMBED_HOST);
    expect(url.searchParams.get('output')).toBe('embed');
    expect(src).not.toContain('evil.example//');
  });

  it('pins the zoom and defaults a bad one', () => {
    expect(mapEmbedSrc('London', 99)).toContain('z=20');
    expect(mapEmbedSrc('London', -5)).toContain('z=1');
    expect(mapEmbedSrc('London', Number.NaN)).toContain(`z=${MAP_DEFAULT_ZOOM}`);
    expect(mapEmbedSrc('London', 'nonsense')).toContain(`z=${MAP_DEFAULT_ZOOM}`);
  });

  it('caps a pathologically long address', () => {
    const src = mapEmbedSrc('a'.repeat(1000), 14)!;
    const q = new URL(src).searchParams.get('q')!;
    expect(q.length).toBeLessThanOrEqual(MAP_ADDRESS_MAX);
  });
});

describe('the map is a registered block', () => {
  it('is known, sits in Media, and has its icon', () => {
    expect(isKnownBlock('map')).toBe(true);
    const def = blockDefinition('map');
    expect(def?.group).toBe('Media');
    expect(def?.label).toBe('Map');
    expect(def?.icon).toBe('map');
  });

  it('appears in the picker, in the Media group', () => {
    const media = blocksByGroup(true).find((group) => group.group === 'Media');
    expect(media?.blocks.some((block) => block.type === 'map')).toBe(true);
  });
});
