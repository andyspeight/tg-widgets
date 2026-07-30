'use client';

/**
 * Who is signed in, which site they are in, and the way out.
 *
 * Three pieces of context above the page title rather than a second header.
 * They are all answers to "where am I", which belongs at a lower contrast than
 * whatever it frames, so this is small and grey and divided off by a hairline.
 *
 * The switcher only appears for somebody who is actually in more than one site.
 * A dropdown with one option in it is a control that cannot do anything, and
 * every agent with a single site would have to look at it forever to learn that.
 */

import { useTransition } from 'react';

import { chooseSiteAction, signOutAction } from '../../app/actions/auth';
import type { Membership } from '../../lib/db/users';
import { Icon } from '../editor/Icon';

interface Props {
  email: string;
  name: string | null;
  /** The site currently being edited. */
  currentSlug: string;
  available: Membership[];
}

export function AccountBar({ email, name, currentSlug, available }: Props) {
  const [busy, startTransition] = useTransition();

  function switchTo(slug: string) {
    if (slug === currentSlug) return;
    startTransition(async () => {
      const result = await chooseSiteAction(slug);
      /*
       * A full page load, not a router refresh.
       *
       * The whole screen is server rendered for one tenant: its name, its
       * address, its pages. Refreshing the router would re-run the tree, but
       * reloading is both simpler and honest about what has happened, and it
       * guarantees nothing from the previous site is left on screen.
       */
      if (result.ok) window.location.assign('/sites');
    });
  }

  return (
    <div className="sv-bar">
      {available.length > 1 ? (
        <div className="sv-switch">
          <label htmlFor="site-switch">Site</label>
          <select
            id="site-switch"
            value={currentSlug}
            disabled={busy}
            onChange={(event) => switchTo(event.target.value)}
          >
            {available.map((site) => (
              <option key={site.tenantId} value={site.slug}>
                {site.name}
              </option>
            ))}
          </select>
        </div>
      ) : (
        // Nothing at all rather than a disabled control. The site's name is
        // already the page title two lines below.
        <span className="sv-switch" aria-hidden="true" />
      )}

      <span className="sv-bar__spacer" />

      <span className="sv-bar__who">
        <Icon name="user" size={16} />
        <strong title={email}>{name || email}</strong>
      </span>

      <button
        type="button"
        className="tg-btn"
        data-variant="ghost"
        disabled={busy}
        onClick={() => startTransition(async () => {
          await signOutAction();
          window.location.assign('/signin');
        })}
      >
        Sign out
      </button>
    </div>
  );
}
