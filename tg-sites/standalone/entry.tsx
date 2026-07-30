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

import { useState } from 'react';
import { createRoot } from 'react-dom/client';

import { EditorShell } from '../components/editor/EditorShell';
import { SEED_PAGE } from '../lib/content/seed';
import { parseTheme, type Theme } from '../lib/theme/schema';
import { themeTokens } from '../lib/theme/tokens';
import '../app/globals.css';

/**
 * The site theme, and a way for the verification harness to change it.
 *
 * THE DEFAULT IS THE DEFAULT, on purpose. This file is also what gets sent to
 * somebody for review, and opening it to find a demo site in test colours would
 * make the build look broken.
 *
 * The theme cannot come from a database here, and hardcoding an awkward one to
 * exercise the derivation would trade the review copy for the test. So the
 * harness gets a handle instead: tools/verify-standalone.mjs calls this with a
 * pale gold brand, which is the colour that catches a naive derivation putting
 * white text on it, and measures what the browser actually computed. That is
 * worth more than any assertion in Node, because it is the real cascade
 * resolving real custom properties.
 */
function App() {
  const [theme, setTheme] = useState<Theme>(() => parseTheme({}));

  (window as unknown as Record<string, unknown>).__TG_SET_THEME__ = (input: unknown) => {
    setTheme(parseTheme(input));
  };

  return (
    <EditorShell
      isStaff
      pageId="demo"
      initialPage={SEED_PAGE}
      initialStatus="draft"
      initialHasUnpublishedChanges
      siteTheme={themeTokens(theme).style}
      /*
        There is no openAccess prop any more. It carried a notice saying that
        anyone with the link could edit these pages, which was true of the
        deployed editor until sign-in landed and was never true of a local file
        with no database behind it. The wrapper's own banner says the accurate
        thing for this build.
      */
    />
  );
}

const container = document.getElementById('tg-sites-root');
if (container) createRoot(container).render(<App />);
