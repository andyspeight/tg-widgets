/**
 * Emailing the Travelgenix team when a client leaves a review comment.
 *
 * The push side of the comments feature. The panel, the whole-site list and the
 * canvas pins all need somebody to be looking at the editor; this reaches the
 * team when they are not, so a client's note does not wait to be noticed.
 *
 * ONLY A CLIENT'S COMMENT NOTIFIES, and only the staff, never the client back.
 * Staff replying to each other in a thread is not news to send; a client raising
 * something is. The author's own address is dropped either way.
 *
 * BEST EFFORT, caught whole. A comment is written the moment createComment
 * returns; this runs after and must never turn a saved comment into an error.
 * Unset mail keys, no staff on the site, a provider hiccup: each is a quiet
 * return, and the comment stands regardless.
 */

import 'server-only';

import { listMembers } from '../db/members';
import { withTenant } from '../db/withTenant';
import { isStaffEmail } from '../auth/staff';
import { sendEmail } from '../email/send';
import { buildCommentEmail, staffRecipients } from './notify-content';

/** The page's title, read under the tenant scope, for the email. */
async function pageTitle(tenantId: string, pageId: string): Promise<string> {
  return withTenant(tenantId, async (tx) => {
    const rows = await tx`select title from public.pages where id = ${pageId}::uuid limit 1`;
    return rows.length ? String((rows[0] as Record<string, unknown>).title ?? '') : '';
  });
}

/**
 * Notify the site's staff that a client left a comment. Does nothing, quietly,
 * when the author is staff, when the site has no staff to tell, or when mail is
 * not configured.
 */
export async function notifyNewComment(
  tenantId: string,
  input: { pageId: string; authorId: string; body: string; threadId: string; origin?: string | null },
): Promise<void> {
  try {
    const members = await listMembers(tenantId);

    // A staff member's own comment is not something to email staff about.
    const author = members.find((member) => member.userId === input.authorId);
    if (author && isStaffEmail(author.email)) return;

    const recipients = staffRecipients(members, input.authorId);
    if (recipients.length === 0) return;

    const authorName = author ? author.name?.trim() || author.email : 'A client';
    const title = await pageTitle(tenantId, input.pageId);
    const link = input.origin
      ? `${input.origin}/editor?page=${encodeURIComponent(input.pageId)}&comment=${encodeURIComponent(input.threadId)}`
      : null;

    const email = buildCommentEmail({ authorName, pageTitle: title, body: input.body, link });
    await sendEmail({
      to: recipients,
      subject: email.subject,
      html: email.html,
      text: email.text,
      categoryTag: 'tg-sites-comment',
    });
  } catch {
    // Best effort: the comment is already saved, and a failed notification must
    // never surface as a failed comment.
  }
}
