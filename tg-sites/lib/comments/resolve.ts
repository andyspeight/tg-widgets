/**
 * Turning stored comment rows into the threads the panel draws.
 *
 * PURE, AND FREE OF ANY SERVER IMPORT. The one import is a type, erased at build,
 * so the editor panel and a plain-Node test can both use this. Same split as
 * lib/activity/log.ts: the database layer reads rows, this shapes what is shown,
 * and keeping the two apart lets the shaping be tested without a tenant.
 *
 * Its whole job is to put a name to an id. A comment stores an opaque author id;
 * the site's member list turns it into the name a person recognises, or their
 * email, or null when the id belongs to nobody currently in the site.
 */

import type { CommentThread } from '../db/comments';

export interface ResolvedReply {
  id: string;
  /** The author's name or email, or null if they are no longer in the site. */
  author: string | null;
  body: string;
  createdAt: Date;
}

export interface ResolvedThread {
  id: string;
  author: string | null;
  body: string;
  createdAt: Date;
  /** A pinned element's block id, or null for a page-level comment. */
  anchor: string | null;
  resolved: boolean;
  /** Who resolved it, by name, or null while it is open. */
  resolvedBy: string | null;
  resolvedAt: Date | null;
  replies: ResolvedReply[];
}

/**
 * The member fields the resolver needs, named rather than the whole Member type
 * so a test can build one without a database row. Same shape resolveActors uses.
 */
interface NamedMember {
  userId: string;
  email: string;
  name: string | null;
}

export function resolveThreads(threads: CommentThread[], members: NamedMember[]): ResolvedThread[] {
  const nameById = new Map(members.map((member) => [member.userId, member.name?.trim() || member.email]));
  const nameOf = (id: string | null): string | null => (id ? nameById.get(id) ?? null : null);

  return threads.map((thread) => ({
    id: thread.comment.id,
    author: nameOf(thread.comment.authorId),
    body: thread.comment.body,
    createdAt: thread.comment.createdAt,
    anchor: thread.comment.anchor,
    resolved: thread.comment.resolvedAt !== null,
    resolvedBy: nameOf(thread.comment.resolvedBy),
    resolvedAt: thread.comment.resolvedAt,
    replies: thread.replies.map((reply) => ({
      id: reply.id,
      author: nameOf(reply.authorId),
      body: reply.body,
      createdAt: reply.createdAt,
    })),
  }));
}
