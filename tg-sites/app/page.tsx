import Link from 'next/link';

/**
 * A plain index so the shell has a front door. Replaced by the site
 * dashboard once tenants and pages come out of Postgres.
 */
export default function Home() {
  return (
    <main
      style={{
        maxWidth: 640,
        margin: '0 auto',
        padding: '64px 24px',
        fontFamily: 'ui-sans-serif, system-ui, sans-serif',
        lineHeight: 1.6,
        color: '#0f172a',
      }}
    >
      <p style={{ color: '#64748b', margin: 0, fontSize: 14 }}>Travelgenix</p>
      <h1 style={{ fontSize: 40, lineHeight: 1.15, margin: '4px 0 16px', letterSpacing: '-0.02em' }}>
        Sites
      </h1>
      <p style={{ fontSize: 18, color: '#475569' }}>
        The CMS shell. Sections hold rows, rows hold columns, columns hold blocks.
        Column widths are yours to drag, and every row still stacks cleanly on a
        phone.
      </p>

      <div style={{ display: 'flex', gap: 12, marginTop: 32, flexWrap: 'wrap' }}>
        <Link
          href="/sites"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            minHeight: 48,
            padding: '0 24px',
            borderRadius: 10,
            background: '#1b2b5b',
            color: '#fff',
            textDecoration: 'none',
            fontWeight: 600,
          }}
        >
          Open your pages
        </Link>
        <Link
          href="/preview"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            minHeight: 48,
            padding: '0 24px',
            borderRadius: 10,
            border: '1px solid #cbd5e1',
            color: '#0f172a',
            textDecoration: 'none',
            fontWeight: 600,
          }}
        >
          See a server-rendered page
        </Link>
      </div>

      <p style={{ fontSize: 14, color: '#64748b', marginTop: 40 }}>
        The preview is rendered on the server with no client JavaScript, which is
        the property the whole project exists for. View source on it and the
        content is all there in the initial HTML.
      </p>
    </main>
  );
}
