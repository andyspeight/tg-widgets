/**
 * The model client for the destination filler, and the money it spends.
 *
 * Raw fetch against the Messages API rather than the SDK, because that is what
 * every other model call in this repo already does (offer-draft, widget-ai,
 * travel-results-ai, the Luna Brain gate). One house pattern beats a better one
 * used in a single file.
 *
 * WHY COST TRACKING LIVES HERE. Andy asked for a runner that fills 1,539
 * records on a button press, and his mockup put a daily budget on the front of
 * it. He was right to: the editorial half of this library is roughly ten
 * thousand fields, and at these rates that is a few hundred dollars if it is
 * left to run. So every call returns what it cost, in real per-token prices,
 * and the caller records it before deciding whether to make the next one. A cap
 * that is estimated rather than measured is not a cap.
 *
 * Prices are per million tokens, from the Anthropic pricing table (June 2026).
 * They are the one thing in here that goes stale, so they sit in a single map
 * with the date on them, and the budget reads that map rather than a guess.
 */

const API = 'https://api.anthropic.com/v1/messages';

/** USD per million tokens. Reviewed 2026-06-24. */
export const PRICES = {
  'claude-opus-5':   { in: 5.00, out: 25.00 },
  'claude-sonnet-5': { in: 2.00, out: 10.00 },
  'claude-haiku-4-5': { in: 1.00, out: 5.00 },
};

/**
 * The writer is the default model, per house policy: quality is Andy's call,
 * not a cost decision made quietly on his behalf. The two gate steps are
 * verifiers reading a short piece of text against short evidence, which is the
 * one place a smaller model is the right tool rather than a saving.
 * Both are env-overridable so the choice stays his.
 */
export const WRITER_MODEL = process.env.DFILL_WRITER_MODEL || 'claude-opus-5';
export const GATE_MODEL   = process.env.DFILL_GATE_MODEL   || 'claude-sonnet-5';

/** USD for one call, at that model's real rates. */
export function costUsd(model, usage) {
  const p = PRICES[model];
  if (!p || !usage) return 0;
  return ((usage.input_tokens || 0) / 1e6) * p.in
       + ((usage.output_tokens || 0) / 1e6) * p.out;
}

/**
 * One call. Returns the text plus what it cost.
 * Throws on anything that is not a clean answer, so the caller holds the record
 * rather than saving a half-response.
 */
export async function callModel({ model, system, user, maxTokens = 1200, temperature, timeoutMs = 60000 }) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('ANTHROPIC_API_KEY is not set');

  const body = {
    model,
    max_tokens: maxTokens,
    system,
    messages: [{ role: 'user', content: user }],
  };
  // Sampling controls are rejected on the current models; only send them where
  // the model still accepts them.
  if (temperature != null && /haiku/.test(model)) body.temperature = temperature;

  const r = await fetch(API, {
    method: 'POST',
    signal: AbortSignal.timeout(timeoutMs),
    headers: {
      'content-type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  });

  if (!r.ok) {
    const detail = await r.text().catch(() => '');
    throw new Error('model ' + r.status + ': ' + detail.slice(0, 200));
  }

  const json = await r.json();
  if (json.stop_reason === 'refusal') throw new Error('the model declined this request');

  const text = (json.content || [])
    .filter(b => b && b.type === 'text')
    .map(b => b.text)
    .join('')
    .trim();

  if (!text) throw new Error('the model returned no text');

  return {
    text,
    usage: json.usage || {},
    costUsd: costUsd(model, json.usage),
    model: json.model || model,
  };
}

/**
 * What one editorial field costs, end to end, at current prices: the write plus
 * the two independent gate reads. Used to show Andy a number BEFORE he presses
 * "do all", and to refuse the next item when the day's cap is spent.
 *
 * Token counts are measured averages from the prompt shapes in _write.js and
 * _gate.js, not round numbers picked to look tidy.
 */
export function estimateFieldUsd() {
  const write = costUsd(WRITER_MODEL, { input_tokens: 1500, output_tokens: 400 });
  const oneGate = costUsd(GATE_MODEL, { input_tokens: 1200, output_tokens: 150 });
  return write + oneGate * 2;
}
