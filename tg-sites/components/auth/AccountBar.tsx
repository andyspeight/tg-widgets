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
 *
 * NEW SITE IS STAFF ONLY, and drawn here beside the switcher because it belongs
 * with "which site am I in" rather than with the page actions below. The button
 * being hidden for a client is a courtesy; the real gate is in
 * app/actions/sites.ts, which every call goes through.
 */

import { useState, useTransition } from 'react';

import { chooseSiteAction, signOutAction } from '../../app/actions/auth';
import { createSiteAction } from '../../app/actions/sites';
import type { Membership } from '../../lib/db/users';
import { Icon } from '../editor/Icon';
import { Modal } from '../ui/Modal';

interface Props {
  email: string;
  name: string | null;
  /** The site currently being edited. */
  currentSlug: string;
  available: Membership[];
  /** Whether this person may make a new site: Travelgenix staff. */
  canCreateSite?: boolean;
}

export function AccountBar({ email, name, currentSlug, available, canCreateSite = false }: Props) {
  const [busy, startTransition] = useTransition();
  const [creating, setCreating] = useState(false);

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

      {canCreateSite && (
        <button
          type="button"
          className="tg-btn"
          data-variant="ghost"
          disabled={busy}
          onClick={() => setCreating(true)}
        >
          <Icon name="plus" size={16} />
          New site
        </button>
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

      {creating && <NewSiteDialog onClose={() => setCreating(false)} />}
    </div>
  );
}

// ---------------------------------------------------------------------------

/**
 * Name a new site, make it, and land on it.
 *
 * The name is the only thing asked for; the address is derived and made unique on
 * the server. On success the whole page reloads onto the new site, which
 * createSiteAction has already made the active one, so the dashboard comes back
 * showing the blank site ready to build.
 */
function NewSiteDialog({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit() {
    const clean = name.trim();
    if (!clean) {
      setMessage('Give the new site a name.');
      return;
    }
    setSaving(true);
    setMessage(null);
    const result = await createSiteAction({ name: clean });
    if (!result.ok) {
      setMessage(result.error);
      setSaving(false);
      return;
    }
    // A full load, the same reasoning as switching sites: the whole screen is
    // server rendered for one tenant, and this is now a different one.
    window.location.assign('/sites');
  }

  return (
    <Modal
      title="New site"
      description="It starts blank, with just a home page. Build it, or duplicate an existing site onto it later."
      onClose={onClose}
      footer={
        <>
          <button type="button" className="tg-btn" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="tg-btn"
            data-variant="primary"
            disabled={saving}
            onClick={submit}
          >
            {saving ? 'Working' : 'Create site'}
          </button>
        </>
      }
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        {message && (
          <p className="sv-msg" role="alert">
            {message}
          </p>
        )}

        <div className="sv-field">
          <label htmlFor="site-name">Site name</label>
          <input
            id="site-name"
            value={name}
            placeholder="Sunvil Travel"
            onChange={(event) => setName(event.target.value)}
          />
          <small>The client's name usually. You can change it in Settings later.</small>
        </div>

        {/* Submit on Enter without a second visible button, last so the Modal
            focuses the name field rather than this. */}
        <button type="submit" className="tg-visually-hidden" tabIndex={-1} aria-hidden="true" />
      </form>
    </Modal>
  );
}
