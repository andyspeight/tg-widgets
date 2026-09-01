'use client';

/**
 * Picking a destination out of the shared corpus.
 *
 * WHAT THIS IS NOT. It is not a form for writing a destination page. The whole
 * point of adoption is that the client does not type the facts: they pick a
 * place, and a draft appears carrying our researched flight times, climate year
 * and practical facts, with seed prose they then rewrite in their own voice.
 * So the only thing this screen asks for is which place.
 *
 * WHY THE LIST SAYS "ADDED" RATHER THAN HIDING WHAT IS TAKEN. A client looking
 * for Santorini and not finding it would reasonably conclude the corpus does
 * not have it, and go and write one by hand, which is the exact duplication
 * this feature exists to prevent. Showing it as already added answers the
 * question they actually have.
 *
 * SEARCH IS DEBOUNCED AND THE INPUT IS NEVER RE-FOCUSED. Focus is taken once,
 * on mount, because opening a search dialog and having to click the box is
 * silly. It is never taken again: a focus call on every render steals the
 * cursor mid-word, which is the bug the widget suite hit in July and the reason
 * the rule is written down in CLAUDE.md.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { REFERENCE_KINDS, type ReferenceKind } from '../../lib/content/reference';
import type { CorpusEntry } from '../../lib/db/reference';
import { Icon } from '../editor/Icon';
import { Modal } from '../ui/Modal';

/** What each kind is called on screen, plural, because the filter picks a set. */
const KIND_LABEL: Record<ReferenceKind, string> = {
  country: 'Countries',
  city: 'Cities and regions',
  resort: 'Resorts and areas',
  airport: 'Airports',
  attraction: 'Attractions',
};

/** How long to wait after the last keystroke before asking the server. */
const DEBOUNCE_MS = 250;

export function AdoptDialog({
  collectionName,
  onClose,
  onSearch,
  onAdopt,
}: {
  collectionName: string;
  onClose: () => void;
  onSearch: (options: { kind: ReferenceKind; search: string }) => Promise<
    { ok: true; entries: CorpusEntry[] } | { ok: false; error: string }
  >;
  /** Resolves to an error to show, or null when the draft was made. */
  onAdopt: (entry: CorpusEntry) => Promise<string | null>;
}) {
  const [kind, setKind] = useState<ReferenceKind>('country');
  const [search, setSearch] = useState('');
  const [entries, setEntries] = useState<CorpusEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /** The source id currently being adopted, so only its own row shows busy. */
  const [adopting, setAdopting] = useState<string | null>(null);

  const box = useRef<HTMLInputElement>(null);
  /*
   * Which request this is. An answer that arrives after a newer one has been
   * sent is thrown away rather than rendered: typing "por" then "porto" must
   * not end up showing the results for "por" because they came back second.
   */
  const latest = useRef(0);

  const run = useCallback(async (nextKind: ReferenceKind, nextSearch: string) => {
    const ticket = latest.current + 1;
    latest.current = ticket;
    setLoading(true);

    const result = await onSearch({ kind: nextKind, search: nextSearch });
    if (latest.current !== ticket) return;

    if (result.ok) {
      setEntries(result.entries);
      setError(null);
    } else {
      setEntries([]);
      setError(result.error);
    }
    setLoading(false);
  }, [onSearch]);

  // Focus the box once, on mount, and never again. See the note at the top.
  useEffect(() => {
    box.current?.focus();
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => void run(kind, search), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [kind, search, run]);

  async function adopt(entry: CorpusEntry) {
    setAdopting(entry.sourceId);
    const failed = await onAdopt(entry);
    setAdopting(null);
    if (failed) {
      setError(failed);
      /*
       * Mark it added anyway when the reason is that it already was. The row
       * disagreeing with the message it just produced is worse than a stale
       * flag, and the next search corrects it either way.
       */
      if (/already/i.test(failed)) {
        setEntries((rows) => rows.map((row) => (
          row.sourceId === entry.sourceId ? { ...row, adopted: true } : row
        )));
      }
    }
  }

  return (
    <Modal
      title={`Add a destination to ${collectionName}`}
      description="Pick a place. The facts come with it and stay up to date; the words are yours to rewrite."
      size="large"
      onClose={onClose}
      footer={
        <button type="button" className="tg-btn" onClick={onClose}>
          Done
        </button>
      }
    >
      {error && (
        <p className="sv-msg" role="alert">
          {error}
        </p>
      )}

      <div className="sv-field">
        <label htmlFor="adopt-kind">Kind</label>
        <select
          id="adopt-kind"
          value={kind}
          onChange={(event) => setKind(event.target.value as ReferenceKind)}
        >
          {REFERENCE_KINDS.map((entry) => (
            <option key={entry} value={entry}>
              {KIND_LABEL[entry]}
            </option>
          ))}
        </select>
      </div>

      <div className="sv-field">
        <label htmlFor="adopt-search">Search</label>
        <input
          id="adopt-search"
          ref={box}
          value={search}
          placeholder="Santorini, Algarve, Cape Town"
          autoComplete="off"
          onChange={(event) => setSearch(event.target.value)}
        />
        <small>Leave it empty to browse the first hundred alphabetically.</small>
      </div>

      <div className="sv-adopt" aria-busy={loading}>
        {loading && entries.length === 0 && (
          <p className="sv-adopt__note">Looking…</p>
        )}

        {!loading && entries.length === 0 && !error && (
          <p className="sv-adopt__note">
            {search
              ? `Nothing in ${KIND_LABEL[kind].toLowerCase()} matches “${search}”.`
              : 'Nothing here yet. The corpus syncs overnight.'}
          </p>
        )}

        {entries.length > 0 && (
          <ul className="sv-adopt__list">
            {entries.map((entry) => (
              <li className="sv-adopt__row" key={`${entry.kind}:${entry.sourceId}`}>
                <span className="sv-adopt__name">{entry.name}</span>
                {entry.adopted ? (
                  <span className="sv-adopt__added">
                    <Icon name="check" size={16} />
                    Added
                  </span>
                ) : (
                  <button
                    type="button"
                    className="tg-btn"
                    data-variant="primary"
                    disabled={adopting !== null}
                    onClick={() => void adopt(entry)}
                  >
                    {adopting === entry.sourceId ? 'Adding' : 'Add'}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
}
