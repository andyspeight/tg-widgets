'use client';

/**
 * Arranging a collection grid's cards from the block that shows them.
 *
 * WHY THIS EXISTS AT ALL. The hand-set order was built first on the collections
 * screen, where the entries live, and the control that turns it on was built on
 * the cards block, where the grid lives. Andy picked "The order I set" on the
 * block, looked at his two cards, and said "There are no arrows". He was right
 * to: a setting whose effect you cannot reach from where you set it reads as
 * broken, whatever a help line says. So the arrows are in BOTH places now, on
 * his instruction, and this is the half that sits beside the grid.
 *
 * IT MOVES THE ENTRIES, NOT THE BLOCK. There is one order per collection and it
 * belongs to the entries, so arranging here changes what every other grid on
 * the site showing that collection in this order will draw. That is the honest
 * behaviour rather than a surprise: the alternative, an order stored per block,
 * would let two grids of the same collection disagree about which one is first,
 * with nothing recording which was meant.
 *
 * IT READS NOTHING. The cards are already on the canvas, fetched with the page,
 * and each one carries the id of the row it came from. So this is a list the
 * editor already has, and pressing an arrow writes rather than reads.
 */

import { useState } from 'react';

import { reorderItemsAction } from '../../app/actions/collections';
import { Icon } from './Icon';

export function ListingOrderArrows({
  collectionKey,
  cards,
  onMoved,
}: {
  collectionKey: string;
  /** The cards this block is drawing, in the order it is drawing them. */
  cards: ReadonlyArray<Record<string, unknown>>;
  /** Tells the canvas to redraw with the new order. */
  onMoved: (orderedIds: string[]) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /*
   * Only the cards that know which row they came from.
   *
   * A typed card has no id and neither does one from a build old enough to
   * predate carrying it, and an arrow that cannot say what it is moving must
   * not be drawn. In practice this is all of them or none.
   */
  const rows = cards
    .map((card) => ({
      id: typeof card.id === 'string' ? card.id : '',
      title: typeof card.title === 'string' && card.title ? card.title : 'Untitled',
    }))
    .filter((row) => row.id);

  if (!collectionKey) {
    return <p className="ed-help">Choose a collection above, and its entries will be listed here.</p>;
  }

  if (rows.length === 0) {
    return (
      <p className="ed-help">
        Nothing published in this collection yet. Entries appear here once they are live, and the
        arrows put them in the order you want.
      </p>
    );
  }

  if (rows.length === 1) {
    return <p className="ed-help">One entry, so there is nothing to arrange yet.</p>;
  }

  function move(index: number, delta: number) {
    const to = index + delta;
    if (to < 0 || to >= rows.length) return;

    const next = [...rows];
    const [moved] = next.splice(index, 1);
    next.splice(to, 0, moved);

    const orderedIds = next.map((row) => row.id);
    // The canvas redraws from this at once; the save follows. A failure says so
    // rather than animating the card back under the cursor.
    onMoved(orderedIds);
    setError(null);
    setBusy(true);

    void reorderItemsAction(collectionKey, orderedIds).then((result) => {
      setBusy(false);
      if (!result.ok) setError(result.error);
    });
  }

  return (
    <div className="ed-field">
      <span className="ed-label">The order they appear in</span>

      {error && (
        <p className="ed-help" role="alert">
          {error}
        </p>
      )}

      <ul className="ed-orderlist">
        {rows.map((row, index) => (
          <li className="ed-orderlist__row" key={row.id}>
            <span className="ed-orderlist__name" title={row.title}>
              {row.title}
            </span>
            <span className="ed-orderlist__tools">
              <button
                type="button"
                className="ed-btn"
                data-variant="ghost"
                data-icon="true"
                disabled={busy || index === 0}
                aria-label={`Move ${row.title} up`}
                onClick={() => move(index, -1)}
              >
                <Icon name="arrow-up" size={16} />
              </button>
              <button
                type="button"
                className="ed-btn"
                data-variant="ghost"
                data-icon="true"
                disabled={busy || index === rows.length - 1}
                aria-label={`Move ${row.title} down`}
                onClick={() => move(index, 1)}
              >
                <Icon name="arrow-down" size={16} />
              </button>
            </span>
          </li>
        ))}
      </ul>

      <p className="ed-help">
        This is the collection&apos;s own order, so any grid set to follow it will show these in the
        same order. You can also arrange them on the Collections screen.
      </p>
    </div>
  );
}
