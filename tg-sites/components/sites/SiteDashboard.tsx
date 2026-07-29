'use client';

/**
 * The site dashboard: every page in this site, and what you can do to them.
 *
 * The list is server rendered and handed in, so the first paint is complete
 * with no spinner. After that this component owns it: each action returns the
 * updated row and the list is patched in place rather than refetched, which
 * keeps a publish or a rename instant.
 */

import { useCallback, useEffect, useState, useTransition } from 'react';
import Link from 'next/link';

import {
  createPageAction,
  deletePageAction,
  publishPageAction,
  renamePageAction,
  unpublishPageAction,
} from '../../app/actions/pages';
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
  initialTitle = '',
  initialSlug,
  onClose,
  onSubmit,
}: {
  heading: string;
  confirmLabel: string;
  initialTitle?: string;
  initialSlug?: string;
  onClose: () => void;
  /** Resolves with an error message, or null when it worked. */
  onSubmit: (title: string, slug: string | undefined) => Promise<string | null>;
}) {
  const [title, setTitle] = useState(initialTitle);
  const [slug, setSlug] = useState(initialSlug ?? '');
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="sv-scrim"
      role="dialog"
      aria-modal="true"
      aria-label={heading}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <form
        className="sv-dialog"
        onSubmit={async (event) => {
          event.preventDefault();
          if (!title.trim()) {
            setMessage('Give the page a name.');
            return;
          }
          setSaving(true);
          setMessage(await onSubmit(title.trim(), slug));
          setSaving(false);
        }}
      >
        <h2>{heading}</h2>

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
            /* The one place autofocus is right: a dialog the user opened on
               purpose, with a single obvious first field. */
            autoFocus
            onChange={(event) => setTitle(event.target.value)}
          />
        </div>

        <div className="sv-field">
          <label htmlFor="page-slug">Address</label>
          <input
            id="page-slug"
            value={slug}
            placeholder="about-us"
            onChange={(event) => setSlug(event.target.value)}
          />
          <small>
            {slug.trim()
              ? `This page will live at /${slug.trim()}`
              : 'Leave blank to make this the home page'}
          </small>
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
