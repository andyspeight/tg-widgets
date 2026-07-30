/**
 * Entry point for the settings screen harness. See standalone/theme-entry.tsx.
 *
 * Mounted twice over, once as staff and once not, because the interesting property
 * is that the Travelgenix tab exists in one and not the other. A harness that only
 * ever rendered one of them would prove nothing about the gate.
 */

import { createRoot } from 'react-dom/client';

import { SettingsEditor } from '../components/settings/SettingsEditor';
import { parseSettings } from '../lib/settings/schema';
import '../app/globals.css';
import '../components/editor/editor.css';
import '../components/sites/sites.css';
import '../components/theme/theme.css';

const staff = new URLSearchParams(window.location.search).get('staff') === '1';

const container = document.getElementById('tg-sites-root');
if (container) {
  createRoot(container).render(
    <SettingsEditor
      siteName="Demo Travel"
      initial={parseSettings({ gtmId: 'GTM-ABC1234', faviconUrl: '/f.png' })}
      isStaff={staff}
    />,
  );
}
