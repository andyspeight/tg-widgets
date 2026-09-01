/**
 * AI image generation, the parts that run without a network or a key.
 *
 * The provider call and the storing cannot run here (no OPENAI_API_KEY, no blob
 * store, and neither host is reachable), exactly like blob.ts and pexels.ts. So
 * this proves the pure half - the prompt shaping and its guard rails - for real,
 * and asserts from source that the money-and-network half is wired the way the
 * rest of the AI is: metered, gated, and best effort.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  cleanImagePrompt,
  heroImagePrompt,
  MAX_IMAGE_PROMPT,
  pickerImagePrompt,
} from '../lib/ai/image-prompt';

const root = join(__dirname, '..');
const read = (path: string) => readFileSync(join(root, path), 'utf8');

describe('cleanImagePrompt', () => {
  it('trims, collapses whitespace, and keeps real words', () => {
    expect(cleanImagePrompt('  a  villa   terrace  ')).toBe('a villa terrace');
  });

  it('strips control characters and newlines rather than passing them on', () => {
    // Built from char codes so the source file stays plain ASCII: a tab and a
    // newline sit between the words, and a NUL is buried in the middle.
    const tab = String.fromCharCode(9);
    const nl = String.fromCharCode(10);
    const nul = String.fromCharCode(0);
    const dirty = `a villa${tab}${nul}terrace${nl}here`;
    const clean = cleanImagePrompt(dirty);
    expect(clean).toBe('a villa terrace here');
    // eslint-disable-next-line no-control-regex
    expect(/[\x00-\x1F]/.test(clean)).toBe(false);
  });

  it('caps the length so a pasted essay cannot be sent whole', () => {
    const long = 'sea '.repeat(1000);
    expect(cleanImagePrompt(long).length).toBeLessThanOrEqual(MAX_IMAGE_PROMPT);
  });

  it('is empty for anything that is not a usable string', () => {
    expect(cleanImagePrompt('')).toBe('');
    expect(cleanImagePrompt('   ')).toBe('');
    expect(cleanImagePrompt(null)).toBe('');
    expect(cleanImagePrompt(42)).toBe('');
  });
});

describe('the photo guard rails', () => {
  it("wrap a person's prompt so it stays a photograph with no text baked in", () => {
    const prompt = pickerImagePrompt('a quiet harbour at dawn');
    expect(prompt).toContain('a quiet harbour at dawn');
    expect(prompt.toLowerCase()).toContain('photograph');
    expect(prompt.toLowerCase()).toContain('no text');
    expect(prompt.toLowerCase()).toContain('no logos');
  });

  it('are empty for an empty brief, so the caller can refuse before it spends', () => {
    expect(pickerImagePrompt('   ')).toBe('');
    expect(heroImagePrompt('')).toBe('');
  });

  it('build a wide hero brief with room for a headline', () => {
    const prompt = heroImagePrompt('the Amalfi coast');
    expect(prompt).toContain('the Amalfi coast');
    expect(prompt.toLowerCase()).toContain('hero');
    expect(prompt.toLowerCase()).toContain('photograph');
    expect(prompt.toLowerCase()).toContain('no text');
  });
});

describe('the generation path is wired like the rest of the AI', () => {
  const action = read('app/actions/media.ts');

  it('meters generation against the daily claim before it spends', () => {
    const fn = action.slice(action.indexOf('export async function generateImageAction'));
    expect(fn).toContain('claimRequest');
    expect(fn).toContain("intent: 'image'");
  });

  it('refuses when the key or the store is missing, with something to act on', () => {
    const fn = action.slice(action.indexOf('export async function generateImageAction'));
    expect(fn).toContain('imageGenConfigured');
    expect(fn).toContain('blobConfigured');
    expect(fn).toContain('OPENAI_API_KEY');
  });

  it('shapes the prompt through the guard rails rather than sending raw words', () => {
    const fn = action.slice(action.indexOf('export async function generateImageAction'));
    expect(fn).toContain('pickerImagePrompt');
  });
});

describe('the section builder gets a made hero when generation is on', () => {
  const ai = read('app/actions/ai.ts');

  it('prefers generation and falls back to the photo library', () => {
    const fn = ai.slice(ai.indexOf('async function heroPicture'));
    const body = fn.slice(0, fn.indexOf('\n}\n'));
    // Generation is checked first, the library second: a made picture wins.
    expect(body.indexOf('imageGenConfigured')).toBeGreaterThan(-1);
    expect(body.indexOf('pexelsConfigured')).toBeGreaterThan(-1);
    expect(body.indexOf('imageGenConfigured')).toBeLessThan(body.indexOf('pexelsConfigured'));
  });
});

describe('a generated image is stored as its own kind, owing no credit', () => {
  const generate = read('lib/media/generate.ts');

  it('records the source as ai with an empty credit', () => {
    expect(generate).toContain("source: 'ai'");
    expect(generate).toContain('credit: {}');
  });

  it('keeps the migration that lets the row exist', () => {
    const migration = read('db/migrations/0033_media_ai_source.sql');
    expect(migration).toContain("check (source in ('upload', 'pexels', 'ai'))");
  });
});
