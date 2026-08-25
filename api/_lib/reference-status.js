/**
 * Which records in the Destination Content base may reach a client's website.
 *
 * THE VOCABULARY IS NOT THE SAME ON EVERY TABLE, and that is the whole reason
 * this file exists rather than reusing servableStatusFormula from
 * airport-status.js. Read from the base on 25 Aug 2026:
 *
 *   Countries            Draft, Reviewed, Live
 *   Cities and Regions   Draft, Reviewed, Live
 *   Resorts and Areas    Draft, Reviewed, Live
 *   Airports             Todo, In progress, Done, Draft, Live
 *   Attractions          Todo, In progress, Done, Draft, Published, Live
 *
 * The airports gate is hard-coded to Done and Live. Applied to Countries it
 * would have matched nothing at all: there is no Done on that table. An export
 * that quietly returned zero of a hundred and eight countries is exactly the
 * kind of failure this codebase keeps finding, so the gate is stated per kind
 * and the caller is told how many records it looked at as well as how many it
 * served.
 *
 * WHY "Reviewed" IS NOT SERVABLE. The destination tables run Draft, Reviewed,
 * Live, which is an editorial flow: Reviewed means somebody has checked it, Live
 * means it has been published. Serving Reviewed would be publishing on the
 * author's behalf.
 *
 * WHY "Done" IS. Airports and attractions run the verification flow described in
 * airport-status.js, where Done means the narrative has been audited against two
 * independent sources. That is the bar, and Published and Live are past it.
 */

/** Servable statuses, per kind. Anything not listed here is working state. */
export const SERVABLE_STATUSES = Object.freeze({
  country: Object.freeze(['Live']),
  city: Object.freeze(['Live']),
  resort: Object.freeze(['Live']),
  airport: Object.freeze(['Done', 'Live']),
  attraction: Object.freeze(['Done', 'Published', 'Live']),
});

/** The five kinds the corpus holds. Matches ReferenceKind in tg-sites. */
export const REFERENCE_KINDS = Object.freeze(Object.keys(SERVABLE_STATUSES));

/** True when this record's Status means a client site may publish it. Pure. */
export function isServable(kind, status) {
  const allowed = SERVABLE_STATUSES[kind];
  if (!allowed) return false;
  const name = status && typeof status === 'object' ? status.name : status;
  if (typeof name !== 'string') return false;
  const wanted = name.trim().toLowerCase();
  return allowed.some((s) => s.toLowerCase() === wanted);
}

/**
 * An Airtable filterByFormula fragment limiting a query to servable records.
 *
 * The status names are our own constants and never user input, so they are safe
 * to interpolate. Returns null for an unknown kind rather than a formula that
 * would match everything, because a filter that silently stops filtering is how
 * unverified content reaches a client site.
 */
export function servableFormula(kind, fieldName = 'Status') {
  const allowed = SERVABLE_STATUSES[kind];
  if (!allowed) return null;
  return `OR(${allowed.map((s) => `{${fieldName}}='${s}'`).join(',')})`;
}
