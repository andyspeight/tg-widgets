/**
 * In-memory stand-ins for the comment actions, for the standalone build only.
 *
 * Same reasoning as standalone/demo-collection-actions.ts: the real ones import a
 * Postgres driver and read the site's members, neither of which can exist in a
 * file served from a static host. THIS IS A TEST DOUBLE, NOT A SECOND
 * PERSISTENCE PATH. Nothing in the app imports it; the editor is unchanged.
 *
 * It carries a short seeded thread so the review copy shows the panel populated,
 * and it really adds, replies, resolves and reopens against an in-memory list, so
 * the harness can drive the whole loop in the browser. The author names are the
 * demo's own; the real action resolves an id to a member's name on the server.
 */

import type { CommentResult } from '../app/actions/comments';
import type { Comment } from '../lib/db/comments';
import type { ResolvedThread } from '../lib/comments/resolve';

interface Stored {
  id: string;
  pageId: string;
  parentId: string | null;
  author: string;
  body: string;
  anchor: string | null;
  resolvedAt: Date | null;
  resolvedBy: string | null;
  createdAt: Date;
}

let seq = 100;

const store: Stored[] = [
  {
    id: 'demo-c1',
    pageId: 'demo',
    parentId: null,
    author: 'Client',
    body: 'Can we make the hero photo a little bigger on mobile?',
    anchor: null,
    resolvedAt: null,
    resolvedBy: null,
    createdAt: new Date(Date.now() - 3_600_000),
  },
  {
    id: 'demo-c1r',
    pageId: 'demo',
    parentId: 'demo-c1',
    author: 'Travelgenix',
    body: 'Done, that is live now. Let us know how it looks.',
    anchor: null,
    resolvedAt: null,
    resolvedBy: null,
    createdAt: new Date(Date.now() - 1_800_000),
  },
];

function threadsFor(pageId: string): ResolvedThread[] {
  return store
    .filter((row) => row.pageId === pageId && row.parentId === null)
    .map((root) => ({
      id: root.id,
      author: root.author,
      body: root.body,
      createdAt: root.createdAt,
      anchor: root.anchor,
      resolved: root.resolvedAt !== null,
      resolvedBy: root.resolvedBy,
      resolvedAt: root.resolvedAt,
      replies: store
        .filter((row) => row.parentId === root.id)
        .map((reply) => ({
          id: reply.id,
          author: reply.author,
          body: reply.body,
          createdAt: reply.createdAt,
        })),
    }));
}

/** A Comment the panel never reads (it reloads the list), just enough to type. */
function stub(over: Partial<Comment>): Comment {
  return {
    id: `demo-${seq}`,
    pageId: 'demo',
    parentId: null,
    authorId: 'demo-user',
    body: '',
    anchor: null,
    resolvedAt: null,
    resolvedBy: null,
    createdAt: new Date(),
    ...over,
  };
}

export async function listPageCommentsAction(input: {
  pageId: unknown;
}): Promise<CommentResult<ResolvedThread[]>> {
  return { ok: true, data: threadsFor(String(input?.pageId ?? 'demo')) };
}

export async function leaveCommentAction(input: {
  pageId: unknown;
  body: unknown;
  anchor?: unknown;
}): Promise<CommentResult<Comment>> {
  const body = String(input?.body ?? '').trim();
  if (!body) return { ok: false, error: 'Write something first.' };

  const id = `demo-c${++seq}`;
  store.push({
    id,
    pageId: String(input?.pageId ?? 'demo'),
    parentId: null,
    author: 'You',
    body,
    anchor: typeof input?.anchor === 'string' ? input.anchor : null,
    resolvedAt: null,
    resolvedBy: null,
    createdAt: new Date(),
  });
  return { ok: true, data: stub({ id, body }) };
}

export async function replyToCommentAction(input: {
  parentId: unknown;
  body: unknown;
}): Promise<CommentResult<Comment>> {
  const parentId = String(input?.parentId ?? '');
  const parent = store.find((row) => row.id === parentId && row.parentId === null);
  if (!parent) return { ok: false, error: 'That comment no longer exists.' };

  const body = String(input?.body ?? '').trim();
  if (!body) return { ok: false, error: 'Write something first.' };

  const id = `demo-r${++seq}`;
  store.push({
    id,
    pageId: parent.pageId,
    parentId,
    author: 'You',
    body,
    anchor: null,
    resolvedAt: null,
    resolvedBy: null,
    createdAt: new Date(),
  });
  return { ok: true, data: stub({ id, parentId, body }) };
}

export async function resolveCommentAction(input: {
  commentId: unknown;
}): Promise<CommentResult<Comment>> {
  const row = store.find((c) => c.id === String(input?.commentId ?? '') && c.parentId === null);
  if (!row) return { ok: false, error: 'That comment no longer exists.' };

  row.resolvedAt = new Date();
  row.resolvedBy = 'You';
  return { ok: true, data: stub({ id: row.id, resolvedAt: row.resolvedAt, resolvedBy: 'You' }) };
}

export async function reopenCommentAction(input: {
  commentId: unknown;
}): Promise<CommentResult<Comment>> {
  const row = store.find((c) => c.id === String(input?.commentId ?? '') && c.parentId === null);
  if (!row) return { ok: false, error: 'That comment no longer exists.' };

  row.resolvedAt = null;
  row.resolvedBy = null;
  return { ok: true, data: stub({ id: row.id }) };
}

// Compile-time proof that the doubles still match the real thing. If a real
// action gains an argument or changes its return type, this stops building.
import type * as real from '../app/actions/comments';

const _list = listPageCommentsAction satisfies typeof real.listPageCommentsAction;
const _leave = leaveCommentAction satisfies typeof real.leaveCommentAction;
const _reply = replyToCommentAction satisfies typeof real.replyToCommentAction;
const _resolve = resolveCommentAction satisfies typeof real.resolveCommentAction;
const _reopen = reopenCommentAction satisfies typeof real.reopenCommentAction;
void _list;
void _leave;
void _reply;
void _resolve;
void _reopen;
