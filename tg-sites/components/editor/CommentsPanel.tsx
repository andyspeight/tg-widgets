'use client';

/**
 * The Comments panel (Andy, 18 Aug 2026).
 *
 * The rail's Comments icon opens this in the same expanding column the outline
 * and the pages list use. It is the review conversation for the page being
 * edited: the client leaves a comment, Travelgenix reply, and either side marks
 * a thread resolved. Page-level for now; pinning a comment to an element is a
 * later slice, and the anchor is already carried through for it.
 *
 * SELF-LOADING, like the activity and domains panels: it reads the page's
 * threads on mount and again after anything it changes, rather than being handed
 * a list. The author and the wording arrive already resolved from the server
 * (app/actions/comments.ts and lib/comments/resolve.ts); this lays them out and
 * turns the timestamp into "3 hours ago".
 *
 * The body is rendered as TEXT, never markup: React escapes {comment.body}, and
 * the panel keeps its whitespace with CSS. A comment is free client input, so
 * this is the one place that matters.
 */

import { useCallback, useEffect, useRef, useState, useTransition } from 'react';

import {
  leaveCommentAction,
  listPageCommentsAction,
  reopenCommentAction,
  replyToCommentAction,
  resolveCommentAction,
  siteCommentsAction,
} from '../../app/actions/comments';
import { relativeTime, absoluteDate } from '../../lib/activity/log';
import type { ResolvedThread, SiteComment } from '../../lib/comments/resolve';

export function CommentsPanel({
  pageId,
  anchor = null,
  resolveAnchorLabel,
  onJump,
  focusCommentId = null,
  onCountChange,
}: {
  pageId: string;
  /** The selected element a new comment can pin to, or null for page-level. */
  anchor?: { id: string; label: string } | null;
  /** A pinned thread's element id turned into a label, or null if it is gone. */
  resolveAnchorLabel?: (blockId: string) => string | null;
  /** Select the element a pinned thread is about. */
  onJump?: (blockId: string) => void;
  /**
   * A thread to reveal on open, arrived at by clicking it in the whole-site list
   * on another page. The panel scrolls to it, marks it, and jumps to its element.
   */
  focusCommentId?: string | null;
  /** The open count changed: the rail badge should re-read it. */
  onCountChange?: () => void;
}) {
  // This page, or every page: the review of the page being edited, or the
  // whole-site worklist of everything still open. Arriving at a specific thread
  // forces the per-page view, because that thread lives on this page.
  const [scope, setScope] = useState<'page' | 'site'>('page');

  const [threads, setThreads] = useState<ResolvedThread[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const load = useCallback(() => {
    startTransition(async () => {
      const result = await listPageCommentsAction({ pageId });
      if (result.ok) {
        setThreads(result.data);
        setError(null);
      } else {
        setError(result.error);
      }
      // Whatever the panel just did, the site-wide open count may have moved, so
      // let the rail badge re-read it. Harmless on a plain reload.
      onCountChange?.();
    });
  }, [pageId, onCountChange]);

  // On mount and whenever the edited page changes: clear the old page's threads
  // so they cannot flash against the new page, then read the new ones.
  useEffect(() => {
    setThreads(null);
    load();
  }, [load]);

  // A focus target (a canvas pin, or a cross-page landing) is a specific thread
  // on this page, so show the per-page view rather than the whole-site list.
  useEffect(() => {
    if (focusCommentId) setScope('page');
  }, [focusCommentId]);

  // Landing on a thread from the whole-site list: once this page's threads are
  // in, scroll to it, mark it for a beat, and jump to the element it pins to.
  // Kept to once per id with a ref so a later reload does not yank the view back.
  const focusedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!focusCommentId || scope !== 'page' || !threads) return;
    if (focusedRef.current === focusCommentId) return;
    const found = threads.find((thread) => thread.id === focusCommentId);
    if (!found) return;
    focusedRef.current = focusCommentId;
    const node = document.getElementById(`ed-comment-${focusCommentId}`);
    node?.scrollIntoView({ block: 'center' });
    if (found.anchor && onJump) onJump(found.anchor);
  }, [focusCommentId, scope, threads, onJump]);

  // Open threads first, both newest first, so live feedback sits at the top and
  // finished threads settle beneath it.
  const ordered = threads
    ? [...threads].sort((a, b) => {
        if (a.resolved !== b.resolved) return a.resolved ? 1 : -1;
        return b.createdAt.getTime() - a.createdAt.getTime();
      })
    : [];
  const openCount = threads ? threads.filter((thread) => !thread.resolved).length : 0;

  return (
    <aside className="ed-outline ed-comments" aria-label="Comments">
      <div className="ed-comments__head">
        <span className="ed-comments__title">Comments</span>
        {scope === 'page' && threads && threads.length > 0 && (
          <span className="ed-comments__count">{openCount} open</span>
        )}
      </div>

      {/*
        This page, or the whole site. The per-page view is where a comment is
        left and a thread is read in context; the all-pages view is the team's
        worklist of everything still open, wherever it was raised.
      */}
      <div className="ed-comments__scope" role="tablist" aria-label="Which comments">
        <button
          type="button"
          role="tab"
          aria-selected={scope === 'page'}
          className="ed-comments__scope-tab"
          data-active={scope === 'page' ? '' : undefined}
          onClick={() => setScope('page')}
        >
          This page
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={scope === 'site'}
          className="ed-comments__scope-tab"
          data-active={scope === 'site' ? '' : undefined}
          onClick={() => setScope('site')}
        >
          All pages
        </button>
      </div>

      {scope === 'site' ? (
        <SiteComments currentPageId={pageId} />
      ) : (
        <>
          <NewComment
            anchor={anchor}
            onSubmit={async (body, anchorId) => {
              const result = await leaveCommentAction({ pageId, body, anchor: anchorId });
              if (result.ok) load();
              else setError(result.error);
            }}
          />

          {error && (
            <p className="ed-comments__error" role="alert">
              {error}
            </p>
          )}

          {!threads ? (
            <p className="ed-comments__note">Reading comments…</p>
          ) : threads.length === 0 ? (
            <p className="ed-comments__note">
              No comments on this page yet. Leave one above and the Travelgenix team
              will see it here.
            </p>
          ) : (
            <ol className="ed-comments__list">
              {ordered.map((thread) => (
                <Thread
                  key={thread.id}
                  thread={thread}
                  focused={thread.id === focusCommentId}
                  onChanged={load}
                  onError={setError}
                  resolveAnchorLabel={resolveAnchorLabel}
                  onJump={onJump}
                />
              ))}
            </ol>
          )}
        </>
      )}
    </aside>
  );
}

// ---------------------------------------------------------------------------

/**
 * The whole-site review: every open thread, grouped by the page it is on.
 *
 * Self-loading like the per-page view, but reaching across the site. Each thread
 * is a link to its page with the comment carried in the address, so the editor
 * opens there with the panel on that thread and its element selected. The page
 * being edited is marked, so a reviewer can tell "here" from "elsewhere".
 */
function SiteComments({ currentPageId }: { currentPageId: string }) {
  const [items, setItems] = useState<SiteComment[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  useEffect(() => {
    startTransition(async () => {
      const result = await siteCommentsAction();
      if (result.ok) {
        setItems(result.data);
        setError(null);
      } else {
        setError(result.error);
      }
    });
  }, []);

  if (error) {
    return (
      <p className="ed-comments__error" role="alert">
        {error}
      </p>
    );
  }
  if (!items) return <p className="ed-comments__note">Reading comments…</p>;
  if (items.length === 0) {
    return (
      <p className="ed-comments__note">
        Nothing open across the site. Resolved threads stay on their own page.
      </p>
    );
  }

  // Keep the server's newest-first order, but gather each page's threads under one
  // heading so the list reads page by page rather than jumping about.
  const byPage: { page: SiteComment['page']; threads: SiteComment[] }[] = [];
  const seen = new Map<string, number>();
  for (const item of items) {
    const at = seen.get(item.page.id);
    if (at === undefined) {
      seen.set(item.page.id, byPage.length);
      byPage.push({ page: item.page, threads: [item] });
    } else {
      byPage[at].threads.push(item);
    }
  }

  return (
    <div className="ed-comments__site">
      {byPage.map(({ page, threads }) => (
        <section key={page.id} className="ed-comments__group">
          <h3 className="ed-comments__group-head">
            <span className="ed-comments__group-name">{page.title || 'Untitled'}</span>
            {page.id === currentPageId && (
              <span className="ed-comments__group-here">This page</span>
            )}
          </h3>
          <ol className="ed-comments__site-list">
            {threads.map((thread) => (
              <li key={thread.id}>
                <a
                  className="ed-comments__site-row"
                  href={`/editor?page=${encodeURIComponent(page.id)}&comment=${encodeURIComponent(thread.id)}`}
                >
                  <span className="ed-comments__site-meta">
                    <span className="ed-comments__who">{thread.author ?? 'A former member'}</span>
                    <span className="ed-comments__dot" aria-hidden="true">
                      ·
                    </span>
                    <time dateTime={new Date(thread.createdAt).toISOString()}>
                      {relativeTime(new Date(thread.createdAt))}
                    </time>
                  </span>
                  <span className="ed-comments__site-body">{thread.body}</span>
                  <span className="ed-comments__site-foot">
                    {thread.anchor && (
                      <span className="ed-comments__site-pin">
                        <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <path d="M12 21s-7-6-7-11a7 7 0 0 1 14 0c0 5-7 11-7 11z" />
                          <circle cx="12" cy="10" r="2.2" />
                        </svg>
                        Pinned
                      </span>
                    )}
                    {thread.replyCount > 0 && (
                      <span className="ed-comments__site-replies">
                        {thread.replyCount} {thread.replyCount === 1 ? 'reply' : 'replies'}
                      </span>
                    )}
                  </span>
                </a>
              </li>
            ))}
          </ol>
        </section>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------

/**
 * The box for a new comment. Clears itself once one is posted.
 *
 * When an element is selected on the canvas the comment PINS to it by default,
 * so the natural gesture (click the photo, type, post) attaches the note to that
 * photo. Unticking pins it to the page instead. With nothing selected it is a
 * page-level comment, and the control just says so.
 */
function NewComment({
  anchor,
  onSubmit,
}: {
  anchor: { id: string; label: string } | null;
  onSubmit: (body: string, anchorId?: string) => Promise<void>;
}) {
  const [body, setBody] = useState('');
  const [saving, setSaving] = useState(false);
  const [pin, setPin] = useState(true);

  // A new selection defaults back to pinning it, so selecting an element then
  // typing pins to that element rather than to whatever was selected before.
  useEffect(() => {
    setPin(true);
  }, [anchor?.id]);

  const pinned = pin && anchor !== null;

  async function submit() {
    const clean = body.trim();
    if (!clean || saving) return;
    setSaving(true);
    await onSubmit(clean, pinned ? anchor!.id : undefined);
    setSaving(false);
    setBody('');
  }

  return (
    <form
      className="ed-comments__new"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <textarea
        className="ed-comments__field"
        value={body}
        rows={2}
        placeholder={pinned ? `Comment on ${anchor!.label}…` : 'Leave a comment for the Travelgenix team…'}
        disabled={saving}
        onChange={(event) => setBody(event.target.value)}
      />
      <div className="ed-comments__new-foot">
        {anchor ? (
          <label className="ed-comments__pin">
            <input
              type="checkbox"
              checked={pin}
              disabled={saving}
              onChange={(event) => setPin(event.target.checked)}
            />
            Pin to {anchor.label}
          </label>
        ) : (
          <span className="ed-comments__pin ed-comments__pin--none">On this page</span>
        )}
        <button type="submit" className="tg-btn" data-variant="primary" disabled={saving || !body.trim()}>
          {saving ? 'Posting' : 'Comment'}
        </button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------

function Thread({
  thread,
  focused = false,
  onChanged,
  onError,
  resolveAnchorLabel,
  onJump,
}: {
  thread: ResolvedThread;
  /** Arrived at from the whole-site list: mark it so the eye lands on it. */
  focused?: boolean;
  onChanged: () => void;
  onError: (message: string) => void;
  resolveAnchorLabel?: (blockId: string) => string | null;
  onJump?: (blockId: string) => void;
}) {
  const [replying, setReplying] = useState(false);
  const [busy, setBusy] = useState(false);

  async function run(fn: () => Promise<{ ok: boolean; error?: string }>) {
    if (busy) return;
    setBusy(true);
    const result = await fn();
    setBusy(false);
    if (result.ok) onChanged();
    else if (result.error) onError(result.error);
  }

  // A pinned thread names its element and jumps to it. A pin whose element was
  // since deleted resolves to null and reads as removed, and does not jump.
  const pinLabel = thread.anchor ? resolveAnchorLabel?.(thread.anchor) ?? null : null;

  return (
    <li
      id={`ed-comment-${thread.id}`}
      className="ed-comments__thread"
      data-resolved={thread.resolved ? 'true' : 'false'}
      data-focus={focused ? '' : undefined}
    >
      {thread.anchor && (
        <button
          type="button"
          className="ed-comments__pinchip"
          disabled={!onJump || pinLabel === null}
          onClick={() => onJump?.(thread.anchor!)}
          title={pinLabel ? 'Go to this element' : 'This element has been removed'}
        >
          <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 21s-7-6-7-11a7 7 0 0 1 14 0c0 5-7 11-7 11z" />
            <circle cx="12" cy="10" r="2.2" />
          </svg>
          {pinLabel ?? 'Removed element'}
        </button>
      )}

      <Bubble author={thread.author} at={thread.createdAt} body={thread.body} />

      {thread.replies.length > 0 && (
        <ol className="ed-comments__replies">
          {thread.replies.map((reply) => (
            <li key={reply.id}>
              <Bubble author={reply.author} at={reply.createdAt} body={reply.body} />
            </li>
          ))}
        </ol>
      )}

      <div className="ed-comments__actions">
        {thread.resolved ? (
          <>
            <span className="ed-comments__done">
              Resolved{thread.resolvedBy ? ` by ${thread.resolvedBy}` : ''}
            </span>
            <button
              type="button"
              className="ed-comments__act"
              disabled={busy}
              onClick={() => run(() => reopenCommentAction({ commentId: thread.id }))}
            >
              Reopen
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              className="ed-comments__act"
              disabled={busy}
              onClick={() => setReplying((open) => !open)}
            >
              Reply
            </button>
            <button
              type="button"
              className="ed-comments__act ed-comments__act--resolve"
              disabled={busy}
              onClick={() => run(() => resolveCommentAction({ commentId: thread.id }))}
            >
              Resolve
            </button>
          </>
        )}
      </div>

      {replying && !thread.resolved && (
        <Reply
          onSubmit={async (body) => {
            await run(() => replyToCommentAction({ parentId: thread.id, body }));
            setReplying(false);
          }}
          onCancel={() => setReplying(false)}
        />
      )}
    </li>
  );
}

// ---------------------------------------------------------------------------

/** One comment or reply: who, when, and the words. */
function Bubble({ author, at, body }: { author: string | null; at: Date; body: string }) {
  const when = new Date(at);
  return (
    <div className="ed-comments__bubble">
      <p className="ed-comments__meta">
        <span className="ed-comments__who">{author ?? 'A former member'}</span>
        <span className="ed-comments__dot" aria-hidden="true">
          ·
        </span>
        <time dateTime={when.toISOString()} title={absoluteDate(when)}>
          {relativeTime(when)}
        </time>
      </p>
      <p className="ed-comments__body">{body}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------

function Reply({
  onSubmit,
  onCancel,
}: {
  onSubmit: (body: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [body, setBody] = useState('');
  const [saving, setSaving] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);

  // Focus on open: this mount is a real user action (clicking Reply), not a
  // passive render, so taking the caret is right here.
  useEffect(() => {
    ref.current?.focus();
  }, []);

  async function submit() {
    const clean = body.trim();
    if (!clean || saving) return;
    setSaving(true);
    await onSubmit(clean);
    // No reset: the thread reloads and this unmounts.
  }

  return (
    <form
      className="ed-comments__reply"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <textarea
        ref={ref}
        className="ed-comments__field"
        value={body}
        rows={2}
        placeholder="Reply…"
        disabled={saving}
        onChange={(event) => setBody(event.target.value)}
      />
      <div className="ed-comments__reply-foot">
        <button type="button" className="ed-comments__act" disabled={saving} onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="tg-btn" data-variant="primary" disabled={saving || !body.trim()}>
          {saving ? 'Posting' : 'Reply'}
        </button>
      </div>
    </form>
  );
}
