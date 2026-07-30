'use client';

/**
 * Signing in.
 *
 * The first screen anybody sees, so it is built from the same tokens, type
 * scale and buttons as the two it leads to. Nothing here is bespoke: tg-door
 * for the centred column, sv-field for the inputs, tg-btn for the button. A
 * sign-in page that looks like a different product is the first thing a client
 * notices and the last thing anyone gets round to fixing.
 */

import { useState, useTransition } from 'react';

import { signInAction } from '../../app/actions/auth';
import { Icon } from '../editor/Icon';

interface Props {
  /** False when SESSION_SECRET is missing, so the form would refuse everyone. */
  configured: boolean;
  /**
   * False when the deployment uses Travelify SSO, in which case the email and
   * password fields are not rendered at all rather than rendered and ignored.
   */
  usesPasswordForm: boolean;
  /** Where to land after signing in. Already checked to be a local path. */
  next: string;
}

export function SignInForm({ configured, usesPasswordForm, next }: Props) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();

  function submit() {
    setError(null);
    startTransition(async () => {
      const result = await signInAction({ email, password });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      /*
       * A full page load, not a router push.
       *
       * Everything behind this screen is server rendered from the session
       * cookie, and the cookie was set by the action that has just returned.
       * A client-side navigation would reuse the React tree that was built
       * before the cookie existed, so the first screen after signing in would
       * be the signed-out one.
       */
      window.location.assign(next);
    });
  }

  return (
    <main className="tg-door" data-narrow="true">
      <p className="tg-door__eyebrow">Travelgenix</p>
      <h1 className="tg-door__title" data-small="true">
        Sign in to Sites
      </h1>

      {!configured ? (
        <div className="sv-error">
          <h2>Sign in is not set up yet</h2>
          <p>
            <code>SESSION_SECRET</code> is missing from this environment, so no
            session can be signed and nobody can get in. It is one value, set
            once, and the walkthrough is in <code>tg-sites/db/SETUP.md</code>.
          </p>
        </div>
      ) : !usesPasswordForm ? (
        <>
          <p className="tg-door__lede">
            This site uses your Travelify account. You will be sent there to sign
            in and brought straight back.
          </p>
          <div className="tg-door__actions">
            {/*
              Deliberately not wired up. travelifyProvider throws rather than
              pretending, and a button that silently did nothing would be worse
              than one that says what is missing.
            */}
            <button type="button" className="tg-btn" data-variant="primary" disabled>
              Continue with Travelify
            </button>
          </div>
          <p className="tg-door__note">
            Not finished. It needs the sign-in endpoint and client credentials
            from the Travelify side before this button can do anything.
          </p>
        </>
      ) : (
        <form
          className="tg-door__form"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          {error && (
            <p className="sv-msg" role="alert">
              <Icon name="warning" size={16} />
              {error}
            </p>
          )}

          <div className="sv-field">
            <label htmlFor="signin-email">Email</label>
            <input
              id="signin-email"
              type="email"
              name="email"
              value={email}
              autoComplete="username"
              autoCapitalize="off"
              spellCheck={false}
              placeholder="you@yourcompany.com"
              onChange={(event) => setEmail(event.target.value)}
            />
          </div>

          <div className="sv-field">
            <label htmlFor="signin-password">Password</label>
            <input
              id="signin-password"
              type="password"
              name="password"
              value={password}
              autoComplete="current-password"
              onChange={(event) => setPassword(event.target.value)}
            />
          </div>

          <div className="tg-door__actions">
            <button
              type="submit"
              className="tg-btn"
              data-variant="primary"
              disabled={busy}
            >
              {busy ? 'Signing in' : 'Sign in'}
            </button>
          </div>

          <p className="tg-door__note">
            Accounts are set up for you. If you cannot get in, ask whoever looks
            after your Travelgenix account rather than trying to reset it here.
          </p>
        </form>
      )}
    </main>
  );
}
