/**
 * Who is this person. The seam between this product and whatever owns identity.
 *
 * THE POINT OF THE SEAM
 *
 * id.travelify.io is meant to own Travelgenix identity. Nobody has handed over
 * its endpoints, and an auth layer that cannot sign anyone in is not an auth
 * layer, so there are two providers behind one interface: a password one that
 * works today, and a Travelify one that is honest about not being finished.
 *
 * Everything downstream depends on the interface, not on either provider. When
 * the SSO details arrive, the work is in travelifyProvider and nowhere else:
 * no screen, no policy and no session code needs to know which one answered.
 *
 * WHAT AN IDENTITY IS NOT
 *
 * It is not permission to do anything. Signing in proves who you are, and the
 * tenant_users table decides what that gets you. Those are separate on purpose:
 * every question about access is answered by a row level security policy
 * keyed on the user id, never by the fact that a provider recognised someone.
 */

import 'server-only';

import { normaliseEmail } from './email';
import { verifyPassword, wasteTimeLikeAVerification } from './password';

/** A person, as far as this product is concerned. */
export interface Identity {
  /** The subject. Whatever the provider issues, stored verbatim. */
  id: string;
  email: string;
  name: string | null;
}

/** What a provider needs from storage to check a password. */
export interface StoredCredentials {
  id: string;
  email: string;
  name: string | null;
  passwordHash: string | null;
  status: 'active' | 'suspended';
}

export interface IdentityProvider {
  /** For logs and for the sign-in page to say where it is sending people. */
  readonly name: string;

  /**
   * Check an email and password.
   *
   * Null for every failure, with no hint which one. Unknown email, wrong
   * password, suspended account and no password set all look identical from
   * outside, because telling them apart is a feature for an attacker and
   * nothing at all for the person signing in.
   */
  verify(email: string, password: string): Promise<Identity | null>;

  /**
   * Whether this provider signs people in with a form on our own page.
   *
   * False means the sign-in screen shows a button that leaves for somewhere
   * else, and the email and password fields are not rendered at all.
   */
  readonly usesPasswordForm: boolean;
}

// ---------------------------------------------------------------------------
// Email
// ---------------------------------------------------------------------------

/*
 * Re-exported rather than defined here, so callers that only want the tidy-up
 * do not have to import a server-only module to get it. See lib/auth/email.ts
 * for why it is a leaf with no imports of its own.
 */
export { normaliseEmail } from './email';

// ---------------------------------------------------------------------------
// The password provider
// ---------------------------------------------------------------------------

/**
 * Sign in with an email and a password held in auth_users.
 *
 * `lookup` is injected rather than imported so this can be tested without a
 * database, and so the one place that reads credentials stays in lib/db where
 * every other query lives.
 */
export function passwordProvider(
  lookup: (email: string) => Promise<StoredCredentials | null>,
): IdentityProvider {
  return {
    name: 'password',
    usesPasswordForm: true,

    async verify(rawEmail, password) {
      const email = normaliseEmail(rawEmail);
      if (!email || typeof password !== 'string' || password.length === 0) {
        // Still burn the time. A malformed email returning instantly is the
        // same oracle as an unknown one returning instantly.
        await wasteTimeLikeAVerification(password);
        return null;
      }

      const stored = await lookup(email);

      /*
       * No row, no hash, or a suspended account: answer no, at the same speed
       * as a wrong password.
       *
       * The three are handled together because they must be indistinguishable.
       * An earlier version returned early on a missing row, before hashing, and
       * that alone tells you which emails have accounts here.
       */
      if (!stored || !stored.passwordHash || stored.status !== 'active') {
        await wasteTimeLikeAVerification(password);
        return null;
      }

      if (!(await verifyPassword(password, stored.passwordHash))) return null;

      return { id: stored.id, email: stored.email, name: stored.name };
    },
  };
}

// ---------------------------------------------------------------------------
// The Travelify provider
// ---------------------------------------------------------------------------

/**
 * NOT IMPLEMENTED, AND DELIBERATELY NOISY ABOUT IT.
 *
 * This is the shape the real one will have, so that the sign-in screen, the
 * session and the membership policies are all already written against it. What
 * is missing is not code in this file, it is three facts nobody has given us:
 * the authorise and token endpoints, the client credentials, and which claim
 * carries the subject that tenant_users.user_id should match.
 *
 * It throws rather than returning null. Null means "those credentials are
 * wrong", which would be a lie, and a lie here looks like a password problem
 * and gets debugged for an hour.
 */
export function travelifyProvider(): IdentityProvider {
  return {
    name: 'travelify',
    usesPasswordForm: false,

    async verify() {
      throw new Error(
        'Travelify SSO is not built. It needs the authorise and token endpoint ' +
          'URLs, the client id and secret, and the name of the claim holding the ' +
          'subject that tenant_users.user_id matches. Until those arrive, leave ' +
          'TRAVELIFY_SSO_URL unset and sign in with a password.',
      );
    },
  };
}

/**
 * Which provider this deployment uses.
 *
 * Chosen by whether TRAVELIFY_SSO_URL is set, so switching over is an
 * environment variable rather than a deploy. Kept as a function rather than a
 * module constant because reading env at import time makes it impossible to
 * change in a test.
 */
export function chooseProvider(
  lookup: (email: string) => Promise<StoredCredentials | null>,
  env: Record<string, string | undefined> = process.env,
): IdentityProvider {
  return env.TRAVELIFY_SSO_URL ? travelifyProvider() : passwordProvider(lookup);
}
