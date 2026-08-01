'use client';

/**
 * The two things somebody holding a link can do: join, or set a password first.
 *
 * ONE COMPONENT, TWO SHAPES, because they share the token, the error line and
 * the busy state, and splitting them would be two files that have to agree about
 * all three. Which shape is drawn is decided on the SERVER, by whether an
 * account already exists for the address the invite names.
 *
 * THE EMAIL IS SHOWN AND NOT EDITABLE. It comes off the invite row on the
 * server, and letting somebody type one here would let them redeem a link into
 * an address of their choosing. It is on screen because they should be able to
 * see which of their addresses this is for before committing to it.
 */

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

import { acceptInviteAction, joinWithPasswordAction } from '../../app/actions/members';
import { Icon } from '../editor/Icon';

export function JoinForm({
  token,
  email,
  siteName,
  /** Whether this address already has an account, so it needs a password. */
  needsPassword,
  minPasswordLength,
}: {
  token: string;
  email: string;
  siteName: string;
  needsPassword: boolean;
  minPasswordLength: number;
}) {
  const router = useRouter();

  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();

  function join() {
    setMessage(null);
    startTransition(async () => {
      const outcome = await acceptInviteAction(token);

      if (!outcome.ok) {
        setMessage(
          outcome.reason === 'wrong-person'
            ? `This invite is for ${email}. Sign in as them and open the link again.`
            : 'That link has expired or has already been used.',
        );
        return;
      }

      // Straight to the site, not back to a confirmation. They came here to get
      // in, and they are in.
      router.push('/sites');
    });
  }

  function joinWithPassword() {
    setMessage(null);
    startTransition(async () => {
      const result = await joinWithPasswordAction({ token, password, name });

      if (!result.ok) {
        setMessage(result.error);
        return;
      }

      router.push('/sites');
    });
  }

  return (
    <form
      className="jn-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (needsPassword) joinWithPassword();
        else join();
      }}
    >
      {message && (
        <p className="sv-msg" role="alert">
          <Icon name="warning" size={16} />
          {message}
        </p>
      )}

      {needsPassword ? (
        <>
          <div className="sv-field">
            <label htmlFor="jn-name">Your name</label>
            <input
              id="jn-name"
              value={name}
              placeholder="Sam Ellis"
              autoComplete="name"
              onChange={(event) => setName(event.target.value)}
            />
            <small>What your colleagues will see beside your changes.</small>
          </div>

          <div className="sv-field">
            <label htmlFor="jn-password">Choose a password</label>
            <input
              id="jn-password"
              type="password"
              value={password}
              // The right token: this IS a new password, and it is what tells a
              // password manager to offer to generate and save one.
              autoComplete="new-password"
              onChange={(event) => setPassword(event.target.value)}
            />
            <small>
              At least {minPasswordLength} characters. A few words you will
              remember beats something short and clever.
            </small>
          </div>

          <button
            type="submit"
            className="tg-btn"
            data-variant="primary"
            disabled={busy || password.length < minPasswordLength}
          >
            {busy ? 'Joining' : `Join ${siteName}`}
          </button>
        </>
      ) : (
        <button type="submit" className="tg-btn" data-variant="primary" disabled={busy}>
          {busy ? 'Joining' : `Join ${siteName}`}
        </button>
      )}
    </form>
  );
}
