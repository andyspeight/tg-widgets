'use server';

/**
 * Leaving a comment, replying, resolving and reopening one, and reading a page's
 * threads.
 *
 * ANY MEMBER OF THE SITE MAY TAKE PART, which is the whole point: the client
 * raises things and Travelgenix answers, in the same thread. The gate is
 * membership, resolved from the session by requireTenantId, which fails when the
 * caller is not in the site, plus a signed-in user to be the author. The page id
 * and the parent id in a request are guesses, made safe by the query layer's
 * INSERT ... SELECT rather than trusted here.
 *
 * Nothing here revalidates a path: the comments panel is a client component that
 * re-reads through listPageCommentsAction after it changes something, so a server
 * cache bust would be a round trip for nothing.
 */

import {
  resolveSiteComments,
  resolveThreads,
  type ResolvedThread,
  type SiteComment,
} from '../../lib/comments/resolve';
import { currentUserId, requireTenantId } from '../../lib/auth/session';
import {
  addReply,
  cleanCommentBody,
  countOpenComments,
  createComment,
  listOpenComments,
  listPageComments,
  reopenComment,
  resolveComment,
  type Comment,
} from '../../lib/db/comments';
import { listMembers } from '../../lib/db/members';

export type CommentResult<T> = { ok: true; data: T } | { ok: false; error: string };

/** A UUID, checked before it reaches Postgres as a failed cast. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The signed-in member and the site they are in.
 *
 * Throws rather than returning a flag, so a caller that forgets to check gets an
 * exception, not a write with no author. requireTenantId already refuses a caller
 * who is not a member of the active site.
 */
async function requireMember(): Promise<{ tenantId: string; userId: string }> {
  const tenantId = await requireTenantId();
  const userId = await currentUserId();
  if (!userId) throw new Error('Your session has ended. Sign in again to carry on.');
  return { tenantId, userId };
}

export async function leaveCommentAction(input: {
  pageId: unknown;
  body: unknown;
  anchor?: unknown;
}): Promise<CommentResult<Comment>> {
  try {
    const { tenantId, userId } = await requireMember();

    const pageId = String(input?.pageId ?? '');
    if (!UUID.test(pageId)) return { ok: false, error: 'That is not a page on this site.' };

    const body = cleanCommentBody(input?.body);
    if (!body) return { ok: false, error: 'Write something first.' };

    const anchor =
      typeof input?.anchor === 'string' && input.anchor ? input.anchor.slice(0, 200) : null;

    const comment = await createComment(tenantId, { pageId, authorId: userId, body, anchor });
    if (!comment) return { ok: false, error: 'That page is not part of this site.' };

    return { ok: true, data: comment };
  } catch (error) {
    return { ok: false, error: explain(error) };
  }
}

export async function replyToCommentAction(input: {
  parentId: unknown;
  body: unknown;
}): Promise<CommentResult<Comment>> {
  try {
    const { tenantId, userId } = await requireMember();

    const parentId = String(input?.parentId ?? '');
    if (!UUID.test(parentId)) return { ok: false, error: 'That comment no longer exists.' };

    const body = cleanCommentBody(input?.body);
    if (!body) return { ok: false, error: 'Write something first.' };

    const reply = await addReply(tenantId, { parentId, authorId: userId, body });
    if (!reply) return { ok: false, error: 'That comment no longer exists.' };

    return { ok: true, data: reply };
  } catch (error) {
    return { ok: false, error: explain(error) };
  }
}

export async function resolveCommentAction(input: {
  commentId: unknown;
}): Promise<CommentResult<Comment>> {
  try {
    const { tenantId, userId } = await requireMember();

    const commentId = String(input?.commentId ?? '');
    if (!UUID.test(commentId)) return { ok: false, error: 'That comment no longer exists.' };

    const resolved = await resolveComment(tenantId, commentId, userId);
    if (!resolved) return { ok: false, error: 'That comment no longer exists.' };

    return { ok: true, data: resolved };
  } catch (error) {
    return { ok: false, error: explain(error) };
  }
}

export async function reopenCommentAction(input: {
  commentId: unknown;
}): Promise<CommentResult<Comment>> {
  try {
    const { tenantId } = await requireMember();

    const commentId = String(input?.commentId ?? '');
    if (!UUID.test(commentId)) return { ok: false, error: 'That comment no longer exists.' };

    const reopened = await reopenComment(tenantId, commentId);
    if (!reopened) return { ok: false, error: 'That comment no longer exists.' };

    return { ok: true, data: reopened };
  } catch (error) {
    return { ok: false, error: explain(error) };
  }
}

export async function listPageCommentsAction(input: {
  pageId: unknown;
}): Promise<CommentResult<ResolvedThread[]>> {
  try {
    const tenantId = await requireTenantId();

    const pageId = String(input?.pageId ?? '');
    if (!UUID.test(pageId)) return { ok: true, data: [] };

    // The author is resolved to a name here, on the server, the same way the
    // activity log does it: the row stores an opaque id, and the members list,
    // read under the same tenant scope, turns it into a name a person knows.
    const [threads, members] = await Promise.all([
      listPageComments(tenantId, pageId),
      listMembers(tenantId),
    ]);
    return { ok: true, data: resolveThreads(threads, members) };
  } catch (error) {
    return { ok: false, error: explain(error) };
  }
}

/**
 * The whole-site review list: every open thread across the site, authors named.
 *
 * Any member may read it, the same gate the per-page list uses: it is their own
 * site's review, and the query is tenant scoped. The author names come from the
 * members list read under the same scope, exactly as listPageCommentsAction does.
 */
export async function siteCommentsAction(): Promise<CommentResult<SiteComment[]>> {
  try {
    const tenantId = await requireTenantId();
    const [open, members] = await Promise.all([listOpenComments(tenantId), listMembers(tenantId)]);
    return { ok: true, data: resolveSiteComments(open, members) };
  } catch (error) {
    return { ok: false, error: explain(error) };
  }
}

/** How many threads are open across the site, for the rail's Comments badge. */
export async function openCommentCountAction(): Promise<CommentResult<number>> {
  try {
    const tenantId = await requireTenantId();
    return { ok: true, data: await countOpenComments(tenantId) };
  } catch (error) {
    return { ok: false, error: explain(error) };
  }
}

function explain(error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  if (message.startsWith('Your session has ended')) return message;

  console.error('[tg-sites] comment action failed', error);
  return 'That did not work. Reload the page and try again.';
}
