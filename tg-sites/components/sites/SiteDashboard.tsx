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
import { ConfirmDialog, Modal } from '../ui/Modal';
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

  /**
   * The page waiting to be deleted, or null.
   *
   * window.confirm did this before. It cannot be styled, cannot speak in the
   * product's voice, blocks the main thread, and looks like the browser
   * telling you off rather than the product checking with you.
   */
  const [deleting, setDeleting] = useState<PageSummary | null>(null);

  const remove = useCallback(
    (page: PageSummary) => {
      setDeleting(null);
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
          <>
          <p className="sv-list-label">
            {pages.length} {pages.length === 1 ? 'page' : 'pages'}
          </p>
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

                {/*
                  An explicit Edit button, not just a clickable title.
                  "Click the row" is obvious once you know and invisible until
                  then, and this is the one action almost everybody wants.
                */}
                <Link className="sv-btn" data-variant="edit" href={`/editor?page=${page.id}`}>
                  <Icon name="edit" size={16} />
                  Edit
                </Link>

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
                  data-danger="true"
                  disabled={busy}
                  aria-label={`Delete ${page.title}`}
                  onClick={() => setDeleting(page)}
                >
                  <Icon name="trash" size={16} />
                </button>
              </li>
            ))}
          </ul>
          </>
        )}
      </div>

      {deleting && (
        <ConfirmDialog
          title={`Delete "${deleting.title}"?`}
          description="The page and everything on it goes. This one cannot be undone."
          confirmLabel="Delete page"
          destructive
          onConfirm={() => remove(deleting)}
          onCancel={() => setDeleting(null)}
        />
      )}

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

  const effectiveSlug = slugIsMine ? slugify(slug) : slugify(title);
  const isHome = effectiveSlug === '';

  const [saving, setSaving] = useState(false);

  async function submit() {
    if (!title.trim()) {
      setMessage('Give the page a name.');
      return;
    }
    setSaving(true);
    setMessage(await onSubmit(title.trim(), effectiveSlug));
    setSaving(false);
  }

  return (
    <Modal
      title={heading}
      description={
        isRename
          ? 'The name is yours. The address is what visitors and search engines see.'
          : 'Give it a name and it works out the address for you.'
      }
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
            {saving ? 'Working' : confirmLabel}
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
        {/* Submit on Enter, without a second visible button. */}
        <button type="submit" className="tg-visually-hidden" tabIndex={-1} aria-hidden="true" />
      </form>
    </Modal>
  );
}
