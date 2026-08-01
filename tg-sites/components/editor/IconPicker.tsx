'use client';

/**
 * Choosing one of 1,817 icons.
 *
 * THE SHAPE OF THE PROBLEM IS SEARCH, NOT BROWSING. Nobody scrolls a grid of
 * 1,817 pictures, so the box is focused when the dialog opens and the results
 * change as you type. Everything else here follows from that.
 *
 * THE WHOLE SET IS IN THE BUNDLE, and that is a deliberate trade rather than
 * an oversight. It is 84KB gzipped, it never reaches a published page because
 * those are rendered on the server, and the alternative is a request per
 * keystroke to fetch the pictures for the results. An editor that pauses
 * between letters to ask a server what a spanner looks like is worse than an
 * editor that was 84KB bigger to open. See lib/content/icons.ts.
 *
 * A CAPPED RESULT LIST, and it is capped in searchIcons rather than here so
 * that the cap is one number in one place. 120 fills more than a screen, and
 * an empty query shows the first 120 alphabetically, which is honest about
 * being a starting point rather than pretending to be a curated selection.
 *
 * NOTHING IN HERE FOCUSES ON RENDER except the search box on mount, which is a
 * dialog opening rather than a redraw. The rule that matters is the one about
 * the properties pane redrawing on every keystroke; this component is only
 * ever mounted by a click.
 */

import { useEffect, useMemo, useRef, useState } from 'react';

import { ICON_COUNT, searchIcons } from '../../lib/content/icons';
import { ContentIcon } from '../render/content-icon';
import { Modal } from '../ui/Modal';

export function IconPicker({
  value,
  onChoose,
  onClose,
}: {
  value: string;
  onChoose: (name: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const box = useRef<HTMLInputElement>(null);

  /*
   * ON MOUNT ONLY. A dialog whose search box has to be clicked before it can be
   * typed into is a dialog that wastes a click every time, and this is a real
   * user action opening a real dialog rather than a passive redraw.
   */
  useEffect(() => {
    box.current?.focus();
  }, []);

  const results = useMemo(() => searchIcons(query), [query]);

  return (
    <Modal
      title="Choose an icon"
      description={`${ICON_COUNT.toLocaleString('en-GB')} icons. Type what you are looking for.`}
      size="large"
      onClose={onClose}
    >
      <div className="ip-search">
        <input
          ref={box}
          className="ed-input"
          type="search"
          value={query}
          placeholder="holiday, flight, protected, hotel"
          aria-label="Search icons"
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>

      {results.length === 0 ? (
        <p className="ed-help ip-empty">
          Nothing matching “{query}”. Try a plainer word: bed, sun, plane, shield.
        </p>
      ) : (
        <ul className="ip-grid">
          {results.map((name) => (
            <li key={name}>
              <button
                type="button"
                className="ip-tile"
                aria-pressed={name === value}
                /*
                 * The name is the accessible name of the button, and it is also
                 * the tooltip. The drawing inside is aria-hidden, so without
                 * this the whole grid would announce as 120 unnamed buttons.
                 */
                title={name}
                onClick={() => onChoose(name)}
              >
                <ContentIcon name={name} className="ip-tile__icon" />
                <span className="ip-tile__name">{name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
