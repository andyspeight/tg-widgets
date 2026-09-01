/**
 * The site-wide floating widgets: back to top, WhatsApp, the deal bar, the loader.
 *
 * These are the widgets that float or sit across the WHOLE site rather than in a
 * column, so they live in a setting a client sets once, and the published shell
 * emits one container per enabled one on every page. Each is one of the existing
 * Travelgenix widgets (widget-<tag>.js on WIDGET_ORIGIN); the config travels to
 * it INLINE as data-tg-config JSON, so there is no widget id and no cross-origin
 * config fetch (see the embed contract and components/render/FloatingWidgets).
 *
 * TOTAL AND DEFENSIVE, like every parser here. Each field is validated to what
 * the widget will accept, so a bad value in the database can never reach the
 * page: colours are hex or the default, urls go through safeUrl, enums are
 * whitelisted, numbers are clamped to the widget's own bounds, and text is
 * stripped and capped. The widget hardens again at render, but the JSON we emit
 * only ever holds sanitised primitives, which is what makes the inline attribute
 * safe.
 *
 * WHAT IS EXPOSED is a deliberate subset of each widget's full options: the
 * fields a client actually sets, with the rest left to the widget's own sensible
 * defaults. Editor-only flags (a widget's previewMode) are never here.
 */

import { safeUrl } from '../content/sanitise';
import { parseAudience, type Audience } from '../content/audience';
import type { FloatingWidgetTag } from '../content/widgets';

// ---------------------------------------------------------------------------
// Field helpers
// ---------------------------------------------------------------------------

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

/** One line: control characters stripped, whitespace collapsed, capped. */
function line(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  return value.replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

/** Several lines: control characters out but newlines kept, capped. For a message box. */
function multiline(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  return value.replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, '').trim().slice(0, max);
}

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

/** A hex colour, or the default. Matches the widgets' own safeColor behaviour. */
function colour(value: unknown, fallback: string): string {
  return typeof value === 'string' && HEX.test(value.trim()) ? value.trim() : fallback;
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

/** A whole number clamped to the widget's own range, or the default. */
function num(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

/**
 * A link a client can point a button at. Relative and anchor links pass through
 * (the widgets permit them); everything else goes through safeUrl, which allows
 * http(s), mailto and tel and refuses javascript: and data:. Empty when nothing
 * usable.
 */
function link(value: unknown): string {
  if (typeof value !== 'string') return '';
  const t = value.trim();
  if (!t) return '';
  if (t.startsWith('#') || t.startsWith('/')) return line(t, 300);
  return safeUrl(t, { allowContact: true }) || '';
}

/** A phone number in whatever shape it is written, kept to the characters wa.me needs. */
function phone(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.replace(/[^\d+()\-\s]/g, '').trim().slice(0, 24);
}

/** An ISO-ish datetime, or empty. Stored as a plain validated string, never a Date. */
function isoDateTime(value: unknown): string {
  if (typeof value !== 'string') return '';
  const t = value.trim();
  return /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})?)?$/.test(t)
    ? t
    : '';
}

/** 'transparent' or a hex colour, for the loader background. */
function transparentOrHex(value: unknown, fallback: string): string {
  if (typeof value === 'string' && value.trim().toLowerCase() === 'transparent') return 'transparent';
  return colour(value, fallback);
}

/**
 * A CSS selector for the click trigger, restricted to a safe SIMPLE-selector charset.
 *
 * The widget hands this to `element.closest(sel)`, which throws on invalid syntax,
 * so both the engine and the popup wrap the call in try/catch and a bad selector
 * simply never fires. This keeps the obviously wrong out one step earlier: letters,
 * digits, spaces and the punctuation a class/id/attribute/tag selector needs, and
 * nothing that would carry a brace, a semicolon or an angle bracket. Empty when it
 * is not a plausible selector, which the widget reads as "never fires".
 */
const SIMPLE_SELECTOR = /^[a-z0-9\s,.#>_\-[\]="':()*]+$/i;
function cssSelector(value: unknown): string {
  if (typeof value !== 'string') return '';
  const t = value.trim().slice(0, 120);
  return t && SIMPLE_SELECTOR.test(t) ? t : '';
}

/**
 * A list of page paths for the popup's include/exclude rule.
 *
 * Accepts the array the panel stores OR a newline/comma string (an import, a paste),
 * cleaning each entry to one line, dropping blanks and duplicates, and capping the
 * count so a runaway list cannot bloat the inline config. The widget matches each
 * against `pathname + search`, exact or as a prefix, so `/offers` covers `/offers`
 * and `/offers/summer` both; the values are left as the client typed them.
 */
function pathList(value: unknown): string[] {
  const raw = typeof value === 'string' ? value.split(/[\n,]+/) : Array.isArray(value) ? value : [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const path = line(item, 200);
    if (!path || seen.has(path)) continue;
    seen.add(path);
    out.push(path);
    if (out.length >= 40) break;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Back to top
// ---------------------------------------------------------------------------

export interface BackToTopSettings {
  enabled: boolean;
  showAfter: number;
  position: 'bottom-right' | 'bottom-left' | 'bottom-center';
  offset: number;
  shape: 'circle' | 'rounded' | 'square';
  size: number;
  accent: string;
  icon: 'chevron' | 'arrow' | 'double';
  showLabel: boolean;
  labelText: string;
  smoothScroll: boolean;
  shadow: boolean;
}

const DEFAULT_BACK_TO_TOP: BackToTopSettings = {
  enabled: false,
  showAfter: 25,
  position: 'bottom-right',
  offset: 24,
  shape: 'circle',
  size: 52,
  accent: '#0891B2',
  icon: 'chevron',
  showLabel: false,
  labelText: '',
  smoothScroll: true,
  shadow: true,
};

function parseBackToTop(value: unknown): BackToTopSettings {
  const o = asObject(value);
  return {
    enabled: bool(o.enabled, false),
    showAfter: num(o.showAfter, 1, 95, 25),
    position: oneOf(o.position, ['bottom-right', 'bottom-left', 'bottom-center'] as const, 'bottom-right'),
    offset: num(o.offset, 0, 80, 24),
    shape: oneOf(o.shape, ['circle', 'rounded', 'square'] as const, 'circle'),
    size: num(o.size, 36, 80, 52),
    accent: colour(o.accent, '#0891B2'),
    icon: oneOf(o.icon, ['chevron', 'arrow', 'double'] as const, 'chevron'),
    showLabel: bool(o.showLabel, false),
    labelText: line(o.labelText, 16),
    smoothScroll: bool(o.smoothScroll, true),
    shadow: bool(o.shadow, true),
  };
}

// ---------------------------------------------------------------------------
// WhatsApp chat (the floating layout only)
// ---------------------------------------------------------------------------

export interface WhatsAppSettings {
  enabled: boolean;
  phone: string;
  message: string;
  position:
    | 'bottom-right'
    | 'bottom-left'
    | 'top-right'
    | 'top-left'
    | 'middle-right'
    | 'middle-left';
  brand: string;
  greetingEnabled: boolean;
  greetingText: string;
  greetingDelay: number;
}

const DEFAULT_WHATSAPP: WhatsAppSettings = {
  enabled: false,
  phone: '',
  message: 'Hi! I have a question about your travel services.',
  position: 'bottom-right',
  brand: '#25D366',
  greetingEnabled: false,
  greetingText: 'Need help finding your perfect trip?',
  greetingDelay: 8,
};

function parseWhatsApp(value: unknown): WhatsAppSettings {
  const o = asObject(value);
  return {
    enabled: bool(o.enabled, false),
    phone: phone(o.phone),
    message: multiline(o.message, 500) || DEFAULT_WHATSAPP.message,
    position: oneOf(
      o.position,
      ['bottom-right', 'bottom-left', 'top-right', 'top-left', 'middle-right', 'middle-left'] as const,
      'bottom-right',
    ),
    brand: colour(o.brand, '#25D366'),
    greetingEnabled: bool(o.greetingEnabled, false),
    greetingText: line(o.greetingText, 120) || DEFAULT_WHATSAPP.greetingText,
    greetingDelay: num(o.greetingDelay, 0, 120, 8),
  };
}

// ---------------------------------------------------------------------------
// Deal bar
// ---------------------------------------------------------------------------

export interface DealBarSettings {
  enabled: boolean;
  message: string;
  emoji: string;
  position: 'top' | 'bottom';
  bg: string;
  ctaShow: boolean;
  ctaLabel: string;
  ctaUrl: string;
  ctaNewTab: boolean;
  ctaBg: string;
  showCountdown: boolean;
  countdownTo: string;
  sticky: boolean;
  pushPage: boolean;
  dismissible: boolean;
  rememberDismiss: boolean;
  startAt: string;
  endAt: string;
}

const DEFAULT_DEAL_BAR: DealBarSettings = {
  enabled: false,
  message: 'Late deals out now. Save up to 40% on selected summer breaks.',
  emoji: '',
  position: 'top',
  bg: '#0F2742',
  ctaShow: true,
  ctaLabel: 'See the deals',
  ctaUrl: '',
  ctaNewTab: true,
  ctaBg: '#F59E0B',
  showCountdown: false,
  countdownTo: '',
  sticky: true,
  pushPage: true,
  dismissible: true,
  rememberDismiss: true,
  startAt: '',
  endAt: '',
};

function parseDealBar(value: unknown): DealBarSettings {
  const o = asObject(value);
  return {
    enabled: bool(o.enabled, false),
    message: multiline(o.message, 300) || DEFAULT_DEAL_BAR.message,
    emoji: line(o.emoji, 8),
    position: oneOf(o.position, ['top', 'bottom'] as const, 'top'),
    bg: colour(o.bg, '#0F2742'),
    ctaShow: bool(o.ctaShow, true),
    ctaLabel: line(o.ctaLabel, 40) || DEFAULT_DEAL_BAR.ctaLabel,
    ctaUrl: link(o.ctaUrl),
    ctaNewTab: bool(o.ctaNewTab, true),
    ctaBg: colour(o.ctaBg, '#F59E0B'),
    showCountdown: bool(o.showCountdown, false),
    countdownTo: isoDateTime(o.countdownTo),
    sticky: bool(o.sticky, true),
    pushPage: bool(o.pushPage, true),
    dismissible: bool(o.dismissible, true),
    rememberDismiss: bool(o.rememberDismiss, true),
    startAt: isoDateTime(o.startAt),
    endAt: isoDateTime(o.endAt),
  };
}

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

const LOADER_TEMPLATES = [
  'plane-path',
  'globe-spin',
  'luggage',
  'route-pins',
  'balloon',
  'spinner',
  'dual-ring',
  'dots-bounce',
  'bar-sweep',
  'bar-progress',
] as const;

export interface LoaderSettings {
  enabled: boolean;
  template: (typeof LOADER_TEMPLATES)[number];
  primary: string;
  secondary: string;
  track: string;
  background: string;
  label: string;
  labelColor: string;
}

const DEFAULT_LOADER: LoaderSettings = {
  enabled: false,
  template: 'plane-path',
  primary: '#00B4D8',
  secondary: '#1B2B5B',
  track: '#E2E8F0',
  background: 'transparent',
  label: '',
  labelColor: '#475569',
};

function parseLoader(value: unknown): LoaderSettings {
  const o = asObject(value);
  return {
    enabled: bool(o.enabled, false),
    template: oneOf(o.template, LOADER_TEMPLATES, 'plane-path'),
    primary: colour(o.primary, '#00B4D8'),
    secondary: colour(o.secondary, '#1B2B5B'),
    track: colour(o.track, '#E2E8F0'),
    background: transparentOrHex(o.background, 'transparent'),
    label: line(o.label, 80),
    labelColor: colour(o.labelColor, '#475569'),
  };
}

// ---------------------------------------------------------------------------
// Popup (the common announcement use)
// ---------------------------------------------------------------------------

const POPUP_LAYOUTS = ['centered', 'slide-in', 'floating-card', 'top-bar', 'bottom-bar'] as const;
/*
 * THE FULL TRIGGER VOCABULARY THE WIDGET ALREADY UNDERSTANDS. The popup's runtime
 * (public/widget-popup.js, delegating to public/tgse-rules.js armTrigger) fires on
 * any of these; the panel used to expose only the first four. 'inactivity' fires
 * after a stretch of no mouse, key or scroll; 'pageviews' after the visitor has
 * seen a few pages this session; 'click' when they click an element you name. The
 * value names match the widget's own config exactly, 'exit-intent' hyphen included.
 */
const POPUP_TRIGGERS = ['load', 'time', 'scroll', 'exit-intent', 'inactivity', 'pageviews', 'click'] as const;
const POPUP_FREQUENCIES = ['session', 'visitor', 'every-visit', 'every-n-days'] as const;
/** Where the popup is allowed to show: everywhere, only some pages, or all but some. */
const POPUP_PAGE_MODES = ['all', 'include', 'exclude'] as const;

export interface PopupSettings {
  enabled: boolean;
  layout: (typeof POPUP_LAYOUTS)[number];
  title: string;
  body: string;
  image: string;
  ctaText: string;
  ctaUrl: string;
  trigger: (typeof POPUP_TRIGGERS)[number];
  /** Seconds; only used by the 'time' trigger. Emitted to the widget in ms. */
  delaySeconds: number;
  scrollPercent: number;
  /** Seconds of no activity before an 'inactivity' trigger fires. The widget's floor is 5. */
  inactivitySeconds: number;
  /** Pages seen this session before a 'pageviews' trigger fires. */
  pageviews: number;
  /** A CSS selector for the 'click' trigger, e.g. `.book-now`. Empty never fires. */
  clickSelector: string;
  frequency: (typeof POPUP_FREQUENCIES)[number];
  frequencyDays: number;
  /** Which pages the popup may show on, and the paths that mode reads. */
  pageMode: (typeof POPUP_PAGE_MODES)[number];
  pagePaths: string[];
  brand: string;
  accent: string;
  overlay: boolean;
  /** Who sees the popup (personalisation v2), resolved server-side. */
  audience?: Audience;
}

const DEFAULT_POPUP: PopupSettings = {
  enabled: false,
  layout: 'centered',
  title: '',
  body: 'Sign up to get exclusive travel deals straight to your inbox.',
  image: '',
  ctaText: '',
  ctaUrl: '',
  trigger: 'load',
  delaySeconds: 5,
  scrollPercent: 50,
  inactivitySeconds: 30,
  pageviews: 2,
  clickSelector: '',
  frequency: 'session',
  frequencyDays: 7,
  pageMode: 'all',
  pagePaths: [],
  brand: '#1B2B5B',
  accent: '#00B4D8',
  overlay: true,
};

function parsePopup(value: unknown): PopupSettings {
  const o = asObject(value);
  return {
    enabled: bool(o.enabled, false),
    layout: oneOf(o.layout, POPUP_LAYOUTS, 'centered'),
    title: line(o.title, 80),
    body: multiline(o.body, 300) || DEFAULT_POPUP.body,
    image: link(o.image),
    ctaText: line(o.ctaText, 40),
    ctaUrl: link(o.ctaUrl),
    trigger: oneOf(o.trigger, POPUP_TRIGGERS, 'load'),
    delaySeconds: num(o.delaySeconds, 0, 120, 5),
    scrollPercent: num(o.scrollPercent, 1, 100, 50),
    // Match the widget's own floor of 5 seconds, so a value it would raise cannot
    // be stored looking lower than it will behave.
    inactivitySeconds: num(o.inactivitySeconds, 5, 600, 30),
    pageviews: num(o.pageviews, 1, 50, 2),
    clickSelector: cssSelector(o.clickSelector),
    frequency: oneOf(o.frequency, POPUP_FREQUENCIES, 'session'),
    frequencyDays: num(o.frequencyDays, 1, 90, 7),
    pageMode: oneOf(o.pageMode, POPUP_PAGE_MODES, 'all'),
    pagePaths: pathList(o.pagePaths),
    brand: colour(o.brand, '#1B2B5B'),
    accent: colour(o.accent, '#00B4D8'),
    overlay: bool(o.overlay, true),
    audience: parseAudience(o.audience),
  };
}

// ---------------------------------------------------------------------------
// The whole set
// ---------------------------------------------------------------------------

export interface FloatingWidgetsSettings {
  backToTop: BackToTopSettings;
  whatsapp: WhatsAppSettings;
  dealBar: DealBarSettings;
  loader: LoaderSettings;
  popup: PopupSettings;
}

export const DEFAULT_FLOATING_WIDGETS: FloatingWidgetsSettings = {
  backToTop: DEFAULT_BACK_TO_TOP,
  whatsapp: DEFAULT_WHATSAPP,
  dealBar: DEFAULT_DEAL_BAR,
  loader: DEFAULT_LOADER,
  popup: DEFAULT_POPUP,
};

/** Total: nonsense in, defaults out, never a throw. */
export function parseFloatingWidgets(value: unknown): FloatingWidgetsSettings {
  const o = asObject(value);
  return {
    backToTop: parseBackToTop(o.backToTop),
    whatsapp: parseWhatsApp(o.whatsapp),
    dealBar: parseDealBar(o.dealBar),
    loader: parseLoader(o.loader),
    popup: parsePopup(o.popup),
  };
}

// ---------------------------------------------------------------------------
// What the shell emits
// ---------------------------------------------------------------------------

/** One enabled widget: its tag, and the config object to emit as data-tg-config. */
export interface EnabledFloatingWidget {
  tag: FloatingWidgetTag;
  config: Record<string, unknown>;
  /**
   * Who this widget is for, resolved SERVER-SIDE by FloatingWidgets: a widget the
   * visitor fails is not emitted at all. Only the popup exposes it today. Absent
   * means everyone, exactly as an unruled section shows to everyone.
   */
  audience?: Audience;
}

/**
 * The widgets to draw on a page, each shaped into the config its own script
 * expects. Only enabled ones, and only when they have what they need: a WhatsApp
 * button with no number is not a button, so it is left off rather than shipped
 * dead. The forced values (WhatsApp's floating single-agent layout) are set
 * here, not offered as choices, because the panel only exposes the floating use.
 */
export function enabledFloatingWidgets(fw: FloatingWidgetsSettings): EnabledFloatingWidget[] {
  const out: EnabledFloatingWidget[] = [];

  const b = fw.backToTop;
  if (b.enabled) {
    out.push({
      tag: 'backtotop',
      config: {
        showAfter: b.showAfter,
        position: b.position,
        offset: b.offset,
        shape: b.shape,
        size: b.size,
        accent: b.accent,
        icon: b.icon,
        showLabel: b.showLabel,
        labelText: b.labelText,
        smoothScroll: b.smoothScroll,
        shadow: b.shadow,
      },
    });
  }

  const w = fw.whatsapp;
  if (w.enabled && w.phone) {
    out.push({
      tag: 'whatsapp',
      config: {
        layout: 'floating',
        mode: 'single',
        phone: w.phone,
        message: w.message,
        position: w.position,
        greetingEnabled: w.greetingEnabled,
        greetingText: w.greetingText,
        greetingDelay: w.greetingDelay,
        theme: { brand: w.brand },
      },
    });
  }

  const d = fw.dealBar;
  if (d.enabled) {
    out.push({
      tag: 'dealbar',
      config: {
        message: d.message,
        emoji: d.emoji,
        position: d.position,
        bg: d.bg,
        ctaShow: d.ctaShow,
        ctaLabel: d.ctaLabel,
        ctaUrl: d.ctaUrl,
        ctaNewTab: d.ctaNewTab,
        ctaBg: d.ctaBg,
        showCountdown: d.showCountdown,
        countdownTo: d.countdownTo,
        sticky: d.sticky,
        pushPage: d.pushPage,
        dismissible: d.dismissible,
        rememberDismiss: d.rememberDismiss,
        startAt: d.startAt,
        endAt: d.endAt,
      },
    });
  }

  const l = fw.loader;
  if (l.enabled) {
    out.push({
      tag: 'loader',
      config: {
        template: l.template,
        colors: { primary: l.primary, secondary: l.secondary, track: l.track },
        background: l.background,
        label: l.label,
        labelColor: l.labelColor,
      },
    });
  }

  const p = fw.popup;
  if (p.enabled) {
    out.push({
      tag: 'popup',
      // Gated server-side in FloatingWidgets, so a popup targeted at, say, UK
      // returning visitors is simply not emitted for anyone else.
      audience: p.audience,
      config: {
        // The panel exposes the announcement use; the widget's other content
        // types (email capture, discount, video) keep their defaults.
        contentType: 'announcement',
        layout: p.layout,
        title: p.title,
        body: p.body,
        image: p.image,
        ctaText: p.ctaText,
        ctaUrl: p.ctaUrl,
        trigger: p.trigger,
        // The widget takes the delay in milliseconds, and only for the 'time'
        // trigger; a scroll or exit popup ignores it.
        triggerDelay: p.trigger === 'time' ? p.delaySeconds * 1000 : 0,
        triggerScrollPercent: p.scrollPercent,
        // The widget reads only the field its active trigger needs, so the two
        // numbers travel always (like the scroll percent) and the selector only
        // for a click trigger, where an empty one would silently never fire.
        triggerInactivitySeconds: p.inactivitySeconds,
        triggerPageviews: p.pageviews,
        triggerSelector: p.trigger === 'click' ? p.clickSelector : '',
        frequency: p.frequency,
        frequencyDays: p.frequencyDays,
        // The page rule, as the widget's own two lists: the chosen mode fills one
        // and leaves the other empty, and 'all' leaves both empty (show everywhere).
        // Blanks are filtered here as well as in the parser, because the editor's
        // live preview emits straight from the in-memory settings, where a path
        // the client is still typing can be an empty line, and an empty pattern
        // matches every page (startsWith '') which would quietly mean "everywhere".
        pageInclude: p.pageMode === 'include' ? p.pagePaths.filter(Boolean) : [],
        pageExclude: p.pageMode === 'exclude' ? p.pagePaths.filter(Boolean) : [],
        brand: p.brand,
        accent: p.accent,
        overlay: p.overlay,
      },
    });
  }

  return out;
}
