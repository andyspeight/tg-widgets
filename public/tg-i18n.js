/* ============================================================================
 * tg-i18n.js  ·  Travelgenix Widget Suite — shared internationalisation core
 * ----------------------------------------------------------------------------
 * One small, dependency-free helper every widget (and editor) can share for:
 *   - resolving the viewer's language (config → page <html lang> → browser),
 *   - looking up UI strings from a per-widget message catalogue with an English
 *     fallback and {token} interpolation,
 *   - locale-correct number / currency / date formatting via the browser's Intl,
 *   - direction (ltr / rtl) for future right-to-left languages.
 *
 * This file is OPTIONAL for the widgets: each embeddable widget also carries a
 * tiny inline fallback so it stays self-contained if this script is not present.
 * When it IS present (loaded once on a page, or by an editor) every widget and
 * editor shares the exact same resolution + formatting logic.
 *
 * Usage:
 *   const t = TGi18n.make(MESSAGES, cfg);   // MESSAGES = { en:{...}, fr:{...} }
 *   t('viewDeal')                            // -> localized string
 *   t('left', { n: 4 })                      // -> "Only {n} left" with n filled
 *   TGi18n.fmt.currency(899, t.lang, 'GBP')  // -> "£899" / "899 €" / "899 €"
 *   TGi18n.fmt.date(new Date(), t.lang)      // -> locale long date
 * ========================================================================== */
(function () {
  'use strict';
  if (typeof window === 'undefined' || window.TGi18n) return;

  // Base language → a sensible default locale (so "en" means en-GB here, not US).
  var LOCALE = {
    en: 'en-GB', fr: 'fr-FR', de: 'de-DE', es: 'es-ES', it: 'it-IT',
    ro: 'ro-RO', nl: 'nl-NL', pt: 'pt-PT', pl: 'pl-PL', ar: 'ar', he: 'he'
  };
  var RTL = { ar: 1, he: 1, fa: 1, ur: 1 };

  // Normalise any language tag to its base code: "fr_FR" / "fr-CA" → "fr".
  function base(raw) {
    if (!raw) return '';
    return String(raw).toLowerCase().replace(/_/g, '-').split('-')[0];
  }

  // Resolve the viewer's language against the set a widget actually supports.
  // Order: explicit config (lang/language/locale) → page <html lang> → browser.
  // Falls back to English, or the first supported language if English is absent.
  function resolve(cfg, supported) {
    supported = (supported && supported.length) ? supported : ['en'];
    var cands = [];
    if (cfg) { cands.push(cfg.lang, cfg.language, cfg.locale); }
    try { cands.push(document.documentElement.getAttribute('lang')); } catch (e) { /* noop */ }
    try {
      if (navigator.languages) cands = cands.concat(navigator.languages);
      cands.push(navigator.language);
    } catch (e) { /* noop */ }
    for (var i = 0; i < cands.length; i++) {
      var b = base(cands[i]);
      if (b && supported.indexOf(b) !== -1) return b;
    }
    return supported.indexOf('en') !== -1 ? 'en' : supported[0];
  }

  // Build a bound translator for a catalogue + config.
  function make(messages, cfg) {
    messages = messages || {};
    var supported = Object.keys(messages);
    var lang = resolve(cfg, supported);
    var dict = messages[lang] || messages.en || {};
    var en = messages.en || {};
    function t(key, vars) {
      var s = (dict && Object.prototype.hasOwnProperty.call(dict, key)) ? dict[key]
        : (Object.prototype.hasOwnProperty.call(en, key) ? en[key] : key);
      if (vars) {
        s = String(s).replace(/\{(\w+)\}/g, function (m, k) {
          return (vars[k] !== undefined && vars[k] !== null) ? vars[k] : m;
        });
      }
      return s;
    }
    t.lang = lang;
    t.locale = LOCALE[lang] || lang || 'en-GB';
    t.dir = RTL[lang] ? 'rtl' : 'ltr';
    return t;
  }

  function localeOf(lang) { return LOCALE[base(lang)] || lang || 'en-GB'; }

  // Intl wrappers — always guarded so a bad locale/value never throws into a render.
  var fmt = {
    number: function (n, lang, opts) {
      try { return new Intl.NumberFormat(localeOf(lang), opts || {}).format(n); }
      catch (e) { return String(n); }
    },
    currency: function (n, lang, ccy, opts) {
      try {
        return new Intl.NumberFormat(localeOf(lang),
          Object.assign({ style: 'currency', currency: ccy || 'GBP' }, opts || {})).format(n);
      } catch (e) { return (ccy ? ccy + ' ' : '') + n; }
    },
    date: function (d, lang, opts) {
      try {
        var dd = (d instanceof Date) ? d : new Date(d);
        return new Intl.DateTimeFormat(localeOf(lang), opts || { year: 'numeric', month: 'long', day: 'numeric' }).format(dd);
      } catch (e) { return String(d); }
    }
  };

  window.TGi18n = {
    VERSION: '1.0.0',
    make: make,
    resolve: resolve,
    base: base,
    localeOf: localeOf,
    dir: function (l) { return RTL[base(l)] ? 'rtl' : 'ltr'; },
    fmt: fmt,
    LOCALES: LOCALE
  };
})();
