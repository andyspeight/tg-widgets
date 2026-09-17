/**
 * api/_lib/booking-destination.js — where is this booking going, in our own words
 *
 * The confirmation email's picture and destination blocks (`hero`,
 * `destination`, `knowbefore`, `whatson`, `thingstodo`) read a destination pack
 * the CALLER passes in. `public/_booking-email-template.js` is runtime-neutral
 * and cannot look anything up, which is deliberate: the same renderer runs on
 * the server for a send and in the browser for the editor preview.
 *
 * So this is the bit that looks it up. A Travelify order does not carry a
 * destination slug, it carries whatever the supplier filed the products under,
 * so we build a list of candidates and try them in order of how specific they
 * are. A resort name is a better answer than a country; a country is better
 * than nothing.
 *
 * Nothing here is allowed to break a confirmation email. Every path returns
 * null on trouble and the blocks simply draw nothing, exactly as they do for a
 * destination we hold no content for.
 *
 * 17 Sep 2026.
 */

import { lookupDestination } from '../destination-content.js';

/** Blocks that need the pack. No point in an Airtable round trip without one. */
export const DESTINATION_BLOCKS = ['hero', 'destination', 'knowbefore', 'whatson', 'thingstodo'];

/**
 * Does this layout actually use the destination pack?
 *
 * `hero` is on the list because it prefers a destination photo when the hotel
 * has none, and it names the destination rather than the airport city. It draws
 * without the pack, just less well. An absent or empty layout means the
 * built-in one, which uses none of them.
 */
export function layoutWantsDestination(layout) {
  if (!Array.isArray(layout) || !layout.length) return false;
  return layout.some((b) => b && DESTINATION_BLOCKS.includes(b.type));
}

/**
 * An ISO-3166 alpha-2 code is not a name and will never match a slug, so a
 * code is turned into a name and anything else is passed through as filed.
 *
 * A code we cannot name is dropped rather than guessed at. Two ways that
 * happens: Intl hands an unknown code straight back ("QQ"), and CLDR answers
 * the reserved code ZZ with the literal "Unknown Region" — which would
 * otherwise have us looking up a destination called exactly that.
 */
function countryName(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (!/^[A-Za-z]{2}$/.test(raw)) return raw;
  const code = raw.toUpperCase();
  if (code === 'ZZ') return '';
  try {
    const name = new Intl.DisplayNames(['en'], { type: 'region' }).of(code);
    if (!name || name === code || /unknown region/i.test(name)) return '';
    return name;
  } catch {
    return '';
  }
}

/**
 * The places this booking might be, most specific first.
 *
 * The order matters: the same trip can name a resort ("Lhaviyani Atoll"), a
 * city ("Male") and a country ("Maldives"), and a resort write-up beats a
 * country one. Duplicates and blanks are dropped.
 */
export function destinationCandidates(order) {
  const items = (order && Array.isArray(order.items)) ? order.items : [];
  const first = (product, pick) => {
    for (const it of items) {
      if (!it || it.product !== product) continue;
      const v = pick(it);
      if (v) return v;
    }
    return '';
  };

  const accLoc = first('Accommodation', (i) => i.accommodation && i.accommodation.location)
    || first('Packages', (i) => i.accommodation && i.accommodation.location)
    || null;
  const ticketLoc = first('TicketsAttractions', (i) => i.ticketsAttractions && i.ticketsAttractions.location) || null;

  const out = [
    // A resort is usually filed as the hotel's address line or its state.
    accLoc && accLoc.state,
    accLoc && accLoc.city,
    ticketLoc && ticketLoc.city,
    // The dropoff of an airport transfer names where they actually end up.
    first('Transfers', (i) => i.transfers && i.transfers.outDropoff && i.transfers.outDropoff.name),
    countryName(accLoc && accLoc.country),
    countryName(ticketLoc && ticketLoc.country),
  ];

  const seen = new Set();
  return out
    .map((v) => (typeof v === 'string' ? v.trim() : ''))
    // A transfer dropoff is often "Atmosphere Kanifushi, Lhaviyani" — the bit
    // before the comma is the property, which will not be a destination record,
    // so try the whole string as filed and let the slug match decide.
    .filter((v) => v && v.length <= 80)
    .filter((v) => { const k = v.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
}

/**
 * Resolve a booking to a destination pack, or null.
 *
 * `timeoutMs` is a hard ceiling on the whole thing: a confirmation email that
 * is three seconds late is a problem, and a missing "things to do" section is
 * not. The webhook has five seconds to answer, and the worker sends inside it.
 */
export async function resolveBookingDestination(order, { timeoutMs = 2500, lookupOrder } = {}) {
  const candidates = destinationCandidates(order);
  if (!candidates.length) return null;

  const deadline = Date.now() + timeoutMs;
  for (const text of candidates) {
    if (Date.now() >= deadline) return null;
    try {
      const hit = await lookupDestination(text, lookupOrder);
      if (hit) return hit;
    } catch {
      // lookupDestination already swallows its own errors; this is belt and
      // braces so a confirmation is never lost to a destination lookup.
      return null;
    }
  }
  return null;
}
