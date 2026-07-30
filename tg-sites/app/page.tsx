import Link from 'next/link';

import '../components/sites/sites.css';
import { currentUserId } from '../lib/auth/session';

/**
 * The front door.
 *
 * It was eight inline style objects, which is how a placeholder looks after
 * everything around it has been designed. It uses the same tokens, type scale
 * and buttons as the two screens it points at, so arriving here and then
 * going to the dashboard is one product rather than two.
 *
 * The primary action changes depending on whether anyone is signed in, so it
 * never sends somebody to a screen that will bounce them straight back.
 */
export const dynamic = 'force-dynamic';

export default async function Home() {
  const signedIn = Boolean(await currentUserId());

  return (
    <div className="sv-root" data-theme="light">
      <main className="tg-door">
        <p className="tg-door__eyebrow">Travelgenix</p>
        <h1 className="tg-door__title">Sites</h1>

        <p className="tg-door__lede">
          Sections hold rows, rows hold columns, columns hold blocks. Column
          widths are yours to drag, and every row still stacks cleanly on a
          phone.
        </p>

        <div className="tg-door__actions">
          {signedIn ? (
            <>
              <Link className="tg-btn" data-variant="primary" href="/sites">
                Open your pages
              </Link>
              <Link className="tg-btn" href="/preview">
                See a published page
              </Link>
            </>
          ) : (
            // One action, because the other one needs a session too and would
            // only bounce. Two buttons where one works is worse than one.
            <Link className="tg-btn" data-variant="primary" href="/signin">
              Sign in
            </Link>
          )}
        </div>

        <p className="tg-door__note">
          The published page is rendered on the server with no client
          JavaScript, which is the property the whole project exists for. View
          source on it and the content is all there in the first response.
        </p>
      </main>
    </div>
  );
}
