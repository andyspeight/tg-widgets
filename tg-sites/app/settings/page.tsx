import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import '../../components/editor/editor.css';
import '../../components/media/media.css';
import '../../components/sites/sites.css';
import '../../components/theme/theme.css';
import { SettingsEditor } from '../../components/settings/SettingsEditor';
import { activeSite, currentUser, currentUserId } from '../../lib/auth/session';
import { isStaffEmail } from '../../lib/auth/staff';
import { getSettings } from '../../lib/db/settings';

export const metadata: Metadata = {
  title: 'Settings · Travelgenix Sites',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  // Guard first, before anything reads the database. Same order as the editor and
  // the theme screen.
  if (!(await currentUserId())) redirect('/signin?next=%2Fsettings');

  const site = await activeSite();
  if (!site) redirect('/sites');

  const [settings, user] = await Promise.all([getSettings(site.tenantId), currentUser()]);

  /*
   * Who may edit head and body HTML is decided HERE and passed down.
   *
   * The site's OWNER, or us. Andy opened this up on 30 Jul 2026: every CMS an agency
   * has used before lets them add their own tracking and chat code, and one that
   * makes them raise a ticket for it is one they will resent. An editor or a viewer
   * still cannot, because this field runs on every page of the live site and that
   * belongs to whoever answers for it.
   *
   * The staff half is deliberately isStaffEmail rather than a role, because every
   * client's own owner is an owner and that tells us nothing. See lib/auth/staff.ts.
   *
   * The screen uses this to decide whether to draw the tab, and that is all it is
   * for. The actions behind it check for themselves, because a server action is a
   * public endpoint whose URL sits in the page's JavaScript and a prop is not a
   * permission.
   */
  const canEditCode = site.role === 'owner' || isStaffEmail(user?.email);

  /*
   * The head and body HTML is NOT read here.
   *
   * It would be convenient to pass it as a prop and it would put it into the
   * server-rendered payload of this page for anybody who opened the settings screen,
   * tab drawn or not, including an editor and a viewer. It can hold an API key for
   * whatever it was pasted to load. The panel fetches it over an action that checks,
   * so a copy of this page that should not contain it does not contain it.
   */

  return (
    <SettingsEditor siteName={site.name} initial={settings} canEditCode={canEditCode} />
  );
}
