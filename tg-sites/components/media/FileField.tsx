'use client';

/**
 * Choosing a file to put on a page.
 *
 * The document twin of ImageField, and a separate component rather than a flag on
 * that one. ImageField is built around things a picture has and a document does
 * not: a thumbnail, alt text, a focus point, a crop, pixel dimensions to write
 * down so the page does not jump while it loads. A `kind` prop there would have
 * meant guarding every one of those, and the result would be a component whose
 * shape nobody could hold in their head. They share the part that is genuinely
 * shared, which is MediaPicker.
 *
 * WHAT IT WRITES. Three props in ONE patch: the address, the filename and the
 * size in bytes. The last two are copied at the moment of choosing rather than
 * read at render time, for the same reason ImageField copies a picture's
 * dimensions: the block stores a URL and the rest lives on the media row, so
 * looking them up while rendering would be a database query per visitor per file.
 *
 * One patch, not three, so a single undo takes the whole choice back.
 *
 * NO URL ESCAPE HATCH, unlike ImageField. That field exists because an agency
 * moving in often has its photographs on a CDN already and re-uploading them
 * would change nothing. A document is different: the whole value of the element
 * is that we hold the file, so it cannot vanish from under a live page when
 * somebody tidies a Dropbox. A client who genuinely wants to point at a file
 * elsewhere has the Button element, which is what a link to somewhere else is.
 *
 * Like everything in the properties pane, it never focuses or scrolls as part of
 * rendering. The pane re-renders on every keystroke.
 */

import { useState } from 'react';

import { formatLabel, humanBytes } from '../../lib/media/limits';
import type { MediaItem } from '../../lib/media/types';
import { Icon } from '../editor/Icon';
import { MediaPicker } from './MediaPicker';

interface Props {
  /** The address of the chosen file, or empty. */
  value: string;
  /** Set several props at once: the address, the name and the size together. */
  onPatch: (patch: Record<string, unknown>) => void;
  /** The prop the address is written to. */
  urlKey: string;
  /** The prop the original filename is written to, so the block can show it. */
  nameKey: string;
  /** The prop the size in bytes is written to, so the block can show it. */
  sizeKey: string;
  /** The prop the format label is written to, so the block can show it. */
  formatKey: string;
  /** What is on the block now, so the chosen row can describe it without a lookup. */
  current?: { name?: string; size?: number; format?: string };
}

export function FileField({
  value,
  onPatch,
  urlKey,
  nameKey,
  sizeKey,
  formatKey,
  current,
}: Props) {
  const [picking, setPicking] = useState(false);

  function choose(item: MediaItem) {
    setPicking(false);
    onPatch({
      [urlKey]: item.url,
      [nameKey]: item.filename,
      [sizeKey]: item.bytes,
      [formatKey]: formatLabel(item.mime),
    });
  }

  /* Clearing takes all four back out together, so a block with no file has no
     stale name or size sitting behind it waiting to reappear. */
  function clear() {
    onPatch({ [urlKey]: '', [nameKey]: '', [sizeKey]: 0, [formatKey]: '' });
  }

  return (
    <>
      {value ? (
        <div className="mp-chosen mp-chosen--file">
          <span className="mp-chosen__doc" aria-hidden="true">
            <Icon name="file" size={18} />
          </span>
          <div className="mp-chosen__file">
            <span className="mp-chosen__name" title={current?.name || value}>
              {current?.name || 'A file'}
            </span>
            <span className="mp-chosen__detail">
              {[current?.format, current?.size ? humanBytes(current.size) : '']
                .filter(Boolean)
                .join(' · ')}
            </span>
          </div>
          <div className="mp-chosen__actions">
            <button type="button" className="tg-btn" onClick={() => setPicking(true)}>
              Replace
            </button>
            <button type="button" className="tg-btn" onClick={clear}>
              Remove
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          className="tg-btn"
          data-variant="primary"
          onClick={() => setPicking(true)}
        >
          <Icon name="file" size={15} />
          Choose a file
        </button>
      )}

      {picking && (
        <MediaPicker
          kind="file"
          currentUrl={value || undefined}
          onChoose={choose}
          onClose={() => setPicking(false)}
        />
      )}
    </>
  );
}
