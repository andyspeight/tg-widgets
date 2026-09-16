/**
 * What a turn costs, in pence.
 *
 * THE PRICE TABLE IS PINNED HERE, beside the model ids in lib/ai/anthropic.ts,
 * for the reason those are pinned: a number that decides what a client is
 * charged (or, until Andy sets an allowance, what Travelgenix spends) must not
 * move without a commit that says so. The figures are Anthropic's list prices
 * in US dollars per million tokens on 16 Sep 2026, and the exchange rate is a
 * round pinned number rather than a live one, because a ledger whose old rows
 * mean a different amount every morning is not a ledger.
 *
 * Cached input is most of the input on every turn (the system prompt and the
 * catalogue are the same for everybody), and it is priced at a tenth of the
 * uncached rate, which is why it is counted separately rather than folded in.
 *
 * PURE. Tokens in, pence out, so the arithmetic is tested without a request.
 */

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

/** US dollars per million tokens. */
export interface Price {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export const PRICES: Readonly<Record<string, Price>> = {
  'claude-sonnet-5': { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  'claude-haiku-4-5-20251001': { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
};

/**
 * A model this table does not know is priced as the dearest one it does, so a
 * new model id reaches the ledger as an overestimate rather than as free.
 */
export const FALLBACK_PRICE: Price = PRICES['claude-sonnet-5'];

/** Pinned, approximate, and updated by hand. Pence per US dollar. */
export const PENCE_PER_DOLLAR = 78;

export function priceFor(model: string): Price {
  return PRICES[model] ?? FALLBACK_PRICE;
}

function count(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}

/** The cost of one turn in pence, to four decimal places. */
export function costPence(model: string, usage: Partial<TokenUsage>): number {
  const price = priceFor(model);
  const dollars =
    (count(usage.inputTokens) * price.input
      + count(usage.outputTokens) * price.output
      + count(usage.cacheReadTokens) * price.cacheRead
      + count(usage.cacheWriteTokens) * price.cacheWrite)
    / 1_000_000;
  return Math.round(dollars * PENCE_PER_DOLLAR * 10_000) / 10_000;
}

/** The empty usage, for a turn that never reached the model. */
export function noUsage(): TokenUsage {
  return { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
}

export function addUsage(a: TokenUsage, b: Partial<TokenUsage>): TokenUsage {
  return {
    inputTokens: a.inputTokens + count(b.inputTokens),
    outputTokens: a.outputTokens + count(b.outputTokens),
    cacheReadTokens: a.cacheReadTokens + count(b.cacheReadTokens),
    cacheWriteTokens: a.cacheWriteTokens + count(b.cacheWriteTokens),
  };
}

/**
 * Pence as a person reads them: under a pound as "2p" (never "0p" for a turn
 * that cost something), a pound or more as "£1.84".
 */
export function formatPence(pence: number): string {
  const value = count(pence);
  if (value === 0) return '0p';
  if (value < 100) return `${Math.max(1, Math.round(value))}p`;
  return `£${(value / 100).toFixed(2)}`;
}
