'use client';

/**
 * The token inserter for a block inside a collection loop's designed card.
 *
 * WHAT IT IS FOR. A loop repeats one designed card over a collection, and the card
 * says where an item's data goes with tokens: a heading of {{title}}, an image of
 * {{image}}, a button linking to {{link}}, a price of {{field:price-from}}. Without
 * this a client would have to know that syntax and type it by hand, which is the
 * opposite of designing a card. This offers the tokens as buttons, grouped by the
 * slot they fill, and writes the chosen one into the block's own prop.
 *
 * WHY IT KNOWS THE COLLECTION. The fixed tokens (title, summary, picture, link and
 * so on) are the same on every site, but the {{field:key}} tokens are whatever THIS
 * collection declares, so the inserter reads them from useCollectionFields, the same
 * one fetch the cards filter uses. A collection with no declared fields simply offers
 * the fixed set; a loop with no collection chosen yet says so and offers the fixed set
 * anyway, since a card usually leads with a title and a picture either way.
 *
 * WHERE THE TOKEN LANDS. loopTargetsFor(blockType) says which props of this block take
 * tokens and which kinds each accepts, so a picture token is offered for an image's
 * source and never for a heading. A source, a link or a label is SET to the token (it
 * is the whole value); rich text is APPENDED (a token usually sits amongst fixed words,
 * "From {{field:price-from}}"), so the client keeps what they have written.
 */

import { loopTargetsFor, loopTokens, tokenText, type LoopToken } from '../../lib/content/loop';
import { useCollectionFields } from './useCollectionFields';

export function LoopCardInserter({
  collectionKey,
  blockType,
  onInsert,
}: {
  /** The loop's collection, for its declared field tokens. May be empty. */
  collectionKey: string;
  /** The card block being edited, which decides the slots on offer. */
  blockType: string;
  /** Write a token into a prop: append into rich text, otherwise set the prop. */
  onInsert: (prop: string, text: string, append: boolean) => void;
}) {
  const { fields, ready } = useCollectionFields(collectionKey);
  const targets = loopTargetsFor(blockType);
  const tokens = loopTokens(fields);

  // Gated by the caller to a block that takes tokens, but stay safe if that changes.
  if (targets.length === 0) return null;

  return (
    <div className="ed-field tgse-tokens">
      <span className="ed-label">Insert item data</span>
      <p className="ed-help" style={{ marginTop: 0 }}>
        The card repeats over the collection. These drop in each entry&rsquo;s own data.
      </p>

      {targets.map((target) => {
        const offered: LoopToken[] = tokens.filter((token) => target.kinds.includes(token.kind));
        if (offered.length === 0) return null;
        return (
          <div key={target.prop} className="tgse-tokens__group">
            <span className="tgse-tokens__slot">{target.label}</span>
            <div className="tgse-tokens__chips">
              {offered.map((token) => (
                <button
                  key={token.name}
                  type="button"
                  className="ed-btn tgse-tokens__chip"
                  title={`Insert ${tokenText(token.name)}`}
                  onClick={() => onInsert(target.prop, tokenText(token.name), Boolean(target.html))}
                >
                  {token.label}
                </button>
              ))}
            </div>
          </div>
        );
      })}

      {!collectionKey && (
        <p className="ed-help">
          Choose a collection on the loop, and its own fields (a price, nights) appear here too.
        </p>
      )}
      {collectionKey && ready && fields.length === 0 && (
        <p className="ed-help">
          This collection declares no fields of its own yet. Add some on the Collections screen.
        </p>
      )}
    </div>
  );
}
