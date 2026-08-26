'use client';

/**
 * Field renderers for the properties pane.
 *
 * Driven entirely by the Field definitions in lib/content/blocks.ts, so a
 * new block type gets a working properties pane without touching this file.
 *
 * ONE RULE MATTERS HERE MORE THAN ANY OTHER
 * The properties pane re-renders on every keystroke. Nothing in this file
 * may call .focus(), .select() or scrollIntoView() as part of rendering.
 * That is the bug that made the widget suite's Enquiry editor need a click
 * per letter. Focus moves only on a real user action.
 *
 * The rich text field is uncontrolled for the same reason: a controlled
 * contentEditable puts the caret back at the start on every render.
 */

import { useEffect, useId, useRef, useState } from 'react';
import type { Field } from '../../lib/content/blocks';
import type { PlaceMatch } from '../../lib/content/geocode';
import { COLOUR_SWATCHES } from '../../lib/content/styles';
import { importContent, importFields } from '../../lib/content/imported';
import { FileField } from '../media/FileField';
import { ImageField } from '../media/ImageField';
import { CornerBox, type Corners } from './BoxControls';
import { IconField } from './IconField';
import { Icon } from './Icon';

/**
 * How long a label can be before a segmented button truncates it.
 *
 * Measured against the CSS rather than guessed: .ed-segmented is
 * repeat(auto-fit, minmax(56px, 1fr)) with 8px of padding a side, so a button
 * is 56 to 95px wide and the text sits at --ed-text-sm. That is about eleven
 * characters. See the note where it is used.
 */
const SEGMENTED_MAX_LABEL = 11;

interface FieldProps {
  field: Field;
  value: unknown;
  onChange: (value: unknown) => void;
  /** Stable identity of the thing being edited. Remounts uncontrolled inputs. */
  ownerId: string;
  /**
   * Set more than one prop in a single commit.
   *
   * Only the image field uses it, and only to fill an empty alt text from the
   * picture that was chosen. Optional rather than required because a field can be
   * rendered somewhere with no sibling to patch, and a required callback would mean
   * every caller inventing a no-op.
   */
  onPatch?: (patch: Record<string, unknown>) => void;
  /**
   * The rest of the block's props.
   *
   * Only the imported field reads it, and it has to: an imported design's
   * editable slots are decided by the design somebody pasted, not by the block
   * definition, so the list of them lives in a sibling prop rather than in
   * lib/content/blocks.ts like every other field's shape.
   */
  siblings?: Record<string, unknown>;
}

export function FieldRenderer({
  field,
  value,
  onChange,
  ownerId,
  onPatch,
  siblings,
}: FieldProps) {
  // One id per field instance. Used as the control's id for a single box (so the
  // label focuses it), or as the label's own id for a grouped control (so the
  // group names itself by it). See Wrapper.
  const id = useId();

  switch (field.kind) {
    case 'text':
    case 'url':
      return (
        <Wrapper field={field} htmlFor={id}>
          <input
            id={id}
            className="ed-input"
            type={field.kind === 'url' ? 'text' : 'text'}
            inputMode={field.kind === 'url' ? 'url' : undefined}
            value={asString(value)}
            maxLength={'max' in field ? field.max : undefined}
            placeholder={'placeholder' in field ? field.placeholder : undefined}
            onChange={(event) => onChange(event.target.value)}
          />
        </Wrapper>
      );

    case 'place':
      return (
        <Wrapper field={field} htmlFor={id}>
          <PlaceField
            /* Remounts when a different block is selected, so the box shows that
               block's address rather than the last one's. */
            key={`${ownerId}:${field.key}`}
            id={id}
            value={asString(value)}
            max={'max' in field ? field.max : undefined}
            placeholder={'placeholder' in field ? field.placeholder : undefined}
            onChange={onChange}
          />
        </Wrapper>
      );

    case 'textarea':
      return (
        <Wrapper field={field} htmlFor={id}>
          <textarea
            id={id}
            className="ed-textarea"
            data-mono={field.key === 'html' ? 'true' : undefined}
            rows={field.rows ?? 4}
            maxLength={field.max}
            value={asString(value)}
            onChange={(event) => onChange(event.target.value)}
          />
        </Wrapper>
      );

    case 'richtext':
      return (
        <Wrapper field={field} labelId={id} group>
          <RichText key={`${ownerId}:${field.key}`} html={asString(value)} onChange={onChange} />
        </Wrapper>
      );

    case 'image':
      return (
        <Wrapper field={field} labelId={id} group>
          {/*
            onPatch and the two key names are passed through so that choosing a
            picture which already has a description fills the alt field beside it,
            in ONE commit. Two commits would give the undo history two steps for one
            action, so undoing the choice would leave the description behind.

            altKey is 'alt' by convention: it is the key the image block and every
            gallery item use. A block whose alt field is called something else gets
            the picker and no alt filling, which is the right way round for a
            convention to fail.
          */}
          <ImageField
            value={asString(value)}
            onChange={onChange}
            onPatch={onPatch}
            urlKey={field.key}
            altKey="alt"
            /*
              The focus point and the adjustments, read off the block's own props
              and handed to the editor, but ONLY on the field that owns them. The
              image block's src field carries `focus`; a gallery tile's or a
              logo's does not, so those keep the plain chooser and no misleading
              Edit button. The crop is narrower still, on the image block alone,
              so a section background and a gallery tile keep the focus tools
              without a Crop tab that would have nowhere to show its result.
            */
            canCrop={field.focus ? field.crop : undefined}
            edit={
              field.focus
                ? {
                    focusX: numFrom(siblings?.focusX, 50),
                    focusY: numFrom(siblings?.focusY, 50),
                    brightness: numFrom(siblings?.brightness, 100),
                    contrast: numFrom(siblings?.contrast, 100),
                    saturation: numFrom(siblings?.saturation, 100),
                    ...(field.crop ? { crop: cropFrom(siblings?.crop) } : {}),
                  }
                : undefined
            }
          />
        </Wrapper>
      );

    case 'file':
      /*
       * A FILE FIELD CANNOT WORK WITHOUT onPatch, so it says so rather than
       * half-working. It writes four props at once — address, name, size, format
       * — and a caller that can only take one would give the page a download with
       * no name and no size on it, which looks like a bug on a live site rather
       * than a missing prop in an editor.
       *
       * Both callers today pass one; this is here so the next one finds out at a
       * glance instead of by looking at a published page.
       */
      if (!onPatch) {
        return (
          <Wrapper field={field} labelId={id} group>
            <p className="ed-help">This field needs a container that can save several values at once.</p>
          </Wrapper>
        );
      }
      return (
        <Wrapper field={field} labelId={id} group>
          {/*
            FOUR PROPS IN ONE PATCH: the address, the original filename, the size
            and the format. They are written at the moment of choosing rather than
            looked up at render time, for the same reason the picture field copies
            a photograph's dimensions — the block stores a URL and the rest lives
            on the media row, so reading them while rendering would be a database
            query per file per visitor.

            One patch, so a single undo takes the whole choice back.
          */}
          <FileField
            value={asString(value)}
            onPatch={onPatch}
            urlKey={field.key}
            nameKey={field.nameKey}
            sizeKey={field.sizeKey}
            formatKey={field.formatKey}
            current={{
              name: asString(siblings?.[field.nameKey]),
              size: numFrom(siblings?.[field.sizeKey], 0),
              format: asString(siblings?.[field.formatKey]),
            }}
          />
        </Wrapper>
      );

    case 'icon':
      return (
        <Wrapper field={field} labelId={id} group>
          <IconField value={asString(value)} onChange={onChange} />
        </Wrapper>
      );

    case 'colour':
      return (
        <Wrapper field={field} labelId={id} group>
          <ColourField value={asString(value)} onChange={onChange} />
        </Wrapper>
      );

    case 'corners':
      return (
        <Wrapper field={field} labelId={id} group>
          <CornerBox
            value={value && typeof value === 'object' ? (value as Partial<Corners>) : undefined}
            onChange={onChange}
          />
        </Wrapper>
      );

    case 'select': {
      const current = asString(value) || field.options[0]?.value;
      /*
       * A HEADING'S STYLE FOLLOWS ITS LEVEL, until the client parts them.
       *
       * Level is the tag and Style is the size, and a client who has never
       * touched Style has expressed no opinion about the size: they picked
       * "Heading 3" and expect heading-3 text. So while the two AGREE, changing
       * one changes both, in one patch (one undo). The moment somebody chooses
       * a different Style, they disagree, this stops firing, and the split the
       * two fields exist for (an h2 tag at h1 scale) behaves as before. Same
       * onPatch arrangement the image field uses to fill an empty alt.
       *
       * Guarded on the pair actually matching, so only the heading (the one
       * block with a level/style pair) is affected. Without this, Coastwise
       * shipped seventeen pages of h1 banners rendering at h3 size before
       * anyone noticed (22 Aug 2026).
       */
      const pick = (next: string) => {
        if (field.key === 'level' && onPatch && siblings && siblings.style === current) {
          onPatch({ level: next, style: next });
          return;
        }
        onChange(next);
      };
      /*
       * Segmented buttons when the labels FIT, a dropdown when they do not.
       *
       * The rule used to be the count alone, four or fewer, which is right for
       * Left / Centre / Right and wrong the moment the labels are words. The
       * buttons are a grid of repeat(auto-fit, minmax(56px, 1fr)) with
       * text-overflow: ellipsis, so they WRAP rather than shrink: the width per
       * button stays around 56 to 95px whatever the count, which is roughly
       * eleven characters at this font size. Anything longer silently truncated.
       *
       * Andy, 26 Aug 2026, on a new four-option control: "make it a dropdown, as
       * you can't read them as they are all truncated at the moment". He is
       * right, and it was never only that control: twenty-one of the sixty-nine
       * short selects in the block catalogue were truncating, including
       * "Separated by bullets | Coloured pills | Coloured pills, a different
       * colour each". A dropdown shows a long label in full and costs a click
       * that a truncated button never earns back.
       */
      const fits = field.options.every((option) => option.label.length <= SEGMENTED_MAX_LABEL);
      if (field.options.length <= 4 && fits) {
        return (
          // The segmented group names ITSELF with aria-label, not the visible
          // label above it. That was already a real accessible name, so this is
          // not the bare-label case, and it is the name the browser suite finds a
          // segmented control by. Do not swap it for aria-labelledby.
          <Wrapper field={field}>
            <div className="ed-segmented" role="group" aria-label={field.label}>
              {field.options.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={current === option.value}
                  onClick={() => pick(option.value)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </Wrapper>
        );
      }
      return (
        <Wrapper field={field} htmlFor={id}>
          <select
            id={id}
            className="ed-select"
            value={current}
            onChange={(event) => pick(event.target.value)}
          >
            {field.options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </Wrapper>
      );
    }

    case 'toggle':
      return (
        <div className="ed-field">
          <label className="ed-toggle">
            <input
              type="checkbox"
              checked={value === true}
              onChange={(event) => onChange(event.target.checked)}
            />
            <span>{field.label}</span>
          </label>
          {field.help && <p className="ed-help">{field.help}</p>}
        </div>
      );

    case 'number':
      return (
        <Wrapper field={field} htmlFor={id}>
          <input
            id={id}
            className="ed-input"
            type="number"
            min={field.min}
            max={field.max}
            step={field.step ?? 1}
            value={typeof value === 'number' ? value : ''}
            onChange={(event) => {
              const next = Number(event.target.value);
              onChange(Number.isFinite(next) ? next : 0);
            }}
            /*
              THE CLAMP IS HERE, NOT IN min AND max. Those two are advisory: the
              browser marks the field invalid and hands the value over anyway, so
              typing 900 into a box that says 1 to 60 puts 900 in the block. The
              renderer clamps it again on the way out, which meant the field said
              900 while the canvas beside it drew 60, and the one thing to avoid
              is showing somebody a number the product has quietly overruled.

              On blur rather than on change, or 6 could never be typed in a box
              whose minimum is 10: the 6 would be corrected before the 0 arrived.
              Same rule as the spacing controls in BoxControls.
            */
            onBlur={(event) => {
              const next = Number(event.target.value);
              if (!Number.isFinite(next)) return;

              const low = typeof field.min === 'number' ? Math.max(next, field.min) : next;
              const capped = typeof field.max === 'number' ? Math.min(low, field.max) : low;
              if (capped !== next) onChange(capped);
            }}
          />
        </Wrapper>
      );

    /*
     * The words and the pictures of an imported design.
     *
     * DRAWN FROM THE BLOCK'S OWN SLOTS, in the order the design used them, so
     * the fields read down the pane roughly as the section reads down the page.
     *
     * A SLOT NEVER EDITED SHOWS THE DESIGN'S WORDS AS A PLACEHOLDER, not as a
     * value. Two reasons, and the second is the one that matters. Typing over a
     * placeholder is one click rather than select-all-then-type. And an
     * untouched slot stays genuinely untouched in the stored content, so a
     * design re-imported later still picks up its own new wording instead of
     * being overwritten by a copy of the old one that nobody ever chose.
     */
    case 'imported': {
      const slots = importFields(siblings ?? {});
      const stored = importContent(siblings ?? {});

      if (!slots.length) {
        return (
          <p className="ed-help">
            This design has no words or pictures we could make editable. Its
            layout and styling are still yours to move and delete.
          </p>
        );
      }

      return (
        <div className="ed-slots">
          {slots.map((slot) => (
            <label className="ed-field" key={slot.key}>
              <span className="ed-label">{slot.label}</span>
              {slot.kind === 'image' ? (
                <ImageField
                  value={stored[slot.key] ?? slot.value}
                  onChange={(next) => onChange({ ...stored, [slot.key]: next })}
                />
              ) : (
                <input
                  className="ed-input"
                  type="text"
                  value={stored[slot.key] ?? ''}
                  placeholder={slot.value}
                  inputMode={slot.kind === 'link' ? 'url' : undefined}
                  onChange={(event) => onChange({ ...stored, [slot.key]: event.target.value })}
                />
              )}
            </label>
          ))}
        </div>
      );
    }

    case 'repeater':
      return (
        <Repeater field={field} value={value} onChange={onChange} ownerId={ownerId} />
      );

    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Wrapper
// ---------------------------------------------------------------------------

/**
 * The label, the control and the help line, tied together for a screen reader.
 *
 * A bare `<label>` with the control as a sibling names nothing and does not
 * focus anything on click, which is what every field here used to be. So:
 *
 *  - A single native control (a text box, a number, a dropdown) gets `htmlFor`,
 *    which both names it and focuses it when the label is clicked.
 *  - A control that is really a GROUP (colour swatches, the corner grid, the
 *    icon picker, an image chooser, the rich text box) cannot hang off one
 *    `htmlFor`, so the `.ed-field` itself becomes the labelled group: `role`
 *    plus `aria-labelledby` pointing at the label. Nothing inside has to change,
 *    and each inner control keeps its own name.
 */
function Wrapper({
  field,
  htmlFor,
  labelId,
  group,
  children,
}: {
  field: Field;
  /** Set for a single native control, so the label focuses and names it. */
  htmlFor?: string;
  /** The label's own id, so a grouped control can name itself by it. */
  labelId?: string;
  /** Make the whole field a labelled group (for a control that is not one box). */
  group?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="ed-field" role={group ? 'group' : undefined} aria-labelledby={group ? labelId : undefined}>
      <label className="ed-label" htmlFor={htmlFor} id={labelId}>
        {field.label}
      </label>
      {children}
      {'help' in field && field.help && <p className="ed-help">{field.help}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Colour
// ---------------------------------------------------------------------------

/**
 * A colour, chosen the same way the text toolbar chooses one: the site's own
 * theme swatches, a hex box for anything the theme has not got, and a Default
 * that clears the override so the element goes back to following its section.
 *
 * WHAT IT STORES is a `var(--tgs-token)` or a `#hex`, never a free-text style
 * string, and it stores empty for Default. The renderer runs safeColour over it
 * regardless, so the field and the sanitiser cannot disagree about what is
 * allowed: both reach the same short list of colours.
 *
 * THE HEX BOX KEEPS A DRAFT of its own so half-typed "#33" is not thrown away
 * the instant it fails the pattern. Only a complete, valid hex commits; the same
 * reasoning the number field uses for its clamp-on-blur.
 */
function ColourField({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: unknown) => void;
}) {
  const isHex = /^#[0-9a-fA-F]{3}$|^#[0-9a-fA-F]{6}$/.test(value);
  const [draft, setDraft] = useState(isHex ? value : '');

  // Reflect a hex set from elsewhere (a preset, an undo) into the box.
  useEffect(() => {
    if (isHex) setDraft(value);
  }, [isHex, value]);

  return (
    <div className="ed-colour">
      <div className="ed-colour__row">
        <button
          type="button"
          className="ed-colour__chip"
          data-clear="true"
          aria-pressed={!value}
          title="Default, follow the section"
          aria-label="Default colour"
          onClick={() => onChange('')}
        >
          <Icon name="close" size={12} />
        </button>

        {COLOUR_SWATCHES.map((swatch) => (
          <button
            key={swatch.value}
            type="button"
            className="ed-colour__chip"
            style={{ background: swatch.value }}
            aria-pressed={value === swatch.value}
            title={swatch.label}
            aria-label={swatch.label}
            onClick={() => onChange(swatch.value)}
          />
        ))}
      </div>

      <input
        className="ed-colour__hex"
        type="text"
        value={draft}
        placeholder="#336699"
        maxLength={7}
        aria-label="A colour of your own, as a hex code"
        onChange={(event) => {
          const next = event.target.value.trim();
          setDraft(next);
          if (next === '') {
            onChange('');
            return;
          }
          if (/^#[0-9a-fA-F]{3}$|^#[0-9a-fA-F]{6}$/.test(next)) onChange(next);
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Repeater
// ---------------------------------------------------------------------------

function Repeater({ field, value, onChange, ownerId }: FieldProps) {
  const groupId = useId();
  if (field.kind !== 'repeater') return null;

  const items: Record<string, unknown>[] = Array.isArray(value)
    ? (value.filter((item) => !!item && typeof item === 'object') as Record<string, unknown>[])
    : [];

  const update = (next: Record<string, unknown>[]) => onChange(next);

  const addItem = () => {
    const blank: Record<string, unknown> = {};
    for (const child of field.fields) {
      blank[child.key] = child.kind === 'toggle' ? false : '';
    }
    update([...items, blank]);
  };

  const move = (from: number, to: number) => {
    if (to < 0 || to >= items.length) return;
    const next = [...items];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    update(next);
  };

  const atMax = typeof field.max === 'number' && items.length >= field.max;

  return (
    <div className="ed-field" role="group" aria-labelledby={groupId}>
      <label className="ed-label" id={groupId}>{field.label}</label>

      {items.map((item, index) => (
        <div className="ed-repeat-item" key={index}>
          <div className="ed-repeat-head">
            <span>{`${field.itemLabel} ${index + 1}`}</span>
            <span className="ed-repeat-tools">
              <button
                type="button"
                className="ed-btn" data-variant="ghost" data-icon="true"
                onClick={() => move(index, index - 1)}
                disabled={index === 0}
                aria-label={`Move ${field.itemLabel} ${index + 1} up`}
              >
                <Icon name="arrow-up" size={16} />
              </button>
              <button
                type="button"
                className="ed-btn" data-variant="ghost" data-icon="true"
                onClick={() => move(index, index + 1)}
                disabled={index === items.length - 1}
                aria-label={`Move ${field.itemLabel} ${index + 1} down`}
              >
                <Icon name="arrow-down" size={16} />
              </button>
              <button
                type="button"
                className="ed-btn"
                data-variant="danger"
                data-icon="true"
                onClick={() => update(items.filter((_, i) => i !== index))}
                aria-label={`Remove ${field.itemLabel} ${index + 1}`}
              >
                <Icon name="trash" size={16} />
              </button>
            </span>
          </div>

          {field.fields.map((child) => (
            <FieldRenderer
              key={child.key}
              field={child}
              value={item[child.key]}
              ownerId={`${ownerId}:${field.key}:${index}`}
              /*
               * The rest of THIS item's props, so a field that reads its
               * siblings gets the row it lives in and not the block. A gallery
               * tile's image field is the one that needs it: its focus point and
               * adjustments live beside it on the same item, and without this the
               * editor would open at the default every time however the tile was
               * already set.
               */
              siblings={item}
              onChange={(childValue) =>
                update(
                  items.map((existing, i) =>
                    i === index ? { ...existing, [child.key]: childValue } : existing,
                  ),
                )
              }
              /*
               * So a gallery item gets the same behaviour as a standalone image
               * block: choosing a picture that already has a description fills the
               * alt field of THAT item, not of the first one. Spreading the patch
               * over the matching item is what keeps that true.
               */
              onPatch={(patch) =>
                update(
                  items.map((existing, i) => (i === index ? { ...existing, ...patch } : existing)),
                )
              }
            />
          ))}
        </div>
      ))}

      <button type="button" className="ed-btn" onClick={addItem} disabled={atMax}>
        + Add {field.itemLabel.toLowerCase()}
      </button>
      {atMax && <p className="ed-help">Maximum of {field.max} reached.</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Rich text
// ---------------------------------------------------------------------------

/**
 * The rich text field in the properties pane. THE SECOND WAY IN.
 *
 * The words are edited on the canvas now, in place. This stays because some
 * people reach for a pane, and because a keyboard-only route to the content
 * that does not depend on selecting text inside a preview is worth keeping.
 *
 * Half-controlled, on purpose:
 *
 *  - While this field has focus, the DOM owns the content and React never
 *    writes into it. That is what keeps the caret where the agent put it. A
 *    controlled contentEditable throws the caret to the start on every letter.
 *  - While it does NOT have focus, any change to `html` came from somewhere
 *    else (the canvas), so take it. Without that this field seeded once and
 *    went stale, and the next keystroke in it would commit the stale content
 *    it was still showing, wiping whatever had been typed on the canvas.
 *
 * execCommand is deprecated but still implemented everywhere and is by far
 * the smallest thing that works. When this needs to grow, replace it with a
 * proper editor behind the same props rather than extending it.
 *
 * NO TOOLBAR IN HERE. It formats what is selected on the CANVAS, and it is
 * mounted by EditorShell for as long as a text block is being edited there. A
 * toolbar hanging off this field could only ever format this field, which is
 * the bug Andy hit: he selected the words he could see, which moved focus out
 * of here, and the toolbar went with it.
 *
 * NO focus() ON MOUNT either. The canvas takes focus when a text block is
 * selected, because that is where the words are. Two fields both grabbing
 * focus on the same commit is a race decided by effect order.
 */
function RichText({ html, onChange }: { html: string; onChange: (value: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    // Typing in here? Leave it alone. Anything else? Catch up.
    if (document.activeElement === node) return;
    if (node.innerHTML !== html) node.innerHTML = html;
  }, [html]);

  return (
    <div
      ref={ref}
      className="ed-rt"
      contentEditable
      suppressContentEditableWarning
      role="textbox"
      aria-multiline="true"
      aria-label="Content"
      onInput={(event) => onChange(event.currentTarget.innerHTML)}
      onBlur={(event) => onChange(event.currentTarget.innerHTML)}
      onPaste={(event) => {
        // Paste as plain text. Pasting from Word otherwise drags in a
        // paragraph of inline styles that the sanitiser then strips,
        // which looks to the agent like the paste silently failed.
        event.preventDefault();
        const text = event.clipboardData.getData('text/plain');
        document.execCommand('insertText', false, text);
      }}
    />
  );
}

/**
 * The address field for the map: type, see the matches, pick one.
 *
 * It keeps what is being typed in local state and writes to the block only when
 * a match is picked, or on blur, or on Enter, NEVER on every keystroke. That is
 * the whole trick that lets the map be live on the canvas: the frame draws from
 * the committed address, so committing per letter would reload it on every one,
 * the very thing the block used to dodge by drawing a placeholder instead.
 *
 * Suggestions come from our own /api/place-search (see lib/content/geocode.ts),
 * debounced, and fail quiet: no answer just means no menu, and the address can
 * always be typed in full. Nothing here focuses or scrolls on render (see the
 * file header); a match is taken on mousedown so the pick beats the input blur.
 */
function PlaceField({
  id,
  value,
  max,
  placeholder,
  onChange,
}: {
  id?: string;
  value: string;
  max?: number;
  placeholder?: string;
  onChange: (value: string) => void;
}) {
  const [query, setQuery] = useState(value);
  const [matches, setMatches] = useState<PlaceMatch[]>([]);
  const [open, setOpen] = useState(false);
  // The value we know the block holds, so a change made elsewhere (an undo) can
  // be told from one we just made, and only the former resets the box.
  const committed = useRef(value);

  useEffect(() => {
    if (value !== committed.current) {
      committed.current = value;
      setQuery(value);
      setMatches([]);
      setOpen(false);
    }
  }, [value]);

  useEffect(() => {
    const q = query.trim();
    // Too short to search, or the box already holds the committed address: no menu.
    if (q.length < 3 || q === committed.current.trim()) {
      setMatches([]);
      setOpen(false);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      fetch(`/api/place-search?q=${encodeURIComponent(q)}`, { signal: controller.signal })
        .then((response) => (response.ok ? response.json() : { matches: [] }))
        .then((data) => {
          const found: PlaceMatch[] = Array.isArray(data?.matches) ? data.matches : [];
          setMatches(found);
          setOpen(found.length > 0);
        })
        .catch(() => {
          // Aborted, offline, or a shape we did not expect: the field carries on.
        });
    }, 300);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [query]);

  const commit = (next: string) => {
    committed.current = next;
    setQuery(next);
    setMatches([]);
    setOpen(false);
    if (next !== value) onChange(next);
  };

  return (
    <div className="ed-place">
      <input
        id={id}
        className="ed-input"
        type="text"
        value={query}
        maxLength={max}
        placeholder={placeholder}
        autoComplete="off"
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        onChange={(event) => setQuery(event.target.value)}
        // Read the live value, not the closed-over query, so a commit is never a
        // render behind what is in the box.
        onBlur={(event) => commit(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            commit(event.currentTarget.value);
          } else if (event.key === 'Escape') {
            setOpen(false);
          }
        }}
      />
      {open && matches.length > 0 && (
        <ul className="ed-place__menu" role="listbox">
          {matches.map((match, index) => (
            <li key={`${match.label}:${index}`} role="option" aria-selected={false}>
              <button
                type="button"
                className="ed-place__opt"
                // mousedown, not click: it lands before the input's blur, so the
                // pick wins rather than blur committing the half-typed text.
                onMouseDown={(event) => {
                  event.preventDefault();
                  commit(match.label);
                }}
              >
                {match.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** A stored number, or the fallback when the prop is missing or not one. */
function numFrom(value: unknown, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/** The block's stored crop, or the whole picture when it has none. */
function cropFrom(value: unknown): { x: number; y: number; w: number; h: number; aspect: number } {
  const c = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  return {
    x: numFrom(c.x, 0),
    y: numFrom(c.y, 0),
    w: numFrom(c.w, 100),
    h: numFrom(c.h, 100),
    aspect: numFrom(c.aspect, 0),
  };
}
