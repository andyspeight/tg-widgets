/**
 * The one script tag a site that asked to stop right click needs.
 *
 * CONDITIONAL, which is clause 1 of the no-JavaScript rule: a page that asks for
 * nothing ships nothing. A site without the setting renders exactly the bytes it
 * did before this existed.
 *
 * NEVER IN THE EDITOR. Blocking the context menu on the canvas would stop
 * whoever is building the site from using their own browser, and the setting is
 * about what a VISITOR gets. The editor simply does not render this component.
 *
 * The src is a fixed same-origin path. Nothing a client typed reaches it.
 */

import type { ReactElement } from 'react';
import type { SiteSettings } from '../../lib/settings/schema';

export function NoRightClickScript({
  settings,
}: {
  settings: Pick<SiteSettings, 'noRightClick'>;
}): ReactElement | null {
  if (!settings.noRightClick) return null;
  return <script src="/no-right-click.js" defer />;
}
