# Lovable knowledge — Travelgenix widgets

Paste this into Lovable's **Knowledge** (Project Settings → Knowledge), or into a
chat message, so Lovable knows the widget wrapper exists and how to use it. Then
you can just say "add the currency converter to the homepage" and it will wire it
up correctly.

---

## Travelgenix widgets

This project can embed Travelgenix travel widgets through a React component,
`TgWidget`, in `src/components/TgWidget.tsx`. Always use this component to add a
widget — never add raw `<script>` tags and never build the widget UI by hand.

**Usage:**

```tsx
import TgWidget from '@/components/TgWidget';

<TgWidget type="currency" config={{ defaultFrom: 'GBP', defaultTo: 'EUR', defaultAmount: 500 }} />
```

**Props:**

- `type` (required) — the widget to render, e.g. `"currency"`.
- `config` — an object of widget options, passed inline.
- `widgetId` — instead of `config`, the id of a widget already configured in the
  Travelgenix dashboard.
- `className` / `style` — applied to the wrapper element (use these for layout,
  width, margins — the widget renders inside).

**Rules:**

- Each widget renders inside its own Shadow DOM. Do not try to style its
  internals with your app's CSS or Tailwind classes — pass colours/layout
  through `config` instead (most widgets accept things like `accent`, `layout`,
  `theme`).
- Size and position the widget with `className`/`style` on `<TgWidget>`, e.g.
  `<TgWidget type="currency" className="max-w-md mx-auto" config={...} />`.
- Pass either `config` or `widgetId`, not both.

**Available `type` values:**

`airport`, `appointment`, `attraction`, `backtotop`, `carousel`, `contact`,
`countdown`, `currency`, `dealbar`, `enquiry`, `enquirypro`, `events`, `faq`,
`flighttime`, `hours`, `loader`, `logos`, `maps`, `mybooking`, `newsletter`,
`offer-builder`, `offer-card`, `offer-page`, `offers`, `offers-grid`, `popup`,
`quote-pdf`, `reviews`, `rss`, `share`, `spinwheel`, `spotlight`, `statscounter`,
`team`, `testimonials`, `textfx`, `travel-results-ai`, `weather`, `whatsapp`,
`worldclock`, `worldmap`, `youtube`.

**Example configs to start from:**

```tsx
// Currency converter
<TgWidget type="currency" config={{
  heading: 'Currency converter',
  currencies: ['GBP', 'EUR', 'USD', 'AUD', 'THB'],
  defaultFrom: 'GBP', defaultTo: 'EUR', defaultAmount: 500,
  accent: '#0891B2', layout: 'card', showFlags: true, showRate: true,
}} />

// Destination weather
<TgWidget type="weather" config={{
  layout: 'standard', brandColor: '#1B2B5B', accentColor: '#00B4D8',
  temperatureUnit: 'C', showFlag: true,
}} />

// Reviews wall
<TgWidget type="reviews" config={{ layout: 'grid', accent: '#0891B2' }} />

// FAQ accordion
<TgWidget type="faq" config={{ accent: '#0891B2' }} />
```

If you are unsure of a widget's exact config options, render it with a minimal
config (or `{}`) — it falls back to sensible defaults — and refine from there.
