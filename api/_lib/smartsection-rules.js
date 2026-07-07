/**
 * Smart Section — server-side rule sanitiser.
 *
 * This is the TRUST BOUNDARY for AI-generated rule configs. The /api/widget-ai
 * endpoint asks the model for a Smart Section config; whatever comes back is
 * untrusted and passes through sanitiseSmartSectionConfig() before it ever
 * reaches a client. Unknown rule types and invalid field values are dropped,
 * not guessed at, and every number is clamped. The output is always a valid
 * config the widget can consume — worst case, an empty rule set (everyone sees
 * the section), which is the widget's own fail-open default.
 *
 * Dependency-free on purpose, so it is unit-testable in plain Node.
 * Mirrors the shapes in public/tgse-rules.js and widget-smartsection.js.
 */

export const SMART_SECTION_RULE_TYPES = ['visitorType', 'timeOfDay', 'dayOfWeek', 'device', 'utm', 'exitIntent'];
const DEVICES = ['mobile', 'tablet', 'desktop'];
const UTM_PARAMS = ['source', 'medium', 'campaign', 'referrer'];
const MAX_RULES = 12;

function clampInt(v, min, max, fallback) {
  const n = parseInt(v, 10);
  if (Number.isNaN(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function isHM(s) {
  return typeof s === 'string' && /^([01]?\d|2[0-3]):[0-5]\d$/.test(s.trim());
}

export function sanitiseSmartSectionConfig(obj) {
  const src = obj && typeof obj === 'object' && !Array.isArray(obj) ? obj : {};
  const rawRules = Array.isArray(src.rules) ? src.rules : [];
  const rules = [];

  for (const r of rawRules) {
    if (rules.length >= MAX_RULES) break;
    if (!r || typeof r !== 'object' || typeof r.type !== 'string') continue;

    switch (r.type) {
      case 'visitorType':
        if (r.value === 'new' || r.value === 'returning') {
          rules.push({ type: 'visitorType', value: r.value });
        }
        break;

      case 'timeOfDay':
        if (isHM(r.from) && isHM(r.to)) {
          rules.push({ type: 'timeOfDay', from: r.from.trim(), to: r.to.trim() });
        }
        break;

      case 'dayOfWeek': {
        const days = Array.isArray(r.days)
          ? [...new Set(r.days.map((d) => parseInt(d, 10)).filter((d) => d >= 0 && d <= 6))]
          : [];
        if (days.length) rules.push({ type: 'dayOfWeek', days });
        break;
      }

      case 'device': {
        const devices = Array.isArray(r.devices) ? r.devices.filter((d) => DEVICES.includes(d)) : [];
        if (devices.length) rules.push({ type: 'device', devices });
        break;
      }

      case 'utm': {
        const param = UTM_PARAMS.includes(r.param) ? r.param : 'source';
        const match = r.match === 'contains' ? 'contains' : 'is';
        const value = String(r.value == null ? '' : r.value).slice(0, 200).trim();
        if (value) rules.push({ type: 'utm', param, match, value });
        break;
      }

      case 'exitIntent':
        rules.push({ type: 'exitIntent' });
        break;

      default:
        break; // unknown rule type — dropped, never guessed
    }
  }

  return {
    match: src.match === 'any' ? 'any' : 'all',
    rules,
    dismissible: src.dismissible === true,
    dismissDays: clampInt(src.dismissDays, 0, 365, 30),
    maxShows: clampInt(src.maxShows, 0, 1000, 0),
    reveal: src.reveal === 'none' ? 'none' : 'fade',
  };
}
