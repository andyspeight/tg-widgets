import 'server-only';

/**
 * The session: who is signed in, and which of their sites they are looking at.
 *
 * Replaces the workspace-slug cookie that stood in for this. That cookie held a
 * slug anyone could type, resolved it through the hostname function, and gave
 * whoever typed it the run of that site. It is why the editor and the dashboard
 * have been carrying a banner admitting there is no sign-in.
 *
 * TWO COOKIES, TWO JOBS
 *
 *   tgs_session   Signed. Says who you are. Only the server can write a valid
 *                 one, because only the server has SESSION_SECRET.
 *
 *   tgs_site      Unsigned, and it does not need to be. It holds a tenant SLUG,
 *                 which is a preference, not a permission: every read of it
 *                 goes through the membership list, so a hand-edited value
 *                 either names a site you belong to or is ignored.
 *
 * THE RULE THAT MAKES THIS SAFE
 *
 * A tenant id is only ever a value the database handed over in answer to
 * "which sites does this user belong to". Nothing in this file accepts one from
 * a request, and nothing outside it should either. That is why the site cookie
 * stores a slug: a slug has to be looked up, and the lookup is the check.
 */

import { cookies } from 'next/headers';

import { findUser, listMemberships, type Membership } from '../db/users';
import {
  isUsableSecret,
  readSession,
  signSession,
  SESSION_MAX_AGE_SECONDS,
  type SessionClaims,
} from './token';

const SESSION_COOKIE = 'tgs_session';
const SITE_COOKIE = 'tgs_site';

/**
 * sameSite lax, not strict.
 *
 * Strict would drop the cookie on any navigation that arrives from another
 * site, so following a link to a page in the editor from an email would land
 * on the sign-in screen while already signed in. Lax still refuses to send the
 * cookie on a cross-site POST, which is the case that matters.
 */
const BASE_COOKIE = {
  httpOnly: true,
  sameSite: 'lax',
  secure: process.env.NODE_ENV === 'production',
  path: '/',
} as const;

/** The signing secret, or null when it is not configured. */
function secret(): string | null {
  const value = process.env.SESSION_SECRET;
  return isUsableSecret(value) ? value : null;
}

/**
 * Whether this deployment can hold a session at all.
 *
 * Exported so a screen can say "SESSION_SECRET is not set" instead of showing a
 * sign-in form that will refuse every correct password.
 */
export function sessionsAreConfigured(): boolean {
  return secret() !== null;
}

// ---------------------------------------------------------------------------
// Reading the session
// ---------------------------------------------------------------------------

/**
 * The verified claims in this request's session cookie, or null.
 *
 * Null covers no cookie, a forged one, an expired one and a deployment with no
 * secret. Every caller treats all four the same way: not signed in.
 */
export async function sessionClaims(): Promise<SessionClaims | null> {
  const key = secret();
  if (!key) return null;

  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return readSession(token, key);
}

/** The signed-in user's id, or null. Trustworthy: the cookie is signed. */
export async function currentUserId(): Promise<string | null> {
  return (await sessionClaims())?.userId ?? null;
}

export interface CurrentUser {
  id: string;
  email: string;
  name: string | null;
}

/**
 * The signed-in person, read from the database.
 *
 * Costs a query, so it is for screens that show who you are. Anything that only
 * needs to scope a query wants currentUserId, which costs nothing.
 *
 * Returns null when the cookie is valid but the row is gone, which happens
 * after an account is deleted. The caller should sign them out.
 */
export async function currentUser(): Promise<CurrentUser | null> {
  const userId = await currentUserId();
  if (!userId) return null;
  return findUser(userId);
}

// ---------------------------------------------------------------------------
// Which site
// ---------------------------------------------------------------------------

export interface ActiveSite {
  tenantId: string;
  slug: string;
  name: string;
  role: Membership['role'];
  /** Every site this person can open, for the picker. */
  available: Membership[];
}

/**
 * Which site this request is working on, or null.
 *
 * Null means one of three things, and the caller can tell them apart by looking
 * at `available` on a fresh listMemberships call if it cares: not signed in, or
 * signed in with no sites at all.
 *
 * The remembered slug is a hint. It is matched against the membership list, and
 * a slug that is not in the list falls back to the first site rather than
 * failing, because a stale cookie is a normal thing to have and not an error
 * worth showing anyone.
 */
export async function activeSite(): Promise<ActiveSite | null> {
  const userId = await currentUserId();
  if (!userId) return null;

  const available = await listMemberships(userId);
  if (available.length === 0) return null;

  const remembered = (await cookies()).get(SITE_COOKIE)?.value;
  const chosen = available.find((m) => m.slug === remembered) ?? available[0];

  return { ...chosen, available };
}

/**
 * A session that has run out, told apart from everything else that can fail.
 *
 * A save that fails because the cookie expired needs a different answer from a
 * save that fails because the slug is taken: one is "sign in again", the other
 * is "pick another address". Without a distinct type both arrive at the editor
 * as a string and the only honest thing it can say is "something went wrong",
 * which for an expired session is both unhelpful and alarming, because it looks
 * like the work was lost.
 */
export class SignInRequired extends Error {
  /** Read by the client, so it does not have to match on the message text. */
  readonly signInRequired = true;

  constructor(message = 'Your session has ended. Sign in again to carry on.') {
    super(message);
    this.name = 'SignInRequired';
  }
}

export function isSignInRequired(error: unknown): error is SignInRequired {
  return error instanceof Error && (error as SignInRequired).signInRequired === true;
}

/** The signed-in user's id, or a thrown SignInRequired. */
export async function requireUserId(): Promise<string> {
  const userId = await currentUserId();
  if (!userId) throw new SignInRequired();
  return userId;
}

/**
 * The site this request is working on, or a thrown error.
 *
 * For server actions, where there is nowhere to render a picker. The two
 * failures are kept apart because they need different answers: an ended session
 * means sign in again, and no memberships at all means somebody has to be
 * invited to a site before there is anything to edit.
 */
export async function requireSite(): Promise<ActiveSite> {
  await requireUserId();

  const site = await activeSite();
  if (!site) {
    throw new Error(
      'This account is not a member of any site yet. ' +
        'Somebody with owner access has to add it to one.',
    );
  }
  return site;
}

/**
 * Just the tenant id, for the many callers that want nothing else.
 *
 * A convenience over requireSite, deliberately named so it reads like the old
 * requireTenantId it replaces. The difference is that this one cannot return an
 * id the signed-in person has no membership of, because the id came out of the
 * membership list.
 */
export async function requireTenantId(): Promise<string> {
  return (await requireSite()).tenantId;
}

/**
 * Remember a site, if the person belongs to it.
 *
 * Returns false when they do not, and leaves the cookie alone. There is
 * deliberately no way to set this to an arbitrary tenant: the value has to
 * appear in the membership list the database produced.
 */
export async function chooseSite(slug: unknown): Promise<boolean> {
  const userId = await currentUserId();
  if (!userId || typeof slug !== 'string') return false;

  const available = await listMemberships(userId);
  const match = available.find((m) => m.slug === slug);
  if (!match) return false;

  (await cookies()).set(SITE_COOKIE, match.slug, {
    ...BASE_COOKIE,
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
  return true;
}

// ---------------------------------------------------------------------------
// Starting and ending a session
// ---------------------------------------------------------------------------

/**
 * Sign this browser in as a user whose identity has ALREADY been verified.
 *
 * It does not check anything. Calling it is the act of trusting the caller's
 * verification, which is why there is exactly one caller: the sign-in action,
 * immediately after a provider returned an identity. Anything else calling this
 * is an authentication bypass with a friendly name.
 */
export async function startSession(userId: string): Promise<void> {
  const key = secret();
  if (!key) {
    throw new Error(
      'Cannot start a session: SESSION_SECRET is not set for this environment.',
    );
  }

  (await cookies()).set(SESSION_COOKIE, signSession(userId, key), {
    ...BASE_COOKIE,
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
}

/**
 * Sign out.
 *
 * Both cookies go. The site choice is not sensitive, but leaving it behind
 * means the next person at a shared machine sees a site name they have no
 * business knowing about before they sign in.
 *
 * Deleted by setting an empty value with maxAge 0 as well as calling delete,
 * because a cookie originally set on a different path or with different flags
 * is not always matched by delete alone.
 */
export async function endSession(): Promise<void> {
  const store = await cookies();
  for (const name of [SESSION_COOKIE, SITE_COOKIE]) {
    store.set(name, '', { ...BASE_COOKIE, maxAge: 0 });
    store.delete(name);
  }
}
