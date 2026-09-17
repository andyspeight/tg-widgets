/**
 * Entry point for the Pages panel harness. See standalone/theme-entry.tsx.
 *
 * WHY THIS PANEL GOT ITS OWN HARNESS (Andy, 17 Sep 2026). The Add page composer
 * lists every designed page as a card, and at nineteen designs the list stood
 * 1,750px tall inside a 900px panel. The name box ended up 1,800px above the Add
 * page button and the search box twelve pixels below it, so the only text box in
 * sight when you reached the button was the wrong one. Andy typed the page name
 * into the search box and was told to give the page a name.
 *
 * Nothing in a unit test can see that. It is a measurement: is the box you are
 * asked to fill in on the same screen as the button you press. So the panel is
 * mounted here for tools/verify-pages-panel.mjs to measure.
 *
 * onCreatePage records on window rather than calling anything, because what is
 * being checked is that the composer hands over the name that was typed and the
 * design that was picked.
 */

import { createRoot } from 'react-dom/client';

import { PagesPanel, type PageLink } from '../components/editor/PagesPanel';
import '../app/globals.css';
import '../components/editor/editor.css';

const PAGES: PageLink[] = [
  { id: 'pg-home', title: 'Home', slug: '', status: 'published', parentId: null },
  { id: 'pg-about', title: 'About us', slug: 'about', status: 'published', parentId: null },
  { id: 'pg-greece', title: 'Greece', slug: 'greece', status: 'published', parentId: null },
  { id: 'pg-contact', title: 'Contact', slug: 'contact', status: 'draft', parentId: null },
];

declare global {
  interface Window {
    __created: Array<{ title: string; template: string; brief?: string }>;
  }
}

window.__created = [];

const container = document.getElementById('tg-sites-root');
if (container) {
  createRoot(container).render(
    <div className="ed-root" data-theme="light" data-pane="outline" style={{ display: 'flex', height: '100vh' }}>
      {/* The rail column's width and placement, which the editor's own grid gives it. */}
      <style>{'.ed-outline { grid-area: auto; width: 320px; }'}</style>
      <PagesPanel
        pages={PAGES}
        currentId="pg-home"
        onCreatePage={async (title, template, brief) => {
          window.__created.push({ title, template, brief });
          return null;
        }}
        onMovePage={async () => null}
      />
    </div>,
  );
}
