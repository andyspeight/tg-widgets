/**
 * The writer that turns a page into its search listing (#239).
 *
 * THE ONE PROPERTY THAT MATTERS MOST is that it cannot break a publish. It runs
 * inside one, and publishing is the client's action: a model that times out,
 * refuses, answers in prose or returns nothing must leave the page published
 * with its blanks still blank, which is exactly the state it was in a moment
 * before. Every failure shape below is therefore driven deliberately.
 *
 * The model is mocked. What is being tested is our handling of what it says,
 * which is the half that can be wrong in ways nobody notices.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const ask = vi.fn();

vi.mock('../lib/ai/anthropic', () => ({
  ask,
  AiError: class AiError extends Error {},
  MODEL: 'test-model',
  MAX_ANSWER: 8000,
}));

const BOTH = { title: true, description: true };
const TEXT = 'Small group walking trips across Harris and Lewis, with a local guide and everything carried between stops.';

const GOOD = {
  title: 'Walking holidays in the Western Isles',
  description:
    'Small group walking trips across Harris and Lewis, with a local guide and everything carried between the stops each day.',
};

beforeEach(() => {
  ask.mockReset();
});

describe('what the model says, read', () => {
  it('takes plain JSON', async () => {
    const { writeSeo } = await import('../lib/ai/seo');
    ask.mockResolvedValue({ text: JSON.stringify(GOOD) });

    const out = await writeSeo(BOTH, 'Walking', 'Coastwise', TEXT);
    expect(out.title).toBe(GOOD.title);
    expect(out.description).toBe(GOOD.description);
  });

  it('digs it out of a code fence the prompt asked for and did not get', async () => {
    const { writeSeo } = await import('../lib/ai/seo');
    ask.mockResolvedValue({ text: `Here you go:\n\n\`\`\`json\n${JSON.stringify(GOOD)}\n\`\`\`` });

    expect((await writeSeo(BOTH, 'Walking', 'Coastwise', TEXT)).title).toBe(GOOD.title);
  });

  it('digs it out of a sentence either side of it', async () => {
    const { writeSeo } = await import('../lib/ai/seo');
    ask.mockResolvedValue({ text: `Sure. ${JSON.stringify(GOOD)} Let me know if you want another.` });

    expect((await writeSeo(BOTH, 'Walking', 'Coastwise', TEXT)).title).toBe(GOOD.title);
  });
});

describe('it can never break a publish', () => {
  it('answers empty when the model throws', async () => {
    const { writeSeo } = await import('../lib/ai/seo');
    ask.mockRejectedValue(new Error('upstream is on fire'));

    await expect(writeSeo(BOTH, 'Walking', 'Coastwise', TEXT)).resolves.toEqual({});
  });

  it('answers empty when the model answers in prose', async () => {
    const { writeSeo } = await import('../lib/ai/seo');
    ask.mockResolvedValue({ text: 'I would suggest calling it "Walking holidays".' });

    await expect(writeSeo(BOTH, 'Walking', 'Coastwise', TEXT)).resolves.toEqual({});
  });

  it('answers empty for malformed JSON, and for nothing at all', async () => {
    const { writeSeo } = await import('../lib/ai/seo');

    ask.mockResolvedValue({ text: '{"title": "Walking holidays in the Isles"' });
    await expect(writeSeo(BOTH, 'Walking', 'Coastwise', TEXT)).resolves.toEqual({});

    ask.mockResolvedValue({ text: '' });
    await expect(writeSeo(BOTH, 'Walking', 'Coastwise', TEXT)).resolves.toEqual({});
  });
});

describe('it does not spend a call it cannot use', () => {
  it('asks nothing when there is no gap', async () => {
    const { writeSeo } = await import('../lib/ai/seo');
    const out = await writeSeo({ title: false, description: false }, 'Walking', 'Coastwise', TEXT);

    expect(out).toEqual({});
    expect(ask).not.toHaveBeenCalled();
  });

  it('asks nothing about a page with nothing on it', async () => {
    // A page that cannot be summarised, so asking would spend a call to be told so.
    const { writeSeo } = await import('../lib/ai/seo');
    const out = await writeSeo(BOTH, 'Empty', 'Coastwise', '   ');

    expect(out).toEqual({});
    expect(ask).not.toHaveBeenCalled();
  });
});

describe('it answers only what was asked', () => {
  it('drops the half nobody had a gap for, so it cannot become an overwrite', async () => {
    /*
     * A model handed one gap answers both anyway. Storing the half the client
     * had already written would be the one thing this feature must never do.
     */
    const { writeSeo } = await import('../lib/ai/seo');
    ask.mockResolvedValue({ text: JSON.stringify(GOOD) });

    const out = await writeSeo({ title: false, description: true }, 'Walking', 'Coastwise', TEXT);
    expect(out.title).toBeUndefined();
    expect(out.description).toBe(GOOD.description);
  });
});

describe('the rules it is given', () => {
  it('forbid inventing facts, which is the whole safety of the feature', async () => {
    const { writeSeo } = await import('../lib/ai/seo');
    ask.mockResolvedValue({ text: JSON.stringify(GOOD) });
    await writeSeo(BOTH, 'Walking', 'Coastwise', TEXT);

    const [system, user] = ask.mock.calls[0];
    expect(system).toMatch(/NEVER state a fact that is not on the page/);
    // The page's own words are what it summarises, so they have to be in there.
    expect(user).toContain(TEXT);
  });
});
