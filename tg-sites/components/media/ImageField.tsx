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
import { ImageEditor, type ImageEdit } from './ImageEditor';
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
  /**
   * The picture's current focus point and adjustments, when this control is
   * standing in front of a picture that HAS them: the image block, a section
   * background and a gallery tile all do, since each is drawn as an img this
   * product controls and can crop.
   *
   * The social preview image does NOT, and cannot. It is an og:image, put in a
   * meta tag and cropped by whichever site the link is shared to, so a focus
   * point or a filter stored here would never reach it. A field with no edit, or
   * with no onPatch to save one, is exactly the chooser it always was, with no
   * Edit button to promise something the picture cannot keep.
   */
  edit?: Partial<ImageEdit>;
  /**
   * Whether the editor offers the Crop tab. Only the image block sets it: a
   * section background or a gallery tile is a picture the render draws to fill
   * its own shape, so a per-picture crop has nowhere to show and would write a
   * prop those renders ignore.
   */
  canCrop?: boolean;
}

export function ImageField({ value, onChange, onPatch, altKey, urlKey, edit, canCrop }: Props) {
  const [picking, setPicking] = useState(false);
  const [editing, setEditing] = useState(false);
  const [showUrl, setShowUrl] = useState(false);

  // The editor needs somewhere to write its five numbers back, so it is offered
  // only when the caller can take a patch and has told us the block carries them.
  const canEdit = Boolean(edit && onPatch);

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

      /*
       * THE SHAPE OF THE PICTURE, RECORDED WITH IT, so the renderer can put
       * width and height on the img tag.
       *
       * That is what stops the page jumping while the picture loads: a browser
       * works the aspect ratio out from those two numbers and reserves the space
       * before a byte of the image has arrived. Without them an image left on
       * the default Original shape reserves nothing, everything below it moves
       * when it lands, and that is Cumulative Layout Shift, which is a ranking
       * factor as well as being horrible to read.
       *
       * HERE RATHER THAN AT RENDER TIME, because the block stores a URL and the
       * dimensions live on the media row. Looking them up while rendering would
       * be a database query per picture per visitor. The picker already knows
       * them, so it writes them down once.
       *
       * They ride along in the SAME patch as the address and the alt text, so
       * one undo takes the whole choice back.
       */
      if (item.width && item.height) {
        patch.width = item.width;
        patch.height = item.height;
      }

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
            {canEdit && (
              <button type="button" className="tg-btn" onClick={() => setEditing(true)}>
                Edit
              </button>
            )}
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

      {editing && canEdit && value && (
        <ImageEditor
          src={value}
          value={edit ?? {}}
          canCrop={canCrop}
          onSave={(next) => {
            setEditing(false);
            // Focus, adjustments and, where it is offered, the crop land in one
            // patch, so a focus nudge and a brightness tweak taken together undo
            // together.
            onPatch?.({ ...next });
          }}
          onClose={() => setEditing(false)}
        />
      )}
    </>
  );
}
