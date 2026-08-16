'use client';

/**
 * The Pages panel (Andy, 12 Aug 2026).
 *
 * The rail's Pages icon used to take you to the /sites screen, out of the
 * editor. Now it opens this panel in the same expanding column the outline
 * uses, listing the site's pages so you can jump straight from one to the
 * next without leaving the editor. Each row is a plain anchor to
 * /editor?page=<id>, the same full navigation the brand link makes, so the
 * page you pick loads fresh with its own draft.
 *
 * It shares the .ed-outline container (column, border, scroll, and the fold
 * behaviour), and adds its own list on top. The current page is marked and
 * the search filters by name or address, which is what makes a list of a
 * hundred-odd pages usable.
 *
 * ADD PAGE (Andy, 12 Aug 2026). A button at the top opens a small composer for
 * a name; onCreatePage makes the page and the shell navigates to it. A name is
 * asked for rather than made up, because the address is the name slugified and
 * two pages cannot share one, so a second "Untitled" would clash. The composer
 * is opened by a click, so focusing the box then is a real action, not a render
 * grabbing the page.
 */

import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, FormEvent, ReactElement } from 'react';
import {
  DndContext,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';

import { buildPageTree, descendantIds, filterPages, type PageLink, type PageNode } from '../../lib/editor/page-list';
import { PAGE_TEMPLATES } from '../../lib/content/page-templates';
import { MediaPicker } from '../media/MediaPicker';
import type { MediaItem } from '../../lib/media/types';

// Re-exported so the shell and the standalone entry can keep importing the type
// from the component they hand it to. The type and the search behind it live in
// lib/editor/page-list so they can be tested without a DOM.
export type { PageLink };

export function PagesPanel({
  pages,
  currentId,
  onCreatePage,
  onMovePage,
}: {
  pages: readonly PageLink[];
  currentId: string | null;
  /**
   * Make a page with this name from the chosen template and open it. Resolves
   * with an error to show in the composer, or null on success, by which point
   * the editor is navigating to the new page. The template is an id from
   * PAGE_TEMPLATES; 'blank' is an empty page; 'ai' means build it from the brief
   * and an optional picture, the only template that reads the third and fourth
   * arguments. The picture is a media id, resolved to the tenant's own image
   * server side. Optional so a caller without it simply shows no button.
   */
  onCreatePage?: (
    title: string,
    template: string,
    brief?: string,
    imageId?: string,
  ) => Promise<string | null>;
  /**
   * File a page into a folder, or back out to the top level. Called after the
   * panel has already moved the row optimistically; resolves with an error to
   * show and undo, or null on success. A folder is just a page, so parentId is
   * a page id to file inside, or null for the top level. Optional so a caller
   * without it shows a read-only tree.
   */
  onMovePage?: (pageId: string, parentId: string | null) => Promise<string | null>;
}): ReactElement {
  const [query, setQuery] = useState('');

  /*
   * A LOCAL COPY OF THE PAGES, so a drag can move a row the instant it lands
   * rather than waiting on the server and a reload. Seeded from the prop and
   * resynced only when the prop itself changes, which in-session it does not:
   * switching page is a full navigation that remounts this with fresh pages.
   */
  const [list, setList] = useState<PageLink[]>(() => [...pages]);
  useEffect(() => {
    setList([...pages]);
  }, [pages]);

  const searching = query.trim() !== '';
  const filtered = useMemo(() => filterPages(list, query), [list, query]);
  const tree = useMemo(() => buildPageTree(list), [list]);

  /** Folders the client has collapsed. Empty means all open. */
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const toggleFolder = (id: string) =>
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  /** The page being dragged, so the top-level drop strip shows only then. */
  const [dragging, setDragging] = useState<string | null>(null);
  /** A reason a move was refused or failed, shown under the list. */
  const [moveError, setMoveError] = useState<string | null>(null);

  const dragSensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const onDragStart = (event: DragStartEvent) => {
    const id = (event.active.data.current as { pageId?: string } | undefined)?.pageId ?? null;
    setDragging(id);
  };

  const onDragEnd = async (event: DragEndEvent) => {
    setDragging(null);
    const activeId = (event.active.data.current as { pageId?: string } | undefined)?.pageId;
    const over = event.over?.data.current as { pageId?: string; root?: boolean } | undefined;
    if (!activeId || !over || !onMovePage) return;

    const target = over.root ? null : over.pageId ?? null;
    const page = list.find((candidate) => candidate.id === activeId);
    if (!page) return;
    // Dropped where it already is, or onto itself: nothing to do.
    if (target === activeId || (page.parentId ?? null) === target) return;

    // A page cannot be filed inside one of its own pages: that would cut a branch
    // off and loop it back on itself. The server enforces this too, and the depth
    // limit with it (a page nested past the address limit); here the common one is
    // caught before the round trip and the rest reverts with the server's reason.
    if (target && descendantIds(list, activeId).has(target)) {
      setMoveError('A page cannot go inside one of its own pages.');
      return;
    }

    const before = list;
    setList(list.map((candidate) => (candidate.id === activeId ? { ...candidate, parentId: target } : candidate)));
    setMoveError(null);

    const failure = await onMovePage(activeId, target);
    if (failure) {
      setList(before);
      setMoveError(failure);
    }
  };

  /*
   * The pages beneath the one being dragged. A row cannot be a drop target for its
   * own ancestor: dropping a page into one of its own is the move that would loop
   * the tree, so those rows stop taking drops while it is in flight.
   */
  const draggedDescendants = useMemo(
    () => (dragging ? descendantIds(list, dragging) : new Set<string>()),
    [dragging, list],
  );

  /*
   * One branch of the tree, drawn to any depth. A page, then the pages inside it
   * when it is open, each of those the same way. The recursion is the whole
   * multi-tier change: a child is no longer a leaf, it is a branch in its own
   * right, so it can hold pages and be a drop target like any other.
   */
  const renderNode = (node: PageNode): ReactElement => {
    const hasChildren = node.children.length > 0;
    const open = !collapsed.has(node.page.id);
    return (
      <Fragment key={node.page.id}>
        <PageRow
          page={node.page}
          currentId={currentId}
          depth={node.depth}
          draggable={Boolean(onMovePage)}
          droppable={
            Boolean(onMovePage) && dragging !== node.page.id && !draggedDescendants.has(node.page.id)
          }
          hasChildren={hasChildren}
          open={open}
          onToggle={() => toggleFolder(node.page.id)}
        />
        {hasChildren && open && node.children.map(renderNode)}
      </Fragment>
    );
  };

  /** The Add page composer: closed, or open with a name being typed. */
  const [adding, setAdding] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  /** Which starter to build the new page from. 'blank' is an empty page, 'ai' the brief. */
  const [template, setTemplate] = useState('blank');
  /** The AI brief, read only when 'ai' is the chosen start. */
  const [brief, setBrief] = useState('');
  /** An optional picture for the AI start: its media id, and its URL for the thumbnail. */
  const [imageId, setImageId] = useState<string | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  /** Whether the media picker is open over the composer. */
  const [pickerOpen, setPickerOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  // Focus the box when the composer opens, and only then: keyed on `adding`, so
  // typing in the search (which re-renders this panel) does not pull the caret
  // back here. Opening is a click, so this focus follows a real action.
  useEffect(() => {
    if (adding) nameRef.current?.focus();
  }, [adding]);

  function closeComposer() {
    setAdding(false);
    setNewTitle('');
    setTemplate('blank');
    setBrief('');
    setImageId(null);
    setImageUrl(null);
    setPickerOpen(false);
    setError(null);
  }

  async function submitNew(event: FormEvent) {
    event.preventDefault();
    if (!onCreatePage) return;
    const title = newTitle.trim();
    if (!title) {
      setError('Give the page a name.');
      return;
    }
    // The AI start needs something to work from, a brief or a picture; the
    // ready-made pages need neither.
    const wantsAi = template === 'ai';
    const said = brief.trim();
    if (wantsAi && !said && !imageId) {
      setError('Say what the page is for, or add a picture.');
      return;
    }
    setBusy(true);
    setError(null);
    const failure = await onCreatePage(
      title,
      template,
      wantsAi ? said : undefined,
      wantsAi ? imageId ?? undefined : undefined,
    );
    setBusy(false);
    // Success navigates away, so there is nothing to close. A failure stays put
    // with the reason, the commonest being an address already in use, or the
    // assistant not managing the page.
    if (failure) setError(failure);
  }

  return (
    <aside className="ed-outline ed-pages" aria-label="Pages">
      {/*
        Head and search stay put while the list scrolls beneath them, so the
        search is still there a hundred pages down. One sticky block rather than
        two, so there is no head height to guess at for the search to sit below.
      */}
      <div className="ed-pages__top">
        <div className="ed-pages__head">
          <span className="ed-pages__title">Pages</span>
          <span className="ed-pages__count">{pages.length}</span>
        </div>

        {onCreatePage &&
          (adding ? (
            <form className="ed-pages__new" onSubmit={submitNew}>
              <input
                ref={nameRef}
                className="ed-input"
                value={newTitle}
                placeholder="Page name"
                aria-label="New page name"
                maxLength={200}
                onChange={(event) => setNewTitle(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') closeComposer();
                }}
              />
              {/*
                Start from a blank page or one of the designed pages. A ready-made
                page comes filled with placeholder copy and pictures to swap; the
                choice only picks the sections, the name above is what it is called.
              */}
              <div className="ed-pages__templates" role="radiogroup" aria-label="Start from">
                {/*
                  The one start that is not a ready-made page: describe it and the
                  assistant designs it from the same sections. First in the group as
                  the headline choice, though Blank stays the default so simply
                  opening the composer spends nothing.
                */}
                <label
                  className="ed-pages__template ed-pages__template--ai"
                  data-selected={template === 'ai' ? '' : undefined}
                >
                  <input
                    type="radio"
                    name="page-template"
                    value="ai"
                    checked={template === 'ai'}
                    onChange={() => setTemplate('ai')}
                  />
                  <span className="ed-pages__template-label">Describe it with AI</span>
                  <span className="ed-pages__template-desc">
                    Tell us what the page is for and the assistant drafts it from your designed sections, ready to edit.
                  </span>
                </label>
                {PAGE_TEMPLATES.map((option) => (
                  <label
                    key={option.id}
                    className="ed-pages__template"
                    data-selected={template === option.id ? '' : undefined}
                  >
                    <input
                      type="radio"
                      name="page-template"
                      value={option.id}
                      checked={template === option.id}
                      onChange={() => setTemplate(option.id)}
                    />
                    <span className="ed-pages__template-label">{option.label}</span>
                    <span className="ed-pages__template-desc">{option.description}</span>
                  </label>
                ))}
              </div>
              {/*
                Shown only for the AI start: a brief, and an optional picture. A
                real user action opened the composer and chose this, so the box is
                theirs to click into; nothing focuses it on render, which would
                steal the caret.
              */}
              {template === 'ai' && (
                <div className="ed-pages__ai">
                  <label className="ed-pages__brief">
                    <span className="ed-pages__brief-label">Describe your page</span>
                    <textarea
                      className="ed-input ed-pages__brief-box"
                      value={brief}
                      placeholder="For example: a page about our walking holidays in the Dolomites, who they suit and how to get in touch."
                      aria-label="Describe your page"
                      maxLength={800}
                      rows={4}
                      onChange={(event) => setBrief(event.target.value)}
                    />
                  </label>
                  {/*
                    The picture is chosen through the same media picker the image
                    blocks use, so it can be uploaded, taken from the bank or found
                    in stock, and it is handed on as a media id the server resolves
                    to this site's own image. The assistant reads it and puts it
                    behind the opening section.
                  */}
                  <div className="ed-pages__image">
                    {imageUrl ? (
                      <div className="ed-pages__image-chosen">
                        <img className="ed-pages__image-thumb" src={imageUrl} alt="" />
                        <button type="button" className="ed-btn" onClick={() => setPickerOpen(true)}>
                          Change
                        </button>
                        <button
                          type="button"
                          className="ed-btn"
                          onClick={() => {
                            setImageId(null);
                            setImageUrl(null);
                          }}
                        >
                          Remove
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        className="ed-pages__image-add"
                        onClick={() => setPickerOpen(true)}
                      >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <rect x="3" y="4" width="18" height="14" rx="2" />
                          <path d="M3 15l5-4 4 3 3-2 6 5" />
                          <circle cx="9" cy="9" r="1.4" />
                        </svg>
                        Add a picture
                      </button>
                    )}
                    <span className="ed-pages__image-hint">
                      Optional. The assistant reads it and puts it on the page.
                    </span>
                  </div>
                </div>
              )}
              {error && (
                <p className="ed-pages__error" role="alert">
                  {error}
                </p>
              )}
              <div className="ed-pages__new-actions">
                <button type="button" className="ed-btn" onClick={closeComposer}>
                  Cancel
                </button>
                <button type="submit" className="ed-btn" data-variant="primary" disabled={busy}>
                  {template === 'ai' ? (busy ? 'Building' : 'Build page') : busy ? 'Adding' : 'Add page'}
                </button>
              </div>
            </form>
          ) : (
            <button
              type="button"
              className="ed-pages__add"
              onClick={() => setAdding(true)}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
                <path d="M12 5v14M5 12h14" />
              </svg>
              Add page
            </button>
          ))}

        <div className="ed-pages__search">
          <input
            className="ed-input"
            type="search"
            placeholder="Search pages"
            value={query}
            aria-label="Search pages"
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
      </div>

      {moveError && (
        <p className="ed-pages__move-error" role="alert">
          {moveError}
        </p>
      )}

      {searching ? (
        // While searching the tree folds to a flat list of matches: a hit deep in
        // a folder should show, and dragging in a filtered view would file into a
        // half-hidden structure. Drag is off here, on the browse view only.
        <div className="ed-pages__list">
          {filtered.length === 0 ? (
            <p className="ed-pages__empty">Nothing matches that.</p>
          ) : (
            filtered.map((page) => (
              <PageAnchor
                key={page.id}
                page={page}
                currentId={currentId}
                isFolder={list.some((candidate) => candidate.parentId === page.id)}
              />
            ))
          )}
        </div>
      ) : list.length === 0 ? (
        <div className="ed-pages__list">
          <p className="ed-pages__empty">No pages yet.</p>
        </div>
      ) : (
        <DndContext sensors={dragSensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
          <div className="ed-pages__list" data-dragging={dragging ? '' : undefined}>
            <RootDropZone active={dragging != null} />
            {tree.map(renderNode)}
          </div>
        </DndContext>
      )}

      {/*
        The picture chooser, the same one the image blocks use, opened over the
        composer. A Modal, so it portals to the body and sits above the rail; it
        renders outside the form, so choosing an image cannot submit it. onChoose
        keeps the id (for the server) and the URL (for the thumbnail).
      */}
      {pickerOpen && (
        <MediaPicker
          onChoose={(item: MediaItem) => {
            setImageId(item.id);
            setImageUrl(item.url);
            setPickerOpen(false);
          }}
          onClose={() => setPickerOpen(false)}
          currentUrl={imageUrl ?? undefined}
        />
      )}
    </aside>
  );
}

/**
 * One page as a link. The clickable part of every row, shared by the flat search
 * results and the draggable tree, so a page reads and behaves the same wherever
 * it shows.
 *
 * A plain anchor, not next/link, for the two reasons the brand link gives:
 * leaving the current page should re-fetch fresh, and next/link would drag Next's
 * runtime into the standalone bundle that has none. `isFolder` only adds the
 * folder mark, so a page holding others is legible at a glance.
 */
function PageAnchor({
  page,
  currentId,
  isFolder,
}: {
  page: PageLink;
  currentId: string | null;
  isFolder?: boolean;
}): ReactElement {
  return (
    <a
      className="ed-pages__row"
      href={`/editor?page=${encodeURIComponent(page.id)}`}
      data-current={page.id === currentId ? '' : undefined}
      data-folder={isFolder ? '' : undefined}
      aria-current={page.id === currentId ? 'page' : undefined}
    >
      <span className="ed-pages__name">{page.title || 'Untitled'}</span>
      <span className="ed-pages__meta">
        <span className="ed-pages__slug">/{page.slug}</span>
        {page.status === 'draft' && <span className="ed-pages__badge">Draft</span>}
      </span>
    </a>
  );
}

/**
 * The strip at the top of the list that pulls a page back out to the top level.
 *
 * Shown only while a drag is in flight (`active`), because a target you can only
 * hit mid-drag has no business taking up room the rest of the time. Dropping a
 * page here files it under no parent; dropping a page that is already top level
 * simply lands where it started and nothing moves.
 */
function RootDropZone({ active }: { active: boolean }): ReactElement | null {
  const { setNodeRef, isOver } = useDroppable({ id: 'pages-root', data: { root: true } });
  if (!active) return null;
  return (
    <div
      ref={setNodeRef}
      className="ed-pages__root-drop"
      data-over={isOver ? '' : undefined}
    >
      Move to the top level
    </div>
  );
}

/**
 * One row in the draggable tree: a grip to lift it by, a fold control if it holds
 * pages, and the page itself.
 *
 * TWO OVERLAID JOBS, kept apart so neither fights the other. The outer node is
 * the drop target (drop a page here to file it inside this one); the inner wrap
 * is the thing that lifts and follows the pointer. The grip alone carries the
 * drag listeners, so the row is dragged on purpose and a plain click still opens
 * the page. The transform is built by hand rather than pulled from
 * @dnd-kit/utilities, which this repo does not carry.
 *
 * `droppable` is off for the row being dragged and for every page beneath it (a
 * page cannot file into itself or its own branch); every other row takes a drop,
 * which is what lets the tree nest to any depth. `depth` steps the row in so its
 * place in the tree reads at a glance. `hasChildren` swaps the fold chevron in for
 * the spacer that otherwise keeps the names lined up.
 */
function PageRow({
  page,
  currentId,
  depth,
  droppable,
  draggable,
  hasChildren,
  open,
  onToggle,
}: {
  page: PageLink;
  currentId: string | null;
  depth: number;
  droppable: boolean;
  draggable: boolean;
  hasChildren?: boolean;
  open?: boolean;
  onToggle?: () => void;
}): ReactElement {
  const drag = useDraggable({
    id: `page-${page.id}`,
    data: { pageId: page.id },
    disabled: !draggable,
  });
  const drop = useDroppable({
    id: `into-${page.id}`,
    data: { pageId: page.id },
    disabled: !droppable,
  });

  const style = drag.transform
    ? {
        transform: `translate(${Math.round(drag.transform.x)}px, ${Math.round(
          drag.transform.y,
        )}px)`,
      }
    : undefined;

  return (
    <div
      ref={drop.setNodeRef}
      className="ed-pages__node"
      // A marker for a filed page, and the depth it steps in by. The indent is a
      // custom property so one CSS rule covers every level (see editor.css).
      data-child={depth > 0 ? '' : undefined}
      data-over={drop.isOver ? '' : undefined}
      style={{ '--tree-depth': depth } as CSSProperties}
    >
      <div
        ref={drag.setNodeRef}
        className="ed-pages__row-wrap"
        style={style}
        data-dragging={drag.isDragging ? '' : undefined}
      >
        {draggable && (
          <button
            type="button"
            className="ed-pages__grip"
            aria-label={`Move ${page.title || 'Untitled'}`}
            {...drag.listeners}
            {...drag.attributes}
          >
            <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <circle cx="9" cy="6" r="1.5" />
              <circle cx="15" cy="6" r="1.5" />
              <circle cx="9" cy="12" r="1.5" />
              <circle cx="15" cy="12" r="1.5" />
              <circle cx="9" cy="18" r="1.5" />
              <circle cx="15" cy="18" r="1.5" />
            </svg>
          </button>
        )}
        {hasChildren ? (
          <button
            type="button"
            className="ed-pages__folder-toggle"
            aria-expanded={open}
            aria-label={open ? 'Collapse folder' : 'Expand folder'}
            data-open={open ? '' : undefined}
            onClick={onToggle}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.4"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M9 6l6 6-6 6" />
            </svg>
          </button>
        ) : (
          <span className="ed-pages__folder-spacer" aria-hidden="true" />
        )}
        <PageAnchor page={page} currentId={currentId} isFolder={hasChildren} />
      </div>
    </div>
  );
}
