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
 * THINKING IS ON, AND IT COMES OUT OF max_tokens. This is the thing that broke
 * the Highlights JSON run on 14 Sep 2026, so it is written down rather than
 * left to be rediscovered. On claude-opus-5 and claude-sonnet-5 the model
 * thinks by default, its thinking is billed as output, and those tokens are
 * spent out of the SAME max_tokens ceiling as the answer. The budgets here were
 * first sized for models that did not think, so the model used the whole
 * allowance reasoning and had nothing left to answer with. The run reported
 * "the model returned no text" and "the grounding check did not answer
 * clearly", which read like careful refusals and were actually starvation.
 *
 * The lesson in the numbers below: max_tokens is a CEILING, not a spend. Room
 * that is never used is never billed, so it is set generously and truncation is
 * designed out. What actually controls the bill is `effort`, which is why the
 * gate runs at low effort and the writer at medium.
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

/**
 * Ceilings, and the effort that decides what is really spent inside them.
 *
 * These are headroom, not targets. A short tagline will use a fraction of its
 * allowance and be billed for the fraction. They are set high enough that the
 * model can think as long as it needs and still have room to answer, because
 * every token of truncation costs the full price of the call and returns
 * nothing at all.
 *
 * Effort is the real dial. The gate reads a short piece of copy against a short
 * list of facts and returns a verdict, which is a checking job rather than a
 * reasoning one, so it runs low. The writer has to hold the house voice and the
 * no-invention rule in mind at once, which is worth real thinking, so it runs
 * medium.
 */
export const BUDGET = {
  gate:       { maxTokens: 3000,  effort: 'low' },
  writeProse: { maxTokens: 8000,  effort: 'medium' },
  writeJson:  { maxTokens: 10000, effort: 'medium' },
};

/** USD for one call, at that model's real rates. Thinking bills as output. */
export function costUsd(model, usage) {
  const p = PRICES[model];
  if (!p || !usage) return 0;
  return ((usage.input_tokens || 0) / 1e6) * p.in
       + ((usage.output_tokens || 0) / 1e6) * p.out;
}

/**
 * One call. Returns the text plus what it cost.
 *
 * Throws on anything that is not a clean answer, so the caller holds the record
 * rather than saving a half-response. Every throw carries `costUsd` and `usage`
 * on the error, because a call that failed still burned tokens and Andy is owed
 * an honest number. Reporting nought for a call that spent real money is how
 * the dashboard came to show $0.00 through an afternoon of paid attempts.
 */
export async function callModel({ model, system, user, maxTokens = 1200, effort = 'medium', temperature, timeoutMs = 90000 }) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('ANTHROPIC_API_KEY is not set');

  const body = {
    model,
    max_tokens: maxTokens,
    system,
    messages: [{ role: 'user', content: user }],
    // Said out loud rather than inherited. These models think by default, and
    // whether they do changed between model versions, so the file states what
    // it wants and sizes max_tokens to cover it.
    thinking: { type: 'adaptive' },
    output_config: { effort },
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
  const usage = json.usage || {};
  const spent = costUsd(model, usage);

  // Every exit below this line has already been paid for.
  const fail = (why) => {
    const err = new Error(why);
    err.costUsd = spent;
    err.usage = usage;
    return err;
  };

  if (json.stop_reason === 'refusal') throw fail('the model declined this request');

  const text = (json.content || [])
    .filter(b => b && b.type === 'text')
    .map(b => b.text)
    .join('')
    .trim();

  if (!text) {
    // Name the cause rather than the symptom. "No text" with a max_tokens stop
    // means the allowance went on thinking, which is a budget bug in this file,
    // not a refusal by the model.
    if (json.stop_reason === 'max_tokens') {
      throw fail('the model spent its whole ' + maxTokens + ' token allowance thinking and had none left to answer with');
    }
    const kinds = [...new Set((json.content || []).map(b => b && b.type).filter(Boolean))];
    throw fail('the model returned no text (it stopped because ' + (json.stop_reason || 'of an unknown reason') +
               ', and sent back ' + (kinds.length ? kinds.join(' and ') : 'nothing') + ')');
  }

  // A truncated answer is a broken answer. Better to hold and say so than to
  // hand the gate half a sentence and let it fail for the wrong reason.
  if (json.stop_reason === 'max_tokens') {
    throw fail('the model ran out of room part way through its answer, so what came back was incomplete');
  }

  return {
    text,
    usage,
    costUsd: spent,
    model: json.model || model,
    stopReason: json.stop_reason || null,
  };
}

/**
 * What one editorial field costs, end to end, at current prices: the write plus
 * the two independent gate reads. Used to show Andy a number BEFORE he presses
 * "do all", and to refuse the next item when the day's cap is spent.
 *
 * The output figures INCLUDE thinking, because thinking is billed as output and
 * leaving it out is how an estimate quietly becomes half of the real bill.
 * Token counts are measured averages from the prompt shapes in _write.js and
 * _gate.js, not round numbers picked to look tidy.
 */
export function estimateFieldUsd() {
  const write = costUsd(WRITER_MODEL, { input_tokens: 1500, output_tokens: 1400 });
  const oneGate = costUsd(GATE_MODEL, { input_tokens: 1200, output_tokens: 500 });
  return write + oneGate * 2;
}
