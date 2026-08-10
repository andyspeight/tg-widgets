/**
 * Travelgenix Event Calendar Widget v1.1.0
 * Self-contained, embeddable widget
 * Zero dependencies — works on any website via a single script tag
 *
 * Layouts:
 *   month   — grid calendar with events overlaid on dates
 *   list    — chronological list with month dividers
 *   card    — featured-card carousel of upcoming events
 *
 * Data sources:
 *   1. Travelgenix curated events (festivals, holidays, sporting events)
 *      — pulled live from the global Events Calendar at /api/events-content
 *   2. Custom events added by the client in the editor
 *
 * Usage:
 *   <div data-tg-widget="events" data-tg-id="YOUR_WIDGET_ID"></div>
 *   <script src="https://tg-widgets.vercel.app/widget-events.js"></script>
 */
(function () {
  'use strict';

    /**
   * Resolve the API base URL.
   *
   * BACKGROUND: This widget script is hosted on widgets.travelify.io and
   * embedded on customer sites. The widget must call back to its host
   * (widgets.travelify.io/api/widget-config) — NOT to the customer's
   * site. A relative '/api/...' URL resolves to the customer's origin
   * and 404s.
   *
   * Resolution order:
   *   1. window.__TG_WIDGET_API__ — explicit opt-in for advanced embeds
   *   2. Origin of document.currentScript at module-init time
   *   3. Scan script tags for the widget filename (handles async/defer)
   *   4. Relative URL — last resort, only works on same-origin pages
   */
  function resolveApiBase() {
    if (typeof window === 'undefined') return '/api/widget-config';
    if (window.__TG_WIDGET_API__) return window.__TG_WIDGET_API__;
    try {
      const me = document.currentScript;
      if (me && me.src) return new URL(me.src).origin + '/api/widget-config';
      const scripts = document.getElementsByTagName('script');
      for (let i = scripts.length - 1; i >= 0; i--) {
        const s = scripts[i].src || '';
        if (/\/widget\-events\.js(\?|$|#)/.test(s)) {
          return new URL(s).origin + '/api/widget-config';
        }
      }
    } catch (e) { /* fall through */ }
    return '/api/widget-config';
  }

  const API_BASE = resolveApiBase();
  const EVENTS_API = (function () {
    /* Resolve the EVENTS_API URL. Yesterday's fix patched widget-config but this
       secondary API was left with a relative default ('/api/events-content'), which
       on customer sites resolves to the customer's domain and 404s. Same
       resolution strategy as the API_BASE resolver above. */
    if (typeof window === 'undefined') return '/api/events-content';
    if (window.__TG_EVENTS_API__) return window.__TG_EVENTS_API__;
    try {
      var me = document.currentScript;
      if (me && me.src) return new URL(me.src).origin + '/api/events-content';
      var scripts = document.getElementsByTagName('script');
      for (var i = scripts.length - 1; i >= 0; i--) {
        var s = scripts[i].src || '';
        if (/\/widget\-events\.js(\?|$|#)/.test(s)) {
          return new URL(s).origin + '/api/events-content';
        }
      }
    } catch (e) { /* fall through */ }
    return '/api/events-content';
  })();
  const VERSION = '1.1.0';

  // Start a content fetch early (in parallel with the config fetch) so the two
  // requests don't wait on each other; _fetchCurated consumes it. Carries its
  // own timeout. (Spotlight-family speed, step 3.)
  function startContent(url) {
    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, 9000) : null;
    var p = fetch(url, ctrl ? { credentials: 'omit', signal: ctrl.signal } : { credentials: 'omit' });
    if (timer) p.then(function () { clearTimeout(timer); }, function () { clearTimeout(timer); });
    p.catch(function () {}); // handled so an unconsumed prefetch can't raise an unhandled rejection
    return p;
  }

  // ─── i18n ───────────────────────────────────────────────────
  // Fixed UI chrome only (month + weekday names, view-switcher and filter
  // labels, nav controls, empty/loading states, modal controls). Event titles,
  // descriptions, locations, categories, prices and dates are author content or
  // feed data and are NOT translated. English is the source + fallback.
  const MESSAGES = {
    en: {
      months: ['January','February','March','April','May','June','July','August','September','October','November','December'],
      monthsShort: ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'],
      daysShort: ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'],
      daysLong: ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'],
      viewGroup: 'View', viewList: 'List', viewMonth: 'Month', viewCards: 'Cards',
      allEvents: 'All events', today: 'Today',
      prevMonth: 'Previous month', nextMonth: 'Next month', more: '+{n} more',
      loading: 'Loading events…',
      emptyTitle: 'Nothing scheduled',
      emptyNone: 'No upcoming events to show.',
      emptyError: "We couldn't load events right now. Please try again shortly.",
      close: 'Close', findOutMore: 'Find out more',
    },
    fr: {
      months: ['janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre'],
      monthsShort: ['jan','fév','mar','avr','mai','jui','jul','aoû','sep','oct','nov','déc'],
      daysShort: ['Dim','Lun','Mar','Mer','Jeu','Ven','Sam'],
      daysLong: ['Dimanche','Lundi','Mardi','Mercredi','Jeudi','Vendredi','Samedi'],
      viewGroup: 'Affichage', viewList: 'Liste', viewMonth: 'Mois', viewCards: 'Cartes',
      allEvents: 'Tous', today: "Aujourd'hui",
      prevMonth: 'Mois précédent', nextMonth: 'Mois suivant', more: '+{n} de plus',
      loading: 'Chargement des évènements…',
      emptyTitle: 'Rien de prévu',
      emptyNone: 'Aucun évènement à venir à afficher.',
      emptyError: "Impossible de charger les évènements pour le moment. Veuillez réessayer sous peu.",
      close: 'Fermer', findOutMore: 'En savoir plus',
    },
    de: {
      months: ['Januar','Februar','März','April','Mai','Juni','Juli','August','September','Oktober','November','Dezember'],
      monthsShort: ['Jan','Feb','Mär','Apr','Mai','Jun','Jul','Aug','Sep','Okt','Nov','Dez'],
      daysShort: ['So','Mo','Di','Mi','Do','Fr','Sa'],
      daysLong: ['Sonntag','Montag','Dienstag','Mittwoch','Donnerstag','Freitag','Samstag'],
      viewGroup: 'Ansicht', viewList: 'Liste', viewMonth: 'Monat', viewCards: 'Karten',
      allEvents: 'Alle', today: 'Heute',
      prevMonth: 'Voriger Monat', nextMonth: 'Nächster Monat', more: '+{n} weitere',
      loading: 'Veranstaltungen werden geladen…',
      emptyTitle: 'Nichts geplant',
      emptyNone: 'Keine bevorstehenden Veranstaltungen.',
      emptyError: 'Veranstaltungen konnten gerade nicht geladen werden. Bitte versuchen Sie es in Kürze erneut.',
      close: 'Schließen', findOutMore: 'Mehr erfahren',
    },
    es: {
      months: ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'],
      monthsShort: ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'],
      daysShort: ['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'],
      daysLong: ['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'],
      viewGroup: 'Vista', viewList: 'Lista', viewMonth: 'Mes', viewCards: 'Tarjetas',
      allEvents: 'Todos', today: 'Hoy',
      prevMonth: 'Mes anterior', nextMonth: 'Mes siguiente', more: '+{n} más',
      loading: 'Cargando eventos…',
      emptyTitle: 'Nada programado',
      emptyNone: 'No hay eventos próximos que mostrar.',
      emptyError: 'No pudimos cargar los eventos en este momento. Vuelve a intentarlo en breve.',
      close: 'Cerrar', findOutMore: 'Más información',
    },
    it: {
      months: ['gennaio','febbraio','marzo','aprile','maggio','giugno','luglio','agosto','settembre','ottobre','novembre','dicembre'],
      monthsShort: ['gen','feb','mar','apr','mag','giu','lug','ago','set','ott','nov','dic'],
      daysShort: ['Dom','Lun','Mar','Mer','Gio','Ven','Sab'],
      daysLong: ['Domenica','Lunedì','Martedì','Mercoledì','Giovedì','Venerdì','Sabato'],
      viewGroup: 'Vista', viewList: 'Elenco', viewMonth: 'Mese', viewCards: 'Schede',
      allEvents: 'Tutti', today: 'Oggi',
      prevMonth: 'Mese precedente', nextMonth: 'Mese successivo', more: '+{n} altri',
      loading: 'Caricamento eventi…',
      emptyTitle: 'Niente in programma',
      emptyNone: 'Nessun evento in programma da mostrare.',
      emptyError: 'Non è stato possibile caricare gli eventi in questo momento. Riprova a breve.',
      close: 'Chiudi', findOutMore: 'Scopri di più',
    },
    ro: {
      months: ['ianuarie','februarie','martie','aprilie','mai','iunie','iulie','august','septembrie','octombrie','noiembrie','decembrie'],
      monthsShort: ['ian','feb','mar','apr','mai','iun','iul','aug','sep','oct','noi','dec'],
      daysShort: ['Dum','Lun','Mar','Mie','Joi','Vin','Sâm'],
      daysLong: ['Duminică','Luni','Marți','Miercuri','Joi','Vineri','Sâmbătă'],
      viewGroup: 'Vizualizare', viewList: 'Listă', viewMonth: 'Lună', viewCards: 'Carduri',
      allEvents: 'Toate', today: 'Azi',
      prevMonth: 'Luna precedentă', nextMonth: 'Luna următoare', more: '+{n} în plus',
      loading: 'Se încarcă evenimentele…',
      emptyTitle: 'Nimic programat',
      emptyNone: 'Niciun eveniment viitor de afișat.',
      emptyError: 'Nu am putut încărca evenimentele acum. Te rugăm să încerci din nou în scurt timp.',
      close: 'Închide', findOutMore: 'Află mai multe',
    },
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

  // ---------- Helpers ----------
  function esc(s) {
    if (s === null || s === undefined) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // The root style attribute carries author colours and font as CSS custom
  // properties. Validate each so a saved value can't add declarations ( ; ) or
  // break out ( " ) of the style attribute; the attribute is also esc()'d at
  // injection as a second layer.
  function safeColorE(v, fb) {
    const s = String(v == null ? '' : v).trim();
    if (/^#[0-9a-f]{3,8}$/i.test(s)) return s;
    if (/^rgba?\([0-9.,\s%]+\)$/i.test(s)) return s;
    if (/^hsla?\([0-9.,\s%deg]+\)$/i.test(s)) return s;
    if (/^[a-z]{3,20}$/i.test(s)) return s;
    return fb;
  }
  function safeFontStackE(v, fb) {
    const s = String(v == null ? '' : v).trim();
    return (s && s.length <= 120 && /^[A-Za-z0-9 ,"'-]+$/.test(s)) ? s : fb;
  }

  function ensureFont(family) {
    if (!family || family === 'Inter' || typeof document === 'undefined') return;
    const id = 'tg-font-' + String(family).toLowerCase().replace(/\s+/g, '-');
    if (document.getElementById(id)) return;
    const l = document.createElement('link');
    l.id = id;
    l.rel = 'stylesheet';
    l.href = 'https://fonts.googleapis.com/css2?family=' + encodeURIComponent(family).replace(/%20/g, '+') + ':ital,wght@0,400;0,500;0,600;1,400&display=swap';
    document.head.appendChild(l);
  }

  function safeUrl(url) {
    if (!url || typeof url !== 'string') return '';
    const t = url.trim();
    if (!t) return '';
    if (t.startsWith('/') || t.startsWith('#')) return t;
    try {
      const u = new URL(t);
      if (['https:', 'http:', 'mailto:', 'tel:'].includes(u.protocol)) return u.href;
      return '';
    } catch { return ''; }
  }

  function safeImageUrl(url) {
    if (!url || typeof url !== 'string') return '';
    const t = url.trim();
    if (!t) return '';
    try {
      const u = new URL(t);
      if (u.protocol === 'https:' || u.protocol === 'http:') return u.href;
      return '';
    } catch { return ''; }
  }

  function hexToRgb(hex) {
    if (!hex || typeof hex !== 'string') return '';
    let h = hex.trim().replace('#', '');
    if (h.length === 3) h = h.split('').map(c => c + c).join('');
    if (!/^[0-9a-f]{6}$/i.test(h)) return '';
    const n = parseInt(h, 16);
    return ((n >> 16) & 255) + ', ' + ((n >> 8) & 255) + ', ' + (n & 255);
  }

  // Parse YYYY-MM-DD strictly, no timezone shifts. Returns Date at local midnight.
  function parseDate(s) {
    if (!s || typeof s !== 'string') return null;
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return null;
    const y = +m[1], mo = +m[2], d = +m[3];
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    const dt = new Date(y, mo - 1, d);
    if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null;
    return dt;
  }

  function fmtDate(dt) {
    if (!dt) return '';
    const y = dt.getFullYear();
    const m = String(dt.getMonth() + 1).padStart(2, '0');
    const d = String(dt.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + d;
  }

  const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const MONTH_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const DAY_NAMES   = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const DAY_NAMES_LONG = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

  function startOfMonth(dt) { return new Date(dt.getFullYear(), dt.getMonth(), 1); }
  function endOfMonth(dt)   { return new Date(dt.getFullYear(), dt.getMonth() + 1, 0); }
  function addMonths(dt, n) { return new Date(dt.getFullYear(), dt.getMonth() + n, 1); }
  function sameDay(a, b) { return a && b && a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate(); }

  function dateInRange(d, start, end) {
    if (!d || !start) return false;
    const s = start.getTime();
    const e = end ? end.getTime() : s;
    const t = d.getTime();
    return t >= s && t <= e;
  }

  function ordinal(n) {
    const s = ['th', 'st', 'nd', 'rd'];
    const v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  }

  function fmtRange(startStr, endStr, t) {
    const mon = (t && t('monthsShort')) || MONTH_SHORT;
    const s = parseDate(startStr);
    const e = endStr ? parseDate(endStr) : null;
    if (!s) return '';
    if (!e || sameDay(s, e)) {
      return ordinal(s.getDate()) + ' ' + mon[s.getMonth()] + ' ' + s.getFullYear();
    }
    if (s.getMonth() === e.getMonth() && s.getFullYear() === e.getFullYear()) {
      return s.getDate() + '–' + e.getDate() + ' ' + mon[s.getMonth()] + ' ' + s.getFullYear();
    }
    if (s.getFullYear() === e.getFullYear()) {
      return s.getDate() + ' ' + mon[s.getMonth()] + ' – ' + e.getDate() + ' ' + mon[e.getMonth()] + ' ' + s.getFullYear();
    }
    return s.getDate() + ' ' + mon[s.getMonth()] + ' ' + s.getFullYear() + ' – ' + e.getDate() + ' ' + mon[e.getMonth()] + ' ' + e.getFullYear();
  }

  // ---------- Inline icons ----------
  function svgPath(d, cls) {
    return '<svg class="' + (cls || '') + '" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">'
      + '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="' + d + '"/></svg>';
  }
  const IC = {
    chevL: 'M15 19l-7-7 7-7',
    chevR: 'M9 5l7 7-7 7',
    close: 'M6 18L18 6M6 6l12 12',
    cal:   'M8 7V3M16 7V3M3.5 11h17M5 5h14a2 2 0 012 2v12a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2z',
    pin:   'M12 11a3 3 0 100-6 3 3 0 000 6zM12 22s-7-7-7-13a7 7 0 1114 0c0 6-7 13-7 13z',
    grid:  'M3 12h18M3 6h18M3 18h18',
    list:  'M4 6h16M4 12h16M4 18h16',
    card:  'M3 5a2 2 0 012-2h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V5z',
    arrow: 'M5 12h14M12 5l7 7-7 7',
    plus:  'M12 4v16m8-8H4',
  };

  // ---------- Default config ----------
  const DEFAULTS = {
    name: 'Event Calendar',

    // Layout
    layout: 'list',            // month | list | card
    monthsAhead: 12,           // list & card view: how far forward to look
    cardCount: 6,              // card view: how many to show

    // Header
    showHeader: true,
    title: 'Upcoming events',
    subtitle: 'Festivals, holidays and travel highlights',
    showLayoutSwitcher: true,

    // Filters
    showFilters: true,
    showCategoryFilter: true,
    showCountryFilter: false,  // off by default — only meaningful for global decks
    defaultCategory: 'all',

    // Travelgenix curated events
    useCuratedEvents: true,
    curatedCountries: [],      // array of country names; empty = all
    curatedCategories: [],     // array of category names; empty = all
    curatedAudience: [],       // multipleSelects from Events Calendar

    // Custom (client-added) events
    customEvents: [
      // { id, name, startDate, endDate, category, location, description, url, image, color }
    ],

    // Behaviour
    onClick: 'modal',          // modal | link | none
    showLocations: true,
    showDescriptions: true,
    showImages: true,

    // Theme
    theme: 'light',            // light | dark | auto
    brand: '#F97316',
    accent: '#0891B2',
    bg: '#FFFFFF',
    text: '#0F172A',
    sub: '#64748B',
    border: '#E2E8F0',
    radius: 16,
    fontFamily: '',

    // Reduced motion handled via media query
    widgetId: '',
  };

  // ---------- Category metadata (deterministic colours) ----------
  // The curated table has these single-select category options (case-insensitive matched).
  // Custom events can use any of these or any free-text label.
  const CAT_PALETTE = [
    { match: ['festival', 'cultural'],            color: '#A855F7', icon: '🎉' },
    { match: ['holiday', 'public holiday'],       color: '#EF4444', icon: '🏖️' },
    { match: ['sport', 'sporting'],               color: '#10B981', icon: '🏆' },
    { match: ['music', 'concert'],                color: '#EC4899', icon: '🎵' },
    { match: ['food', 'food and drink'],          color: '#F59E0B', icon: '🍽️' },
    { match: ['religious', 'spiritual'],          color: '#6366F1', icon: '🕊️' },
    { match: ['awareness', 'observance', 'day'],  color: '#0EA5E9', icon: '📅' },
    { match: ['travel', 'event'],                 color: '#0891B2', icon: '✈️' },
    { match: ['business', 'trade'],               color: '#475569', icon: '💼' },
  ];
  function categoryMeta(cat) {
    const c = (cat || '').toLowerCase().trim();
    for (const p of CAT_PALETTE) {
      if (p.match.some(m => c.includes(m))) return { color: p.color, icon: p.icon };
    }
    // Hash-based fallback colour for any unknown category
    let h = 0;
    for (let i = 0; i < c.length; i++) h = ((h << 5) - h + c.charCodeAt(i)) | 0;
    const fallbacks = ['#0891B2', '#7C3AED', '#16A34A', '#EA580C', '#DB2777', '#0F766E'];
    return { color: fallbacks[Math.abs(h) % fallbacks.length], icon: '📅' };
  }

  // ---------- Styles ----------
  const STYLES = `
    :host { all: initial; display: block; }
    *, *::before, *::after { box-sizing: border-box; }

    .tge-root {
      --tge-brand: #F97316;
      --tge-brand-rgb: 249, 115, 22;
      --tge-accent: #0891B2;
      --tge-bg: #FFFFFF;
      --tge-bg-alt: #F8FAFC;
      --tge-text: #0F172A;
      --tge-sub: #64748B;
      --tge-border: #E2E8F0;
      --tge-border-strong: #CBD5E1;
      --tge-radius: 16px;
      --tge-radius-sm: 10px;
      --tge-shadow: 0 1px 2px rgba(15, 23, 42, .04), 0 8px 24px rgba(15, 23, 42, .06);
      --tge-shadow-md: 0 4px 12px rgba(15, 23, 42, .08), 0 16px 40px rgba(15, 23, 42, .08);
      --tge-font: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-family: var(--tge-font);
      font-size: 15px;
      line-height: 1.5;
      color: var(--tge-text);
      display: block;
      width: 100%;
    }
    .tge-root[data-theme="dark"] {
      --tge-bg: #0F172A;
      --tge-bg-alt: #1E293B;
      --tge-text: #F1F5F9;
      --tge-sub: #94A3B8;
      --tge-border: #334155;
      --tge-border-strong: #475569;
      --tge-shadow: 0 1px 2px rgba(0, 0, 0, .3), 0 8px 24px rgba(0, 0, 0, .4);
      --tge-shadow-md: 0 4px 12px rgba(0, 0, 0, .35), 0 16px 40px rgba(0, 0, 0, .5);
    }

    .tge-shell {
      background: var(--tge-bg);
      color: var(--tge-text);
      border-radius: var(--tge-radius);
      border: 1px solid var(--tge-border);
      overflow: hidden;
      /* Respond to the WIDGET's own width, not the browser window. Embedded on a
         customer page the widget often sits in a column far narrower than the
         viewport, so the old viewport media queries never fired and the layout
         didn't adapt. All layout breakpoints below are @container. Note: this is
         the shell, not .tge-root — the fixed-position modal is a sibling of the
         shell (a child of .tge-root), so making the shell a query container
         (which also makes it a containing block for fixed descendants) leaves the
         modal viewport-anchored. */
      container-type: inline-size;
      container-name: tge;
    }

    /* Custom focus ring — replaces ugly browser default outline. */
    .tge-root :focus-visible {
      outline: 2px solid var(--tge-brand);
      outline-offset: 2px;
      border-radius: 6px;
    }
    .tge-root button:focus { outline: none; }
    .tge-root button:focus-visible {
      outline: 2px solid var(--tge-brand);
      outline-offset: 2px;
    }

    /* ---------- Header ---------- */
    .tge-header {
      padding: 22px 24px 18px;
      border-bottom: 1px solid var(--tge-border);
      display: flex;
      gap: 16px;
      align-items: center;
      flex-wrap: wrap;
    }
    .tge-title-block { flex: 1; min-width: 200px; }
    .tge-title {
      font-size: 19px;
      font-weight: 700;
      line-height: 1.25;
      letter-spacing: -0.015em;
      margin: 0 0 3px;
    }
    .tge-subtitle {
      font-size: 13.5px;
      color: var(--tge-sub);
      margin: 0;
      line-height: 1.4;
    }

    .tge-switcher {
      display: inline-flex;
      gap: 2px;
      padding: 3px;
      background: var(--tge-bg-alt);
      border: 1px solid var(--tge-border);
      border-radius: 9px;
    }
    .tge-switcher button {
      all: unset;
      cursor: pointer;
      padding: 6px 11px;
      font-size: 12.5px;
      font-weight: 600;
      color: var(--tge-sub);
      border-radius: 6px;
      transition: background 160ms ease, color 160ms ease, box-shadow 160ms ease;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      white-space: nowrap;
    }
    .tge-switcher button:hover { color: var(--tge-text); }
    .tge-switcher button[aria-pressed="true"] {
      background: var(--tge-bg);
      color: var(--tge-text);
      box-shadow: 0 1px 2px rgba(15, 23, 42, .06), 0 0 0 1px rgba(15, 23, 42, .04);
    }
    .tge-switcher svg { width: 13px; height: 13px; flex-shrink: 0; }

    /* ---------- Filters bar ---------- */
    .tge-filters {
      display: flex;
      gap: 6px;
      flex-wrap: wrap;
      padding: 12px 20px;
      border-bottom: 1px solid var(--tge-border);
      align-items: center;
    }
    .tge-filters-label {
      font-size: 11.5px;
      font-weight: 600;
      color: var(--tge-sub);
      text-transform: uppercase;
      letter-spacing: 0.06em;
      margin-right: 4px;
    }
    .tge-chip {
      all: unset;
      cursor: pointer;
      padding: 5px 11px;
      font-size: 12.5px;
      font-weight: 500;
      color: var(--tge-text);
      background: transparent;
      border: 1px solid var(--tge-border);
      border-radius: 99px;
      transition: background 140ms ease, border-color 140ms ease, color 140ms ease;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      line-height: 1.4;
    }
    .tge-chip:hover {
      border-color: var(--tge-border-strong);
      background: var(--tge-bg-alt);
    }
    .tge-chip[aria-pressed="true"] {
      background: rgba(var(--tge-cat-rgb, var(--tge-brand-rgb)), 0.10);
      border-color: rgba(var(--tge-cat-rgb, var(--tge-brand-rgb)), 0.35);
      color: var(--tge-cat, var(--tge-brand));
    }
    .tge-chip--all[aria-pressed="true"] {
      background: var(--tge-text);
      border-color: var(--tge-text);
      color: var(--tge-bg);
    }
    .tge-chip-dot {
      width: 7px;
      height: 7px;
      border-radius: 99px;
      background: currentColor;
      flex-shrink: 0;
    }
    .tge-chip-count {
      font-size: 11px;
      font-weight: 600;
      opacity: 0.65;
      margin-left: 2px;
      font-variant-numeric: tabular-nums;
    }

    /* ---------- LIST view ---------- */
    .tge-list { padding: 4px 0 8px; }
    .tge-list-month {
      padding: 18px 24px 8px;
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--tge-sub);
      background: var(--tge-bg);
    }
    .tge-list-month:first-child { padding-top: 14px; }

    .tge-list-item {
      all: unset;
      cursor: pointer;
      box-sizing: border-box;
      width: 100%;
      display: grid;
      grid-template-columns: 64px 1fr auto;
      gap: 16px;
      padding: 14px 24px 14px 21px;
      align-items: center;
      position: relative;
      border-top: 1px solid var(--tge-border);
      transition: background 160ms ease;
    }
    .tge-list-item:first-of-type { border-top: 0; }
    .tge-list-item::before {
      content: '';
      position: absolute;
      left: 0;
      top: 8px;
      bottom: 8px;
      width: 3px;
      border-radius: 0 3px 3px 0;
      background: var(--tge-cat, var(--tge-brand));
      opacity: 0;
      transition: opacity 200ms ease;
    }
    .tge-list-item:hover { background: var(--tge-bg-alt); }
    .tge-list-item:hover::before { opacity: 1; }

    .tge-list-date {
      text-align: center;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      line-height: 1;
    }
    .tge-list-day {
      font-size: 26px;
      font-weight: 700;
      letter-spacing: -0.025em;
      color: var(--tge-text);
      font-variant-numeric: tabular-nums;
    }
    .tge-list-mon {
      font-size: 10px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      color: var(--tge-sub);
      margin-top: 4px;
    }
    .tge-list-date-multi .tge-list-day { font-size: 20px; }
    .tge-list-date-multi .tge-list-mon { margin-top: 2px; }
    .tge-list-day-end { color: var(--tge-sub); }
    .tge-list-sep {
      font-size: 11px;
      color: var(--tge-sub);
      margin: 4px 0 2px;
      opacity: 0.7;
      line-height: 1;
    }
    .tge-list-content { min-width: 0; }
    .tge-list-name {
      font-size: 15px;
      font-weight: 600;
      line-height: 1.35;
      letter-spacing: -0.005em;
      margin: 0 0 4px;
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
      color: var(--tge-text);
    }
    .tge-list-name-text {
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .tge-list-meta {
      font-size: 12.5px;
      color: var(--tge-sub);
      display: flex;
      align-items: center;
      gap: 14px;
      flex-wrap: wrap;
      line-height: 1.4;
    }
    .tge-list-meta svg { width: 12px; height: 12px; flex-shrink: 0; opacity: 0.7; }
    .tge-list-meta-item { display: inline-flex; align-items: center; gap: 5px; }
    .tge-cat-tag {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      padding: 2px 8px;
      font-size: 11px;
      font-weight: 600;
      border-radius: 99px;
      background: rgba(var(--tge-cat-rgb, var(--tge-brand-rgb)), 0.10);
      color: var(--tge-cat, var(--tge-brand));
      letter-spacing: 0.005em;
    }
    .tge-cat-tag-dot {
      width: 5px;
      height: 5px;
      border-radius: 99px;
      background: currentColor;
    }
    .tge-list-arrow {
      color: var(--tge-sub);
      transition: transform 200ms cubic-bezier(0.16, 1, 0.3, 1), color 160ms ease;
      opacity: 0.5;
    }
    .tge-list-arrow svg { width: 16px; height: 16px; }
    .tge-list-item:hover .tge-list-arrow {
      color: var(--tge-cat, var(--tge-brand));
      transform: translateX(3px);
      opacity: 1;
    }

    /* ---------- MONTH view ---------- */
    .tge-month-nav {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 12px 16px;
      border-bottom: 1px solid var(--tge-border);
    }
    .tge-month-title {
      font-size: 17px;
      font-weight: 700;
      letter-spacing: -0.01em;
    }
    .tge-month-nav-btns { display: inline-flex; gap: 4px; }
    .tge-icon-btn {
      all: unset;
      cursor: pointer;
      width: 32px;
      height: 32px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border-radius: 8px;
      color: var(--tge-sub);
      transition: background 160ms ease, color 160ms ease;
    }
    .tge-icon-btn:hover { background: var(--tge-bg-alt); color: var(--tge-text); }
    .tge-icon-btn svg { width: 16px; height: 16px; }
    .tge-today-btn {
      all: unset;
      cursor: pointer;
      padding: 6px 12px;
      font-size: 13px;
      font-weight: 600;
      color: var(--tge-text);
      background: var(--tge-bg);
      border: 1px solid var(--tge-border);
      border-radius: 8px;
      transition: background 160ms ease, border-color 160ms ease;
    }
    .tge-today-btn:hover {
      background: var(--tge-bg-alt);
      border-color: var(--tge-border-strong);
    }

    .tge-grid {
      display: grid;
      grid-template-columns: repeat(7, 1fr);
      background: var(--tge-border);
      gap: 1px;
      border-bottom: 1px solid var(--tge-border);
    }
    .tge-dow {
      padding: 10px 8px;
      text-align: center;
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--tge-sub);
      background: var(--tge-bg-alt);
    }
    .tge-cell {
      min-height: 100px;
      padding: 8px;
      background: var(--tge-bg);
      display: flex;
      flex-direction: column;
      gap: 4px;
      cursor: default;
      transition: background 160ms ease;
    }
    .tge-cell.tge-cell--off { background: var(--tge-bg-alt); opacity: 0.55; }
    .tge-cell.tge-cell--has:hover { background: var(--tge-bg-alt); }
    .tge-cell-num {
      font-size: 13px;
      font-weight: 600;
      color: var(--tge-text);
      width: 26px;
      height: 26px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border-radius: 99px;
      flex-shrink: 0;
    }
    .tge-cell--today .tge-cell-num {
      background: var(--tge-brand);
      color: #FFFFFF;
    }
    .tge-cell-pill {
      display: block;
      padding: 3px 7px;
      font-size: 11px;
      font-weight: 600;
      line-height: 1.3;
      border-radius: 5px;
      background: rgba(var(--tge-cat-rgb, 8, 145, 178), 0.12);
      color: var(--tge-cat, var(--tge-accent));
      cursor: pointer;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      border-left: 3px solid var(--tge-cat, var(--tge-accent));
      transition: background 160ms ease;
    }
    .tge-cell-pill:hover { background: rgba(var(--tge-cat-rgb, 8, 145, 178), 0.20); }
    .tge-cell-more {
      font-size: 10px;
      color: var(--tge-sub);
      font-weight: 600;
      cursor: pointer;
      padding: 2px 4px;
    }
    .tge-cell-more:hover { color: var(--tge-text); }

    /* ---------- CARD view ---------- */
    .tge-cards {
      padding: 20px 24px 24px;
      display: grid;
      gap: 16px;
      grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    }
    .tge-card {
      background: var(--tge-bg);
      border: 1px solid var(--tge-border);
      border-radius: var(--tge-radius);
      overflow: hidden;
      cursor: pointer;
      transition: transform 220ms cubic-bezier(0.16, 1, 0.3, 1), box-shadow 220ms ease, border-color 160ms ease;
      display: flex;
      flex-direction: column;
    }
    .tge-card:hover {
      transform: translateY(-3px);
      box-shadow: var(--tge-shadow-md);
      border-color: var(--tge-border-strong);
    }
    .tge-card-img {
      aspect-ratio: 16 / 10;
      background: var(--tge-bg-alt);
      background-size: cover;
      background-position: center;
      position: relative;
    }
    .tge-card-img--placeholder {
      background-image: linear-gradient(135deg, rgba(var(--tge-cat-rgb, 8, 145, 178), 0.18), rgba(var(--tge-cat-rgb, 8, 145, 178), 0.05));
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .tge-card-cat-badge {
      position: absolute;
      top: 10px;
      left: 10px;
      padding: 4px 10px;
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      border-radius: 99px;
      background: var(--tge-cat, var(--tge-accent));
      color: #FFFFFF;
    }
    .tge-card-date-badge {
      position: absolute;
      top: 10px;
      right: 10px;
      padding: 4px 10px;
      font-size: 11px;
      font-weight: 600;
      border-radius: 8px;
      background: rgba(15, 23, 42, 0.7);
      color: #FFFFFF;
      backdrop-filter: blur(6px);
      -webkit-backdrop-filter: blur(6px);
    }
    .tge-card-body {
      padding: 14px 16px 16px;
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .tge-card-name {
      font-size: 16px;
      font-weight: 700;
      line-height: 1.3;
      letter-spacing: -0.005em;
      margin: 0;
    }
    .tge-card-meta {
      font-size: 13px;
      color: var(--tge-sub);
      display: flex;
      align-items: center;
      gap: 5px;
    }
    .tge-card-meta svg { width: 13px; height: 13px; }
    .tge-card-desc {
      font-size: 13px;
      color: var(--tge-sub);
      line-height: 1.5;
      margin-top: 4px;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }

    /* ---------- Empty / loading ---------- */
    .tge-empty {
      padding: 48px 24px;
      text-align: center;
      color: var(--tge-sub);
    }
    .tge-empty-ico {
      width: 48px;
      height: 48px;
      margin: 0 auto 12px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border-radius: 99px;
      background: var(--tge-bg-alt);
      color: var(--tge-sub);
    }
    .tge-empty-ico svg { width: 24px; height: 24px; }
    .tge-empty-title {
      font-weight: 600;
      color: var(--tge-text);
      margin-bottom: 4px;
    }
    .tge-loading {
      padding: 32px;
      text-align: center;
      color: var(--tge-sub);
      font-size: 14px;
    }
    .tge-spinner {
      display: inline-block;
      width: 18px;
      height: 18px;
      border-radius: 99px;
      border: 2px solid var(--tge-border);
      border-top-color: var(--tge-brand);
      animation: tge-spin 800ms linear infinite;
      vertical-align: middle;
      margin-right: 8px;
    }
    @keyframes tge-spin { to { transform: rotate(360deg); } }

    /* ---------- Modal ---------- */
    .tge-modal-bg {
      position: fixed;
      inset: 0;
      background: rgba(15, 23, 42, 0.55);
      backdrop-filter: blur(4px);
      -webkit-backdrop-filter: blur(4px);
      z-index: 2147483646;
      opacity: 0;
      transition: opacity 200ms ease;
    }
    .tge-modal-bg.tge-open { opacity: 1; }
    .tge-modal {
      position: fixed;
      inset: 0;
      z-index: 2147483647;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 16px;
      pointer-events: none;
    }
    .tge-modal-card {
      pointer-events: auto;
      background: var(--tge-bg);
      color: var(--tge-text);
      border-radius: var(--tge-radius);
      box-shadow: var(--tge-shadow-md);
      max-width: 520px;
      width: 100%;
      max-height: 85vh;
      overflow: hidden;
      display: flex;
      flex-direction: column;
      transform: translateY(16px) scale(0.97);
      opacity: 0;
      transition: transform 280ms cubic-bezier(0.16, 1, 0.3, 1), opacity 200ms ease;
    }
    .tge-modal-card.tge-open { transform: translateY(0) scale(1); opacity: 1; }
    .tge-modal-img {
      width: 100%;
      aspect-ratio: 16 / 9;
      background-size: cover;
      background-position: center;
      background-color: var(--tge-bg-alt);
    }
    .tge-modal-body {
      padding: 22px 24px 24px;
      overflow-y: auto;
    }
    .tge-modal-close {
      position: absolute;
      top: 12px;
      right: 12px;
      width: 32px;
      height: 32px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border-radius: 99px;
      background: rgba(15, 23, 42, 0.6);
      color: #FFFFFF;
      border: 0;
      cursor: pointer;
      transition: background 160ms ease;
    }
    .tge-modal-close:hover { background: rgba(15, 23, 42, 0.85); }
    .tge-modal-close svg { width: 16px; height: 16px; }
    .tge-modal-cat {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 4px 10px;
      border-radius: 99px;
      background: rgba(var(--tge-cat-rgb, 8, 145, 178), 0.12);
      color: var(--tge-cat, var(--tge-accent));
      font-size: 12px;
      font-weight: 600;
      margin-bottom: 12px;
    }
    .tge-modal-name {
      font-size: 22px;
      font-weight: 700;
      line-height: 1.25;
      letter-spacing: -0.015em;
      margin: 0 0 10px;
    }
    .tge-modal-meta {
      display: flex;
      flex-direction: column;
      gap: 6px;
      margin-bottom: 14px;
      font-size: 14px;
      color: var(--tge-sub);
    }
    .tge-modal-meta-row { display: flex; align-items: center; gap: 8px; }
    .tge-modal-meta svg { width: 15px; height: 15px; flex-shrink: 0; }
    .tge-modal-desc {
      font-size: 14px;
      color: var(--tge-text);
      line-height: 1.6;
      margin-bottom: 16px;
    }
    .tge-modal-cta {
      all: unset;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 10px 18px;
      font-size: 14px;
      font-weight: 600;
      background: var(--tge-brand);
      color: #FFFFFF;
      border-radius: 10px;
      transition: filter 160ms ease, transform 160ms ease;
    }
    .tge-modal-cta:hover { filter: brightness(1.07); }
    .tge-modal-cta:active { transform: scale(0.97); }
    .tge-modal-cta svg { width: 14px; height: 14px; }

    /* ---------- Day list ("+N more") ---------- */
    .tge-daylist { display: flex; flex-direction: column; gap: 8px; margin-top: 4px; }
    .tge-daylist-row {
      all: unset; box-sizing: border-box; cursor: pointer; display: flex; align-items: center; gap: 12px;
      padding: 12px 14px; border-radius: 12px; background: var(--tge-bg-alt);
      border: 1px solid var(--tge-border); transition: background 160ms ease, transform 120ms ease;
    }
    .tge-daylist-row:hover { background: var(--tge-bg); border-color: var(--tge-border-strong); }
    .tge-daylist-row:focus-visible { outline: 2px solid var(--tge-brand); outline-offset: 2px; }
    .tge-daylist-row:active { transform: scale(0.99); }
    .tge-daylist-dot { width: 10px; height: 10px; border-radius: 50%; background: var(--tge-cat, var(--tge-brand)); flex: none; }
    .tge-daylist-info { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1; }
    .tge-daylist-name { font-size: 14px; font-weight: 600; color: var(--tge-text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .tge-daylist-meta { font-size: 12px; color: var(--tge-sub); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .tge-daylist-arr { width: 16px; height: 16px; color: var(--tge-sub); flex: none; }

    /* ---------- Responsive ---------- */
    /* Container query — reacts to the widget's OWN width (see .tge-shell). */
    @container tge (max-width: 640px) {
      .tge-header { padding: 16px; flex-direction: column; align-items: stretch; }
      .tge-filters { padding: 12px 16px; }
      .tge-list-item { grid-template-columns: 56px 1fr auto; gap: 12px; padding: 12px 16px; }
      .tge-list-day { font-size: 18px; }
      .tge-list-month { padding: 12px 16px 4px; }
      .tge-cell { min-height: 64px; padding: 4px; }
      .tge-cell-num { font-size: 12px; width: 22px; height: 22px; }
      .tge-cell-pill { font-size: 10px; padding: 2px 5px; }
      .tge-month-nav { padding: 10px 12px; }
      .tge-month-title { font-size: 15px; }
      .tge-cards { padding: 16px; gap: 12px; }
    }

    /* The modal is a full-viewport overlay sitting OUTSIDE the .tge-shell query
       container, so its heading scales to the viewport, not the widget width. */
    @media (max-width: 640px) {
      .tge-modal-name { font-size: 18px; }
    }

    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after {
        animation-duration: 0.001ms !important;
        transition-duration: 0.001ms !important;
      }
    }
  `;

  // ---------- Event normalisation ----------
  // Both curated (from Airtable via API) and custom (from config) events get
  // normalised into the same shape so the renderers don't care which source they came from.
  function normaliseEvents(rawList, source) {
    if (!Array.isArray(rawList)) return [];
    const out = [];
    for (const raw of rawList) {
      if (!raw || typeof raw !== 'object') continue;
      const name = String(raw.name || raw.eventName || '').trim().slice(0, 200);
      if (!name) continue;

      const startStr = String(raw.startDate || raw.dateStart || '').slice(0, 10);
      const start = parseDate(startStr);
      if (!start) continue;

      const endStr = String(raw.endDate || raw.dateEnd || raw.startDate || '').slice(0, 10);
      const end = parseDate(endStr) || start;

      const cat = String(raw.category || '').trim().slice(0, 60) || 'Event';
      const meta = categoryMeta(cat);

      out.push({
        id: String(raw.id || (source + ':' + name + ':' + startStr)).slice(0, 100),
        source: source,
        name: name,
        startDate: fmtDate(start),
        endDate: fmtDate(end),
        startTs: start.getTime(),
        endTs: end.getTime(),
        category: cat,
        location: String(raw.location || raw.destinations || '').trim().slice(0, 200),
        countries: String(raw.countries || '').trim().slice(0, 200),
        description: String(raw.description || raw.travelAngle || '').trim().slice(0, 800),
        url: safeUrl(raw.url || raw.ctaUrl || ''),
        image: safeImageUrl(raw.image || ''),
        catColor: raw.color && /^#[0-9a-fA-F]{6}$/.test(raw.color) ? raw.color : meta.color,
        catIcon: meta.icon,
      });
    }
    out.sort((a, b) => a.startTs - b.startTs);
    return out;
  }

  // ---------- Main widget class ----------
  class TGEventsWidget {
    constructor(container, config) {
      this.el = container;
      this.cfg = Object.assign({}, DEFAULTS, config || {});
      ensureFont(safeFontStackE(this.cfg.fontFamily, ''));   // load the client-chosen web font on the host site (house rule 2)
      this.t = makeT(this.cfg);   // resolve viewer language + UI strings
      this.shadow = container.attachShadow({ mode: 'open' });

      // Internal state
      this.layout = this.cfg.layout || 'list';
      this.activeCategory = this.cfg.defaultCategory || 'all';
      this.activeCountry  = 'all';
      this.viewedMonth = startOfMonth(new Date());
      this.curatedEvents = [];   // populated async
      this.curatedLoaded = false;
      this.curatedError = false;
      this._modalEl = null;
      this._kbdHandler = null;

      this._render();

      // Async fetch curated events
      if (this.cfg.useCuratedEvents !== false) {
        this._fetchCurated();
      } else {
        this.curatedLoaded = true;
        this._renderBody();
      }
    }

    // Combined event list, post-filters
    _allEvents() {
      const custom  = normaliseEvents(this.cfg.customEvents || [], 'custom');
      const curated = this.curatedEvents || [];
      return [...curated, ...custom].sort((a, b) => a.startTs - b.startTs);
    }

    _filtered(events) {
      const cat = (this.activeCategory || 'all').toLowerCase();
      const co  = (this.activeCountry  || 'all').toLowerCase();
      return events.filter(e => {
        if (cat !== 'all' && (e.category || '').toLowerCase() !== cat) return false;
        if (co  !== 'all' && !(e.countries || '').toLowerCase().includes(co)) return false;
        return true;
      });
    }

    _categories(events) {
      const set = new Set();
      events.forEach(e => { if (e.category) set.add(e.category); });
      return Array.from(set).sort();
    }

    async _fetchCurated() {
      if (!this.cfg.widgetId && !(this.cfg._directLevel && this.cfg._directRecord)) {
        // No widget ID — use editor-mode direct fetch via window flag, otherwise skip
        const params = this._buildCuratedQuery();
        if (!params) {
          this.curatedLoaded = true;
          this._renderBody();
          return;
        }
        try {
          const url = EVENTS_API + '?' + params.toString();
          const headers = (window.__TG_EDITOR_AUTH_HEADERS__ && typeof window.__TG_EDITOR_AUTH_HEADERS__ === 'function')
            ? window.__TG_EDITOR_AUTH_HEADERS__() : {};
          const r = await fetch(url, { headers });
          if (!r.ok) {
            let detail = '';
            try { const j = await r.json(); detail = j.hint || j.error || ''; } catch {}
            console.error('[tg-events] fetch failed', r.status, detail);
            throw new Error('events-fetch-' + r.status);
          }
          const j = await r.json();
          this.curatedEvents = normaliseEvents(j.events || [], 'curated');
        } catch (err) {
          this.curatedError = true;
        } finally {
          this.curatedLoaded = true;
          this._renderBody();
        }
        return;
      }

      try {
        const url = EVENTS_API + '?id=' + encodeURIComponent(this.cfg.widgetId);
        // Reuse the feed request the init fired in parallel with the config
        // fetch, if any. Consume once, then fall back to a fresh fetch.
        const prefetched = this.cfg && this.cfg.__contentResponse;
        if (this.cfg) this.cfg.__contentResponse = null;
        const r = await (prefetched || fetch(url));
        if (!r.ok) {
          let detail = '';
          try { const j = await r.json(); detail = j.hint || j.error || ''; } catch {}
          console.error('[tg-events] fetch failed', r.status, detail);
          throw new Error('events-fetch-' + r.status);
        }
        const j = await r.json();
        this.curatedEvents = normaliseEvents(j.events || [], 'curated');
      } catch (err) {
        this.curatedError = true;
      } finally {
        this.curatedLoaded = true;
        this._renderBody();
      }
    }

    _buildCuratedQuery() {
      // Editor-preview path. We deliberately do NOT send category/country/
      // audience filters: the editor is meant to show ALL events from the
      // feed and the visitor filters down using the on-widget chip row.
      // The cfg.curatedCountries / curatedCategories / curatedAudience
      // arrays remain in the schema for backward compatibility but are
      // no longer used to query Airtable.
      const params = new URLSearchParams();
      params.set('preview', '1');
      params.set('months', String(Math.min(24, Math.max(1, this.cfg.monthsAhead || 12))));
      return params;
    }

    _render() {
      // Build the static skeleton with embedded styles. Body content rendered separately.
      const cfg = this.cfg;
      const fontImport = cfg.fontFamily ? `@import url('https://fonts.googleapis.com/css2?family=${encodeURIComponent(cfg.fontFamily)}:wght@400;500;600;700&display=swap');` : '';

      const brandRgb  = hexToRgb(cfg.brand) || '249, 115, 22';
      const accentHex = cfg.accent || '#0891B2';

      const ff = safeFontStackE(cfg.fontFamily, '');
      const inlineVars =
        '--tge-brand:' + safeColorE(cfg.brand, '#F97316') + ';' +
        '--tge-brand-rgb:' + brandRgb + ';' +
        '--tge-accent:' + safeColorE(accentHex, '#0891B2') + ';' +
        (cfg.bg     ? '--tge-bg:' + safeColorE(cfg.bg, '#FFFFFF') + ';' : '') +
        (cfg.text   ? '--tge-text:' + safeColorE(cfg.text, '#0F172A') + ';' : '') +
        (cfg.sub    ? '--tge-sub:' + safeColorE(cfg.sub, '#64748B') + ';' : '') +
        (cfg.border ? '--tge-border:' + safeColorE(cfg.border, '#E2E8F0') + ';' : '') +
        (cfg.radius ? '--tge-radius:' + Math.max(0, Math.min(40, cfg.radius)) + 'px;' : '') +
        (ff ? "--tge-font:'" + ff.replace(/'/g, '') + "', 'Inter', sans-serif;" : '');

      const theme = cfg.theme === 'dark' ? 'dark' : 'light';

      this.shadow.innerHTML = '<style>' + fontImport + STYLES + '</style>'
        + '<div class="tge-root" data-theme="' + theme + '" style="' + esc(inlineVars) + '">'
        + '<div class="tge-shell">'
        + this._renderHeader()
        + '<div class="tge-filters-mount"></div>'
        + '<div class="tge-body-mount"></div>'
        + '</div></div>';

      this._renderBody();
      this._bindHeader();
    }

    _renderHeader() {
      const cfg = this.cfg;
      if (!cfg.showHeader) return '';
      const switcher = cfg.showLayoutSwitcher
        ? '<div class="tge-switcher" role="group" aria-label="' + esc(this.t('viewGroup')) + '">'
          + this._switchBtn('list',  this.t('viewList'),  IC.list)
          + this._switchBtn('month', this.t('viewMonth'), IC.cal)
          + this._switchBtn('card',  this.t('viewCards'), IC.card)
          + '</div>'
        : '';
      return '<div class="tge-header">'
        + '<div class="tge-title-block">'
        + (cfg.title    ? '<h2 class="tge-title">' + esc(cfg.title) + '</h2>' : '')
        + (cfg.subtitle ? '<p class="tge-subtitle">' + esc(cfg.subtitle) + '</p>' : '')
        + '</div>'
        + switcher
        + '</div>';
    }

    _switchBtn(layout, label, iconPath) {
      const pressed = layout === this.layout;
      return '<button data-layout="' + layout + '" aria-pressed="' + pressed + '" type="button">'
        + svgPath(iconPath, '') + esc(label)
        + '</button>';
    }

    _bindHeader() {
      this.shadow.querySelectorAll('.tge-switcher button').forEach(btn => {
        btn.addEventListener('click', () => {
          const l = btn.getAttribute('data-layout');
          if (!l || l === this.layout) return;
          this.layout = l;
          this._render();
        });
      });
    }

    _renderBody() {
      const filtersMount = this.shadow.querySelector('.tge-filters-mount');
      const bodyMount    = this.shadow.querySelector('.tge-body-mount');
      if (!filtersMount || !bodyMount) return;

      if (!this.curatedLoaded && this.cfg.useCuratedEvents !== false) {
        filtersMount.innerHTML = '';
        bodyMount.innerHTML = '<div class="tge-loading"><span class="tge-spinner"></span> ' + esc(this.t('loading')) + '</div>';
        return;
      }

      const all = this._allEvents();
      filtersMount.innerHTML = this._renderFilters(all);
      this._bindFilters();

      const filtered = this._filtered(all);

      if (this.layout === 'month') bodyMount.innerHTML = this._renderMonth(filtered);
      else if (this.layout === 'card') bodyMount.innerHTML = this._renderCards(filtered);
      else bodyMount.innerHTML = this._renderList(filtered);

      this._bindBody();
    }

    _renderFilters(events) {
      const cfg = this.cfg;
      if (!cfg.showFilters || !cfg.showCategoryFilter) return '';
      const cats = this._categories(events);
      if (cats.length <= 1) return '';

      const allCount = events.length;
      const allActive = this.activeCategory === 'all';
      let html = '<div class="tge-filters">';
      html += '<button class="tge-chip tge-chip--all" data-cat="all" aria-pressed="' + allActive + '" type="button">'
        + esc(this.t('allEvents'))
        + '<span class="tge-chip-count">' + allCount + '</span>'
        + '</button>';

      cats.forEach(c => {
        const meta = categoryMeta(c);
        const active = (this.activeCategory.toLowerCase() === c.toLowerCase());
        const count = events.filter(e => (e.category || '').toLowerCase() === c.toLowerCase()).length;
        const rgb = hexToRgb(meta.color) || '8, 145, 178';
        html += '<button class="tge-chip" data-cat="' + esc(c) + '" aria-pressed="' + active + '" '
          + 'style="--tge-cat:' + meta.color + ';--tge-cat-rgb:' + rgb + '" type="button">'
          + '<span class="tge-chip-dot" style="background:' + meta.color + '"></span>'
          + esc(c)
          + '<span class="tge-chip-count">' + count + '</span>'
          + '</button>';
      });

      html += '</div>';
      return html;
    }

    _bindFilters() {
      this.shadow.querySelectorAll('.tge-chip[data-cat]').forEach(btn => {
        btn.addEventListener('click', () => {
          this.activeCategory = btn.getAttribute('data-cat') || 'all';
          this._renderBody();
        });
      });
    }

    _renderList(events) {
      const cfg = this.cfg;
      if (!events.length) return this._renderEmpty();

      // Filter to events that have not yet ended.
      // We treat "today" as start-of-day local so an event with a single
      // date today still shows. An event whose end date is yesterday or
      // earlier is hidden, even if its end timestamp technically rolls to
      // ~midnight tomorrow in some timezones.
      const startOfToday = new Date();
      startOfToday.setHours(0, 0, 0, 0);
      const todayMs = startOfToday.getTime();
      const horizon = todayMs + (cfg.monthsAhead || 6) * 31 * 86400000;

      const upcoming = events.filter(e => {
        // Use whichever is later: endTs or startTs (some events have no end date)
        const lastDayMs = Math.max(e.endTs || 0, e.startTs || 0);
        return lastDayMs >= todayMs && (e.startTs || lastDayMs) <= horizon;
      });
      if (!upcoming.length) return this._renderEmpty();

      const out = [];
      let lastKey = '';
      for (const e of upcoming) {
        const dt = parseDate(e.startDate);
        if (!dt) continue;
        const monthsLong = this.t('months');
        const monthsShort = this.t('monthsShort');
        const key = dt.getFullYear() + '-' + dt.getMonth();
        if (key !== lastKey) {
          out.push('<div class="tge-list-month">' + esc(monthsLong[dt.getMonth()]) + ' ' + dt.getFullYear() + '</div>');
          lastKey = key;
        }
        const meta = categoryMeta(e.category);
        const catRgb = hexToRgb(e.catColor || meta.color) || '8, 145, 178';
        const dateRange = fmtRange(e.startDate, e.endDate, this.t);
        const endDt = parseDate(e.endDate);
        const isMultiDay = endDt && !sameDay(dt, endDt);
        const datePillHtml = isMultiDay
          ? '<div class="tge-list-day">' + dt.getDate() + '</div>'
            + '<div class="tge-list-mon">' + esc(monthsShort[dt.getMonth()]) + '</div>'
            + '<div class="tge-list-sep" aria-hidden="true">→</div>'
            + '<div class="tge-list-day tge-list-day-end">' + endDt.getDate() + '</div>'
            + '<div class="tge-list-mon">' + esc(monthsShort[endDt.getMonth()]) + '</div>'
          : '<div class="tge-list-day">' + dt.getDate() + '</div>'
            + '<div class="tge-list-mon">' + esc(monthsShort[dt.getMonth()]) + '</div>';
        out.push(
          '<button class="tge-list-item" data-event-id="' + esc(e.id) + '" type="button" '
          + 'style="--tge-cat:' + (e.catColor || meta.color) + ';--tge-cat-rgb:' + catRgb + '">'
          + '<div class="tge-list-date' + (isMultiDay ? ' tge-list-date-multi' : '') + '">'
            + datePillHtml
          + '</div>'
          + '<div class="tge-list-content">'
            + '<div class="tge-list-name">'
              + '<span class="tge-list-name-text">' + esc(e.name) + '</span>'
              + '<span class="tge-cat-tag"><span class="tge-cat-tag-dot"></span>' + esc(e.category) + '</span>'
            + '</div>'
            + '<div class="tge-list-meta">'
              + '<span class="tge-list-meta-item">' + svgPath(IC.cal, '') + esc(dateRange) + '</span>'
              + (e.location && cfg.showLocations ? '<span class="tge-list-meta-item">' + svgPath(IC.pin, '') + esc(e.location) + '</span>' : '')
            + '</div>'
          + '</div>'
          + '<div class="tge-list-arrow">' + svgPath(IC.chevR, '') + '</div>'
          + '</button>'
        );
      }
      return '<div class="tge-list" role="list">' + out.join('') + '</div>';
    }

    _renderMonth(events) {
      const month = this.viewedMonth;
      const first = startOfMonth(month);
      const last  = endOfMonth(month);
      const startDow = first.getDay(); // 0 Sun
      const today = new Date(); today.setHours(0,0,0,0);

      // 6 rows × 7 cols = 42 cells. Start at first day of week before/at first.
      const gridStart = new Date(first);
      gridStart.setDate(first.getDate() - startDow);

      const cells = [];
      for (let i = 0; i < 42; i++) {
        const d = new Date(gridStart);
        d.setDate(gridStart.getDate() + i);
        cells.push(d);
      }

      // Index events by date string for quick lookup
      const evByDay = new Map();
      for (const e of events) {
        const s = parseDate(e.startDate);
        const en = parseDate(e.endDate) || s;
        if (!s) continue;
        // For each day from s to en (capped at 31 days to prevent runaway loops)
        const cap = 31;
        for (let i = 0; i < cap; i++) {
          const cur = new Date(s);
          cur.setDate(s.getDate() + i);
          if (cur > en) break;
          const k = fmtDate(cur);
          if (!evByDay.has(k)) evByDay.set(k, []);
          evByDay.get(k).push(e);
        }
      }

      const daysShort = this.t('daysShort');
      const dowCells = daysShort.map(d => '<div class="tge-dow">' + esc(d) + '</div>').join('');
      const cellHtml = cells.map(d => {
        const off = d.getMonth() !== month.getMonth();
        const isToday = sameDay(d, today);
        const dayEvents = evByDay.get(fmtDate(d)) || [];
        const hasEvents = dayEvents.length > 0;
        const visible = dayEvents.slice(0, 3);
        const overflow = dayEvents.length - visible.length;
        const cls = ['tge-cell'];
        if (off) cls.push('tge-cell--off');
        if (isToday) cls.push('tge-cell--today');
        if (hasEvents) cls.push('tge-cell--has');
        return '<div class="' + cls.join(' ') + '">'
          + '<div class="tge-cell-num">' + d.getDate() + '</div>'
          + visible.map(e => {
              const meta = categoryMeta(e.category);
              const catColor = e.catColor || meta.color;
              const catRgb = hexToRgb(catColor) || '8, 145, 178';
              return '<button class="tge-cell-pill" data-event-id="' + esc(e.id) + '" '
                + 'style="--tge-cat:' + catColor + ';--tge-cat-rgb:' + catRgb + '" type="button" title="' + esc(e.name) + '">'
                + esc(e.name)
                + '</button>';
            }).join('')
          + (overflow > 0 ? '<button class="tge-cell-more" type="button" data-day="' + fmtDate(d) + '">' + esc(this.t('more', { n: overflow })) + '</button>' : '')
          + '</div>';
      }).join('');

      return '<div class="tge-month-nav">'
        + '<div class="tge-month-title">' + esc(this.t('months')[month.getMonth()]) + ' ' + month.getFullYear() + '</div>'
        + '<div class="tge-month-nav-btns">'
          + '<button class="tge-today-btn" data-month-action="today" type="button">' + esc(this.t('today')) + '</button>'
          + '<button class="tge-icon-btn" data-month-action="prev" aria-label="' + esc(this.t('prevMonth')) + '" type="button">' + svgPath(IC.chevL, '') + '</button>'
          + '<button class="tge-icon-btn" data-month-action="next" aria-label="' + esc(this.t('nextMonth')) + '" type="button">' + svgPath(IC.chevR, '') + '</button>'
        + '</div>'
        + '</div>'
        + '<div class="tge-grid">' + dowCells + cellHtml + '</div>';
    }

    _renderCards(events) {
      const cfg = this.cfg;
      const startOfToday = new Date();
      startOfToday.setHours(0, 0, 0, 0);
      const todayMs = startOfToday.getTime();
      const upcoming = events.filter(e => {
        const lastDayMs = Math.max(e.endTs || 0, e.startTs || 0);
        return lastDayMs >= todayMs;
      }).slice(0, Math.max(1, Math.min(36, cfg.cardCount || 6)));
      if (!upcoming.length) return this._renderEmpty();

      const cards = upcoming.map(e => {
        const meta = categoryMeta(e.category);
        const catColor = e.catColor || meta.color;
        const catRgb = hexToRgb(catColor) || '8, 145, 178';
        const placeholderSvg = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="width:36px;height:36px;color:var(--tge-cat, var(--tge-brand));opacity:0.55"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>';
        const img = (cfg.showImages !== false && e.image)
          ? '<div class="tge-card-img" style="background-image:url(' + esc(e.image) + ')">'
          : '<div class="tge-card-img tge-card-img--placeholder" style="--tge-cat-rgb:' + catRgb + '">' + placeholderSvg;
        const dateRange = fmtRange(e.startDate, e.endDate, this.t);
        return '<button class="tge-card" data-event-id="' + esc(e.id) + '" type="button" '
          + 'style="--tge-cat:' + catColor + ';--tge-cat-rgb:' + catRgb + '">'
          + img
            + '<span class="tge-card-cat-badge">' + esc(e.category) + '</span>'
            + '<span class="tge-card-date-badge">' + esc(dateRange) + '</span>'
          + '</div>'
          + '<div class="tge-card-body">'
            + '<h3 class="tge-card-name">' + esc(e.name) + '</h3>'
            + (e.location && cfg.showLocations
                ? '<div class="tge-card-meta">' + svgPath(IC.pin, '') + esc(e.location) + '</div>'
                : '')
            + (e.description && cfg.showDescriptions
                ? '<p class="tge-card-desc">' + esc(e.description) + '</p>'
                : '')
          + '</div>'
          + '</button>';
      });
      return '<div class="tge-cards">' + cards.join('') + '</div>';
    }

    _renderEmpty() {
      const msg = this.curatedError ? this.t('emptyError') : this.t('emptyNone');
      return '<div class="tge-empty">'
        + '<div class="tge-empty-ico">' + svgPath(IC.cal, '') + '</div>'
        + '<div class="tge-empty-title">' + esc(this.t('emptyTitle')) + '</div>'
        + '<div>' + esc(msg) + '</div>'
        + '</div>';
    }

    _bindBody() {
      // Click handlers for events
      this.shadow.querySelectorAll('[data-event-id]').forEach(el => {
        el.addEventListener('click', (ev) => {
          ev.stopPropagation();
          const id = el.getAttribute('data-event-id');
          this._handleEventClick(id);
        });
      });

      // Month navigation
      this.shadow.querySelectorAll('[data-month-action]').forEach(btn => {
        btn.addEventListener('click', () => {
          const a = btn.getAttribute('data-month-action');
          if (a === 'prev')  this.viewedMonth = addMonths(this.viewedMonth, -1);
          if (a === 'next')  this.viewedMonth = addMonths(this.viewedMonth, 1);
          if (a === 'today') this.viewedMonth = startOfMonth(new Date());
          this._renderBody();
        });
      });

      // "More" pill in month view → open list filtered to that day
      this.shadow.querySelectorAll('.tge-cell-more').forEach(btn => {
        btn.addEventListener('click', (ev) => {
          ev.stopPropagation();
          const day = btn.getAttribute('data-day');
          if (!day) return;
          const events = this._allEvents().filter(e => {
            const s = parseDate(e.startDate); const en = parseDate(e.endDate) || s;
            const target = parseDate(day);
            return target && s && dateInRange(target, s, en);
          });
          if (events.length) this._openModalList(day, events);
        });
      });
    }

    _findEvent(id) {
      return this._allEvents().find(e => e.id === id);
    }

    _handleEventClick(id) {
      const e = this._findEvent(id);
      if (!e) return;
      const mode = this.cfg.onClick || 'modal';
      if (mode === 'link' && e.url) {
        window.open(e.url, '_blank', 'noopener,noreferrer');
        return;
      }
      if (mode === 'none') return;
      this._openModal(e);
    }

    _openModal(e) {
      // Prefer an already-recorded opener (e.g. the "+N more" button behind a day
      // list) so closing the detail modal returns focus to the real origin.
      const trigger = this._modalTrigger || this.shadow.activeElement;
      this._closeModal();
      const meta = categoryMeta(e.category);
      const catColor = e.catColor || meta.color;
      const catRgb = hexToRgb(catColor) || '8, 145, 178';
      const dateRange = fmtRange(e.startDate, e.endDate, this.t);

      const root = this.shadow.querySelector('.tge-root');
      const modalHtml = ''
        + '<div class="tge-modal-bg" data-tge-modal></div>'
        + '<div class="tge-modal" role="dialog" aria-modal="true" aria-labelledby="tge-modal-title">'
          + '<div class="tge-modal-card" style="position:relative;--tge-cat:' + catColor + ';--tge-cat-rgb:' + catRgb + '">'
            + '<button class="tge-modal-close" type="button" aria-label="' + esc(this.t('close')) + '">' + svgPath(IC.close, '') + '</button>'
            + (e.image && this.cfg.showImages !== false
                ? '<div class="tge-modal-img" style="background-image:url(' + esc(e.image) + ')"></div>'
                : '')
            + '<div class="tge-modal-body">'
              + '<span class="tge-modal-cat"><span class="tge-cat-tag-dot"></span>' + esc(e.category) + '</span>'
              + '<h3 class="tge-modal-name" id="tge-modal-title">' + esc(e.name) + '</h3>'
              + '<div class="tge-modal-meta">'
                + '<div class="tge-modal-meta-row">' + svgPath(IC.cal, '') + '<span>' + esc(dateRange) + '</span></div>'
                + (e.location ? '<div class="tge-modal-meta-row">' + svgPath(IC.pin, '') + '<span>' + esc(e.location) + '</span></div>' : '')
              + '</div>'
              + (e.description && this.cfg.showDescriptions !== false
                  ? '<div class="tge-modal-desc">' + esc(e.description) + '</div>'
                  : '')
              + (e.url
                  ? '<a class="tge-modal-cta" href="' + esc(e.url) + '" target="_blank" rel="noopener noreferrer">'
                    + esc(this.t('findOutMore')) + svgPath(IC.arrow, '')
                    + '</a>'
                  : '')
            + '</div>'
          + '</div>'
        + '</div>';

      const wrap = document.createElement('div');
      wrap.innerHTML = modalHtml;
      while (wrap.firstChild) root.appendChild(wrap.firstChild);

      this._modalEl = root.querySelector('.tge-modal');
      const bg = root.querySelector('.tge-modal-bg');
      const card = root.querySelector('.tge-modal-card');
      requestAnimationFrame(() => {
        bg && bg.classList.add('tge-open');
        card && card.classList.add('tge-open');
      });

      const close = () => this._closeModal();
      bg && bg.addEventListener('click', close);
      const closeBtn = root.querySelector('.tge-modal-close');
      closeBtn && closeBtn.addEventListener('click', close);
      this._modalTrigger = trigger;
      this._kbdHandler = (ev) => {
        if (ev.key === 'Escape') { close(); return; }
        this._trapTab(ev, card);
      };
      document.addEventListener('keydown', this._kbdHandler);
      // Move focus into the dialog so keyboard users land on a control inside it.
      requestAnimationFrame(() => { closeBtn && closeBtn.focus(); });
    }

    // Keep Tab focus inside the open modal card (elements live in the shadow root).
    _trapTab(ev, card) {
      if (ev.key !== 'Tab' || !card) return;
      const focusable = card.querySelectorAll('a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])');
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = this.shadow.activeElement;
      if (ev.shiftKey && active === first) { ev.preventDefault(); last.focus(); }
      else if (!ev.shiftKey && active === last) { ev.preventDefault(); first.focus(); }
    }

    _openModalList(dayStr, events) {
      if (!events || !events.length) return;
      // Single hidden event → straight to its detail modal.
      if (events.length === 1) { this._openModal(events[0]); return; }

      // Multiple events → a real day list, each row opening its own detail modal.
      // Previously this opened events[0] (already visible as pill #1), so the 4th,
      // 5th … events the "+N more" button counted were unreachable.
      const trigger = this.shadow.activeElement;
      this._closeModal();
      const heading = fmtRange(dayStr, dayStr, this.t) || esc(this.t('close'));
      let rows = '';
      events.forEach((e, i) => {
        const meta = categoryMeta(e.category);
        const catColor = e.catColor || meta.color;
        rows += '<button type="button" class="tge-daylist-row" data-tge-idx="' + i + '" style="--tge-cat:' + catColor + '">'
          + '<span class="tge-daylist-dot"></span>'
          + '<span class="tge-daylist-info">'
            + '<span class="tge-daylist-name">' + esc(e.name) + '</span>'
            + '<span class="tge-daylist-meta">' + esc(e.category || '')
              + (e.location ? ' · ' + esc(e.location) : '') + '</span>'
          + '</span>'
          + svgPath(IC.chevR, 'tge-daylist-arr')
          + '</button>';
      });

      const root = this.shadow.querySelector('.tge-root');
      const modalHtml = ''
        + '<div class="tge-modal-bg" data-tge-modal></div>'
        + '<div class="tge-modal" role="dialog" aria-modal="true" aria-label="' + esc(heading) + '">'
          + '<div class="tge-modal-card" style="position:relative">'
            + '<button class="tge-modal-close" type="button" aria-label="' + esc(this.t('close')) + '">' + svgPath(IC.close, '') + '</button>'
            + '<div class="tge-modal-body">'
              + '<h3 class="tge-modal-name">' + esc(heading) + '</h3>'
              + '<div class="tge-daylist">' + rows + '</div>'
            + '</div>'
          + '</div>'
        + '</div>';

      const wrap = document.createElement('div');
      wrap.innerHTML = modalHtml;
      while (wrap.firstChild) root.appendChild(wrap.firstChild);

      this._modalEl = root.querySelector('.tge-modal');
      const bg = root.querySelector('.tge-modal-bg');
      const card = root.querySelector('.tge-modal-card');
      requestAnimationFrame(() => {
        bg && bg.classList.add('tge-open');
        card && card.classList.add('tge-open');
      });

      const close = () => this._closeModal();
      bg && bg.addEventListener('click', close);
      const closeBtn = root.querySelector('.tge-modal-close');
      closeBtn && closeBtn.addEventListener('click', close);
      this._modalTrigger = trigger;
      this._kbdHandler = (ev) => {
        if (ev.key === 'Escape') { close(); return; }
        this._trapTab(ev, card);
      };
      document.addEventListener('keydown', this._kbdHandler);
      requestAnimationFrame(() => { closeBtn && closeBtn.focus(); });

      root.querySelectorAll('.tge-daylist-row').forEach((btn) => {
        btn.addEventListener('click', () => {
          const idx = parseInt(btn.getAttribute('data-tge-idx'), 10);
          const ev = events[idx];
          if (ev) this._openModal(ev); // _openModal calls _closeModal first, replacing the list
        });
      });
    }

    _closeModal() {
      if (this._modalEl) {
        const root = this.shadow.querySelector('.tge-root');
        const bg = root && root.querySelector('.tge-modal-bg');
        if (bg) bg.remove();
        this._modalEl.remove();
        this._modalEl = null;
      }
      if (this._kbdHandler) {
        document.removeEventListener('keydown', this._kbdHandler);
        this._kbdHandler = null;
      }
      // Return focus to whatever opened the modal so keyboard users are not stranded.
      if (this._modalTrigger) {
        const t = this._modalTrigger;
        this._modalTrigger = null;
        try { if (t.isConnected && typeof t.focus === 'function') t.focus(); } catch {}
      }
    }

    update(newConfig) {
      this.cfg = Object.assign({}, this.cfg, newConfig || {});
      ensureFont(safeFontStackE(this.cfg.fontFamily, ''));   // load the client-chosen web font on the host site (house rule 2)
      this.t = makeT(this.cfg);
      this.layout = this.cfg.layout || this.layout;
      this._render();
      if (this.cfg.useCuratedEvents !== false) {
        this.curatedLoaded = false;
        this._fetchCurated();
      }
    }

    destroy() {
      this._closeModal();
      try { this.shadow.innerHTML = ''; } catch {}
    }
  }

  // ---------- Auto-init ----------
  async function init() {
    const containers = document.querySelectorAll('[data-tg-widget="events"]:not([data-tg-rendered])');
    for (const el of containers) {
      // Inline config
      const inline = el.getAttribute('data-tg-config');
      if (inline) {
        try {
          const c = JSON.parse(inline);
          new TGEventsWidget(el, c);
          el.setAttribute('data-tg-rendered', '1');
          continue;
        } catch (e) {
          console.error('[tg-events] Invalid inline config', e);
          continue;
        }
      }

      // Remote config
      const id = el.getAttribute('data-tg-id');
      // No id and no inline config: skip silently — likely an editor mount
      // that will be hydrated by editor JS. Do NOT mark as rendered so the
      // editor can still pick it up on its own render pass.
      if (!id) continue;
      try {
        // The curated feed only needs the widget id (the server reads the saved
        // filters), so fire it now, in parallel with the config fetch (step 3).
        const contentP = startContent(EVENTS_API + '?id=' + encodeURIComponent(id));
        const r = await fetch(API_BASE + '?id=' + encodeURIComponent(id));
        if (!r.ok) throw new Error('config-fetch-' + r.status);
        const j = await r.json();
        const cfg = (j && j.config) ? j.config : {};
        cfg.widgetId = id;
        cfg.__contentResponse = contentP;
        new TGEventsWidget(el, cfg);
        el.setAttribute('data-tg-rendered', '1');
      } catch (err) {
        console.error('[tg-events] Failed to load widget config', err);
      }
    }
  }

  window.TGEventsWidget = TGEventsWidget;
  window.__TG_EVENTS_VERSION__ = VERSION;

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
