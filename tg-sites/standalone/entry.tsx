/**
 * Standalone entry point.
 *
 * Bundles the editor into a single self-contained HTML file so it can be
 * shared for review without a deployment. It mounts exactly the same
 * EditorShell the real app renders. It is a distribution wrapper, not a fork.
 *
 * The one substitution is persistence: the build swaps app/actions/pages for
 * standalone/demo-actions, because the real ones import a Postgres driver and
 * cannot run from a static file. See tools/build-standalone.mjs.
 */

import { createRoot } from 'react-dom/client';
import { EditorShell } from '../components/editor/EditorShell';
import { SEED_PAGE } from '../lib/content/seed';
import '../app/globals.css';

const container = document.getElementById('tg-sites-root');

if (container) {
  createRoot(container).render(
    <EditorShell
      isStaff
      pageId="demo"
      initialPage={SEED_PAGE}
      initialStatus="draft"
      initialHasUnpublishedChanges
      /*
        openAccess is deliberately NOT set here. The notice it shows warns
        that anyone with the link can edit these pages, which is true of the
        deployed editor and false of a local file with no database behind it.
        The wrapper's own banner says the accurate thing for this build.
      */
    />,
  );
}
