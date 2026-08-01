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
import { slugify } from '../../lib/content/slug';
import type { PageSummary } from '../../lib/db/pages';
import type { Membership } from '../../lib/db/users';
import { AccountBar } from '../auth/AccountBar';
import { Icon } from '../editor/Icon';
import { ConfirmDialog, Modal } from '../ui/Modal';
import './sites.css';

const THEME_KEY = 'tg-sites:theme:v1';

type Dialog =
  | { kind: 'new' }
  | { kind: 'rename'; page: PageSummary }
  | null;

interface Props {
  /** Who is signed in. There is always somebody: the page redirects if not. */
  account: { email: string; name: string | null };
  /** Which site, and the others this person could switch to. */
  site: { slug: string; available: Membership[] };
  siteName: string;
  siteUrl: string;
  pages: PageSummary[];
}

export function SiteDashboard({ account, site, siteName, siteUrl, pages: initial }: Props) {
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
      <AccountBar
        email={account.email}
        name={account.name}
        currentSlug={site.slug}
        available={site.available}
      />

      <div className="sv-wrap">
        <header className="sv-head">
          <div>
            {/*
              The eyebrow said "Workspace: demo" when a workspace was a slug in
              a cookie. Now the site's name is the h1 and the switcher is in the
              bar above, so repeating either here would be the same fact three
              times. It says what the screen is instead.
            */}
            <p className="sv-eyebrow">Pages</p>
            <h1 className="sv-title">{siteName}</h1>
            <p className="sv-url">
              Lives at <code>{siteUrl}</code>
            </p>
          </div>

          <div className="sv-head__actions">
            {/*
              A plain anchor, not next/link. Leaving for the theme screen should
              be a real navigation: the theme changes what the editor canvas and
              every preview render, so coming back wants fresh server output
              rather than a cached tree from before the change.
            */}
            <a className="sv-btn" href="/theme">
              <Icon name="sparkle" size={16} />
              Theme
            </a>

            {/*
              THE HEADER AND THE FOOTER, edited once for the whole site.

              Up here with Theme and Settings rather than in the list of pages
              below, because that is what they are: things that apply to every
              page rather than another page. Before 31 Jul 2026 a client had to
              rebuild their nav bar as a section on every page and keep them all
              in step by hand.

              Plain anchors for the same reason as Theme: they change what every
              preview renders, so coming back wants fresh server output rather
              than a cached tree from before the change.
            */}
            <a className="sv-btn" href="/editor?region=header">
              <Icon name="nav" size={16} />
              Header
            </a>

            <a className="sv-btn" href="/editor?region=footer">
              <Icon name="nav" size={16} />
              Footer
            </a>

            {/*
              THE BLOG, AND ANYTHING ELSE THAT IS A LIST.

              Alongside the header and the footer rather than in the list of
              pages, because a collection is not a page: it is a set of entries
              that a Cards block anywhere on the site can be fed from. Publishing
              one changes what those pages render, so this is a plain anchor
              too.
            */}
            <a className="sv-btn" href="/collections">
              <Icon name="cards" size={16} />
              Collections
            </a>

            {/*
              Being found. A plain anchor like its neighbours, and for a reason of
              its own on top of theirs: the report is computed from the PUBLISHED
              content on every visit, so arriving with a tree built before the
              last publish would show somebody the state of their site as it was
              when they opened the dashboard.
            */}
            <a className="sv-btn" href="/seo">
              <Icon name="search" size={16} />
              Being found
            </a>

            {/*
              A plain anchor for the same reason as Theme above: these settings are
              in the head of every rendered page, so coming back wants fresh server
              output rather than a tree built before the change.
            */}
            <a className="sv-btn" href="/settings">
              <Icon name="edit" size={16} />
              Settings
            </a>

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
          </div>
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
          isLive={dialog.page.status === 'published'}
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
  isLive = false,
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
  /**
   * Whether this page is on the internet right now.
   *
   * It decides what changing the address MEANS. A draft has no links pointing at
   * it, so moving it costs nothing and saying anything about redirects would be
   * noise. A live page does, and the reassurance is worth having on screen.
   */
  isLive?: boolean;
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

  /*
   * A live page whose address is actually about to change.
   *
   * Both halves matter. Renaming a draft moves nothing anybody has linked to,
   * and fixing a typo in a live page's NAME leaves its address alone, so
   * announcing a redirect in either case would be telling somebody about
   * machinery that is not going to run.
   */
  const addressIsMoving = isRename && isLive && effectiveSlug !== (initialSlug ?? '');

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
          {/*
            IT NO LONGER SAYS "changing this breaks any existing link".
            Until 1 Aug 2026 that was true and it was the reason nobody dared
            tidy an address. The old one now forwards to the new one, so the
            warning became a lie that discouraged the right thing.
          */}
          <small>
            {isRename
              ? 'What visitors and search engines see. Safe to change.'
              : slugIsMine
                ? 'Leave it empty and this becomes the home page.'
                : 'Filled in from the name. Change it if you want something shorter.'}
          </small>
        </div>

        {/*
          The consequence, stated rather than implied.

          An empty address quietly means "home page", which is right for the
          first page and almost never right for the fifth. Hiding that in grey
          helper text meant naming a page "About us", leaving the address alone
          and silently making a second home page, which the database then
          refused with a duplicate error that explained nothing. Now the
          outcome is on screen before the button is pressed.
        */}
        <p className="sv-preview" data-tone={isHome && !homeIsExpected ? 'warn' : 'ok'}>
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

        {/*
          THE REASSURANCE, and it is the whole reason this feature was built.

          A client who thinks renaming a page will break every link to it simply
          never renames one, so an address written in a hurry on day one stays
          wrong for years. Saying what actually happens is what makes tidying an
          address a thing somebody will do.

          Quiet rather than another coloured box. There is already a green panel
          directly above it saying where the page will live, and two boxes in a
          row is a dialog that shouts.
        */}
        {addressIsMoving && (
          <p className="sv-moved">
            <Icon name="check" size={16} />
            <span>
              <code>
                {host}/{initialSlug}
              </code>{' '}
              will keep working. Anyone following an old link lands on the new
              address, and search engines are told the page has moved for good, so
              it keeps whatever standing it has earned.
            </span>
          </p>
        )}

        {/*
          Submit on Enter, without a second visible button.

          Last in the form on purpose. The Modal focuses the first control it
          finds when it opens, and it should find the page name field, not this.
        */}
        <button type="submit" className="tg-visually-hidden" tabIndex={-1} aria-hidden="true" />
      </form>
    </Modal>
  );
}
