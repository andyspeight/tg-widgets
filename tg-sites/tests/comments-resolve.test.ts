/**
 * The comment author resolver, tested without a tenant.
 *
 * resolveThreads is the pure half of the comments feature: it puts a member's
 * name to the opaque id each row stores. Kept apart from the action so it can be
 * checked here with hand-built rows, the same split lib/activity/log.ts uses.
 */

import { describe, expect, it } from 'vitest';

import { resolveThreads } from '../lib/comments/resolve';
import type { Comment, CommentThread } from '../lib/db/comments';

const comment = (over: Partial<Comment> = {}): Comment => ({
  id: 'c1',
  pageId: 'p1',
  parentId: null,
  authorId: 'u1',
  body: 'Bigger please',
  anchor: null,
  resolvedAt: null,
  resolvedBy: null,
  createdAt: new Date('2026-08-18T00:00:00Z'),
  ...over,
});

const members = [
  { userId: 'u1', email: 'client@acme.com', name: 'Jane Client' },
  { userId: 'u2', email: 'staff@travelgenix.com', name: null },
];

describe('resolveThreads', () => {
  it('names each author, name over email, null for an unknown id', () => {
    const threads: CommentThread[] = [
      {
        comment: comment({ id: 'c1', authorId: 'u1' }),
        replies: [comment({ id: 'r1', parentId: 'c1', authorId: 'u2' })],
      },
      { comment: comment({ id: 'c2', authorId: 'ghost' }), replies: [] },
    ];

    const resolved = resolveThreads(threads, members);
    expect(resolved[0].author).toBe('Jane Client');
    // No name set, so the email stands in.
    expect(resolved[0].replies[0].author).toBe('staff@travelgenix.com');
    // An id belonging to nobody in the site resolves to null, not a crash.
    expect(resolved[1].author).toBeNull();
  });

  it('carries the resolved flag and names who resolved it', () => {
    const threads: CommentThread[] = [
      {
        comment: comment({
          authorId: 'u1',
          resolvedAt: new Date('2026-08-18T01:00:00Z'),
          resolvedBy: 'u2',
        }),
        replies: [],
      },
    ];

    const [thread] = resolveThreads(threads, members);
    expect(thread.resolved).toBe(true);
    expect(thread.resolvedBy).toBe('staff@travelgenix.com');
  });

  it('an open thread is not resolved and has no resolver', () => {
    const [thread] = resolveThreads([{ comment: comment(), replies: [] }], members);
    expect(thread.resolved).toBe(false);
    expect(thread.resolvedBy).toBeNull();
  });
});
