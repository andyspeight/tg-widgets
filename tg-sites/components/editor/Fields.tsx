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

import { useEffect, useRef, useState } from 'react';
import type { Field } from '../../lib/content/blocks';
import { TextToolbar } from './TextToolbar';
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
 * A deliberately small rich text field.
 *
 * Uncontrolled: the DOM owns the content while the field is mounted and we
 * read it out on input. React never writes back mid-edit, which is what
 * keeps the caret where the agent put it. The value is only pushed in when
 * the field mounts, and the parent remounts it (via key) when the selected
 * block changes.
 *
 * execCommand is deprecated but still implemented everywhere and is by far
 * the smallest thing that works. When this needs to grow, replace it with a
 * proper editor behind the same props rather than extending it.
 *
 * THE TOOLBAR IS NO LONGER IN HERE. It floats, it is draggable, and it only
 * appears while this field has focus: see components/editor/TextToolbar.tsx for
 * why, and for what is deliberately missing from it.
 */
function RichText({ html, onChange }: { html: string; onChange: (value: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);

  /*
   * OPEN AS SOON AS THE FIELD EXISTS, not once it has been clicked into.
   *
   * This was false until focus, and Andy could not find the toolbar at all. He
   * was right not to: this field lives in a 320px pane on the right, only the
   * `text` block type has one, and selecting a block does not focus it. So the
   * toolbar for editing text appeared only after you had already found the box
   * that edits text. On the seeded page, four of the ten blocks are headings,
   * which have no rich text field and could never show it.
   *
   * The field only mounts when a text block is selected, so "it exists" and
   * "somebody is editing text" are the same statement.
   */
  const [editing, setEditing] = useState(true);

  useEffect(() => {
    const node = ref.current;
    if (node && node.innerHTML !== html) node.innerHTML = html;

    /*
     * Focused on mount, and this is the exception the rule names rather than a
     * breach of it.
     *
     * editor.css and the repo conventions forbid .focus() as part of DRAWING,
     * because the editor preview re-renders on every keystroke and a focus in
     * that path steals the caret out of the field being typed in. This is not
     * that path. This component is keyed on the block id, so it mounts exactly
     * once per block, when somebody has just clicked that block. That is a real
     * user action and a genuine step change, which is precisely when the rule
     * says moving focus is correct.
     *
     * Without it the toolbar would be on screen with nothing selected, and the
     * first press of Bold would apply to an empty caret and appear to do
     * nothing.
     */
    node?.focus();

    // Runs on mount only. The key prop remounts this for a new block, which
    // is what re-seeds the content. Deliberately not depending on `html`:
    // that would fight the caret on every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const exec = (command: string, value?: string) => {
    const node = ref.current;
    if (!node) return;
    // Focus here is a real user action (a toolbar click), not a render.
    node.focus();
    document.execCommand(command, false, value);
    onChange(node.innerHTML);
  };

  /*
   * The toolbar goes when focus leaves BOTH the field and the toolbar.
   *
   * Written first as an onBlur on the field, checking relatedTarget. That closed
   * it correctly when somebody clicked away from the field, and never when they
   * had been typing in the toolbar's link box: focus was in the input by then,
   * so the field's blur had already happened and nothing was listening for the
   * second departure. The toolbar stayed on screen over a field nobody was
   * editing.
   *
   * A document listener asks the only question that matters, which is where
   * focus IS, rather than trying to infer it from where it went next.
   */
  useEffect(() => {
    if (!editing) return;

    let pending = 0;

    /*
     * CHECKED ON THE NEXT TICK, and that is the whole trick.
     *
     * During focusout the new element has not been focused yet, so
     * document.activeElement is usually document.body. Asking then says "focus
     * is nowhere" every single time, which closed the toolbar the instant the
     * link input tried to take focus, and the input vanished from under the
     * cursor. A tick later activeElement is where focus actually went.
     */
    const settle = () => {
      window.clearTimeout(pending);
      pending = window.setTimeout(() => {
        const active = document.activeElement;
        const inField = !!ref.current && (active === ref.current || ref.current.contains(active));
        const inToolbar = !!active?.closest?.('.ed-tt');
        if (!inField && !inToolbar) setEditing(false);
      }, 0);
    };

    // focusout bubbles where blur does not, so one listener covers the field,
    // the toolbar and anything either of them grows later.
    document.addEventListener('focusout', settle);
    return () => {
      window.clearTimeout(pending);
      document.removeEventListener('focusout', settle);
    };
  }, [editing]);

  return (
    <>
      {editing && <TextToolbar anchor={ref.current} onExec={exec} />}
      <div
        ref={ref}
        className="ed-rt"
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        aria-label="Content"
        onFocus={() => setEditing(true)}
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
    </>
  );
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}
