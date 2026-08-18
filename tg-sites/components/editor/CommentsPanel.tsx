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
} from '../../app/actions/comments';
import { relativeTime, absoluteDate } from '../../lib/activity/log';
import type { ResolvedThread } from '../../lib/comments/resolve';

export function CommentsPanel({ pageId }: { pageId: string }) {
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
    });
  }, [pageId]);

  // On mount and whenever the edited page changes: clear the old page's threads
  // so they cannot flash against the new page, then read the new ones.
  useEffect(() => {
    setThreads(null);
    load();
  }, [load]);

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
        {threads && threads.length > 0 && (
          <span className="ed-comments__count">{openCount} open</span>
        )}
      </div>

      <NewComment
        onSubmit={async (body) => {
          const result = await leaveCommentAction({ pageId, body });
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
            <Thread key={thread.id} thread={thread} onChanged={load} onError={setError} />
          ))}
        </ol>
      )}
    </aside>
  );
}

// ---------------------------------------------------------------------------

/** The box for a new page-level comment. Clears itself once one is posted. */
function NewComment({ onSubmit }: { onSubmit: (body: string) => Promise<void> }) {
  const [body, setBody] = useState('');
  const [saving, setSaving] = useState(false);

  async function submit() {
    const clean = body.trim();
    if (!clean || saving) return;
    setSaving(true);
    await onSubmit(clean);
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
        placeholder="Leave a comment for the Travelgenix team…"
        disabled={saving}
        onChange={(event) => setBody(event.target.value)}
      />
      <div className="ed-comments__new-foot">
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
  onChanged,
  onError,
}: {
  thread: ResolvedThread;
  onChanged: () => void;
  onError: (message: string) => void;
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

  return (
    <li className="ed-comments__thread" data-resolved={thread.resolved ? 'true' : 'false'}>
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
