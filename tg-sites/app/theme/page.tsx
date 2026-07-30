import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import '../../components/theme/theme.css';
import { LibraryFontFaces } from '../../components/theme/LibraryFontFaces';
import { ThemeEditor } from '../../components/theme/ThemeEditor';
import { activeSite, currentUserId } from '../../lib/auth/session';
import { listFontFaces, listFonts } from '../../lib/db/fonts';
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

  const [theme, fonts, faces] = await Promise.all([
    getTheme(site.tenantId),
    listFonts(site.tenantId),
    /*
     * The files, not just the family names.
     *
     * Read through the APP role rather than the renderer's, because this request
     * already has a session and there is no reason to reach for the public
     * connection inside a signed-in screen.
     */
    listFontFaces(site.tenantId, 'app'),
  ]);

  return (
    <>
      {/*
        Without this the whole screen chooses fonts blind. Every control that
        renders a family name in its own typeface was already written to do so and
        was silently falling back, because this page emitted no @font-face rules
        at all. See components/theme/LibraryFontFaces.tsx.
      */}
      <LibraryFontFaces tenantSlug={site.slug} files={faces} />
      <ThemeEditor siteName={site.name} initial={theme} initialFonts={fonts} />
    </>
  );
}
