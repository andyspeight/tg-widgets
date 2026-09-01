/**
 * The Status contract for the shared Airports reference table
 * (Destination Content base, tblI2iVAbIGCtsGa7).
 *
 * Identity and narrative are different jobs. Two independent structured
 * sources can verify an airport's IDENTITY (what it is called, where it is).
 * They cannot verify its NARRATIVE (lounges, parking prices, transfer detail),
 * which needs the full two-source airport-spotlight methodology. Status records
 * how far a record has got:
 *
 *   Todo         nothing verified yet
 *   In progress  identity verified from two sources, narrative not written
 *   Draft        narrative written, not yet audited against two sources
 *   Done / Live  narrative audited against two independent sources
 *
 * TWO DEPTHS, NOT A SINGLE GATE (27 Aug 2026)
 *
 * Until now only Done and Live were servable at all. That was right while the
 * table held 225 records, and wrong the moment it held 600: the identity fill
 * created 375 records that are two-source verified for exactly the fields they
 * carry, and refusing them entirely meant an airport the picker could not offer
 * and Luna could not place on a map, despite knowing precisely where it is.
 *
 * So a record is served at one of two depths:
 *
 *   full      Done or Live. Everything, including the audited narrative.
 *   identity  anything else that has a name, coordinates and BOTH source URLs.
 *             Name, city, country, coordinates, official site. No narrative.
 *
 * The narrative is stripped SERVER SIDE for identity depth rather than left to
 * the widget to skip. That matters: a Draft record is narrative that has been
 * written and NOT audited, and it would otherwise reach a client site the
 * moment it gained two source URLs. Stripping here means unaudited prose cannot
 * be served whatever the caller does, which is the guarantee the original gate
 * was built for and the reason the May 2026 records were a problem.
 *
 * Why this module exists: before it, neither api/airport-search.js nor
 * api/airport-content.js looked at Status at all, so a record carrying prose
 * but no coordinates and no cited source was pickable and embeddable (audit,
 * 25 Aug 2026). See docs/airport-data-plan.md.
 */

/** Statuses whose audited narrative may be served. */
export const SERVABLE_AIRPORT_STATUSES = Object.freeze(['Done', 'Live']);

/** How much of a record a caller is allowed to see. */
export const AIRPORT_DEPTH = Object.freeze({ FULL: 'full', IDENTITY: 'identity' });

/**
 * The ONLY keys an identity-depth record may carry. An ALLOWLIST, deliberately.
 *
 * This started as a blocklist of narrative keys and that was a mistake caught
 * within the hour: the names were written from memory and seven were wrong, so
 * `gettingThereByTrain`, `taxiAndRideshare`, `parking`, `dropOffInfo` and
 * `flightTimeFromUK` would all have been served. A blocklist fails OPEN, and
 * the thing it fails open with is unaudited prose on a client site.
 *
 * An allowlist fails closed. A key added to api/airport-content.js and
 * forgotten here is invisible until someone notices it missing, which is a bug
 * report rather than an incident.
 *
 * What is on the list and why: everything here is either verified by the
 * two-source identity fill (name, iata, city, country, coordinates) or is
 * structure rather than a claim about the airport (role, type, linked resorts
 * and cities, the provisional flag). Facilities, transport, parking, check-in
 * and flight times are all claims a human made and nobody checked, so none of
 * them appear.
 */
export const IDENTITY_KEYS = Object.freeze([
  'name', 'iata', 'cityServed', 'country',
  'lat', 'lng', 'cityLat', 'cityLng',
  'role', 'type', 'resorts', 'cities', 'provisional',
]);

/**
 * officialWebsite is deliberately NOT on that list, which is worth explaining
 * because it is the one omission that costs something real: it is the obvious
 * onward link for a compact card.
 *
 * It is not written by the identity fill, which records Source 1 and Source 2
 * and nothing else, so on the 375 records this exists for it is blank anyway.
 * Where it is populated it was typed by a human and never checked, and sending
 * a customer to the wrong airport's website is a worse outcome than sending
 * them nowhere. It becomes available the moment the record is audited to Done,
 * which is the point.
 */

/** True when a record's Status means its narrative is audited. Pure. */
export function isServableAirportStatus(status) {
  if (status == null) return false;
  const name = typeof status === 'object' ? status.name : status;
  if (typeof name !== 'string') return false;
  const wanted = name.trim().toLowerCase();
  return SERVABLE_AIRPORT_STATUSES.some(s => s.toLowerCase() === wanted);
}

/** full for an audited record, identity for anything else. Pure. */
export function airportDepth(status) {
  return isServableAirportStatus(status) ? AIRPORT_DEPTH.FULL : AIRPORT_DEPTH.IDENTITY;
}

/**
 * Strip the narrative from a payload, returning a new object. Pure.
 *
 * Keys are removed rather than blanked, so a consumer cannot tell the
 * difference between "this airport has no lounges section" and "you are not
 * being shown it", and the widget's existing empty-section guards do the rest:
 * every section renderer already returns nothing when its field is absent, so
 * an identity record renders as hero, map and link with no further work.
 */
export function toIdentityCard(payload) {
  if (!payload || typeof payload !== 'object') return payload;
  const out = {};
  for (const key of IDENTITY_KEYS) {
    if (key in payload) out[key] = payload[key];
  }
  return out;
}

/**
 * Airtable filterByFormula fragment limiting a query to records that may be
 * offered at SOME depth: audited, or identity-verified with both sources.
 *
 * The identity half deliberately asks for the evidence rather than the Status,
 * because Status is a claim and the source URLs are the thing that makes it
 * checkable. That is the whole lesson of the May 2026 records, which said Done
 * and cited nothing. Field names, not ids: Airtable formulas take names.
 */
export function servableStatusFormula(fieldName = 'Status') {
  const audited = SERVABLE_AIRPORT_STATUSES.map(s => `{${fieldName}}='${s}'`);
  const identityVerified = [
    "NOT({Airport Name}='')",
    "NOT({Source 1 URL}='')",
    "NOT({Source 2 URL}='')",
    'NOT({Latitude}=BLANK())',
    'NOT({Longitude}=BLANK())',
  ].join(',');
  return `OR(${audited.join(',')},AND(${identityVerified}))`;
}
