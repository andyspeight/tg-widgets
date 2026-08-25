/**
 * The Status contract for the shared Airports reference table
 * (Destination Content base, tblI2iVAbIGCtsGa7).
 *
 * Identity and narrative are different jobs. Two independent structured
 * sources can verify an airport's IDENTITY (what it is called, where it is).
 * They cannot verify its NARRATIVE (lounges, parking prices, transfer detail),
 * which needs the full two-source airport-spotlight methodology. Status records
 * how far a record has got, and decides whether it may reach a client site:
 *
 *   Todo         nothing verified yet
 *   In progress  identity verified from two sources, narrative not written
 *   Draft        narrative written, not yet audited against two sources
 *   Done / Live  narrative audited against two independent sources
 *
 * Only Done and Live are servable. Everything else is working state and must
 * not be offered in the picker.
 *
 * Why this module exists: before it, neither api/airport-search.js nor
 * api/airport-content.js looked at Status at all, so a record carrying prose
 * but no coordinates and no cited source was pickable and embeddable (audit,
 * 25 Aug 2026). See docs/airport-data-plan.md.
 */

/** Statuses a client site may be served. */
export const SERVABLE_AIRPORT_STATUSES = Object.freeze(['Done', 'Live']);

/** True when a record's Status means it is finished enough to serve. Pure. */
export function isServableAirportStatus(status) {
  if (status == null) return false;
  const name = typeof status === 'object' ? status.name : status;
  if (typeof name !== 'string') return false;
  const wanted = name.trim().toLowerCase();
  return SERVABLE_AIRPORT_STATUSES.some(s => s.toLowerCase() === wanted);
}

/**
 * Airtable filterByFormula fragment limiting a query to servable records.
 * The status names are our own constants, never user input, so they are safe
 * to interpolate. Pure.
 */
export function servableStatusFormula(fieldName = 'Status') {
  const tests = SERVABLE_AIRPORT_STATUSES.map(s => `{${fieldName}}='${s}'`);
  return `OR(${tests.join(',')})`;
}
