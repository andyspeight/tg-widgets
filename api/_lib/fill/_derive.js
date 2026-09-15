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
/** The editorial separator used across the brand, as in "Bora Bora · Society Islands". */
const SEPARATOR = /\s*[\u00b7\u2027\u2022]\s*/;

/** The country names that mean "home" for a UK travel agency. */
const UK_COUNTRY = /^(?:the\s+)?(?:united kingdom|u\.?k\.?|great britain|britain|england|scotland|wales|northern ireland)$/i;

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

  /**
   * A resort's region is a breadcrumb, not an inheritance: the city it sits in,
   * then the area that city sits in. Confirmed by Andy on 14 Sep 2026 and
   * matching all twelve resorts that already carry one.
   *
   *   city    Bora Bora   region "Society Islands · South Pacific"
   *   resort  on it       region "Bora Bora · Society Islands"
   *
   * So it takes the parent's NAME and the head of the parent's own region. It
   * never copies the parent's region wholesale, which is what the old rule did
   * and what would have put the country's answer on 483 resorts.
   */
  if (how.from === 'regionCrumb') {
    const parent = ancestorsOf(rec, byId || new Map())[0];
    if (!parent || !parent.name) {
      return { ok: false, why: 'this record has no parent to place it against' };
    }
    const above = String((parent.values && parent.values.Region) || '').trim();
    if (!above) {
      return {
        ok: false,
        why: 'the region for ' + parent.name + ' has to be set first, because this one is built from it',
      };
    }
    const head = above.split(SEPARATOR)[0].trim();
    if (!head) return { ok: false, why: 'the region for ' + parent.name + ' is not in the expected shape' };
    return {
      ok: true,
      value: parent.name + ' · ' + head,
      evidence: 'Built from ' + parent.name + ', which this record sits inside, and its region "' + above + '".',
      inheritedFrom: parent.id,
    };
  }

  // Which side of the journey an airport sits on. Not a fact about the building,
  // which is why no pair of open datasets settles it, but a fact about our own
  // customers: a UK airport is where they fly from and everywhere else is where
  // they fly to. The country is already on the record, so the answer is too.
  //
  // VERIFIED RATHER THAN ASSUMED (15 Sep 2026). Cross-tabulated against the 225
  // airports where a person had already set the role: all 24 whose Country Text
  // reads "United Kingdom" are UK Origin, and all 201 others are Overseas
  // destination. Not one contradiction. This rule reproduces what a person did
  // 225 times out of 225, which is why it is safe to run on the other 375.
  //
  // The select also offers "Destination" and "Both", left over from an earlier
  // shape. No record uses either and no person chose either, so this never
  // writes them. An airport that genuinely serves both roles stays a person's
  // call, and they can simply overwrite what this fills in.
  if (how.from === 'ukOrigin') {
    const country = String((rec.values && rec.values['Country Text']) || '').trim();
    if (!country) {
      return { ok: false, why: 'the country has to be filled first, because the role is read from it' };
    }
    // The Aug bulk import left two-letter ISO codes in some of these. A code is
    // not an answer, and guessing from one would be how a wrong role gets in.
    if (/^[A-Za-z]{2}$/.test(country)) {
      return { ok: false, why: '"' + country + '" is a country code rather than a country name, so that needs fixing first' };
    }
    const home = UK_COUNTRY.test(country);
    return {
      ok: true,
      value: home ? 'UK Origin' : 'Overseas destination',
      evidence: 'Read from the country on this record, which says ' + country + '. ' +
        (home ? 'A UK airport is one our customers fly from.' : 'Anywhere outside the UK is one they fly to.'),
    };
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
