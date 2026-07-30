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
        There is no openAccess prop any more. It carried a notice saying that
        anyone with the link could edit these pages, which was true of the
        deployed editor until sign-in landed and was never true of a local file
        with no database behind it. The wrapper's own banner says the accurate
        thing for this build.
      */
    />,
  );
}
