'use server';

/**
 * Adding, changing and removing the people who can edit a site.
 *
 * ONLY AN OWNER, AND THE CHECK IS HERE. The members screen is drawn for
 * everybody, because seeing who your colleagues are is not a privilege, and the
 * buttons are drawn only for an owner. That second part is a courtesy to whoever
 * is looking at the screen and no obstacle at all to somebody calling the action
 * directly: a server action is a public HTTP endpoint whose URL is in the page's
 * own JavaScript. Every function below that changes anything asks requireOwner
 * first, before it reads a single argument.
 *
 * STAFF COUNT AS OWNERS, deliberately. Travelgenix builds these sites for
 * clients, so being locked out of a customer's members list would mean asking
 * them to add us before we could help them. isStaffEmail is the same check that
 * gates the custom code panel.
 *
 * THE TOKEN IS RETURNED EXACTLY ONCE, in the answer to the call that made it,
 * and never again. It is not stored, so there is nothing to show later: the
 * screen has to put the link in front of the owner while it has it. Coming back
 * tomorrow means issuing a new one, which is the right shape for a credential.
 */

import { revalidatePath } from 'next/cache';

import { normaliseEmail } from '../../lib/auth/email';
import {
  hashInviteToken,
  inviteLink,
  looksLikeInviteToken,
  newInviteToken,
} from '../../lib/auth/invite';
import { hashPassword, MIN_PASSWORD_LENGTH } from '../../lib/auth/password';
import {
  currentUser,
  requireSite,
  sessionsAreConfigured,
  startSession,
} from '../../lib/auth/session';
import { isStaffEmail } from '../../lib/auth/staff';
import {
  acceptInvite,
  createInvite,
  isMemberRole,
  removeMember,
  setMemberRole,
  type AcceptOutcome,
  type MemberRole,
  type PendingInvite,
} from '../../lib/db/members';
import { createInvitedAccount, inviteByToken } from '../../lib/db/users';

export type MemberResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: string };

/**
 * The site this request is about, but only for somebody allowed to change it.
 *
 * Throws rather than returning a flag, so a caller that forgets to check gets
 * an exception instead of carrying on with a falsy value.
 */
async function requireOwner() {
  const site = await requireSite();
  if (site.role === 'owner') return site;

  const user = await currentUser();
  if (user && isStaffEmail(user.email)) return site;

  throw new Error('Only an owner can change who is in this site.');
}

// ---------------------------------------------------------------------------
// Inviting
// ---------------------------------------------------------------------------

export interface IssuedInvite {
  invite: PendingInvite;
  /** The whole link, shown once and never stored. */
  link: string;
}

/**
 * Issue an invite and hand back the link.
 *
 * THERE IS NO "ADD AN EXISTING ACCOUNT BY EMAIL", and that is a security
 * decision rather than a missing feature. Adding somebody who already has an
 * account would have to behave differently from inviting somebody who does not,
 * and the difference is observable: any site owner could type an email and learn
 * from the answer whether that person has an account with us. One path removes
 * the oracle, and it happens to be simpler.
 *
 * `origin` comes from the caller, which reads it from the request the browser
 * actually made. NOT from a Host header inside this function: a header is
 * attacker-controlled, and a link built from one is how an invite ends up
 * pointing at somebody else's server with a live token on the end of it.
 */
export async function inviteMemberAction(input: {
  email: unknown;
  role: unknown;
  origin: unknown;
}): Promise<MemberResult<IssuedInvite>> {
  try {
    const site = await requireOwner();

    const email = normaliseEmail(input.email);
    if (!email) return { ok: false, error: 'That does not look like an email address.' };

    const role = isMemberRole(input.role) ? (input.role as MemberRole) : 'editor';

    /*
     * ONLY OUR OWN ORIGIN. The value arrives from the client component, which
     * read it from window.location, so it is as trustworthy as anything else in
     * a request body: not at all. A link is a credential with somewhere to go,
     * and the somewhere has to be us.
     */
    const origin = safeOrigin(input.origin);
    if (!origin) return { ok: false, error: 'That did not work. Reload the page and try again.' };

    const token = newInviteToken();
    const invite = await createInvite(site.tenantId, {
      email,
      role,
      tokenHash: hashInviteToken(token),
      createdBy: (await currentUser())?.id,
    });

    if (!invite) {
      return { ok: false, error: `${email} can already edit this site.` };
    }

    revalidatePath('/members');
    return { ok: true, data: { invite, link: inviteLink(origin, token) } };
  } catch (error) {
    return { ok: false, error: explain(error) };
  }
}

export async function revokeInviteAction(inviteId: unknown): Promise<MemberResult> {
  try {
    const site = await requireOwner();
    const { revokeInvite } = await import('../../lib/db/members');

    const gone = await revokeInvite(site.tenantId, String(inviteId ?? ''));
    if (!gone) return { ok: false, error: 'That invite has already gone.' };

    revalidatePath('/members');
    return { ok: true, data: undefined };
  } catch (error) {
    return { ok: false, error: explain(error) };
  }
}

// ---------------------------------------------------------------------------
// Changing what somebody can do
// ---------------------------------------------------------------------------

export async function setRoleAction(
  userId: unknown,
  next: unknown,
): Promise<MemberResult> {
  try {
    const site = await requireOwner();

    if (!isMemberRole(next)) return { ok: false, error: 'That is not a role.' };

    const refusal = await setMemberRole(site.tenantId, String(userId ?? ''), next);
    if (refusal) return { ok: false, error: refusalMessage(refusal) };

    revalidatePath('/members');
    return { ok: true, data: undefined };
  } catch (error) {
    return { ok: false, error: explain(error) };
  }
}

export async function removeMemberAction(userId: unknown): Promise<MemberResult> {
  try {
    const site = await requireOwner();

    const refusal = await removeMember(site.tenantId, String(userId ?? ''));
    if (refusal) return { ok: false, error: refusalMessage(refusal) };

    revalidatePath('/members');
    return { ok: true, data: undefined };
  } catch (error) {
    return { ok: false, error: explain(error) };
  }
}

// ---------------------------------------------------------------------------
// Redeeming a link
// ---------------------------------------------------------------------------

/**
 * Join a site, as the person who is already signed in.
 *
 * NO OWNER CHECK, obviously: the whole point is that the caller is not in the
 * site yet. What stands in its place is the token, which is a 256-bit secret
 * they can only have because somebody sent it to them, and the email binding,
 * which means a forwarded link is refused.
 */
export async function acceptInviteAction(token: unknown): Promise<AcceptOutcome> {
  if (!looksLikeInviteToken(token)) return { ok: false, reason: 'gone' };

  const user = await currentUser();
  // Not signed in. The screen sends them to sign in and back, so this is the
  // belt to that braces rather than a path anybody normally takes.
  if (!user) return { ok: false, reason: 'wrong-person' };

  const outcome = await acceptInvite(hashInviteToken(token), {
    id: user.id,
    email: user.email,
  });

  if (outcome.ok) {
    revalidatePath('/sites');
    revalidatePath('/members');
  }

  return outcome;
}

// ---------------------------------------------------------------------------

function refusalMessage(refusal: 'last-owner' | 'not-a-member'): string {
  return refusal === 'last-owner'
    ? 'Somebody has to own this site. Make another person an owner first, then change this one.'
    : 'They are not in this site any more. Reload the page.';
}

/**
 * An origin that is definitely ours, or null.
 *
 * Parsed rather than pattern-matched, so a value like
 * "https://us.example.com@evil.test" is decomposed by the URL parser rather than
 * by a regex somebody has to get right. https only, no path, no credentials,
 * and localhost allowed because that is where this is developed.
 */
function safeOrigin(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 300) return null;

  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' && url.hostname !== 'localhost') return null;
    if (url.username || url.password) return null;
    return url.origin;
  } catch {
    return null;
  }
}

function explain(error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  // The two worth naming. Anything else stays generic on purpose.
  if (message.includes('Only an owner')) return message;
  if (message.includes('not a member of any site')) return message;
  return 'That did not work. Reload the page and try again.';
}

/**
 * Join a site AND make the account, for somebody who has never signed in here.
 *
 * THE ONLY WAY AN ACCOUNT IS CREATED IN THIS PRODUCT, and it needs a 256-bit
 * token addressed to the email it creates. db/make-user.mjs says there should be
 * no self-service sign-up and there is not: this makes an account because an
 * owner of an existing site asked for one, which is what an invite is.
 *
 * THE ORDER IS ACCOUNT, SESSION, MEMBERSHIP. Making the account first means a
 * failure after it leaves somebody with a usable login and no site, which they
 * can fix by opening the link again. The other order would spend the invite and
 * leave them unable to sign in at all.
 *
 * THE EMAIL IS NEVER TAKEN FROM THE FORM. It comes off the invite row, so
 * nobody can redeem a link into an address of their choosing.
 */
export async function joinWithPasswordAction(input: {
  token: unknown;
  password: unknown;
  name: unknown;
}): Promise<MemberResult<{ slug: string; siteName: string }>> {
  try {
    if (!sessionsAreConfigured()) {
      return {
        ok: false,
        error: 'This deployment cannot hold a session yet, so nobody can join.',
      };
    }

    if (!looksLikeInviteToken(input.token)) {
      return { ok: false, error: 'That link is not one of ours.' };
    }

    const hash = hashInviteToken(input.token);
    const invite = await inviteByToken(hash);
    if (!invite) {
      return { ok: false, error: 'That link has expired or has already been used.' };
    }

    const password = String(input.password ?? '');
    if (password.length < MIN_PASSWORD_LENGTH) {
      return {
        ok: false,
        error: `Choose a password of at least ${MIN_PASSWORD_LENGTH} characters.`,
      };
    }

    const account = await createInvitedAccount({
      email: invite.email,
      passwordHash: await hashPassword(password),
      name: String(input.name ?? '').trim().slice(0, 120) || null,
    });

    if (!account) {
      // The address already has an account, which is a thing they can act on
      // rather than a failure: sign in and open the link again.
      return {
        ok: false,
        error: `${invite.email} already has an account. Sign in and open this link again.`,
      };
    }

    await startSession(account.id);

    const outcome = await acceptInvite(hash, { id: account.id, email: account.email });
    if (!outcome.ok) {
      return { ok: false, error: 'That link has expired or has already been used.' };
    }

    revalidatePath('/', 'layout');
    return { ok: true, data: { slug: outcome.slug, siteName: outcome.siteName } };
  } catch (error) {
    return { ok: false, error: explain(error) };
  }
}
