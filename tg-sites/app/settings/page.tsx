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
   * Whether this person is staff is decided HERE and passed down.
   *
   * The screen uses it to decide whether to draw the Travelgenix tab, and that is
   * all it is for. The actions behind that tab check for themselves, because a
   * server action is a public endpoint whose URL sits in the page's JavaScript and
   * a prop is not a permission.
   *
   * Deliberately not site.role === 'owner', which is what the editor still uses for
   * its own staff prop. Every client's own owner is an owner. See lib/auth/staff.ts.
   */
  const isStaff = isStaffEmail(user?.email);

  /*
   * The staff HTML is NOT read here.
   *
   * It would be convenient to pass it as a prop and it would put the head HTML of
   * this client's site into the server-rendered payload of this page, for anybody
   * who opened it, staff tab drawn or not. The panel fetches it over an action that
   * checks, so a client's copy of this page never contains it at all.
   */

  return <SettingsEditor siteName={site.name} initial={settings} isStaff={isStaff} />;
}
