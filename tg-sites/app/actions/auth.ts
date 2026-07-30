'use server';

/**
 * Signing in, signing out, and switching site.
 *
 * A server action is a public HTTP endpoint with a nice syntax, and these three
 * are the ones an unauthenticated stranger can reach, so they are the most
 * exposed code in the product. Three rules:
 *
 *   1. THE ONLY CALL TO startSession IS IN HERE, immediately after a provider
 *      returned an identity. startSession does not check anything, so calling
 *      it anywhere else is an authentication bypass with a friendly name.
 *      There is a test that greps for other callers.
 *
 *   2. A FAILED SIGN-IN SAYS ONE THING. Not "no such account", not "wrong
 *      password for that account". Telling those apart hands over a list of
 *      who has an account here, and for a travel business that list is worth
 *      something.
 *
 *   3. NO TENANT ID CROSSES THIS BOUNDARY. Switching site takes a slug and
 *      checks it against the membership list the database produced. A tenant id
 *      from a caller would reduce row level security to "please pass your own".
 */

import { revalidatePath } from 'next/cache';

import { chooseProvider } from '../../lib/auth/identity';
import {
  chooseSite,
  currentUserId,
  endSession,
  sessionsAreConfigured,
  startSession,
} from '../../lib/auth/session';
import { findCredentials, touchLastSeen } from '../../lib/db/users';

export type AuthResult =
  | { ok: true }
  | { ok: false; error: string };

/**
 * The one message a failed sign-in gives.
 *
 * Deliberately covers all of: no such email, wrong password, suspended
 * account, and an account with no password because it was made for SSO.
 */
const REFUSED = 'That email and password do not match. Check both and try again.';

export async function signInAction(input: {
  email: string;
  password: string;
}): Promise<AuthResult> {
  if (!sessionsAreConfigured()) {
    return {
      ok: false,
      error:
        'This deployment cannot hold a session yet: SESSION_SECRET is not set. ' +
        'Nobody can sign in until it is.',
    };
  }

  const email = String(input?.email ?? '');
  const password = String(input?.password ?? '');

  let identity;
  try {
    identity = await chooseProvider(findCredentials).verify(email, password);
  } catch (error) {
    // A provider throwing means it is broken or not configured, which is not
    // the same as a wrong password and must not be reported as one. The
    // Travelify stub throws on purpose for exactly this reason.
    console.error('[tg-sites] identity provider failed', error);
    return {
      ok: false,
      error: 'Sign in is not available right now. This is our end, not yours.',
    };
  }

  if (!identity) return { ok: false, error: REFUSED };

  await startSession(identity.id);

  // Best effort, and after the session exists. A failure to record a timestamp
  // must not undo a sign-in that has already been verified.
  try {
    await touchLastSeen(identity.id);
  } catch (error) {
    console.error('[tg-sites] could not record last seen', error);
  }

  revalidatePath('/', 'layout');
  return { ok: true };
}

export async function signOutAction(): Promise<void> {
  await endSession();
  revalidatePath('/', 'layout');
}

export async function chooseSiteAction(slug: string): Promise<AuthResult> {
  if (!(await currentUserId())) {
    return { ok: false, error: 'Sign in first.' };
  }

  if (!(await chooseSite(slug))) {
    // Either the slug is not a site, or it is a site this person is not in.
    // One message for both, because the difference tells a caller which sites
    // exist, and nothing about the difference helps whoever actually clicked.
    return { ok: false, error: 'You do not have access to that site.' };
  }

  revalidatePath('/', 'layout');
  return { ok: true };
}
