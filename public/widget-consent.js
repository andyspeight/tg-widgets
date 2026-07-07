/**
 * Travelgenix Cookie Consent Widget v1.0.0
 * Self-contained, embeddable cookie consent manager (CMP-lite)
 * Zero dependencies — works on any website via a single script tag
 *
 * What it does:
 *   - Sets Google Consent Mode v2 defaults to denied SYNCHRONOUSLY at parse
 *     time, before GA4 / Google Ads / GTM can drop anything, then updates the
 *     signals when the visitor chooses. This is why the tag must sit in the
 *     site <head> ABOVE any analytics tags.
 *   - Gates non-Google scripts with <script type="text/plain"
 *     data-tg-consent="analytics|marketing|functional" src="..."> and iframes
 *     with <iframe data-tg-consent="marketing" data-tg-src="...">. They are
 *     activated only after the matching category is granted.
 *   - Banner (bar | card | modal) with equal-prominence Accept all / Reject
 *     all / Preferences, a second-layer preference centre with per-category
 *     toggles and an optional cookie table, and a floating re-entry badge so
 *     consent can be withdrawn as easily as it was given.
 *   - Geo-aware: GDPR opt-in for EEA / UK / CH visitors, a lighter implied
 *     consent notice elsewhere (via /api/consent-geo). Unknown geo fails safe
 *     to the GDPR opt-in flow.
 *   - Anonymous consent receipts to /api/consent-log (no IP, no fingerprint).
 *
 * Usage (in the site <head>, before GTM / gtag):
 *   <script src="https://widgets.travelify.io/widget-consent.js"
 *           data-tg-id="WIDGET_ID"
 *           data-layout="card" data-position="bottom-left" data-theme="auto"
 *           data-accent="#00b4d8" data-privacy-url="/privacy-policy"></script>
 *
 * Public API: window.tgConsent — get / isGranted / open / acceptAll /
 * rejectAll / save / withdraw / on / off. Emits a `tg-consent-change`
 * CustomEvent on document and pushes `tg_consent_update` to the dataLayer,
 * so every other Travelgenix widget can react without coupling.
 *
 * Withdrawing a category cannot un-run a script that already executed, so a
 * downgrade purges known tracking cookies and (by default) reloads the page.
 */
(function () {
  'use strict';

  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  // One consent manager per page. A second include is a no-op.
  if (window.__TG_CONSENT_LOADED__) return;
  window.__TG_CONSENT_LOADED__ = true;

  var VERSION = '1.0.0';
  var COOKIE_NAME = 'tg_consent';
  var STORAGE_KEY = 'tgc_state';
  var ANON_ID_KEY = 'tgc_id';
  var GEO_CACHE_KEY = 'tgc_geo';
  var CATEGORIES = ['necessary', 'functional', 'analytics', 'marketing'];

  /**
   * Resolve the API base origin. Same lesson as widget-popup: this script is
   * hosted on widgets.travelify.io and embedded on customer sites, so a
   * relative '/api/...' URL would resolve to the customer's origin and 404.
   * document.currentScript is captured at parse time, before any await.
   */
  var SCRIPT_EL = document.currentScript || (function () {
    var scripts = document.getElementsByTagName('script');
    for (var i = scripts.length - 1; i >= 0; i--) {
      if (/\/widget-consent\.js(\?|$|#)/.test(scripts[i].src || '')) return scripts[i];
    }
    return null;
  })();
  var API_ORIGIN = (function () {
    if (window.__TG_WIDGET_API__) {
      try { return new URL(window.__TG_WIDGET_API__).origin; } catch (e) { /* fall through */ }
    }
    try { if (SCRIPT_EL && SCRIPT_EL.src) return new URL(SCRIPT_EL.src).origin; } catch (e) { /* fall through */ }
    return '';
  })();
  var CONFIG_API = API_ORIGIN + '/api/widget-config';
  var GEO_API = API_ORIGIN + '/api/consent-geo';
  var LOG_API = API_ORIGIN + '/api/consent-log';
  var TELEMETRY_API = API_ORIGIN + '/api/widget-log';

  // ─── Storage (cookie primary, localStorage mirror) ──────────────
  function readCookie(name) {
    try {
      var parts = document.cookie.split(/;\s*/);
      for (var i = 0; i < parts.length; i++) {
        if (parts[i].indexOf(name + '=') === 0) {
          return decodeURIComponent(parts[i].slice(name.length + 1));
        }
      }
    } catch (e) { /* cookies unavailable */ }
    return null;
  }
  function writeCookie(name, value, maxAgeSeconds) {
    try {
      var secure = location.protocol === 'https:' ? '; Secure' : '';
      document.cookie = name + '=' + encodeURIComponent(value) +
        '; Max-Age=' + maxAgeSeconds + '; Path=/; SameSite=Lax' + secure;
    } catch (e) { /* ignore */ }
  }
  function deleteCookie(name) {
    try {
      document.cookie = name + '=; Max-Age=0; Path=/; SameSite=Lax';
      // Also try the registrable-ish parent domain — GA sets _ga on it.
      var host = location.hostname;
      var parts = host.split('.');
      if (parts.length > 2) parts = parts.slice(-2);
      document.cookie = name + '=; Max-Age=0; Path=/; Domain=.' + parts.join('.') + '; SameSite=Lax';
    } catch (e) { /* ignore */ }
  }
  function lsGet(key) {
    try { return JSON.parse(window.localStorage.getItem(key) || 'null'); } catch (e) { return null; }
  }
  function lsSet(key, val) {
    try { window.localStorage.setItem(key, JSON.stringify(val)); } catch (e) { /* ignore */ }
  }

  /** Parse a stored state {v, p, ts, c:{functional,analytics,marketing}} or null. */
  function parseState(raw) {
    if (!raw || typeof raw !== 'object') return null;
    if (!raw.c || typeof raw.c !== 'object') return null;
    return {
      v: 1,
      p: String(raw.p == null ? '1' : raw.p).slice(0, 20),
      ts: Number(raw.ts) || 0,
      c: {
        functional: !!raw.c.functional,
        analytics: !!raw.c.analytics,
        marketing: !!raw.c.marketing
      }
    };
  }
  function readStoredState() {
    var raw = null;
    var cookieVal = readCookie(COOKIE_NAME);
    if (cookieVal) { try { raw = JSON.parse(cookieVal); } catch (e) { raw = null; } }
    if (!raw) raw = lsGet(STORAGE_KEY);
    return parseState(raw);
  }
  function persistState(state, days) {
    var json = JSON.stringify(state);
    writeCookie(COOKIE_NAME, json, Math.max(1, days) * 86400);
    lsSet(STORAGE_KEY, state);
  }
  function clearStoredState() {
    deleteCookie(COOKIE_NAME);
    try { window.localStorage.removeItem(STORAGE_KEY); } catch (e) { /* ignore */ }
  }

  // ─── Google Consent Mode v2 — synchronous bootstrap ─────────────
  // This block runs at parse time, before GA/GTM tags below this script.
  // Everything non-essential defaults to denied; a stored choice is applied
  // as an immediate update. wait_for_update gives the async geo path a
  // moment to upgrade defaults for implied-consent regions.
  window.dataLayer = window.dataLayer || [];
  function gtag() { window.dataLayer.push(arguments); }

  function consentModeSignals(cats) {
    return {
      ad_storage: cats.marketing ? 'granted' : 'denied',
      ad_user_data: cats.marketing ? 'granted' : 'denied',
      ad_personalization: cats.marketing ? 'granted' : 'denied',
      analytics_storage: cats.analytics ? 'granted' : 'denied',
      functionality_storage: cats.functional ? 'granted' : 'denied',
      personalization_storage: cats.functional ? 'granted' : 'denied',
      security_storage: 'granted'
    };
  }

  var storedAtBoot = readStoredState();
  gtag('consent', 'default', {
    ad_storage: 'denied',
    ad_user_data: 'denied',
    ad_personalization: 'denied',
    analytics_storage: 'denied',
    functionality_storage: 'denied',
    personalization_storage: 'denied',
    security_storage: 'granted',
    wait_for_update: 500
  });
  gtag('set', 'ads_data_redaction', true);
  gtag('set', 'url_passthrough', true);
  if (storedAtBoot) {
    gtag('consent', 'update', consentModeSignals(storedAtBoot.c));
    gtag('set', 'ads_data_redaction', !storedAtBoot.c.marketing);
  }

  // ─── i18n ────────────────────────────────────────────────────────
  // Fixed UI chrome plus localised defaults for author-configurable copy.
  // Author content overrides these; English is the source + fallback.
  var MESSAGES = {
    en: {
      bannerTitle: 'We value your privacy',
      bannerBody: 'We use cookies to make this site work, understand how it is used and show you relevant travel offers. You can accept, reject or fine-tune them any time.',
      noticeBody: 'We use cookies to improve your experience and understand how the site is used.',
      acceptAll: 'Accept all', rejectAll: 'Reject all', preferences: 'Preferences',
      savePreferences: 'Save preferences', back: 'Back', ok: 'OK', optOut: 'Opt out or fine-tune',
      alwaysOn: 'Always on', on: 'On', off: 'Off',
      privacyPolicy: 'Privacy policy', cookieSettings: 'Cookie settings',
      preferencesTitle: 'Cookie preferences',
      preferencesIntro: 'Choose which cookies this site may use. Strictly necessary cookies keep the site working and are always on.',
      saved: 'Your preferences have been saved',
      withdraw: 'Withdraw consent',
      catNecessary: 'Strictly necessary', catNecessaryDesc: 'Essential for the site to work: security, page navigation and remembering your consent choice. These cannot be switched off.',
      catFunctional: 'Functional', catFunctionalDesc: 'Remember your choices, like currency, language or saved searches, so the site feels personal.',
      catAnalytics: 'Analytics', catAnalyticsDesc: 'Help us understand how visitors use the site so we can improve it. Data is aggregated and anonymous.',
      catMarketing: 'Marketing', catMarketingDesc: 'Used to show you relevant offers and measure campaigns, on this site and elsewhere.',
      tblName: 'Cookie', tblProvider: 'Provider', tblPurpose: 'Purpose', tblDuration: 'Duration'
    },
    fr: {
      bannerTitle: 'Votre vie privée compte',
      bannerBody: 'Nous utilisons des cookies pour faire fonctionner ce site, comprendre son utilisation et vous proposer des offres de voyage pertinentes. Vous pouvez accepter, refuser ou personnaliser à tout moment.',
      noticeBody: "Nous utilisons des cookies pour améliorer votre expérience et comprendre l'utilisation du site.",
      acceptAll: 'Tout accepter', rejectAll: 'Tout refuser', preferences: 'Préférences',
      savePreferences: 'Enregistrer', back: 'Retour', ok: 'OK', optOut: 'Refuser ou personnaliser',
      alwaysOn: 'Toujours actif', on: 'Activé', off: 'Désactivé',
      privacyPolicy: 'Politique de confidentialité', cookieSettings: 'Paramètres des cookies',
      preferencesTitle: 'Préférences de cookies',
      preferencesIntro: 'Choisissez les cookies que ce site peut utiliser. Les cookies strictement nécessaires assurent le fonctionnement du site et restent toujours actifs.',
      saved: 'Vos préférences ont été enregistrées',
      withdraw: 'Retirer le consentement',
      catNecessary: 'Strictement nécessaires', catNecessaryDesc: 'Indispensables au fonctionnement du site : sécurité, navigation et mémorisation de votre choix de consentement. Ils ne peuvent pas être désactivés.',
      catFunctional: 'Fonctionnels', catFunctionalDesc: 'Mémorisent vos choix, comme la devise, la langue ou les recherches enregistrées.',
      catAnalytics: 'Statistiques', catAnalyticsDesc: 'Nous aident à comprendre comment les visiteurs utilisent le site afin de l\'améliorer. Données agrégées et anonymes.',
      catMarketing: 'Marketing', catMarketingDesc: 'Servent à vous proposer des offres pertinentes et à mesurer les campagnes, sur ce site et ailleurs.',
      tblName: 'Cookie', tblProvider: 'Fournisseur', tblPurpose: 'Finalité', tblDuration: 'Durée'
    },
    de: {
      bannerTitle: 'Ihre Privatsphäre ist uns wichtig',
      bannerBody: 'Wir verwenden Cookies, damit diese Website funktioniert, um ihre Nutzung zu verstehen und Ihnen passende Reiseangebote zu zeigen. Sie können jederzeit akzeptieren, ablehnen oder anpassen.',
      noticeBody: 'Wir verwenden Cookies, um Ihr Erlebnis zu verbessern und die Nutzung der Website zu verstehen.',
      acceptAll: 'Alle akzeptieren', rejectAll: 'Alle ablehnen', preferences: 'Einstellungen',
      savePreferences: 'Einstellungen speichern', back: 'Zurück', ok: 'OK', optOut: 'Ablehnen oder anpassen',
      alwaysOn: 'Immer aktiv', on: 'An', off: 'Aus',
      privacyPolicy: 'Datenschutzerklärung', cookieSettings: 'Cookie-Einstellungen',
      preferencesTitle: 'Cookie-Einstellungen',
      preferencesIntro: 'Wählen Sie, welche Cookies diese Website verwenden darf. Unbedingt erforderliche Cookies halten die Website am Laufen und sind immer aktiv.',
      saved: 'Ihre Einstellungen wurden gespeichert',
      withdraw: 'Einwilligung widerrufen',
      catNecessary: 'Unbedingt erforderlich', catNecessaryDesc: 'Für den Betrieb der Website unerlässlich: Sicherheit, Navigation und das Speichern Ihrer Einwilligung. Diese können nicht deaktiviert werden.',
      catFunctional: 'Funktional', catFunctionalDesc: 'Merken sich Ihre Auswahl, etwa Währung, Sprache oder gespeicherte Suchen.',
      catAnalytics: 'Statistik', catAnalyticsDesc: 'Helfen uns zu verstehen, wie Besucher die Website nutzen, damit wir sie verbessern können. Daten sind aggregiert und anonym.',
      catMarketing: 'Marketing', catMarketingDesc: 'Zeigen Ihnen passende Angebote und messen Kampagnen, auf dieser Website und anderswo.',
      tblName: 'Cookie', tblProvider: 'Anbieter', tblPurpose: 'Zweck', tblDuration: 'Dauer'
    },
    es: {
      bannerTitle: 'Tu privacidad nos importa',
      bannerBody: 'Usamos cookies para que este sitio funcione, entender cómo se usa y mostrarte ofertas de viaje relevantes. Puedes aceptar, rechazar o ajustarlas cuando quieras.',
      noticeBody: 'Usamos cookies para mejorar tu experiencia y entender cómo se usa el sitio.',
      acceptAll: 'Aceptar todo', rejectAll: 'Rechazar todo', preferences: 'Preferencias',
      savePreferences: 'Guardar preferencias', back: 'Volver', ok: 'OK', optOut: 'Rechazar o ajustar',
      alwaysOn: 'Siempre activo', on: 'Activado', off: 'Desactivado',
      privacyPolicy: 'Política de privacidad', cookieSettings: 'Configuración de cookies',
      preferencesTitle: 'Preferencias de cookies',
      preferencesIntro: 'Elige qué cookies puede usar este sitio. Las estrictamente necesarias mantienen el sitio en funcionamiento y están siempre activas.',
      saved: 'Tus preferencias se han guardado',
      withdraw: 'Retirar el consentimiento',
      catNecessary: 'Estrictamente necesarias', catNecessaryDesc: 'Esenciales para que el sitio funcione: seguridad, navegación y recordar tu elección de consentimiento. No se pueden desactivar.',
      catFunctional: 'Funcionales', catFunctionalDesc: 'Recuerdan tus elecciones, como moneda, idioma o búsquedas guardadas.',
      catAnalytics: 'Analíticas', catAnalyticsDesc: 'Nos ayudan a entender cómo se usa el sitio para poder mejorarlo. Datos agregados y anónimos.',
      catMarketing: 'Marketing', catMarketingDesc: 'Sirven para mostrarte ofertas relevantes y medir campañas, en este sitio y en otros.',
      tblName: 'Cookie', tblProvider: 'Proveedor', tblPurpose: 'Finalidad', tblDuration: 'Duración'
    },
    it: {
      bannerTitle: 'La tua privacy è importante',
      bannerBody: 'Usiamo i cookie per far funzionare questo sito, capire come viene usato e mostrarti offerte di viaggio pertinenti. Puoi accettare, rifiutare o personalizzare in qualsiasi momento.',
      noticeBody: 'Usiamo i cookie per migliorare la tua esperienza e capire come viene usato il sito.',
      acceptAll: 'Accetta tutto', rejectAll: 'Rifiuta tutto', preferences: 'Preferenze',
      savePreferences: 'Salva preferenze', back: 'Indietro', ok: 'OK', optOut: 'Rifiuta o personalizza',
      alwaysOn: 'Sempre attivo', on: 'Attivo', off: 'Disattivo',
      privacyPolicy: 'Informativa sulla privacy', cookieSettings: 'Impostazioni cookie',
      preferencesTitle: 'Preferenze cookie',
      preferencesIntro: 'Scegli quali cookie può usare questo sito. I cookie strettamente necessari mantengono il sito funzionante e sono sempre attivi.',
      saved: 'Le tue preferenze sono state salvate',
      withdraw: 'Revoca il consenso',
      catNecessary: 'Strettamente necessari', catNecessaryDesc: 'Essenziali per il funzionamento del sito: sicurezza, navigazione e memorizzazione della tua scelta. Non possono essere disattivati.',
      catFunctional: 'Funzionali', catFunctionalDesc: 'Ricordano le tue scelte, come valuta, lingua o ricerche salvate.',
      catAnalytics: 'Statistici', catAnalyticsDesc: 'Ci aiutano a capire come i visitatori usano il sito per migliorarlo. Dati aggregati e anonimi.',
      catMarketing: 'Marketing', catMarketingDesc: 'Servono a mostrarti offerte pertinenti e misurare le campagne, su questo sito e altrove.',
      tblName: 'Cookie', tblProvider: 'Fornitore', tblPurpose: 'Finalità', tblDuration: 'Durata'
    },
    ro: {
      bannerTitle: 'Confidențialitatea ta contează',
      bannerBody: 'Folosim cookie-uri pentru ca acest site să funcționeze, pentru a înțelege cum este folosit și pentru a-ți arăta oferte de călătorie relevante. Poți accepta, refuza sau ajusta oricând.',
      noticeBody: 'Folosim cookie-uri pentru a-ți îmbunătăți experiența și a înțelege cum este folosit site-ul.',
      acceptAll: 'Acceptă tot', rejectAll: 'Refuză tot', preferences: 'Preferințe',
      savePreferences: 'Salvează preferințele', back: 'Înapoi', ok: 'OK', optOut: 'Refuză sau ajustează',
      alwaysOn: 'Mereu activ', on: 'Activ', off: 'Inactiv',
      privacyPolicy: 'Politica de confidențialitate', cookieSettings: 'Setări cookie',
      preferencesTitle: 'Preferințe cookie',
      preferencesIntro: 'Alege ce cookie-uri poate folosi acest site. Cele strict necesare mențin site-ul funcțional și sunt mereu active.',
      saved: 'Preferințele tale au fost salvate',
      withdraw: 'Retrage consimțământul',
      catNecessary: 'Strict necesare', catNecessaryDesc: 'Esențiale pentru funcționarea site-ului: securitate, navigare și memorarea alegerii tale. Nu pot fi dezactivate.',
      catFunctional: 'Funcționale', catFunctionalDesc: 'Rețin alegerile tale, precum moneda, limba sau căutările salvate.',
      catAnalytics: 'Statistici', catAnalyticsDesc: 'Ne ajută să înțelegem cum este folosit site-ul, ca să îl îmbunătățim. Date agregate și anonime.',
      catMarketing: 'Marketing', catMarketingDesc: 'Folosite pentru a-ți arăta oferte relevante și a măsura campaniile, pe acest site și în altă parte.',
      tblName: 'Cookie', tblProvider: 'Furnizor', tblPurpose: 'Scop', tblDuration: 'Durată'
    }
  };
  // Uses the shared TGi18n core when present; otherwise an identical inline
  // resolver keeps the widget self-contained.
  function makeT(cfg) {
    if (window.TGi18n && typeof window.TGi18n.make === 'function') return window.TGi18n.make(MESSAGES, cfg);
    var supported = Object.keys(MESSAGES);
    var baseOf = function (r) { return r ? String(r).toLowerCase().replace(/_/g, '-').split('-')[0] : ''; };
    var cands = [];
    if (cfg) cands.push(cfg.lang, cfg.language, cfg.locale);
    try { cands.push(document.documentElement.getAttribute('lang')); } catch (e) { /* noop */ }
    try { if (navigator.languages) cands = cands.concat(navigator.languages); cands.push(navigator.language); } catch (e) { /* noop */ }
    var lang = 'en';
    for (var i = 0; i < cands.length; i++) { var b = baseOf(cands[i]); if (b && supported.indexOf(b) !== -1) { lang = b; break; } }
    var dict = MESSAGES[lang] || MESSAGES.en;
    var t = function (k) { return Object.prototype.hasOwnProperty.call(dict, k) ? dict[k] : (MESSAGES.en[k] || k); };
    t.lang = lang;
    return t;
  }

  // ─── Utilities (config is hostile input — validate at source) ───
  function esc(s) {
    if (s === null || s === undefined) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
  function safeColor(v, fb) {
    return (typeof v === 'string' && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v.trim())) ? v.trim() : fb;
  }
  function safeFontStack(v, fb) {
    var s = String(v == null ? '' : v).trim();
    return (s && s.length <= 120 && /^[A-Za-z0-9 ,"'-]+$/.test(s)) ? s : fb;
  }
  function ensureFont(family) {
    if (!family || family === 'Inter') return;
    var id = 'tg-font-' + String(family).toLowerCase().replace(/\s+/g, '-');
    if (document.getElementById(id)) return;
    var l = document.createElement('link');
    l.id = id;
    l.rel = 'stylesheet';
    l.href = 'https://fonts.googleapis.com/css2?family=' + encodeURIComponent(family).replace(/%20/g, '+') + ':ital,wght@0,400;0,500;0,600;1,400&display=swap';
    document.head.appendChild(l);
  }
  function safeUrl(url) {
    if (!url || typeof url !== 'string') return '';
    var u = url.trim();
    if (!u) return '';
    if (u.charAt(0) === '/' || u.charAt(0) === '#') return u;
    try {
      var p = new URL(u);
      if (p.protocol === 'https:' || p.protocol === 'http:') return p.href;
    } catch (e) { /* invalid */ }
    return '';
  }
  function clampInt(v, min, max, fb) {
    var n = parseInt(v, 10);
    return (isFinite(n) && n >= min && n <= max) ? n : fb;
  }
  function pickEnum(v, allowed, fb) {
    var s = String(v == null ? '' : v).toLowerCase().trim();
    return allowed.indexOf(s) !== -1 ? s : fb;
  }
  /** White or near-black text, whichever contrasts with the accent. */
  function contrastText(hex) {
    var h = String(hex).replace('#', '');
    if (h.length === 3) h = h.split('').map(function (c) { return c + c; }).join('');
    if (!/^[0-9a-f]{6}$/i.test(h)) return '#ffffff';
    var n = parseInt(h, 16);
    var r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    var lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    return lum > 0.55 ? '#0f172a' : '#ffffff';
  }

  // ─── Default config ──────────────────────────────────────────────
  var DEFAULTS = {
    layout: 'card',            // bar | card | modal
    position: 'bottom-left',   // for card: bottom-left | bottom-right | top-left | top-right
    theme: 'auto',             // light | dark | auto
    accent: '#00b4d8',
    fontFamily: '',            // Google Font family, loaded on demand (empty = Inter)
    radius: 14,                // px, 0–32
    logo: '',                  // optional logo URL shown in the banner
    title: '',                 // localised default when empty
    body: '',                  // localised default when empty
    privacyUrl: '',
    privacyLabel: '',          // localised default when empty
    geo: 'auto',               // auto (ask endpoint) | gdpr (always opt-in) | notice (implied everywhere)
    policyVersion: '1',        // bump to re-prompt every visitor
    reconsentDays: 180,        // choice lifetime before re-prompting
    badge: true,               // floating re-entry badge after a choice is made
    badgeAlign: '',            // left | center | right (empty = follow the banner corner)
    badgeOffset: 16,           // px the badge sits off the bottom edge (dodge other floating buttons)
    reloadOnWithdraw: true,    // reload after a downgrade so stopped trackers really stop
    log: true,                 // anonymous consent receipts to /api/consent-log
    focusOnOpen: true,         // move focus into the banner on open (off in the editor preview)
    // First-party cookie names purged when their category is withdrawn.
    // Prefixes with a trailing * match (e.g. _ga_* → _ga_ABC123).
    purgeCookies: {
      analytics: ['_ga', '_gid', '_gat', '_ga_*', '_hj*', '_pk_*'],
      marketing: ['_gcl_au', '_fbp', '_fbc', '_ttp', '_uet*', 'fr', 'IDE', 'test_cookie']
    },
    cookies: []                // [{name, provider, purpose, duration, category}] for the table
  };

  // ─── Config from the script tag (+ optional remote overlay) ──────
  function readInlineConfig() {
    var cfg = {};
    var el = SCRIPT_EL;
    if (!el) return cfg;
    // A JSON blob wins over individual attributes for rich config.
    var blob = el.getAttribute('data-tg-config');
    if (blob) { try { cfg = JSON.parse(blob) || {}; } catch (e) { cfg = {}; } }
    var attr = function (name) { return el.getAttribute('data-' + name); };
    var map = {
      layout: 'layout', position: 'position', theme: 'theme', accent: 'accent',
      font: 'fontFamily', logo: 'logo', title: 'title', body: 'body',
      'privacy-url': 'privacyUrl', 'privacy-label': 'privacyLabel',
      geo: 'geo', 'policy-version': 'policyVersion', 'badge-align': 'badgeAlign', lang: 'lang'
    };
    for (var name in map) {
      var v = attr(name);
      if (v !== null && v !== '') cfg[map[name]] = v;
    }
    var radius = attr('radius');
    if (radius !== null) cfg.radius = radius;
    var boff = attr('badge-offset');
    if (boff !== null) cfg.badgeOffset = boff;
    var flags = { badge: 'badge', log: 'log', 'reload-on-withdraw': 'reloadOnWithdraw' };
    for (var f in flags) {
      var fv = attr(f);
      if (fv !== null) cfg[flags[f]] = String(fv).toLowerCase() !== 'false';
    }
    var id = attr('tg-id');
    if (id) cfg.widgetId = id;
    return cfg;
  }

  /** Validate every config value before it touches the DOM. */
  function sanitiseConfig(raw) {
    var cfg = {};
    for (var k in DEFAULTS) cfg[k] = DEFAULTS[k];
    for (var k2 in raw) cfg[k2] = raw[k2];
    cfg.layout = pickEnum(cfg.layout, ['bar', 'card', 'modal'], DEFAULTS.layout);
    cfg.position = pickEnum(cfg.position, ['bottom-left', 'bottom-right', 'top-left', 'top-right'], DEFAULTS.position);
    cfg.theme = pickEnum(cfg.theme, ['light', 'dark', 'auto'], DEFAULTS.theme);
    cfg.geo = pickEnum(cfg.geo, ['auto', 'gdpr', 'notice'], DEFAULTS.geo);
    cfg.accent = safeColor(cfg.accent, DEFAULTS.accent);
    // Font: standardise on fontFamily (the editor shell's key); accept a
    // legacy 'font' value too. 'Inter' and empty both mean the system default.
    var famRaw = (cfg.fontFamily != null && cfg.fontFamily !== '') ? cfg.fontFamily : cfg.font;
    cfg.fontFamily = safeFontStack(famRaw, '');
    delete cfg.font;
    cfg.radius = clampInt(cfg.radius, 0, 32, DEFAULTS.radius);
    cfg.logo = safeUrl(cfg.logo);
    cfg.privacyUrl = safeUrl(cfg.privacyUrl);
    cfg.title = String(cfg.title || '').slice(0, 120);
    cfg.body = String(cfg.body || '').slice(0, 600);
    cfg.privacyLabel = String(cfg.privacyLabel || '').slice(0, 60);
    cfg.policyVersion = String(cfg.policyVersion || '1').slice(0, 20);
    cfg.reconsentDays = clampInt(cfg.reconsentDays, 1, 395, DEFAULTS.reconsentDays);
    cfg.widgetId = String(cfg.widgetId || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 60);
    cfg.badge = cfg.badge !== false;
    cfg.badgeAlign = pickEnum(cfg.badgeAlign, ['left', 'center', 'right'], '');
    cfg.badgeOffset = clampInt(cfg.badgeOffset, 0, 240, DEFAULTS.badgeOffset);
    cfg.log = cfg.log !== false;
    cfg.reloadOnWithdraw = cfg.reloadOnWithdraw !== false;
    cfg.focusOnOpen = cfg.focusOnOpen !== false;
    if (!cfg.purgeCookies || typeof cfg.purgeCookies !== 'object') cfg.purgeCookies = DEFAULTS.purgeCookies;
    var cookies = [];
    if (Array.isArray(cfg.cookies)) {
      for (var i = 0; i < Math.min(cfg.cookies.length, 60); i++) {
        var c = cfg.cookies[i];
        if (!c || typeof c !== 'object') continue;
        cookies.push({
          name: String(c.name || '').slice(0, 60),
          provider: String(c.provider || '').slice(0, 80),
          purpose: String(c.purpose || '').slice(0, 200),
          duration: String(c.duration || '').slice(0, 40),
          category: pickEnum(c.category, CATEGORIES, 'necessary')
        });
      }
    }
    cfg.cookies = cookies;
    return cfg;
  }

  // ─── Anonymous id for consent receipts (random, no fingerprint) ──
  function anonId() {
    var id = null;
    try { id = window.localStorage.getItem(ANON_ID_KEY); } catch (e) { /* ignore */ }
    if (id && /^[a-z0-9-]{10,40}$/.test(id)) return id;
    var rnd = '';
    try {
      var buf = new Uint8Array(16);
      (window.crypto || {}).getRandomValues ? window.crypto.getRandomValues(buf) : null;
      for (var i = 0; i < buf.length; i++) rnd += (buf[i] % 36).toString(36);
    } catch (e) { /* fall through */ }
    if (!rnd) rnd = String(Math.random()).slice(2) + String(Date.now() % 1e7);
    id = 'v-' + rnd.slice(0, 24);
    try { window.localStorage.setItem(ANON_ID_KEY, id); } catch (e) { /* ignore */ }
    return id;
  }

  // ─── Gated script / iframe activation ────────────────────────────
  function activateGated(cats) {
    var i, el;
    var scripts = document.querySelectorAll('script[type="text/plain"][data-tg-consent]');
    for (i = 0; i < scripts.length; i++) {
      el = scripts[i];
      var cat = pickEnum(el.getAttribute('data-tg-consent'), CATEGORIES, '');
      if (!cat || !cats[cat]) continue;
      var s = document.createElement('script');
      for (var a = 0; a < el.attributes.length; a++) {
        var at = el.attributes[a];
        if (at.name === 'type' || at.name === 'data-tg-consent') continue;
        s.setAttribute(at.name, at.value);
      }
      if (!el.src) s.text = el.text || el.textContent || '';
      el.parentNode.replaceChild(s, el);
    }
    var frames = document.querySelectorAll('iframe[data-tg-consent][data-tg-src]');
    for (i = 0; i < frames.length; i++) {
      el = frames[i];
      var fcat = pickEnum(el.getAttribute('data-tg-consent'), CATEGORIES, '');
      if (!fcat || !cats[fcat]) continue;
      var src = safeUrl(el.getAttribute('data-tg-src'));
      if (src) {
        el.setAttribute('src', src);
        el.removeAttribute('data-tg-src');
        el.removeAttribute('data-tg-consent');
      }
    }
  }

  /** Purge known tracking cookies for every withdrawn category. */
  function purgeForDowngrade(cfg, oldCats, newCats) {
    var purged = false;
    for (var cat in cfg.purgeCookies) {
      if (!oldCats || !oldCats[cat] || newCats[cat]) continue;
      purged = true;
      var patterns = cfg.purgeCookies[cat] || [];
      var names = [];
      try {
        names = document.cookie.split(/;\s*/).map(function (p) { return p.split('=')[0]; });
      } catch (e) { /* ignore */ }
      for (var i = 0; i < patterns.length; i++) {
        var p = String(patterns[i]);
        if (p.indexOf('*') === -1) { deleteCookie(p); continue; }
        var prefix = p.replace(/\*.*$/, '');
        for (var n = 0; n < names.length; n++) {
          if (prefix && names[n].indexOf(prefix) === 0) deleteCookie(names[n]);
        }
      }
    }
    return purged;
  }

  // ─── Consent state machine ───────────────────────────────────────
  var listeners = [];
  var state = {
    cfg: null,
    t: null,
    stored: storedAtBoot,
    geoMode: 'gdpr',   // gdpr | optout
    country: '',
    ui: null           // shadow host controller, set on render
  };

  function currentCats() {
    if (state.stored) {
      return {
        necessary: true,
        functional: state.stored.c.functional,
        analytics: state.stored.c.analytics,
        marketing: state.stored.c.marketing
      };
    }
    return { necessary: true, functional: false, analytics: false, marketing: false };
  }

  function notify(cats, source) {
    gtag('consent', 'update', consentModeSignals(cats));
    gtag('set', 'ads_data_redaction', !cats.marketing);
    window.dataLayer.push({
      event: 'tg_consent_update',
      tg_consent_source: source,
      tg_consent_functional: !!cats.functional,
      tg_consent_analytics: !!cats.analytics,
      tg_consent_marketing: !!cats.marketing
    });
    try {
      document.dispatchEvent(new CustomEvent('tg-consent-change', { detail: { categories: cats, source: source } }));
    } catch (e) { /* ignore */ }
    for (var i = 0; i < listeners.length; i++) {
      try { listeners[i](cats, source); } catch (e) { /* listener errors are not ours */ }
    }
  }

  function logReceipt(action, cats) {
    var cfg = state.cfg;
    if (!cfg || !cfg.log || !LOG_API || API_ORIGIN === '') return;
    var payload = JSON.stringify({
      id: anonId(),
      widgetId: cfg.widgetId,
      action: action,
      categories: CATEGORIES.filter(function (c) { return cats[c]; }).join(','),
      policyVersion: cfg.policyVersion,
      bannerVersion: VERSION,
      lang: state.t ? state.t.lang : 'en',
      country: state.country,
      url: location.origin + location.pathname
    });
    try {
      if (navigator.sendBeacon && navigator.sendBeacon(LOG_API, new Blob([payload], { type: 'application/json' }))) return;
    } catch (e) { /* fall through to fetch */ }
    try { fetch(LOG_API, { method: 'POST', body: payload, keepalive: true, headers: { 'Content-Type': 'application/json' } }); } catch (e) { /* ignore */ }
  }

  /**
   * Apply a choice: persist, signal, activate what is newly allowed, purge
   * and (optionally) reload on a downgrade. `action` names the receipt.
   */
  function applyChoice(cats, action) {
    var cfg = state.cfg;
    var oldCats = currentCats();
    var hadStored = !!state.stored;
    state.stored = {
      v: 1,
      p: cfg.policyVersion,
      ts: Date.now(),
      c: { functional: !!cats.functional, analytics: !!cats.analytics, marketing: !!cats.marketing }
    };
    persistState(state.stored, cfg.reconsentDays);
    var newCats = currentCats();
    notify(newCats, action);
    activateGated(newCats);
    logReceipt(action, newCats);
    var downgraded = hadStored && (
      (oldCats.functional && !newCats.functional) ||
      (oldCats.analytics && !newCats.analytics) ||
      (oldCats.marketing && !newCats.marketing));
    if (downgraded) {
      purgeForDowngrade(cfg, oldCats, newCats);
      if (cfg.reloadOnWithdraw) {
        setTimeout(function () { location.reload(); }, 150);
      }
    }
  }

  // ─── Geo resolution ──────────────────────────────────────────────
  function resolveGeo(cfg) {
    if (cfg.geo === 'gdpr') return Promise.resolve({ mode: 'gdpr', country: '' });
    if (cfg.geo === 'notice') return Promise.resolve({ mode: 'optout', country: '' });
    var cached = null;
    try { cached = JSON.parse(window.sessionStorage.getItem(GEO_CACHE_KEY) || 'null'); } catch (e) { /* ignore */ }
    if (cached && (cached.mode === 'gdpr' || cached.mode === 'optout')) return Promise.resolve(cached);
    if (!API_ORIGIN) return Promise.resolve({ mode: 'gdpr', country: '' });
    return fetch(GEO_API, { credentials: 'omit' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        var mode = (j && j.mode === 'optout') ? 'optout' : 'gdpr';   // unknown fails safe to opt-in
        var out = { mode: mode, country: (j && /^[A-Z]{2}$/.test(String(j.country)) ? j.country : '') };
        try { window.sessionStorage.setItem(GEO_CACHE_KEY, JSON.stringify(out)); } catch (e) { /* ignore */ }
        return out;
      })
      .catch(function () { return { mode: 'gdpr', country: '' }; });
  }

  // ─── UI ──────────────────────────────────────────────────────────
  var IC = {
    cookie: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12a9 9 0 11-9.75-8.97 3.5 3.5 0 004.22 4.22A9 9 0 0121 12z"/><circle cx="9" cy="10" r="1" fill="currentColor" stroke="none"/><circle cx="14" cy="14" r="1" fill="currentColor" stroke="none"/><circle cx="9.5" cy="15.5" r="1" fill="currentColor" stroke="none"/>',
    shield: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 3l7 3v5c0 4.5-3 8.5-7 10-4-1.5-7-5.5-7-10V6l7-3z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4"/>',
    back: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7"/>'
  };
  function svg(path, cls) {
    return '<svg class="' + (cls || '') + '" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">' + path + '</svg>';
  }

  function buildCss(cfg) {
    var accent = cfg.accent;
    var accentText = contrastText(accent);
    var fam = (cfg.fontFamily && cfg.fontFamily !== 'Inter') ? "'" + cfg.fontFamily + "', " : '';
    var stack = fam + "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
    var r = cfg.radius;
    var light = '--bg:#ffffff;--text:#0f172a;--sub:#475569;--border:#e2e8f0;--soft:#f1f5f9;--shadow:0 18px 50px rgba(15,23,42,.18)';
    var dark = '--bg:#101828;--text:#f1f5f9;--sub:#94a3b8;--border:#26334d;--soft:#1a2438;--shadow:0 18px 50px rgba(0,0,0,.5)';
    var theme;
    if (cfg.theme === 'light') theme = ':host{' + light + '}';
    else if (cfg.theme === 'dark') theme = ':host{' + dark + '}';
    else theme = ':host{' + light + '}@media (prefers-color-scheme: dark){:host{' + dark + '}}';
    return theme + '\n' +
      ':host{--accent:' + accent + ';--accent-text:' + accentText + ';--radius:' + r + 'px;all:initial}\n' +
      '*{box-sizing:border-box;margin:0;padding:0}\n' +
      '.wrap{position:fixed;z-index:2147483647;font-family:' + stack + ';font-size:14px;line-height:1.55;color:var(--text);-webkit-font-smoothing:antialiased}\n' +
      '.wrap.bar{left:0;right:0;bottom:0}\n' +
      '.wrap.card{max-width:400px;width:calc(100vw - 32px)}\n' +
      '.wrap.card.bottom-left{left:16px;bottom:16px}.wrap.card.bottom-right{right:16px;bottom:16px}\n' +
      '.wrap.card.top-left{left:16px;top:16px}.wrap.card.top-right{right:16px;top:16px}\n' +
      '.wrap.modal{inset:0;display:flex;align-items:center;justify-content:center;background:rgba(15,23,42,.45);backdrop-filter:blur(3px)}\n' +
      '.panel{background:var(--bg);border:1px solid var(--border);box-shadow:var(--shadow);overflow:hidden}\n' +
      '.bar .panel{border-radius:0;border-left:0;border-right:0;border-bottom:0}\n' +
      '.card .panel{border-radius:var(--radius)}\n' +
      '.modal .panel{border-radius:var(--radius);max-width:560px;width:calc(100vw - 32px);max-height:calc(100vh - 48px);display:flex;flex-direction:column}\n' +
      '.inner{padding:20px}\n' +
      '.bar .inner{max-width:1100px;margin:0 auto;display:flex;align-items:center;gap:20px;flex-wrap:wrap;padding:16px 20px}\n' +
      '.bar .copy{flex:1 1 320px;min-width:260px}\n' +
      '.head{display:flex;align-items:center;gap:10px;margin-bottom:8px}\n' +
      '.head img{max-height:26px;max-width:120px;display:block}\n' +
      '.head .ic{width:20px;height:20px;color:var(--accent);flex:none}\n' +
      'h2{font-size:15.5px;font-weight:700;letter-spacing:-.01em}\n' +
      'p.body{color:var(--sub);font-size:13.5px}\n' +
      'a.plink{color:var(--accent);text-decoration:underline;text-underline-offset:2px;font-size:13px}\n' +
      '.btns{display:flex;gap:10px;flex-wrap:wrap;margin-top:16px;align-items:center}\n' +
      '.bar .btns{margin-top:0;flex:none}\n' +
      'button{font:inherit;cursor:pointer;border-radius:calc(var(--radius) * .65);padding:9px 16px;font-weight:600;font-size:13.5px;border:1.5px solid transparent;transition:transform .12s ease,box-shadow .12s ease,background .12s ease}\n' +
      'button:focus-visible{outline:2px solid var(--accent);outline-offset:2px}\n' +
      'button:active{transform:scale(.97)}\n' +
      '.b-accept{background:var(--accent);color:var(--accent-text)}\n' +
      '.b-accept:hover{box-shadow:0 4px 14px rgba(0,0,0,.18)}\n' +
      '.b-reject{background:transparent;color:var(--text);border-color:var(--border)}\n' +
      '.b-reject:hover{background:var(--soft)}\n' +
      '.b-ghost{background:transparent;color:var(--sub);padding:9px 10px;text-decoration:underline;text-underline-offset:2px}\n' +
      '.b-ghost:hover{color:var(--text)}\n' +
      '.prefs{max-height:min(60vh,460px);overflow-y:auto;padding:0 20px}\n' +
      '.prefs-head{display:flex;align-items:center;gap:8px;padding:18px 20px 8px}\n' +
      '.prefs-head button{padding:4px;border-radius:8px;display:flex}\n' +
      '.prefs-head .ic{width:18px;height:18px}\n' +
      '.prefs-intro{color:var(--sub);font-size:13px;padding:0 20px 12px}\n' +
      '.cat{border:1px solid var(--border);border-radius:calc(var(--radius) * .7);padding:14px;margin-bottom:10px;background:var(--bg)}\n' +
      '.cat-top{display:flex;align-items:center;gap:12px}\n' +
      '.cat-top h3{font-size:13.5px;font-weight:700;flex:1}\n' +
      '.cat p{color:var(--sub);font-size:12.5px;margin-top:6px}\n' +
      '.lock{font-size:11px;font-weight:700;color:var(--accent);text-transform:uppercase;letter-spacing:.04em}\n' +
      '.sw{position:relative;width:42px;height:24px;flex:none}\n' +
      '.sw input{position:absolute;opacity:0;width:100%;height:100%;margin:0;cursor:pointer}\n' +
      '.sw .tr{position:absolute;inset:0;background:var(--border);border-radius:99px;transition:background .18s ease;pointer-events:none}\n' +
      '.sw .th{position:absolute;top:3px;left:3px;width:18px;height:18px;border-radius:50%;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.3);transition:transform .18s ease;pointer-events:none}\n' +
      '.sw input:checked ~ .tr{background:var(--accent)}\n' +
      '.sw input:checked ~ .th{transform:translateX(18px)}\n' +
      '.sw input:focus-visible ~ .tr{outline:2px solid var(--accent);outline-offset:2px}\n' +
      'table{width:100%;border-collapse:collapse;font-size:11.5px;margin-top:10px}\n' +
      'th,td{text-align:left;padding:5px 8px 5px 0;border-top:1px solid var(--border);color:var(--sub);vertical-align:top}\n' +
      'th{color:var(--text);font-weight:600;border-top:0}\n' +
      '.prefs-foot{display:flex;gap:10px;flex-wrap:wrap;padding:14px 20px 20px;border-top:1px solid var(--border);margin-top:4px}\n' +
      '.badge{position:fixed;z-index:2147483646;width:44px;height:44px;border-radius:50%;background:var(--bg);border:1px solid var(--border);box-shadow:0 6px 20px rgba(15,23,42,.2);display:flex;align-items:center;justify-content:center;cursor:pointer;color:var(--accent);transition:transform .15s ease}\n' +
      '.badge:hover{transform:scale(1.08)}\n' +
      '.badge .ic{width:22px;height:22px}\n' +
      '.badge.b-left{left:16px}.badge.b-right{right:16px}.badge.b-center{left:50%;transform:translateX(-50%)}\n' +
      '.badge.b-center:hover{transform:translateX(-50%) scale(1.08)}\n' +
      '.toast{position:absolute;left:50%;transform:translateX(-50%);bottom:12px;background:var(--text);color:var(--bg);font-size:12.5px;font-weight:600;padding:7px 14px;border-radius:99px;opacity:0;transition:opacity .25s ease;pointer-events:none;white-space:nowrap}\n' +
      '.toast.show{opacity:1}\n' +
      '@media (max-width:560px){.bar .inner{flex-direction:column;align-items:stretch;gap:12px}.bar .copy{flex:0 0 auto;min-width:0}.bar .btns{width:100%}.bar .btns button{flex:1}}\n' +
      '@keyframes tgc-in{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:translateY(0)}}\n' +
      '@keyframes tgc-in-down{from{opacity:0;transform:translateY(-14px)}to{opacity:1;transform:translateY(0)}}\n' +
      '.anim-up{animation:tgc-in .35s cubic-bezier(.21,.9,.35,1) both}\n' +
      '.anim-down{animation:tgc-in-down .35s cubic-bezier(.21,.9,.35,1) both}\n' +
      '@media (prefers-reduced-motion: reduce){.anim-up,.anim-down{animation:none}button{transition:none}.sw .tr,.sw .th{transition:none}}\n';
  }

  function categoryRow(t, cat, checked, locked) {
    var name = t('cat' + cat.charAt(0).toUpperCase() + cat.slice(1));
    var desc = t('cat' + cat.charAt(0).toUpperCase() + cat.slice(1) + 'Desc');
    var control = locked
      ? '<span class="lock">' + esc(t('alwaysOn')) + '</span>'
      : '<span class="sw"><input type="checkbox" data-cat="' + cat + '"' + (checked ? ' checked' : '') +
        ' aria-label="' + esc(name) + '"><span class="tr"></span><span class="th"></span></span>';
    return '<div class="cat"><div class="cat-top"><h3>' + esc(name) + '</h3>' + control + '</div>' +
      '<p>' + esc(desc) + '</p><div data-tbl="' + cat + '"></div></div>';
  }

  function cookieTable(t, cookies, cat) {
    var rows = cookies.filter(function (c) { return c.category === cat && c.name; });
    if (!rows.length) return '';
    var html = '<table><tr><th>' + esc(t('tblName')) + '</th><th>' + esc(t('tblProvider')) + '</th><th>' +
      esc(t('tblPurpose')) + '</th><th>' + esc(t('tblDuration')) + '</th></tr>';
    for (var i = 0; i < rows.length; i++) {
      html += '<tr><td>' + esc(rows[i].name) + '</td><td>' + esc(rows[i].provider) + '</td><td>' +
        esc(rows[i].purpose) + '</td><td>' + esc(rows[i].duration) + '</td></tr>';
    }
    return html + '</table>';
  }

  function makeUi(cfg, t) {
    var host = document.createElement('div');
    host.setAttribute('data-tg-widget', 'consent');
    var shadow = host.attachShadow({ mode: 'open' });
    var style = document.createElement('style');
    style.textContent = buildCss(cfg);
    shadow.appendChild(style);
    var root = document.createElement('div');
    shadow.appendChild(root);
    document.body.appendChild(host);
    if (cfg.fontFamily) ensureFont(cfg.fontFamily);

    var ui = { host: host, root: root, open: null };
    var animClass = (cfg.layout === 'card' && /top/.test(cfg.position)) ? 'anim-down' : 'anim-up';

    function privacyLink() {
      if (!cfg.privacyUrl) return '';
      var label = cfg.privacyLabel || t('privacyPolicy');
      return ' <a class="plink" href="' + esc(cfg.privacyUrl) + '" target="_blank" rel="noopener">' + esc(label) + '</a>';
    }
    function headHtml() {
      var logo = cfg.logo ? '<img src="' + esc(cfg.logo) + '" alt="">' : svg(IC.cookie, 'ic');
      return '<div class="head">' + logo + '<h2>' + esc(cfg.title || t('bannerTitle')) + '</h2></div>';
    }

    /** First layer — full consent banner (GDPR regions). */
    ui.showBanner = function () {
      ui.open = 'banner';
      root.innerHTML =
        '<div class="wrap ' + cfg.layout + ' ' + cfg.position + '" role="dialog" aria-modal="' + (cfg.layout === 'modal') + '" aria-label="' + esc(t('bannerTitle')) + '">' +
        '<div class="panel ' + animClass + '"><div class="inner">' +
        '<div class="copy">' + headHtml() +
        '<p class="body">' + esc(cfg.body || t('bannerBody')) + privacyLink() + '</p></div>' +
        '<div class="btns">' +
        '<button class="b-accept" data-act="accept">' + esc(t('acceptAll')) + '</button>' +
        '<button class="b-reject" data-act="reject">' + esc(t('rejectAll')) + '</button>' +
        '<button class="b-ghost" data-act="prefs">' + esc(t('preferences')) + '</button>' +
        '</div></div></div></div>';
      var first = root.querySelector('.b-accept');
      if (first && cfg.focusOnOpen) { try { first.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }
    };

    /** Light implied-consent notice (opt-out regions). */
    ui.showNotice = function () {
      ui.open = 'notice';
      root.innerHTML =
        '<div class="wrap ' + cfg.layout + ' ' + cfg.position + '" role="region" aria-label="' + esc(t('bannerTitle')) + '">' +
        '<div class="panel ' + animClass + '"><div class="inner">' +
        '<div class="copy">' + headHtml() +
        '<p class="body">' + esc(cfg.body || t('noticeBody')) + privacyLink() + '</p></div>' +
        '<div class="btns">' +
        '<button class="b-accept" data-act="dismiss">' + esc(t('ok')) + '</button>' +
        '<button class="b-ghost" data-act="prefs">' + esc(t('optOut')) + '</button>' +
        '</div></div></div></div>';
    };

    /** Second layer — the preference centre. */
    ui.showPreferences = function (cats) {
      ui.open = 'prefs';
      var wrapClass = cfg.layout === 'bar' ? 'modal' : cfg.layout;   // bar opens prefs as a modal for room
      root.innerHTML =
        '<div class="wrap modal' + (wrapClass === 'card' ? '' : '') + '" role="dialog" aria-modal="true" aria-label="' + esc(t('preferencesTitle')) + '">' +
        '<div class="panel ' + animClass + '">' +
        '<div class="prefs-head">' +
        '<button class="b-ghost" data-act="back" aria-label="' + esc(t('back')) + '">' + svg(IC.back, 'ic') + '</button>' +
        '<h2>' + esc(t('preferencesTitle')) + '</h2></div>' +
        '<p class="prefs-intro">' + esc(t('preferencesIntro')) + privacyLink() + '</p>' +
        '<div class="prefs">' +
        categoryRow(t, 'necessary', true, true) +
        categoryRow(t, 'functional', cats.functional, false) +
        categoryRow(t, 'analytics', cats.analytics, false) +
        categoryRow(t, 'marketing', cats.marketing, false) +
        '</div>' +
        '<div class="prefs-foot">' +
        '<button class="b-accept" data-act="save">' + esc(t('savePreferences')) + '</button>' +
        '<button class="b-reject" data-act="accept">' + esc(t('acceptAll')) + '</button>' +
        '</div>' +
        '<div class="toast" data-toast>' + esc(t('saved')) + '</div>' +
        '</div></div>';
      for (var i = 0; i < CATEGORIES.length; i++) {
        var slot = root.querySelector('[data-tbl="' + CATEGORIES[i] + '"]');
        if (slot) slot.innerHTML = cookieTable(t, cfg.cookies, CATEGORIES[i]);
      }
      var back = root.querySelector('[data-act="back"]');
      if (back && cfg.focusOnOpen) { try { back.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }
    };

    /** Floating re-entry badge shown once a choice exists. */
    ui.showBadge = function () {
      ui.open = 'badge';
      if (!cfg.badge) { root.innerHTML = ''; return; }
      // The badge sits at the bottom on its own alignment (left / centre /
      // right), independent of the banner corner, with a configurable offset so
      // it can clear the site's other floating buttons.
      var align = cfg.badgeAlign || (/right/.test(cfg.position) ? 'right' : 'left');
      root.innerHTML =
        '<button class="badge b-' + align + '" style="bottom:' + cfg.badgeOffset + 'px" data-act="prefs" aria-label="' + esc(t('cookieSettings')) + '" title="' + esc(t('cookieSettings')) + '">' +
        svg(IC.cookie, 'ic') + '</button>';
    };

    ui.close = function () { ui.open = null; root.innerHTML = ''; };

    ui.readToggles = function () {
      var cats = { necessary: true, functional: false, analytics: false, marketing: false };
      var inputs = root.querySelectorAll('input[data-cat]');
      for (var i = 0; i < inputs.length; i++) {
        var c = inputs[i].getAttribute('data-cat');
        if (CATEGORIES.indexOf(c) !== -1) cats[c] = !!inputs[i].checked;
      }
      return cats;
    };

    return ui;
  }

  // ─── Interaction wiring + public API ─────────────────────────────
  function afterChoice() {
    if (!state.ui) return;
    state.ui.showBadge();
  }

  function openPreferences() {
    if (!state.ui) return;
    state.ui.showPreferences(currentCats());
  }

  function wire(ui, cfg, t) {
    ui.root.addEventListener('click', function (ev) {
      var btn = ev.target && ev.target.closest ? ev.target.closest('[data-act]') : null;
      if (!btn) return;
      var act = btn.getAttribute('data-act');
      if (act === 'accept') {
        applyChoice({ functional: true, analytics: true, marketing: true }, 'accept_all');
        afterChoice();
      } else if (act === 'reject') {
        applyChoice({ functional: false, analytics: false, marketing: false }, 'reject_all');
        afterChoice();
      } else if (act === 'prefs') {
        openPreferences();
      } else if (act === 'save') {
        applyChoice(ui.readToggles(), 'custom');
        var toast = ui.root.querySelector('[data-toast]');
        if (toast) {
          toast.classList.add('show');
          setTimeout(function () { afterChoice(); }, 900);
        } else {
          afterChoice();
        }
      } else if (act === 'back') {
        if (state.stored) afterChoice();
        else if (state.geoMode === 'optout') ui.showNotice();
        else ui.showBanner();
      } else if (act === 'dismiss') {
        // Implied-consent notice acknowledged — consent was already applied.
        logReceipt('implied_ack', currentCats());
        afterChoice();
      }
    });

    // Escape backs out of the preference layer (never skips the consent choice).
    ui.root.addEventListener('keydown', function (ev) {
      if (ev.key !== 'Escape' || ui.open !== 'prefs') return;
      if (state.stored) afterChoice();
      else if (state.geoMode === 'optout') ui.showNotice();
      else ui.showBanner();
    });

    // Site-side reopen hooks: any element with [data-tg-consent-open], or a
    // plain link to href="#tg-consent" (easy to add in a Duda footer).
    document.addEventListener('click', function (ev) {
      var el = ev.target && ev.target.closest
        ? ev.target.closest('[data-tg-consent-open], a[href="#tg-consent"]')
        : null;
      if (!el) return;
      ev.preventDefault();
      openPreferences();
    });
  }

  window.tgConsent = {
    version: VERSION,
    get: function () { return currentCats(); },
    isGranted: function (cat) { return !!currentCats()[pickEnum(cat, CATEGORIES, '')]; },
    hasChoice: function () { return !!state.stored; },
    open: function () { openPreferences(); },
    acceptAll: function () { applyChoice({ functional: true, analytics: true, marketing: true }, 'accept_all'); afterChoice(); },
    rejectAll: function () { applyChoice({ functional: false, analytics: false, marketing: false }, 'reject_all'); afterChoice(); },
    save: function (cats) {
      applyChoice({
        functional: !!(cats && cats.functional),
        analytics: !!(cats && cats.analytics),
        marketing: !!(cats && cats.marketing)
      }, 'custom');
      afterChoice();
    },
    withdraw: function () { applyChoice({ functional: false, analytics: false, marketing: false }, 'withdraw'); afterChoice(); },
    on: function (fn) { if (typeof fn === 'function') listeners.push(fn); },
    off: function (fn) { var i = listeners.indexOf(fn); if (i !== -1) listeners.splice(i, 1); }
  };

  // ─── Telemetry heartbeat (house rule: every widget reports load) ─
  function heartbeat() {
    if (!API_ORIGIN) return;
    try {
      fetch(TELEMETRY_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event: 'load', widget: 'consent', widgetId: state.cfg ? state.cfg.widgetId : '', url: location.origin + location.pathname }),
        keepalive: true
      });
    } catch (e) { /* telemetry must never break a page */ }
  }

  // ─── Init ────────────────────────────────────────────────────────
  function isChoiceCurrent(cfg) {
    if (!state.stored) return false;
    if (state.stored.p !== cfg.policyVersion) return false;
    var age = Date.now() - state.stored.ts;
    if (state.stored.ts && age > cfg.reconsentDays * 86400000) return false;
    return true;
  }

  function start() {
    var cfg = sanitiseConfig(readInlineConfig());

    function boot(finalCfg) {
      state.cfg = finalCfg;
      state.t = makeT(finalCfg);
      resolveGeo(finalCfg).then(function (geo) {
        state.geoMode = geo.mode;
        state.country = geo.country;
        state.ui = makeUi(finalCfg, state.t);
        wire(state.ui, finalCfg, state.t);
        if (isChoiceCurrent(finalCfg)) {
          // Returning visitor with a live choice — activate and stay quiet.
          activateGated(currentCats());
          state.ui.showBadge();
        } else if (geo.mode === 'optout') {
          // Implied consent region: grant, notify, show the light notice.
          clearStoredState();
          state.stored = null;
          applyChoice({ functional: true, analytics: true, marketing: true }, 'implied');
          state.ui.showNotice();
        } else {
          // GDPR region, no valid choice: everything stays denied until they act.
          clearStoredState();
          state.stored = null;
          state.ui.showBanner();
        }
        heartbeat();
      });
    }

    if (cfg.widgetId) {
      // Remote config (from the editor) overlays defaults; inline attributes
      // win so a support tweak in the embed always sticks.
      fetch(CONFIG_API + '?id=' + encodeURIComponent(cfg.widgetId), { credentials: 'omit' })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (remote) {
          var remoteCfg = remote && (remote.config || remote);
          if (remoteCfg && typeof remoteCfg === 'object') {
            var merged = {};
            var k;
            for (k in remoteCfg) merged[k] = remoteCfg[k];
            var inline = readInlineConfig();
            for (k in inline) merged[k] = inline[k];
            boot(sanitiseConfig(merged));
          } else {
            boot(cfg);
          }
        })
        .catch(function () { boot(cfg); });
    } else {
      boot(cfg);
    }
  }

  // The tag sits in <head>, so body may not exist yet. Consent Mode defaults
  // are already applied above; only the UI waits for the DOM.
  if (document.body) start();
  else document.addEventListener('DOMContentLoaded', start);
})();
