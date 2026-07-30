'use client';

/**
 * The formatting toolbar for rich text: floating, draggable, and only the
 * commands that survive being saved.
 *
 * WHY IT FLOATS
 *
 * It was a row of buttons inside the properties pane, which is 320px wide. Seven
 * controls barely fitted and there was no room for the one people actually miss,
 * which is a link. Floating it puts the controls near the words being edited and
 * takes the width constraint away. Andy asked for this on 30 Jul 2026 and for it
 * to be draggable, because a toolbar that covers the thing you are editing is
 * worse than no toolbar.
 *
 * WHAT IS DELIBERATELY NOT HERE, AND IT IS NOT AN OVERSIGHT
 *
 * Andy's reference had text colour, a font picker and a size picker. All three
 * would be a lie in this product. lib/content/sanitise.ts allows no `style`
 * attribute on anything in rich text, so a colour or a size set here would look
 * right until the page was saved and then quietly vanish. Font and size belong on
 * the Theme screen, where they are set once for the whole site rather than per
 * paragraph, which is the thing that keeps a site looking like one site.
 * Alignment is a property of the block and lives in the properties pane.
 *
 * A button that appears to work and does not is worse than no button, so the ones
 * that cannot work are absent rather than disabled.
 *
 * WHAT IS HERE: bold, italic, underline, strikethrough, a link, both lists, the
 * block format, quote and clear. Every one of them maps to a tag the sanitiser
 * keeps.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { safeUrl } from '../../lib/content/sanitise';
import { Icon, type IconName } from './Icon';

/** Where the toolbar was left, so it stays put between blocks and sessions. */
const POSITION_KEY = 'tg-sites:text-toolbar';

/*
 * Only for the FIRST position, before the toolbar has been measured. Everything
 * after that clamps against the element's real box, because the toolbar changes
 * width: opening the link panel adds an input and two buttons, about 250px, and
 * a toolbar sitting near the right edge pushed its Apply button off the screen
 * where nobody could click it. Found by a browser check rather than by looking.
 */
const WIDTH_GUESS = 460;
const HEIGHT_GUESS = 44;

interface Command {
  command: string;
  value?: string;
  icon: IconName;
  title: string;
  /** The execCommand state name, when it differs from the command. */
  state?: string;
}

const INLINE: readonly Command[] = [
  { command: 'bold', icon: 'bold', title: 'Bold' },
  { command: 'italic', icon: 'italic', title: 'Italic' },
  { command: 'underline', icon: 'underline', title: 'Underline' },
  { command: 'strikeThrough', icon: 'strikethrough', title: 'Strikethrough' },
];

const LISTS: readonly Command[] = [
  { command: 'insertUnorderedList', icon: 'list', title: 'Bulleted list' },
  { command: 'insertOrderedList', icon: 'list-ordered', title: 'Numbered list' },
];

/**
 * The block formats, as a select rather than four buttons.
 *
 * No H1. The page title owns the single h1, the same rule the heading block
 * follows, and the sanitiser drops an h1 anyway.
 */
const BLOCKS: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'p', label: 'Paragraph' },
  { value: 'h2', label: 'Heading 2' },
  { value: 'h3', label: 'Heading 3' },
  { value: 'h4', label: 'Heading 4' },
  { value: 'blockquote', label: 'Quote' },
];

interface Point {
  x: number;
  y: number;
}

function readStored(): Point | null {
  try {
    const raw = window.localStorage.getItem(POSITION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Point>;
    if (typeof parsed?.x !== 'number' || typeof parsed?.y !== 'number') return null;
    return { x: parsed.x, y: parsed.y };
  } catch {
    // A quota error, private browsing, or somebody's hand-edited value. None of
    // them are worth failing an editor over.
    return null;
  }
}

/**
 * Keep a point on screen.
 *
 * A stored position survives a window resize and a move to a smaller monitor, and
 * a toolbar parked at x 1800 on a 1280px screen is a toolbar nobody can reach.
 * Clamped on every render rather than only on drag, because the resize is the
 * case that has no drag to hang it off.
 */
function clamp(point: Point, size?: { width: number; height: number }): Point {
  const width = size?.width ?? WIDTH_GUESS;
  const height = size?.height ?? HEIGHT_GUESS;
  const maxX = Math.max(8, window.innerWidth - width - 8);
  const maxY = Math.max(8, window.innerHeight - height - 8);
  return {
    x: Math.min(Math.max(8, point.x), maxX),
    y: Math.min(Math.max(8, point.y), maxY),
  };
}

export function TextToolbar({
  anchor,
  onExec,
}: {
  /** The element being edited, so the toolbar can sit above it before it is moved. */
  anchor: HTMLElement | null;
  onExec: (command: string, value?: string) => void;
}) {
  const [position, setPosition] = useState<Point | null>(null);
  const [linking, setLinking] = useState(false);
  const [href, setHref] = useState('');
  const [, setTick] = useState(0);

  const drag = useRef<{ dx: number; dy: number } | null>(null);
  const linkInput = useRef<HTMLInputElement>(null);
  const el = useRef<HTMLDivElement>(null);
  /** The selection to put the link on, saved before the input steals it. */
  const savedRange = useRef<Range | null>(null);

  /** The toolbar's real box, or undefined before it has one. */
  const size = () => {
    const box = el.current?.getBoundingClientRect();
    return box ? { width: box.width, height: box.height } : undefined;
  };

  /*
   * The starting position: above the field, or wherever it was last left.
   *
   * Read once, on mount, because after that the toolbar's position is the
   * toolbar's business. Re-deriving it from the anchor on every render would
   * yank it back to the field the moment somebody dragged it away.
   */
  useEffect(() => {
    const stored = readStored();
    if (stored) {
      setPosition(clamp(stored));
      return;
    }

    const box = anchor?.getBoundingClientRect();
    setPosition(
      clamp(
        box
          ? { x: box.left, y: box.top - HEIGHT_GUESS - 8 }
          : { x: 24, y: 24 },
      ),
    );
    // Mount only. See above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /*
   * Repaint when the selection moves, so the pressed states are honest.
   *
   * queryCommandState is read during render rather than stored, because the
   * source of truth is the document's selection and any copy of it would be one
   * keystroke stale. This just asks React to look again.
   */
  useEffect(() => {
    const onSelect = () => setTick((n) => n + 1);
    document.addEventListener('selectionchange', onSelect);
    return () => document.removeEventListener('selectionchange', onSelect);
  }, []);

  /*
   * Re-clamped on any size change, not just on a window resize.
   *
   * The toolbar grows when the link panel opens. A ResizeObserver covers that
   * and anything added to the toolbar later, which a hand-written "when linking
   * changes" effect would not.
   */
  /*
   * Attached once the element EXISTS, not once the component mounts.
   *
   * This component returns null until it has a position, so on the first render
   * there is no div and el.current is null. Written with an empty dependency
   * list, the effect ran exactly then, bailed, and never observed anything: the
   * toolbar grew past the right edge of the screen when the link panel opened
   * and stayed there, with its Apply button unreachable. `ready` re-runs the
   * effect on the render where the div appears.
   */
  const ready = position !== null;

  useEffect(() => {
    const node = el.current;
    if (!ready || !node) return;

    const settle = () => setPosition((current) => (current ? clamp(current, size()) : current));

    const observer = new ResizeObserver(settle);
    observer.observe(node);
    window.addEventListener('resize', settle);

    return () => {
      observer.disconnect();
      window.removeEventListener('resize', settle);
    };
    // size() reads a ref, so it is stable and does not belong in here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  const onPointerMove = useCallback((event: PointerEvent) => {
    if (!drag.current) return;
    setPosition(
      clamp({ x: event.clientX - drag.current.dx, y: event.clientY - drag.current.dy }, size()),
    );
  }, []);

  const onPointerUp = useCallback(() => {
    drag.current = null;
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);

    setPosition((current) => {
      if (current) {
        try {
          window.localStorage.setItem(POSITION_KEY, JSON.stringify(current));
        } catch {
          // Remembering where it was put is a convenience, not a feature worth
          // an error message.
        }
      }
      return current;
    });
  }, [onPointerMove]);

  function startDrag(event: React.PointerEvent) {
    if (!position) return;
    // Not preventDefault here: the grip is not a formatting button and the
    // selection is not at risk, and preventing it would stop the pointer capture.
    drag.current = { dx: event.clientX - position.x, dy: event.clientY - position.y };
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
  }

  /** True when the caret sits inside this formatting. Never throws. */
  function isOn(command: string): boolean {
    try {
      return document.queryCommandState(command);
    } catch {
      return false;
    }
  }

  function currentBlock(): string {
    try {
      const value = document.queryCommandValue('formatBlock').toLowerCase();
      return BLOCKS.some((entry) => entry.value === value) ? value : 'p';
    } catch {
      return 'p';
    }
  }

  function applyLink() {
    /*
     * Through safeUrl, the same whitelist the renderer uses.
     *
     * createLink would happily insert javascript:alert(1). The sanitiser would
     * strip it on save, so this is the second of two gates rather than the only
     * one, and it is the one that stops the editor showing a link that works in
     * the preview and vanishes on publish.
     */
    const clean = safeUrl(href.trim());
    if (!clean) {
      setHref('');
      return;
    }

    /*
     * PUT THE SELECTION BACK FIRST, and be honest about why.
     *
     * Typing in the URL input moves the document's selection into the input, so
     * by the time Apply is pressed the words the link was meant to wrap are no
     * longer selected. Measured: after filling the input the selection is
     * collapsed.
     *
     * In Chromium this turns out not to matter, because focusing a
     * contentEditable restores its last selection, and the link is applied
     * correctly with these three lines deleted. That was checked by deleting
     * them, so this is not a guess.
     *
     * They stay because that restoration is a browser behaviour rather than a
     * guarantee, and it is the kind of behaviour that differs in Safari. Three
     * lines to not depend on it is a good trade. What it is NOT is load-bearing
     * today, and a comment claiming otherwise would send somebody debugging in
     * the wrong place.
     */
    const range = savedRange.current;
    if (range) {
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    }

    onExec('createLink', clean);
    setLinking(false);
    setHref('');
    savedRange.current = null;
  }

  /** Remember what is selected, before anything can take it away. */
  function rememberSelection() {
    const selection = window.getSelection();
    savedRange.current =
      selection && selection.rangeCount > 0 ? selection.getRangeAt(0).cloneRange() : null;
  }

  if (!position) return null;

  return (
    <div
      ref={el}
      className="ed-tt"
      style={{ left: position.x, top: position.y }}
      role="toolbar"
      aria-label="Text formatting"
      /*
       * The whole toolbar refuses mousedown, which is what keeps the caret and
       * the selection in the field behind it. Without this, clicking Bold blurs
       * the editable, the selection collapses, and the command applies to
       * nothing. The link input re-enables it for itself.
       */
      onMouseDown={(event) => event.preventDefault()}
    >
      <button
        type="button"
        className="ed-tt__grip"
        aria-label="Move the toolbar"
        title="Drag to move"
        onPointerDown={startDrag}
      >
        <Icon name="grip" size={14} />
      </button>

      <select
        className="ed-tt__block"
        value={currentBlock()}
        aria-label="Text style"
        onMouseDown={(event) => event.stopPropagation()}
        onChange={(event) => onExec('formatBlock', event.target.value)}
      >
        {BLOCKS.map((entry) => (
          <option key={entry.value} value={entry.value}>
            {entry.label}
          </option>
        ))}
      </select>

      <span className="ed-tt__rule" aria-hidden="true" />

      {INLINE.map((item) => (
        <button
          key={item.command}
          type="button"
          className="ed-tt__btn"
          title={item.title}
          aria-label={item.title}
          aria-pressed={isOn(item.state ?? item.command)}
          onClick={() => onExec(item.command, item.value)}
        >
          <Icon name={item.icon} size={16} />
        </button>
      ))}

      <span className="ed-tt__rule" aria-hidden="true" />

      <button
        type="button"
        className="ed-tt__btn"
        title="Add a link"
        aria-label="Add a link"
        aria-pressed={linking}
        onClick={() => {
          rememberSelection();
          setLinking((open) => !open);
          // Focused after the input exists. Focus in a render path is the bug
          // this codebase has a rule about; this is a click, which is the
          // exception that rule names.
          window.setTimeout(() => linkInput.current?.focus(), 0);
        }}
      >
        <Icon name="link" size={16} />
      </button>

      {LISTS.map((item) => (
        <button
          key={item.command}
          type="button"
          className="ed-tt__btn"
          title={item.title}
          aria-label={item.title}
          aria-pressed={isOn(item.command)}
          onClick={() => onExec(item.command)}
        >
          <Icon name={item.icon} size={16} />
        </button>
      ))}

      <span className="ed-tt__rule" aria-hidden="true" />

      <button
        type="button"
        className="ed-tt__btn"
        title="Clear formatting"
        aria-label="Clear formatting"
        onClick={() => onExec('removeFormat')}
      >
        <Icon name="clear-format" size={16} />
      </button>

      {linking && (
        <div className="ed-tt__link" onMouseDown={(event) => event.stopPropagation()}>
          <input
            ref={linkInput}
            className="ed-tt__url"
            type="text"
            inputMode="url"
            placeholder="https://"
            value={href}
            aria-label="Web address"
            onChange={(event) => setHref(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                applyLink();
              }
              if (event.key === 'Escape') {
                event.preventDefault();
                setLinking(false);
                setHref('');
              }
            }}
          />
          <button type="button" className="ed-tt__btn" aria-label="Apply the link" onClick={applyLink}>
            <Icon name="check" size={16} />
          </button>
          <button
            type="button"
            className="ed-tt__btn"
            aria-label="Remove the link"
            title="Remove the link"
            onClick={() => {
              onExec('unlink');
              setLinking(false);
              setHref('');
            }}
          >
            <Icon name="close" size={16} />
          </button>
        </div>
      )}
    </div>
  );
}
