/**
 * What kind of work does each gap actually need?
 *
 * Andy's instruction (10 Sep 2026): the dashboard should fill the gaps and
 * correct the issues on a button press, per record and in bulk. That only works
 * if the runner knows that "gap" is three different problems wearing one word.
 *
 *   derive  — the answer is already in the database. A URL slug is the name
 *             lower-cased; a resort's currency is its country's currency. No
 *             research, no model, no cost, and it cannot be wrong. Roughly a
 *             fifth of the library's gaps are this, and every one of them was
 *             being counted as work.
 *
 *   fact    — a checkable quantity. Twelve monthly temperatures, a coordinate,
 *             an IATA code. Two INDEPENDENT sources have to agree or it is
 *             held: Open-Meteo against NASA POWER, OurAirports against
 *             Wikidata. Cheap (open data, not model calls) and it can never
 *             invent, because a single source is a hold, not an answer.
 *
 *   write   — editorial. An overview, a tagline, a set of highlight cards.
 *             There is no second source for a sentence, so this is where the
 *             model writes and where the gate earns its keep. This is also
 *             where the money goes.
 *
 *   manual  — a person has to decide. Photography, and the tags that say who a
 *             place suits, are judgement calls we do not fake.
 *
 * The order matters: derive before fact before write. Every derived value gives
 * the writer more context and one less thing to invent, so running them in that
 * order makes the expensive step both cheaper and better grounded.
 */

/** Fields whose value is already in the database, and where to get it. */
const DERIVE = {
  // Computed from the record's own name.
  'URL Slug': { from: 'slug' },
  // Inherited from the parent country (a resort is in its country's time zone).
  'Time Zone': { from: 'country' },
  'Currency': { from: 'country' },
  'Language': { from: 'country' },
  'Voltage And Plug': { from: 'country' },
  // Inherited from whichever ancestor has it.
  'Region': { from: 'parent' },
  'Flight Time From UK': { from: 'parent' },
};

/** Fields two independent sources can settle. */
const FACT = {
  'Climate Temps': { via: 'climate' },
  'Climate Rainfall': { via: 'climate' },
  'Climate Season': { via: 'climate' },
  'Latitude': { via: 'geo' },
  'Longitude': { via: 'geo' },
  'Lat': { via: 'geo' },
  'Lng': { via: 'geo' },
  'IATA Code': { via: 'airport' },
  'City Served': { via: 'airport' },
  'Country Text': { via: 'airport' },
  'Official Website': { via: 'source' },
  'Wikipedia URL': { via: 'source' },
  'Source 1 URL': { via: 'source' },
  'Source 2 URL': { via: 'source' },
  'Verified Date': { via: 'stamp' },
};

/** Fields we will not guess at. */
const MANUAL = new Set([
  'Image URLs',           // photography is chosen, not generated
  'Image Attribution',    // follows the photograph
  'Hero Image URL',
  'Best For Tags',        // audience fit is Andy's call, not a model's
  'Who Is It Best For',
  'Best Paired With (Countries)',
  'Best Paired With (Cities)',
  'Best Paired With (Resorts)',
]);

/**
 * Per-field briefs for the writer. Most fields need nothing here: the label,
 * the group and the hint already say what they are. These are the ones with a
 * shape that has to be exact, where a good sentence in the wrong format is
 * still a failure.
 */
const BRIEF = {
  'Tagline':
    'One evocative line of 40 to 70 characters. Never use the place name. No full stop. ' +
    'Editorial, in the register of a good travel magazine, not sales copy.',
  'Hero Intro':
    'Two or three sentences that open the page. Concrete and specific to this place. ' +
    'No throat-clearing and no "nestled".',
  'Overview':
    '150 to 200 words. What the place actually is, who goes and why, what it feels like. ' +
    'Specific detail beats adjectives.',
  'Highlights JSON':
    'A JSON array of 3 to 6 objects, each {"icon","title","description"}. Icon must be one of: ' +
    'mountain, sunset, wine, water, palm, city, temple, beach, food, star, camera, heart, ' +
    'building, map, compass, sun, snowflake. Title is 2 to 4 words. Description is 25 to 40 ' +
    'words and names something real. Output the JSON array and nothing else.',
  'Events JSON':
    'A JSON array of 1 to 6 objects, each {"month","name","description"}. Month is a short name ' +
    '(Jan, Feb) or a range (May-Sep). Description is 15 to 25 words. Only genuine annual events ' +
    'you are confident exist. An empty array is better than an invented festival. ' +
    'Output the JSON array and nothing else.',
  'SEO Meta Title': 'At most 60 characters including the place name. No pipes stacked with keywords.',
  'SEO Meta Description': 'At most 155 characters. A reason to click, not a keyword list.',
  'Best Time to Visit': 'Month by month where it matters. Name the trade-offs, including the bad months.',
  'Top Things to Do': '5 to 8 highlights in prose, each named specifically. No numbered list.',
  'Food and Drink': 'What to actually eat and drink here, named. Local, not generic.',
  'Getting There': 'From the UK. Airports, typical flight time, transfer.',
  'Practical Info': 'Currency, language, time zone, visas for UK travellers, plugs.',
  'Character and Vibe': 'Beach or town, lively or quiet, modern or traditional. Be willing to say who would not enjoy it.',
  'Beaches': 'The beaches by name, what the sand and water are like, facilities.',
  'Getting Around': 'Walkability, local transport, whether a car is needed.',
  'Nearby Excursions': 'Day trips worth the journey, with rough travel times.',
  'What Makes It Special': 'The one thing that would make someone choose here over the next place along the coast.',
};

/** Fields the runner must never touch, whatever their state. */
const NEVER = new Set(['Status']);

/**
 * THE ALLOW-LIST. A field is written by a model ONLY if it is named here.
 *
 * This used to be the default, and that was the single worst decision in this
 * runner. On 11 Sep 2026 Andy ran Terminals & Airlines over 375 airports, twice.
 * Every item was held, $4.14 was spent, and nothing was written. The field asks
 * which terminal each airline flies from. That is an operational fact about a
 * named airport, and we hold no source for it, so the writer either refused or
 * invented and the gate refused for it. Correct behaviour, two hours late and
 * four dollars in.
 *
 * The same trap was sitting under Parking, Lounges, Drop-off & Pick-up,
 * Special Assistance, Recommended Arrival Time, Getting There By Train and a
 * dozen more: all facts, all defaulting to "a model writes it".
 *
 * So the default is now closed, like every other decision in this system. What
 * belongs here is INTERPRETATION of facts we already hold, never a new fact.
 * If filling a field correctly would require looking something up, it does not
 * belong here however well a model could fake it.
 */
const WRITE = new Set([
  'Overview',                 // what the place is, from what we hold about it
  'Tagline',
  'Hero Intro',
  'Character and Vibe',
  'What Makes It Special',
  'Highlights JSON',
  'SEO Meta Title',
  'SEO Meta Description',
]);

/**
 * Classify one field.
 * @returns {{kind:'derive'|'fact'|'write'|'source'|'manual', how?:object, brief?:string}}
 */
export function fillPlanFor(field) {
  const label = field && field.label;
  if (!label || NEVER.has(label)) return { kind: 'manual', why: 'not a field the runner writes' };
  if (MANUAL.has(label)) return { kind: 'manual', why: 'a person chooses this' };
  if (DERIVE[label]) return { kind: 'derive', how: DERIVE[label] };
  if (FACT[label]) return { kind: 'fact', how: FACT[label] };
  if (field.kind === 'link') return { kind: 'manual', why: 'links are set by hand' };
  if (WRITE.has(label)) return { kind: 'write', brief: BRIEF[label] || '' };
  return {
    kind: 'source',
    why: 'this is a fact about the place, not something that can be written from what we hold',
  };
}

/**
 * Can the runner actually attempt this today?
 *
 * 'source' and 'fact' both mean no: one has no source at all, the other has a
 * fixer nobody has wired up yet. Both would queue and hold every record, which
 * is the exact failure this whole file now exists to prevent.
 */
export function isAutomatable(field) {
  const kind = fillPlanFor(field).kind;
  return kind === 'derive' || kind === 'write';
}

/**
 * Roughly what one field costs to fill, in pence. Derived and factual fills
 * make no model call at all. An editorial field pays for the write plus the two
 * independent gate reads, which is the whole reason the gate is worth paying
 * for: it is the difference between "a model wrote it" and "a model wrote it
 * and two separate reads could not fault it".
 */
export function estimatePence(field) {
  const plan = fillPlanFor(field);
  return plan.kind === 'write' ? 3 : 0;
}

/**
 * Is there enough on this record to write from?
 *
 * The writer's evidence is the record's own values plus its parents. An airport
 * record holding a name and a country code gives it nothing, so it can only
 * refuse or invent, and either way we pay for the attempt. This is the check
 * that makes an empty record free instead of three pence, and it is the reason
 * the order of work is facts first, editorial second.
 *
 * @returns {{ok:true} | {ok:false, why:string}}
 */
export function hasEnoughToWriteFrom({ rec, ancestors }) {
  const SKIP = new Set(['Status', 'URL Slug', 'Verified Date', 'Source 1 URL', 'Source 2 URL']);
  const substantive = Object.entries((rec && rec.values) || {})
    .filter(([label, v]) => !SKIP.has(label) && v != null && String(v).trim().length >= 3);

  if (substantive.length >= 4) return { ok: true };

  // A parent with real content is evidence too: a resort can be written from
  // its country's overview even when its own row is bare.
  const parentProse = (ancestors || []).some(a =>
    ['Overview', 'Character and Vibe', 'Best Time to Visit']
      .some(l => a.values && String(a.values[l] || '').trim().length >= 80));
  if (parentProse) return { ok: true };

  return {
    ok: false,
    why: 'there is almost nothing on this record to write from, so the facts need filling first',
  };
}

export const KINDS = { DERIVE, FACT, MANUAL, WRITE, BRIEF, NEVER };
