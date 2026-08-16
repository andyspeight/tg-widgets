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

import { EditorShell, type ChromeRegion } from '../components/editor/EditorShell';
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
  { id: 'p-italy', title: 'Italy in autumn', slug: 'italy', status: 'published', parentId: 'p-tours' },
  // A third tier, so the panel draws nesting deeper than one and the Menu draws a
  // flyout off a dropdown: Tours holds Italy, and Italy holds Rome.
  { id: 'p-rome', title: 'Rome in a weekend', slug: 'rome', status: 'published', parentId: 'p-italy' },
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
  /**
   * The header and footer the harness drops in to exercise the chrome drawn
   * around the page on the canvas. Null is no chrome, which is the review copy's
   * default: opening this file to find a stranger's header and footer would make
   * the build look like somebody else's site. A handle rather than a control,
   * for the same reason the theme, the region and the test page are.
   */
  const [chromeHeader, setChromeHeader] = useState<ChromeRegion | null>(null);
  const [chromeFooter, setChromeFooter] = useState<ChromeRegion | null>(null);

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
  /*
   * The header and footer to draw around the page, each parsed the same way a
   * saved page is so the harness can hand over loose objects. Takes
   * { header, footer }; either missing or unparseable becomes no chrome on that
   * side. Anything that is not an object clears both.
   */
  handles.__TG_SET_CHROME__ = (input: unknown) => {
    const one = (value: unknown): ChromeRegion | null => {
      if (value == null) return null;
      const parsed = parsePage(value);
      if (!parsed.ok) return null;
      // The harness passes a page; the rest is the default a fresh region has, so
      // a test that only cares about the content does not have to spell it out.
      return { content: parsed.page, sticky: false, overlay: false, published: false, unpublished: true };
    };
    const obj = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
    setChromeHeader(one(obj.header));
    setChromeFooter(one(obj.footer));
  };

  return (
    <EditorShell
      /*
       * Remounted rather than re-rendered when the mode changes. The shell takes
       * its page AND its chrome as INITIAL values and owns them from then on,
       * which is right: a parent that could reset them mid-edit would be a way to
       * lose work. So changing what is being edited, or dropping in a header and
       * footer to edit, is a new editor, and the key says so. The real app hands
       * the chrome over at mount, so only this review file needs the chrome in the
       * key; there it arrives through a handle after the page is already up.
       */
      key={`${region ?? 'page'}:${testPage ? 'tp' : 'seed'}:${chromeHeader ? 'h' : ''}${chromeFooter ? 'f' : ''}`}
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
      // The chrome drawn around the page. The shell itself leaves it off while a
      // region or an item is the thing being edited, so these can pass straight.
      chromeHeader={chromeHeader}
      chromeFooter={chromeFooter}
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
