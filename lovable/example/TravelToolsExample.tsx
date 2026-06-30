/**
 * Example: a few Travelgenix widgets composed in a Lovable / React page.
 *
 * Copy TgWidget.tsx (and optionally widget-catalogue.ts) into your project,
 * adjust the import paths, and drop components like these wherever you need
 * them. Layout/width is controlled with className/style on <TgWidget>; the
 * widget's own look is controlled through `config`.
 */

import TgWidget from '../TgWidget';

export default function TravelToolsExample() {
  return (
    <main style={{ maxWidth: 1100, margin: '0 auto', padding: '40px 24px', display: 'grid', gap: 40 }}>
      <header>
        <h1 style={{ fontSize: 32, margin: '0 0 8px' }}>Plan your trip</h1>
        <p style={{ color: '#475569', margin: 0 }}>
          Live travel tools, dropped straight into the page.
        </p>
      </header>

      {/* Currency converter — sized with a wrapper class/style */}
      <section>
        <h2>Travel money</h2>
        <TgWidget
          type="currency"
          style={{ maxWidth: 420 }}
          config={{
            heading: 'Currency converter',
            currencies: ['GBP', 'EUR', 'USD', 'AUD', 'THB'],
            defaultFrom: 'GBP',
            defaultTo: 'EUR',
            defaultAmount: 500,
            accent: '#0891B2',
            layout: 'card',
            showFlags: true,
            showRate: true,
          }}
        />
      </section>

      {/* Destination weather */}
      <section>
        <h2>When to go</h2>
        <TgWidget
          type="weather"
          config={{
            layout: 'standard',
            brandColor: '#1B2B5B',
            accentColor: '#00B4D8',
            temperatureUnit: 'C',
            showFlag: true,
          }}
        />
      </section>

      {/* FAQ accordion */}
      <section>
        <h2>Good to know</h2>
        <TgWidget type="faq" config={{ accent: '#0891B2' }} />
      </section>
    </main>
  );
}
