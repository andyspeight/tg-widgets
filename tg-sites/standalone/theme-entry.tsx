/**
 * Entry point for the theme screen harness.
 *
 * WHY THIS EXISTS
 *
 * The theme screen had no browser coverage at all, and the project record says a
 * throwaway harness has been hand-built for it twice. This is that harness, kept.
 *
 * It matters most for the typeface dropdown. That control replaced a native select
 * and therefore had to reimplement the keyboard, the announcement and the closing
 * behaviour a select gives away for free, and none of that can be checked by
 * reading. tools/verify-theme.mjs drives it.
 *
 * The one substitution is the actions: the real ones import a Postgres driver and
 * reach Google. Everything else, including the 1,941-entry catalogue and the real
 * search ranking, is the shipping code.
 */

import { createRoot } from 'react-dom/client';

import { ThemeEditor } from '../components/theme/ThemeEditor';
import { parseTheme } from '../lib/theme/schema';
import type { FontFamily } from '../lib/db/fonts';
import '../app/globals.css';
import '../components/editor/editor.css';
import '../components/theme/theme.css';

/**
 * A library with one serif and one sans in it.
 *
 * Two, not one, because the interesting assertion is that two rows in the same
 * dropdown render in DIFFERENT typefaces. One row proves nothing: a list where
 * every row happens to use the same fallback looks identical to a working one.
 */
const FONTS: FontFamily[] = [
  {
    id: 'demo-1',
    family: 'Playfair Display',
    slug: 'playfair-display',
    source: 'google',
    fallback: 'serif',
    weights: [400, 700],
    bytes: 61_440,
  },
  {
    id: 'demo-2',
    family: 'Founders Grotesk',
    slug: 'founders-grotesk',
    source: 'upload',
    fallback: 'sans',
    weights: [400],
    bytes: 28_672,
  },
];

const container = document.getElementById('tg-sites-root');
if (container) {
  createRoot(container).render(
    <div className="sv-root" data-theme="light">
      <ThemeEditor siteName="Demo Travel" initial={parseTheme({})} initialFonts={FONTS} />
    </div>,
  );
}
