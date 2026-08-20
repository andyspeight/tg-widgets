/**
 * The ten travel homepage concepts, as get-started templates a client can start
 * from (Andy, 19 Aug 2026).
 *
 * WHAT THESE ARE. Each is the concept's own design, brought in through the same
 * import pipeline a client's paste goes through (tools/build-designed-homes.mjs
 * bakes lib/content/designed/sources/<slug>.html into <slug>.json). So a client
 * who picks one gets the design pixel for pixel, its real layout, colour, spacing
 * and typeface, with every word and picture an editable slot. Andy chose that on
 * 19 Aug 2026 over a rebuild into native blocks, which converged the ten on one
 * house style: the whole point of ten designs is that they look like ten.
 *
 * WHY THE HEAVY PART IS HERE AND THE LIST IS NOT. The baked designs are hundreds
 * of kilobytes of frozen markup that only the server ever builds. The picker,
 * a client component, needs only the id, label and one line, which live in
 * designed-homes-meta.ts. This module is reached by a dynamic import from the two
 * build hooks, so the markup is a server-side chunk and never lands in the
 * editor's browser bundle.
 *
 * IDS ARE MINTED FRESH ON EVERY BUILD. The JSON is baked with fixed ids; two
 * sites seeded from one design must not share a section id or the editor would
 * edit the wrong one. remint() rewrites every id and carries the change onto the
 * imported block's css scope class, which is the only place an id is echoed
 * outside its own field.
 */

import { newId } from './factory';
import type { Section } from './schema';

import windwardWest from './designed/windward-west.json';
import bucketAndSpade from './designed/bucket-and-spade.json';
import sandpiper from './designed/sandpiper.json';
import harbourline from './designed/harbourline.json';
import fenwickHale from './designed/fenwick-hale.json';
import peakAndPass from './designed/peak-and-pass.json';
import awaydays from './designed/awaydays.json';
import harlandVane from './designed/harland-vane.json';
import aurelia from './designed/aurelia.json';
import harlowWren from './designed/harlow-wren.json';

const FROZEN: Record<string, unknown> = {
  'windward-west': windwardWest,
  'bucket-and-spade': bucketAndSpade,
  sandpiper,
  harbourline,
  'fenwick-hale': fenwickHale,
  'peak-and-pass': peakAndPass,
  awaydays,
  'harland-vane': harlandVane,
  aurelia,
  'harlow-wren': harlowWren,
};

/**
 * A fresh copy with every id re-minted.
 *
 * Works on the JSON text so one pass covers the section, row, column and block
 * ids and the css scope class together. An id is matched only where it is an
 * `"id"` value, so a design's own class that happens to look like one is never
 * touched; the block id is then rewritten in its `tgi-` scope class, the one
 * place it is echoed. The whole thing stays a sanitiser fixpoint: the css is
 * still scoped to the block's id, so a page save changes nothing.
 */
function remint(sections: Section[]): Section[] {
  const map = new Map<string, string>();
  let json = JSON.stringify(sections).replace(
    /"id":"((?:sec|row|col|blk)_[a-z0-9]+)"/g,
    (_whole, oldId: string) => {
      let fresh = map.get(oldId);
      if (!fresh) {
        fresh = newId(oldId.slice(0, 3));
        map.set(oldId, fresh);
      }
      return `"id":"${fresh}"`;
    },
  );
  // Move the css scope class to the block's new id. Matching the whole id token
  // rather than a substring is what stops one id that happens to be a prefix of
  // another (blk_3w inside blk_3wc) from corrupting the longer one's scope.
  json = json.replace(/tgi-(blk_[a-z0-9]+)/g, (whole, oldBlk: string) => {
    const fresh = map.get(oldBlk);
    return fresh ? `tgi-${fresh}` : whole;
  });
  return JSON.parse(json) as Section[];
}

/**
 * The frozen sections for a designed home, ready to seed a page, with fresh ids.
 *
 * An unknown id gives back nothing rather than throwing: the id is looked up
 * against the closed baked set, so a stale or hostile pick folds to an empty
 * page the same way a bad template id does.
 */
export function designedHomeSections(id: string): Section[] {
  const raw = FROZEN[id];
  if (!Array.isArray(raw)) return [];
  return remint(raw as Section[]);
}
