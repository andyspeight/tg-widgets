import { EditorShell } from '../../components/editor/EditorShell';

export const metadata = {
  title: 'Editor · Travelgenix Sites',
  // The editor must never be indexed, and it must never be framed. The
  // framing rule becomes a real frame-ancestors header once this sits
  // behind auth at sites.travelify.io.
  robots: { index: false, follow: false },
};

/**
 * `isStaff` is hardcoded here because there is no auth in this package.
 * It becomes a session lookup when tg-auth-gate is wired in. Until then it
 * is true so the staff-only embed block is visible while building.
 */
export default function EditorPage() {
  return <EditorShell isStaff />;
}
