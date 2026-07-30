/**
 * A page that is not there, on a client's own website.
 *
 * WHY THIS IS NOT THE PLATFORM'S 404
 *
 * Whoever sees this is a visitor to a travel agency's site who followed a stale
 * link or mistyped a URL. Next's default 404 says "This page could not be found" in
 * a system font on a white page, which reads as the site being broken rather than
 * the address being wrong, and it carries no way back.
 *
 * DELIBERATELY NOT IN THE CLIENT'S THEME, though, and that is the harder call. It
 * could be: the theme is one read away. But this route is reached when the hostname
 * resolved to no site at all as well as when a path did not match, and in the first
 * case there is no theme to read. A 404 that sometimes looks like the site and
 * sometimes does not would be worse than one that is consistently plain and
 * consistently polite.
 *
 * No links to the editor and no Travelgenix branding either. On somebody else's
 * domain that would be us advertising on their page.
 */
export default function SiteNotFound() {
  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 12,
        padding: 24,
        textAlign: 'center',
        /*
         * Inline styles, and this is the one place in the product where that is
         * right. Every stylesheet here belongs to the editor or to a themed page,
         * and this renders when we may have neither a theme nor a tenant. A 404
         * that depends on a stylesheet loading is a 404 that can fail.
         */
        font: '400 17px/1.6 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
        color: '#0f172a',
        background: '#ffffff',
      }}
    >
      <h1 style={{ margin: 0, fontSize: 28, fontWeight: 700 }}>Page not found</h1>
      <p style={{ margin: 0, maxWidth: '42ch', color: '#475569' }}>
        The address may have changed, or the link that brought you here may be out
        of date.
      </p>
      <p style={{ margin: 0 }}>
        {/*
          A plain link to the site root rather than a router push, because this page
          ships no JavaScript and there is nothing to push with.
        */}
        <a href="/" style={{ color: '#1d4ed8' }}>
          Go to the home page
        </a>
      </p>
    </main>
  );
}
