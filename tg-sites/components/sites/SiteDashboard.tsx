'use client';

/**
 * The site dashboard: every page in this site, and what you can do to them.
 *
 * The list is server rendered and handed in, so the first paint is complete
 * with no spinner. After that this component owns it: each action returns the
 * updated row and the list is patched in place rather than refetched, which
 * keeps a publish or a rename instant.
 */

import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import Link from 'next/link';

import {
  createPageAction,
  deletePageAction,
  publishPageAction,
  renamePageAction,
  unpublishPageAction,
} from '../../app/actions/pages';
import { slugify } from '../../lib/content/slug';
import type { PageSummary } from '../../lib/db/pages';
import { OPEN_ACCESS_WARNING } from '../../lib/auth/temporary';
import { Icon } from '../editor/Icon';
import './sites.css';

const THEME_KEY = 'tg-sites:theme:v1';

type Dialog =
  | { kind: 'new' }
  | { kind: 'rename'; page: PageSummary }
  | null;

interface Props {
  workspace: string;
  siteName: string;
  siteUrl: string;
  pages: PageSummary[];
  /** True while there is no sign in. Comes from lib/auth/temporary. */
  openAccess: boolean;
}

export function SiteDashboard({ workspace, siteName, siteUrl, pages: initial, openAccess }: Props) {
  const [pages, setPages] = useState(initial);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();
  const [theme, setTheme] = useState<'light' | 'dark' | 'system'>('light');

  // The dialog shows the real address the page will have, so the scheme is
  // stripped: nobody reads "https://" in a preview, it is just noise in
  // front of the part that matters.
  const host = siteUrl.replace(/^https?:\/\//, '');

  // Same appearance choice as the editor, read from the same key, so moving
  // between the two screens does not flip the lights.
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(THEME_KEY);
      if (stored === 'light' || stored === 'dark' || stored === 'system') setTheme(stored);
    } catch {
      // Storage blocked. Light is a fine place to stay.
    }
  }, []);

  /** Replace one row, or drop it when the action returned nothing. */
  const patch = useCallback((id: string, next: PageSummary | null) => {
    setPages((current) =>
      next ? current.map((p) => (p.id === id ? next : p)) : current.filter((p) => p.id !== id),
    );
  }, []);

  const publish = useCallback(
    (page: PageSummary) => {
      setError(null);
      startTransition(async () => {
        const action = page.status === 'published' ? unpublishPageAction : publishPageAction;
        const result = await action(page.id);
        if (!result.ok) setError(result.error);
        else if (result.data) patch(page.id, result.data);
      });
    },
    [patch],
  );

  const remove = useCallback(
    (page: PageSummary) => {
      // A page is hours of someone's work and there is no undo for this one.
      // Worth an interruption, and worth naming the page in the question.
      const label = page.title || 'this page';
      if (!window.confirm(`Delete "${label}"? This cannot be undone.`)) return;

      setError(null);
      startTransition(async () => {
        const result = await deletePageAction(page.id);
        if (!result.ok) setError(result.error);
        else patch(page.id, null);
      });
    },
    [patch],
  );

  return (
    <div className="sv-root" data-theme={theme}>
      {openAccess && (
        <p className="sv-warn" role="status">
          <Icon name="warning" size={16} />
          {OPEN_ACCESS_WARNING}
        </p>
      )}

      <div className="sv-wrap">
        <header className="sv-head">
          <div>
            <p className="sv-eyebrow">Workspace: {workspace}</p>
            <h1 className="sv-title">{siteName}</h1>
            <p className="sv-url">
              Lives at <code>{siteUrl}</code>
            </p>
          </div>

          <button
            type="button"
            className="sv-btn"
            data-variant="primary"
            onClick={() => {
              setError(null);
              setDialog({ kind: 'new' });
            }}
          >
            <Icon name="plus" size={16} />
            New page
          </button>
        </header>

        {error && (
          <p className="sv-msg" role="alert">
            {error}
          </p>
        )}

        {pages.length === 0 ? (
          <div className="sv-empty">
            <h2>No pages yet</h2>
            <p>
              Start with the home page. Leave the address blank and it becomes the
              front door of the site.
            </p>
            <button
              type="button"
              className="sv-btn"
              data-variant="primary"
              onClick={() => setDialog({ kind: 'new' })}
            >
              <Icon name="plus" size={16} />
              Create the home page
            </button>
          </div>
        ) : (
          <ul className="sv-list">
            {pages.map((page) => (
              <li className="sv-item" key={page.id}>
                <div className="sv-item__main">
                  <Link className="sv-item__title" href={`/editor?page=${page.id}`}>
                    {page.title}
                  </Link>
                  <span className="sv-item__meta">
                    <span className="sv-path">/{page.slug}</span>
                    <StatusPill page={page} />
                  </span>
                </div>

                <button
                  type="button"
                  className="sv-btn"
                  data-variant="quiet"
                  disabled={busy}
                  onClick={() => {
                    setError(null);
                    setDialog({ kind: 'rename', page });
                  }}
                >
                  Rename
                </button>

                <button
                  type="button"
                  className="sv-btn"
                  data-variant="quiet"
                  disabled={busy}
                  onClick={() => publish(page)}
                >
                  {page.status === 'published' ? 'Unpublish' : 'Publish'}
                </button>

                <button
                  type="button"
                  className="sv-btn"
                  data-variant="quiet"
                  data-danger="true"
                  disabled={busy}
                  aria-label={`Delete ${page.title}`}
                  onClick={() => remove(page)}
                >
                  <Icon name="trash" size={16} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {dialog?.kind === 'new' && (
        <PageDialog
          heading="New page"
          confirmLabel="Create page"
          host={host}
          mode="new"
          homeIsExpected={pages.length === 0}
          // The first page of a site is its home page. Pre-filled and pinned
          // to the empty address, so the common path is one click instead of
          // working out for yourself that a blank address means home.
          initialTitle={pages.length === 0 ? 'Home' : ''}
          initialSlug={pages.length === 0 ? '' : undefined}
          onClose={() => setDialog(null)}
          onSubmit={(title, slug) =>
            new Promise((done) => {
              startTransition(async () => {
                const result = await createPageAction({ title, slug });
                if (!result.ok) {
                  done(result.error);
                  return;
                }
                setPages((current) => [...current, result.data]);
                setDialog(null);
                done(null);
              });
            })
          }
        />
      )}

      {dialog?.kind === 'rename' && (
        <PageDialog
          heading="Rename page"
          confirmLabel="Save"
          host={host}
          mode="rename"
          homeIsExpected={dialog.page.slug === ''}
          initialTitle={dialog.page.title}
          initialSlug={dialog.page.slug}
          onClose={() => setDialog(null)}
          onSubmit={(title, slug) =>
            new Promise((done) => {
              const id = dialog.page.id;
              startTransition(async () => {
                const result = await renamePageAction(id, { title, slug });
                if (!result.ok) {
                  done(result.error);
                  return;
                }
                if (result.data) patch(id, result.data);
                setDialog(null);
                done(null);
              });
            })
          }
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

/**
 * Three states, not two.
 *
 * "Live" and "Draft" alone would hide the one an agent most needs to see:
 * published, but edited since. That is the state where what they are looking
 * at in the editor is not what a visitor is looking at.
 */
function StatusPill({ page }: { page: PageSummary }) {
  if (page.status !== 'published') return <span className="sv-pill">Draft</span>;

  if (page.hasUnpublishedChanges) {
    return (
      <span className="sv-pill" data-state="changed">
        Live, with unpublished edits
      </span>
    );
  }

  return (
    <span className="sv-pill" data-state="published">
      Live
    </span>
  );
}

// ---------------------------------------------------------------------------

function PageDialog({
  heading,
  confirmLabel,
  host,
  mode,
  homeIsExpected,
  initialTitle = '',
  initialSlug,
  onClose,
  onSubmit,
}: {
  heading: string;
  confirmLabel: string;
  /** The site's hostname, so the preview shows the real address. */
  host: string;
  mode: 'new' | 'rename';
  /** Whether an empty address is the wanted outcome here, or a surprise. */
  homeIsExpected: boolean;
  initialTitle?: string;
  /** Given, the address starts as the agent's own and stops following the name. */
  initialSlug?: string;
  onClose: () => void;
  /** Resolves with an error message, or null when it worked. */
  onSubmit: (title: string, slug: string) => Promise<string | null>;
}) {
  const isRename = mode === 'rename';

  const [title, setTitle] = useState(initialTitle);
  const [slug, setSlug] = useState(initialSlug ?? '');
  /**
   * Whether the address is the agent's to keep.
   *
   * Until they touch it, it follows the name. Renaming starts as touched:
   * changing a live page's address breaks every link to it, so that is never
   * something to do as a side effect of fixing a typo in the title.
   */
  const [slugIsMine, setSlugIsMine] = useState(initialSlug !== undefined);
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const effectiveSlug = slugIsMine ? slugify(slug) : slugify(title);
  const isHome = effectiveSlug === '';

  const dialog = useRef<HTMLFormElement>(null);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onClose();
        return;
      }

      // Keep Tab inside the dialog. Without this, tabbing walks off into the
      // page behind, which for a screen reader user means the modal has
      // effectively vanished while still covering everything.
      if (event.key !== 'Tab' || !dialog.current) return;

      const focusable = dialog.current.querySelectorAll<HTMLElement>(
        'button, input, [href], select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;

      if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    }

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="sv-scrim"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <form
        ref={dialog}
        className="sv-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="sv-dialog-title"
        onSubmit={async (event) => {
          event.preventDefault();
          if (!title.trim()) {
            setMessage('Give the page a name.');
            return;
          }
          setSaving(true);
          setMessage(await onSubmit(title.trim(), effectiveSlug));
          setSaving(false);
        }}
      >
        <div className="sv-dialog__head">
          <h2 id="sv-dialog-title">{heading}</h2>
          <button
            type="button"
            className="sv-btn"
            data-variant="quiet"
            data-icon="true"
            aria-label="Close"
            onClick={onClose}
          >
            <Icon name="close" size={18} />
          </button>
        </div>

        <div className="sv-dialog__body">
          {message && (
            <p className="sv-msg" role="alert">
              {message}
            </p>
          )}

          <div className="sv-field">
            <label htmlFor="page-title">Page name</label>
            <input
              id="page-title"
              value={title}
              placeholder="About us"
              /* The one place autofocus belongs: a dialog the agent opened on
                 purpose, with a single obvious first field. */
              autoFocus
              onChange={(event) => setTitle(event.target.value)}
            />
            <small>What it is called in your list of pages.</small>
          </div>

          <div className="sv-field">
            <label htmlFor="page-slug">Address</label>
            <input
              id="page-slug"
              value={slugIsMine ? slug : slugify(title)}
              placeholder="about-us"
              onChange={(event) => {
                setSlugIsMine(true);
                setSlug(event.target.value);
              }}
            />
            <small>
              {isRename
                ? 'Changing this breaks any existing link to the page.'
                : slugIsMine
                  ? 'Leave it empty and this becomes the home page.'
                  : 'Filled in from the name. Change it if you want something shorter.'}
            </small>
          </div>

          {/*
            The consequence, stated rather than implied.

            An empty address quietly means "home page", which is right for the
            first page and almost never right for the fifth. Hiding that in
            grey helper text meant naming a page "About us", leaving the
            address alone and silently making a second home page, which the
            database then refused with a duplicate error that explained
            nothing. Now the outcome is on screen before the button is pressed.
          */}
          <p
            className="sv-preview"
            data-tone={isHome && !homeIsExpected ? 'warn' : 'ok'}
          >
            <Icon name={isHome && !homeIsExpected ? 'warning' : 'check'} size={16} />
            {isHome ? (
              <span>
                {homeIsExpected ? (
                  <>
                    This will be the <strong>home page</strong>, at <code>{host}</code>
                  </>
                ) : (
                  <>
                    An empty address means the <strong>home page</strong>, and this site
                    already has one. Give it an address unless that is what you meant.
                  </>
                )}
              </span>
            ) : (
              <span>
                Will live at{' '}
                <code>
                  {host}/<strong>{effectiveSlug}</strong>
                </code>
              </span>
            )}
          </p>
        </div>

        <div className="sv-actions">
          <button type="button" className="sv-btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="sv-btn" data-variant="primary" disabled={saving}>
            {saving ? 'Working' : confirmLabel}
          </button>
        </div>
      </form>
    </div>
  );
}
