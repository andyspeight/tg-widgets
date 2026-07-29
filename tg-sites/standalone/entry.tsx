/**
 * Standalone entry point.
 *
 * Bundles the editor into a single self-contained HTML file so it can be
 * shared for review without a deployment. The editor tree has no Next
 * dependencies, so this mounts exactly the same components the real app
 * renders. It is a distribution wrapper, not a fork.
 *
 * Built by tools/build-standalone.mjs.
 */

import { createRoot } from 'react-dom/client';
import { EditorShell } from '../components/editor/EditorShell';
import '../app/globals.css';

const container = document.getElementById('tg-sites-root');

if (container) {
  createRoot(container).render(<EditorShell isStaff />);
}
