/**
 * The gate: what may save itself, and what waits for Andy.
 *
 * Andy's decision (10 Sep 2026): anything that passes saves automatically;
 * anything that fails is held aside with a reason and he only ever looks at the
 * exceptions. That puts the entire weight of the thing on this file, so it is
 * built to fail closed. Every unknown, every parse error, every unreachable
 * model call is a HOLD, never a save.
 *
 * Three layers, cheapest first, and each can only ever reject:
 *
 *   Layer 0  SHAPE. The value has to satisfy the very same check that found the
 *            gap — checkValue() from destination-coverage.js. This closes the
 *            loop: the writer cannot satisfy the dashboard by producing an
 *            empty JSON array or eleven months of temperatures, because those
 *            are exactly the states the dashboard already calls broken. No
 *            model, no cost, and it catches most machine failures outright.
 *
 *   Layer 1  GROUNDING. Is every factual claim in this text supported by the
 *            evidence we hold about this place? Specific claims with nothing
 *            behind them fail. This is the anti-invention gate, and it is the
 *            reason a tagline about a beach that does not exist does not reach
 *            a client site.
 *
 *   Layer 2  ADVERSARIAL. A separate call, told to refute rather than confirm,
 *            given the evidence framed differently. It looks for contradiction
 *            with what we already hold, for brand-voice breaches, and for the
 *            claims that cost money if wrong: prices, opening times, safety,
 *            visa and health advice.
 *
 * The independence is real and not theatre: different prompts, different
 * framing, different temperature. A value with no checkable evidence can never
 * pass grounding, so an unsourced fact always reaches a human.
 *
 * Derived values skip the model entirely — inheritance from a record we already
 * trust is not a claim, and there is nothing for a verifier to check.
 *
 * Tests: npm run test:destinations-fill
 */

import { checkValue } from '../destination-coverage.js';
import { formatFor } from './_registry.js';

/** Claims that are expensive to get wrong. Present = the bar goes up. */
const HIGH_RISK = /\b(price|prices|cost|costs|£|\$|€|free entry|visa|vaccinat|malaria|safe|unsafe|crime|opening hours|open daily|closed on|refund|ATOL|ABTA|guarantee)\b/i;

/** House style, from CLAUDE.md. A breach is a hold, not a silent rewrite. */
const STYLE_BREACHES = [
  { re: /—/, why: 'em dash (house style has none)' },
  { re: /\b(?:[A-Za-z]+, ){1,}[A-Za-z]+, and \b/, why: 'Oxford comma' },
  { re: /\b(delve|elevate|seamless|unleash|nestled|vibrant tapestry|hidden gem|must-visit|bustling|breathtaking)\b/i, why: 'AI cliche' },
  { re: /\b(color|traveler|favorite|neighborhood|realize|organize)\b/i, why: 'US spelling (house style is UK)' },
];

export function styleBreaches(text) {
  const s = String(text || '');
  return STYLE_BREACHES.filter(b => b.re.test(s)).map(b => b.why);
}

/**
 * Layer 0. Cheap, deterministic, no model.
 * @returns {{ok:boolean, why?:string}}
 */
export function shapeCheck({ value, field, place }) {
  if (value == null || String(value).trim() === '') {
    return { ok: false, why: 'the fixer returned nothing' };
  }
  const state = checkValue(value, field.kind);
  if (state !== 'filled') {
    return {
      ok: false,
      why: state === 'invalid'
        ? 'the value is the wrong shape for a ' + field.kind + ' field, which is the same fault the dashboard flags'
        : 'the value reads as empty',
    };
  }
  const breaches = styleBreaches(typeof value === 'string' ? value : '');
  if (breaches.length) return { ok: false, why: 'house style: ' + breaches.join(', ') };

  const fmt = formatFor(field.label);
  if (fmt) {
    const bad = formatBreaches(String(value).trim(), fmt, place);
    if (bad.length) return { ok: false, why: bad.join(', ') };
  }
  return { ok: true };
}

/**
 * The shape the brief promised. Pure.
 *
 * "filled" for a text field means non-empty, so a two-hundred-character tagline
 * would have saved itself into a slot that sits beside the place name on a
 * client site. A rule told to a model and not checked is not a rule.
 */
export function formatBreaches(text, fmt, place) {
  const out = [];
  if (fmt.min && text.length < fmt.min) {
    out.push('it is ' + text.length + ' characters and the brief asks for at least ' + fmt.min);
  }
  if (fmt.max && text.length > fmt.max) {
    out.push('it is ' + text.length + ' characters and the brief allows at most ' + fmt.max);
  }
  if (fmt.noTrailingStop && /[.!?]$/.test(text)) {
    out.push('it ends with a full stop and the brief says not to');
  }
  if (fmt.noPlaceName && place) {
    // The name sits next to this on the page, so repeating it wastes the line.
    const name = String(place).trim();
    if (name.length > 2 && new RegExp('\\b' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i').test(text)) {
      out.push('it uses the place name, which already appears beside it');
    }
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * The two model layers. `ask` is injected so the gate is testable
 * without credentials and without a network.
 * ------------------------------------------------------------------ */

const GROUNDING_SYSTEM =
  'You check whether a piece of destination copy is supported by the evidence supplied. ' +
  'You are not editing it and not improving it. For every factual claim, decide whether the ' +
  'evidence supports it. A claim with no supporting evidence FAILS, however plausible it sounds. ' +
  'General description that makes no checkable claim is acceptable. ' +
  'Reply with JSON only: {"supported": true|false, "unsupported": ["claim", ...], "note": "one sentence"}';

const ADVERSARIAL_SYSTEM =
  'You are trying to find a reason this destination copy should NOT be published. ' +
  'Look for: contradiction with the evidence, claims about price, safety, visas, health or ' +
  'opening times that we cannot stand behind, anything that reads as generated rather than ' +
  'written, and breaches of house style (UK English, no em dashes, no Oxford comma, no marketing cliche). ' +
  'If you cannot find a real fault, say so plainly rather than inventing one. ' +
  'Reply with JSON only: {"publish": true|false, "faults": ["fault", ...], "risk": "low"|"high"}';

function parseJson(text) {
  const s = String(text || '').trim().replace(/^```(?:json)?|```$/g, '').trim();
  try { return JSON.parse(s); } catch { return null; }
}

/**
 * Run the full gate on one candidate value.
 *
 * @param {object} args
 *   value     what the fixer produced
 *   field     the field spec {label, kind, tier}
 *   kind      'derive' | 'fact' | 'write'
 *   evidence  string. What we know, and where it came from.
 *   place     string. The record, for context.
 *   ask       async ({system, user, temperature}) => text
 * @returns {Promise<{save:boolean, reason:string, risk:string, checks:object}>}
 */
export async function gate({ value, field, kind, evidence, place, ask }) {
  const checks = {};

  const shape = shapeCheck({ value, field, place });
  checks.shape = shape.ok ? 'pass' : 'fail';
  if (!shape.ok) return { save: false, reason: shape.why, risk: 'low', checks };

  // Inheritance and two-source agreement are not claims a verifier can add to.
  if (kind === 'derive' || kind === 'fact') {
    checks.verified = kind === 'derive' ? 'inherited' : 'two independent sources agreed';
    return { save: true, reason: checks.verified, risk: 'low', checks };
  }

  if (typeof ask !== 'function') {
    return { save: false, reason: 'no verifier available, so it is held rather than trusted', risk: 'high', checks };
  }

  // Layer 1 — grounding.
  let grounding;
  try {
    grounding = parseJson(await ask({
      system: GROUNDING_SYSTEM,
      user: 'PLACE\n' + place + '\n\nEVIDENCE\n' + (evidence || '(none)') +
            '\n\nFIELD\n' + field.label + '\n\nCOPY\n' + value,
      temperature: 0,
    }));
  } catch (err) {
    checks.grounding = 'error';
    return { save: false, reason: 'the grounding check could not run: ' + String(err.message || err), risk: 'high', checks };
  }
  if (!grounding || typeof grounding.supported !== 'boolean') {
    checks.grounding = 'unreadable';
    return { save: false, reason: 'the grounding check did not answer clearly', risk: 'high', checks };
  }
  checks.grounding = grounding.supported ? 'pass' : 'fail';
  if (!grounding.supported) {
    const claims = Array.isArray(grounding.unsupported) ? grounding.unsupported.slice(0, 3) : [];
    return {
      save: false,
      risk: 'high',
      reason: 'nothing supports ' + (claims.length ? claims.join('; ') : 'some of the claims made'),
      checks,
    };
  }

  // Layer 2 — adversarial, deliberately a different framing.
  let adversarial;
  try {
    adversarial = parseJson(await ask({
      system: ADVERSARIAL_SYSTEM,
      user: 'FIELD\n' + field.label + '\n\nCOPY\n' + value +
            '\n\nWHAT WE ALREADY HOLD ABOUT ' + place + '\n' + (evidence || '(nothing)'),
      temperature: 0.3,
    }));
  } catch (err) {
    checks.adversarial = 'error';
    return { save: false, reason: 'the second check could not run: ' + String(err.message || err), risk: 'high', checks };
  }
  if (!adversarial || typeof adversarial.publish !== 'boolean') {
    checks.adversarial = 'unreadable';
    return { save: false, reason: 'the second check did not answer clearly', risk: 'high', checks };
  }
  checks.adversarial = adversarial.publish ? 'pass' : 'fail';
  if (!adversarial.publish) {
    const faults = Array.isArray(adversarial.faults) ? adversarial.faults.slice(0, 3) : [];
    return {
      save: false,
      risk: adversarial.risk === 'high' ? 'high' : 'low',
      reason: faults.length ? faults.join('; ') : 'the second check would not publish it',
      checks,
    };
  }

  // Both passed. A high-risk claim still saves, per Andy's rule, but says so
  // loudly enough to be spot-checked.
  const risky = adversarial.risk === 'high' || HIGH_RISK.test(String(value));
  return {
    save: true,
    risk: risky ? 'high' : 'low',
    reason: risky
      ? 'both checks passed, but it makes a claim worth spot-checking'
      : 'both checks passed',
    checks,
  };
}
