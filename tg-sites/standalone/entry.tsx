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
import type { PageLink } from '../components/editor/PagesPanel';
import { SEED_PAGE } from '../lib/content/seed';
import { emptyRegion, parsePage, REGIONS, type Page, type RegionName } from '../lib/content/schema';
import { regionAsPage } from '../lib/content/region-page';
import { parseTheme, type Theme } from '../lib/theme/schema';
import { themeTokens } from '../lib/theme/tokens';
import '../app/globals.css';

/**
 * A small stand-in page list for the rail's Pages panel.
 *
 * The real app hands EditorShell the tenant's own pages; this static file has
 * no database, so it carries a plausible few instead. `demo` is the id the
 * seed page is mounted under below, so the panel marks it the current one, and
 * the set exercises what the panel draws: a draft badge, a child row and a list
 * long enough to search. A handle is not needed here, unlike the theme and the
 * page, because a list of page names is exactly what the review copy should
 * show and reveals nothing a test would want to vary.
 */
const DEMO_PAGES: readonly PageLink[] = [
  { id: 'demo', title: 'Home', slug: '', status: 'published', parentId: null },
  { id: 'p-about', title: 'About us', slug: 'about', status: 'published', parentId: null },
  { id: 'p-tours', title: 'Tours', slug: 'tours', status: 'published', parentId: null },
  { id: 'p-italy', title: 'Italy in autumn', slug: 'tours/italy', status: 'published', parentId: 'p-tours' },
  { id: 'p-contact', title: 'Contact', slug: 'contact', status: 'draft', parentId: null },
];

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
  /**
   * Which of the three things this editor is on: the demo page, the header or
   * the footer.
   *
   * A handle rather than a control in the banner, for the same reason the theme
   * is one: this file is also the review copy, and a mode switcher across the
   * top would make it look like the product has one. tools/verify-standalone.mjs
   * calls this, and the real app reaches the region editor through
   * /editor?region=header instead.
   */
  const [region, setRegion] = useState<RegionName | null>(null);
  /**
   * A page the harness drops in to exercise something SEED_PAGE does not carry.
   *
   * The widget block is the one that needs it: it draws its own iframe on the
   * canvas and a bare container on the published page, so the only way to verify
   * that preview keeps showing a widget is to put a real widget on the canvas
   * first. Null is the seed. A handle rather than a control, for the same reason
   * the theme and the region are: this file is also the review copy, and a page
   * switcher across the top would make the product look like it has one.
   */
  const [testPage, setTestPage] = useState<Page | null>(null);

  const handles = window as unknown as Record<string, unknown>;
  handles.__TG_SET_THEME__ = (input: unknown) => {
    setTheme(parseTheme(input));
  };
  handles.__TG_SET_REGION__ = (input: unknown) => {
    setRegion(
      typeof input === 'string' && (REGIONS as readonly string[]).includes(input)
        ? (input as RegionName)
        : null,
    );
  };
  /*
   * Parsed the same way a saved page is, so the harness can hand over a loose
   * object and get back a real Page with its defaults filled. Anything that will
   * not parse, null included, restores the seed.
   */
  handles.__TG_SET_PAGE__ = (input: unknown) => {
    const parsed = input == null ? null : parsePage(input);
    setTestPage(parsed && parsed.ok ? parsed.page : null);
  };

  return (
    <EditorShell
      /*
       * Remounted rather than re-rendered when the mode changes. The shell takes
       * its page as an INITIAL value and owns it from then on, which is right:
       * a parent that could reset it mid-edit would be a way to lose work. So
       * changing what is being edited is a new editor, and the key says so.
       */
      key={region ?? (testPage ? 'testpage' : 'page')}
      isStaff
      // So version history can mark the entries this person published.
      currentUserId="demo-user"
      region={region}
      initialRegionFlags={{ sticky: false, overlay: false }}
      pages={DEMO_PAGES}
      pageId={region ? `region-${region}` : 'demo'}
      initialPage={region ? regionAsPage(emptyRegion(region)) : (testPage ?? SEED_PAGE)}
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
