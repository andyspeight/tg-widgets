/**
 * What the request says about a visitor, read once per render.
 *
 * The thin server shell over the pure classifiers in lib/content/audience: it
 * reaches into next/headers and cookies, everything interesting is decided in
 * the pure module, so this file has almost nothing to test and the logic is
 * proved in Node. Used only on the published site route, which is force-dynamic,
 * so reading the request here neither opts a static page out of caching (there
 * is none) nor costs a variant key.
 *
 * NOTHING HERE IS TRUSTED BEYOND WHAT IT IS. The country is Vercel's edge geo
 * header, the device and source are the user-agent and referer, all of which a
 * visitor can spoof; the worst a spoof does is show that visitor a section meant
 * for someone else, which is a section on the same published page, not a
 * security boundary. Ownership and drafts are guarded in the database, not here.
 */

import { cookies, headers } from 'next/headers';

import {
  classifyDevice,
  classifySource,
  DEFAULT_VISITOR_SIGNALS,
  normaliseCountry,
  RETURNING_VISITOR_COOKIE,
  type VisitorSignals,
} from '../content/audience';

/**
 * Read the visitor signals for this request.
 *
 * `selfHost` is the site's own hostname, so a click from one page of the site to
 * another reads as direct rather than as a referral from itself. Absent-header
 * safe throughout: on localhost, or from a crawler, every facet falls to its
 * default (unknown country, desktop, direct, new), which is exactly the
 * unpersonalised variant a client should design as the baseline.
 */
export async function readVisitorSignals(selfHost?: string): Promise<VisitorSignals> {
  try {
    const [h, c] = await Promise.all([headers(), cookies()]);
    return {
      // Vercel sets x-vercel-ip-country at the edge; absent off-platform.
      country: normaliseCountry(h.get('x-vercel-ip-country')),
      device: classifyDevice(h.get('user-agent')),
      source: classifySource(h.get('referer'), selfHost),
      visitor: c.get(RETURNING_VISITOR_COOKIE) ? 'returning' : 'new',
    };
  } catch {
    // headers()/cookies() throw outside a request scope. The baseline variant is
    // the safe answer, never a thrown render.
    return DEFAULT_VISITOR_SIGNALS;
  }
}
