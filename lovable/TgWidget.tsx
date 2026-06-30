/**
 * TgWidget — React wrapper for the Travelgenix widget suite.
 *
 * Lets a Lovable / Vite / React app drop in any of the embeddable Travelgenix
 * travel widgets (currency, weather, reviews, enquiry, offers, and ~40 more)
 * with a single component:
 *
 *     <TgWidget type="currency" config={{ defaultFrom: 'GBP', defaultTo: 'EUR' }} />
 *
 * The widgets themselves are plain <script> embeds served from the hosted suite.
 * Each one renders into a Shadow DOM, so none of their styles leak into your app
 * and none of your app's styles (Tailwind resets included) leak into them.
 *
 * How mounting works (and why this wrapper exists):
 *   - Each widget script scans the page for a host node:
 *       <div data-tg-widget="currency" data-tg-config='{...}'></div>
 *     and mounts itself into it.
 *   - 9 of the widgets re-scan on DOM changes (MutationObserver); the other ~34
 *     only scan once, when their script first loads. In a React app, components
 *     mount and unmount long after the script has loaded, so this wrapper makes
 *     mounting reliable for every widget:
 *       1. It creates the host node first, then loads the script — so the very
 *          first instance is mounted by the widget's own init().
 *       2. For instances added after the script is cached, it waits briefly for
 *          self-mounting, and if that does not happen it re-runs the widget's
 *          own init() with every sibling host temporarily "parked" so only the
 *          new host is picked up. This is safe even for widgets that attach a
 *          Shadow DOM (re-init never touches an already-mounted host).
 *
 * No build step, no dependency beyond React. Copy this file into your project
 * (e.g. src/components/TgWidget.tsx) and import it.
 */

import { useEffect, useRef } from 'react';
import type { CSSProperties } from 'react';

/** Default origin that serves widget-<type>.js and the config API. */
export const TG_WIDGETS_BASE_URL = 'https://tg-widgets.vercel.app';

/**
 * Every widget published in the suite. Passing any other string still works
 * (the wrapper just loads /widget-<type>.js), but this union powers editor
 * autocomplete and documents what is available.
 */
export type TgWidgetType =
  | 'airport'
  | 'appointment'
  | 'attraction'
  | 'backtotop'
  | 'carousel'
  | 'contact'
  | 'countdown'
  | 'currency'
  | 'dealbar'
  | 'enquiry'
  | 'enquirypro'
  | 'events'
  | 'faq'
  | 'flighttime'
  | 'hours'
  | 'loader'
  | 'logos'
  | 'maps'
  | 'mybooking'
  | 'newsletter'
  | 'offer-builder'
  | 'offer-card'
  | 'offer-page'
  | 'offers'
  | 'offers-grid'
  | 'popup'
  | 'quote-pdf'
  | 'reviews'
  | 'rss'
  | 'share'
  | 'spinwheel'
  | 'spotlight'
  | 'statscounter'
  | 'team'
  | 'testimonials'
  | 'textfx'
  | 'travel-results-ai'
  | 'weather'
  | 'whatsapp'
  | 'worldclock'
  | 'worldmap'
  | 'youtube';

export interface TgWidgetProps {
  /** Which widget to render, e.g. "currency". Loads /widget-<type>.js. */
  type: TgWidgetType | (string & {});
  /**
   * Inline configuration, serialised to the widget's data-tg-config.
   * The shape is per-widget — see each widget's demo/editor page in the suite.
   * Mutually exclusive with `widgetId`; if both are given, `config` wins.
   */
  config?: Record<string, unknown>;
  /**
   * A saved widget id (data-tg-id). The widget fetches its own config from the
   * suite instead of taking it inline. Use this when a widget has been
   * configured in the Travelgenix dashboard.
   */
  widgetId?: string;
  /** Override the host origin. Defaults to the hosted suite. */
  baseUrl?: string;
  /** Class applied to the wrapping element. */
  className?: string;
  /** Inline style applied to the wrapping element. */
  style?: CSSProperties;
}

/** Per-source load state, shared across every TgWidget instance on the page. */
interface ScriptEntry {
  promise: Promise<void>;
  loaded: boolean;
}
const scripts = new Map<string, ScriptEntry>();

function scriptSrc(type: string, baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/widget-${type}.js`;
}

/** Inject a widget script once, reusing any existing tag or in-flight load. */
function loadScript(type: string, baseUrl: string): ScriptEntry {
  const src = scriptSrc(type, baseUrl);
  const existing = scripts.get(src);
  if (existing) return existing;

  const entry: ScriptEntry = { promise: Promise.resolve(), loaded: false };
  entry.promise = new Promise<void>((resolve) => {
    const done = () => {
      entry.loaded = true;
      resolve();
    };
    const onPage = document.querySelector<HTMLScriptElement>(`script[src="${src}"]`);
    if (onPage) {
      if (onPage.dataset.tgLoaded === 'true') {
        done();
      } else {
        onPage.addEventListener('load', () => {
          onPage.dataset.tgLoaded = 'true';
          done();
        });
        // If the existing tag errors, resolve anyway so callers fall through to
        // their fallback / error rendering rather than hanging forever.
        onPage.addEventListener('error', done);
      }
      return;
    }
    const el = document.createElement('script');
    el.src = src;
    el.async = true;
    el.addEventListener('load', () => {
      el.dataset.tgLoaded = 'true';
      done();
    });
    el.addEventListener('error', () => {
      // Leave loaded=false so a later attempt can retry; resolve to unblock.
      resolve();
    });
    document.head.appendChild(el);
  });
  scripts.set(src, entry);
  return entry;
}

/** A widget is mounted once it has rendered into a Shadow DOM or light children. */
function isMounted(host: HTMLElement): boolean {
  return !!host.shadowRoot || host.childElementCount > 0;
}

/** Poll for self-mounting up to `timeout` ms. Resolves true if it mounted. */
function waitMounted(host: HTMLElement, timeout: number): Promise<boolean> {
  return new Promise((resolve) => {
    const start = Date.now();
    const tick = () => {
      if (isMounted(host)) {
        resolve(true);
        return;
      }
      if (Date.now() - start >= timeout) {
        resolve(false);
        return;
      }
      setTimeout(tick, 40);
    };
    tick();
  });
}

/**
 * Re-run a widget's own init() so it mounts a host that was added after its
 * script was cached. Every other host of the same type is temporarily renamed
 * so the widget's querySelectorAll only matches `host`; the originals are
 * restored once the re-injected script has executed. This never re-processes an
 * already-mounted widget, so it is safe even for widgets that attach a Shadow
 * DOM (a second attach would otherwise throw).
 */
function reinitOnlyFor(host: HTMLElement, type: string, baseUrl: string): void {
  const selector = `[data-tg-widget="${type}"]`;
  const parked: HTMLElement[] = [];
  document.querySelectorAll<HTMLElement>(selector).forEach((node) => {
    if (node !== host) {
      node.setAttribute('data-tg-widget-parked', type);
      node.removeAttribute('data-tg-widget');
      parked.push(node);
    }
  });

  const unpark = () => {
    parked.forEach((node) => {
      node.setAttribute('data-tg-widget', type);
      node.removeAttribute('data-tg-widget-parked');
    });
  };

  const src = scriptSrc(type, baseUrl);
  const el = document.createElement('script');
  el.src = src;
  el.async = true;
  // The widget's init() reads its querySelectorAll snapshot synchronously while
  // the script executes, so unparking after `load` cannot reach the snapshot.
  el.addEventListener('load', () => {
    unpark();
    // The re-injected tag has done its job; keep the DOM tidy.
    el.remove();
  });
  el.addEventListener('error', () => {
    unpark();
    el.remove();
  });
  document.head.appendChild(el);
}

const ERROR_HTML =
  '<p style="color:#64748b;font:14px/1.5 system-ui,sans-serif;padding:16px;text-align:center;border:1px dashed #e2e8f0;border-radius:8px;margin:0">Unable to load widget</p>';

export default function TgWidget({
  type,
  config,
  widgetId,
  baseUrl = TG_WIDGETS_BASE_URL,
  className,
  style,
}: TgWidgetProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  // Serialise config so the effect only re-runs on a real change, not on every
  // render that passes a fresh object literal.
  const configKey = config ? JSON.stringify(config) : '';

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let cancelled = false;

    // Build the host node the widget engine looks for, then put it on the page
    // before the script loads so the first instance is mounted by init() itself.
    const host = document.createElement('div');
    host.setAttribute('data-tg-widget', type);
    if (configKey) host.setAttribute('data-tg-config', configKey);
    else if (widgetId) host.setAttribute('data-tg-id', widgetId);
    container.appendChild(host);

    const entry = loadScript(type, baseUrl);
    entry.promise
      .then(async () => {
        if (cancelled || !host.isConnected) return;
        if (!entry.loaded) {
          host.innerHTML = ERROR_HTML;
          return;
        }
        // Give the widget a moment to self-mount (init on first load, or the
        // MutationObserver-backed widgets on a later add). 400ms comfortably
        // covers the observers' ~120ms debounce plus any async config fetch.
        const mounted = await waitMounted(host, 400);
        if (cancelled || mounted || !host.isConnected) return;
        // Added after the script was cached and did not self-mount: re-run the
        // widget's init() for this host only.
        reinitOnlyFor(host, type, baseUrl);
      })
      .catch(() => {
        if (!cancelled && host.isConnected) host.innerHTML = ERROR_HTML;
      });

    return () => {
      cancelled = true;
      // Removing the host tears down its Shadow DOM and listeners.
      try {
        container.removeChild(host);
      } catch {
        /* already detached */
      }
    };
  }, [type, configKey, widgetId, baseUrl]);

  return <div ref={containerRef} className={className} style={style} />;
}
