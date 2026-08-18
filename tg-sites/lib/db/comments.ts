/**
 * Comments: a client's review notes on a page, and the team's replies.
 *
 * A thread is a root comment plus its replies, one level deep. The client leaves
 * the root, Travelgenix staff (or the client) reply and resolve. See
 * db/migrations/0022_site_comments.sql for why this is not the append-only shape
 * the activity log uses.
 *
 * FAIL CLOSED ON OWNERSHIP, the same care createItem in collections.ts takes. The
 * page id and the parent id both arrive from the browser, so both are guesses.
 * Every write is an INSERT ... SELECT through the scoped table, so a guess naming
 * another tenant's page or thread finds nothing and writes nothing, rather than
 * attaching a comment where its author could never see it. The reads and the
 * resolves lean on the policy the same way: another tenant's rows are invisible,
 * so an id that is not this tenant's simply matches nothing and returns null.
 */

import 'server-only';

import { withTenant, type Tx } from './withTenant';

export interface Comment {
  id: string;
  pageId: string;
  /** The thread root this reply belongs to, or null for a root comment. */
  parentId: string | null;
  authorId: string;
  body: string;
  /** A pinned element's block id, or null for a page-level comment. */
  anchor: string | null;
  resolvedAt: Date | null;
  resolvedBy: string | null;
  createdAt: Date;
}

/** A root comment and the replies under it, oldest first. */
export interface CommentThread {
  comment: Comment;
  replies: Comment[];
}

/** The longest a comment may be, matched to the table's check constraint. */
export const MAX_COMMENT_LENGTH = 4000;

/**
 * The columns every read wants, as a composable fragment rather than a pasted
 * string, so it stays parameterised the whole way down. Same shape as pages.ts.
 */
function columns(tx: Tx) {
  return tx`
    id, page_id, parent_id, author_id, body, anchor, resolved_at, resolved_by, created_at
  `;
}

function toComment(row: Record<string, unknown>): Comment {
  return {
    id: String(row.id),
    pageId: String(row.page_id),
    parentId: row.parent_id != null ? String(row.parent_id) : null,
    authorId: String(row.author_id),
    body: String(row.body),
    anchor: row.anchor != null ? String(row.anchor) : null,
    resolvedAt: row.resolved_at != null ? new Date(row.resolved_at as string) : null,
    resolvedBy: row.resolved_by != null ? String(row.resolved_by) : null,
    createdAt: new Date(row.created_at as string),
  };
}

/**
 * A comment body fit to store: control characters gone, trimmed, capped.
 *
 * Free client input, cleaned here before it reaches the column. It is NOT made
 * safe for HTML here, because it is never put through innerHTML; the view escapes
 * it on render. Tab, newline and carriage return are kept, because a comment is
 * written in prose. Returns null for anything empty once trimmed, which the
 * caller turns into a refusal rather than storing a blank comment.
 *
 * Filtered by code point in a loop rather than a regex, on purpose: a character
 * class of control-character escapes is the one bit of this codebase a bundler
 * has mangled before (see lib/media/limits.ts), and numbers cannot be mangled.
 */
export function cleanCommentBody(value: unknown): string | null {
  if (typeof value !== 'string') return null;

  let kept = '';
  for (const ch of value) {
    const code = ch.codePointAt(0) ?? 0;
    // Drop the C0 controls and DEL, but keep tab (0x09), newline (0x0A) and
    // carriage return (0x0D), which a written comment legitimately contains.
    const isControl =
      (code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) || code === 0x7f;
    if (!isControl) kept += ch;
  }

  const cleaned = kept.trim();
  if (!cleaned) return null;
  return cleaned.slice(0, MAX_COMMENT_LENGTH);
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

/**
 * Every comment on a page, grouped into threads, oldest first.
 *
 * One query for the page's rows, then the roots and their replies are stitched
 * in memory: a page has tens of comments at most, so a second query per thread
 * would be round trips for nothing. A reply whose root is not in the result (a
 * root deleted out from under it, which the cascade should prevent) is simply
 * left out rather than shown parentless.
 */
export async function listPageComments(tenantId: string, pageId: string): Promise<CommentThread[]> {
  return withTenant(tenantId, async (tx) => {
    const rows = await tx`
      select ${columns(tx)} from public.site_comments
      where page_id = ${pageId}::uuid
      order by created_at asc, id asc
    `;

    const all = rows.map((row) => toComment(row as Record<string, unknown>));
    const repliesByRoot = new Map<string, Comment[]>();
    for (const comment of all) {
      if (comment.parentId === null) continue;
      const bucket = repliesByRoot.get(comment.parentId);
      if (bucket) bucket.push(comment);
      else repliesByRoot.set(comment.parentId, [comment]);
    }

    return all
      .filter((comment) => comment.parentId === null)
      .map((comment) => ({ comment, replies: repliesByRoot.get(comment.id) ?? [] }));
  });
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

/**
 * Leave a comment on a page.
 *
 * INSERT ... SELECT FROM pages, not VALUES, and that is the security of it. The
 * page id is the browser's guess; selecting from pages puts it through that
 * table's own policy, so a page belonging to another tenant is invisible, the
 * select finds nothing, and nothing is inserted. Null then means the same as a
 * page that does not exist, which is the right answer for a guessed id.
 */
export async function createComment(
  tenantId: string,
  input: { pageId: string; authorId: string; body: string; anchor?: string | null },
): Promise<Comment | null> {
  return withTenant(tenantId, async (tx) => {
    const rows = await tx`
      insert into public.site_comments (tenant_id, page_id, author_id, body, anchor)
      select ${tenantId}::uuid, p.id, ${input.authorId}::text, ${input.body}, ${input.anchor ?? null}::text
      from public.pages p
      where p.id = ${input.pageId}::uuid
      returning ${columns(tx)}
    `;
    return rows.length ? toComment(rows[0] as Record<string, unknown>) : null;
  });
}

/**
 * Reply to a thread.
 *
 * The same INSERT ... SELECT guard, through site_comments this time: the parent
 * must be visible (this tenant's) AND a root (parent_id is null), so a reply can
 * only ever hang off a top-level comment, which is what keeps threads one level
 * deep. The reply inherits its root's page, so it cannot be planted on a
 * different page than the conversation it joins.
 */
export async function addReply(
  tenantId: string,
  input: { parentId: string; authorId: string; body: string },
): Promise<Comment | null> {
  return withTenant(tenantId, async (tx) => {
    const rows = await tx`
      insert into public.site_comments (tenant_id, page_id, parent_id, author_id, body)
      select ${tenantId}::uuid, c.page_id, c.id, ${input.authorId}::text, ${input.body}
      from public.site_comments c
      where c.id = ${input.parentId}::uuid and c.parent_id is null
      returning ${columns(tx)}
    `;
    return rows.length ? toComment(rows[0] as Record<string, unknown>) : null;
  });
}

/**
 * Mark a thread resolved.
 *
 * Roots only (parent_id is null): a thread is resolved, not an individual reply.
 * Scoped by the policy, so an id that is not this tenant's matches nothing and
 * returns null, the same answer a resolve of something that is not a root gives.
 */
export async function resolveComment(
  tenantId: string,
  commentId: string,
  resolverId: string,
): Promise<Comment | null> {
  return withTenant(tenantId, async (tx) => {
    const rows = await tx`
      update public.site_comments
      set resolved_at = now(), resolved_by = ${resolverId}::text
      where id = ${commentId}::uuid and parent_id is null
      returning ${columns(tx)}
    `;
    return rows.length ? toComment(rows[0] as Record<string, unknown>) : null;
  });
}

/** Reopen a resolved thread, the exact inverse of resolveComment. */
export async function reopenComment(tenantId: string, commentId: string): Promise<Comment | null> {
  return withTenant(tenantId, async (tx) => {
    const rows = await tx`
      update public.site_comments
      set resolved_at = null, resolved_by = null
      where id = ${commentId}::uuid and parent_id is null
      returning ${columns(tx)}
    `;
    return rows.length ? toComment(rows[0] as Record<string, unknown>) : null;
  });
}
