'use client';

/**
 * A typeface chooser where every option is drawn in the typeface it names.
 *
 * WHY THIS IS NOT A <select>
 *
 * Because a native one cannot do the only thing being asked for. font-family on an
 * <option> is honoured by Firefox and by Chrome on Windows, and ignored by Safari
 * and by Chrome on macOS, which render every option in the system UI font whatever
 * the CSS says. It is not a bug to work around, it is the platform drawing the
 * list itself. So a font picker that shows each font in itself has to draw its own
 * list, and every serious one does.
 *
 * WHAT IS OWED FOR GIVING UP THE NATIVE CONTROL
 *
 * A <select> brings a lot for free and all of it has to be paid back by hand:
 *
 *   the keyboard          Up, Down, Home, End, Enter, Space, Escape, Tab
 *   type to jump          typing "pl" moves to Playfair rather than doing nothing
 *   announcement          a combobox that says what it is and what is chosen
 *   closing              clicking away, and Escape, and choosing
 *   focus                 back to the button on close, or the control is a trap
 *
 * That list is the reason this is one component used in both places rather than
 * two hand-rolled dropdowns. tools/verify-standalone.mjs drives it by keyboard.
 *
 * WHAT IT DOES NOT DO
 *
 * No portal, no floating-element library, no collision detection. The list is
 * absolutely positioned under the button inside a panel that scrolls, which is the
 * simple thing that works here; a dropdown that repositions itself against the
 * viewport is a different component and this screen does not need one.
 */

import { useEffect, useId, useRef, useState } from 'react';

import { Icon } from '../editor/Icon';

export interface FontOption {
  /** What gets reported on change. Empty string is allowed and means "inherit". */
  value: string;
  /** What the row says. */
  label: string;
  /**
   * The font-family the row is drawn in.
   *
   * Supplied by the caller rather than derived here, because only the caller knows
   * whether a name refers to a font in the library, a system stack or a preview
   * that may not have loaded yet.
   */
  stack: string;
  /** A heading above this option. Groups the list without a nested structure. */
  group?: string;
}

interface Props {
  id: string;
  value: string;
  options: FontOption[];
  onChange: (value: string) => void;
  /**
   * What the button says when nothing is chosen.
   *
   * Used by the set-all-headings control, which is an action rather than a setting
   * and so has no current value it could honestly show.
   */
  placeholder?: string;
  /** Announced with the control. Points at the visible label. */
  labelledBy?: string;
}

export function FontSelect({ id, value, options, onChange, placeholder, labelledBy }: Props) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const wrap = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const listId = useId();

  /** What the button shows. */
  const current = options.find((option) => option.value === value);

  /*
   * Typeahead state.
   *
   * A ref rather than state: it changes on every keystroke and nothing renders
   * from it, so putting it in state would re-render the whole list to store a
   * string nobody can see.
   */
  const typed = useRef({ text: '', at: 0 });

  // Opening starts on whatever is already chosen, so Down from a closed control
  // moves to the NEXT font rather than to the top of the list.
  function openList() {
    const index = options.findIndex((option) => option.value === value);
    setActive(index >= 0 ? index : 0);
    setOpen(true);
  }

  function choose(index: number) {
    const option = options[index];
    if (!option) return;
    onChange(option.value);
    setOpen(false);
    // Back to the button, because focus is inside a list that is about to be
    // removed and would otherwise land on the body.
    button.current?.focus();
  }

  /*
   * Scroll the active row into view, and ONLY on a real move.
   *
   * The rule from Fields.tsx applies here too: nothing scrolls as part of
   * rendering. This is gated on `open` and on the active index changing, so it
   * fires when somebody presses Down and not when the parent re-renders for an
   * unrelated reason. block:'nearest' so it moves the list the minimum amount and
   * never the page.
   */
  useEffect(() => {
    if (!open) return;
    const node = list.current?.children[active] as HTMLElement | undefined;
    node?.scrollIntoView({ block: 'nearest' });
  }, [open, active]);

  // Clicking anywhere else closes it. pointerdown rather than click, so a drag
  // that starts outside does not leave the list open under the cursor.
  useEffect(() => {
    if (!open) return;
    function away(event: PointerEvent) {
      if (!wrap.current?.contains(event.target as Node)) setOpen(false);
    }
    window.addEventListener('pointerdown', away);
    return () => window.removeEventListener('pointerdown', away);
  }, [open]);

  function onKeyDown(event: React.KeyboardEvent) {
    // Space is deliberately not here for the closed state: it would stop somebody
    // scrolling the panel with the keyboard while the button happens to have focus.
    if (!open) {
      if (event.key === 'ArrowDown' || event.key === 'Enter') {
        event.preventDefault();
        openList();
      }
      return;
    }

    switch (event.key) {
      case 'Escape':
        event.preventDefault();
        // stopPropagation, or a dialog containing this control closes too.
        event.stopPropagation();
        setOpen(false);
        button.current?.focus();
        return;
      case 'ArrowDown':
        event.preventDefault();
        setActive((index) => Math.min(options.length - 1, index + 1));
        return;
      case 'ArrowUp':
        event.preventDefault();
        setActive((index) => Math.max(0, index - 1));
        return;
      case 'Home':
        event.preventDefault();
        setActive(0);
        return;
      case 'End':
        event.preventDefault();
        setActive(options.length - 1);
        return;
      case 'Enter':
      case ' ':
        event.preventDefault();
        choose(active);
        return;
      case 'Tab':
        // Let Tab do its job, but close first: a list left open behind a moved
        // cursor is the most common bug in a hand-rolled combobox.
        setOpen(false);
        return;
      default:
        break;
    }

    /*
     * Type to jump.
     *
     * A second of silence starts a new search, so "p" then "l" finds Playfair while
     * "p", wait, "l" finds the first L. That is how a native select behaves and
     * getting it wrong makes a long list feel broken rather than merely different.
     *
     * Date.now() is fine here: this is a browser event handler, not a workflow
     * script, and the value never leaves the component.
     */
    if (event.key.length !== 1 || event.altKey || event.ctrlKey || event.metaKey) return;

    const now = Date.now();
    typed.current.text = now - typed.current.at > 1000 ? event.key : typed.current.text + event.key;
    typed.current.at = now;

    const needle = typed.current.text.toLowerCase();
    const found = options.findIndex((option) => option.label.toLowerCase().startsWith(needle));
    if (found >= 0) setActive(found);
  }

  return (
    <div className="fs-wrap" ref={wrap}>
      <button
        type="button"
        id={id}
        ref={button}
        className="fs-button"
        /*
         * combobox, not listbox. The button is the thing that has a value and
         * opens the list; the list is a separate listbox it controls. Putting
         * role="listbox" on the button is the usual mistake and makes a screen
         * reader announce a list that is not there.
         */
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-haspopup="listbox"
        aria-labelledby={labelledBy}
        /*
         * Focus never leaves the button while the list is open, which is the
         * pattern that keeps the keyboard handling in one place. The cost is that
         * nothing tells a screen reader which row the arrows are on unless this
         * does. Without it the control announces its value and then goes silent
         * for every keypress after.
         */
        aria-activedescendant={open ? `${listId}-${active}` : undefined}
        // The chosen typeface, in the chosen typeface. This much a native select
        // does honour, and it was already the case before this component existed.
        style={{ fontFamily: current?.stack }}
        onClick={() => (open ? setOpen(false) : openList())}
        onKeyDown={onKeyDown}
      >
        <span className="fs-button__label">{current?.label ?? placeholder ?? 'Choose'}</span>
        <Icon name="chevron-down" size={16} />
      </button>

      {open && (
        <ul className="fs-list" id={listId} role="listbox" ref={list} tabIndex={-1}>
          {options.map((option, index) => (
            /*
              presentation on the li, so the accessibility tree is listbox then
              option with nothing in between. The element is still here because
              a group heading has to live somewhere and one li per option is
              what lets the arrow-key index address children directly.
            */
            <li key={`${option.group ?? ''}:${option.value}`} role="presentation">
              {/*
                The group heading rides with its first option rather than being a
                sibling, so the list children stay one per option and the index
                arithmetic above needs no offsets to skip headings.
              */}
              {option.group && option.group !== options[index - 1]?.group && (
                <span className="fs-group" role="presentation">
                  {option.group}
                </span>
              )}
              <span
                className="fs-option"
                id={`${listId}-${index}`}
                role="option"
                aria-selected={option.value === value}
                data-active={index === active}
                style={{ fontFamily: option.stack }}
                /*
                 * mousemove, not mouseenter. A list that scrolled under a
                 * stationary cursor would otherwise not update the active row, so
                 * the highlight and the pointer disagree until it moves.
                 */
                onMouseMove={() => setActive(index)}
                onClick={() => choose(index)}
              >
                {option.label}
                {option.value === value && <Icon name="check" size={14} />}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
