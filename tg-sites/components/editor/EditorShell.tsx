'use client';

/**
 * The editor.
 *
 * Owns the page, the selection, the history and the autosave. Everything
 * else in components/editor is presentational and talks back through the
 * callbacks handed down from here.
 *
 * WHERE THE DRAFT LIVES
 * Postgres, one row in `pages`, saved through a server action. The editor
 * never sees a tenant id: the action takes it from the session, and every
 * query underneath runs inside withTenant. There is no localStorage path and
 * no scratch mode, because two persistence paths means every save, undo and
 * publish has to work twice and only one of them gets exercised.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { writeCopyAction } from '../../app/actions/ai';
import { publishPageAction, saveDraftAction } from '../../app/actions/pages';
import { publishRegionAction, saveRegionAction } from '../../app/actions/regions';
import { publishItemAction, saveItemAction } from '../../app/actions/collections';
import { PublishHistory } from './PublishHistory';
import type { Page, RegionName, Section } from '../../lib/content/schema';
import { parsePage } from '../../lib/content/schema';
import { pageAsRegion, REGION_TITLES } from '../../lib/content/region-page';
import { pageAsItem, type ItemMeta } from '../../lib/content/collection-page';
import { createBlock, createSectionFromLayout, newId } from '../../lib/content/factory';
import { buildPresetSection } from '../../lib/content/presets';
import { addBlock, addColumn, parsePathKey, type Path, pathKey, resolve, updateBlockProps } from '../../lib/content/tree';
import { Outline } from './Outline';
import { Canvas } from './Canvas';
import { Properties } from './Properties';
import { BlockPicker } from './BlockPicker';
import { ItemToolbar } from './ItemToolbar';
import { SectionPicker } from './SectionPicker';
import { TextToolbar } from './TextToolbar';
import { Icon, type IconName } from './Icon';
import { Menu } from './Menu';
import './editor.css';
import '../media/media.css';

const THEME_KEY = 'tg-sites:theme:v1';
/** Which side panels are folded away. A working preference, not page data. */
const PANELS_KEY = 'tg-sites:panels:v1';
/**
 * The width each preview is drawn at.
 *
 * Per person, in this browser, alongside the light or dark choice and the
 * folded panels. It is about how somebody looks at the site rather than about
 * the site, so two people working on the same one can reasonably differ, and
 * nothing a visitor sees depends on it. If it should instead be a decision the
 * agency makes once for a project, it moves to the site settings row and this
 * key goes: that is an additive change, which is why this is the safe way round.
 */
const VIEWPORTS_KEY = 'tg-sites:viewports:v1';
const HISTORY_LIMIT = 50;
/** Edits to the same field inside this window collapse into one undo step. */
const COALESCE_MS = 700;
/**
 * How long the editor waits after the last keystroke before saving.
 *
 * Longer than the old localStorage delay because this one crosses a network.
 * Short enough that an agent who types a heading and immediately closes the
 * tab still gets a save away, helped by the warning on unload below.
 */
const SAVE_DEBOUNCE_MS = 900;

/**
 * Wrap what is selected in a span carrying one CSS declaration.
 *
 * WHY NOT execCommand
 *
 * foreColor and fontSize exist and would be two lines. They also resolve the
 * value before storing it, so asking for the brand colour stores the hex the
 * brand is today and a client who later changes their brand finds these words
 * left behind. And they reach for the old <font> tag, which the sanitiser does
 * not keep. Doing it here stores `var(--tgs-primary)` and the words follow.
 *
 * HOW
 *
 * extractContents rather than surroundContents. surroundContents throws the
 * moment a selection crosses an element boundary, which is most of the time in
 * real writing: half of a bold word and half of the plain text after it. Extract
 * and re-insert copes, because it splits the boundary nodes for us.
 *
 * WHAT IS NOT ONE SPAN
 *
 * Selecting a whole paragraph and wrapping the lot gives `<span><p>…</p></span>`,
 * an inline element around a block one. Browsers render it, so the first version
 * of this looked right and was wrong: the nesting is invalid, it accumulates a
 * layer every time somebody restyles the block, and a `<p>` inside a sized span
 * reports the span's size as its own, which had a check comparing 32px with 32px.
 *
 * So the extracted fragment is walked. A block element gets the declaration set
 * on ITSELF. Runs of inline content between blocks get one span each. A selection
 * inside a single paragraph is the common case and still comes out as one span,
 * which is what it should be.
 *
 * The same property is stripped from anything inside first, so applying a second
 * colour over a first one wins rather than being overridden from further in.
 * Then what was painted is reselected, so a colour and a size can be applied to
 * the same words one after the other.
 *
 * Does nothing on a collapsed caret: there is no honest answer to "make this
 * nothing red", and the alternative is an empty span left in the markup.
 */
const BLOCK_TAGS = new Set(['P', 'H2', 'H3', 'H4', 'UL', 'OL', 'LI', 'BLOCKQUOTE', 'DIV', 'PRE']);

function wrapSelection(host: HTMLElement, property: string, value: string): void {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return;

  const range = selection.getRangeAt(0);
  if (range.collapsed) return;

  // Only paint inside the block being edited. A selection that started here and
  // ran off the end of it would otherwise rewrite part of the page.
  if (!host.contains(range.commonAncestorContainer)) return;

  /** Take the property off descendants, so the one being set is the one that wins. */
  const clearInside = (node: Element) => {
    node.querySelectorAll('[style]').forEach((inner) => {
      const el = inner as HTMLElement;
      el.style.removeProperty(property);
      if (!el.getAttribute('style')) el.removeAttribute('style');
    });
  };

  const contents = range.extractContents();
  const out = document.createDocumentFragment();
  const painted: Element[] = [];
  let run: HTMLSpanElement | null = null;

  for (const node of Array.from(contents.childNodes)) {
    const element = node.nodeType === Node.ELEMENT_NODE ? (node as HTMLElement) : null;

    if (element && BLOCK_TAGS.has(element.tagName)) {
      run = null;
      clearInside(element);
      element.style.setProperty(property, value);
      out.appendChild(element);
      painted.push(element);
      continue;
    }

    if (!run) {
      run = document.createElement('span');
      run.style.setProperty(property, value);
      out.appendChild(run);
      painted.push(run);
    }
    if (element) clearInside(element);
    run.appendChild(node);
  }

  range.insertNode(out);

  if (painted.length === 0) return;
  const next = document.createRange();
  next.setStartBefore(painted[0]);
  next.setEndAfter(painted[painted.length - 1]);
  selection.removeAllRanges();
  selection.addRange(next);
}

export type Viewport = 'desktop' | 'tablet' | 'phone';

/**
 * Light is the default and stays the default, whatever the operating system
 * is set to. Following the OS meant anyone on a dark Mac was handed a dark
 * editor they never asked for.
 */
export type Theme = 'light' | 'dark' | 'system';

const THEMES: ReadonlyArray<{ value: Theme; label: string }> = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'Match my computer' },
];

/** Label and icon together. An icon-only control is a guess. */
const VIEWPORTS: ReadonlyArray<{ value: Viewport; label: string; icon: IconName }> = [
  { value: 'desktop', label: 'Desktop', icon: 'desktop' },
  { value: 'tablet', label: 'Tablet', icon: 'tablet' },
  { value: 'phone', label: 'Phone', icon: 'phone' },
];

/**
 * The width each preview is drawn at, and what somebody may change it to.
 *
 * Andy asked for these on 31 Jul 2026: "settings for the screen size the user
 * wants to build to for each of the three break points... desktop default
 * should be about 1200 but they should be able to select bigger or smaller".
 *
 * Desktop used to be '100%', which meant "however much room is left after the
 * two side panels". That is not a screen size, it is an accident of the window
 * and of which panels happen to be open, and it is why Desktop was rendering
 * the phone layout on a 1440px screen. All three are real numbers now, so what
 * you see is the width you asked for.
 *
 * The presets are the sizes worth having an opinion about rather than every
 * device ever made: the common desktop widths, the two tablet orientations, and
 * the three phone sizes that cover almost everything. Anything else can be
 * typed in.
 */
const VIEWPORT_DEFAULT: Record<Viewport, number> = {
  desktop: 1200,
  // Sits clearly between the two container breakpoints (768 and 1024), so
  // "stack below tablet" visibly does something here and "stack below mobile"
  // visibly does not.
  tablet: 834,
  phone: 390,
};

const VIEWPORT_PRESETS: Record<Viewport, ReadonlyArray<{ width: number; label: string }>> = {
  desktop: [
    { width: 1024, label: 'Small laptop' },
    { width: 1200, label: 'Standard' },
    { width: 1440, label: 'Large laptop' },
    { width: 1680, label: 'Wide' },
    { width: 1920, label: 'Full HD' },
  ],
  tablet: [
    { width: 768, label: 'Portrait, small' },
    { width: 834, label: 'Portrait' },
    { width: 1024, label: 'Landscape' },
  ],
  phone: [
    { width: 360, label: 'Small' },
    { width: 390, label: 'Standard' },
    { width: 430, label: 'Large' },
  ],
};

/** Nothing narrower than the narrowest phone, nothing wider than a big monitor. */
const MIN_VIEWPORT = 320;
const MAX_VIEWPORT = 2560;

export function normaliseViewportWidth(value: unknown, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(MAX_VIEWPORT, Math.max(MIN_VIEWPORT, Math.round(n)));
}

interface History {
  past: Page[];
  present: Page;
  future: Page[];
}

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

interface EditorProps {
  isStaff?: boolean;
  pageId: string;
  initialPage: Page;
  initialStatus: 'draft' | 'published';
  initialHasUnpublishedChanges: boolean;
  /**
   * The client's SITE theme, as custom properties, for the canvas.
   *
   * Called siteTheme, not theme. This component already has a `theme` for
   * whether the editor chrome is light or dark, which is an operator preference
   * stored in localStorage. This one is the client's brand, stored in the
   * database and shipped to visitors. Two completely different things, and the
   * first attempt at this named them both `theme` and shadowed one with the
   * other.
   *
   * Optional so the standalone build still works: omitting it falls back to the
   * tokens in globals.css, which are the values the default theme derives to.
   */
  siteTheme?: CSSProperties;
  /**
   * The signed-in person's id, so version history can mark their own entries.
   *
   * Optional and cosmetic. Nothing is gated on it, so the standalone build
   * omitting it costs a label rather than a permission.
   */
  currentUserId?: string | null;
  /**
   * Editing the site's header or footer rather than a page.
   *
   * WHAT THIS CHANGES, AND WHAT IT DELIBERATELY DOES NOT
   *
   * It changes where a save goes, and it hides the handful of controls that
   * mean nothing for furniture: the page title, the address, the search
   * listing and the version history. Everything else, the canvas, the outline,
   * the blocks, undo, the styling panel, is untouched, because a header is
   * sections and rows exactly as a page is. That equivalence is the whole
   * reason there is one editor and not two.
   *
   * The region's own two settings, sticky and overlay, are held here rather
   * than in the Page, since a Page has nowhere to put them. See
   * lib/content/region-page.ts for the wrapping.
   */
  region?: RegionName | null;
  initialRegionFlags?: { sticky: boolean; overlay: boolean };
  /**
   * Editing an entry in a collection: a blog post, a destination guide.
   *
   * The third thing this shell edits, after a page and a region, and the same
   * arrangement as the second: the body is handed over as a Page and everything
   * that is not sections travels beside it. What it changes is where a save
   * goes and what the root of the properties pane offers. Everything else, the
   * canvas, the outline, the blocks, undo, the styling panel, is untouched,
   * because a post is sections and rows exactly as a page is.
   */
  itemId?: string | null;
  initialItemMeta?: ItemMeta;
}

export function EditorShell({
  isStaff = true,
  pageId,
  initialPage,
  initialStatus,
  initialHasUnpublishedChanges,
  siteTheme,
  currentUserId = null,
  region = null,
  initialRegionFlags,
  itemId = null,
  initialItemMeta,
}: EditorProps) {
  const [history, setHistory] = useState<History>({
    past: [],
    present: initialPage,
    future: [],
  });
  const [selected, setSelected] = useState<Path | null>(null);
  const [viewport, setViewport] = useState<Viewport>('desktop');
  const [picker, setPicker] = useState<{ section: number; row: number; column: number } | null>(null);
  /** Where a new section would go. null means the picker is closed. */
  const [insertAt, setInsertAt] = useState<number | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);

  const [saved, setSaved] = useState<SaveState>('idle');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [status, setStatus] = useState<'draft' | 'published'>(initialStatus);
  /**
   * The header's two settings, which have nowhere to live inside a Page.
   *
   * Not in the undo history, on purpose. Undo is about content, and pulling a
   * header off the top of a hero is a layout decision somebody makes once and
   * can un-tick. Threading them through History would have meant every undo
   * step carrying a copy of them for the sake of a checkbox.
   */
  const [regionFlags, setRegionFlags] = useState(
    initialRegionFlags ?? { sticky: false, overlay: false },
  );
  /**
   * A post's summary, picture and address, which have nowhere to live in a Page.
   *
   * Not in the undo history, for the same reason the header's two settings are
   * not: undo is about content, and every step carrying a copy of six strings
   * for the sake of a date field would be a poor trade.
   */
  const [itemMeta, setItemMeta] = useState<ItemMeta>(
    initialItemMeta ?? { title: '', summary: '', image: '', alt: '', date: '', slug: '' },
  );
  const [unpublished, setUnpublished] = useState(initialHasUnpublishedChanges);
  const [publishing, setPublishing] = useState(false);
  const [mobilePane, setMobilePane] = useState<'canvas' | 'props' | 'outline'>('canvas');
  /**
   * Which side panels are open. Both, until somebody folds one away.
   *
   * Remembered, like the light or dark choice and the toolbar's position: it is
   * how somebody likes to work, not something about the page.
   */
  const [panels, setPanels] = useState({ outline: true, props: true });
  /** What each preview is drawn at, in pixels. See VIEWPORTS_KEY. */
  const [widths, setWidths] = useState<Record<Viewport, number>>(VIEWPORT_DEFAULT);
  /**
   * What the preview is really showing, when there is not room for the choice.
   *
   * The chosen width is a CEILING, not a promise: a 1200px preview in 800px of
   * room is drawn at 800. Saying so is the whole job of this number. Two earlier
   * attempts tried to keep the promise instead, by overflowing and then by
   * shrinking the page to fit, and both were worse than admitting it: see the
   * note above the frame in Canvas.tsx.
   */
  const [actualWidth, setActualWidth] = useState<number | null>(null);

  useEffect(() => {
    const frame = document.querySelector('.ed-canvas-frame');
    if (!frame) return;

    const measure = () => {
      const drawn = Math.round(frame.getBoundingClientRect().width);
      setActualWidth(drawn < widths[viewport] - 2 ? drawn : null);
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(frame);
    return () => observer.disconnect();
  }, [widths, viewport, panels]);
  const [theme, setTheme] = useState<Theme>('light');

  const page = history.present;

  /*
   * Which block is being typed into ON THE CANVAS, and what kind it is.
   *
   * Headings and paragraphs, because those are the two blocks whose whole
   * content is words a person wants to type where they can see them. Derived
   * rather than stored, because "what is selected" is already state and a
   * second copy of it would be one to keep in step. Canvas takes the element
   * over; see its effect.
   *
   * BOTH GET THE TOOLBAR NOW. Andy, 31 Jul 2026: "the text toolbar only appears
   * on paragraph text, it needs to work on every style of text". It used to be
   * paragraphs only, because a heading stored a plain string the renderer
   * escaped, so bold inside one could not have survived a save. A heading stores
   * markup since that day, so the toolbar is honest in both.
   *
   * `oneLine` is what replaces the old `rich` flag, and it is a different
   * question. Not "may this be formatted" but "may this contain BLOCKS". A
   * heading is an h2, h3 or h4, and a paragraph, a list or a quote inside one is
   * invalid HTML that browsers silently restructure. So the toolbar keeps its
   * inline commands in a heading and hides the ones that would nest a block.
   */
  const editing = useMemo(() => {
    if (selected?.kind !== 'block') return null;
    const block = page.sections[selected.section]?.rows[selected.row]
      ?.columns[selected.column]?.blocks[selected.block];
    if (block?.type !== 'text' && block?.type !== 'heading') return null;

    const align = typeof block.props?.align === 'string' ? block.props.align : 'left';
    return { path: pathKey(selected), oneLine: block.type === 'heading', align };
  }, [selected, page]);

  const editingPath = editing?.path ?? null;

  /** Identifies the last edit, so rapid edits to one field coalesce. */
  const lastEdit = useRef<{ key: string; at: number } | null>(null);

  // Remember the appearance choice. Read before first paint would be better
  // still, but a shell with no server session cannot do that yet, and the
  // default being light means the common case never flashes.
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(THEME_KEY);
      if (stored === 'light' || stored === 'dark' || stored === 'system') setTheme(stored);
    } catch {
      // Storage blocked. Light is a fine place to stay.
    }
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(THEME_KEY, theme);
    } catch {
      // Not worth surfacing: the choice still applies for this session.
    }
  }, [theme]);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(PANELS_KEY);
      if (!raw) return;
      const stored = JSON.parse(raw) as Partial<typeof panels>;
      setPanels({
        outline: stored?.outline !== false,
        props: stored?.props !== false,
      });
    } catch {
      // A hand-edited value or storage blocked. Both panels open is a fine
      // place to start and nothing about the page depends on it.
    }
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(PANELS_KEY, JSON.stringify(panels));
    } catch {
      // See above.
    }
  }, [panels]);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(VIEWPORTS_KEY);
      if (!raw) return;
      const stored = JSON.parse(raw) as Partial<Record<Viewport, unknown>>;
      // Each one clamped on the way in, so a hand-edited value cannot produce a
      // canvas 40,000px wide or 3px wide.
      setWidths({
        desktop: normaliseViewportWidth(stored?.desktop, VIEWPORT_DEFAULT.desktop),
        tablet: normaliseViewportWidth(stored?.tablet, VIEWPORT_DEFAULT.tablet),
        phone: normaliseViewportWidth(stored?.phone, VIEWPORT_DEFAULT.phone),
      });
    } catch {
      // The defaults are good ones.
    }
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(VIEWPORTS_KEY, JSON.stringify(widths));
    } catch {
      // See above.
    }
  }, [widths]);

  /**
   * Choose a preview width, and make room for it if it is Desktop.
   *
   * THE PREVIEW FOLLOWS THE CANVAS, NOT THE WINDOW. It is a container query
   * context, so a 752px canvas renders the phone layout however wide the screen
   * is. On a 1440px screen the two 320px panels leave exactly that, which is why
   * Desktop was showing a stacked page and Andy asked for this.
   *
   * So Desktop folds the panels away, but ONLY when the canvas cannot otherwise
   * reach a tablet's width, and only ever folds: it never reopens one somebody
   * closed. On a big screen nothing moves. The panels are one click away in the
   * top bar either way, which is what makes this a shortcut rather than
   * something being taken away.
   */
  const chooseViewport = useCallback(
    (next: Viewport) => {
      setViewport(next);
      if (next !== 'desktop') return;

      /*
        The room available, not the frame: the frame is now drawn at the chosen
        width whether or not it fits, so measuring it would answer the wrong
        question. What matters is whether the space around it can hold it.
      */
      const wrap = document.querySelector('.ed-canvas-wrap');
      const room = wrap?.clientWidth ?? 0;
      const wanted = widths.desktop;
      if (room >= wanted) return;

      setPanels((current) => {
        const folded = room + (current.outline ? 320 : 0) + (current.props ? 320 : 0);
        if (folded < wanted) {
          // Even with both away it would not fit. Leave them alone rather than
          // hiding the whole workspace for a preview that still has to scroll.
          return current;
        }
        return { outline: false, props: false };
      });
    },
    [widths.desktop],
  );

  // ---------------------------------------------------------------------
  // Autosave
  // ---------------------------------------------------------------------

  /**
   * Counts saves so a slow one cannot overwrite a fast one that followed it.
   *
   * Without this, two saves in flight can land out of order and the editor
   * would report "saved" against the older of the two. The debounce makes
   * that unlikely rather than impossible, and unlikely is not a guarantee
   * worth resting a client's copy on.
   */
  const saveSeq = useRef(0);
  /** Skips the save that a fresh mount would otherwise fire immediately. */
  const mounted = useRef(false);

  /**
   * One save, wherever this editor's content actually lives.
   *
   * The autosave and the publish both go through here so there is exactly one
   * place that knows a header is stored differently from a page. A closure
   * cannot be passed in from the server component that renders this, since only
   * serialisable props and server actions cross that boundary, so the branch is
   * on `region` rather than on an injected function.
   */
  const persist = useCallback(
    (next: Page, flags: { sticky: boolean; overlay: boolean }, meta: ItemMeta) => {
      if (region) return saveRegionAction(region, pageAsRegion(next, region, flags));
      if (itemId) return saveItemAction(itemId, pageAsItem(next, meta), meta.slug);
      return saveDraftAction(pageId, next);
    },
    [itemId, pageId, region],
  );

  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }

    setSaved('saving');
    setSaveError(null);

    const timer = window.setTimeout(async () => {
      const seq = ++saveSeq.current;
      const result = await persist(page, regionFlags, itemMeta);
      if (seq !== saveSeq.current) return;

      if (result.ok) {
        setSaved('saved');
        // A saved edit is by definition not yet published.
        setUnpublished(true);
      } else {
        setSaved('error');
        setSaveError(result.error);
      }
    }, SAVE_DEBOUNCE_MS);

    return () => window.clearTimeout(timer);
  }, [page, pageId, persist, region, regionFlags, itemMeta]);

  const publish = useCallback(async () => {
    setPublishing(true);
    setSaveError(null);

    // Flush any pending edit first, so publishing cannot capture the version
    // from before the last keystroke. The debounce means that gap is real.
    const pending = await persist(page, regionFlags, itemMeta);
    if (!pending.ok) {
      setSaved('error');
      setSaveError(pending.error);
      setPublishing(false);
      return;
    }
    setSaved('saved');

    const result = region
      ? await publishRegionAction(region)
      : itemId
        ? await publishItemAction(itemId)
        : await publishPageAction(pageId);

    if (result.ok && result.data) {
      // A region has no status column: publishing one makes it live and there
      // is no way to withdraw it short of emptying it. So it is published from
      // here on, and only "are there newer changes" varies. A page and an item
      // both have one, and it is the answer.
      setStatus(region ? 'published' : (result.data as { status: 'draft' | 'published' }).status);
      setUnpublished(result.data.hasUnpublishedChanges);
    } else if (!result.ok) {
      setSaveError(result.error);
    }
    setPublishing(false);
  }, [itemId, page, pageId, persist, region, regionFlags, itemMeta]);

  // ---------------------------------------------------------------------
  // Commits
  // ---------------------------------------------------------------------

  /**
   * Apply a change.
   *
   * `coalesceKey` groups rapid edits to the same field into one undo step,
   * so typing a heading is one step rather than forty.
   */
  const commit = useCallback((next: Page | ((current: Page) => Page), coalesceKey?: string) => {
    setHistory((current) => {
      const resolved = typeof next === 'function' ? next(current.present) : next;
      if (resolved === current.present) return current;

      const now = Date.now();
      const previous = lastEdit.current;
      const shouldCoalesce =
        !!coalesceKey &&
        !!previous &&
        previous.key === coalesceKey &&
        now - previous.at < COALESCE_MS;

      lastEdit.current = coalesceKey ? { key: coalesceKey, at: now } : null;

      if (shouldCoalesce) {
        // Replace the present without growing the stack.
        return { ...current, present: resolved, future: [] };
      }

      const past = [...current.past, current.present].slice(-HISTORY_LIMIT);
      return { past, present: resolved, future: [] };
    });
  }, []);

  /**
   * Run a formatting action against the block being edited on the canvas.
   *
   * Every one of them does the same three things: find the element, focus it so
   * the action lands on the selection inside it, and commit whatever the element
   * says afterwards. Written once because two copies of it drifted: the second
   * one forgot the focus and its command silently applied to nothing.
   *
   * Focusing here is the exception the no-focus-on-render rule names. This runs
   * from a click on the toolbar, which is as real as a user action gets.
   */
  const withHost = useCallback(
    (pathKeyValue: string, act: (host: HTMLElement) => string) => {
      const host = document.querySelector<HTMLElement>(
        `[data-path="${CSS.escape(pathKeyValue)}"] [data-rt-host]`,
      );
      if (!host) return;

      host.focus();
      const html = act(host);

      const path = parsePathKey(pathKeyValue);
      if (path?.kind !== 'block') return;
      commit(
        (current) =>
          updateBlockProps(current, path.section, path.row, path.column, path.block, { html }),
        `rt:${pathKeyValue}`,
      );
    },
    [commit],
  );

  const undo = useCallback(() => {
    lastEdit.current = null;
    setHistory((current) => {
      if (current.past.length === 0) return current;
      const previous = current.past[current.past.length - 1];
      return {
        past: current.past.slice(0, -1),
        present: previous,
        future: [current.present, ...current.future].slice(0, HISTORY_LIMIT),
      };
    });
  }, []);

  const redo = useCallback(() => {
    lastEdit.current = null;
    setHistory((current) => {
      if (current.future.length === 0) return current;
      const [next, ...rest] = current.future;
      return {
        past: [...current.past, current.present].slice(-HISTORY_LIMIT),
        present: next,
        future: rest,
      };
    });
  }, []);

  // ---------------------------------------------------------------------
  // Keyboard
  // ---------------------------------------------------------------------

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const meta = event.metaKey || event.ctrlKey;
      if (!meta) return;

      const key = event.key.toLowerCase();
      if (key === 'z' && !event.shiftKey) {
        event.preventDefault();
        undo();
      } else if ((key === 'z' && event.shiftKey) || key === 'y') {
        event.preventDefault();
        redo();
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [undo, redo]);

  // Warn on navigate away while a save is pending or has failed. The failed
  // case matters more than the pending one: that work exists only in this
  // tab, and closing it loses the lot.
  useEffect(() => {
    function onBeforeUnload(event: BeforeUnloadEvent) {
      if (saved === 'saving' || saved === 'error') event.preventDefault();
    }
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [saved]);

  // ---------------------------------------------------------------------
  // Selection
  // ---------------------------------------------------------------------

  const selectedKey = selected ? pathKey(selected) : null;

  // A structural edit can leave the selection pointing at something that no
  // longer exists. Clear it rather than letting the properties pane render
  // stale fields.
  useEffect(() => {
    if (selected && resolve(page, selected) === null) setSelected(null);
  }, [page, selected]);

  const select = useCallback((path: Path | null) => {
    setSelected(path);
    if (path && path.kind !== 'page') setMobilePane('props');
  }, []);

  /*
   * The + on the contextual toolbar. Each container adds the thing it holds: a
   * section adds a sibling section (through the same picker the seam buttons
   * use), a row adds a column, and a column or a block adds a block through the
   * block picker. So the + always does the obvious next thing for whatever was
   * clicked, rather than one meaning for all four.
   */
  const addToItem = useCallback(() => {
    if (!selected) return;
    switch (selected.kind) {
      case 'section':
        setInsertAt(selected.section + 1);
        return;
      case 'row':
        commit((current) => addColumn(current, selected.section, selected.row));
        return;
      case 'column':
      case 'block':
        setPicker({ section: selected.section, row: selected.row, column: selected.column });
        return;
      default:
        return;
    }
  }, [selected, commit]);

  // ---------------------------------------------------------------------
  // Import and export
  // ---------------------------------------------------------------------

  const exportJson = useCallback(() => {
    const blob = new Blob([JSON.stringify(page, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${page.slug || 'page'}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }, [page]);

  const importJson = useCallback(
    (file: File) => {
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const result = parsePage(JSON.parse(String(reader.result)));
          if (!result.ok) {
            window.alert(`That file is not a valid page:\n\n${result.errors.slice(0, 6).join('\n')}`);
            return;
          }
          setSelected(null);
          commit(result.page);
        } catch {
          window.alert('That file is not valid JSON.');
        }
      };
      reader.readAsText(file);
    },
    [commit],
  );

  /**
   * Put a built section in at the pending index and select it.
   *
   * The index is read from insertAt and cleared BEFORE the commit, not after: the
   * commit is what closes the dialog by re-rendering, and reading insertAt inside
   * the updater would be reading state the updater is not allowed to depend on.
   */
  /**
   * Put one or more sections in at the insertion point.
   *
   * PLURAL AT THE BOTTOM, because an import is usually a whole page and calling
   * the single version in a loop does not work: it clears insertAt on the first
   * call, so every section after the first would find no insertion point and
   * silently vanish. One splice, one commit, one entry in the undo history, so
   * an import that was not what somebody wanted is one undo away rather than
   * eight.
   */
  const insertSections = useCallback(
    (incoming: Section[]) => {
      const at = insertAt;
      if (at === null || !incoming.length) return;

      setInsertAt(null);
      commit((current) => {
        const sections = [...current.sections];
        sections.splice(at, 0, ...incoming);
        return { ...current, sections };
      });
      setSelected({ kind: 'section', section: at });
    },
    [insertAt, commit],
  );

  const insertSection = useCallback(
    (section: Section) => insertSections([section]),
    [insertSections],
  );

  const fileInput = useRef<HTMLInputElement>(null);

  const savedLabel = useMemo(() => {
    // Plain language about the work, not about the mechanism. An agent wants
    // to know their page is safe, not which system it went to.
    if (saved === 'saving') return 'Saving';
    if (saved === 'saved') return 'All changes saved';
    if (saved === 'error') return 'Not saved';
    return '';
  }, [saved]);

  const publishLabel = useMemo(() => {
    if (publishing) return 'Publishing';
    if (status !== 'published') return 'Publish';
    return unpublished ? 'Publish changes' : 'Published';
  }, [publishing, status, unpublished]);

  // ---------------------------------------------------------------------

  return (
    <div
      className="ed-root"
      data-pane={mobilePane}
      data-theme={theme}
      data-outline={panels.outline ? undefined : 'folded'}
      data-props={panels.props ? undefined : 'folded'}
    >
      <header className="ed-topbar">
        {/*
          A plain anchor, not next/link, for two reasons. Leaving the editor
          should re-fetch the page list from the server rather than soft
          navigate to a cached one that predates these edits. And next/link
          drags Next's runtime into the standalone bundle, which has no Next
          in it, so importing it broke that build outright.
        */}
        <a className="ed-brand" href="/sites" title="All pages">
          <span className="ed-brand__mark" aria-hidden="true">
            TG
          </span>
          <span>Sites</span>
        </a>

        <button
          type="button"
          className="ed-btn ed-mobile-only"
          data-icon="true"
          aria-label="Show the page outline"
          onClick={() => setMobilePane(mobilePane === 'outline' ? 'canvas' : 'outline')}
        >
          <Icon name="section" size={18} />
        </button>

        <div className="ed-titlewrap">
          {/*
            A region has no title to edit. It would have been easy to leave the
            box there holding the word "Header", and it would have been a lie:
            pageAsRegion throws the title away, so anything typed into it would
            vanish on the next reload with nothing to explain why.
          */}
          {region ? (
            <span className="ed-title-fixed">{REGION_TITLES[region]}</span>
          ) : (
            <input
              className="ed-title-input"
              value={page.title}
              aria-label="Page title"
              onChange={(event) =>
                commit((current) => ({ ...current, title: event.target.value }), 'page:title')
              }
            />
          )}
          <span className="ed-save ed-desktop-only" data-state={saved}>
            {saved === 'saved' && <Icon name="check" size={14} />}
            {saved === 'error' && <Icon name="warning" size={14} />}
            {savedLabel}
          </span>
        </div>

        {/*
          The failure is stated where the work is, not in a toast that fades.
          Losing an unsaved page is the worst thing this editor can do to
          someone, so the message stays put until a save succeeds.
        */}
        {saveError && (
          <p className="ed-savefail" role="alert">
            {saveError}
          </p>
        )}

        {/*
          Icons carry a label on desktop and stand alone on narrow screens,
          where they keep their aria-label. Never icon-only without one.
        */}
        {/*
          THE TWO PANELS, FOLDED AWAY.
          Andy, 31 Jul 2026: "the desktop button should force a wider canvas.
          best way to achieve this is to make the l[e]ft and [right] areas
          collapsible". The preview is a container query context, so what it
          shows follows the CANVAS width and not the window's: at 1440px the two
          320px panels leave it 752px, under the 767px phone breakpoint, so
          Desktop was showing the phone layout. Folding a panel gives that width
          back.
        */}
        <div className="ed-seg ed-desktop-only" role="group" aria-label="Panels">
          <button
            type="button"
            className="ed-btn"
            data-icon="true"
            aria-pressed={!panels.outline}
            aria-label={panels.outline ? 'Hide the page panel' : 'Show the page panel'}
            title={panels.outline ? 'Hide the page panel' : 'Show the page panel'}
            onClick={() => setPanels((current) => ({ ...current, outline: !current.outline }))}
          >
            <Icon name="panel-left" size={16} />
          </button>
          <button
            type="button"
            className="ed-btn"
            data-icon="true"
            aria-pressed={!panels.props}
            aria-label={panels.props ? 'Hide the settings panel' : 'Show the settings panel'}
            title={panels.props ? 'Hide the settings panel' : 'Show the settings panel'}
            onClick={() => setPanels((current) => ({ ...current, props: !current.props }))}
          >
            <Icon name="panel-right" size={16} />
          </button>
        </div>

        <div className="ed-seg ed-desktop-only" role="group" aria-label="Preview width">
          {VIEWPORTS.map((option) => (
            <button
              key={option.value}
              type="button"
              className="ed-btn"
              aria-pressed={viewport === option.value}
              title={
                option.value === 'desktop'
                  ? 'Desktop. Folds the panels away if the preview is too narrow to be one.'
                  : option.label
              }
              onClick={() => chooseViewport(option.value)}
            >
              <Icon name={option.icon} size={16} />
              {option.label}
            </button>
          ))}
        </div>

        {/*
          THE WIDTH IT IS DRAWN AT, for whichever preview is showing.
          Andy, 31 Jul 2026: "desktop default should be about 1200 but they
          should be able to select bigger or smaller". A box rather than only a
          menu of presets, because "bigger or smaller" is a nudge and a menu
          cannot do a nudge. The menu beside it carries the sizes worth having
          an opinion about.
        */}
        <div className="ed-vw ed-desktop-only">
          <input
            className="ed-vw__num"
            type="number"
            min={MIN_VIEWPORT}
            max={MAX_VIEWPORT}
            step={10}
            value={widths[viewport]}
            aria-label={`${VIEWPORTS.find((v) => v.value === viewport)?.label} width in pixels`}
            onChange={(event) => {
              // Not clamped while it is being typed: clamping mid-keystroke
              // turns "4" on the way to "430" into "320" and the caret jumps.
              const next = Number(event.target.value);
              if (Number.isFinite(next)) setWidths((c) => ({ ...c, [viewport]: next }));
            }}
            onBlur={(event) =>
              setWidths((c) => ({
                ...c,
                [viewport]: normaliseViewportWidth(event.target.value, VIEWPORT_DEFAULT[viewport]),
              }))
            }
          />
          <span className="ed-vw__unit" aria-hidden="true">px</span>
          {actualWidth !== null && (
            <span
              className="ed-vw__actual"
              title={`There is only room for ${actualWidth}px. Fold a panel for the full width.`}
            >
              showing {actualWidth}
            </span>
          )}
          <Menu
            label="Common widths"
            icon="chevron-down"
            items={[
              { heading: `${VIEWPORTS.find((v) => v.value === viewport)?.label} widths` },
              ...VIEWPORT_PRESETS[viewport].map((preset) => ({
                icon: 'blank' as IconName,
                label: preset.label,
                hint: `${preset.width}px`,
                checked: widths[viewport] === preset.width,
                onClick: () => setWidths((c) => ({ ...c, [viewport]: preset.width })),
              })),
              { separator: true as const },
              {
                icon: 'undo' as IconName,
                label: 'Back to the standard',
                hint: `${VIEWPORT_DEFAULT[viewport]}px`,
                onClick: () =>
                  setWidths((c) => ({ ...c, [viewport]: VIEWPORT_DEFAULT[viewport] })),
              },
            ]}
          />
        </div>

        <button
          type="button"
          className="ed-btn"
          data-icon="true"
          onClick={undo}
          disabled={history.past.length === 0}
          aria-label="Undo"
          title="Undo (Cmd+Z)"
        >
          <Icon name="undo" size={18} />
        </button>
        <button
          type="button"
          className="ed-btn"
          data-icon="true"
          onClick={redo}
          disabled={history.future.length === 0}
          aria-label="Redo"
          title="Redo (Cmd+Shift+Z)"
        >
          <Icon name="redo" size={18} />
        </button>

        {/*
          Disabled once published with nothing new to say, rather than hidden.
          A button that vanishes leaves an agent wondering where it went; one
          that reads "Published" and sits still answers the question.
        */}
        <button
          type="button"
          className="ed-btn"
          data-variant="primary"
          onClick={publish}
          disabled={publishing || (status === 'published' && !unpublished)}
          title={
            status === 'published' && !unpublished
              ? `The live ${region ?? 'page'} already matches this draft`
              : region
                ? `Put this ${region} on every page of the site`
                : 'Make this the version visitors see'
          }
        >
          <Icon name={status === 'published' && !unpublished ? 'check' : 'upload'} size={16} />
          {publishLabel}
        </button>

        <Menu
          label="More actions"
          items={[
            { heading: 'Appearance' },
            ...THEMES.map((option) => ({
              icon: 'blank' as const,
              label: option.label,
              checked: theme === option.value,
              onClick: () => setTheme(option.value),
            })),
            /*
              Version history is per page, and publish_events has a page_id.
              A region publishes without a snapshot, so there is nothing here to
              list and the entry is left out rather than opening an empty box.
            */
            ...(region
              ? []
              : [
                  { separator: true as const },
                  {
                    icon: 'history' as IconName,
                    label: 'Version history',
                    onClick: () => setHistoryOpen(true),
                  },
                ]),
            { separator: true },
            {
              icon: 'download',
              label: region ? `Save a copy of this ${region}` : 'Save a copy of this page',
              onClick: exportJson,
            },
            {
              // Named for what it does. It restores a page this editor
              // exported, and calling it "Import" invited the reasonable
              // assumption that it takes HTML or a Figma file.
              icon: 'upload',
              label: 'Open a saved page file',
              onClick: () => fileInput.current?.click(),
            },
          ]}
        />

        <input
          ref={fileInput}
          type="file"
          accept="application/json"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) importJson(file);
            event.target.value = '';
          }}
        />
      </header>

      <Outline
        onAddSection={() => setInsertAt(page.sections.length)}
        page={page}
        selectedKey={selectedKey}
        onSelect={select}
        onCommit={commit}
        onPickBlock={setPicker}
        newId={newId}
      />

      <Canvas
        onInsertSection={setInsertAt}
        editingPath={editingPath}
        page={page}
        selectedKey={selectedKey}
        selected={selected}
        viewportWidth={`${widths[viewport]}px`}
        viewport={viewport}
        onSelect={select}
        onCommit={commit}
        onPickBlock={setPicker}
        theme={siteTheme}
        // So the canvas draws a header as a header rather than as a page.
        region={region}
        /*
          "This page is empty" is the wrong sentence on the header screen, and
          it is the sentence somebody meets FIRST, since a client who has never
          touched their header has an empty one. The browser harness caught it.
        */
        emptyNote={
          region === 'header'
            ? 'Your header is empty. Add a section for your logo and menu.'
            : region === 'footer'
              ? 'Your footer is empty. Add a section for your contact details and links.'
              : itemId
                ? 'Nothing written yet. Add a section and start the article.'
                : undefined
        }
      />

      <Properties
        page={page}
        selected={selected}
        isStaff={isStaff}
        onSelect={select}
        onCommit={commit}
        onBack={() => setMobilePane('canvas')}
        region={region}
        regionFlags={regionFlags}
        onRegionFlags={setRegionFlags}
        isItem={!!itemId}
        itemMeta={itemMeta}
        onItemMeta={setItemMeta}
      />

      {/*
        THE CONTEXTUAL TOOLBAR, on the item you clicked.

        Shown for any canvas item (section, row, column, block) that is
        selected, and hidden while a modal is up so it does not float over a
        picker. The page root is reached through the breadcrumb rather than by
        clicking the canvas, so it never gets one. `editing` is passed through
        so the pill drops its own Edit button while the words are being typed,
        leaving the formatting toolbar to do that job.
      */}
      {selected
        && selected.kind !== 'page'
        && selectedKey
        && insertAt === null
        && picker === null
        && !historyOpen && (
        <ItemToolbar
          key={selectedKey}
          page={page}
          selected={selected}
          selectedKey={selectedKey}
          editing={!!editing}
          newId={newId}
          onAdd={addToItem}
          onCommit={commit}
          options={{
            isStaff,
            region,
            regionFlags,
            onRegionFlags: setRegionFlags,
            isItem: !!itemId,
            itemMeta,
            onItemMeta: setItemMeta,
          }}
        />
      )}

      {/*
        THE FORMATTING TOOLBAR, not inside the properties pane's field.
        It formats whatever is selected on the CANVAS, which is where the words
        are. Mounted while a paragraph OR a heading is being edited, which since
        31 Jul 2026 is both of the blocks you can type into in place.
      */}
      {editing && (
        <TextToolbar
          key={editing.path}
          anchor={null}
          oneLine={editing.oneLine}
          onExec={(command, value) =>
            withHost(editing.path, (host) => {
              document.execCommand(command, false, value);
              return host.innerHTML;
            })
          }
          /*
           * Colour, size and font, applied by wrapping the selection ourselves.
           *
           * Not through execCommand: the browser resolves a value before storing
           * it, so asking it for the brand colour would freeze these words at
           * whatever the brand happened to be today. Wrapping it here stores the
           * token, and the words follow the theme when it changes.
           */
          onStyle={(property, value) =>
            withHost(editing.path, (host) => {
              wrapSelection(host, property, value);
              return host.innerHTML;
            })
          }
          /*
           * The writing assistant, behind the same door as everything else.
           *
           * The action does the deciding: whether this person is a member, what
           * the site's tone of voice is, whether there is any allowance left. The
           * toolbar is handed a promise and a result, and knows none of it. That
           * is why the panel can be driven in the standalone review copy, which
           * has a double for this and no server at all.
           */
          onWrite={(request) => writeCopyAction(request)}
          align={editing.align}
          onAlign={(value) => {
            const path = parsePathKey(editing.path);
            if (path?.kind !== 'block') return;
            commit((current) =>
              updateBlockProps(current, path.section, path.row, path.column, path.block, {
                align: value,
              }),
            );
          }}
        />
      )}

      {historyOpen && (
        <PublishHistory
          pageId={pageId}
          currentUserId={currentUserId}
          onClose={() => setHistoryOpen(false)}
          onRestore={(restored) => {
            /*
             * Through commit, like every other whole-page change, so a restore
             * joins the undo stack. Somebody who puts back the wrong version
             * presses Ctrl+Z rather than hunting for the one they were on.
             *
             * The selection is cleared first because it points at a path in the
             * page that just went away: keeping it would leave the properties
             * pane describing a block that no longer exists.
             */
            setSelected(null);
            commit(restored);
          }}
        />
      )}

      {insertAt !== null && (
        <SectionPicker
          // Which designed sections are worth offering. A page gets the page
          // ones, the header screen gets headers, the footer screen footers.
          scope={region ?? 'page'}
          onClose={() => setInsertAt(null)}
          /*
           * Two callbacks rather than one taking a union, so neither path has to
           * ask what it was handed. They do the same three things afterwards,
           * which insertSection holds once.
           */
          onPickLayout={(layout) => insertSection(createSectionFromLayout(layout))}
          onPickPreset={(preset) => insertSection(buildPresetSection(preset))}
          /*
           * The third path takes MANY, because one paste is usually a whole
           * page. Going through insertSections rather than calling
           * insertSection in a loop is not tidiness: insertAt is cleared by the
           * first call, so the second and every one after it would find no
           * insertion point and quietly do nothing.
           */
          onPickImported={(sections) => insertSections(sections)}
        />
      )}

      {picker && (
        <BlockPicker
          isStaff={isStaff}
          onClose={() => setPicker(null)}
          onPick={(type) => {
            const target = picker;
            setPicker(null);

            // Computed here rather than inside the updater: a state updater
            // must be pure, and React calls it twice in development. The new
            // block always lands last in the column, so the index is known
            // without reading the result back.
            const index = page.sections[target.section]?.rows[target.row]?.columns[target.column]
              ?.blocks.length;
            if (index === undefined) return;

            commit((current) => addBlock(current, target.section, target.row, target.column, createBlock(type)));
            setSelected({ kind: 'block', ...target, block: index });
          }}
        />
      )}
    </div>
  );
}
