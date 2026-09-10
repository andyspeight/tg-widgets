/**
 * The free fixer: gaps whose answer is already in the database.
 *
 * A resort in Spain is in Spain's time zone, spends Spain's currency and uses
 * Spain's plugs. A URL slug is the name, lower-cased. None of that needs
 * research, a model call, or a verification gate, and none of it can be wrong
 * in a way two sources would catch — it is either inherited from a record we
 * already trust, or it is arithmetic on the name.
 *
 * Pure: no network, no model, no Airtable. Given a record and its ancestors it
 * returns a value or it returns nothing. That makes it the cheapest work in the
 * queue and the safest thing to run first, and every value it fills is one less
 * thing the editorial writer has to be told or, worse, left to invent.
 *
 * Tests: npm run test:destinations-fill
 */

/**
 * The web address segment for a name.
 * Accents are folded rather than stripped so Málaga becomes malaga, not mlaga.
 */
export function slugify(name) {
  const s = String(name == null ? '' : name)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')      // fold accents
    .replace(/&/g, ' and ')
    .replace(/['\u2019]/g, '')                               // O'Brien -> obrien
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return s;
}

/**
 * Walk up the hierarchy from a record.
 * @param {object} rec           the record, carrying parentId
 * @param {Map} byId             every record by id
 * @returns {object[]}           ancestors, nearest first
 */
export function ancestorsOf(rec, byId) {
  const out = [];
  let node = rec;
  for (let hop = 0; hop < 4; hop++) {
    node = node && node.parentId ? byId.get(node.parentId) : null;
    if (!node) break;
    out.push(node);
  }
  return out;
}

/**
 * Try to derive one field.
 *
 * @param {object} args
 *   field    the field spec {label, kind}
 *   how      the DERIVE entry {from: 'slug'|'country'|'parent'}
 *   rec      the record being filled, with .name and .values (label -> value)
 *   byId     Map of id -> record, for walking up
 * @returns {{ok:true, value:string, evidence:string} | {ok:false, why:string}}
 */
export function derive({ field, how, rec, byId }) {
  if (!field || !how) return { ok: false, why: 'no rule for this field' };

  if (how.from === 'slug') {
    const slug = slugify(rec.name);
    if (!slug) return { ok: false, why: 'the record has no name to build a slug from' };
    return { ok: true, value: slug, evidence: 'Built from the record name "' + rec.name + '".' };
  }

  // Inherited: take the nearest ancestor that actually holds a usable value.
  const chain = ancestorsOf(rec, byId || new Map());
  const wanted = how.from === 'country'
    ? chain.filter(a => a.type === 'country')
    : chain;

  for (const a of wanted) {
    const v = a.values && a.values[field.label];
    if (v == null) continue;
    const s = String(v).trim();
    if (!s) continue;
    return {
      ok: true,
      value: s,
      evidence: 'Inherited from ' + a.name + ', which this record sits inside.',
      inheritedFrom: a.id,
    };
  }

  return {
    ok: false,
    why: how.from === 'country'
      ? 'no parent country holds this yet, so fill the country first'
      : 'no parent record holds this yet',
  };
}

/**
 * Which derivable fields would resolve right now, given what the library holds?
 * Used to tell the truth about a job's size before anything is queued: a job
 * that would hold every record because the countries are empty is not a job
 * worth starting, it is a signal to do the countries first.
 */
export function derivableNow({ field, how, records, byId }) {
  let ready = 0, blocked = 0;
  for (const r of records) {
    const out = derive({ field, how, rec: r, byId });
    if (out.ok) ready++; else blocked++;
  }
  return { ready, blocked };
}
