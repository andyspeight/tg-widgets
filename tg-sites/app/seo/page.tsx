import { permanentRedirect } from 'next/navigation';

/**
 * The old address of the visibility screen. Its audit, fix list and per-page
 * list moved onto the results board on 16 Sep 2026, so anything that still
 * points here (a bookmark, an older link in an email) lands on the board.
 */
export default function SeoPage() {
  permanentRedirect('/results');
}
