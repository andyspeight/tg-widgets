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
import { Icon } from './Icon';

interface FieldProps {
  field: Field;
  value: unknown;
  onChange: (value: unknown) => void;
  /** Stable identity of the thing being edited. Remounts uncontrolled inputs. */
  ownerId: string;
}

export function FieldRenderer({ field, value, onChange, ownerId }: FieldProps) {
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
          <input
            className="ed-input"
            type="text"
            inputMode="url"
            placeholder="https://images.example.com/photo.jpg"
            value={asString(value)}
            onChange={(event) => onChange(event.target.value)}
          />
          <p className="ed-help">
            Paste an image URL for now. The media library with upload, alt text and
            automatic responsive sizes arrives in a later package.
          </p>
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

const RT_COMMANDS: Array<{ command: string; label: string; title: string; value?: string }> = [
  { command: 'bold', label: 'B', title: 'Bold' },
  { command: 'italic', label: 'I', title: 'Italic' },
  { command: 'insertUnorderedList', label: '•', title: 'Bulleted list' },
  { command: 'insertOrderedList', label: '1.', title: 'Numbered list' },
  { command: 'formatBlock', value: 'h3', label: 'H', title: 'Heading' },
  { command: 'formatBlock', value: 'p', label: '¶', title: 'Paragraph' },
  { command: 'removeFormat', label: '⨯', title: 'Clear formatting' },
];

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
 */
function RichText({ html, onChange }: { html: string; onChange: (value: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = ref.current;
    if (node && node.innerHTML !== html) node.innerHTML = html;
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

  return (
    <>
      <div className="ed-rt-toolbar">
        {RT_COMMANDS.map((item) => (
          <button
            key={`${item.command}-${item.value ?? ''}`}
            type="button"
            title={item.title}
            aria-label={item.title}
            onMouseDown={(event) => event.preventDefault()} // keep the selection
            onClick={() => exec(item.command, item.value)}
          >
            {item.label}
          </button>
        ))}
      </div>
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
    </>
  );
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}
