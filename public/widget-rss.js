/**
 * Travelgenix RSS News Feed Widget v1.0.0
 * Self-contained, embeddable news/blog feed — zero dependencies.
 *
 * No API key: pulls one or more PUBLIC RSS/Atom feeds via our cached, SSRF-safe
 * /api/rss-feed proxy (the browser can't fetch feeds cross-origin). Multiple
 * feeds are merged, sorted newest-first and de-duplicated client-side. Items
 * link out to the original articles.
 *
 * Features
 *  - Three layouts: list, grid, compact
 *  - Optional thumbnails, source labels, dates, excerpts
 *  - Skeleton loading, graceful empty/error states, per-feed failure isolation
 *  - Dark mode (theme: "dark" | "light" | "auto"), reduced-motion aware
 *  - Responsive from 320px upwards, keyboard accessible, XSS-hardened
 *
 * Usage (remote config):
 *   <div data-tg-widget="rss" data-tg-id="YOUR_WIDGET_ID"></div>
 *   <script src="https://tg-widgets.vercel.app/widget-rss.js"></script>
 *
 * Usage (inline config):
 *   <div data-tg-widget="rss" data-tg-config='{"feeds":["https://…/rss"]}'></div>
 *   <script src="https://tg-widgets.vercel.app/widget-rss.js"></script>
 *
 * © Travelgenix. All rights reserved.
 */
(function () {
  'use strict';

  const VERSION = '1.0.2';

  // ─── i18n ───────────────────────────────────────────────────
  // Fixed UI chrome only (default heading, empty/error states, the live-feed
  // badge, "Read more", fallback title). Relative dates are rendered with
  // Intl.RelativeTimeFormat, not these keys. Article titles, summaries, source
  // names and dates are data and are never translated. English is the source
  // and the fallback.
  const MESSAGES = {
    en: { justNow: 'Just now', latestNews: 'Latest travel news', untitled: 'Untitled', empty: 'No articles to show.', noArticles: 'Couldn’t load any articles right now.', loadFailed: 'Couldn’t load the feed right now.', addFeed: 'Add an RSS feed to show the latest articles.', readMore: 'Read more', liveFeed: 'Live feed' },
    fr: { justNow: 'À l’instant', latestNews: 'Dernières actualités voyage', untitled: 'Sans titre', empty: 'Aucun article à afficher.', noArticles: 'Impossible de charger des articles pour le moment.', loadFailed: 'Impossible de charger le flux pour le moment.', addFeed: 'Ajoutez un flux RSS pour afficher les derniers articles.', readMore: 'Lire la suite', liveFeed: 'Flux en direct' },
    de: { justNow: 'Gerade eben', latestNews: 'Neueste Reisenachrichten', untitled: 'Ohne Titel', empty: 'Keine Artikel vorhanden.', noArticles: 'Es konnten gerade keine Artikel geladen werden.', loadFailed: 'Der Feed konnte gerade nicht geladen werden.', addFeed: 'Fügen Sie einen RSS-Feed hinzu, um die neuesten Artikel anzuzeigen.', readMore: 'Mehr lesen', liveFeed: 'Live-Feed' },
    es: { justNow: 'Ahora mismo', latestNews: 'Últimas noticias de viajes', untitled: 'Sin título', empty: 'No hay artículos para mostrar.', noArticles: 'No se pudieron cargar artículos ahora mismo.', loadFailed: 'No se pudo cargar el feed ahora mismo.', addFeed: 'Añade un feed RSS para mostrar los últimos artículos.', readMore: 'Leer más', liveFeed: 'Feed en directo' },
    it: { justNow: 'Proprio ora', latestNews: 'Ultime notizie di viaggio', untitled: 'Senza titolo', empty: 'Nessun articolo da mostrare.', noArticles: 'Impossibile caricare articoli in questo momento.', loadFailed: 'Impossibile caricare il feed in questo momento.', addFeed: 'Aggiungi un feed RSS per mostrare gli ultimi articoli.', readMore: 'Leggi tutto', liveFeed: 'Feed live' },
    ro: { justNow: 'Chiar acum', latestNews: 'Cele mai recente știri de călătorie', untitled: 'Fără titlu', empty: 'Niciun articol de afișat.', noArticles: 'Nu am putut încărca niciun articol acum.', loadFailed: 'Nu am putut încărca fluxul acum.', addFeed: 'Adaugă un flux RSS pentru a afișa cele mai recente articole.', readMore: 'Citește mai mult', liveFeed: 'Flux live' },
  };
  // BCP-47 locale per supported language, for Intl.RelativeTimeFormat / dates.
  const LOCALES = { en: 'en-GB', fr: 'fr-FR', de: 'de-DE', es: 'es-ES', it: 'it-IT', ro: 'ro-RO' };
  function localeOf(lang) {
    if (typeof window !== 'undefined' && window.TGi18n && typeof window.TGi18n.localeOf === 'function') return window.TGi18n.localeOf(lang);
    return LOCALES[lang] || 'en-GB';
  }
  // Uses the shared TGi18n core when present; otherwise an identical inline
  // resolver keeps the widget self-contained.
  function makeT(cfg) {
    if (typeof window !== 'undefined' && window.TGi18n && typeof window.TGi18n.make === 'function') return window.TGi18n.make(MESSAGES, cfg);
    const supported = Object.keys(MESSAGES);
    const baseOf = (r) => (r ? String(r).toLowerCase().replace(/_/g, '-').split('-')[0] : '');
    let cands = [];
    if (cfg) cands.push(cfg.lang, cfg.language, cfg.locale);
    try { cands.push(document.documentElement.getAttribute('lang')); } catch (e) { /* noop */ }
    try { if (navigator.languages) cands = cands.concat(navigator.languages); cands.push(navigator.language); } catch (e) { /* noop */ }
    let lang = 'en';
    for (let i = 0; i < cands.length; i++) { const b = baseOf(cands[i]); if (b && supported.indexOf(b) !== -1) { lang = b; break; } }
    const dict = MESSAGES[lang] || MESSAGES.en;
    const t = (k, vars) => {
      let s = Object.prototype.hasOwnProperty.call(dict, k) ? dict[k] : (MESSAGES.en[k] || k);
      if (vars) s = String(s).replace(/\{(\w+)\}/g, (m, n) => (vars[n] != null ? vars[n] : m));
      return s;
    };
    t.lang = lang; t.dir = 'ltr';
    return t;
  }

  function resolveBase(path, override) {
    if (typeof window === 'undefined') return path;
    if (override && window[override]) return window[override];
    try {
      const me = document.currentScript;
      if (me && me.src) return new URL(me.src).origin + path;
      const scripts = document.getElementsByTagName('script');
      for (let i = scripts.length - 1; i >= 0; i--) {
        const s = scripts[i].src || '';
        if (/\/widget\-rss\.js(\?|$|#)/.test(s)) return new URL(s).origin + path;
      }
    } catch (e) { /* fall through */ }
    return path;
  }
  const API_BASE = resolveBase('/api/widget-config', '__TG_WIDGET_API__');
  const FEED_BASE = resolveBase('/api/rss-feed', '__TG_RSS_FEED_API__');

  // ─── Helpers ────────────────────────────────────────────────
  function esc(s) {
    if (s === null || s === undefined) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  }
  function safeUrl(u) {
    const s = String(u || '').trim();
    return /^https?:\/\//i.test(s) ? s : '';
  }
  function safeColor(c, fb) { return (typeof c === 'string' && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(c.trim())) ? c.trim() : fb; }
  function safeFont(f) { return (typeof f === 'string' && /^[\w \-]{1,40}$/.test(f.trim())) ? f.trim() : 'Inter'; }
  // Load a client-chosen web font on the host page (house rule 2). Naming a font
  // in CSS does nothing if it is not on the page, so the choice silently fell
  // back to the system stack. Inject the Google Fonts stylesheet once, skipping
  // Inter/empty. safeFont already limits the value to a plain family name.
  function ensureFont(family) {
    if (!family || family === 'Inter' || typeof document === 'undefined') return;
    const id = 'tg-font-' + String(family).toLowerCase().replace(/\s+/g, '-');
    if (document.getElementById(id)) return;
    const l = document.createElement('link');
    l.id = id; l.rel = 'stylesheet';
    l.href = 'https://fonts.googleapis.com/css2?family=' + encodeURIComponent(family).replace(/%20/g, '+') + ':ital,wght@0,400;0,500;0,600;1,400&display=swap';
    document.head.appendChild(l);
  }

  function fmtDate(iso, t) {
    t = t || ((k) => MESSAGES.en[k] || k);
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    const locale = localeOf(t.lang || 'en');
    const days = Math.floor((Date.now() - d.getTime()) / 86400000);
    // Relative time for anything under a week; absolute date beyond that.
    // Intl.RelativeTimeFormat handles singular/plural and today/yesterday
    // per locale automatically. Falls back to a plain English rendering.
    if (days < 7) {
      const hrs = Math.floor((Date.now() - d.getTime()) / 3600000);
      const mins = Math.floor((Date.now() - d.getTime()) / 60000);
      if (mins < 1) return t('justNow');
      try {
        const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
        if (hrs < 1) return rtf.format(-mins, 'minute');
        if (days < 1) return rtf.format(-hrs, 'hour');
        return rtf.format(-days, 'day');
      } catch (e) {
        if (hrs < 1) return mins + (mins === 1 ? ' minute ago' : ' minutes ago');
        if (days < 1) return hrs + (hrs === 1 ? ' hour ago' : ' hours ago');
        return days === 1 ? 'Yesterday' : days + ' days ago';
      }
    }
    try { return d.toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' }); }
    catch (e) { return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }); }
  }
  function hostOf(u) { try { return new URL(u).hostname.replace(/^www\./, ''); } catch (e) { return ''; } }

  const ICONS = {
    rss: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M4 11a9 9 0 0 1 9 9h2.5A11.5 11.5 0 0 0 4 8.5V11zm0 4a5 5 0 0 1 5 5h2.5A7.5 7.5 0 0 0 4 12.5V15zm1.5 2.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3z"/></svg>',
    ext: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>',
  };

  const DEFAULTS = {
    feeds: [], items: null,
    layout: 'list', columns: 3, maxItems: 9,
    theme: 'light', accent: '#0891B2', radius: 16, font: 'Inter', pageBg: '',
    showHeader: true, headerTitle: 'Latest travel news', headerSubtitle: '',
    showImages: true, showSource: true, showDate: true, showExcerpt: true,
    excerptLength: 140, openNewTab: true, dedupe: true,
  };

  function styles() {
    return `
      :host { all: initial; display:block; }
      *, *::before, *::after { box-sizing: border-box; }
      .tgr-root {
        --tgr-accent:#0891B2; --tgr-bg:transparent; --tgr-card:#FFFFFF;
        --tgr-text:#0F172A; --tgr-sub:#64748B; --tgr-border:#E8EDF2; --tgr-radius:16px;
        --tgr-shadow:0 1px 2px rgba(15,23,42,.06), 0 8px 24px rgba(15,23,42,.05);
        --tgr-cols:3;
        font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
        color:var(--tgr-text); background:var(--tgr-bg); line-height:1.5; -webkit-font-smoothing:antialiased;
      }
      .tgr-root[data-theme="dark"] {
        --tgr-card:#1E293B; --tgr-text:#F1F5F9; --tgr-sub:#94A3B8; --tgr-border:#334155;
        --tgr-shadow:0 1px 2px rgba(0,0,0,.3), 0 8px 24px rgba(0,0,0,.35);
      }
      .tgr-head { display:flex; align-items:flex-end; justify-content:space-between; gap:16px; margin-bottom:18px; flex-wrap:wrap; }
      .tgr-title { font-size:22px; font-weight:800; letter-spacing:-.02em; margin:0; }
      .tgr-sub { font-size:14px; color:var(--tgr-sub); margin:4px 0 0; }
      .tgr-badge { display:inline-flex; align-items:center; gap:6px; font-size:12px; font-weight:600; color:var(--tgr-accent); }
      .tgr-badge svg { width:15px; height:15px; }

      .tgr-card {
        display:flex; background:var(--tgr-card); color:inherit; text-decoration:none;
        border:1px solid var(--tgr-border); border-radius:var(--tgr-radius); overflow:hidden;
        box-shadow:var(--tgr-shadow); transition:transform .18s ease, box-shadow .18s ease;
      }
      .tgr-card:hover { transform:translateY(-2px); box-shadow:0 10px 30px rgba(15,23,42,.12); }
      .tgr-card:focus-visible { outline:3px solid var(--tgr-accent); outline-offset:2px; }
      .tgr-thumb { background:#0b1220 center/cover no-repeat; flex-shrink:0; }
      .tgr-body { padding:14px 16px; display:flex; flex-direction:column; gap:6px; min-width:0; flex:1; }
      .tgr-meta { font-size:12px; color:var(--tgr-sub); display:flex; gap:6px; align-items:center; flex-wrap:wrap; }
      .tgr-meta .dot { width:3px; height:3px; border-radius:999px; background:currentColor; opacity:.5; }
      .tgr-src { font-weight:600; color:var(--tgr-accent); }
      .tgr-itit { font-size:15px; font-weight:700; line-height:1.3; margin:0;
        display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; }
      .tgr-ex { font-size:13px; color:var(--tgr-sub); margin:0;
        display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; }
      .tgr-ext { margin-left:auto; color:var(--tgr-sub); opacity:0; transition:opacity .18s ease; }
      .tgr-ext svg { width:15px; height:15px; }
      .tgr-card:hover .tgr-ext { opacity:.8; }

      /* List */
      .tgr-list { display:flex; flex-direction:column; gap:12px; }
      .tgr-list .tgr-card { flex-direction:row; align-items:stretch; }
      .tgr-list .tgr-thumb { width:160px; }
      @media (max-width:560px){ .tgr-list .tgr-thumb { width:108px; } .tgr-list .tgr-itit{ font-size:14px; } .tgr-list .tgr-ex{ display:none; } }

      /* Grid */
      .tgr-grid { display:grid; grid-template-columns:repeat(var(--tgr-cols),1fr); gap:18px; }
      .tgr-grid .tgr-card { flex-direction:column; }
      .tgr-grid .tgr-thumb { width:100%; aspect-ratio:16/9; }
      @media (max-width:900px){ .tgr-grid { grid-template-columns:repeat(2,1fr);} }
      @media (max-width:560px){ .tgr-grid { grid-template-columns:1fr;} }

      /* Compact */
      .tgr-compact { display:flex; flex-direction:column; }
      .tgr-compact .tgr-card { flex-direction:row; align-items:center; border:0; border-bottom:1px solid var(--tgr-border); border-radius:0; box-shadow:none; padding:0; }
      .tgr-compact .tgr-card:hover { transform:none; box-shadow:none; background:var(--tgr-bg); }
      .tgr-compact .tgr-card:last-child { border-bottom:0; }
      .tgr-compact .tgr-body { padding:11px 2px; gap:3px; }
      .tgr-compact .tgr-itit { font-size:14px; font-weight:600; -webkit-line-clamp:1; }
      .tgr-compact .tgr-ex { display:none; }
      .tgr-compact .tgr-thumb { display:none; }

      /* Skeleton */
      .tgr-sk { background:var(--tgr-card); border:1px solid var(--tgr-border); border-radius:var(--tgr-radius); overflow:hidden; display:flex; gap:0; }
      .tgr-sk .b { background:linear-gradient(90deg, rgba(148,163,184,.12) 25%, rgba(148,163,184,.22) 37%, rgba(148,163,184,.12) 63%); background-size:400% 100%; animation:tgr-shim 1.4s ease infinite; }
      .tgr-list .tgr-sk .t { width:160px; } .tgr-sk .t { align-self:stretch; }
      .tgr-grid .tgr-sk { flex-direction:column; } .tgr-grid .tgr-sk .t { width:100%; aspect-ratio:16/9; }
      .tgr-sk .lines { padding:14px 16px; flex:1; }
      .tgr-sk .l { height:12px; border-radius:6px; margin-bottom:8px; }
      .tgr-sk .l.s { width:55%; }
      @keyframes tgr-shim { 0%{background-position:100% 0} 100%{background-position:0 0} }

      .tgr-empty { border:1px dashed var(--tgr-border); border-radius:var(--tgr-radius); padding:38px 24px; text-align:center; color:var(--tgr-sub); font-size:14px; }
      .tgr-empty svg { width:30px; height:30px; color:var(--tgr-accent); opacity:.7; margin-bottom:10px; }

      @media (prefers-reduced-motion: reduce) {
        .tgr-root *, .tgr-card { transition:none !important; animation:none !important; }
        .tgr-card:hover { transform:none; }
      }
    `;
  }

  class TGRssWidget {
    constructor(container, config) {
      this.el = container;
      this.cfg = Object.assign({}, DEFAULTS, config || {});
      this.t = makeT(this.cfg);   // resolve viewer language + UI strings
      // Localise the default heading: if the author didn't set their own
      // headerTitle, swap the English default for the viewer's language.
      if (!config || config.headerTitle == null) this.cfg.headerTitle = this.t('latestNews');
      this.shadow = container.attachShadow ? container.attachShadow({ mode: 'open' }) : container;
      this.items = [];
      this._buildShell();
      this._load();
    }

    _theme() {
      let t = this.cfg.theme || 'light';
      if (t === 'auto') t = (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
      return t === 'dark' ? 'dark' : 'light';
    }

    _feedList() {
      const f = this.cfg.feeds;
      const arr = Array.isArray(f) ? f : (f ? [f] : []);
      return arr.map(x => (typeof x === 'string' ? x : (x && x.url))).map(u => safeUrl(u)).filter(Boolean).slice(0, 6);
    }

    _buildShell() {
      const cfg = this.cfg;
      const accent = safeColor(cfg.accent, '#0891B2');
      const radius = Math.max(0, Math.min(28, parseInt(cfg.radius, 10) || 16));
      const cols = Math.max(2, Math.min(4, parseInt(cfg.columns, 10) || 3));
      const font = safeFont(cfg.fontFamily || cfg.font);
      ensureFont(font); // load the client-chosen web font on the host site (house rule 2)
      const rootStyle = [
        `--tgr-accent:${accent}`, `--tgr-radius:${radius}px`, `--tgr-cols:${cols}`,
        `font-family:'${font}', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif`,
        cfg.pageBg ? `--tgr-bg:${safeColor(cfg.pageBg, 'transparent')}` : '',
      ].filter(Boolean).join(';');

      this.shadow.innerHTML = `<style>${styles()}</style>
        <div class="tgr-root" data-theme="${this._theme()}" style="${esc(rootStyle)}">
          ${this._headHtml()}
          <div class="tgr-content" id="tgr-content"></div>
        </div>`;
      this.contentEl = this.shadow.getElementById('tgr-content');
      this._renderSkeleton();
    }

    _headHtml() {
      const cfg = this.cfg;
      if (!cfg.showHeader) return '';
      const title = cfg.headerTitle ? `<h3 class="tgr-title">${esc(cfg.headerTitle)}</h3>` : '';
      const sub = cfg.headerSubtitle ? `<p class="tgr-sub">${esc(cfg.headerSubtitle)}</p>` : '';
      if (!title && !sub) return '';
      return `<div class="tgr-head"><div>${title}${sub}</div><span class="tgr-badge">${ICONS.rss} ${esc(this.t('liveFeed'))}</span></div>`;
    }

    _layout() { return ['list', 'grid', 'compact'].includes(this.cfg.layout) ? this.cfg.layout : 'list'; }

    _renderSkeleton() {
      const layout = this._layout();
      const n = Math.max(3, Math.min(6, parseInt(this.cfg.maxItems, 10) || 6));
      const card = `<div class="tgr-sk"><div class="b t"></div><div class="lines"><div class="b l"></div><div class="b l"></div><div class="b l s"></div></div></div>`;
      this.contentEl.innerHTML = `<div class="tgr-${layout}">${Array(n).fill(card).join('')}</div>`;
    }

    async _load() {
      const cfg = this.cfg;
      if (Array.isArray(cfg.items) && cfg.items.length) {
        this.items = cfg.items.map(this._normItem).filter(i => i.link);
        this._renderItems();
        return;
      }
      const feeds = this._feedList();
      if (!feeds.length) { this._renderEmpty(this.t('addFeed')); return; }
      const max = Math.max(1, Math.min(30, parseInt(cfg.maxItems, 10) || 9));
      try {
        const results = await Promise.allSettled(feeds.map(u =>
          fetch(FEED_BASE + '?url=' + encodeURIComponent(u) + '&max=' + max, { credentials: 'omit' })
            .then(r => r.json())
        ));
        let merged = [];
        for (const res of results) {
          if (res.status === 'fulfilled' && res.value && res.value.ok && Array.isArray(res.value.items)) {
            const src = (res.value.feed && res.value.feed.title) || '';
            for (const it of res.value.items) merged.push(this._normItem(Object.assign({ source: src }, it)));
          }
        }
        merged = merged.filter(i => i.link);
        if (cfg.dedupe) {
          const seen = new Set();
          merged = merged.filter(i => { if (seen.has(i.link)) return false; seen.add(i.link); return true; });
        }
        merged.sort((a, b) => (b._ts || 0) - (a._ts || 0));
        this.items = merged.slice(0, max);
        if (!this.items.length) { this._renderEmpty(this.t('noArticles')); return; }
        this._renderItems();
      } catch (e) {
        this._renderEmpty(this.t('loadFailed'));
      }
    }

    _normItem(it) {
      const link = /^https?:\/\//i.test(String(it.link || '')) ? String(it.link).trim() : '';
      return {
        title: it.title || '',
        link,
        published: it.published || '',
        _ts: it.published ? Date.parse(it.published) || 0 : 0,
        summary: it.summary || '',
        image: /^https?:\/\//i.test(String(it.image || '')) ? String(it.image).trim() : '',
        source: it.source || hostOf(link),
      };
    }

    _cardHtml(it) {
      const cfg = this.cfg;
      const layout = this._layout();
      const title = it.title || this.t('untitled');
      const target = cfg.openNewTab ? ' target="_blank" rel="noopener noreferrer"' : '';
      const showThumb = cfg.showImages && layout !== 'compact' && it.image;
      // Carry the image URL on a data attribute and set background-image via
      // CSSOM after render (see _renderItems). Interpolating it into an inline
      // style="...url('…')" is unsafe: esc() turns ' into &#039;, which the
      // browser HTML-decodes back to ' before the CSS parser runs, letting a
      // malicious feed image URL break out of url('…') and inject CSS.
      const thumb = showThumb ? `<span class="tgr-thumb" data-bg="${esc(it.image)}" role="img" aria-label=""></span>` : '';
      const meta = [];
      if (cfg.showSource && it.source) meta.push(`<span class="tgr-src">${esc(it.source)}</span>`);
      if (cfg.showDate && it.published) meta.push(esc(fmtDate(it.published, this.t)));
      const metaHtml = meta.length ? `<div class="tgr-meta">${meta.map((m, i) => (i ? '<span class="dot"></span>' : '') + m).join('')}</div>` : '';
      const ex = (cfg.showExcerpt && layout !== 'compact' && it.summary)
        ? `<p class="tgr-ex">${esc(this._clip(it.summary, cfg.excerptLength))}</p>` : '';
      const extIcon = layout === 'compact' ? `<span class="tgr-ext">${ICONS.ext}</span>` : '';
      return `<a class="tgr-card" href="${esc(it.link)}"${target} aria-label="${esc(title)}">
        ${thumb}
        <span class="tgr-body">
          ${metaHtml}
          <p class="tgr-itit">${esc(title)}</p>
          ${ex}
        </span>${extIcon}
      </a>`;
    }

    _clip(s, n) { n = parseInt(n, 10) || 140; s = String(s || ''); return s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s; }

    _renderItems() {
      const layout = this._layout();
      this.contentEl.innerHTML = `<div class="tgr-${layout}">${this.items.map(i => this._cardHtml(i)).join('')}</div>`;
      // Set the thumbnail background via CSSOM (injection-safe) and hide any that
      // fails to load. Setting .style.backgroundImage through the DOM can't break
      // out of the style rule the way an inline style string can.
      this.contentEl.querySelectorAll('.tgr-thumb[data-bg]').forEach(span => {
        const url = span.getAttribute('data-bg');
        if (!url) return;
        // Strip the two characters that could terminate the url("…") wrapper;
        // everything else is inert once assigned through CSSOM.
        span.style.backgroundImage = 'url("' + url.replace(/["\\]/g, '') + '")';
        const probe = new Image();
        probe.onerror = () => { span.style.display = 'none'; };
        probe.src = url;
      });
    }

    _renderEmpty(msg) {
      this.contentEl.innerHTML = `<div class="tgr-empty">${ICONS.rss}<div>${esc(msg || this.t('empty'))}</div></div>`;
    }

    update(newConfig) {
      this.cfg = Object.assign({}, this.cfg, newConfig || {});
      this.t = makeT(this.cfg);
      if (newConfig && newConfig.headerTitle == null && (!this.cfg.headerTitle || this.cfg.headerTitle === MESSAGES.en.latestNews)) {
        this.cfg.headerTitle = this.t('latestNews');
      }
      this._buildShell();
      this._load();
    }
    destroy(keepShadow) { if (!keepShadow && this.shadow) this.shadow.innerHTML = ''; }
  }

  // ─── Boot ───────────────────────────────────────────────────
  async function fetchConfig(id) {
    try {
      const r = await fetch(API_BASE + '?id=' + encodeURIComponent(id), { method: 'GET', credentials: 'omit' });
      if (!r.ok) return null;
      const data = await r.json();
      return data && data.config ? data.config : null;
    } catch (e) { return null; }
  }
  async function init() {
    const containers = document.querySelectorAll('[data-tg-widget="rss"]');
    for (const el of containers) {
      if (el.__tgInited) continue;
      el.__tgInited = true;
      let cfg = null;
      const inline = el.getAttribute('data-tg-config');
      if (inline) { try { cfg = JSON.parse(inline); } catch (e) { cfg = null; } }
      else { const id = el.getAttribute('data-tg-id'); if (id) cfg = await fetchConfig(id); }
      try { new TGRssWidget(el, cfg || {}); }
      catch (e) { if (window.console) console.error('[TGRss] init failed', e); }
    }
  }

  window.TGRssWidget = TGRssWidget;
  window.__TG_RSS_VERSION__ = VERSION;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
