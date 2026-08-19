/**
 * Who a new-comment email goes to, and what it says. The pure half of the
 * notification, kept free of any server import so a plain-Node test covers it,
 * the same split lib/comments/resolve.ts uses.
 *
 * WHO. A client's review comment is for the Travelgenix team, so the recipients
 * are the site's staff members, never the client who wrote it and never another
 * client. Staff is decided by the same isStaffEmail the access checks use.
 *
 * WHAT. A short plain note: who left it, which page, the first line of what they
 * said, and a link straight to the thread. The body a person typed is escaped
 * before it goes anywhere near the HTML part, because it is free client input.
 */

import { isStaffEmail } from '../auth/staff';
import { escapeHtml } from '../content/sanitise';

/** The member fields the notifier needs, named so a test can build one. */
export interface NotifyMember {
  userId: string;
  email: string;
}

/**
 * The staff addresses to notify about a comment, minus its author.
 *
 * De-duplicated and lower-cased. A client author yields the site's staff; a staff
 * author (staff can comment too) still never emails themselves, and the caller
 * decides whether a staff-authored comment notifies anyone at all.
 */
export function staffRecipients(members: readonly NotifyMember[], authorId: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const member of members) {
    if (member.userId === authorId) continue;
    if (!isStaffEmail(member.email)) continue;
    const email = member.email.trim().toLowerCase();
    if (seen.has(email)) continue;
    seen.add(email);
    out.push(email);
  }
  return out;
}

/** The first line of a comment, capped, for the subject and the preview. */
export function firstLine(body: string, max = 140): string {
  const line = body.replace(/\s+/g, ' ').trim();
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

/**
 * The subject, HTML and plain-text of a new-comment email.
 *
 * Everything that came from a person (the author's name, the page title, the
 * comment body) is escaped for the HTML part. The link is built by the caller
 * from the app's own origin, so it is ours, and is only included when there is
 * one.
 */
export function buildCommentEmail(input: {
  authorName: string;
  pageTitle: string;
  body: string;
  link: string | null;
}): { subject: string; html: string; text: string } {
  const preview = firstLine(input.body);
  const where = input.pageTitle.trim() || 'a page';
  const subject = `New comment on ${where}`;

  const name = input.authorName.trim() || 'A client';
  const eName = escapeHtml(name);
  const eWhere = escapeHtml(where);
  const ePreview = escapeHtml(preview);

  const button = input.link
    ? `<p style="margin:24px 0 8px"><a href="${escapeHtml(input.link)}" style="display:inline-block;background:#1f7a8c;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:600">Open the comment</a></p>`
    : '';

  const html = [
    '<div style="font-family:Segoe UI,Helvetica,Arial,sans-serif;color:#1b2b3a;font-size:15px;line-height:1.5">',
    `<p><strong>${eName}</strong> left a comment on <strong>${eWhere}</strong>.</p>`,
    `<blockquote style="margin:12px 0;padding:8px 14px;border-left:3px solid #cdd7de;color:#405260">${ePreview}</blockquote>`,
    button,
    '<p style="color:#6a7a86;font-size:13px;margin-top:20px">You are getting this because you are on the Travelgenix team for this site.</p>',
    '</div>',
  ].join('');

  const text = [
    `${name} left a comment on ${where}.`,
    '',
    `"${preview}"`,
    input.link ? `\nOpen the comment: ${input.link}` : '',
    '',
    'You are getting this because you are on the Travelgenix team for this site.',
  ].join('\n');

  return { subject, html, text };
}
