import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import '../../components/theme/theme.css';
import { ThemeEditor } from '../../components/theme/ThemeEditor';
import { activeSite, currentUserId } from '../../lib/auth/session';
import { listFonts } from '../../lib/db/fonts';
import { getTheme } from '../../lib/db/theme';

export const metadata: Metadata = {
  title: 'Theme · Travelgenix Sites',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

export default async function ThemePage() {
  // Guard first, before anything reads the database. Same order as the editor.
  if (!(await currentUserId())) redirect('/signin?next=%2Ftheme');

  const site = await activeSite();
  if (!site) redirect('/sites');

  const [theme, fonts] = await Promise.all([
    getTheme(site.tenantId),
    listFonts(site.tenantId),
  ]);

  return <ThemeEditor siteName={site.name} initial={theme} initialFonts={fonts} />;
}
