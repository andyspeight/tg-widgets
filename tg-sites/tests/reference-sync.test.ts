/**
 * What the sync will and will not write.
 *
 * THE FAR END IS OURS AND STILL NOT TRUSTED. The exporter is another deployment
 * reached over the network, reading a base that is edited by hand and whose
 * schema has changed five times this year. These pin the two failures that would
 * be quiet: a record that cannot be matched again, and a kind that comes back
 * empty because a gate stopped matching rather than because a table is empty.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { usableRecords } from '../lib/db/reference';
import { REFERENCE_KINDS } from '../lib/content/reference';

const good = {
  kind: 'country',
  sourceId: 'recGreece',
  name: 'Greece',
  slug: 'greece',
  facts: { kind: 'country', sourceId: 'recGreece', flightTime: '3h 45m' },
  prose: { overview: 'Two hundred inhabited islands.' },
};

describe('what may be written', () => {
  it('takes a whole record', () => {
    const { usable, refused } = usableRecords('country', [good]);
    expect(usable).toHaveLength(1);
    expect(usable[0].sourceId).toBe('recGreece');
    expect(refused).toEqual([]);
  });

  it('refuses a record with no source id, which would insert a duplicate every run', () => {
    const { usable, refused } = usableRecords('country', [{ ...good, sourceId: '' }]);
    expect(usable).toHaveLength(0);
    expect(refused.join(' ')).toContain('source id');
  });

  it('refuses a record claiming a different kind from the one asked for', () => {
    const { usable, refused } = usableRecords('country', [{ ...good, kind: 'resort' }]);
    expect(usable).toHaveLength(0);
    expect(refused.join(' ')).toContain('resort');
  });

  it('refuses a record with no name or no slug', () => {
    expect(usableRecords('country', [{ ...good, name: '  ' }]).usable).toHaveLength(0);
    expect(usableRecords('country', [{ ...good, slug: '' }]).usable).toHaveLength(0);
  });

  it('keeps the good ones when only some are bad', () => {
    const { usable, refused } = usableRecords('country', [good, { ...good, sourceId: '' }]);
    expect(usable).toHaveLength(1);
    expect(refused).toHaveLength(1);
  });

  it('says so rather than throwing when the answer is not a list at all', () => {
    const { usable, refused } = usableRecords('country', { records: 'oops' });
    expect(usable).toHaveLength(0);
    expect(refused.join(' ')).toContain('list of records');
  });

  it('never lets a missing facts or prose object become undefined in the row', () => {
    const { usable } = usableRecords('country', [{ ...good, facts: null, prose: 'nope' }]);
    expect(usable[0].facts).toEqual({});
    expect(usable[0].prose).toEqual({});
  });
});

describe('the two ends agree on the five kinds', () => {
  /*
   * The exporter has its own list, in the widget suite, because it cannot import
   * from here. A sixth kind added on one side and not the other is a kind that
   * either never syncs or 400s every night, and neither says so loudly.
   */
  const exporter = readFileSync(
    resolve(__dirname, '..', '..', 'api', '_lib', 'reference-status.js'),
    'utf8',
  );

  it('every kind this side knows is gated on the other', () => {
    for (const kind of REFERENCE_KINDS) {
      expect(exporter, `${kind} has no servable status defined in the exporter`).toContain(`${kind}:`);
    }
  });

  it('and the destination levels are NOT gated on the airports vocabulary', () => {
    /*
     * Countries, cities and resorts run Draft, Reviewed, Live. There is no "Done"
     * on those tables, so reusing the airports gate would have matched nothing at
     * all and exported zero of a hundred and eight countries.
     */
    const countryLine = exporter.match(/country:\s*Object\.freeze\(\[([^\]]*)\]\)/)?.[1] ?? '';
    expect(countryLine).toContain('Live');
    expect(countryLine).not.toContain('Done');
  });
});

describe('the cron is wired up', () => {
  const vercel = JSON.parse(readFileSync(resolve(__dirname, '..', 'vercel.json'), 'utf8'));

  it('runs the sync on a schedule', () => {
    const paths = (vercel.crons ?? []).map((cron: { path: string }) => cron.path);
    expect(paths).toContain('/api/cron/reference-sync');
  });

  it('and carries no key the schema does not know, which fails before the build', () => {
    /*
     * vercel.json permits no unknown keys and the failure mode is strange: the
     * deployment errors BEFORE building, so there are no build logs at all. A
     * comment key cost a session once. See the handover.
     */
    expect(Object.keys(vercel).sort()).toEqual(['$schema', 'crons', 'regions']);
    for (const cron of vercel.crons) {
      expect(Object.keys(cron).sort()).toEqual(['path', 'schedule']);
    }
  });
});
