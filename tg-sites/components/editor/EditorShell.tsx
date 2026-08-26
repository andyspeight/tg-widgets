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
import { createAiPageAction, writeCopyAction } from '../../app/actions/ai';
import { buildDesignedSectionAction } from '../../app/actions/designed';
import {
  createPageAction,
  movePageAction,
  publishPageAction,
  saveDraftAction,
} from '../../app/actions/pages';
import { publishRegionAction, saveRegionAction } from '../../app/actions/regions';
import { publishItemAction, saveItemAction } from '../../app/actions/collections';
import { listPageCommentsAction, openCommentCountAction } from '../../app/actions/comments';
import { PublishHistory } from './PublishHistory';
import type { NavPage } from '../../lib/content/nav';
import type { Page, RegionName, Section } from '../../lib/content/schema';
import { parsePage } from '../../lib/content/schema';
import { pageAsRegion, REGION_TITLES } from '../../lib/content/region-page';
import type { FieldDef } from '../../lib/content/collection-fields';
import { pageAsItem, type ItemMeta } from '../../lib/content/collection-page';
import { ALL_CAPABILITIES, type Capability } from '../../lib/auth/permissions';
import { blockLabel, createBlock, createSectionFromLayout, newId } from '../../lib/content/factory';
import { buildPresetSection } from '../../lib/content/presets';
import { addBlock, addColumn, addInnerBlock, blockAtPath, containerColumns, locateBlockById, moveBlockTo, moveSection, parsePathKey, type Path, pathKey, resolve, updateBlockPropsAtPath } from '../../lib/content/tree';
import { hasInnerColumns } from '../../lib/content/inner-columns';
import { inlineEditableFields, richInlineField } from '../../lib/editor/inline-edit';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  type DragMoveEvent,
} from '@dnd-kit/core';
import { blockDefinition } from '../../lib/content/blocks';
import { usePaletteDrop } from './usePaletteDrop';
import { useSectionDrop } from './useSectionDrop';
import { Outline } from './Outline';
import { Rail } from './Rail';
import { CommentsPanel } from './CommentsPanel';
import { PagesPanel, type PageLink } from './PagesPanel';
import { Canvas, type DropTarget } from './Canvas';
import { wasFilled, type SeoFilled } from '../../lib/seo/autofill';
import { outlineCollision } from './outline-collision';
import { resolveOutlineMove, type OutlineDragItem } from './outline-move';
import type { PreparedMap } from '../../lib/content/prepared';
import type { ListingCards } from '../../lib/db/listings';
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
 * The one block a container's inner column may not hold: another container.
 *
 * A module constant so the picker prop is a stable reference, and named so the
 * one-level-deep rule is greppable. See the container block in
 * lib/content/blocks.ts and the matching refusal in addBlockAt.
 */
const CONTAINER_ONLY: readonly string[] = ['container', 'grid'];

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
/**
 * Where a page's content actually stops, from --tgs-width-contained.
 *
 * THE THRESHOLD THAT DECIDES WHETHER THE PREVIEW IS TRUE, which is not the same
 * as the chosen viewport width and is the more useful thing to say. A contained
 * section caps its inner at this, so from here upward every desktop width lays
 * out identically: measured on a real page, the hero's heading box was 1068px at
 * a 1200px viewport and 1068px at 2560px. Above this line the canvas is exact
 * however narrow the window is; below it, text wraps in places it will not wrap
 * on the published site.
 *
 * Andy hit this on 25 Aug 2026 with a headline on one line live and two in the
 * editor, and the old badge could not have told him why: it compared the drawn
 * width against the width he had CHOSEN, so 1150px warned while being perfectly
 * faithful and 1050px warned in the same words while not being.
 *
 * Kept in step with globals.css by tests/editor-fidelity.test.ts.
 */
const CONTAINED_WIDTH = 1100;

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

/**
 * Which of the three trees is being edited right now.
 *
 * A page has a header above it and a footer below it, and since 12 Aug 2026 you
 * edit all three on the one canvas: click the header or the footer and it becomes
 * the thing you are editing, with the page shown around it. 'page' is the middle
 * one and where editing starts.
 */
export type Tree = 'page' | RegionName;

/**
 * The site's header or footer, as everything the shell needs to draw it AND to
 * edit it in place.
 *
 * Slice 1 only drew them, so a Page was enough. Editing one in place means the
 * shell also has to know how it is saved and published: its two settings, and
 * whether it is already live with newer changes waiting. Read from the region
 * record in the same breath as the page. See app/editor/page.tsx.
 */
export interface ChromeRegion {
  content: Page;
  sticky: boolean;
  overlay: boolean;
  published: boolean;
  unpublished: boolean;
}

interface EditorProps {
  isStaff?: boolean;
  /**
   * What this member may do, so the editor draws only the controls they can use.
   * The server enforces the same set at every save (lib/auth/capabilities.ts), so
   * this is a courtesy rather than the control: it keeps a content-only client
   * from being shown an Add button or a design panel that would only refuse them.
   *
   * Optional and defaults to everything, so the standalone build and any caller
   * that does not pass it get the full editor exactly as before.
   */
  caps?: readonly Capability[];
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
   * The site's other pages, for the rail's Pages panel to list.
   *
   * Optional so the standalone build and the region and item screens still
   * work without it: an absent list is an empty one, and the panel says so.
   * Just the little each row needs (see PageLink); the content stays in the
   * database until you open a page.
   */
  pages?: readonly PageLink[];
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
  /**
   * What this entry's collection declares its entries have.
   *
   * Read on the server with the entry itself, and not editable here: the schema
   * belongs to the collection and is changed on the collections screen. This is
   * the list the properties pane draws its form from.
   */
  itemFields?: FieldDef[];
  /**
   * The site's header and footer, to show around the page on the canvas and,
   * since slice 2, to edit in place.
   *
   * When you are editing a page, the header and the footer are what wraps every
   * page, so seeing them is the difference between editing a page and editing a
   * page in the site it lives in. Click one and it becomes the thing you are
   * editing, saved to the region rather than the page, with the page shown around
   * it. So the shell holds all three trees and swaps which one is live.
   *
   * Only set when editing a page. A region screen (?region=) is already editing
   * one of these on its own, and drawing a header around a header is a hall of
   * mirrors.
   */
  /**
   * Markup the server cleaned for every tree this shell opened with, by block id.
   * The canvas cannot clean it itself and asks for anything made afterwards; this
   * is only so an existing page draws on the first paint rather than flashing its
   * placeholders. See lib/content/prepared.ts.
   */
  preparedSeed?: PreparedMap;
  /**
   * The cards a collection-backed grid will draw, by listing key.
   *
   * Beside the tree rather than in it, for the same reason preparedSeed is:
   * this tree is the document being edited, and folding the cards into
   * `props.items` would let a save bake today's listing into the page. The
   * canvas fills a copy of the tree at the moment it draws. See
   * lib/db/listings.ts.
   */
  listings?: ListingCards;
  chromeHeader?: ChromeRegion | null;
  chromeFooter?: ChromeRegion | null;
  /**
   * A comment thread to open on, arrived at from the whole-site review list on
   * another page. Carried in the address (?comment=), it opens the Comments panel
   * on that thread and jumps to the element it pins to. Only meaningful when
   * editing a page.
   */
  focusComment?: string | null;
}

export function EditorShell({
  isStaff = true,
  caps = ALL_CAPABILITIES,
  pageId,
  initialPage,
  initialStatus,
  initialHasUnpublishedChanges,
  siteTheme,
  currentUserId = null,
  pages = [],
  region: initialRegion = null,
  initialRegionFlags,
  itemId = null,
  initialItemMeta,
  itemFields,
  preparedSeed,
  listings,
  chromeHeader = null,
  chromeFooter = null,
  focusComment = null,
}: EditorProps) {
  /*
   * The two answers the editor's own drawing keys on. `structure` covers adding,
   * moving and restyling: the rail's Add, the section and block pickers, and the
   * design panels in the properties pane. `publish` covers putting changes live.
   * Everything a content-only client is allowed, editing the words, swapping a
   * photo, changing a link, stays on regardless. Staff and an unset owner have
   * every capability, so for them these are both true and nothing changes.
   */
  const canStructure = caps.includes('structure');
  const canPublish = caps.includes('publish');
  const [history, setHistory] = useState<History>({
    past: [],
    present: initialPage,
    future: [],
  });

  /**
   * Which of the three trees is being edited: the page, the header or the footer.
   *
   * On a page it starts on the page and switches when you click the chrome. On a
   * region screen (?region=) or an item there is only ever the one tree, so this
   * is fixed and the switch below is never reachable. `region` is derived from it
   * so every save, publish and title that keyed on the old region prop still does.
   */
  const [activeTree, setActiveTree] = useState<Tree>(initialRegion ?? 'page');
  const region = activeTree === 'page' ? null : activeTree;

  /**
   * The two trees you are NOT editing, as content for the chrome bands and as the
   * stash a switch restores from. The active tree's slot is left null: its live
   * copy is history.present, and it is filled back in when you switch away.
   */
  const [otherContent, setOtherContent] = useState<Record<Tree, Page | null>>(() => ({
    page: null,
    header: chromeHeader?.content ?? null,
    footer: chromeFooter?.content ?? null,
  }));
  /** The same two trees' status and unpublished flag, swapped in on a switch. */
  const [otherMeta, setOtherMeta] = useState<Record<Tree, { status: 'draft' | 'published'; unpublished: boolean }>>(
    () => ({
      page: { status: initialStatus, unpublished: initialHasUnpublishedChanges },
      header: chromeHeader
        ? { status: chromeHeader.published ? 'published' : 'draft', unpublished: chromeHeader.unpublished }
        : { status: 'draft', unpublished: false },
      footer: chromeFooter
        ? { status: chromeFooter.published ? 'published' : 'draft', unpublished: chromeFooter.unpublished }
        : { status: 'draft', unpublished: false },
    }),
  );
  const [selected, setSelected] = useState<Path | null>(null);
  const [viewport, setViewport] = useState<Viewport>('desktop');
  /**
   * Where the block picker will add. An ordinary column names section, row and
   * column; a container's inner column also names its `block` and `inner`, and
   * the pick routes to addInnerBlock. See DropTarget.
   */
  const [picker, setPicker] = useState<DropTarget | null>(null);
  /** Where a new section would go. null means the picker is closed. */
  const [insertAt, setInsertAt] = useState<number | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);

  /*
   * Whether the on-canvas options popover is open, held here rather than inside
   * the toolbar so the right-hand pane can step aside for it. WHY IT HAS TO BE
   * HERE: the popover and the pane draw the SAME fields, and drawing both live
   * at once put two copies of every control on the screen, which read as flaky
   * and duplicated the moment Andy tried one (3 Aug 2026). One editing surface
   * at a time: while this is true the pane shows a short note and the popover is
   * where you edit; closed, the pane is the editor as before.
   */
  const [optionsOpen, setOptionsOpen] = useState(false);

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
    initialRegionFlags
      ?? (chromeHeader
        ? { sticky: chromeHeader.sticky, overlay: chromeHeader.overlay }
        : { sticky: false, overlay: false }),
  );
  /**
   * A post's summary, picture and address, which have nowhere to live in a Page.
   *
   * Not in the undo history, for the same reason the header's two settings are
   * not: undo is about content, and every step carrying a copy of six strings
   * for the sake of a date field would be a poor trade.
   */
  const [itemMeta, setItemMeta] = useState<ItemMeta>(
    initialItemMeta ?? {
      title: '',
      summary: '',
      image: '',
      alt: '',
      author: '',
      date: '',
      tags: [],
      fields: {},
      slug: '',
    },
  );
  const [unpublished, setUnpublished] = useState(initialHasUnpublishedChanges);
  /*
   * WHAT THE LAST PUBLISH WROTE FOR THEM, or null. A page published with no
   * search title or description gets one written from its own words (#239), and
   * this is what the panel afterwards shows. Never silent: a client should not
   * find out that AI-written words are representing them in Google by reading
   * Google.
   */
  const [seoFilled, setSeoFilled] = useState<SeoFilled | null>(null);
  /** How many picture descriptions the last publish wrote in. */
  const [altsFilled, setAltsFilled] = useState(0);
  const [publishing, setPublishing] = useState(false);
  const [mobilePane, setMobilePane] = useState<'canvas' | 'props' | 'outline'>('canvas');
  /**
   * Which side panels are open. Both, until somebody folds one away.
   *
   * Remembered, like the light or dark choice and the toolbar's position: it is
   * how somebody likes to work, not something about the page.
   */
  const [panels, setPanels] = useState({ outline: true, props: true });
  /**
   * Which panel the rail's expanding column is showing: the outline (Layers) or
   * the site's pages. Whether that column is OPEN is still panels.outline, the
   * same fold the top bar owns; this only says which of the two fills it when it
   * is open. Held here, not in the rail, because the shell draws the column.
   */
  // Arriving on a comment (from the whole-site list on another page) opens the
  // Comments panel straight away rather than the outline.
  const [railPanel, setRailPanel] = useState<'layers' | 'pages' | 'comments'>(
    focusComment ? 'comments' : 'layers',
  );

  /*
   * The number behind the rail's Comments badge: how many threads are open across
   * the whole site. Read once on mount, and again whenever the panel changes
   * something (it calls back through onCountChange), so the badge follows a
   * resolve or a new comment without a reload. Only pages carry comments, so the
   * region and item screens never ask.
   */
  const [openComments, setOpenComments] = useState(0);
  // The open threads pinned to an element on THIS page, so the canvas can mark
  // each with a pin. Just the id and the block it is about; the panel holds the
  // rest.
  const [pageAnchors, setPageAnchors] = useState<{ threadId: string; blockId: string }[]>([]);
  const refreshComments = useCallback(() => {
    if (region || itemId) return;
    void openCommentCountAction().then((result) => {
      if (result.ok) setOpenComments(result.data);
    });
    void listPageCommentsAction({ pageId }).then((result) => {
      if (!result.ok) return;
      setPageAnchors(
        result.data
          .filter((thread) => !thread.resolved && thread.anchor)
          .map((thread) => ({ threadId: thread.id, blockId: thread.anchor as string })),
      );
    });
  }, [region, itemId, pageId]);
  useEffect(() => {
    refreshComments();
  }, [refreshComments]);

  // A thread to reveal in the panel, from the address (?comment=) or a click on a
  // canvas pin. Seeded from the URL so a cross-page jump lands on it.
  const [focusThread, setFocusThread] = useState<string | null>(focusComment);

  /*
   * The pages as the Menu block needs them, so a link that points at a folder
   * shows the pages inside it on the canvas, the same dropdown the published site
   * draws. Published true for all, because the editor should show a folder still
   * in draft; the live site passes the real status instead. The Canvas fills the
   * tree at the render boundary, so the tree the editor saves never carries them.
   */
  const navPages = useMemo<NavPage[]>(
    () =>
      pages.map((entry) => ({
        id: entry.id,
        title: entry.title,
        slug: entry.slug,
        parentId: entry.parentId,
        published: true,
      })),
    [pages],
  );

  /**
   * Make a new page and open it, for the rail's Pages panel.
   *
   * A new page is created through the same action the dashboard uses, then the
   * editor navigates to it, the same full navigation the panel's own rows make,
   * so the new page loads fresh with its own draft and the list picks it up.
   * Returns an error to show in the composer, or null on success, by which point
   * the browser is already leaving.
   *
   * The 'ai' template is the one that does not name a ready-made page: it carries
   * a brief, and a separate action has the model design the page before creating
   * it. Both actions return the same {ok, data:{id}} shape, so the navigation is
   * the same. The AI call is the slow one, which the composer's busy state covers.
   */
  const createPage = useCallback(
    async (title: string, template: string, brief?: string, imageId?: string): Promise<string | null> => {
      const result =
        template === 'ai'
          ? await createAiPageAction({ title, brief, imageId })
          : await createPageAction({ title, template });
      if (!result.ok) return result.error;
      window.location.assign(`/editor?page=${encodeURIComponent(result.data.id)}`);
      return null;
    },
    [],
  );

  /**
   * File a page into a folder, or back out to the top level, for the Pages panel.
   *
   * The panel has already moved the row on screen by the time this runs, so this
   * only tells the server and reports back: null on success, a message to show and
   * undo on failure. `parentId` is a page id to file inside, or null for the top
   * level. Nothing navigates, unlike creating a page: the list the panel holds is
   * the one that changed, and the current page is wherever it already was.
   */
  const movePage = useCallback(
    async (movedId: string, parentId: string | null): Promise<string | null> => {
      const result = await movePageAction(movedId, parentId);
      return result.ok ? null : result.error;
    },
    [],
  );
  /**
   * Preview mode: the canvas becomes the whole screen and shows the page as it
   * will publish, not as it is edited.
   *
   * Andy, 11 Aug 2026: a Preview button so you can see the site exactly as it
   * will be when published and interact with it as if it were live, with the
   * side panels out of the way. The panels are hidden by data-preview on the
   * root (see editor.css); the canvas renders editable=false and drops its
   * editing handlers (see Canvas). It is a view of the SAME in-memory draft, so
   * it reflects the current work including edits not yet saved.
   */
  const [preview, setPreview] = useState(false);
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
    // Whatever block can be typed into where it sits, in a column OR inside a
    // container: blockAtPath resolves either, and lib/editor/inline-edit decides
    // which blocks those are and how. A block is in edit mode if it has ANY
    // inline field (an icon item has two); `rich` is the single rich field, if
    // any, which tells a paragraph or a heading (formatting toolbar, HTML) from
    // a quote or an icon item (plain text, no toolbar).
    if (selected?.kind !== 'block' && selected?.kind !== 'inner-block') return null;
    const block = blockAtPath(page, selected);
    if (!block) return null;
    if (inlineEditableFields(block.type).length === 0) return null;
    const rich = richInlineField(block.type);

    const align = typeof block.props?.align === 'string' ? block.props.align : 'left';
    return { path: pathKey(selected), oneLine: rich?.oneLine ?? false, rich: Boolean(rich), align };
  }, [selected, page]);

  const editingPath = editing?.path ?? null;

  /*
   * The element a new comment would pin to: whatever block is selected, by its
   * stable id, with a readable label. Null when nothing, or a section or column,
   * is selected, in which case a comment is left on the page as a whole. The
   * Comments panel offers this as "pin to the selected element".
   */
  const commentAnchor = useMemo(() => {
    if (selected?.kind !== 'block' && selected?.kind !== 'inner-block') return null;
    const block = blockAtPath(page, selected);
    return block ? { id: block.id, label: blockLabel(block) } : null;
  }, [selected, page]);

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
   * Skips the save that switching trees would otherwise fire.
   *
   * Loading a tree replaces history.present, which the autosave effect cannot
   * tell from a real edit. Left alone it would write the target's own content
   * straight back and mark it as having unpublished changes it does not have. The
   * switch has already flushed the tree it left, so this one save is pure noise.
   */
  const suppressNextSave = useRef(false);

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
    if (suppressNextSave.current) {
      suppressNextSave.current = false;
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

    /*
     * A PAGE PUBLISH NOW ANSWERS WITH TWO THINGS: the summary, and anything the
     * search listing was filled in with on the way (#239). A region and an item
     * still answer with the summary alone, so this unwraps only the page's.
     */
    const outcome =
      result.ok && result.data && 'summary' in result.data
        ? (result.data as { summary: unknown; filled: SeoFilled; altsFilled: number })
        : null;
    if (outcome) {
      const wrote = wasFilled(outcome.filled) || outcome.altsFilled > 0;
      setSeoFilled(wrote ? outcome.filled : null);
      setAltsFilled(wrote ? outcome.altsFilled : 0);
    }

    const record = (outcome ? outcome.summary : result.ok ? result.data : null) as
      | { status: 'draft' | 'published'; hasUnpublishedChanges: boolean }
      | null;

    if (result.ok && record) {
      // A region has no status column: publishing one makes it live and there
      // is no way to withdraw it short of emptying it. So it is published from
      // here on, and only "are there newer changes" varies. A page and an item
      // both have one, and it is the answer.
      setStatus(region ? 'published' : record.status);
      setUnpublished(record.hasUnpublishedChanges);
    } else if (!result.ok) {
      setSaveError(result.error);
    }
    setPublishing(false);
  }, [itemId, page, pageId, persist, region, regionFlags, itemMeta]);

  /**
   * Switch which tree is being edited: click the header or the footer on the
   * canvas and it becomes the thing you are editing, with the page shown around
   * it. Clicking the page brings it back.
   *
   * The order matters and is the whole reason this is not a plain setState. The
   * tree you are leaving is FLUSHED to its own store first, synchronously, so a
   * switch can never drop the keystroke the debounce had not saved yet. Only then
   * is its content stashed and the target's swapped in: content into the history,
   * status and unpublished into their own state, so the top bar, the publish
   * button and "unsaved" all speak for the tree now on screen. The header's two
   * settings are not swapped, because they are the header's wherever you are.
   */
  const activateTree = useCallback(
    async (target: Tree) => {
      if (target === activeTree) return;
      const targetContent = otherContent[target];
      if (!targetContent) return;

      // Flush the tree being left through its own save path (region is still its
      // region here) before anything changes underneath it.
      await persist(page, regionFlags, itemMeta);

      const leaving = activeTree;
      const leavingContent = page;
      const leavingMeta = { status, unpublished };

      suppressNextSave.current = true;
      setOtherContent((current) => ({ ...current, [leaving]: leavingContent, [target]: null }));
      setOtherMeta((current) => ({ ...current, [leaving]: leavingMeta }));
      setHistory({ past: [], present: targetContent, future: [] });
      setStatus(otherMeta[target].status);
      setUnpublished(otherMeta[target].unpublished);
      setActiveTree(target);

      // The selection, the pickers and the on-canvas editors all belonged to the
      // tree you left, so drop them rather than let them point into the new one.
      setSelected(null);
      setInsertAt(null);
      setPicker(null);
      setOptionsOpen(false);
      setSaved('saved');
    },
    [activeTree, otherContent, otherMeta, page, persist, regionFlags, itemMeta, status, unpublished],
  );

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
      if (path?.kind !== 'block' && path?.kind !== 'inner-block') return;
      commit((current) => updateBlockPropsAtPath(current, path, { html }), `rt:${pathKeyValue}`);
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

  // The popover belongs to whatever is selected: a new selection starts with it
  // closed, so one item's options are never framed as another's, and the pane
  // comes back for the newly selected item until Edit is pressed again.
  useEffect(() => {
    setOptionsOpen(false);
  }, [selectedKey]);

  const select = useCallback((path: Path | null) => {
    setSelected(path);
    if (path && path.kind !== 'page') setMobilePane('props');
  }, []);

  /*
   * Naming and finding a pinned comment's element. The pin stores a block id;
   * resolveAnchorLabel turns it into a label for the panel, and jumpToAnchor
   * finds where that block sits now and selects it, so a reviewer can click a
   * pinned thread and land on the element it is about. A pin whose block has
   * since been deleted resolves to null and does not jump.
   */
  const resolveAnchorLabel = useCallback(
    (blockId: string): string | null => {
      const path = locateBlockById(page, blockId);
      if (!path) return null;
      const block = blockAtPath(page, path);
      return block ? blockLabel(block) : null;
    },
    [page],
  );

  const jumpToAnchor = useCallback(
    (blockId: string) => {
      const path = locateBlockById(page, blockId);
      if (path) select(path);
    },
    [page, select],
  );

  /*
   * The blocks on this page that carry an open comment, as canvas pins. Each
   * anchor's stable block id is resolved to its current data-path here, where the
   * page tree is in hand, and grouped so a block with two threads shows one pin
   * with a count. A pin whose block has since been deleted resolves to nothing
   * and simply does not appear.
   */
  const commentPins = useMemo(() => {
    if (region || itemId) return [] as { path: string; threadId: string; count: number }[];
    const byPath = new Map<string, { path: string; threadId: string; count: number }>();
    for (const anchor of pageAnchors) {
      const at = locateBlockById(page, anchor.blockId);
      if (!at) continue;
      const key = pathKey(at);
      const existing = byPath.get(key);
      if (existing) existing.count += 1;
      else byPath.set(key, { path: key, threadId: anchor.threadId, count: 1 });
    }
    return [...byPath.values()];
  }, [page, pageAnchors, region, itemId]);

  // A canvas pin opens the Comments panel on its thread.
  const openCommentThread = useCallback((threadId: string) => {
    setRailPanel('comments');
    setPanels((current) => ({ ...current, outline: true }));
    setFocusThread(threadId);
  }, []);

  /*
   * PREVIEW MODE ON AND OFF.
   *
   * Entering clears everything that floats over the canvas: the selection and
   * its contextual toolbar, any open options popover, the block picker, the
   * section inserter and the history panel. None of them belong over a preview,
   * and the toolbars go the moment nothing is selected. Escape leaves preview,
   * the same key that dismisses the popovers it stands in for.
   */
  const enterPreview = useCallback(() => {
    setSelected(null);
    setOptionsOpen(false);
    setPicker(null);
    setInsertAt(null);
    setHistoryOpen(false);
    setPreview(true);
  }, []);
  const exitPreview = useCallback(() => {
    setPreview(false);
    /*
     * Bring the side panels back on the way out. A large Desktop width folds them
     * to make room (chooseViewport), and leaving preview to a workspace with no
     * tools is what read as "preview ate my sidebars" (Andy, 11 Aug 2026). Exiting
     * preview is an explicit "back to editing", so it is the right moment to
     * reopen them; a width that cannot hold both then honestly shows the narrower
     * canvas rather than silently hiding the panels again.
     */
    setPanels({ outline: true, props: true });
  }, []);

  useEffect(() => {
    if (!preview) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setPreview(false);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [preview]);

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
      // A container's inner column, or a block inside one: the + adds into that
      // inner column, the same picker with the inner address on the target.
      case 'inner-column':
      case 'inner-block':
        setPicker({
          section: selected.section,
          row: selected.row,
          column: selected.column,
          block: selected.block,
          inner: selected.inner,
        });
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

  // Add a block at an explicit place. Shared by the canvas drop and the elements
  // palette, so a dropped block and a clicked one land the one same way.
  const addBlockAt = useCallback(
    (target: DropTarget, type: string) => {
      setPicker(null);

      /*
       * A CONTAINER'S INNER COLUMN. Routed to addInnerBlock, and a container is
       * never nested in a container: the model is one level deep and the picker
       * hides it there, but a drag comes from a palette that cannot know its
       * target, so the refusal lives here too. The container is selected
       * afterwards rather than the new inner block, because selecting inner nodes
       * to style or edit them arrives in a later slice.
       */
      if (target.inner !== undefined && target.block !== undefined) {
        if (hasInnerColumns(type)) return;
        const container =
          page.sections[target.section]?.rows[target.row]?.columns[target.column]?.blocks[target.block];
        const inner = container ? containerColumns(container)[target.inner] : undefined;
        if (!inner) return;
        const length = inner.blocks.length;
        const index = target.at === undefined ? length : Math.max(0, Math.min(target.at, length));
        commit((current) =>
          addInnerBlock(
            current,
            target.section,
            target.row,
            target.column,
            target.block!,
            target.inner!,
            createBlock(type),
            target.at,
          ),
        );
        // Select the new inner block, so its pane opens and a text or heading
        // drops straight into typing, exactly as adding a block to a column does.
        setSelected({
          kind: 'inner-block',
          section: target.section,
          row: target.row,
          column: target.column,
          block: target.block,
          inner: target.inner,
          innerBlock: index,
        });
        return;
      }

      const column = page.sections[target.section]?.rows[target.row]?.columns[target.column];
      if (!column) return;
      const length = column.blocks.length;
      const index = target.at === undefined ? length : Math.max(0, Math.min(target.at, length));
      commit((current) =>
        addBlock(current, target.section, target.row, target.column, createBlock(type), target.at),
      );
      setSelected({
        kind: 'block',
        section: target.section,
        row: target.row,
        column: target.column,
        block: index,
      });
    },
    [page, commit],
  );

  // Click-to-add from the elements palette. Lands in the selected column (after
  // the selected block, if one is selected), else the last column on the page.
  // An empty page has nowhere to put it, so it waits for a section.
  const addElement = useCallback(
    (type: string) => {
      if (selected && (selected.kind === 'column' || selected.kind === 'block')) {
        addBlockAt(
          {
            section: selected.section,
            row: selected.row,
            column: selected.column,
            at: selected.kind === 'block' ? selected.block + 1 : undefined,
          },
          type,
        );
        return;
      }
      const si = page.sections.length - 1;
      const sec = si >= 0 ? page.sections[si] : undefined;
      const ri = (sec?.rows.length ?? 0) - 1;
      const row = ri >= 0 ? sec?.rows[ri] : undefined;
      const ci = (row?.columns.length ?? 0) - 1;
      if (sec && row && ci >= 0) addBlockAt({ section: si, row: ri, column: ci }, type);
    },
    [selected, page, addBlockAt],
  );

  // ---------------------------------------------------------------------

  // --- One canvas drag context (dnd-kit): add from the palette, OR move a placed
  //     block. It wraps both the drag sources (the elements palette in the left
  //     pane, and the grip on a placed block's toolbar) and the drop target (the
  //     canvas). A move past 5px starts a drag, so a plain click still selects or
  //     adds. PointerSensor gives touch for nothing, which native drag could not.

  /*
   * A placed block dragged to a new spot. The SAME drop resolution as adding, so
   * the landing arrives as the same target descriptor; only the op differs.
   * TOP-LEVEL BLOCKS ONLY in this slice: moveBlockTo speaks column coordinates,
   * and a container's inner column has no cross-container move yet, so a drop onto
   * one is refused and the block stays put. Reselect by the block's own id, found
   * in the moved tree, so the toolbar follows it to wherever moveBlockTo actually
   * put it rather than to an index we second-guessed.
   */
  const moveBlockAt = useCallback(
    (from: { section: number; row: number; column: number; block: number }, target: DropTarget) => {
      if (target.inner !== undefined) return;
      const moving =
        page.sections[from.section]?.rows[from.row]?.columns[from.column]?.blocks[from.block];
      if (!moving) return;
      const next = moveBlockTo(page, from, {
        section: target.section,
        row: target.row,
        column: target.column,
        index: target.at,
      });
      commit(() => next);
      const destColumn = next.sections[target.section]?.rows[target.row]?.columns[target.column];
      const block = destColumn?.blocks.findIndex((candidate) => candidate.id === moving.id) ?? -1;
      if (block >= 0) {
        setSelected({ kind: 'block', section: target.section, row: target.row, column: target.column, block });
      }
    },
    [page, commit],
  );

  /*
   * A whole SECTION dragged to a new position. moveSection counts positions
   * AFTER the dragged section is lifted out, so a gap past the section's own
   * index shifts down by one; the resolver speaks in plain current-array gaps, so
   * that adjustment lives here. Reselect by the section's id in the moved tree,
   * so its toolbar and handle follow it to where it landed.
   */
  const moveSectionAt = useCallback(
    (from: number, gap: number) => {
      const moving = page.sections[from];
      if (!moving) return;
      const to = gap > from ? gap - 1 : gap;
      const next = moveSection(page, from, to);
      commit(() => next);
      const section = next.sections.findIndex((candidate) => candidate.id === moving.id);
      if (section >= 0) setSelected({ kind: 'section', section });
    },
    [page, commit],
  );

  // What is being dragged right now: a new block to add, a placed block to move,
  // or a whole section to reorder. Held in state for the ghost the overlay draws,
  // and mirrored in a ref so the drop callbacks read it without going stale.
  type ActiveDrag =
    | { kind: 'add'; type: string }
    | {
        kind: 'move';
        from: { section: number; row: number; column: number; block: number };
        label: string;
      }
    | { kind: 'move-section'; from: number; label: string };
  const [activeDrag, setActiveDrag] = useState<ActiveDrag | null>(null);
  const activeDragRef = useRef<ActiveDrag | null>(null);

  // Where a block drop lands (add a new block, or move a placed one).
  const dropOnCanvas = useCallback(
    (target: DropTarget) => {
      const drag = activeDragRef.current;
      if (!drag) return;
      if (drag.kind === 'add') addBlockAt(target, drag.type);
      else if (drag.kind === 'move') moveBlockAt(drag.from, target);
    },
    [addBlockAt, moveBlockAt],
  );

  // Where a section drop lands, at a gap between sections.
  const dropSectionOnCanvas = useCallback(
    (gap: number) => {
      const drag = activeDragRef.current;
      if (drag?.kind === 'move-section') moveSectionAt(drag.from, gap);
    },
    [moveSectionAt],
  );

  /*
   * An outline drag in flight, if one is. The canvas drags resolve their target
   * from the document under the pointer; an outline drag does not, so this flag
   * is what keeps the two apart: while it is set, the canvas drop hooks are left
   * alone entirely and no boundary line is drawn on a canvas nobody is dragging
   * over. See components/editor/outline-move.ts.
   */
  const outlineDragRef = useRef<OutlineDragItem | null>(null);

  const paletteDrop = usePaletteDrop(dropOnCanvas);
  const sectionDrop = useSectionDrop(dropSectionOnCanvas);
  const dndSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  return (
    <DndContext
      sensors={dndSensors}
      /*
       * The outline's rows are the only droppables in this context: the canvas
       * registers none and reads no `over`. So this filter answers for the
       * outline and answers nothing for everything else, which is both correct
       * and cheaper than ranking rows a canvas drag would ignore.
       */
      collisionDetection={outlineCollision}
      /*
       * autoScroll off, on purpose. dnd-kit would otherwise nudge the canvas
       * while you hover near its edge and fire extra move events as it goes; our
       * drop point is resolved from document.elementFromPoint, so a scroll under
       * the pointer can slide the target column out from under the resolved point
       * and land the release on nothing. The native drag this replaces never
       * auto-scrolled either, so off is parity, not a loss. Drag-to-reach below
       * the fold is a deliberate later slice, resolved against the scroll rather
       * than fighting it.
       */
      autoScroll={false}
      onDragStart={(event) => {
        // One discriminator per source: a palette card carries paletteType, a
        // block handle carries moveFrom, a section handle carries moveSection.
        const data = event.active.data.current;

        // An outline row. It resolves its target from dnd-kit's own droppables
        // rather than from the canvas, so it takes neither of the drop hooks.
        if (data?.outlineDrag) {
          outlineDragRef.current = data.outlineDrag as OutlineDragItem;
          document.body.dataset.tgDragging = 'outline';
          return;
        }

        let drag: ActiveDrag | null = null;
        if (typeof data?.paletteType === 'string') {
          drag = { kind: 'add', type: data.paletteType };
        } else if (data?.moveFrom) {
          drag = {
            kind: 'move',
            from: data.moveFrom as { section: number; row: number; column: number; block: number },
            label: (data.moveLabel as string) ?? 'Block',
          };
        } else if (typeof data?.moveSection === 'number') {
          drag = { kind: 'move-section', from: data.moveSection, label: (data.moveLabel as string) ?? 'Section' };
        }
        if (!drag) return;
        activeDragRef.current = drag;
        setActiveDrag(drag);
        if (drag.kind === 'move-section') sectionDrop.start();
        else paletteDrop.start();
        // Fade the + picker's modal scrim while a drag is live, so the canvas
        // beneath takes the drop. Harmless for the palette and the handles, which
        // have no modal over the canvas. dnd-kit starts the drag on the pointer,
        // off the React tree, so setting this here cannot cancel the drag the way
        // native HTML5 drag did (5 Aug 2026).
        document.body.dataset.tgDragging = 'block';
      }}
      onDragMove={(event: DragMoveEvent) => {
        // dnd-kit keeps the outline's highlight itself, through isOver on each
        // row, so there is nothing for this to draw.
        if (outlineDragRef.current) return;
        const drag = activeDragRef.current;
        if (!drag) return;
        // dnd-kit hands us the pointer as the pointerdown plus how far it moved;
        // the drop hook asks the document what is under that point.
        const from = event.activatorEvent as PointerEvent;
        if (from == null || typeof from.clientX !== 'number') return;
        const x = from.clientX + event.delta.x;
        const y = from.clientY + event.delta.y;
        if (drag.kind === 'move-section') sectionDrop.update(x, y);
        else paletteDrop.update(x, y);
      }}
      onDragEnd={(event) => {
        /*
         * An outline drop. The row it ended on names its own target, so the
         * whole move is decided from the event: no geometry, no second guess at
         * which column was meant. resolveOutlineMove answers null for a drag that
         * changes nothing, and skipping the commit then is deliberate, because an
         * undo step that undoes nothing is worse than no step at all.
         */
        const outline = outlineDragRef.current;
        if (outline) {
          const target = event.over?.data.current?.outlineDrop as OutlineDragItem | undefined;
          if (target) {
            commit((current) => resolveOutlineMove(current, outline, target) ?? current);
          }
          outlineDragRef.current = null;
          delete document.body.dataset.tgDragging;
          return;
        }

        const drag = activeDragRef.current;
        if (drag?.kind === 'move-section') sectionDrop.end();
        else if (drag) paletteDrop.end();
        activeDragRef.current = null;
        setActiveDrag(null);
        delete document.body.dataset.tgDragging;
      }}
      onDragCancel={() => {
        outlineDragRef.current = null;
        paletteDrop.hide();
        sectionDrop.hide();
        activeDragRef.current = null;
        setActiveDrag(null);
        delete document.body.dataset.tgDragging;
      }}
    >
    <div
      className="ed-root"
      data-pane={mobilePane}
      data-theme={theme}
      data-outline={panels.outline ? undefined : 'folded'}
      data-props={panels.props ? undefined : 'folded'}
      data-preview={preview ? 'true' : undefined}
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
          WHAT WE WROTE FOR THEM, SAID OUT LOUD (#239).
          A page published with no search title or description gets one written
          from its own words. Telling the client is not politeness: those two
          lines are what appears under their name in Google, and finding out by
          reading Google is the wrong way round. It states what was written and
          where to change it, and goes when they close it.
        */}
        {seoFilled && (
          <div className="ed-seofill" role="status">
            <p className="ed-seofill__lead">
              {wasFilled(seoFilled)
                ? 'Published. We filled in what this page was missing, from the page itself.'
                : 'Published. We described this page\u2019s pictures for you.'}
            </p>
            <dl className="ed-seofill__list">
              {seoFilled.title && (
                <>
                  <dt>Search title</dt>
                  <dd>{seoFilled.title}</dd>
                </>
              )}
              {seoFilled.description && (
                <>
                  <dt>Search description</dt>
                  <dd>{seoFilled.description}</dd>
                </>
              )}
              {altsFilled > 0 && (
                <>
                  <dt>Picture descriptions</dt>
                  <dd>
                    {altsFilled === 1
                      ? 'One picture described'
                      : `${altsFilled} pictures described`}
                  </dd>
                </>
              )}
            </dl>
            <p className="ed-seofill__note">
              {wasFilled(seoFilled)
                ? 'Change any of these any time, in this page\u2019s settings or on the picture itself.'
                : 'Change any of these any time, on the picture itself.'}
            </p>
            <button type="button" className="ed-btn ed-btn--quiet" onClick={() => setSeoFilled(null)}>
              Close
            </button>
          </div>
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
        <div className="ed-seg ed-desktop-only ed-editing-only" role="group" aria-label="Panels">
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
              data-faithful={actualWidth >= CONTAINED_WIDTH ? '' : undefined}
              title={
                actualWidth >= CONTAINED_WIDTH
                  ? `There is only room for ${actualWidth}px, but a page's content stops at ` +
                    `${CONTAINED_WIDTH}px anyway, so this is still exactly what a visitor sees. ` +
                    `Fold a panel for the full width of the frame.`
                  : `There is only room for ${actualWidth}px, which is under the ${CONTAINED_WIDTH}px ` +
                    `a page's content stops at. Text wraps in places it will not wrap on the real ` +
                    `site. Fold a panel to get back above ${CONTAINED_WIDTH}px.`
              }
            >
              showing {actualWidth}
              {actualWidth < CONTAINED_WIDTH ? ', wraps early' : ''}
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
          className="ed-btn ed-editing-only"
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
          className="ed-btn ed-editing-only"
          data-icon="true"
          onClick={redo}
          disabled={history.future.length === 0}
          aria-label="Redo"
          title="Redo (Cmd+Shift+Z)"
        >
          <Icon name="redo" size={18} />
        </button>

        {/*
          PREVIEW. Andy, 11 Aug 2026: a button to see the site exactly as it
          will publish and interact with it as if it were live, with the side
          panels out of the way so the canvas is the whole screen. It stays
          visible in preview because it is the way back out, so it is NOT in the
          editing-only group that steps aside. Escape leaves preview too.
        */}
        <button
          type="button"
          className="ed-btn"
          data-on={preview ? 'true' : undefined}
          aria-pressed={preview}
          onClick={preview ? exitPreview : enterPreview}
          title={preview ? 'Back to editing (Esc)' : 'See the site as it will be published'}
        >
          <Icon name="eye" size={16} />
          {preview ? 'Exit preview' : 'Preview'}
        </button>

        {/*
          Disabled once published with nothing new to say, rather than hidden.
          A button that vanishes leaves an agent wondering where it went; one
          that reads "Published" and sits still answers the question.

          Hidden ENTIRELY, though, for a member without the publish capability:
          there is no "disabled Publish" that helps them, and the server refuses
          it anyway (slice 3). Staff and an unset owner keep it.
        */}
        {canPublish && (
          <button
            type="button"
            className="ed-btn ed-editing-only"
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
        )}

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

      {/*
        The slim left rail. Layers and Pages each open the one expanding column
        beside it (the same panels.outline the top bar folds) and choose what
        fills it: the outline, or the site's pages. Clicking the open one again
        folds the column. Add opens the section picker exactly as the outline's
        own Add does. Desktop and editing only; the CSS gives it a column and
        hides it in preview and under 1181px.
      */}
      <Rail
        active={panels.outline ? railPanel : null}
        commentCount={openComments}
        canAdd={canStructure}
        onToggle={(panel) => {
          if (panels.outline && railPanel === panel) {
            // The open panel's own icon: fold the column away.
            setPanels((current) => ({ ...current, outline: false }));
          } else {
            // A closed column, or the other panel: show this one and open up.
            setRailPanel(panel);
            setPanels((current) => ({ ...current, outline: true }));
          }
        }}
        onAdd={() => setInsertAt(page.sections.length)}
      />

      {railPanel === 'pages' ? (
        <PagesPanel
          pages={pages}
          currentId={pageId}
          onCreatePage={createPage}
          onMovePage={movePage}
        />
      ) : railPanel === 'comments' ? (
        <CommentsPanel
          pageId={pageId}
          anchor={commentAnchor}
          resolveAnchorLabel={resolveAnchorLabel}
          onJump={jumpToAnchor}
          focusCommentId={focusThread}
          onCountChange={refreshComments}
        />
      ) : (
        <Outline
          onAddSection={() => setInsertAt(page.sections.length)}
          page={page}
          selectedKey={selectedKey}
          onSelect={select}
          onCommit={commit}
          onPickBlock={setPicker}
          newId={newId}
          isStaff={isStaff}
          onAddElement={addElement}
        />
      )}

      <Canvas
        preparedSeed={preparedSeed}
        listings={listings}
        onInsertSection={setInsertAt}
        editingPath={editingPath}
        page={page}
        selectedKey={selectedKey}
        selected={selected}
        viewportWidth={`${widths[viewport]}px`}
        viewport={viewport}
        preview={preview}
        onSelect={select}
        onCommit={commit}
        onPickBlock={setPicker}
        theme={siteTheme}
        // So the canvas draws a header as a header rather than as a page.
        region={region}
        /*
          The two trees you are NOT editing, drawn as chrome bands around the one
          you are, each in its fixed place: the header on top, the page in the
          middle, the footer at the bottom. The active tree's band is null, since
          the canvas draws that one as the editable frame instead. Clicking a band
          hands editing to it. See activateTree.
        */
        chromeHeader={activeTree === 'header' ? null : otherContent.header}
        chromePage={activeTree === 'page' ? null : otherContent.page}
        chromeFooter={activeTree === 'footer' ? null : otherContent.footer}
        onActivateRegion={activateTree}
        // So a Menu link to a folder shows its dropdown on the canvas too.
        navPages={navPages}
        // A pin on every block that carries an open comment; clicking it opens
        // the Comments panel on that thread.
        commentPins={commentPins}
        onOpenComment={openCommentThread}
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
        canStructure={canStructure}
        onSelect={select}
        onCommit={commit}
        onBack={() => setMobilePane('canvas')}
        viewport={viewport}
        region={region}
        regionFlags={regionFlags}
        onRegionFlags={setRegionFlags}
        isItem={!!itemId}
        itemMeta={itemMeta}
        onItemMeta={setItemMeta}
        itemFields={itemFields}
        editingOnCanvas={optionsOpen}
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
          /*
           * A STABLE key, not the selected path. Keying it on selectedKey
           * remounted the pill on every selection, and because it is a keyed
           * child that stays present while its key changes, among conditional
           * siblings, React left the old instance behind rather than removing
           * it. So the pills stacked up, one per item clicked, and none went
           * away (Andy, 3 Aug 2026, with four of them on screen at once). One
           * instance that updates in place is right anyway: measure() already
           * re-runs on selectedKey and moves it, and the shell resets the
           * popover on selection, so there is no per-item state that a remount
           * was needed to clear.
           */
          key="ed-item-toolbar"
          page={page}
          selected={selected}
          selectedKey={selectedKey}
          editing={!!editing}
          newId={newId}
          open={optionsOpen}
          onOpenChange={setOptionsOpen}
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
            itemFields,
            onSelect: select,
            tier: viewport,
          }}
        />
      )}

      {/*
        THE FORMATTING TOOLBAR, not inside the properties pane's field.
        It formats whatever is selected on the CANVAS, which is where the words
        are. Mounted only for a RICH field, a paragraph or a heading: a plain
        field like a quote is typed into in place too but stores text not markup,
        so a formatting toolbar over it would offer commands that vanish on save.
      */}
      {editing?.rich && (
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
            if (path?.kind !== 'block' && path?.kind !== 'inner-block') return;
            commit((current) => updateBlockPropsAtPath(current, path, { align: value }));
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
          onPickPreset={async (preset) => {
            /*
             * A HERO WITH A PICTURE FETCHES ITS PHOTOGRAPH ON THE WAY IN, from
             * the same query its preview drew, so the hero a client adds looks
             * like the one they chose rather than a row of empty frames. Anything
             * else builds in the browser, free and instant. Best effort
             * throughout: if the fetch fails, or the library is not connected,
             * the image-ready hero goes in exactly as picking it always did.
             */
            const wantsPhotos =
              preset.category === 'hero'
              && (Boolean(preset.section?.backgroundQuery)
                || preset.rows.some((row) =>
                  row.columns.some((column) => column.some((block) => block.type === 'image')),
                ));
            if (wantsPhotos) {
              const result = await buildDesignedSectionAction({ presetId: preset.id });
              insertSection(result.ok ? result.section : buildPresetSection(preset));
            } else {
              insertSection(buildPresetSection(preset));
            }
          }}
          /*
           * The third path takes MANY, because one paste is usually a whole
           * page. Going through insertSections rather than calling
           * insertSection in a loop is not tidiness: insertAt is cleared by the
           * first call, so the second and every one after it would find no
           * insertion point and quietly do nothing.
           */
          onPickImported={(sections) => insertSections(sections)}
          onPickBuilt={(section) => insertSection(section)}
        />
      )}

      {picker && (
        <BlockPicker
          isStaff={isStaff}
          /*
            No container inside a container. When the picker was opened from a
            container's inner column it hides the container element, the same
            refusal the drop makes: the model nests exactly one level.
          */
          exclude={picker.inner !== undefined ? CONTAINER_ONLY : undefined}
          onClose={() => setPicker(null)}
          /*
            Straight through addBlockAt, which the drop and the palette also use,
            so a picked block, a dropped one and a clicked one all land and select
            the one same way, inner column included. With no `at`, it lands at the
            end of whichever column, which is where the + always added.
          */
          onPick={(type) => addBlockAt(picker, type)}
        />
      )}

      {/* The line a palette drag drops on. Fixed to the viewport and moved
          imperatively (usePaletteDrop), so a re-render mid-drag never resets it. */}
      <div ref={paletteDrop.slotRef} className="ed-drop-slot" aria-hidden="true" />
      {/* The boundary line a section drag drops on, moved the same way. */}
      <div ref={sectionDrop.slotRef} className="ed-section-drop-slot" aria-hidden="true" />

      {/* Inside .ed-root ON PURPOSE. The overlay is position:fixed, so where it
          sits in the DOM does not move it, but the --ed-* tokens the ghost paints
          with (its panel background, its ink) live on .ed-root and nowhere else.
          Drawn outside it the ghost lost its background and the icon and label
          floated bare over the page (Andy, 10 Aug 2026); inside, they resolve and
          the ghost keeps a solid card behind it.
          pointerEvents:none is load-bearing too: dnd-kit puts this under the
          pointer with only position:fixed and touch-action:none, so left solid it
          would be what document.elementFromPoint returns and the drop hook would
          never see the column beneath it. None lets the point fall through to the
          canvas, which is how the drop resolves. */}
      <DragOverlay dropAnimation={null} style={{ pointerEvents: 'none' }}>
        {activeDrag?.kind === 'add' ? (
          <PaletteGhost type={activeDrag.type} />
        ) : activeDrag?.kind === 'move' || activeDrag?.kind === 'move-section' ? (
          <MoveGhost label={activeDrag.label} />
        ) : null}
      </DragOverlay>
    </div>
    </DndContext>
  );
}

/**
 * The card that follows the pointer while a new element is dragged.
 *
 * dnd-kit draws it in a portal above everything, so it is a plain, light copy of
 * the palette card, no drag machinery of its own. The real card stays put in the
 * palette; this is the thing in flight.
 */
function PaletteGhost({ type }: { type: string }) {
  const def = blockDefinition(type);
  if (!def) return null;
  return (
    <div className="ed-palette-card ed-palette-card--ghost">
      <span className="ed-palette-card__icon">
        <Icon name={def.icon} size={18} />
      </span>
      <span className="ed-palette-card__label">{def.label}</span>
    </div>
  );
}

/**
 * The chip that follows the pointer while a PLACED block is being moved. A small
 * pill naming what is in flight, not a copy of the whole block: where it will
 * land is the drop line's job, so the ghost only has to say what you have hold
 * of. Drawn inside .ed-root (see the DragOverlay note) so its --ed-* tokens
 * resolve, and pointer-events:none so it never sits between the pointer and the
 * column the drop resolves against.
 */
function MoveGhost({ label }: { label: string }) {
  return (
    <div className="ed-move-ghost">
      <Icon name="grip" size={14} />
      <span>{label}</span>
    </div>
  );
}
