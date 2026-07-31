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
 * COLOUR, SIZE AND FONT ARE HERE NOW
 *
 * They were left out of the first version because the sanitiser dropped every
 * `style` attribute, so they would have looked like they worked and then lost
 * the formatting on save. Andy, 30 Jul 2026: "we need to overcome the problem
 * you raised with losing on saving and get a much better text toolbar". So the
 * sanitiser was opened to a closed set of properties and values, and these
 * controls produce exactly what that set allows. See lib/content/styles.ts.
 *
 * They are applied by wrapping the selection OURSELVES rather than through
 * execCommand's foreColor and friends. Two reasons. The browser reaches for the
 * old <font> tag unless coaxed, and more importantly it resolves a value before
 * storing it: asking it for the brand colour would store the hex the brand
 * happens to be today, so a client who later changed their brand would find
 * these words stayed behind. Wrapping it ourselves stores `var(--tgs-primary)`,
 * and the words follow the theme.
 *
 * WHAT IS STILL DELIBERATELY NOT HERE: a long list of font families. This site
 * carries its own fonts, chosen on the Theme screen, and offering a family it
 * has not loaded gives a different site on every visitor's screen.
 *
 * A button that appears to work and does not is worse than no button, so the
 * ones that cannot work are absent rather than disabled.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { safeUrl } from '../../lib/content/sanitise';
import {
  COLOUR_SWATCHES,
  FONT_CHOICES,
  FONT_SIZE_GROUPS,
  FONT_SIZES,
  HIGHLIGHT_SWATCHES,
} from '../../lib/content/styles';
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

/** A toolbar button that opens a tray of swatches. */
function SwatchButton({
  icon,
  title,
  open,
  onToggle,
}: {
  icon: IconName;
  title: string;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      className="ed-tt__btn"
      title={title}
      aria-label={title}
      aria-expanded={open}
      onClick={onToggle}
    >
      <Icon name={icon} size={16} />
    </button>
  );
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

/**
 * The alignments, which are a property of the BLOCK rather than of a phrase.
 *
 * `centre`, not `center`. These values are the block's own, and the block spells
 * it the way the rest of the product does. Written as `center` first, which the
 * renderer discarded as an unknown value and fell back to left, so the button
 * lit up and nothing moved.
 */
const ALIGNMENTS: ReadonlyArray<{ value: string; icon: IconName; title: string }> = [
  { value: 'left', icon: 'align-left', title: 'Align left' },
  { value: 'centre', icon: 'align-centre', title: 'Align centre' },
  { value: 'right', icon: 'align-right', title: 'Align right' },
];

/**
 * What the assistant can be asked for, as buttons.
 *
 * ONLY OFFERED WITH WORDS SELECTED, all three of them, and that is not a
 * technicality. "Make this shorter" has to know what "this" is, and the honest
 * answer with nothing highlighted is nothing. Offering them anyway and quietly
 * using the whole paragraph would be a button that sometimes rewrites more than
 * you meant, which is the worst kind.
 */
const QUICK: ReadonlyArray<{ intent: string; label: string }> = [
  { intent: 'improve', label: 'Improve it' },
  { intent: 'shorter', label: 'Make it shorter' },
  { intent: 'longer', label: 'Make it longer' },
];

/** What a request to the assistant looks like, and what comes back. */
export interface WriteRequest {
  intent: string;
  instruction: string;
  selection: string;
}

export type WriteResult =
  | { ok: true; data: { html: string; text: string } }
  | { ok: false; error: string };

export function TextToolbar({
  anchor,
  onExec,
  onStyle,
  align,
  onAlign,
  onWrite,
  oneLine = false,
}: {
  /** The element being edited, so the toolbar can sit above it before it is moved. */
  anchor: HTMLElement | null;
  onExec: (command: string, value?: string) => void;
  /**
   * Wrap what is selected in one CSS declaration.
   *
   * Separate from onExec because these do not go through execCommand at all: see
   * the note at the top of this file for why the browser is not asked.
   */
  onStyle: (property: string, value: string) => void;
  /**
   * The block's alignment, and a way to change it.
   *
   * ALIGNMENT IS NOT AN INLINE STYLE HERE. It is the block's own `align` field,
   * the same one the properties pane shows, so the two controls always agree.
   * Doing it as CSS on the selection would have given a paragraph two sources of
   * truth that could disagree, and the one you could see would depend on which
   * you touched last.
   */
  align: string;
  onAlign: (value: string) => void;
  /**
   * Ask the writing assistant for some copy.
   *
   * A PROP RATHER THAN A DIRECT CALL to the server action, for the same reason
   * every other action in this component is one: the standalone review copy
   * bundles this file and has no server behind it. The shell supplies the real
   * one and the harness supplies a double, so the panel below is exercised in
   * both. Absent means the assistant is not available, and the button is not
   * drawn at all rather than drawn and disabled.
   */
  onWrite?: (request: WriteRequest) => Promise<WriteResult>;
  /**
   * This host may hold inline markup but NOT block elements. A heading.
   *
   * Not "may this be formatted", which is true of both kinds. A heading is an
   * h2, h3 or h4, and a p, a ul or a blockquote inside one is invalid HTML that
   * no browser refuses and every browser silently restructures: the block gets
   * hoisted out and the back half of the heading goes with it.
   *
   * So the commands that would nest a block are ABSENT here rather than
   * disabled, the same rule this file follows everywhere else. Bold, italics,
   * links, colour, size, font and alignment all still work, which is the point.
   */
  oneLine?: boolean;
}) {
  const [position, setPosition] = useState<Point | null>(null);
  const [linking, setLinking] = useState(false);
  const [href, setHref] = useState('');
  /** The last address was not one we will link to. Shown, not swallowed. */
  const [refused, setRefused] = useState(false);
  /** The writing panel: open, what has been typed, and what went wrong. */
  const [asking, setAsking] = useState(false);
  const [instruction, setInstruction] = useState('');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  /**
   * The words that were highlighted when the panel was opened.
   *
   * Captured then rather than read when Write is pressed, because typing in the
   * panel's own box moves the document's selection into that box and the
   * highlight is gone by the time there is anything to send. Same problem the
   * link panel and the hex box have, and the same shape of answer.
   */
  const [selectedText, setSelectedText] = useState('');
  /** Which swatch tray is open, if any. Only ever one. */
  const [tray, setTray] = useState<'color' | 'background-color' | null>(null);
  /** A colour typed in rather than picked. Held while it is being typed. */
  const [custom, setCustom] = useState('#');
  const [, setTick] = useState(0);

  const drag = useRef<{ dx: number; dy: number } | null>(null);
  const linkInput = useRef<HTMLInputElement>(null);
  const askInput = useRef<HTMLTextAreaElement>(null);
  const el = useRef<HTMLDivElement>(null);
  /** The selection to put the link on, saved before the input steals it. */
  const savedRange = useRef<Range | null>(null);
  /**
   * The top of the block this toolbar opened above, or null.
   *
   * Null once the toolbar has been moved by hand or restored from a stored
   * position, because after that its place is its own business and re-anchoring
   * would yank it back to the words the moment it grew.
   */
  const anchorTop = useRef<number | null>(null);

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

    /*
     * ABOVE THE WORDS ON THE CANVAS, not above the field in the pane.
     *
     * The field is a box on the right-hand side; the block is the paragraph the
     * person is actually looking at. Andy asked for a toolbar that appears above
     * the text being edited and the first version put it above the field, which
     * is why he could not find it. The canvas marks the selected node with
     * .is-selected (see Canvas.tsx), so the block is findable without threading
     * the selection path through three components.
     *
     * Falls back to the field, and then to a corner, because a toolbar in the
     * wrong place beats a toolbar that does not appear.
     */
    const onCanvas = document.querySelector<HTMLElement>(
      '.ed-canvas-frame [data-path].is-selected',
    );
    const box = (onCanvas ?? anchor)?.getBoundingClientRect();

    /*
     * Remembered so the position can be corrected once the toolbar has a real
     * height. HEIGHT_GUESS was right when this was one row of buttons; colour,
     * size, font and alignment made it wrap to two, and a guess 36px short put
     * the toolbar over the first line of the paragraph being edited. Which is
     * the thing Andy said was worse than having no toolbar at all.
     */
    anchorTop.current = box ? box.top : null;

    setPosition(
      clamp(
        box
          ? { x: box.left, y: box.top - HEIGHT_GUESS - 12 }
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

    /*
     * Re-clamped, and re-anchored if it is still sitting where it opened.
     *
     * The re-anchor is what keeps a toolbar that has grown a second row from
     * settling over the first line of the paragraph. Only while anchorTop is
     * set: once somebody has dragged it, moving it for them is the bug this is
     * fixing, in reverse.
     */
    const settle = () =>
      setPosition((current) => {
        if (!current) return current;
        const measured = size();
        const above =
          anchorTop.current !== null && measured
            ? { x: current.x, y: anchorTop.current - measured.height - 12 }
            : current;
        return clamp(above, measured);
      });

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
    // Moved by hand, so stop putting it back above the words.
    anchorTop.current = null;
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
      /*
       * SAY SO, rather than emptying the box and doing nothing.
       *
       * This used to clear the field and return, which from the other side of
       * the screen is a button that eats what you typed. Whoever typed it needs
       * to know it was refused and roughly why, and the panel stays open so the
       * address can be corrected rather than retyped from scratch.
       */
      setRefused(true);
      return;
    }
    setRefused(false);

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
    setRefused(false);
    savedRange.current = null;
  }

  /**
   * Paint the selection, then leave it selected.
   *
   * Reselecting matters: without it, choosing a colour and then a size would put
   * the size somewhere else, because applying the first one consumed the range.
   */
  function paint(property: string, value: string) {
    onStyle(property, value);
    setTray(null);
  }

  /**
   * A colour typed in by hand.
   *
   * Held to the same shape the sanitiser will accept, and checked HERE as well
   * so a mistyped one is refused while it can still be corrected rather than
   * appearing to work and vanishing on save.
   */
  function applyCustom() {
    const value = custom.trim().toLowerCase();
    if (!/^#([0-9a-f]{3}|[0-9a-f]{6})$/.test(value)) return;

    /*
     * The words back first, like the link does and for the same reason.
     *
     * Typing in the box moves the document's selection into the box, so by the
     * time this runs the words are no longer selected and painting them would
     * paint nothing. The swatches above need none of this: they never take focus,
     * because the toolbar refuses mousedown for everything except this input.
     */
    const range = savedRange.current;
    if (range) {
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    }

    paint(tray ?? 'color', value);
    setCustom('#');
    savedRange.current = null;
  }

  /**
   * Ask the assistant, then put what comes back where the words were.
   *
   * THE ANSWER GOES IN THROUGH THE SAME DOOR AS TYPING, which is the decision
   * worth defending. insertHTML runs through onExec, which runs through the
   * shell's withHost, which commits the block's HTML the same way a keystroke
   * does. So the result lands in the undo history, gets sanitised on save, and
   * can be deleted with one ctrl-Z if it is not wanted. An assistant that wrote
   * straight into the document, outside undo, would be one whose mistakes you
   * have to repair by hand.
   *
   * With words selected, insertHTML REPLACES them, which is what improve,
   * shorter and longer mean. With nothing selected it inserts at the caret,
   * which is what write means. That is the browser's own behaviour and it
   * happens to be exactly right, so nothing here has to arrange it.
   */
  async function askFor(requested: string) {
    if (!onWrite || busy) return;

    /*
     * IN A HEADING, "write it" MEANS "write a heading".
     *
     * The write intent asks for one to three paragraphs, which is the wrong
     * thing entirely when the caret is in an h2. The title intent asks for one
     * line, under twelve words, no full stop. Same button, right answer for
     * where you are standing.
     */
    const intent = oneLine && requested === 'write' ? 'title' : requested;

    const words = selectedText.trim();
    if (intent !== 'write' && intent !== 'title' && !words) {
      setFailure('Highlight the words you would like changed first.');
      return;
    }
    if ((intent === 'write' || intent === 'title') && !instruction.trim()) {
      setFailure('Say what you would like written.');
      return;
    }

    setBusy(true);
    setFailure(null);

    let result: WriteResult;
    try {
      result = await onWrite({ intent, instruction: instruction.trim(), selection: words });
    } catch {
      // A thrown action means the network went, or the deploy did. Neither is
      // something to show a stack trace for.
      result = { ok: false, error: 'Could not reach the assistant. Try again in a moment.' };
    }

    setBusy(false);

    if (!result.ok) {
      setFailure(result.error);
      return;
    }

    /*
     * The words back first, like the link and the hex box do. Typing in the
     * panel moved the selection into the panel, so without this the copy would
     * be inserted wherever the caret happened to collapse to.
     */
    const range = savedRange.current;
    if (range) {
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    }

    /*
     * A HEADING TAKES THE PLAIN FORM. lib/ai/copy.ts returns both shapes for
     * exactly this: the answer is one to three paragraphs, and inserting that
     * HTML into an h2 would put a <p> inside a heading. insertText is the right
     * command rather than escaping the text into insertHTML, and it is why
     * toCopy exists at all.
     */
    if (oneLine) onExec('insertText', result.data.text);
    else onExec('insertHTML', result.data.html);

    setAsking(false);
    setInstruction('');
    setSelectedText('');
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

      {/*
        The block format, and NOT in a heading.
        Every option here is a block element, and formatBlock inside an h2 would
        put a p or a blockquote inside it. A heading's own level and appearance
        are set in the properties pane, where they belong: they are what the
        block IS, not formatting applied to a selection inside it.
      */}
      {!oneLine && (
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
      )}

      {/*
        Font and size read as "choose one" rather than showing what is already
        set, because the selection can span two of them and there is no honest
        single answer to show in that case. Both reset to their placeholder after
        a choice, so the control never claims to be reporting the current state.
      */}
      <select
        className="ed-tt__block"
        value=""
        aria-label="Font"
        onMouseDown={(event) => event.stopPropagation()}
        onChange={(event) => event.target.value && paint('font-family', event.target.value)}
      >
        <option value="">Font</option>
        {FONT_CHOICES.map((entry) => (
          <option key={entry.value} value={entry.value}>
            {entry.label}
          </option>
        ))}
      </select>

      <select
        className="ed-tt__block"
        value=""
        aria-label="Size"
        onMouseDown={(event) => event.stopPropagation()}
        onChange={(event) => event.target.value && paint('font-size', event.target.value)}
      >
        <option value="">Size</option>
        {/*
          Grouped, with the theme's own sizes first. A flat list of fourteen put
          H2 below Giant, which is the wrong way round: the named sizes are the
          ones that keep a page looking like one page, and the fixed scale is the
          exception. Andy asked for the named ones by name.
        */}
        {FONT_SIZE_GROUPS.map((group) => (
          <optgroup key={group} label={group}>
            {FONT_SIZES.filter((entry) => entry.group === group).map((entry) => (
              <option key={entry.value} value={entry.value}>
                {entry.label}
              </option>
            ))}
          </optgroup>
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

      {/* Lists are block elements too, so they are absent in a heading. */}
      {!oneLine
        && LISTS.map((item) => (
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

      {/*
        Two trays rather than two rows of swatches always on show. The toolbar is
        already wide, and a colour is chosen far less often than bold is pressed.
      */}
      {/*
        rememberSelection on opening, because the hex box inside the tray takes
        focus the moment it is typed into and the words stop being selected. The
        swatches do not need it, and it costs nothing to have it either way.
      */}
      <SwatchButton
        icon="text-colour"
        title="Text colour"
        open={tray === 'color'}
        onToggle={() => {
          rememberSelection();
          setTray((current) => (current === 'color' ? null : 'color'));
        }}
      />
      <SwatchButton
        icon="highlight"
        title="Highlight"
        open={tray === 'background-color'}
        onToggle={() => {
          rememberSelection();
          setTray((current) => (current === 'background-color' ? null : 'background-color'));
        }}
      />

      <span className="ed-tt__rule" aria-hidden="true" />

      {/*
        Alignment sets the BLOCK's own field, the same one the properties pane
        shows. See the prop's note: two controls for one thing is fine, two
        sources of truth for it is not.
      */}
      {ALIGNMENTS.map((item) => (
        <button
          key={item.value}
          type="button"
          className="ed-tt__btn"
          title={item.title}
          aria-label={item.title}
          aria-pressed={align === item.value}
          onClick={() => onAlign(item.value)}
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

      {/*
        The assistant, LAST and marked out from the rest.

        Last because the buttons to its left are the ones pressed twenty times a
        page, and marked out because it is the only control here that does
        something you have to read afterwards. Everything else is a formatting
        change you can see happen.

        Absent rather than disabled when there is no onWrite. A sparkle that does
        nothing is the button-that-appears-to-work problem this file already has
        a rule about.
      */}
      {onWrite && (
        <button
          type="button"
          className="ed-tt__btn is-ai"
          title="Ask for some writing"
          aria-label="Ask for some writing"
          aria-pressed={asking}
          onClick={() => {
            const selection = window.getSelection();
            rememberSelection();
            setSelectedText(selection ? selection.toString() : '');
            setFailure(null);
            setAsking((open) => !open);
            // After the panel exists. A click, which is the exception the
            // no-focus-on-render rule names.
            window.setTimeout(() => askInput.current?.focus(), 0);
          }}
        >
          <Icon name="sparkle" size={16} />
        </button>
      )}

      {tray && (
        /*
         * NO stopPropagation ON THE TRAY ITSELF.
         *
         * The toolbar root refuses mousedown, which is what keeps the selection
         * alive in the block behind it. A tray that stopped that from reaching
         * the root would blur the editable on every swatch click, collapsing the
         * selection so the colour landed on nothing. Only the text box below
         * re-enables mousedown, because a box you cannot click into is not a box.
         */
        <div className="ed-tt__tray">
          <p className="ed-tt__tray-title">
            {tray === 'color' ? 'Text colour' : 'Highlight'}
          </p>
          <div className="ed-tt__swatches">
            {(tray === 'color' ? COLOUR_SWATCHES : HIGHLIGHT_SWATCHES).map((swatch) => (
              <button
                key={swatch.value}
                type="button"
                className="ed-tt__swatch"
                style={{ background: swatch.value }}
                title={swatch.label}
                aria-label={swatch.label}
                onClick={() => paint(tray, swatch.value)}
              />
            ))}
          </div>

          {/*
            A hex box as well as the palette, because somebody will want a colour
            the theme does not have. Checked here to the same shape the sanitiser
            accepts, so a mistyped one is refused while it can still be fixed.
          */}
          <div className="ed-tt__custom">
            <input
              className="ed-tt__url"
              type="text"
              value={custom}
              aria-label="A colour of your own, as a hex code"
              placeholder="#336699"
              maxLength={7}
              // The one thing in here that may take focus. Typing in it moves the
              // document's selection into it, which is why applyCustom puts the
              // words back before painting them.
              onMouseDown={(event) => event.stopPropagation()}
              onChange={(event) => setCustom(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  applyCustom();
                }
                if (event.key === 'Escape') {
                  event.preventDefault();
                  setTray(null);
                }
              }}
            />
            <button
              type="button"
              className="ed-tt__btn"
              aria-label="Use this colour"
              onClick={applyCustom}
            >
              <Icon name="check" size={16} />
            </button>
          </div>
        </div>
      )}

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
            aria-invalid={refused || undefined}
            aria-describedby={refused ? 'ed-tt-refused' : undefined}
            onChange={(event) => {
              setHref(event.target.value);
              // The complaint is about what was there a moment ago, so it goes
              // as soon as the address is being changed.
              setRefused(false);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                applyLink();
              }
              if (event.key === 'Escape') {
                event.preventDefault();
                setLinking(false);
                setHref('');
                setRefused(false);
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
              setRefused(false);
            }}
          >
            <Icon name="close" size={16} />
          </button>

          {refused && (
            <p className="ed-tt__refused" id="ed-tt-refused" role="alert">
              That is not a web address we can link to. Try one starting https://
            </p>
          )}
        </div>
      )}

      {asking && onWrite && (
        /*
         * NO stopPropagation ON THE PANEL, only on the box you type in.
         *
         * The same arrangement the swatch tray uses, and the first version of
         * this got it wrong. The toolbar root refuses mousedown, which is what
         * keeps the highlighted words highlighted while you press something.
         * Re-enabling it for the whole panel meant clicking "Make it shorter"
         * blurred the paragraph and collapsed the selection, so the new copy was
         * inserted AFTER the words instead of over them. Measured: 369
         * characters became 428 when it should have got shorter.
         *
         * Only the textarea opts back in, because a box you cannot click into is
         * not a box, and askFor puts the words back before it inserts anything.
         */
        <div className="ed-tt__ask">
          <p className="ed-tt__ask-title">What would you like written?</p>

          <textarea
            ref={askInput}
            className="ed-tt__ask-box"
            rows={2}
            maxLength={500}
            value={instruction}
            disabled={busy}
            aria-label="What would you like written"
            placeholder="A short paragraph about our tailor-made trips to Greece"
            // The one thing in the panel that may take focus. See the note above.
            onMouseDown={(event) => event.stopPropagation()}
            onChange={(event) => {
              setInstruction(event.target.value);
              setFailure(null);
            }}
            onKeyDown={(event) => {
              /*
               * Enter sends, shift-Enter makes a new line. The box is two rows
               * and the thing typed into it is a sentence, so sending is far
               * more often what was meant.
               */
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                void askFor('write');
              }
              if (event.key === 'Escape') {
                event.preventDefault();
                setAsking(false);
                setInstruction('');
                setFailure(null);
              }
            }}
          />

          <div className="ed-tt__ask-row">
            <button
              type="button"
              className="ed-tt__ask-go"
              disabled={busy}
              onClick={() => void askFor('write')}
            >
              {busy ? 'Writing…' : 'Write it'}
            </button>
            {/*
              Said plainly rather than left to be worked out. With words
              highlighted the answer replaces them; without, it lands at the
              caret. Those are different enough that somebody should know which
              they are about to get.
            */}
            <span className="ed-tt__ask-note">
              {selectedText.trim()
                ? 'This will replace the words you have highlighted.'
                : 'This will be added where the cursor is.'}
            </span>
          </div>

          {/*
            The quick edits, only when there are words for them to work on. See
            the note on QUICK: "make this shorter" with nothing highlighted has
            no honest answer.
          */}
          {selectedText.trim() && (
            <div className="ed-tt__ask-quick">
              {QUICK.map((entry) => (
                <button
                  key={entry.intent}
                  type="button"
                  className="ed-tt__ask-chip"
                  disabled={busy}
                  onClick={() => void askFor(entry.intent)}
                >
                  {entry.label}
                </button>
              ))}
            </div>
          )}

          {/*
            Its own class, not .ed-tt__refused. That one is absolutely
            positioned and nowrap because it hangs under a one-line link row;
            inside a panel it would sit below the panel and run off the side.
          */}
          {failure && (
            <p className="ed-tt__ask-error" role="alert">
              {failure}
            </p>
          )}

          {/*
            Where the tone comes from, said once, where somebody can act on it.
            The first thing anybody asks when the copy does not sound like them
            is how to change that, and the answer is a screen they have probably
            never opened.
          */}
          <p className="ed-tt__ask-hint">
            The tone comes from your company profile, in Settings.
          </p>
        </div>
      )}
    </div>
  );
}
