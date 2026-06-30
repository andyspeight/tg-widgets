# Travelgenix widgets in Lovable (React)

A drop-in React wrapper that lets a [Lovable](https://lovable.dev) app — or any
Vite / React / Next project — embed the Travelgenix travel widgets (currency,
weather, reviews, enquiry forms, offers and ~40 more).

The widgets are self-contained `<script>` embeds that render into a **Shadow
DOM**, so:

- their styles never leak into your app, and
- your app's styles (Tailwind's reset included) never leak into them.

This wrapper handles the one thing the raw script embeds do not do well inside a
React app: mounting reliably when components appear, change, and unmount after
the script has already loaded.

## Install

There is nothing to `npm install`. Copy two files into your project:

- `TgWidget.tsx`  → e.g. `src/components/TgWidget.tsx`
- `widget-catalogue.ts` (optional) → `src/components/widget-catalogue.ts`

The only dependency is React, which a Lovable project already has.

## Use

```tsx
import TgWidget from '@/components/TgWidget';

export default function TravelMoney() {
  return (
    <TgWidget
      type="currency"
      config={{
        heading: 'Currency converter',
        currencies: ['GBP', 'EUR', 'USD', 'AUD', 'THB'],
        defaultFrom: 'GBP',
        defaultTo: 'EUR',
        defaultAmount: 500,
        accent: '#0891B2',
        layout: 'card',
      }}
    />
  );
}
```

That is the whole integration. The wrapper:

1. loads `https://tg-widgets.vercel.app/widget-currency.js` once (shared across
   every `<TgWidget>` on the page),
2. renders the host element the widget looks for,
3. mounts the widget — including when the component is added long after the
   script loaded, or re-rendered with new `config`,
4. tears it down on unmount.

### Props

| Prop        | Type                      | Notes                                                                 |
| ----------- | ------------------------- | --------------------------------------------------------------------- |
| `type`      | `TgWidgetType \| string`  | Which widget, e.g. `"currency"`. Loads `/widget-<type>.js`.           |
| `config`    | `Record<string, unknown>` | Inline config (becomes `data-tg-config`). Shape is per-widget.        |
| `widgetId`  | `string`                  | A saved widget id (`data-tg-id`); the widget fetches its own config.  |
| `baseUrl`   | `string`                  | Override the host origin. Defaults to the hosted suite.               |
| `className` | `string`                  | Class on the wrapping element.                                        |
| `style`     | `CSSProperties`           | Inline style on the wrapping element.                                 |

Pass **either** `config` (inline) **or** `widgetId` (saved). If both are given,
`config` wins.

### Available widgets

See `widget-catalogue.ts` for the full list with example configs. Common ones:
`currency`, `weather`, `reviews`, `testimonials`, `faq`, `countdown`, `logos`,
`enquiry`, `newsletter`, `offers`, `worldclock`, `flighttime`.

### Where do config shapes come from?

Each widget's config mirrors the JSON its demo/editor page writes to
`data-tg-config`. The examples in `widget-catalogue.ts` are good starting
points. To discover every option for a widget, open its editor in the
Travelgenix dashboard and copy the config it produces.

## How it mounts (the important bit)

Each widget script scans the page for a host node and mounts into it:

```html
<div data-tg-widget="currency" data-tg-config='{...}'></div>
```

Nine of the widgets re-scan on DOM changes; the other ~34 only scan once, when
their script first loads. React mounts components long after that, so the
wrapper:

- **creates the host first, then loads the script** — so the first instance is
  mounted by the widget's own `init()`;
- for instances added **after** the script is cached, waits ~400 ms for
  self-mounting, and if it does not happen, re-runs the widget's own `init()`
  with every sibling host temporarily "parked" so only the new host is picked
  up. That re-init never touches an already-mounted widget, so it is safe even
  for the widgets that use a Shadow DOM.

You do not need to think about any of this — it is why the wrapper exists.

## Notes & limits

- **Network:** widgets load from `tg-widgets.vercel.app` and some call back to
  that origin for live data (FX rates, offers, etc.). The user's browser needs
  to reach it.
- **One origin:** all widgets and their data come from the same `baseUrl`.
- **StrictMode:** the wrapper is StrictMode-safe (double-invoke in dev just
  remounts cleanly).
- **SSR:** mounting runs in `useEffect`, so it is client-only. A Lovable/Vite
  SPA is fine. Under Next's app router the component is a client component
  (`'use client'`).
