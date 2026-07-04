/**
 * Travelgenix YouTube Widget v1.0.0
 * Self-contained, embeddable YouTube channel feed — zero dependencies.
 *
 * No API key: pulls a channel's PUBLIC feed via our cached /api/youtube-feed
 * proxy (server fetches the YouTube RSS). Playback uses privacy-friendly
 * youtube-nocookie embeds in a lightbox — no key needed for embedding either.
 *
 * Features
 *  - Three layouts: grid, carousel, list
 *  - Lightbox playback (youtube-nocookie) or open-in-new-tab
 *  - Skeleton loading, graceful empty/error states
 *  - Optional header + "visit channel" CTA, published dates, view counts
 *  - Dark mode (theme: "dark" | "light" | "auto"), reduced-motion aware
 *  - Responsive from 320px upwards, keyboard accessible, XSS-hardened
 *
 * Usage (remote config):
 *   <div data-tg-widget="youtube" data-tg-id="YOUR_WIDGET_ID"></div>
 *   <script src="https://tg-widgets.vercel.app/widget-youtube.js"></script>
 *
 * Usage (inline config):
 *   <div data-tg-widget="youtube" data-tg-config='{"channelId":"UC..."}'></div>
 *   <script src="https://tg-widgets.vercel.app/widget-youtube.js"></script>
 *
 * © Travelgenix. All rights reserved.
 */
(function () {
  'use strict';

  const VERSION = '1.0.1';

  // ─── i18n ───────────────────────────────────────────────────
  // Fixed UI chrome only (relative-time labels, the header/CTA defaults, the
  // empty state and the aria-labels). Video titles, channel name and
  // descriptions are author/data content, never translated here. English is the
  // source + fallback.
  const MESSAGES = {
    en: { latestVideos: 'Latest videos', visitChannel: 'Visit our channel', untitled: 'Untitled', noVideos: 'No videos to show.', emptyHelp: 'Add a YouTube channel to show its latest videos.', errorHelp: "Couldn't load videos right now.", views: 'views', play: 'Play: {title}', previous: 'Previous', next: 'Next', videoPlayer: 'Video player', close: 'Close video' },
    fr: { latestVideos: 'Dernières vidéos', visitChannel: 'Voir notre chaîne', untitled: 'Sans titre', noVideos: 'Aucune vidéo à afficher.', emptyHelp: 'Ajoutez une chaîne YouTube pour afficher ses dernières vidéos.', errorHelp: 'Impossible de charger les vidéos pour le moment.', views: 'vues', play: 'Lire : {title}', previous: 'Précédent', next: 'Suivant', videoPlayer: 'Lecteur vidéo', close: 'Fermer la vidéo' },
    de: { latestVideos: 'Neueste Videos', visitChannel: 'Unseren Kanal besuchen', untitled: 'Ohne Titel', noVideos: 'Keine Videos vorhanden.', emptyHelp: 'Fügen Sie einen YouTube-Kanal hinzu, um dessen neueste Videos anzuzeigen.', errorHelp: 'Videos konnten gerade nicht geladen werden.', views: 'Aufrufe', play: 'Abspielen: {title}', previous: 'Zurück', next: 'Weiter', videoPlayer: 'Videoplayer', close: 'Video schließen' },
    es: { latestVideos: 'Últimos vídeos', visitChannel: 'Visita nuestro canal', untitled: 'Sin título', noVideos: 'No hay vídeos para mostrar.', emptyHelp: 'Añade un canal de YouTube para mostrar sus últimos vídeos.', errorHelp: 'No se pudieron cargar los vídeos ahora mismo.', views: 'visualizaciones', play: 'Reproducir: {title}', previous: 'Anterior', next: 'Siguiente', videoPlayer: 'Reproductor de vídeo', close: 'Cerrar vídeo' },
    it: { latestVideos: 'Ultimi video', visitChannel: 'Visita il nostro canale', untitled: 'Senza titolo', noVideos: 'Nessun video da mostrare.', emptyHelp: 'Aggiungi un canale YouTube per mostrare i suoi ultimi video.', errorHelp: 'Impossibile caricare i video in questo momento.', views: 'visualizzazioni', play: 'Riproduci: {title}', previous: 'Precedente', next: 'Successivo', videoPlayer: 'Lettore video', close: 'Chiudi video' },
    ro: { latestVideos: 'Cele mai recente videoclipuri', visitChannel: 'Vizitează canalul nostru', untitled: 'Fără titlu', noVideos: 'Niciun videoclip de afișat.', emptyHelp: 'Adaugă un canal YouTube pentru a afișa cele mai recente videoclipuri.', errorHelp: 'Nu am putut încărca videoclipurile acum.', views: 'vizualizări', play: 'Redă: {title}', previous: 'Anterior', next: 'Următor', videoPlayer: 'Player video', close: 'Închide videoclipul' },
  };
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
        if (/\/widget\-youtube\.js(\?|$|#)/.test(s)) return new URL(s).origin + path;
      }
    } catch (e) { /* fall through */ }
    return path;
  }
  const API_BASE = resolveBase('/api/widget-config', '__TG_WIDGET_API__');
  const FEED_BASE = resolveBase('/api/youtube-feed', '__TG_YT_FEED_API__');

  // ─── Helpers ────────────────────────────────────────────────
  function esc(s) {
    if (s === null || s === undefined) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  }
  function safeUrl(u) {
    if (!u) return '';
    const s = String(u).trim();
    if (/^https?:\/\//i.test(s)) return s;
    return '';
  }
  function safeColor(c, fb) {
    if (typeof c !== 'string') return fb;
    const s = c.trim();
    return /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(s) ? s : fb;
  }
  function safeFont(f) {
    if (typeof f !== 'string') return 'Inter';
    return /^[\w \-]{1,40}$/.test(f.trim()) ? f.trim() : 'Inter';
  }
  const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;
  const CHANNEL_ID_RE = /^UC[A-Za-z0-9_-]{22}$/;

  function fmtViews(n, t) {
    if (typeof n !== 'number' || !isFinite(n) || n < 0) return '';
    const views = t ? t('views') : 'views';
    if (n >= 1e6) return (n / 1e6).toFixed(n >= 1e7 ? 0 : 1).replace(/\.0$/, '') + 'M ' + views;
    if (n >= 1e3) return (n / 1e3).toFixed(n >= 1e4 ? 0 : 1).replace(/\.0$/, '') + 'K ' + views;
    return n + ' ' + views;
  }
  const LOCALE_MAP = { en: 'en-GB', fr: 'fr-FR', de: 'de-DE', es: 'es-ES', it: 'it-IT', ro: 'ro-RO' };
  function localeFor(lang) {
    if (typeof window !== 'undefined' && window.TGi18n && typeof window.TGi18n.localeOf === 'function') {
      try { const l = window.TGi18n.localeOf(lang); if (l) return l; } catch (e) { /* noop */ }
    }
    return LOCALE_MAP[lang] || 'en-GB';
  }
  function fmtDate(iso, t) {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    const days = Math.floor((Date.now() - d.getTime()) / 86400000);
    // Pick the coarsest sensible unit using the same thresholds the old code used.
    let n, unit;
    if (days <= 0)        { n = 0;                      unit = 'day'; }
    else if (days < 7)    { n = days;                   unit = 'day'; }
    else if (days < 30)   { n = Math.floor(days / 7);   unit = 'week'; }
    else if (days < 365)  { n = Math.floor(days / 30);  unit = 'month'; }
    else                  { n = Math.floor(days / 365); unit = 'year'; }
    const lang = (t && t.lang) ? t.lang : 'en';
    try {
      // numeric:'auto' yields localised "today"/"yesterday"/"2 days ago" with
      // correct singular/plural. Negative value = in the past.
      const rtf = new Intl.RelativeTimeFormat(localeFor(lang), { numeric: 'auto' });
      let s = rtf.format(-n, unit);
      // The previous output capitalised "Today"/"Yesterday"; match that for the
      // day-level relative strings so the chrome looks unchanged.
      if (unit === 'day' && s) s = s.charAt(0).toUpperCase() + s.slice(1);
      return s;
    } catch (e) {
      // Intl unavailable — fall back to a plain English-style relative string.
      if (unit === 'day' && n <= 0) return 'Today';
      if (unit === 'day' && n === 1) return 'Yesterday';
      return n + ' ' + unit + (n === 1 ? '' : 's') + ' ago';
    }
  }

  const ICONS = {
    play: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>',
    yt: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M23.5 6.2a3 3 0 0 0-2.1-2.1C19.5 3.5 12 3.5 12 3.5s-7.5 0-9.4.6A3 3 0 0 0 .5 6.2 31 31 0 0 0 0 12a31 31 0 0 0 .5 5.8 3 3 0 0 0 2.1 2.1c1.9.6 9.4.6 9.4.6s7.5 0 9.4-.6a3 3 0 0 0 2.1-2.1A31 31 0 0 0 24 12a31 31 0 0 0-.5-5.8zM9.6 15.6V8.4l6.3 3.6z"/></svg>',
    chev: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg>',
    close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
  };

  const DEFAULTS = {
    channelId: '', channelUrl: '', channelTitle: '', videos: null,
    layout: 'grid', columns: 3, maxVideos: 6,
    theme: 'light', accent: '#0891B2', radius: 16, font: 'Inter', pageBg: '',
    showHeader: true, headerTitle: null, headerSubtitle: '',
    showChannelCta: true, channelCtaLabel: null,
    showTitle: true, showPublished: true, showViews: false,
    play: 'lightbox', autoplay: true,
  };

  function styles() {
    return `
      :host { all: initial; display:block; }
      *, *::before, *::after { box-sizing: border-box; }
      .tgy-root {
        --tgy-accent: #0891B2;
        --tgy-bg: transparent;
        --tgy-card: #FFFFFF;
        --tgy-text: #0F172A;
        --tgy-sub: #64748B;
        --tgy-border: #E8EDF2;
        --tgy-radius: 16px;
        --tgy-shadow: 0 1px 2px rgba(15,23,42,.06), 0 8px 24px rgba(15,23,42,.05);
        --tgy-cols: 3;
        font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        color: var(--tgy-text);
        background: var(--tgy-bg);
        line-height: 1.5;
        -webkit-font-smoothing: antialiased;
      }
      .tgy-root[data-theme="dark"] {
        --tgy-card: #1E293B;
        --tgy-text: #F1F5F9;
        --tgy-sub: #94A3B8;
        --tgy-border: #334155;
        --tgy-shadow: 0 1px 2px rgba(0,0,0,.3), 0 8px 24px rgba(0,0,0,.35);
      }

      .tgy-head { display:flex; align-items:flex-end; justify-content:space-between; gap:16px; margin-bottom:18px; flex-wrap:wrap; }
      .tgy-head-text { min-width:0; }
      .tgy-title { font-size:22px; font-weight:800; letter-spacing:-.02em; margin:0; }
      .tgy-sub { font-size:14px; color:var(--tgy-sub); margin:4px 0 0; }
      .tgy-cta {
        display:inline-flex; align-items:center; gap:7px; flex-shrink:0;
        font-size:13px; font-weight:600; text-decoration:none;
        color:#fff; background:var(--tgy-accent);
        padding:9px 15px; border-radius:999px; transition:transform .15s ease, filter .15s ease;
      }
      .tgy-cta:hover { filter:brightness(1.06); transform:translateY(-1px); }
      .tgy-cta svg { width:16px; height:16px; }

      /* Card (shared) */
      .tgy-card {
        appearance:none; border:0; padding:0; margin:0; text-align:left; cursor:pointer;
        background:var(--tgy-card); color:inherit; font:inherit;
        border:1px solid var(--tgy-border); border-radius:var(--tgy-radius);
        overflow:hidden; display:flex; flex-direction:column; width:100%;
        box-shadow:var(--tgy-shadow); transition:transform .18s ease, box-shadow .18s ease;
        text-decoration:none;
      }
      .tgy-card:hover { transform:translateY(-3px); box-shadow:0 10px 30px rgba(15,23,42,.12); }
      .tgy-card:focus-visible { outline:3px solid var(--tgy-accent); outline-offset:2px; }
      .tgy-thumb { position:relative; width:100%; aspect-ratio:16/9; background:#0b1220; overflow:hidden; }
      .tgy-thumb img { width:100%; height:100%; object-fit:cover; display:block; transition:transform .35s ease; }
      .tgy-card:hover .tgy-thumb img { transform:scale(1.05); }
      .tgy-play {
        position:absolute; inset:0; display:flex; align-items:center; justify-content:center;
        background:linear-gradient(180deg, rgba(0,0,0,0) 40%, rgba(0,0,0,.35) 100%);
      }
      .tgy-play span {
        width:54px; height:54px; border-radius:999px; display:flex; align-items:center; justify-content:center;
        background:rgba(15,23,42,.62); backdrop-filter:blur(2px); color:#fff;
        transition:transform .18s ease, background .18s ease;
      }
      .tgy-play span svg { width:24px; height:24px; margin-left:3px; }
      .tgy-card:hover .tgy-play span { background:var(--tgy-accent); transform:scale(1.08); }
      .tgy-body { padding:12px 14px 14px; display:flex; flex-direction:column; gap:6px; }
      .tgy-vtitle {
        font-size:14px; font-weight:600; margin:0; line-height:1.35;
        display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden;
      }
      .tgy-meta { font-size:12px; color:var(--tgy-sub); display:flex; gap:6px; align-items:center; flex-wrap:wrap; }
      .tgy-meta .dot { width:3px; height:3px; border-radius:999px; background:currentColor; opacity:.5; }
      .tgy-desc { font-size:13px; color:var(--tgy-sub); margin:2px 0 0; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; }

      /* Grid */
      .tgy-grid { display:grid; grid-template-columns:repeat(var(--tgy-cols), 1fr); gap:18px; }
      @media (max-width: 900px) { .tgy-grid { grid-template-columns:repeat(2, 1fr); } }
      @media (max-width: 560px) { .tgy-grid { grid-template-columns:1fr; } }

      /* Carousel */
      .tgy-carousel-wrap { position:relative; }
      .tgy-carousel { display:flex; gap:16px; overflow-x:auto; scroll-snap-type:x mandatory; scroll-behavior:smooth; padding:4px 2px 12px; -webkit-overflow-scrolling:touch; scrollbar-width:none; }
      .tgy-carousel::-webkit-scrollbar { display:none; }
      .tgy-carousel .tgy-card { scroll-snap-align:start; flex:0 0 300px; max-width:300px; }
      @media (max-width: 560px) { .tgy-carousel .tgy-card { flex-basis:80%; max-width:80%; } }
      .tgy-arrow {
        position:absolute; top:38%; transform:translateY(-50%); z-index:2;
        width:40px; height:40px; border-radius:999px; border:1px solid var(--tgy-border);
        background:var(--tgy-card); color:var(--tgy-text); cursor:pointer; display:flex; align-items:center; justify-content:center;
        box-shadow:var(--tgy-shadow); transition:opacity .15s ease, transform .15s ease;
      }
      .tgy-arrow svg { width:20px; height:20px; }
      .tgy-arrow.prev { left:-8px; } .tgy-arrow.prev svg { transform:rotate(180deg); }
      .tgy-arrow.next { right:-8px; }
      .tgy-arrow:hover { transform:translateY(-50%) scale(1.06); }
      .tgy-arrow[disabled] { opacity:0; pointer-events:none; }

      /* List */
      .tgy-list { display:flex; flex-direction:column; gap:12px; }
      .tgy-list .tgy-card { flex-direction:row; align-items:stretch; }
      .tgy-list .tgy-thumb { width:200px; aspect-ratio:16/9; flex-shrink:0; }
      .tgy-list .tgy-body { justify-content:center; flex:1; }
      .tgy-list .tgy-vtitle { font-size:15px; -webkit-line-clamp:2; }
      @media (max-width: 560px) { .tgy-list .tgy-card { flex-direction:column; } .tgy-list .tgy-thumb { width:100%; } }

      /* Skeleton */
      .tgy-sk { background:var(--tgy-card); border:1px solid var(--tgy-border); border-radius:var(--tgy-radius); overflow:hidden; }
      .tgy-sk .b { background:linear-gradient(90deg, rgba(148,163,184,.12) 25%, rgba(148,163,184,.22) 37%, rgba(148,163,184,.12) 63%); background-size:400% 100%; animation:tgy-shim 1.4s ease infinite; }
      .tgy-sk .t { aspect-ratio:16/9; }
      .tgy-sk .l { height:13px; margin:12px 14px; border-radius:6px; }
      .tgy-sk .l.s { width:60%; }
      @keyframes tgy-shim { 0%{background-position:100% 0} 100%{background-position:0 0} }

      /* Empty / error */
      .tgy-empty { border:1px dashed var(--tgy-border); border-radius:var(--tgy-radius); padding:38px 24px; text-align:center; color:var(--tgy-sub); font-size:14px; }
      .tgy-empty svg { width:34px; height:34px; color:var(--tgy-accent); opacity:.7; margin-bottom:10px; }

      /* Lightbox */
      .tgy-lb { position:fixed; inset:0; z-index:2147483000; display:flex; align-items:center; justify-content:center; padding:24px; background:rgba(5,10,20,.82); opacity:0; transition:opacity .2s ease; }
      .tgy-lb.is-open { opacity:1; }
      .tgy-lb-inner { position:relative; width:min(1040px, 100%); }
      .tgy-lb-frame { position:relative; width:100%; aspect-ratio:16/9; background:#000; border-radius:14px; overflow:hidden; box-shadow:0 30px 80px rgba(0,0,0,.5); }
      .tgy-lb-frame iframe { position:absolute; inset:0; width:100%; height:100%; border:0; }
      .tgy-lb-close { position:absolute; top:-46px; right:0; width:38px; height:38px; border-radius:999px; border:0; background:rgba(255,255,255,.14); color:#fff; cursor:pointer; display:flex; align-items:center; justify-content:center; }
      .tgy-lb-close:hover { background:rgba(255,255,255,.26); }
      .tgy-lb-close svg { width:20px; height:20px; }

      @media (prefers-reduced-motion: reduce) {
        .tgy-root *, .tgy-carousel { transition:none !important; animation:none !important; scroll-behavior:auto !important; }
        .tgy-card:hover { transform:none; }
        .tgy-card:hover .tgy-thumb img { transform:none; }
      }
    `;
  }

  class TGYouTubeWidget {
    constructor(container, config) {
      this.el = container;
      this.cfg = Object.assign({}, DEFAULTS, config || {});
      this.t = makeT(this.cfg);   // resolve viewer language + UI strings
      this.shadow = container.attachShadow ? container.attachShadow({ mode: 'open' }) : container;
      this.videos = [];
      this.channel = { title: this.cfg.channelTitle || '', url: safeUrl(this.cfg.channelUrl) || '' };
      this._onKey = (e) => {
        if (e.key === 'Escape') { this._closeLightbox(); return; }
        // Trap Tab within the open dialog so keyboard focus can't escape to the
        // host page behind the modal. The dialog's focusable stops are the close
        // button and the video iframe.
        if (e.key === 'Tab' && this._lb) {
          const stops = [this._lb.querySelector('.tgy-lb-close'), this._lb.querySelector('iframe')].filter(Boolean);
          if (!stops.length) return;
          const first = stops[0], last = stops[stops.length - 1];
          const active = this.shadow.activeElement;
          if (e.shiftKey && active === first) { e.preventDefault(); last.focus(); }
          else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
        }
      };
      this._ro = null;
      this._buildShell();
      this._load();
    }

    _theme() {
      let t = this.cfg.theme || 'light';
      if (t === 'auto') t = (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
      return t === 'dark' ? 'dark' : 'light';
    }

    _buildShell() {
      const cfg = this.cfg;
      const accent = safeColor(cfg.accent, '#0891B2');
      const radius = Math.max(0, Math.min(28, parseInt(cfg.radius, 10) || 16));
      const cols = Math.max(2, Math.min(4, parseInt(cfg.columns, 10) || 3));
      const font = safeFont(cfg.fontFamily || cfg.font);
      const rootStyle = [
        `--tgy-accent:${accent}`,
        `--tgy-radius:${radius}px`,
        `--tgy-cols:${cols}`,
        `font-family:'${font}', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif`,
        cfg.pageBg ? `--tgy-bg:${safeColor(cfg.pageBg, 'transparent')}` : '',
      ].filter(Boolean).join(';');

      this.shadow.innerHTML = `<style>${styles()}</style>
        <div class="tgy-root" data-theme="${this._theme()}" style="${esc(rootStyle)}">
          ${this._headHtml()}
          <div class="tgy-content" id="tgy-content"></div>
        </div>`;
      this.contentEl = this.shadow.getElementById('tgy-content');
      this._renderSkeleton();
    }

    _headHtml() {
      const cfg = this.cfg;
      if (!cfg.showHeader && !cfg.showChannelCta) return '';
      const headerTitle = (cfg.headerTitle != null) ? cfg.headerTitle : this.t('latestVideos');
      const ctaLabel = (cfg.channelCtaLabel != null) ? cfg.channelCtaLabel : this.t('visitChannel');
      const title = cfg.showHeader && headerTitle ? `<h3 class="tgy-title">${esc(headerTitle)}</h3>` : '';
      const sub = cfg.showHeader && cfg.headerSubtitle ? `<p class="tgy-sub">${esc(cfg.headerSubtitle)}</p>` : '';
      const url = safeUrl(this.channel.url) || safeUrl(cfg.channelUrl);
      const cta = (cfg.showChannelCta && url)
        ? `<a class="tgy-cta" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${ICONS.yt}${esc(ctaLabel)}</a>` : '';
      if (!title && !sub && !cta) return '';
      return `<div class="tgy-head"><div class="tgy-head-text">${title}${sub}</div>${cta}</div>`;
    }

    _refreshHead() {
      const root = this.shadow.querySelector('.tgy-root');
      const existing = root.querySelector('.tgy-head');
      const html = this._headHtml();
      if (existing) existing.remove();
      if (html) root.insertAdjacentHTML('afterbegin', html);
    }

    _renderSkeleton() {
      const n = Math.max(2, Math.min(6, parseInt(this.cfg.maxVideos, 10) || 6));
      const card = `<div class="tgy-sk"><div class="b t"></div><div class="b l"></div><div class="b l s"></div></div>`;
      const wrapCls = this.cfg.layout === 'list' ? 'tgy-list' : (this.cfg.layout === 'carousel' ? 'tgy-carousel' : 'tgy-grid');
      this.contentEl.innerHTML = `<div class="${wrapCls}">${Array(n).fill(card).join('')}</div>`;
    }

    async _load() {
      const cfg = this.cfg;
      // Inline override — render directly, no fetch.
      if (Array.isArray(cfg.videos) && cfg.videos.length) {
        this.videos = cfg.videos.filter(v => v && VIDEO_ID_RE.test(String(v.id || ''))).map(this._normVideo, this);
        if (!this.channel.title && cfg.channelTitle) this.channel.title = cfg.channelTitle;
        this._refreshHead();
        this._renderVideos();
        return;
      }
      const id = String(cfg.channelId || '').trim();
      if (!CHANNEL_ID_RE.test(id)) { this._renderEmpty(this.t('emptyHelp')); return; }
      try {
        const max = Math.max(1, Math.min(15, parseInt(cfg.maxVideos, 10) || 6));
        const r = await fetch(FEED_BASE + '?channelId=' + encodeURIComponent(id) + '&max=' + max, { method: 'GET', credentials: 'omit' });
        const d = await r.json().catch(() => null);
        if (!r.ok || !d || !d.ok || !Array.isArray(d.videos) || !d.videos.length) {
          this._renderEmpty((d && d.error) ? d.error : this.t('errorHelp'));
          return;
        }
        this.videos = d.videos.map(this._normVideo, this);
        if (d.channel) {
          if (!this.channel.title) this.channel.title = d.channel.title || '';
          if (!this.channel.url) this.channel.url = safeUrl(d.channel.url) || '';
        }
        this._refreshHead();
        this._renderVideos();
      } catch (e) {
        this._renderEmpty(this.t('errorHelp'));
      }
    }

    _normVideo(v) {
      const id = String(v.id || '');
      return {
        id,
        title: v.title || this.t('untitled'),
        url: safeUrl(v.url) || ('https://www.youtube.com/watch?v=' + id),
        embedUrl: 'https://www.youtube-nocookie.com/embed/' + id,
        published: v.published || '',
        thumbnail: safeUrl(v.thumbnail) || ('https://i.ytimg.com/vi/' + id + '/hqdefault.jpg'),
        description: v.description || '',
        views: (typeof v.views === 'number') ? v.views : null,
      };
    }

    _cardHtml(v, withDesc) {
      const cfg = this.cfg;
      const tag = (cfg.play === 'newtab') ? 'a' : 'button';
      const attrs = (cfg.play === 'newtab')
        ? `href="${esc(v.url)}" target="_blank" rel="noopener noreferrer"`
        : `type="button" data-id="${esc(v.id)}"`;
      const meta = [];
      if (cfg.showPublished && v.published) meta.push(esc(fmtDate(v.published, this.t)));
      if (cfg.showViews && typeof v.views === 'number') meta.push(esc(fmtViews(v.views, this.t)));
      const metaHtml = meta.length ? `<div class="tgy-meta">${meta.map((m, i) => (i ? '<span class="dot"></span>' : '') + m).join('')}</div>` : '';
      const titleHtml = cfg.showTitle ? `<p class="tgy-vtitle">${esc(v.title)}</p>` : '';
      const descHtml = (withDesc && v.description) ? `<p class="tgy-desc">${esc(v.description)}</p>` : '';
      const body = (titleHtml || metaHtml || descHtml) ? `<div class="tgy-body">${titleHtml}${metaHtml}${descHtml}</div>` : '';
      return `<${tag} class="tgy-card" ${attrs} aria-label="${esc(this.t('play', { title: v.title }))}">
        <div class="tgy-thumb">
          <img src="${esc(v.thumbnail)}" data-fallback="https://i.ytimg.com/vi/${esc(v.id)}/mqdefault.jpg" alt="" loading="lazy" referrerpolicy="no-referrer">
          <span class="tgy-play"><span>${ICONS.play}</span></span>
        </div>${body}
      </${tag}>`;
    }

    _renderVideos() {
      const cfg = this.cfg;
      const layout = ['grid', 'carousel', 'list'].includes(cfg.layout) ? cfg.layout : 'grid';
      const cards = this.videos.map(v => this._cardHtml(v, layout === 'list')).join('');
      if (layout === 'carousel') {
        this.contentEl.innerHTML = `<div class="tgy-carousel-wrap">
          <button class="tgy-arrow prev" type="button" aria-label="${esc(this.t('previous'))}" disabled>${ICONS.chev}</button>
          <div class="tgy-carousel" id="tgy-track">${cards}</div>
          <button class="tgy-arrow next" type="button" aria-label="${esc(this.t('next'))}">${ICONS.chev}</button>
        </div>`;
        this._wireCarousel();
      } else {
        this.contentEl.innerHTML = `<div class="${layout === 'list' ? 'tgy-list' : 'tgy-grid'}">${cards}</div>`;
      }
      this._wirePlayback();
    }

    _renderEmpty(msg) {
      this.contentEl.innerHTML = `<div class="tgy-empty">${ICONS.yt}<div>${esc(msg || this.t('noVideos'))}</div></div>`;
    }

    _wirePlayback() {
      // Thumbnail fallback (maxres/hq → mq) without inline handlers
      this.contentEl.querySelectorAll('.tgy-thumb img[data-fallback]').forEach(img => {
        img.addEventListener('error', function onErr() {
          this.removeEventListener('error', onErr);
          const fb = this.getAttribute('data-fallback');
          if (fb) this.src = fb;
        });
      });
      if (this.cfg.play === 'newtab') return;
      this.contentEl.querySelectorAll('.tgy-card[data-id]').forEach(btn => {
        btn.addEventListener('click', () => this._openLightbox(btn.getAttribute('data-id')));
      });
    }

    _wireCarousel() {
      const track = this.shadow.getElementById('tgy-track');
      const prev = this.contentEl.querySelector('.tgy-arrow.prev');
      const next = this.contentEl.querySelector('.tgy-arrow.next');
      if (!track) return;
      const upd = () => {
        const max = track.scrollWidth - track.clientWidth - 2;
        prev.disabled = track.scrollLeft <= 2;
        next.disabled = track.scrollLeft >= max;
      };
      const step = () => Math.max(240, Math.round(track.clientWidth * 0.8));
      prev.addEventListener('click', () => track.scrollBy({ left: -step(), behavior: 'smooth' }));
      next.addEventListener('click', () => track.scrollBy({ left: step(), behavior: 'smooth' }));
      track.addEventListener('scroll', upd, { passive: true });
      if (typeof ResizeObserver !== 'undefined') { this._ro = new ResizeObserver(upd); this._ro.observe(track); }
      setTimeout(upd, 60);
    }

    _openLightbox(id) {
      if (!VIDEO_ID_RE.test(id)) return;
      this._closeLightbox();
      const auto = this.cfg.autoplay ? '1' : '0';
      const src = 'https://www.youtube-nocookie.com/embed/' + id + '?autoplay=' + auto + '&rel=0&modestbranding=1&playsinline=1';
      const lb = document.createElement('div');
      lb.className = 'tgy-lb';
      lb.setAttribute('role', 'dialog');
      lb.setAttribute('aria-modal', 'true');
      lb.setAttribute('aria-label', this.t('videoPlayer'));
      lb.innerHTML = `<div class="tgy-lb-inner">
        <button class="tgy-lb-close" type="button" aria-label="${esc(this.t('close'))}">${ICONS.close}</button>
        <div class="tgy-lb-frame"><iframe src="${esc(src)}" title="YouTube video player" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe></div>
      </div>`;
      // Mount INSIDE the shadow root — styles stay scoped, nothing leaks to the
      // host page. position:fixed still resolves to the viewport.
      const root = this.shadow.querySelector('.tgy-root') || this.shadow;
      root.appendChild(lb);
      this._lb = lb;
      // Remember what had focus so it can be restored when the dialog closes,
      // then move focus into the dialog (the close button) for keyboard users.
      this._lbReturn = this.shadow.activeElement || null;
      const close = () => this._closeLightbox();
      lb.addEventListener('click', (e) => { if (e.target === lb) close(); });
      lb.querySelector('.tgy-lb-close').addEventListener('click', close);
      document.addEventListener('keydown', this._onKey);
      requestAnimationFrame(() => {
        lb.classList.add('is-open');
        const btn = lb.querySelector('.tgy-lb-close');
        if (btn) btn.focus();
      });
    }

    _closeLightbox() {
      document.removeEventListener('keydown', this._onKey);
      if (this._lb && this._lb.parentNode) this._lb.parentNode.removeChild(this._lb);
      this._lb = null;
      // Return focus to whatever opened the lightbox so keyboard users aren't
      // dropped back at the top of the page.
      if (this._lbReturn && typeof this._lbReturn.focus === 'function' && this._lbReturn.isConnected) {
        try { this._lbReturn.focus(); } catch (e) {}
      }
      this._lbReturn = null;
    }

    update(newConfig) {
      this.cfg = Object.assign({}, this.cfg, newConfig || {});
      this.t = makeT(this.cfg);
      this.channel = { title: this.cfg.channelTitle || '', url: safeUrl(this.cfg.channelUrl) || '' };
      this._buildShell();
      this._load();
    }

    destroy(keepShadow) {
      try { this._closeLightbox(); } catch (e) {}
      try { if (this._ro) { this._ro.disconnect(); this._ro = null; } } catch (e) {}
      if (!keepShadow && this.shadow) this.shadow.innerHTML = '';
    }
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
    const containers = document.querySelectorAll('[data-tg-widget="youtube"]');
    for (const el of containers) {
      if (el.__tgInited) continue;
      el.__tgInited = true;
      let cfg = null;
      const inline = el.getAttribute('data-tg-config');
      if (inline) { try { cfg = JSON.parse(inline); } catch (e) { cfg = null; } }
      else { const id = el.getAttribute('data-tg-id'); if (id) cfg = await fetchConfig(id); }
      try { new TGYouTubeWidget(el, cfg || {}); }
      catch (e) { if (window.console) console.error('[TGYouTube] init failed', e); }
    }
  }

  window.TGYouTubeWidget = TGYouTubeWidget;
  window.__TG_YOUTUBE_VERSION__ = VERSION;

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
