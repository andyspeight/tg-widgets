'use client';

/**
 * The slim left rail (Andy, 12 Aug 2026).
 *
 * A permanent thin column of icons on the far left of the editor. Two of them
 * open a panel in the one expanding column beside the rail: Layers is the page
 * structure (the outline), and Pages is the list of the site's pages. Add opens
 * the section picker. The rest are the site's other rooms, which live as their
 * own screens today, so for now their icon takes you there; each can become an
 * in-editor panel later without the rail changing shape.
 *
 * One panel at a time: `active` is whichever of Layers or Pages is open, or null
 * when the column is closed and only the slim rail shows. Clicking the open
 * icon again closes it; onToggle owns that in the shell.
 *
 * DESKTOP ONLY. Below 1181px the shell shows one pane at a time from the top bar,
 * and a rail would cost width on exactly the screens with least of it. So the rail
 * is `ed-editing-only` (gone in preview) and hidden by CSS under 1181px. Inline
 * SVGs rather than the shared Icon set: these are the rail's own vocabulary.
 */

import type { ReactNode } from 'react';

type Panel = 'layers' | 'pages';

/** One item that navigates to an existing screen. */
const LINKS: ReadonlyArray<{ href: string; label: string; title: string; icon: ReactNode }> = [
  {
    href: '/theme',
    label: 'Theme',
    title: 'Theme',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinejoin="round">
        <path d="M12 3a9 9 0 1 0 0 18c1.1 0 2-.9 2-2 0-.5-.2-.9-.5-1.3-.3-.3-.5-.8-.5-1.2 0-1 .8-1.8 1.8-1.8H16a5 5 0 0 0 5-5c0-3.9-4-6.7-9-6.7z" />
        <circle cx="7.5" cy="11.5" r="1.1" fill="currentColor" stroke="none" />
        <circle cx="12" cy="8" r="1.1" fill="currentColor" stroke="none" />
        <circle cx="16.5" cy="11.5" r="1.1" fill="currentColor" stroke="none" />
      </svg>
    ),
  },
  {
    href: '/collections',
    label: 'CMS',
    title: 'Collections',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9">
        <ellipse cx="12" cy="5" rx="8" ry="3" />
        <path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5" />
        <path d="M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6" />
      </svg>
    ),
  },
  {
    href: '/seo',
    label: 'SEO',
    title: 'AEO / SEO',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round">
        <circle cx="11" cy="11" r="7" />
        <path d="M21 21l-4.3-4.3" />
      </svg>
    ),
  },
  {
    href: '/collections',
    label: 'Blog',
    title: 'Blog',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 20h9" />
        <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
      </svg>
    ),
  },
];

export function Rail({
  active,
  onToggle,
  onAdd,
}: {
  active: Panel | null;
  onToggle: (panel: Panel) => void;
  onAdd: () => void;
}) {
  return (
    <nav className="ed-rail ed-editing-only" aria-label="Editor">
      <button
        type="button"
        className="ed-rail__btn ed-rail__btn--add"
        title="Add a section"
        aria-label="Add a section"
        onClick={onAdd}
      >
        <span className="ed-rail__ic">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
            <path d="M12 5v14M5 12h14" />
          </svg>
        </span>
        <span className="ed-rail__lbl">Add</span>
      </button>

      <button
        type="button"
        className="ed-rail__btn"
        title="The site's pages"
        aria-pressed={active === 'pages'}
        onClick={() => onToggle('pages')}
      >
        <span className="ed-rail__ic">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinejoin="round">
            <path d="M8 3h8l4 4v11a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" />
            <path d="M4 7v13a2 2 0 0 0 2 2h10" opacity=".55" />
          </svg>
        </span>
        <span className="ed-rail__lbl">Pages</span>
      </button>

      <button
        type="button"
        className="ed-rail__btn"
        title={active === 'layers' ? 'Hide the page structure' : 'Show the page structure'}
        aria-pressed={active === 'layers'}
        onClick={() => onToggle('layers')}
      >
        <span className="ed-rail__ic">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinejoin="round">
            <path d="M12 3l9 5-9 5-9-5 9-5z" />
            <path d="M3 13l9 5 9-5" opacity=".55" />
          </svg>
        </span>
        <span className="ed-rail__lbl">Layers</span>
      </button>

      {LINKS.map((link) => (
        /*
         * A plain anchor, not next/link, for the two reasons the brand link
         * gives above it: leaving the editor should re-fetch fresh, and next/link
         * would drag Next's runtime into the standalone bundle that has none.
         */
        <a key={link.label} className="ed-rail__btn" href={link.href} title={link.title}>
          <span className="ed-rail__ic">{link.icon}</span>
          <span className="ed-rail__lbl">{link.label}</span>
        </a>
      ))}

      <span className="ed-rail__spacer" />

      <a className="ed-rail__btn" href="/settings" title="Settings and more">
        <span className="ed-rail__ic">
          <svg viewBox="0 0 24 24" fill="currentColor" stroke="none">
            <circle cx="5" cy="12" r="1.7" />
            <circle cx="12" cy="12" r="1.7" />
            <circle cx="19" cy="12" r="1.7" />
          </svg>
        </span>
        <span className="ed-rail__lbl">More</span>
      </a>
    </nav>
  );
}
