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

import { useEffect, useRef } from 'react';
import type { Field } from '../../lib/content/blocks';
import { ImageField } from '../media/ImageField';
import { Icon } from './Icon';

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
}

export function FieldRenderer({ field, value, onChange, ownerId, onPatch }: FieldProps) {
  switch (field.kind) {
    case 'text':
    case 'url':
      return (
        <Wrapper field={field}>
          <input
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

    case 'textarea':
      return (
        <Wrapper field={field}>
          <textarea
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
        <Wrapper field={field}>
          <RichText key={`${ownerId}:${field.key}`} html={asString(value)} onChange={onChange} />
        </Wrapper>
      );

    case 'image':
      return (
        <Wrapper field={field}>
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
          />
        </Wrapper>
      );

    case 'select': {
      const current = asString(value) || field.options[0]?.value;
      // Four or fewer reads better as segmented buttons than a dropdown.
      if (field.options.length <= 4) {
        return (
          <Wrapper field={field}>
            <div className="ed-segmented" role="group" aria-label={field.label}>
              {field.options.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={current === option.value}
                  onClick={() => onChange(option.value)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </Wrapper>
        );
      }
      return (
        <Wrapper field={field}>
          <select
            className="ed-select"
            value={current}
            onChange={(event) => onChange(event.target.value)}
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
        <Wrapper field={field}>
          <input
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

function Wrapper({ field, children }: { field: Field; children: React.ReactNode }) {
  return (
    <div className="ed-field">
      <label className="ed-label">{field.label}</label>
      {children}
      {'help' in field && field.help && <p className="ed-help">{field.help}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Repeater
// ---------------------------------------------------------------------------

function Repeater({ field, value, onChange, ownerId }: FieldProps) {
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
    <div className="ed-field">
      <label className="ed-label">{field.label}</label>

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

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}
