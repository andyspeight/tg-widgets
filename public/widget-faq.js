/**
 * Travelgenix FAQ Widget v1.0.0
 * Self-contained, embeddable FAQ / accordion widget.
 * Zero dependencies — works on any website via a single script tag.
 *
 * Features
 *  - 4 layouts: accordion, two-column, tabs (categorised), searchable
 *  - Live client-side search with match highlighting
 *  - Category filtering (tabs / chips)
 *  - Markdown-lite answers (bold, italic, lists, safe links)
 *  - FAQPage JSON-LD schema injection for SEO rich results
 *  - Deep-link support (#faq-slug opens and scrolls to a question)
 *  - Dark mode (`theme: "dark"`)
 *  - Respects prefers-reduced-motion
 *  - Fully responsive from 320px upwards
 *  - ARIA-compliant disclosure pattern, keyboard accessible
 *
 * Usage (remote config):
 *   <div data-tg-widget="faq" data-tg-id="YOUR_WIDGET_ID"></div>
 *   <script src="https://tg-widgets.vercel.app/widget-faq.js"></script>
 *
 * Usage (inline config):
 *   <div data-tg-widget="faq" data-tg-config='{"questions":[...]}'></div>
 *   <script src="https://tg-widgets.vercel.app/widget-faq.js"></script>
 */
(function () {
  'use strict';

  const API_BASE = (typeof window !== 'undefined' && window.__TG_WIDGET_API__) || '/api/widget-config';
  const VERSION = '1.0.0';

  /* ------------------------------------------------------------------
   * Icon library — inline SVG path strings (no external deps).
   * Keep a tight, consistent Lucide-style set.
   * ------------------------------------------------------------------ */
  const IC = {
    chevron:     '<path d="M6 9l6 6 6-6"/>',
    search:      '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
    x:           '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
    plus:        '<path d="M12 5v14M5 12h14"/>',
    minus:       '<path d="M5 12h14"/>',
    'arrow-right': '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
    help:        '<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>',
    info:        '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
    book:        '<path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"/>',
    calendar:    '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
    'credit-card':'<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/>',
    'map-pin':   '<path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3"/>',
    plane:       '<path d="M17.8 19.2 16 11l3.5-3.5c.5-.5 1-2.5.5-3-1-.5-3 0-3.5.5L13 8.5 4.8 6.5c-.5-.1-.9.2-.9.7v.4c0 .3.2.6.5.8L8 10.5 6 14H3l-.5 1.5L5 17l1.5 2.5L8 19v-3l3.5-2 2.8 3.5c.2.3.5.5.8.5h.4c.5 0 .8-.4.7-.9z"/>',
    luggage:     '<rect x="6" y="8" width="12" height="13" rx="2"/><path d="M10 8V4h4v4M9 12h6M9 16h6"/>',
    users:       '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
    shield:      '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/>',
    heart:       '<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7z"/>',
    globe:       '<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>',
    clock:       '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
    phone:       '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.9.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/>',
    mail:        '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-8.97 5.7a2 2 0 0 1-2.06 0L2 7"/>',
    message:     '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
    star:        '<path d="M11.52 2.64a.5.5 0 0 1 .96 0l2.14 6.58h6.92a.5.5 0 0 1 .3.91l-5.6 4.07 2.14 6.58a.5.5 0 0 1-.78.56L12 17.27l-5.6 4.07a.5.5 0 0 1-.78-.56l2.14-6.58-5.6-4.07a.5.5 0 0 1 .3-.91h6.92z"/>',
    sparkles:    '<path d="M12 3l1.9 4.7L18.6 9.6l-4.7 1.9L12 16.2 10.1 11.5 5.4 9.6 10.1 7.7z"/><path d="M5 16l.8 2.2 2.2.8-2.2.8L5 22l-.8-2.2L2 19l2.2-.8z"/>',
    check:       '<path d="M20 6 9 17l-5-5"/>',
    'list':      '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
    'external':  '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>'
  };

  function icon(name, size) {
    const path = IC[name] || IC.help;
    const s = size || 18;
    return '<svg xmlns="http://www.w3.org/2000/svg" width="' + s + '" height="' + s +
           '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"' +
           ' stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + path + '</svg>';
  }

  /* ------------------------------------------------------------------
   * CSS — everything lives inside the Shadow DOM.
   * Uses CSS custom properties for all theming.
   * ------------------------------------------------------------------ */
  const STYLES = `
    :host { all: initial; display: block; box-sizing: border-box; }
    :host *, :host *::before, :host *::after { box-sizing: border-box; }

    .tgf-root {
      --tgf-brand: #0891B2;
      --tgf-accent: #6366F1;
      --tgf-bg: #F8FAFC;
      --tgf-card: #FFFFFF;
      --tgf-text: #0F172A;
      --tgf-sub: #64748B;
      --tgf-muted: #94A3B8;
      --tgf-border: #E2E8F0;
      --tgf-brand-soft: rgba(8,145,178,0.10);
      --tgf-accent-soft: rgba(99,102,241,0.15);
      --tgf-radius: 16px;
      --tgf-radius-sm: 10px;
      --tgf-radius-xs: 6px;
      --tgf-shadow-sm: 0 1px 2px rgba(15,23,42,0.04), 0 1px 3px rgba(15,23,42,0.06);
      --tgf-shadow-md: 0 4px 12px rgba(15,23,42,0.06), 0 2px 4px rgba(15,23,42,0.04);

      font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      color: var(--tgf-text);
      background: var(--tgf-bg);
      padding: 28px;
      border-radius: var(--tgf-radius);
      line-height: 1.5;
      -webkit-font-smoothing: antialiased;
      -moz-osx-font-smoothing: grayscale;
    }

    .tgf-root[data-theme="dark"] {
      --tgf-bg: #0F172A;
      --tgf-card: #1E293B;
      --tgf-text: #F1F5F9;
      --tgf-sub: #CBD5E1;
      --tgf-muted: #64748B;
      --tgf-border: #334155;
    }

    /* Header */
    .tgf-header { text-align: center; max-width: 620px; margin: 0 auto 28px; }
    .tgf-title { margin: 0 0 8px; font-size: 28px; font-weight: 700; letter-spacing: -0.015em; color: var(--tgf-text); line-height: 1.2; }
    .tgf-subtitle { margin: 0; font-size: 16px; color: var(--tgf-sub); line-height: 1.5; }

    /* Toolbar */
    .tgf-toolbar { display: flex; gap: 12px; margin-bottom: 20px; flex-wrap: wrap; align-items: stretch; }

    /* Search */
    .tgf-search { position: relative; flex: 1; min-width: 240px; }
    .tgf-search-input {
      width: 100%; height: 44px;
      padding: 0 40px 0 42px;
      border: 1px solid var(--tgf-border);
      border-radius: var(--tgf-radius-sm);
      background: var(--tgf-card);
      color: var(--tgf-text);
      font-size: 15px; font-family: inherit;
      outline: none;
      transition: border-color 150ms ease-out, box-shadow 150ms ease-out;
    }
    .tgf-search-input::placeholder { color: var(--tgf-muted); }
    .tgf-search-input:hover { border-color: var(--tgf-muted); }
    .tgf-search-input:focus { border-color: var(--tgf-brand); box-shadow: 0 0 0 3px var(--tgf-brand-soft); }
    .tgf-search-icon {
      position: absolute; left: 14px; top: 50%; transform: translateY(-50%);
      color: var(--tgf-muted); pointer-events: none;
      display: flex; align-items: center;
    }
    .tgf-search-clear {
      position: absolute; right: 8px; top: 50%; transform: translateY(-50%);
      width: 28px; height: 28px; padding: 0;
      border: 0; background: transparent; color: var(--tgf-muted);
      border-radius: var(--tgf-radius-xs); cursor: pointer;
      display: none; align-items: center; justify-content: center;
      transition: background 150ms, color 150ms;
    }
    .tgf-search-clear:hover { background: var(--tgf-border); color: var(--tgf-text); }
    .tgf-search.has-value .tgf-search-clear { display: flex; }

    /* Expand-all button */
    .tgf-expand-btn {
      height: 44px; padding: 0 16px;
      border: 1px solid var(--tgf-border); background: var(--tgf-card); color: var(--tgf-text);
      border-radius: var(--tgf-radius-sm);
      font-size: 14px; font-weight: 500; font-family: inherit;
      cursor: pointer; display: inline-flex; align-items: center; gap: 8px;
      transition: background 150ms, border-color 150ms, color 150ms;
      white-space: nowrap;
    }
    .tgf-expand-btn:hover { background: var(--tgf-bg); border-color: var(--tgf-brand); color: var(--tgf-brand); }
    .tgf-expand-btn:focus-visible { outline: 2px solid var(--tgf-brand); outline-offset: 2px; }

    /* Tabs (layout: tabs) */
    .tgf-tabs {
      display: flex; gap: 4px;
      border-bottom: 1px solid var(--tgf-border);
      margin-bottom: 20px;
      overflow-x: auto; -webkit-overflow-scrolling: touch;
      scrollbar-width: none;
    }
    .tgf-tabs::-webkit-scrollbar { display: none; }
    .tgf-tab {
      padding: 12px 18px;
      border: 0; background: transparent;
      color: var(--tgf-sub); font-size: 14px; font-weight: 500; font-family: inherit;
      cursor: pointer; position: relative; white-space: nowrap;
      display: inline-flex; align-items: center; gap: 8px;
      border-bottom: 2px solid transparent;
      margin-bottom: -1px;
      transition: color 150ms;
    }
    .tgf-tab:hover { color: var(--tgf-text); }
    .tgf-tab:focus-visible { outline: 2px solid var(--tgf-brand); outline-offset: -2px; border-radius: var(--tgf-radius-xs); }
    .tgf-tab[aria-selected="true"] { color: var(--tgf-brand); border-bottom-color: var(--tgf-brand); }
    .tgf-tab-count {
      display: inline-flex; align-items: center; justify-content: center;
      min-width: 20px; height: 20px; padding: 0 6px;
      font-size: 11px; font-weight: 600;
      background: var(--tgf-border); color: var(--tgf-sub);
      border-radius: 10px;
    }
    .tgf-tab[aria-selected="true"] .tgf-tab-count { background: var(--tgf-brand); color: #fff; }

    /* Chips (layout: searchable) */
    .tgf-chips { display: flex; gap: 8px; margin-bottom: 16px; flex-wrap: wrap; }
    .tgf-chip {
      padding: 7px 14px;
      border: 1px solid var(--tgf-border); background: var(--tgf-card); color: var(--tgf-sub);
      border-radius: 9999px;
      font-size: 13px; font-weight: 500; font-family: inherit;
      cursor: pointer;
      transition: all 150ms;
    }
    .tgf-chip:hover { color: var(--tgf-text); border-color: var(--tgf-muted); }
    .tgf-chip:focus-visible { outline: 2px solid var(--tgf-brand); outline-offset: 2px; }
    .tgf-chip[aria-pressed="true"] { background: var(--tgf-brand); color: #fff; border-color: var(--tgf-brand); }

    /* List container */
    .tgf-list { display: flex; flex-direction: column; gap: 10px; }
    /* Two-column layout: each column is an independent flex stack so opening
       an item in one column does NOT push items in the other column down. */
    .tgf-list--two-col { display: flex; flex-direction: column; gap: 10px; }
    .tgf-list--two-col .tgf-col { display: flex; flex-direction: column; gap: 10px; }
    @media (min-width: 900px) {
      .tgf-list--two-col { flex-direction: row; gap: 16px; align-items: flex-start; }
      .tgf-list--two-col .tgf-col { flex: 1 1 0; min-width: 0; }
    }

    /* Item */
    .tgf-item {
      background: var(--tgf-card);
      border: 1px solid var(--tgf-border);
      border-radius: var(--tgf-radius-sm);
      overflow: hidden;
      transition: border-color 150ms ease-out, box-shadow 150ms ease-out;
    }
    .tgf-item:hover { border-color: var(--tgf-muted); }
    .tgf-item[data-open="true"] {
      border-color: var(--tgf-brand);
      box-shadow: var(--tgf-shadow-sm);
    }

    .tgf-question {
      width: 100%; min-height: 60px;
      padding: 16px 18px;
      background: transparent;
      border: 0;
      text-align: left;
      font-size: 15px; font-weight: 600;
      color: var(--tgf-text);
      font-family: inherit;
      cursor: pointer;
      display: flex; align-items: center; gap: 14px;
      line-height: 1.4;
      transition: background 120ms;
    }
    .tgf-question:hover { background: var(--tgf-bg); }
    .tgf-question:focus-visible { outline: 2px solid var(--tgf-brand); outline-offset: -2px; border-radius: var(--tgf-radius-sm); }

    .tgf-q-icon {
      flex-shrink: 0;
      width: 36px; height: 36px;
      border-radius: var(--tgf-radius-xs);
      background: var(--tgf-brand-soft);
      color: var(--tgf-brand);
      display: flex; align-items: center; justify-content: center;
    }

    .tgf-q-text { flex: 1; min-width: 0; }

    .tgf-q-badges { display: inline-flex; gap: 6px; margin-left: 8px; vertical-align: 2px; }
    .tgf-badge {
      display: inline-flex; align-items: center; gap: 4px;
      padding: 2px 8px;
      font-size: 11px; font-weight: 600; letter-spacing: 0.01em;
      border-radius: 10px;
    }
    .tgf-badge--popular { background: var(--tgf-accent-soft); color: var(--tgf-accent); }
    .tgf-badge--pinned  { background: var(--tgf-brand-soft); color: var(--tgf-brand); }

    .tgf-chevron {
      flex-shrink: 0;
      display: flex; align-items: center; justify-content: center;
      color: var(--tgf-sub);
      transition: transform 250ms ease-out, color 150ms;
    }
    .tgf-item[data-open="true"] .tgf-chevron {
      transform: rotate(180deg);
      color: var(--tgf-brand);
    }

    /* Answer — grid-rows trick for smooth height animation */
    .tgf-answer {
      display: grid;
      grid-template-rows: 0fr;
      transition: grid-template-rows 280ms cubic-bezier(0.4, 0, 0.2, 1);
    }
    .tgf-item[data-open="true"] .tgf-answer { grid-template-rows: 1fr; }
    .tgf-answer-outer { overflow: hidden; min-height: 0; }
    .tgf-answer-body {
      padding: 4px 18px 18px 68px;
      color: var(--tgf-sub);
      font-size: 15px; line-height: 1.65;
    }
    @media (max-width: 600px) {
      .tgf-answer-body { padding: 4px 16px 16px 16px; }
    }

    .tgf-answer-body > *:first-child { margin-top: 0; }
    .tgf-answer-body > *:last-child { margin-bottom: 0; }
    .tgf-answer-body p { margin: 0 0 12px; }
    .tgf-answer-body ul, .tgf-answer-body ol { margin: 0 0 12px; padding-left: 22px; }
    .tgf-answer-body li { margin-bottom: 6px; }
    .tgf-answer-body li:last-child { margin-bottom: 0; }
    .tgf-answer-body strong { color: var(--tgf-text); font-weight: 600; }
    .tgf-answer-body em { font-style: italic; }
    .tgf-answer-body a {
      color: var(--tgf-brand); text-decoration: underline;
      text-decoration-thickness: 1px; text-underline-offset: 3px;
      font-weight: 500;
    }
    .tgf-answer-body a:hover { text-decoration-thickness: 2px; }
    .tgf-answer-body a:focus-visible { outline: 2px solid var(--tgf-brand); outline-offset: 2px; border-radius: 2px; }

    mark {
      background: var(--tgf-accent-soft);
      color: inherit;
      padding: 1px 3px;
      border-radius: 3px;
      font-weight: inherit;
    }

    .tgf-updated {
      display: block; margin-top: 14px;
      font-size: 12px; color: var(--tgf-muted);
    }

    /* Empty state */
    .tgf-empty {
      text-align: center;
      padding: 56px 20px;
      background: var(--tgf-card);
      border: 1px dashed var(--tgf-border);
      border-radius: var(--tgf-radius-sm);
    }
    .tgf-empty-icon {
      display: inline-flex; align-items: center; justify-content: center;
      width: 56px; height: 56px;
      border-radius: 9999px;
      background: var(--tgf-bg);
      color: var(--tgf-muted);
      margin: 0 auto 14px;
    }
    .tgf-empty-title { margin: 0 0 6px; font-size: 16px; font-weight: 600; color: var(--tgf-text); }
    .tgf-empty-text { margin: 0; font-size: 14px; color: var(--tgf-sub); }

    /* CTA */
    .tgf-cta {
      margin-top: 28px;
      padding: 22px 24px;
      background: var(--tgf-card);
      border: 1px solid var(--tgf-border);
      border-radius: var(--tgf-radius-sm);
      display: flex; align-items: center; gap: 20px; flex-wrap: wrap;
    }
    .tgf-cta--strip { padding: 14px 18px; }
    .tgf-cta--gradient {
      background: linear-gradient(135deg, var(--tgf-brand-soft), var(--tgf-accent-soft));
      border-color: transparent;
    }
    .tgf-cta-copy { flex: 1; min-width: 220px; }
    .tgf-cta-title { margin: 0 0 4px; font-size: 16px; font-weight: 600; color: var(--tgf-text); }
    .tgf-cta-desc { margin: 0; font-size: 14px; color: var(--tgf-sub); line-height: 1.5; }
    .tgf-cta-btn {
      display: inline-flex; align-items: center; gap: 8px;
      padding: 0 20px; height: 44px;
      background: var(--tgf-brand); color: #fff;
      border: 0; border-radius: var(--tgf-radius-sm);
      font-size: 14px; font-weight: 600; font-family: inherit;
      text-decoration: none; cursor: pointer; white-space: nowrap;
      transition: filter 150ms, transform 100ms;
    }
    .tgf-cta-btn:hover { filter: brightness(1.08); }
    .tgf-cta-btn:active { transform: translateY(1px); }
    .tgf-cta-btn:focus-visible { outline: 2px solid var(--tgf-brand); outline-offset: 2px; }

    /* Responsive */
    @media (max-width: 640px) {
      .tgf-root { padding: 20px 16px; }
      .tgf-title { font-size: 22px; }
      .tgf-subtitle { font-size: 14px; }
      .tgf-question { padding: 14px; gap: 12px; font-size: 15px; }
      .tgf-q-icon { width: 32px; height: 32px; }
      .tgf-q-badges { display: none; }
      .tgf-cta { padding: 18px; flex-direction: column; align-items: stretch; text-align: center; }
      .tgf-cta-copy { min-width: 0; }
      .tgf-cta-btn { justify-content: center; }
      .tgf-toolbar { flex-direction: column; }
    }

    /* Reduced motion */
    @media (prefers-reduced-motion: reduce) {
      .tgf-answer { transition: none; }
      .tgf-chevron { transition: none; }
      .tgf-item, .tgf-tab, .tgf-chip, .tgf-question, .tgf-search-input, .tgf-expand-btn, .tgf-cta-btn {
        transition: none !important;
      }
    }

    /* Print */
    @media print {
      .tgf-toolbar, .tgf-tabs, .tgf-chips, .tgf-cta, .tgf-chevron { display: none !important; }
      .tgf-item { border-color: #ccc !important; page-break-inside: avoid; }
      .tgf-answer { grid-template-rows: 1fr !important; }
    }
  `;

  /* ------------------------------------------------------------------
   * Helpers
   * ------------------------------------------------------------------ */
  function esc(v) {
    if (v == null) return '';
    return String(v)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function slugify(s) {
    if (!s) return '';
    return String(s).toLowerCase()
      .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^\w\s-]/g, '')
      .trim()
      .replace(/\s+/g, '-')
      .slice(0, 64);
  }

  function hexToRgba(hex, alpha) {
    if (!hex) return '';
    let h = String(hex).trim().replace('#', '');
    if (h.length === 3) h = h.split('').map(c => c + c).join('');
    if (!/^[0-9a-f]{6}$/i.test(h)) return '';
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
  }

  function isSafeUrl(url) {
    if (!url) return false;
    return /^(https?:\/\/|mailto:|tel:|#|\/)/i.test(url);
  }

  function escapeRegExp(s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * Convert markdown-lite input to safe HTML.
   * Supports: **bold**, *italic*, [text](url), hyphen-lists, numbered lists,
   * paragraphs separated by blank lines, and hard line breaks.
   * Everything is escape()'d first so only allow-listed markup can ever
   * reach the DOM. Returns HTML as a string.
   */
  function mdToHTML(md) {
    if (!md) return '';
    let s = esc(md);

    // Inline links [text](url) — must come before bold/italic to protect URLs.
    s = s.replace(/\[([^\]\n]+?)\]\(([^)\s]+?)\)/g, function (m, text, url) {
      if (!isSafeUrl(url)) return text;
      // url is already esc()-ed
      return '<a href="' + url + '" target="_blank" rel="noopener noreferrer">' + text + '</a>';
    });

    // Bold **text**
    s = s.replace(/\*\*([^*\n]+?)\*\*/g, '<strong>$1</strong>');

    // Italic *text* (single asterisks, not adjacent to word chars)
    s = s.replace(/(^|[\s(])\*([^*\n]+?)\*(?=[\s.,;:!?)]|$)/g, '$1<em>$2</em>');

    // Line-based list parsing
    const lines = s.split('\n');
    const out = [];
    let listType = null;
    const flushList = function () { if (listType) { out.push('</' + listType + '>'); listType = null; } };

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const ulMatch = /^[ \t]*[-•][ \t]+(.+)$/.exec(line);
      const olMatch = /^[ \t]*\d+\.[ \t]+(.+)$/.exec(line);
      if (ulMatch) {
        if (listType !== 'ul') { flushList(); out.push('<ul>'); listType = 'ul'; }
        out.push('<li>' + ulMatch[1] + '</li>');
      } else if (olMatch) {
        if (listType !== 'ol') { flushList(); out.push('<ol>'); listType = 'ol'; }
        out.push('<li>' + olMatch[1] + '</li>');
      } else {
        flushList();
        out.push(line);
      }
    }
    flushList();

    // Paragraphs: split on blank lines, wrap loose text in <p>, preserve single linebreaks as <br>
    const combined = out.join('\n');
    const blocks = combined.split(/\n{2,}/);
    const html = blocks.map(function (block) {
      const b = block.trim();
      if (!b) return '';
      if (/^<(ul|ol|p|h[1-6]|blockquote)/i.test(b)) return b;
      return '<p>' + b.replace(/\n/g, '<br>') + '</p>';
    }).filter(Boolean).join('');
    return html;
  }

  // Strip markdown and HTML for plain-text schema output
  function toPlain(md) {
    if (!md) return '';
    return String(md)
      .replace(/\*\*/g, '')
      .replace(/(^|[\s(])\*([^*\n]+?)\*/g, '$1$2')
      .replace(/\[([^\]]+?)\]\(([^)]+?)\)/g, '$1 ($2)')
      .replace(/^[ \t]*[-•][ \t]+/gm, '• ')
      .replace(/^[ \t]*\d+\.[ \t]+/gm, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  /* ------------------------------------------------------------------
   * Widget class
   * ------------------------------------------------------------------ */
  class TGFaqWidget {
    constructor(container, config) {
      this.el = container;
      this.c = this._defaults(config);
      this.widgetId = container.getAttribute('data-tg-id') ||
        ('faq_' + Math.random().toString(36).slice(2, 10));
      this.shadow = container.attachShadow({ mode: 'open' });
      this.state = {
        query: '',
        activeCategory: 'all',
        openItems: new Set(),
        allExpanded: false
      };
      this._prepareQuestions();
      this._initialOpen();
      this._render();
      this._handleDeepLink();
      this._injectSchema();
    }

    _defaults(c) {
      const base = {
        layout: 'accordion',               // 'accordion' | 'two-column' | 'tabs' | 'searchable'
        theme: 'light',                    // 'light' | 'dark'
        colors: {
          brand: '#0891B2',
          accent: '#6366F1',
          bg: '#F8FAFC',
          card: '#FFFFFF',
          text: '#0F172A',
          sub: '#64748B',
          border: '#E2E8F0'
        },
        radius: 12,
        heading: {
          show: true,
          title: 'Frequently asked questions',
          subtitle: 'Everything you need to know before you book.'
        },
        search: {
          enabled: true,
          placeholder: 'Search questions…',
          noResultsText: 'No questions match that search'
        },
        showIcons: true,
        showExpandAll: true,
        expandBehavior: 'multiple',        // 'single' | 'multiple'
        showUpdated: false,
        defaultOpen: 0,                    // index of question to open initially, -1 for none
        categories: [],                    // [{ id, label, icon }]
        questions: [],                     // [{ id, question, answer, category, popular, pinned, hidden, icon, updatedAt }]
        cta: {
          enabled: true,
          style: 'card',                   // 'card' | 'strip' | 'gradient'
          heading: 'Still got a question?',
          description: "Our team is here to help — drop us a line and we'll reply within one working day.",
          buttonText: 'Contact us',
          buttonUrl: '#'
        },
        seo: {
          enableSchema: true
        },
        fontFamily: ''   // empty = use Inter
      };
      const merged = Object.assign({}, base, c || {});
      merged.colors = Object.assign({}, base.colors, (c && c.colors) || {});
      merged.heading = Object.assign({}, base.heading, (c && c.heading) || {});
      merged.search = Object.assign({}, base.search, (c && c.search) || {});
      merged.cta = Object.assign({}, base.cta, (c && c.cta) || {});
      merged.seo = Object.assign({}, base.seo, (c && c.seo) || {});
      return merged;
    }

    _prepareQuestions() {
      // Ensure every question has a stable id
      (this.c.questions || []).forEach((q, idx) => {
        if (!q.id) q.id = 'q_' + idx + '_' + slugify(q.question || 'item').slice(0, 20);
      });
    }

    _initialOpen() {
      const idx = this.c.defaultOpen;
      if (typeof idx === 'number' && idx >= 0) {
        const visible = this._visibleQuestions();
        if (visible[idx]) this.state.openItems.add(visible[idx].id);
      }
    }

    _visibleQuestions() {
      return (this.c.questions || []).filter(q => !q.hidden);
    }

    _filteredQuestions() {
      let qs = this._visibleQuestions();

      // Category filter (tabs / chips layouts)
      if ((this.c.layout === 'tabs' || this.c.layout === 'searchable') &&
          this.state.activeCategory && this.state.activeCategory !== 'all') {
        qs = qs.filter(q => q.category === this.state.activeCategory);
      }

      // Search filter
      if (this.state.query) {
        const q = this.state.query.toLowerCase();
        qs = qs.filter(item =>
          String(item.question || '').toLowerCase().includes(q) ||
          String(item.answer || '').toLowerCase().includes(q)
        );
      }

      // Sort: pinned → popular → original order
      return qs.slice().map((q, i) => ({ q, i })).sort((a, b) => {
        if (a.q.pinned !== b.q.pinned) return a.q.pinned ? -1 : 1;
        if (a.q.popular !== b.q.popular) return a.q.popular ? -1 : 1;
        return a.i - b.i;
      }).map(x => x.q);
    }

    _categoryIcon(catId) {
      const cat = (this.c.categories || []).find(c => c.id === catId);
      return (cat && cat.icon) || null;
    }

    _customStyles() {
      const c = this.c.colors || {};
      const brandSoft = hexToRgba(c.brand, 0.10) || 'rgba(8,145,178,0.10)';
      const accentSoft = hexToRgba(c.accent, 0.15) || 'rgba(99,102,241,0.15)';
      const radius = Math.max(0, parseInt(this.c.radius, 10) || 12);
      // Optional font override — when fontFamily is set, override the host's
      // hardcoded Inter stack. .tgf-root cascades to descendants and beats
      // :host because root is more specific.
      const fontRule = (this.c.fontFamily && typeof this.c.fontFamily === 'string')
        ? `font-family: '${esc(this.c.fontFamily.replace(/'/g, ''))}', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;`
        : '';
      return `.tgf-root {
        --tgf-brand: ${esc(c.brand || '#0891B2')};
        --tgf-accent: ${esc(c.accent || '#6366F1')};
        --tgf-bg: ${esc(c.bg || '#F8FAFC')};
        --tgf-card: ${esc(c.card || '#FFFFFF')};
        --tgf-text: ${esc(c.text || '#0F172A')};
        --tgf-sub: ${esc(c.sub || '#64748B')};
        --tgf-border: ${esc(c.border || '#E2E8F0')};
        --tgf-brand-soft: ${brandSoft};
        --tgf-accent-soft: ${accentSoft};
        --tgf-radius: ${radius + 4}px;
        --tgf-radius-sm: ${Math.max(4, radius - 2)}px;
        ${fontRule}
      }`;
    }

    _render() {
      const html = '<style>' + STYLES + this._customStyles() + '</style>' + this._renderRoot();
      this.shadow.innerHTML = html;
      this._bind();
    }

    _renderRoot() {
      const layout = this.c.layout;
      const themeAttr = this.c.theme === 'dark' ? ' data-theme="dark"' : '';
      return `<div class="tgf-root" data-layout="${esc(layout)}"${themeAttr}>
        ${this._renderHeader()}
        ${this._renderToolbar()}
        ${this._renderBody()}
        ${this._renderCTA()}
      </div>`;
    }

    _renderHeader() {
      const h = this.c.heading;
      if (!h || !h.show) return '';
      const title = h.title ? `<h2 class="tgf-title">${esc(h.title)}</h2>` : '';
      const sub = h.subtitle ? `<p class="tgf-subtitle">${esc(h.subtitle)}</p>` : '';
      if (!title && !sub) return '';
      return `<div class="tgf-header">${title}${sub}</div>`;
    }

    _renderToolbar() {
      const layout = this.c.layout;
      const showSearch = !!(this.c.search && this.c.search.enabled) &&
                        (layout === 'accordion' || layout === 'two-column' || layout === 'searchable');
      const showExpand = !!this.c.showExpandAll &&
                        layout !== 'searchable' &&
                        this.c.expandBehavior === 'multiple';
      if (!showSearch && !showExpand) return '';
      return `<div class="tgf-toolbar">
        ${showSearch ? this._renderSearch() : ''}
        ${showExpand ? this._renderExpandBtn() : ''}
      </div>`;
    }

    _renderSearch() {
      const placeholder = (this.c.search && this.c.search.placeholder) || 'Search questions…';
      const hasValue = this.state.query ? ' has-value' : '';
      return `<div class="tgf-search${hasValue}">
        <span class="tgf-search-icon">${icon('search', 18)}</span>
        <input class="tgf-search-input" type="search" placeholder="${esc(placeholder)}" value="${esc(this.state.query)}" aria-label="Search questions" spellcheck="false" autocomplete="off">
        <button class="tgf-search-clear" type="button" aria-label="Clear search">${icon('x', 16)}</button>
      </div>`;
    }

    _renderExpandBtn() {
      const label = this.state.allExpanded ? 'Collapse all' : 'Expand all';
      const iconName = this.state.allExpanded ? 'minus' : 'plus';
      return `<button class="tgf-expand-btn" type="button" data-expand-all>
        ${icon(iconName, 16)} ${esc(label)}
      </button>`;
    }

    _renderBody() {
      const layout = this.c.layout;
      if (layout === 'tabs') return this._renderTabs() + this._renderList();
      if (layout === 'searchable') return this._renderChips() + this._renderList();
      return this._renderList();
    }

    _renderTabs() {
      const cats = this.c.categories || [];
      if (!cats.length) return '';
      const visible = this._visibleQuestions();
      return `<div class="tgf-tabs" role="tablist">
        <button class="tgf-tab" role="tab" data-cat="all" aria-selected="${this.state.activeCategory === 'all'}">All <span class="tgf-tab-count">${visible.length}</span></button>
        ${cats.map(cat => {
          const count = visible.filter(q => q.category === cat.id).length;
          const selected = this.state.activeCategory === cat.id;
          return `<button class="tgf-tab" role="tab" data-cat="${esc(cat.id)}" aria-selected="${selected}">${esc(cat.label)} <span class="tgf-tab-count">${count}</span></button>`;
        }).join('')}
      </div>`;
    }

    _renderChips() {
      const cats = this.c.categories || [];
      if (!cats.length) return '';
      return `<div class="tgf-chips" role="group" aria-label="Filter by category">
        <button class="tgf-chip" type="button" data-cat="all" aria-pressed="${this.state.activeCategory === 'all'}">All</button>
        ${cats.map(cat => {
          const pressed = this.state.activeCategory === cat.id;
          return `<button class="tgf-chip" type="button" data-cat="${esc(cat.id)}" aria-pressed="${pressed}">${esc(cat.label)}</button>`;
        }).join('')}
      </div>`;
    }

    _renderList() {
      const qs = this._filteredQuestions();
      const listClass = this.c.layout === 'two-column' ? 'tgf-list tgf-list--two-col' : 'tgf-list';

      if (!qs.length) {
        const noResultsText = (this.c.search && this.c.search.noResultsText) || 'No matches found';
        return `<div class="tgf-empty">
          <div class="tgf-empty-icon">${icon('search', 28)}</div>
          <p class="tgf-empty-title">${esc(noResultsText)}</p>
          <p class="tgf-empty-text">Try a different search term or browse all questions.</p>
        </div>`;
      }

      // Two-column: split into independent columns. First-half goes left, second-half right.
      // This keeps each column's layout independent (opening an item in one column
      // doesn't push items in the other down) and preserves reading order on mobile
      // when columns stack vertically.
      if (this.c.layout === 'two-column') {
        const half = Math.ceil(qs.length / 2);
        const left = qs.slice(0, half).map(q => this._renderItem(q)).join('');
        const right = qs.slice(half).map(q => this._renderItem(q)).join('');
        return `<div class="${listClass}">
          <div class="tgf-col">${left}</div>
          <div class="tgf-col">${right}</div>
        </div>`;
      }

      return `<div class="${listClass}">${qs.map(q => this._renderItem(q)).join('')}</div>`;
    }

    _renderItem(q) {
      const isOpen = this.state.openItems.has(q.id);
      const qHtml = this._highlightText(q.question || '');
      const answerHtml = this._highlightHTML(mdToHTML(q.answer || ''));
      const iconName = (q.icon && IC[q.icon]) ? q.icon :
                       (this._categoryIcon(q.category) || 'help');
      const ansId = 'ans-' + esc(q.id);
      const showIcon = this.c.showIcons !== false;

      return `<article class="tgf-item" data-id="${esc(q.id)}" data-open="${isOpen}">
        <button class="tgf-question" type="button" aria-expanded="${isOpen}" aria-controls="${ansId}">
          ${showIcon ? `<span class="tgf-q-icon">${icon(iconName, 18)}</span>` : ''}
          <span class="tgf-q-text">${qHtml}${this._renderBadges(q)}</span>
          <span class="tgf-chevron">${icon('chevron', 20)}</span>
        </button>
        <div class="tgf-answer" id="${ansId}" role="region">
          <div class="tgf-answer-outer">
            <div class="tgf-answer-body">
              ${answerHtml}
              ${this.c.showUpdated && q.updatedAt ? `<span class="tgf-updated">Last updated ${esc(q.updatedAt)}</span>` : ''}
            </div>
          </div>
        </div>
      </article>`;
    }

    _renderBadges(q) {
      const badges = [];
      if (q.pinned)  badges.push('<span class="tgf-badge tgf-badge--pinned">Pinned</span>');
      if (q.popular) badges.push('<span class="tgf-badge tgf-badge--popular">Popular</span>');
      return badges.length ? ' <span class="tgf-q-badges">' + badges.join('') + '</span>' : '';
    }

    _renderCTA() {
      const cta = this.c.cta;
      if (!cta || !cta.enabled) return '';
      const styleClass = cta.style === 'strip' ? ' tgf-cta--strip' :
                         cta.style === 'gradient' ? ' tgf-cta--gradient' : '';
      const btnUrl = isSafeUrl(cta.buttonUrl) ? esc(cta.buttonUrl) : '#';
      const external = /^https?:/i.test(cta.buttonUrl || '') ? ' target="_blank" rel="noopener noreferrer"' : '';
      return `<div class="tgf-cta${styleClass}">
        <div class="tgf-cta-copy">
          ${cta.heading ? `<p class="tgf-cta-title">${esc(cta.heading)}</p>` : ''}
          ${cta.description ? `<p class="tgf-cta-desc">${esc(cta.description)}</p>` : ''}
        </div>
        ${cta.buttonText ? `<a class="tgf-cta-btn" href="${btnUrl}"${external}>${esc(cta.buttonText)} ${icon('arrow-right', 16)}</a>` : ''}
      </div>`;
    }

    _highlightText(text) {
      const safe = esc(text);
      if (!this.state.query) return safe;
      const re = new RegExp(escapeRegExp(this.state.query), 'gi');
      return safe.replace(re, m => '<mark>' + m + '</mark>');
    }

    _highlightHTML(html) {
      if (!this.state.query) return html;
      const re = new RegExp(escapeRegExp(this.state.query), 'gi');
      // Only highlight text nodes (content between tags), never attributes or tag names
      return html.replace(/>([^<]+)</g, (m, txt) => '>' + txt.replace(re, match => '<mark>' + match + '</mark>') + '<');
    }

    _bind() {
      const root = this.shadow.querySelector('.tgf-root');
      if (!root) return;

      // Delegated click handling
      root.addEventListener('click', (e) => {
        // Question toggle
        const qBtn = e.target.closest('.tgf-question');
        if (qBtn) {
          const item = qBtn.closest('.tgf-item');
          if (item) this._toggleItem(item.dataset.id);
          return;
        }
        // Category tab / chip
        const catBtn = e.target.closest('[data-cat]');
        if (catBtn) {
          this.state.activeCategory = catBtn.dataset.cat;
          this._rerender({ preserveSearchFocus: false });
          return;
        }
        // Expand all / collapse all
        const expandBtn = e.target.closest('[data-expand-all]');
        if (expandBtn) {
          this._toggleAll();
          return;
        }
        // Search clear
        const clearBtn = e.target.closest('.tgf-search-clear');
        if (clearBtn) {
          this.state.query = '';
          this._rerender({ preserveSearchFocus: true, focusSearch: true });
          return;
        }
      });

      // Search input
      const searchInput = root.querySelector('.tgf-search-input');
      if (searchInput) {
        let t;
        searchInput.addEventListener('input', (e) => {
          const val = e.target.value;
          clearTimeout(t);
          t = setTimeout(() => {
            this.state.query = val;
            this._rerender({ preserveSearchFocus: true });
          }, 120);
        });
        // Clear on Escape
        searchInput.addEventListener('keydown', (e) => {
          if (e.key === 'Escape' && this.state.query) {
            this.state.query = '';
            this._rerender({ preserveSearchFocus: true, focusSearch: true });
          }
        });
      }

      // Keyboard: Arrow navigation between questions (optional polish)
      root.addEventListener('keydown', (e) => {
        if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
        const active = this.shadow.activeElement;
        if (!active || !active.classList || !active.classList.contains('tgf-question')) return;
        e.preventDefault();
        const buttons = Array.from(root.querySelectorAll('.tgf-question'));
        const idx = buttons.indexOf(active);
        if (idx === -1) return;
        const next = e.key === 'ArrowDown' ? buttons[idx + 1] : buttons[idx - 1];
        if (next) next.focus();
      });
    }

    _toggleItem(id) {
      if (!id) return;
      const open = this.state.openItems;
      if (this.c.expandBehavior === 'single') {
        if (open.has(id)) {
          open.delete(id);
        } else {
          open.clear();
          open.add(id);
        }
      } else {
        if (open.has(id)) open.delete(id); else open.add(id);
      }
      // Surgical DOM update (no full re-render — preserves search input & animation)
      const items = this.shadow.querySelectorAll('.tgf-item');
      items.forEach(item => {
        const isOpen = open.has(item.dataset.id);
        item.dataset.open = isOpen ? 'true' : 'false';
        const btn = item.querySelector('.tgf-question');
        if (btn) btn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
      });
      // Sync allExpanded state
      const visibleIds = this._filteredQuestions().map(q => q.id);
      this.state.allExpanded = visibleIds.length > 0 &&
                               visibleIds.every(vid => open.has(vid));
      const expandBtn = this.shadow.querySelector('.tgf-expand-btn');
      if (expandBtn) expandBtn.outerHTML = this._renderExpandBtn();
    }

    _toggleAll() {
      const visible = this._filteredQuestions();
      if (this.state.allExpanded) {
        visible.forEach(q => this.state.openItems.delete(q.id));
        this.state.allExpanded = false;
      } else {
        visible.forEach(q => this.state.openItems.add(q.id));
        this.state.allExpanded = true;
      }
      this._rerender({ preserveSearchFocus: true });
    }

    _rerender(opts) {
      opts = opts || {};
      let selStart = null, selEnd = null, hadFocus = false;
      if (opts.preserveSearchFocus) {
        const active = this.shadow.activeElement;
        if (active && active.classList && active.classList.contains('tgf-search-input')) {
          hadFocus = true;
          selStart = active.selectionStart;
          selEnd = active.selectionEnd;
        }
      }
      this._render();
      if ((hadFocus || opts.focusSearch)) {
        const newInput = this.shadow.querySelector('.tgf-search-input');
        if (newInput) {
          newInput.focus();
          if (selStart != null) {
            try { newInput.setSelectionRange(selStart, selEnd); } catch (e) {}
          }
        }
      }
    }

    _handleDeepLink() {
      if (typeof window === 'undefined' || !window.location) return;
      const hash = window.location.hash;
      if (!hash) return;
      const match = /^#faq[-_:](.+)$/i.exec(hash);
      if (!match) return;
      const target = match[1].toLowerCase();
      const found = (this.c.questions || []).find(q =>
        q.id === target ||
        slugify(q.question || '') === target ||
        'faq_' + slugify(q.question || '') === target
      );
      if (!found) return;
      this.state.openItems.add(found.id);
      this._render();
      // Scroll into view after render
      setTimeout(() => {
        const el = this.shadow.querySelector(`[data-id="${CSS.escape(found.id)}"]`);
        if (el && typeof el.scrollIntoView === 'function') {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }, 80);
    }

    _injectSchema() {
      if (typeof document === 'undefined') return;
      if (!this.c.seo || !this.c.seo.enableSchema) return;

      const scriptId = 'tg-faq-schema-' + this.widgetId;
      const existing = document.getElementById(scriptId);
      if (existing) existing.remove();

      const visible = this._visibleQuestions();
      if (!visible.length) return;

      const schema = {
        '@context': 'https://schema.org',
        '@type': 'FAQPage',
        mainEntity: visible.map(q => ({
          '@type': 'Question',
          name: String(q.question || '').slice(0, 500),
          acceptedAnswer: {
            '@type': 'Answer',
            text: toPlain(q.answer || '').slice(0, 2000)
          }
        }))
      };

      try {
        const script = document.createElement('script');
        script.type = 'application/ld+json';
        script.id = scriptId;
        script.setAttribute('data-tg-faq', this.widgetId);
        script.textContent = JSON.stringify(schema);
        document.head.appendChild(script);
      } catch (e) {
        // Silent fail — schema is a progressive enhancement
      }
    }

    update(newConfig) {
      this.c = this._defaults(newConfig);
      this._prepareQuestions();
      this.state.openItems.clear();
      this.state.query = '';
      this.state.activeCategory = 'all';
      this.state.allExpanded = false;
      this._initialOpen();
      this._render();
      this._injectSchema();
    }

    destroy() {
      if (typeof document !== 'undefined') {
        const scriptId = 'tg-faq-schema-' + this.widgetId;
        const existing = document.getElementById(scriptId);
        if (existing) existing.remove();
      }
      if (this.shadow) this.shadow.innerHTML = '';
    }
  }

  /* ------------------------------------------------------------------
   * Auto-init
   * ------------------------------------------------------------------ */
  async function init() {
    const containers = document.querySelectorAll('[data-tg-widget="faq"]:not([data-tg-initialised])');
    for (const el of containers) {
      el.setAttribute('data-tg-initialised', 'true');
      try {
        // Inline config wins
        const inline = el.getAttribute('data-tg-config');
        if (inline) {
          const cfg = JSON.parse(inline);
          const w = new TGFaqWidget(el, cfg);
          el.__tgFaq = w;
          continue;
        }
        // Remote config via widget id
        const id = el.getAttribute('data-tg-id');
        if (id) {
          const res = await fetch(API_BASE + '?id=' + encodeURIComponent(id), {
            credentials: 'omit'
          });
          if (!res.ok) throw new Error('Widget config fetch failed (' + res.status + ')');
          const data = await res.json();
          const cfg = data && (data.config || data);
          const w = new TGFaqWidget(el, cfg);
          el.__tgFaq = w;
          continue;
        }
        console.warn('[TG FAQ Widget] Container has neither data-tg-id nor data-tg-config');
      } catch (err) {
        console.error('[TG FAQ Widget] Failed to initialise:', err);
        try {
          el.innerHTML = '<p style="color:#6b7280;font:14px/1.5 -apple-system,sans-serif;padding:16px;text-align:center;border:1px dashed #e5e7eb;border-radius:8px;margin:0">Unable to load FAQ widget</p>';
        } catch (e) { /* noop */ }
      }
    }
  }

  // Expose globally (useful for manual init / editors embedding live preview)
  if (typeof window !== 'undefined') {
    window.TGFaqWidget = TGFaqWidget;
    window.__TG_FAQ_VERSION__ = VERSION;
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', init);
    } else {
      init();
    }
    // Re-init when new widget nodes are added (common with dynamic page builders like Duda).
    // Debounced + gated: only re-run if at least one added node contains an uninitialised widget.
    if (typeof MutationObserver !== 'undefined') {
      try {
        let scheduled = false;
        const scheduleInit = () => {
          if (scheduled) return;
          scheduled = true;
          setTimeout(() => { scheduled = false; init(); }, 120);
        };
        const mo = new MutationObserver((records) => {
          for (const r of records) {
            for (const node of r.addedNodes) {
              if (node.nodeType !== 1) continue;
              if (node.matches && node.matches('[data-tg-widget="faq"]:not([data-tg-initialised])')) {
                scheduleInit(); return;
              }
              if (node.querySelector && node.querySelector('[data-tg-widget="faq"]:not([data-tg-initialised])')) {
                scheduleInit(); return;
              }
            }
          }
        });
        mo.observe(document.body || document.documentElement, { childList: true, subtree: true });
      } catch (e) { /* noop */ }
    }
  }
})();
