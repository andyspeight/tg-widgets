import type { Metadata } from 'next';

import '../../../components/sites/sites.css';
import '../../../components/members/members.css';
import { JoinForm } from '../../../components/members/JoinForm';
import { hashInviteToken, looksLikeInviteToken } from '../../../lib/auth/invite';
import { MIN_PASSWORD_LENGTH } from '../../../lib/auth/password';
import { currentUser } from '../../../lib/auth/session';
import { findCredentials, inviteByToken } from '../../../lib/db/users';
import { getTenant } from '../../../lib/db/tenants';

export const metadata: Metadata = {
  title: 'Join a site · Travelgenix Sites',
  // Never. A page whose whole address is a credential must not be in an index.
  robots: { index: false, follow: false },
};

/**
 * Redeeming an invite link.
 *
 * FOUR STATES, AND ALL FOUR HAVE TO BE SAID PLAINLY, because the person reading
 * this has been sent a link by a colleague and has no idea how any of it works:
 *
 *   the link is dead          -> say so once, offer nothing else
 *   signed in as the right    -> one button
 *     person
 *   signed in as somebody     -> say who, and how to fix it
 *     else
 *   not signed in             -> set a password, or sign in if there is
 *                                already an account for this address
 *
 * THE ADDRESS OF THIS PAGE IS THE CREDENTIAL, which is why it is noindex and
 * why nothing here is cached. It also means the token is in the browser's
 * history and in any referrer, which is the accepted cost of a link somebody can
 * paste into a chat window: the mitigations are that it expires in fourteen
 * days, works once, and only for one email address.
 *
 * EVERY WAY OF BEING WRONG LOOKS THE SAME. Expired, spent, revoked, for a
 * switched-off site or never real at all: one sentence covers them, so a stale
 * link tells nobody anything about what used to be there.
 */
export const dynamic = 'force-dynamic';

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="sv-wrap">
      <div className="jn-card">
        <p className="sv-eyebrow">Travelgenix Sites</p>
        <h1 className="sv-title">{title}</h1>
        {children}
      </div>
    </main>
  );
}

export default async function JoinPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  /*
   * The cheap gate first, so a path of junk never reaches the database. A token
   * that gets past it is still worthless without a matching row.
   */
  const invite = looksLikeInviteToken(token)
    ? await inviteByToken(hashInviteToken(token)).catch(() => null)
    : null;

  if (!invite) {
    return (
      <Card title="This link has expired">
        <p>
          Invite links last fourteen days and work once. Ask whoever sent it to
          make you another one.
        </p>
      </Card>
    );
  }

  const [tenant, user] = await Promise.all([
    getTenant(invite.tenantId).catch(() => null),
    currentUser().catch(() => null),
  ]);

  const siteName = tenant?.name ?? 'this site';

  // Signed in as somebody else. Said with both addresses on screen, because
  // "wrong account" without saying which is a puzzle rather than a message.
  if (user && user.email.trim().toLowerCase() !== invite.email) {
    return (
      <Card title="This invite is for somebody else">
        <p>
          It was sent to <strong>{invite.email}</strong>, and you are signed in as{' '}
          <strong>{user.email}</strong>.
        </p>
        <p>
          Sign out, then open the link again. If both addresses are yours, use the
          one the invite names.
        </p>
        <a className="sv-btn" href="/signin">
          Go to sign in
        </a>
      </Card>
    );
  }

  /*
   * Whether this address already has an account decides which form is drawn.
   *
   * ASKING THAT QUESTION IS NORMALLY AN ENUMERATION ORACLE and here it is not:
   * the only way to reach this line is holding a 256-bit token that was issued
   * for this exact address. Nothing is being revealed to anyone who did not
   * already have it.
   */
  const existing = user ? null : await findCredentials(invite.email).catch(() => null);

  if (!user && existing) {
    const next = encodeURIComponent(`/join/${token}`);
    return (
      <Card title={`Join ${siteName}`}>
        <p>
          <strong>{invite.email}</strong> already has an account here. Sign in and
          you will come straight back to this page.
        </p>
        <a className="sv-btn" data-variant="primary" href={`/signin?next=${next}`}>
          Sign in
        </a>
      </Card>
    );
  }

  return (
    <Card title={`Join ${siteName}`}>
      <p className="jn-lede">
        You have been invited to help with <strong>{siteName}</strong> as{' '}
        <strong>{invite.role === 'viewer' ? 'a viewer' : `an ${invite.role}`}</strong>,
        at <strong>{invite.email}</strong>.
      </p>

      <JoinForm
        token={token}
        email={invite.email}
        siteName={siteName}
        needsPassword={!user}
        minPasswordLength={MIN_PASSWORD_LENGTH}
      />
    </Card>
  );
}
