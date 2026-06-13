/**
 * Calendar provider registry. Lets the scheduler stay provider-neutral: every
 * endpoint resolves the right module by name instead of importing google
 * directly. Adding a provider is: implement the google.js interface, import it
 * here, done.
 */
import * as google from './google.js';
import * as microsoft from './microsoft.js';

const MAP = { google, microsoft };

/** Resolve a provider module by id, defaulting to google. */
export function getProvider(name) {
  return MAP[name] || google;
}

/** Provider ids that have their OAuth credentials configured. */
export function configuredProviders() {
  return Object.keys(MAP).filter(k => MAP[k].configured());
}

export function isProvider(name) {
  return Object.prototype.hasOwnProperty.call(MAP, name);
}
