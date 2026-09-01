'use client';

/**
 * The tenant's collections and the fields each declares, read once for the editor.
 *
 * WHY A SHARED HOOK. Two panes now need a collection's own fields: the Cards block's
 * filter/sort builder (ListingFilterFields) and the loop card's token inserter
 * (LoopCardInserter). Both ask the same question, "what does THIS collection declare",
 * and the answer is the same list. Holding the fetch here, with the promise at module
 * scope, means a page carrying both still makes ONE request rather than one per pane.
 *
 * FETCHED ONCE, NEVER REFETCHED. listCollectionsAction returns every collection with
 * its fields, so one call answers for all of them. A client who adds a field on the
 * Collections screen is on another screen, and coming back reloads this one, so there
 * is no live edit to keep up with here. A failure answers with nothing rather than
 * throwing: the controls then read as a collection that declares no fields, which is
 * the same calm state as one that genuinely declares none.
 */

import { useEffect, useState } from 'react';

import { listCollectionsAction } from '../../app/actions/collections';
import type { Collection } from '../../lib/db/collections';
import type { FieldDef } from '../../lib/content/collection-fields';

let pending: Promise<Collection[]> | null = null;

export function loadCollections(): Promise<Collection[]> {
  if (!pending) {
    pending = listCollectionsAction()
      .then((result) => (result.ok ? result.data : []))
      .catch(() => []);
  }
  return pending;
}

/** The fields a named collection declares, and whether the one fetch has answered yet. */
export function useCollectionFields(collectionKey: string): { fields: FieldDef[]; ready: boolean } {
  const [all, setAll] = useState<Collection[] | null>(null);

  useEffect(() => {
    let live = true;
    void loadCollections().then((list) => {
      if (live) setAll(list);
    });
    return () => {
      live = false;
    };
  }, []);

  const found = all?.find((c) => c.key === collectionKey);
  return { fields: found?.fields ?? [], ready: all !== null };
}
