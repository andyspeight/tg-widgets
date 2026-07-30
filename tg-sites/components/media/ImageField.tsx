'use client';

/**
 * The control that replaced "paste an image URL".
 *
 * One component, used everywhere an image is chosen: the image block, every item
 * of a gallery, a section's background and the social preview image. That is the
 * reason it is a component rather than three variations. There were three separate
 * URL inputs before, and adding a picker to one of them would have left the other
 * two as the old experience for no reason a client could work out.
 *
 * WHY THE URL FIELD IS STILL HERE
 *
 * Tucked away, but not removed. A travel agency moving to this from an existing
 * site often has its photographs on a CDN already, or gets them from a supplier as
 * links, and refusing to accept a URL would mean re-uploading everything to change
 * nothing. Wix and Squarespace both keep this door open for the same reason.
 *
 * WHAT IT DOES NOT DO
 *
 * It never focuses or scrolls as part of rendering. The properties pane re-renders
 * on every keystroke, and a control that grabbed focus while drawing itself is the
 * bug that once made the widget suite's enquiry editor need a click per letter.
 */

import { useState } from 'react';

import { safeUrl } from '../../lib/content/sanitise';
import type { MediaItem } from '../../lib/media/types';
import { Icon } from '../editor/Icon';
import { MediaPicker } from './MediaPicker';

interface Props {
  value: string;
  onChange: (url: string) => void;
  /**
   * Set several props at once, when the caller has more than one to set.
   *
   * Optional because not every use has an alt field beside it. Where there is one,
   * choosing a picture that already has a description fills it in, which is the
   * difference between alt text being written once and being skipped. See the note
   * on MediaItem.alt.
   */
  onPatch?: (patch: Record<string, unknown>) => void;
  /** The prop name the alt text should be written to, if there is one. */
  altKey?: string;
  /** The prop name this control writes the URL to. Needed only with onPatch. */
  urlKey?: string;
}

export function ImageField({ value, onChange, onPatch, altKey, urlKey }: Props) {
  const [picking, setPicking] = useState(false);
  const [showUrl, setShowUrl] = useState(false);

  function choose(item: MediaItem) {
    setPicking(false);

    /*
     * Both fields together, in one commit, when the caller can take it.
     *
     * Two separate onChange calls would give the undo history two steps for one
     * action, so undoing a picture choice would leave its description behind.
     */
    if (onPatch && urlKey) {
      const patch: Record<string, unknown> = { [urlKey]: item.url };
      // Only fills an EMPTY description. Somebody who wrote their own alt text for
      // this block meant it, and a picture swap is not a reason to lose it.
      if (altKey && item.alt) patch[altKey] = item.alt;
      onPatch(patch);
      return;
    }

    onChange(item.url);
  }

  return (
    <>
      {value ? (
        <div className="mp-chosen">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="mp-chosen__thumb" src={value} alt="" />
          <div className="mp-chosen__actions">
            <button type="button" className="tg-btn" onClick={() => setPicking(true)}>
              Replace
            </button>
            <button
              type="button"
              className="tg-btn"
              data-variant="ghost"
              onClick={() => onChange('')}
            >
              Remove
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          className="mp-choose"
          onClick={() => setPicking(true)}
        >
          <Icon name="image" size={18} />
          <span>
            <strong>Choose an image</strong>
            Your library, an upload, or the photo library
          </span>
        </button>
      )}

      <div className="mp-url">
        <button
          type="button"
          className="mp-url__toggle"
          aria-expanded={showUrl}
          onClick={() => setShowUrl((open) => !open)}
        >
          {showUrl ? 'Hide' : 'Or use a web address'}
        </button>
        {showUrl && (
          <input
            className="ed-input"
            type="text"
            inputMode="url"
            value={value}
            placeholder="https://images.example.com/photo.jpg"
            onChange={(event) => onChange(event.target.value)}
          />
        )}
        {/*
          A URL the renderer will refuse gets said out loud.

          safeUrl allows https, http and a site-relative path, and refuses
          everything else including data: URIs. Without this line, typing one of
          those puts a value in the field, shows a thumbnail in the properties pane
          because the browser will happily load it, and renders "Choose an image" on
          the page. Somebody would reasonably conclude the picture was broken rather
          than the address.
        */}
        {value && !safeUrl(value) && (
          <p className="mp-url__warn">
            That address will not render. Images need to start with{' '}
            <code>https://</code>, or be a path on this site.
          </p>
        )}
      </div>

      {picking && (
        <MediaPicker
          currentUrl={value || undefined}
          onChoose={choose}
          onClose={() => setPicking(false)}
        />
      )}
    </>
  );
}
