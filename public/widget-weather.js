/**
 * Travelgenix Weather Widget v1.0.0
 * Self-contained, embeddable destination weather widget.
 * Zero dependencies. Shadow DOM isolation. Works on any website via a single script tag.
 *
 * Data is fetched live at render-time from the Travelgenix Destination Content
 * database via /api/destination-content — never snapshotted into config.
 *
 * Phase 1 (this release): climatology-only.
 *   - 12-month temperature bars with season colour-coding
 *   - Rainfall strip beneath
 *   - °C / °F toggle (reader-controlled)
 *   - Current month highlighted
 *   - Best months callout (up to 3 months with one-line reasoning)
 *   - Optional CTA (agent-brandable, protocol-validated URL)
 *   - Three layouts: compact, standard, wide (switchable by config)
 *
 * Phase 2 (future): Open-Meteo-powered live "Today" strip above the climate
 *   chart, with graceful fallback to climatology when lat/lng or the proxy
 *   are unavailable. The widget has hooks (config.showLiveWeather) for it.
 *
 * Usage (remote config, default):
 *   <div data-tg-widget="weather" data-tg-id="YOUR_WIDGET_ID"></div>
 *   <script src="https://tg-widgets.vercel.app/widget-weather.js"></script>
 *
 * Usage (inline config, editor preview):
 *   <div data-tg-widget="weather" data-tg-config='{...}'></div>
 *   <script src="https://tg-widgets.vercel.app/widget-weather.js"></script>
 *
 * Inline config may also pass `destinationData` to bypass the live fetch.
 * The editor uses this for the preview iframe.
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
        if (/\/widget\-weather\.js(\?|$|#)/.test(s)) {
          return new URL(s).origin + '/api/widget-config';
        }
      }
    } catch (e) { /* fall through */ }
    return '/api/widget-config';
  }

  const API_BASE = resolveApiBase();
  const CONTENT_API = (function () {
    /* Resolve the CONTENT_API URL. Yesterday's fix patched widget-config but this
       secondary API was left with a relative default ('/api/destination-content'), which
       on customer sites resolves to the customer's domain and 404s. Same
       resolution strategy as the API_BASE resolver above. */
    if (typeof window === 'undefined') return '/api/destination-content';
    if (window.__TG_DEST_CONTENT_API__) return window.__TG_DEST_CONTENT_API__;
    try {
      var me = document.currentScript;
      if (me && me.src) return new URL(me.src).origin + '/api/destination-content';
      var scripts = document.getElementsByTagName('script');
      for (var i = scripts.length - 1; i >= 0; i--) {
        var s = scripts[i].src || '';
        if (/\/widget\-weather\.js(\?|$|#)/.test(s)) {
          return new URL(s).origin + '/api/destination-content';
        }
      }
    } catch (e) { /* fall through */ }
    return '/api/destination-content';
  })();
  const VERSION = '1.0.4';

  // ─── i18n ───────────────────────────────────────────────────
  // Fixed UI chrome only: month names, climate-band reason labels, the
  // season callout phrasing, the legend, the level eyebrow, and the empty /
  // error notices. English is the source + fallback. Author content (the
  // section headings and CTA text in config) and live API data (the
  // destination name, region, country) are NOT translated here. There is no
  // live weather-condition text in this Phase-1 climatology widget, so none
  // of these strings come from a weather API.
  const MESSAGES = {
    en: {
      monthsShort: ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'],
      monthsFull: ['January','February','March','April','May','June','July','August','September','October','November','December'],
      bandHot: 'Hot days', bandWarm: 'Warm days', bandMild: 'Mild days', bandCooler: 'Cooler days',
      littleRain: 'little rain', wetterThanAverage: 'wetter than average',
      peakConditions: 'Peak conditions', fewerCrowds: 'Fewer crowds',
      goodWindow: 'A good window to travel',
      peakSeason: 'Peak season', shoulderSeason: 'Shoulder season', offSeason: 'Off season',
      perfectTime: 'Perfect time to visit', goodTime: 'A good time to visit', quieterTime: 'Quieter time to visit',
      typically: 'Typically {temp}°{unit} in {month}.',
      levelCountry: 'Country', levelCity: 'City / Region', levelResort: 'Resort',
      tempUnits: 'Temperature units',
      legendBest: 'Best', legendShoulder: 'Shoulder', legendOff: 'Off', legendRainfall: 'Rainfall',
      srBest: 'best season', srShoulder: 'shoulder season', srOff: 'off season',
      srChart: 'Average daytime temperatures for {name}, January through December: {parts}.',
      thisDestination: 'this destination',
      enquire: 'Enquire',
      noDataTitle: 'Weather data not available',
      noDataBody: 'Please check the page configuration. This widget is looking for a destination with climate data that has not yet been populated.',
      errorTitle: 'Unable to load weather',
      errorBody: 'The climate data is temporarily unavailable. Please try again in a moment.',
    },
    fr: {
      monthsShort: ['janv.','févr.','mars','avr.','mai','juin','juil.','août','sept.','oct.','nov.','déc.'],
      monthsFull: ['janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre'],
      bandHot: 'Journées chaudes', bandWarm: 'Journées douces', bandMild: 'Journées tempérées', bandCooler: 'Journées fraîches',
      littleRain: 'peu de pluie', wetterThanAverage: 'plus humide que la moyenne',
      peakConditions: 'Conditions optimales', fewerCrowds: 'Moins de monde',
      goodWindow: 'Une bonne période pour voyager',
      peakSeason: 'Haute saison', shoulderSeason: 'Intersaison', offSeason: 'Basse saison',
      perfectTime: 'Moment idéal pour visiter', goodTime: 'Une bonne période pour visiter', quieterTime: 'Période plus calme pour visiter',
      typically: 'Généralement {temp}°{unit} en {month}.',
      levelCountry: 'Pays', levelCity: 'Ville / Région', levelResort: 'Station',
      tempUnits: 'Unités de température',
      legendBest: 'Optimale', legendShoulder: 'Intersaison', legendOff: 'Basse', legendRainfall: 'Précipitations',
      srBest: 'haute saison', srShoulder: 'intersaison', srOff: 'basse saison',
      srChart: 'Températures diurnes moyennes pour {name}, de janvier à décembre : {parts}.',
      thisDestination: 'cette destination',
      enquire: 'Demander',
      noDataTitle: 'Données météo non disponibles',
      noDataBody: 'Veuillez vérifier la configuration de la page. Ce widget recherche une destination dont les données climatiques ne sont pas encore renseignées.',
      errorTitle: 'Impossible de charger la météo',
      errorBody: 'Les données climatiques sont temporairement indisponibles. Veuillez réessayer dans un instant.',
    },
    de: {
      monthsShort: ['Jan','Feb','März','Apr','Mai','Juni','Juli','Aug','Sep','Okt','Nov','Dez'],
      monthsFull: ['Januar','Februar','März','April','Mai','Juni','Juli','August','September','Oktober','November','Dezember'],
      bandHot: 'Heiße Tage', bandWarm: 'Warme Tage', bandMild: 'Milde Tage', bandCooler: 'Kühlere Tage',
      littleRain: 'wenig Regen', wetterThanAverage: 'nasser als üblich',
      peakConditions: 'Beste Bedingungen', fewerCrowds: 'Weniger Andrang',
      goodWindow: 'Ein guter Reisezeitraum',
      peakSeason: 'Hauptsaison', shoulderSeason: 'Nebensaison', offSeason: 'Vorsaison',
      perfectTime: 'Perfekte Reisezeit', goodTime: 'Eine gute Reisezeit', quieterTime: 'Ruhigere Reisezeit',
      typically: 'Normalerweise {temp}°{unit} im {month}.',
      levelCountry: 'Land', levelCity: 'Stadt / Region', levelResort: 'Resort',
      tempUnits: 'Temperatureinheiten',
      legendBest: 'Beste', legendShoulder: 'Nebensaison', legendOff: 'Vorsaison', legendRainfall: 'Niederschlag',
      srBest: 'Hauptsaison', srShoulder: 'Nebensaison', srOff: 'Vorsaison',
      srChart: 'Durchschnittliche Tagestemperaturen für {name}, Januar bis Dezember: {parts}.',
      thisDestination: 'dieses Reiseziel',
      enquire: 'Anfragen',
      noDataTitle: 'Wetterdaten nicht verfügbar',
      noDataBody: 'Bitte prüfen Sie die Seitenkonfiguration. Dieses Widget sucht ein Reiseziel mit Klimadaten, die noch nicht hinterlegt sind.',
      errorTitle: 'Wetter kann nicht geladen werden',
      errorBody: 'Die Klimadaten sind vorübergehend nicht verfügbar. Bitte versuchen Sie es gleich erneut.',
    },
    es: {
      monthsShort: ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'],
      monthsFull: ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'],
      bandHot: 'Días calurosos', bandWarm: 'Días cálidos', bandMild: 'Días templados', bandCooler: 'Días más frescos',
      littleRain: 'poca lluvia', wetterThanAverage: 'más lluvioso de lo habitual',
      peakConditions: 'Condiciones óptimas', fewerCrowds: 'Menos gente',
      goodWindow: 'Una buena época para viajar',
      peakSeason: 'Temporada alta', shoulderSeason: 'Temporada media', offSeason: 'Temporada baja',
      perfectTime: 'Momento perfecto para visitar', goodTime: 'Una buena época para visitar', quieterTime: 'Época más tranquila para visitar',
      typically: 'Normalmente {temp}°{unit} en {month}.',
      levelCountry: 'País', levelCity: 'Ciudad / Región', levelResort: 'Resort',
      tempUnits: 'Unidades de temperatura',
      legendBest: 'Óptima', legendShoulder: 'Media', legendOff: 'Baja', legendRainfall: 'Precipitación',
      srBest: 'temporada alta', srShoulder: 'temporada media', srOff: 'temporada baja',
      srChart: 'Temperaturas diurnas medias para {name}, de enero a diciembre: {parts}.',
      thisDestination: 'este destino',
      enquire: 'Consultar',
      noDataTitle: 'Datos meteorológicos no disponibles',
      noDataBody: 'Compruebe la configuración de la página. Este widget busca un destino con datos climáticos que aún no se han cargado.',
      errorTitle: 'No se puede cargar la meteorología',
      errorBody: 'Los datos climáticos no están disponibles temporalmente. Inténtelo de nuevo en un momento.',
    },
    it: {
      monthsShort: ['gen','feb','mar','apr','mag','giu','lug','ago','set','ott','nov','dic'],
      monthsFull: ['gennaio','febbraio','marzo','aprile','maggio','giugno','luglio','agosto','settembre','ottobre','novembre','dicembre'],
      bandHot: 'Giornate calde', bandWarm: 'Giornate miti', bandMild: 'Giornate temperate', bandCooler: 'Giornate più fresche',
      littleRain: 'poca pioggia', wetterThanAverage: 'più piovoso della media',
      peakConditions: 'Condizioni ottimali', fewerCrowds: 'Meno affollamento',
      goodWindow: 'Un buon periodo per viaggiare',
      peakSeason: 'Alta stagione', shoulderSeason: 'Media stagione', offSeason: 'Bassa stagione',
      perfectTime: 'Momento perfetto per visitare', goodTime: 'Un buon periodo per visitare', quieterTime: 'Periodo più tranquillo per visitare',
      typically: 'In genere {temp}°{unit} a {month}.',
      levelCountry: 'Paese', levelCity: 'Città / Regione', levelResort: 'Resort',
      tempUnits: 'Unità di temperatura',
      legendBest: 'Ottimale', legendShoulder: 'Media', legendOff: 'Bassa', legendRainfall: 'Precipitazioni',
      srBest: 'alta stagione', srShoulder: 'media stagione', srOff: 'bassa stagione',
      srChart: 'Temperature diurne medie per {name}, da gennaio a dicembre: {parts}.',
      thisDestination: 'questa destinazione',
      enquire: 'Richiedi',
      noDataTitle: 'Dati meteo non disponibili',
      noDataBody: 'Controlla la configurazione della pagina. Questo widget cerca una destinazione con dati climatici non ancora inseriti.',
      errorTitle: 'Impossibile caricare il meteo',
      errorBody: 'I dati climatici non sono temporaneamente disponibili. Riprova tra un momento.',
    },
    ro: {
      monthsShort: ['ian.','feb.','mar.','apr.','mai','iun.','iul.','aug.','sept.','oct.','nov.','dec.'],
      monthsFull: ['ianuarie','februarie','martie','aprilie','mai','iunie','iulie','august','septembrie','octombrie','noiembrie','decembrie'],
      bandHot: 'Zile călduroase', bandWarm: 'Zile calde', bandMild: 'Zile blânde', bandCooler: 'Zile mai răcoroase',
      littleRain: 'puțină ploaie', wetterThanAverage: 'mai ploios decât media',
      peakConditions: 'Condiții optime', fewerCrowds: 'Mai puțină aglomerație',
      goodWindow: 'O perioadă bună pentru călătorie',
      peakSeason: 'Sezon de vârf', shoulderSeason: 'Sezon intermediar', offSeason: 'Extrasezon',
      perfectTime: 'Moment perfect pentru vizită', goodTime: 'O perioadă bună pentru vizită', quieterTime: 'Perioadă mai liniștită pentru vizită',
      typically: 'De obicei {temp}°{unit} în {month}.',
      levelCountry: 'Țară', levelCity: 'Oraș / Regiune', levelResort: 'Stațiune',
      tempUnits: 'Unități de temperatură',
      legendBest: 'Optim', legendShoulder: 'Intermediar', legendOff: 'Extrasezon', legendRainfall: 'Precipitații',
      srBest: 'sezon de vârf', srShoulder: 'sezon intermediar', srOff: 'extrasezon',
      srChart: 'Temperaturi medii diurne pentru {name}, din ianuarie până în decembrie: {parts}.',
      thisDestination: 'această destinație',
      enquire: 'Solicită',
      noDataTitle: 'Date meteo indisponibile',
      noDataBody: 'Verificați configurația paginii. Acest widget caută o destinație cu date climatice care nu au fost încă completate.',
      errorTitle: 'Vremea nu poate fi încărcată',
      errorBody: 'Datele climatice sunt temporar indisponibile. Încercați din nou într-un moment.',
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

  /* ------------------------------------------------------------------
   * Icon library — inline SVG path strings.
   * Small set — Weather needs far fewer icons than Spotlight.
   * ------------------------------------------------------------------ */
  const IC = {
    sun:       '<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>',
    snowflake: '<path d="M2 12h20"/><path d="M12 2v20"/><path d="m20 16-4-4 4-4"/><path d="m4 8 4 4-4 4"/><path d="m16 4-4 4-4-4"/><path d="m8 20 4-4 4 4"/>',
    cloud:     '<path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/>',
    rain:      '<path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242"/><path d="M16 14v6"/><path d="M8 14v6"/><path d="M12 16v6"/>',
    arrow:     '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
    calendar:  '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
    info:      '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
    alert:     '<path d="m21.73 18-8-14a2 2 0 0 0-3.46 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
    sparkle:   '<path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/>',
  };

  function icon(name, size) {
    const path = IC[name] || IC.sun;
    const s = size || 16;
    return '<svg xmlns="http://www.w3.org/2000/svg" width="' + s + '" height="' + s +
           '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"' +
           ' stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + path + '</svg>';
  }

  /* ------------------------------------------------------------------
   * Safety helpers — HTML escape + URL allowlist.
   * ------------------------------------------------------------------ */

  function esc(str) {
    if (str == null) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
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

  function safeUrl(url, allowMailtoTel) {
    if (typeof url !== 'string') return '';
    const trimmed = url.trim();
    if (!trimmed) return '';
    if (/^https?:\/\//i.test(trimmed)) return trimmed;
    if (allowMailtoTel && /^(mailto|tel):/i.test(trimmed)) return trimmed;
    return '';
  }

  // hex → rgba for soft-tint derivations
  function hexToRgba(hex, alpha) {
    if (typeof hex !== 'string') return 'rgba(0,0,0,' + alpha + ')';
    let h = hex.replace('#', '').trim();
    if (h.length === 3) h = h.split('').map(c => c + c).join('');
    if (h.length !== 6 || !/^[0-9a-f]{6}$/i.test(h)) return 'rgba(0,0,0,' + alpha + ')';
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
  }

  // Month labels
  const MONTH_LABELS = ['J','F','M','A','M','J','J','A','S','O','N','D'];
  const MONTH_NAMES_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const MONTH_NAMES_FULL = ['January','February','March','April','May','June',
                            'July','August','September','October','November','December'];

  // Country name → ISO-3166-1 alpha-2 → emoji flag. Covers the travel
  // catalogue's populated destinations. Unknown names return empty.
  // Extend as the catalogue grows.
  const COUNTRY_TO_ISO = {
    'greece': 'GR', 'spain': 'ES', 'italy': 'IT', 'france': 'FR', 'portugal': 'PT',
    'turkey': 'TR', 'croatia': 'HR', 'cyprus': 'CY', 'malta': 'MT',
    'united kingdom': 'GB', 'ireland': 'IE', 'iceland': 'IS',
    'usa': 'US', 'united states': 'US', 'canada': 'CA', 'mexico': 'MX',
    'jamaica': 'JM', 'barbados': 'BB', 'cuba': 'CU', 'dominican republic': 'DO',
    'saint lucia': 'LC', 'antigua and barbuda': 'AG', 'bahamas': 'BS',
    'maldives': 'MV', 'thailand': 'TH', 'vietnam': 'VN', 'cambodia': 'KH',
    'japan': 'JP', 'south korea': 'KR', 'indonesia': 'ID', 'singapore': 'SG',
    'malaysia': 'MY', 'philippines': 'PH', 'india': 'IN', 'sri lanka': 'LK',
    'australia': 'AU', 'new zealand': 'NZ', 'fiji': 'FJ',
    'kenya': 'KE', 'tanzania': 'TZ', 'south africa': 'ZA', 'morocco': 'MA',
    'egypt': 'EG', 'tunisia': 'TN', 'mauritius': 'MU', 'seychelles': 'SC',
    'uae': 'AE', 'united arab emirates': 'AE', 'oman': 'OM', 'jordan': 'JO',
    'switzerland': 'CH', 'austria': 'AT', 'germany': 'DE', 'netherlands': 'NL',
    'belgium': 'BE', 'denmark': 'DK', 'norway': 'NO', 'sweden': 'SE', 'finland': 'FI',
    'poland': 'PL', 'czech republic': 'CZ', 'hungary': 'HU',
    'brazil': 'BR', 'argentina': 'AR', 'chile': 'CL', 'peru': 'PE', 'colombia': 'CO',
    'costa rica': 'CR',
  };

  function flagEmoji(countryName) {
    if (typeof countryName !== 'string') return '';
    const iso = COUNTRY_TO_ISO[countryName.toLowerCase().trim()];
    if (!iso || iso.length !== 2) return '';
    // Regional indicator symbol letters — A=0x1F1E6, base offset from 'A'=65.
    const base = 0x1F1E6 - 65;
    try {
      return String.fromCodePoint(iso.charCodeAt(0) + base, iso.charCodeAt(1) + base);
    } catch (e) { return ''; }
  }

  /* ------------------------------------------------------------------
   * CSS — scoped inside Shadow DOM.
   * --tgw-* custom properties. Deliberately separate from --tgs-* (Spotlight)
   * so evolution of either widget doesn't leak styling into the other.
   * ------------------------------------------------------------------ */
  const STYLES = `
    :host { all: initial; display: block; box-sizing: border-box; }
    :host *, :host *::before, :host *::after { box-sizing: border-box; }

    .tgw-root {
      --tgw-brand: #1B2B5B;
      --tgw-accent: #00B4D8;
      --tgw-bg: #FFFFFF;
      --tgw-card: #FFFFFF;
      --tgw-surface: #F8FAFC;
      --tgw-text: #0F172A;
      --tgw-sub: #475569;
      --tgw-muted: #94A3B8;
      --tgw-border: #E2E8F0;
      --tgw-border-soft: #F1F5F9;
      --tgw-brand-soft: rgba(27,43,91,0.08);
      --tgw-accent-soft: rgba(0,180,216,0.12);

      --tgw-season-best: #00B4D8;
      --tgw-season-shoulder: #F59E0B;
      --tgw-season-off: #94A3B8;
      --tgw-rain: rgba(59,130,246,0.55);

      --tgw-radius: 16px;
      --tgw-radius-sm: 10px;
      --tgw-radius-xs: 6px;

      --tgw-shadow-sm: 0 1px 2px rgba(15,23,42,0.04), 0 1px 3px rgba(15,23,42,0.06);
      --tgw-shadow-md: 0 4px 16px rgba(15,23,42,0.08), 0 2px 4px rgba(15,23,42,0.04);

      font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      color: var(--tgw-text);
      background: var(--tgw-bg);
      line-height: 1.5;
      -webkit-font-smoothing: antialiased;
      -moz-osx-font-smoothing: grayscale;
    }

    .tgw-root[data-theme="dark"] {
      --tgw-bg: #0F172A;
      --tgw-card: #1E293B;
      --tgw-surface: #1E293B;
      --tgw-text: #F8FAFC;
      --tgw-sub: #CBD5E1;
      --tgw-muted: #64748B;
      --tgw-border: #334155;
      --tgw-border-soft: #1E293B;
      --tgw-brand-soft: rgba(0,180,216,0.12);
      --tgw-accent-soft: rgba(0,180,216,0.18);
      --tgw-season-off: #475569;
      --tgw-rain: rgba(96,165,250,0.65);
      --tgw-shadow-sm: 0 1px 2px rgba(0,0,0,0.25);
      --tgw-shadow-md: 0 4px 16px rgba(0,0,0,0.35);
    }

    /* ─── CARD SHELL ─────────────────────────────────── */
    .tgw-card {
      background: var(--tgw-card);
      border: 1px solid var(--tgw-border);
      border-radius: var(--tgw-radius);
      box-shadow: var(--tgw-shadow-sm);
      overflow: hidden;
      width: 100%;
    }

    /* ─── HEADER ─────────────────────────────────────── */
    .tgw-header {
      padding: 20px 22px 14px;
    }
    .tgw-eyebrow {
      display: inline-flex; align-items: center; gap: 6px;
      font-size: 10px; font-weight: 600;
      letter-spacing: 0.10em; text-transform: uppercase;
      color: var(--tgw-muted);
      margin: 0 0 6px;
    }
    .tgw-title {
      display: flex; align-items: center; gap: 10px;
      margin: 0;
      font-size: 22px; font-weight: 700; letter-spacing: -0.015em;
      color: var(--tgw-text);
      line-height: 1.15;
    }
    .tgw-title-flag {
      font-size: 24px; line-height: 1;
      display: inline-block;
    }

    /* ─── CURRENT-MONTH CALLOUT ──────────────────────── */
    .tgw-callout {
      display: flex; align-items: center; gap: 12px;
      margin: 14px 22px;
      padding: 14px 16px;
      background: var(--tgw-surface);
      border: 1px solid var(--tgw-border);
      border-radius: var(--tgw-radius-sm);
    }
    .tgw-callout-icon {
      width: 36px; height: 36px;
      flex: 0 0 36px;
      border-radius: 10px;
      background: var(--tgw-accent-soft);
      color: var(--tgw-accent);
      display: flex; align-items: center; justify-content: center;
    }
    .tgw-callout-body { min-width: 0; flex: 1; }
    .tgw-callout-label {
      font-size: 11px; font-weight: 600;
      letter-spacing: 0.08em; text-transform: uppercase;
      color: var(--tgw-muted);
      margin: 0 0 2px;
    }
    .tgw-callout-text {
      margin: 0;
      font-size: 14px; font-weight: 600; color: var(--tgw-text);
      line-height: 1.35;
    }
    .tgw-callout-sub {
      margin: 2px 0 0;
      font-size: 12px; color: var(--tgw-sub);
      line-height: 1.4;
    }
    .tgw-callout-pill {
      display: inline-flex; align-items: center; gap: 5px;
      padding: 3px 8px;
      background: var(--tgw-accent);
      color: #fff;
      border-radius: 999px;
      font-size: 10px; font-weight: 700;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      margin-right: 6px;
      vertical-align: 1px;
    }
    .tgw-callout-pill[data-season="shoulder"] { background: var(--tgw-season-shoulder); }
    .tgw-callout-pill[data-season="off"] { background: var(--tgw-season-off); color: #fff; }

    /* ─── CLIMATE STRIP ─────────────────────────────── */
    .tgw-climate {
      padding: 0 22px 16px;
    }
    .tgw-climate-header {
      display: flex; align-items: center; justify-content: space-between;
      gap: 12px;
      margin: 8px 0 12px;
    }
    .tgw-climate-heading {
      margin: 0;
      font-size: 13px; font-weight: 600;
      color: var(--tgw-text);
    }
    .tgw-climate-units {
      display: inline-flex; gap: 2px;
      padding: 3px;
      background: var(--tgw-border-soft);
      border-radius: 999px;
    }
    .tgw-climate-unit {
      border: 0; background: transparent;
      font: inherit; font-size: 11px; font-weight: 600;
      color: var(--tgw-sub);
      padding: 4px 10px;
      border-radius: 999px;
      cursor: pointer;
      min-width: 34px;
      transition: background 150ms ease, color 150ms ease, box-shadow 150ms ease;
      min-height: 24px;
    }
    .tgw-climate-unit:hover { color: var(--tgw-text); }
    .tgw-climate-unit[aria-pressed="true"] {
      background: var(--tgw-card);
      color: var(--tgw-text);
      box-shadow: 0 1px 2px rgba(15,23,42,0.08);
    }
    .tgw-root[data-theme="dark"] .tgw-climate-unit[aria-pressed="true"] {
      background: var(--tgw-bg);
      box-shadow: 0 1px 3px rgba(0,0,0,0.3);
    }

    .tgw-climate-chart {
      display: grid;
      grid-template-columns: repeat(12, 1fr);
      gap: 4px;
      align-items: end;
      height: 140px;
      margin: 0;
    }
    .tgw-climate-col {
      position: relative;
      display: flex; flex-direction: column; align-items: center;
      height: 100%;
    }
    .tgw-climate-col[data-current="true"] .tgw-climate-bar {
      box-shadow: 0 0 0 2px var(--tgw-card), 0 0 0 4px var(--tgw-text);
    }
    .tgw-climate-col[data-current="true"] .tgw-climate-temp {
      color: var(--tgw-text);
      font-weight: 700;
    }
    .tgw-climate-rain-cell[data-current="true"] {
      background: var(--tgw-text);
      opacity: 0.6;
    }
    .tgw-climate-month[data-current="true"] {
      color: var(--tgw-text);
      font-weight: 700;
    }
    .tgw-climate-bar {
      width: 100%;
      border-radius: 4px 4px 0 0;
      position: relative;
      transition: height 700ms cubic-bezier(.22,1,.36,1);
      background: var(--tgw-season-off);
    }
    .tgw-climate-bar[data-season="best"] { background: var(--tgw-season-best); }
    .tgw-climate-bar[data-season="shoulder"] { background: var(--tgw-season-shoulder); }
    .tgw-climate-bar[data-season="off"] { background: var(--tgw-season-off); }
    .tgw-climate-temp {
      font-size: 10px; font-weight: 600; color: var(--tgw-sub);
      margin-bottom: 3px;
      white-space: nowrap;
    }
    .tgw-climate-rain {
      height: 20px;
      display: grid;
      grid-template-columns: repeat(12, 1fr);
      gap: 4px;
      margin: 6px 0 4px;
      align-items: end;
    }
    .tgw-climate-rain-cell {
      background: var(--tgw-rain);
      border-radius: 2px 2px 0 0;
      min-height: 2px;
    }
    .tgw-climate-months {
      display: grid;
      grid-template-columns: repeat(12, 1fr);
      gap: 4px;
      text-align: center;
      margin-top: 4px;
    }
    .tgw-climate-month {
      font-size: 10px; font-weight: 500; color: var(--tgw-muted);
      letter-spacing: 0.02em;
    }
    .tgw-climate-legend {
      display: flex; gap: 14px; flex-wrap: wrap;
      margin-top: 12px;
      padding-top: 10px;
      border-top: 1px solid var(--tgw-border-soft);
      font-size: 11px; color: var(--tgw-sub);
    }
    .tgw-climate-legend-item { display: inline-flex; align-items: center; gap: 5px; }
    .tgw-climate-legend-swatch {
      width: 9px; height: 9px; border-radius: 2px;
    }
    .tgw-climate-sr-only {
      position: absolute;
      width: 1px; height: 1px;
      padding: 0; margin: -1px;
      overflow: hidden;
      clip: rect(0,0,0,0);
      white-space: nowrap;
      border: 0;
    }

    /* ─── BEST MONTHS PANEL ─────────────────────────── */
    .tgw-best {
      padding: 0 22px 16px;
    }
    .tgw-best-heading {
      margin: 0 0 8px;
      font-size: 13px; font-weight: 600;
      color: var(--tgw-text);
    }
    .tgw-best-list {
      display: flex; flex-direction: column; gap: 8px;
      margin: 0; padding: 0; list-style: none;
    }
    .tgw-best-item {
      display: flex; gap: 12px; align-items: center;
      padding: 10px 12px;
      background: var(--tgw-surface);
      border: 1px solid var(--tgw-border);
      border-radius: var(--tgw-radius-sm);
    }
    .tgw-best-month {
      flex: 0 0 auto;
      font-size: 11px; font-weight: 700;
      letter-spacing: 0.08em;
      color: var(--tgw-accent);
      background: var(--tgw-accent-soft);
      padding: 4px 10px;
      border-radius: 6px;
      text-transform: uppercase;
      white-space: nowrap;
    }
    .tgw-best-reason {
      font-size: 13px; color: var(--tgw-text);
      line-height: 1.35;
      min-width: 0;
    }

    /* ─── CTA ────────────────────────────────────────── */
    .tgw-cta {
      margin: 0;
      padding: 18px 22px;
      background: var(--tgw-brand);
      color: #fff;
      display: flex; align-items: center; justify-content: space-between;
      gap: 14px;
      flex-wrap: wrap;
    }
    .tgw-cta-body { flex: 1 1 180px; min-width: 0; }
    .tgw-cta-title {
      margin: 0 0 2px;
      font-size: 15px; font-weight: 600;
      color: #fff;
      line-height: 1.3;
    }
    .tgw-cta-sub {
      margin: 0;
      font-size: 12px;
      color: rgba(255,255,255,0.85);
      line-height: 1.4;
    }
    .tgw-cta-btn {
      display: inline-flex; align-items: center; gap: 6px;
      padding: 10px 16px;
      background: var(--tgw-accent);
      color: #fff;
      text-decoration: none;
      border-radius: 8px;
      font-size: 13px; font-weight: 600;
      transition: transform 150ms ease, box-shadow 150ms ease;
      min-height: 36px;
      white-space: nowrap;
      border: none;
      cursor: pointer;
    }
    .tgw-cta-btn:hover { transform: translateY(-1px); box-shadow: 0 6px 12px rgba(0,0,0,0.2); }
    .tgw-cta-btn:focus-visible { outline: 2px solid #fff; outline-offset: 3px; }

    /* ─── EMPTY / ERROR STATES ───────────────────────── */
    .tgw-notice {
      padding: 32px 24px;
      text-align: center;
      background: var(--tgw-card);
      border: 1px dashed var(--tgw-border);
      border-radius: var(--tgw-radius);
      color: var(--tgw-sub);
    }
    .tgw-notice-icon {
      width: 40px; height: 40px;
      border-radius: 50%;
      background: var(--tgw-brand-soft);
      color: var(--tgw-brand);
      display: inline-flex; align-items: center; justify-content: center;
      margin-bottom: 10px;
    }
    .tgw-notice-title {
      margin: 0 0 4px;
      font-size: 15px; font-weight: 600; color: var(--tgw-text);
    }
    .tgw-notice-body {
      margin: 0;
      font-size: 13px; color: var(--tgw-sub);
      max-width: 380px; margin-left: auto; margin-right: auto;
    }

    /* ─── LOADING SKELETON ───────────────────────────── */
    .tgw-skel {
      width: 100%;
      min-height: 320px;
      background: linear-gradient(90deg, var(--tgw-card) 0%, var(--tgw-border-soft) 50%, var(--tgw-card) 100%);
      background-size: 200% 100%;
      animation: tgw-shimmer 1.5s infinite;
      border-radius: var(--tgw-radius);
    }
    @keyframes tgw-shimmer {
      0% { background-position: 200% 0; }
      100% { background-position: -200% 0; }
    }

    /* ─── FOCUS ──────────────────────────────────────── */
    .tgw-root a:focus-visible,
    .tgw-root button:focus-visible {
      outline: 2px solid var(--tgw-accent);
      outline-offset: 3px;
      border-radius: 4px;
    }

    /* ─── LAYOUT VARIANTS ────────────────────────────── */
    /* COMPACT — sidebar-ready.
       Just header (slim) + current-month callout + climate strip. */
    .tgw-root[data-layout="compact"] .tgw-card { max-width: 380px; }
    .tgw-root[data-layout="compact"] .tgw-header { padding: 16px 18px 8px; }
    .tgw-root[data-layout="compact"] .tgw-title { font-size: 17px; }
    .tgw-root[data-layout="compact"] .tgw-callout { margin: 10px 18px; padding: 12px; }
    .tgw-root[data-layout="compact"] .tgw-callout-icon { width: 32px; height: 32px; flex-basis: 32px; }
    .tgw-root[data-layout="compact"] .tgw-climate { padding: 0 18px 14px; }
    .tgw-root[data-layout="compact"] .tgw-climate-chart { height: 110px; gap: 3px; }
    .tgw-root[data-layout="compact"] .tgw-climate-months,
    .tgw-root[data-layout="compact"] .tgw-climate-rain { gap: 3px; }
    .tgw-root[data-layout="compact"] .tgw-climate-temp { font-size: 9px; }

    /* STANDARD — the default. All enabled sections stacked vertically. */
    .tgw-root[data-layout="standard"] .tgw-card { max-width: 440px; }

    /* WIDE — horizontal layout. Climate left, callout + best months + CTA right. */
    .tgw-root[data-layout="wide"] .tgw-card { max-width: 820px; }
    .tgw-root[data-layout="wide"] .tgw-wide-split {
      display: grid;
      grid-template-columns: 1.35fr 1fr;
      gap: 0;
    }
    .tgw-root[data-layout="wide"] .tgw-wide-left {
      padding: 20px 22px;
      border-right: 1px solid var(--tgw-border);
    }
    .tgw-root[data-layout="wide"] .tgw-wide-right {
      padding: 20px 22px;
      display: flex; flex-direction: column; gap: 12px;
      background: var(--tgw-surface);
    }
    .tgw-root[data-layout="wide"] .tgw-header { padding: 0 0 14px; }
    .tgw-root[data-layout="wide"] .tgw-climate { padding: 0; }
    .tgw-root[data-layout="wide"] .tgw-callout { margin: 0; background: var(--tgw-card); }
    .tgw-root[data-layout="wide"] .tgw-best { padding: 0; }
    .tgw-root[data-layout="wide"] .tgw-cta { margin: 0; border-radius: var(--tgw-radius-sm); padding: 14px 16px; }
    .tgw-root[data-layout="wide"] .tgw-cta-title { font-size: 14px; }
    .tgw-root[data-layout="wide"] .tgw-cta-sub { font-size: 11px; }
    .tgw-root[data-layout="wide"] .tgw-cta-btn { padding: 8px 12px; font-size: 12px; min-height: 32px; }

    /* ─── RESPONSIVE ─────────────────────────────────── */
    /* Wide → stacked below 720px (narrow article sidebars, mobile).
       Standard/compact already work down to 320px; just tighten paddings. */
    @media (max-width: 720px) {
      .tgw-root[data-layout="wide"] .tgw-wide-split { grid-template-columns: 1fr; }
      .tgw-root[data-layout="wide"] .tgw-wide-left { border-right: 0; border-bottom: 1px solid var(--tgw-border); }
    }
    @media (max-width: 480px) {
      .tgw-header { padding: 16px 16px 8px; }
      .tgw-title { font-size: 18px; }
      .tgw-callout { margin: 10px 16px; padding: 12px; }
      .tgw-climate { padding: 0 16px 14px; }
      .tgw-best { padding: 0 16px 14px; }
      .tgw-climate-chart { height: 110px; gap: 3px; }
      .tgw-climate-months, .tgw-climate-rain { gap: 3px; }
      .tgw-climate-temp { font-size: 9px; }
      .tgw-cta { flex-direction: column; align-items: stretch; text-align: center; }
      .tgw-cta-body { flex: 0 0 auto; }
      .tgw-cta-btn { justify-content: center; }
    }

    @media (prefers-reduced-motion: reduce) {
      .tgw-root *, .tgw-root *::before, .tgw-root *::after {
        animation-duration: 0.01ms !important;
        animation-iteration-count: 1 !important;
        transition-duration: 0.01ms !important;
      }
    }
  `;

  /* ------------------------------------------------------------------
   * Climate helpers
   * ------------------------------------------------------------------ */

  // Derive a short "reason" phrase for a best/shoulder month based on
  // surrounding context. Keeps the best-months panel informative without
  // requiring bespoke content per destination.
  function reasonForMonth(i, temps, rain, season, unit, t) {
    const tNum = typeof temps[i] === 'number' ? (unit === 'F' ? Math.round(temps[i] * 9 / 5 + 32) : temps[i]) : null;
    const r = typeof rain[i] === 'number' ? rain[i] : null;
    const s = season[i];

    // Build rank by rainfall — lowest rainfall months win "driest" language
    const rainKnown = rain.filter(x => typeof x === 'number');
    const hasRainData = rainKnown.length >= 6;
    const avgRain = hasRainData ? rainKnown.reduce((a, b) => a + b, 0) / rainKnown.length : null;
    const lowRain = hasRainData && r !== null && r <= avgRain * 0.6;
    const highRain = hasRainData && r !== null && r >= avgRain * 1.4;

    const hotThreshold = unit === 'F' ? 81 : 27; // ~27°C / 81°F
    const warmThreshold = unit === 'F' ? 70 : 21;
    const coolThreshold = unit === 'F' ? 59 : 15;

    const tr = t || ((k) => MESSAGES.en[k] || k); // tolerate a missing translator
    const parts = [];
    if (tNum !== null) {
      if (tNum >= hotThreshold) parts.push(tr('bandHot'));
      else if (tNum >= warmThreshold) parts.push(tr('bandWarm'));
      else if (tNum >= coolThreshold) parts.push(tr('bandMild'));
      else parts.push(tr('bandCooler'));
    }
    if (lowRain) parts.push(tr('littleRain'));
    else if (highRain && s !== 'best') parts.push(tr('wetterThanAverage'));

    if (s === 'best' && parts.length === 0) parts.push(tr('peakConditions'));
    if (s === 'shoulder' && parts.length === 0) parts.push(tr('fewerCrowds'));

    return parts.join(', ');
  }

  // Find up to 3 "best" or best-scoring months for the panel.
  // Prefers season === 'best'; falls back to shoulder if not enough.
  function pickBestMonths(temps, rain, season, limit) {
    if (!Array.isArray(season) || season.length !== 12) return [];
    const L = typeof limit === 'number' ? limit : 3;

    const bestIdx = [];
    season.forEach((s, i) => { if (s === 'best') bestIdx.push(i); });
    const shoulderIdx = [];
    season.forEach((s, i) => { if (s === 'shoulder') shoulderIdx.push(i); });

    // If too many "best" months, prefer ones with lower rainfall.
    const scoreLowRain = (i) => typeof rain[i] === 'number' ? rain[i] : 0;

    const picked = [];
    if (bestIdx.length >= L) {
      picked.push(...bestIdx.slice().sort((a, b) => scoreLowRain(a) - scoreLowRain(b)).slice(0, L));
    } else {
      picked.push(...bestIdx);
      const need = L - picked.length;
      if (need > 0) {
        picked.push(...shoulderIdx.slice().sort((a, b) => scoreLowRain(a) - scoreLowRain(b)).slice(0, need));
      }
    }
    // Return in calendar order
    return picked.sort((a, b) => a - b);
  }

  // Human-readable month label (short). `t` provides the localised month list.
  function monthLabelShort(i, t) {
    const months = (t && t('monthsShort')) || MONTH_NAMES_SHORT;
    return months[i] || '';
  }

  // Build screen-reader chart description
  function climateSrDescription(name, temps, season, t) {
    if (!Array.isArray(temps) || temps.length !== 12) return '';
    const tr = t || ((k) => MESSAGES.en[k] || k);
    const monthsFull = tr('monthsFull');
    const parts = temps.map((temp, i) => {
      const s = season[i] || 'unknown';
      const seasonLabel = s === 'best' ? tr('srBest') : s === 'shoulder' ? tr('srShoulder') : tr('srOff');
      return monthsFull[i] + ' ' + temp + '°C (' + seasonLabel + ')';
    });
    return tr('srChart', { name: name, parts: parts.join(', ') });
  }

  /* ------------------------------------------------------------------
   * Main widget class
   * ------------------------------------------------------------------ */
  class TGWeatherWidget {
    constructor(container, config) {
      if (!container) throw new Error('TGWeatherWidget: container required');
      this.el = container;
      this.c = this._defaults(config);
      ensureFont(this.c.fontFamily);   // load the client-chosen web font on the host site (house rule 2)
      this.t = makeT(this.c);   // resolve viewer language + UI strings
      this.shadow = container.attachShadow ? container.attachShadow({ mode: 'open' }) : container;
      this._renderShell();

      if (this.c.destinationData && typeof this.c.destinationData === 'object') {
        this._destination = this.c.destinationData;
        this._renderContent();
      } else if (this.c.widgetId) {
        this._loadDestination();
      } else {
        this._renderNotFound();
      }

      container.setAttribute('data-tg-initialised', 'true');
    }

    _defaults(c) {
      const base = {
        widgetId: null,
        theme: 'light',            // 'light' | 'dark'
        brandColor: '#1B2B5B',
        accentColor: '#00B4D8',
        radius: 16,
        fontFamily: '',
        layout: 'standard',        // 'compact' | 'standard' | 'wide'
        temperatureUnit: 'C',      // 'C' | 'F'
        sections: {
          header: true,
          callout: true,
          climate: true,
          bestMonths: true,
          cta: true,
        },
        headings: {
          climate: '12-month climate',
          bestMonths: 'Best months to visit',
        },
        showFlag: true,            // country-level only
        // Phase 2 hook. Forced off in Phase 1 — the live strip requires
        // coordinates which the Destination Content base does not yet store.
        // When Phase 2 ships: flip to true, widget calls /api/weather-current,
        // renders the "Today" strip above the climate chart, and falls back
        // to climatology on any error. No editor changes needed beyond
        // surfacing the toggle.
        showLiveWeather: false,
        cta: {
          title: 'Plan your trip',
          subtitle: '',
          buttonLabel: 'Enquire now',
          url: '',
        },
        destination: null,
        destinationData: null,
      };
      if (!c || typeof c !== 'object') return base;
      const merged = Object.assign({}, base, c);
      merged.sections = Object.assign({}, base.sections, c.sections || {});
      merged.headings = Object.assign({}, base.headings, c.headings || {});
      merged.cta = Object.assign({}, base.cta, c.cta || {});
      return merged;
    }

    _renderShell() {
      while (this.shadow.firstChild) this.shadow.removeChild(this.shadow.firstChild);

      const style = document.createElement('style');
      style.textContent = STYLES;
      this.shadow.appendChild(style);

      this.root = document.createElement('div');
      this.root.className = 'tgw-root';
      this.root.setAttribute('data-theme', this.c.theme === 'dark' ? 'dark' : 'light');
      const layout = ['compact', 'standard', 'wide'].includes(this.c.layout) ? this.c.layout : 'standard';
      this.root.setAttribute('data-layout', layout);
      this._applyThemeVars();
      this.root.innerHTML = '<div class="tgw-skel" aria-hidden="true"></div>';
      this.shadow.appendChild(this.root);
    }

    _applyThemeVars() {
      const r = this.root;
      if (!r) return;
      if (this.c.brandColor) r.style.setProperty('--tgw-brand', this.c.brandColor);
      if (this.c.accentColor) {
        r.style.setProperty('--tgw-accent', this.c.accentColor);
        r.style.setProperty('--tgw-accent-soft', hexToRgba(this.c.accentColor, 0.14));
        r.style.setProperty('--tgw-season-best', this.c.accentColor);
      }
      if (this.c.brandColor) {
        r.style.setProperty('--tgw-brand-soft', hexToRgba(this.c.brandColor, 0.10));
      }
      if (this.c.radius != null) {
        const n = Math.max(0, Math.min(24, parseInt(this.c.radius, 10) || 16));
        r.style.setProperty('--tgw-radius', n + 'px');
        r.style.setProperty('--tgw-radius-sm', Math.max(4, n - 6) + 'px');
      }
      if (this.c.fontFamily) {
        r.style.fontFamily = this.c.fontFamily + ", 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
      }
    }

    async _loadDestination() {
      // Guard the fetch with a timeout so a stalled request (weak mobile link,
      // hung proxy, captive portal) aborts and falls through to the error
      // notice rather than leaving the loading skeleton shimmering forever.
      const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const timer = ctrl ? setTimeout(() => ctrl.abort(), 9000) : null;
      try {
        const url = CONTENT_API + '?id=' + encodeURIComponent(this.c.widgetId);
        const res = await fetch(url, ctrl ? { credentials: 'omit', signal: ctrl.signal } : { credentials: 'omit' });
        if (!res.ok) {
          if (res.status === 404) return this._renderNotFound();
          throw new Error('Content fetch failed (' + res.status + ')');
        }
        this._destination = await res.json();
        this._renderContent();
      } catch (err) {
        console.error('[TG Weather] Failed to load destination:', err);
        this._renderError();
      } finally {
        if (timer) clearTimeout(timer);
      }
    }

    _renderContent() {
      const d = this._destination;
      if (!d || !d.name) return this._renderNotFound();

      const temps = d.climate && d.climate.temps;
      const season = d.climate && d.climate.season;
      if (!Array.isArray(temps) || temps.length !== 12 || !Array.isArray(season) || season.length !== 12) {
        return this._renderNotFound();
      }

      // Initialise unit state (persists across re-renders from unit toggle)
      if (!this._tempUnit) this._tempUnit = this.c.temperatureUnit === 'F' ? 'F' : 'C';

      const layout = this.root.getAttribute('data-layout') || 'standard';
      if (layout === 'wide') {
        this.root.innerHTML = this._renderWide(d);
      } else {
        this.root.innerHTML = this._renderStacked(d);
      }
      this._bind();
    }

    _renderStacked(d) {
      const s = this.c.sections;
      const parts = [];
      if (s.header) parts.push(this._renderHeader(d));
      if (s.callout) parts.push(this._renderCallout(d));
      if (s.climate) parts.push(this._renderClimate(d));
      if (s.bestMonths) parts.push(this._renderBestMonths(d));
      if (s.cta) parts.push(this._renderCta());
      return '<div class="tgw-card">' + parts.filter(Boolean).join('') + '</div>';
    }

    _renderWide(d) {
      const s = this.c.sections;
      // Wide layout: header + climate on the left; callout + best months + CTA stacked right.
      const left = [];
      if (s.header) left.push(this._renderHeader(d));
      if (s.climate) left.push(this._renderClimate(d));

      const right = [];
      if (s.callout) right.push(this._renderCallout(d));
      if (s.bestMonths) right.push(this._renderBestMonths(d));
      if (s.cta) right.push(this._renderCta());

      return (
        '<div class="tgw-card">' +
          '<div class="tgw-wide-split">' +
            '<div class="tgw-wide-left">' + left.filter(Boolean).join('') + '</div>' +
            '<div class="tgw-wide-right">' + right.filter(Boolean).join('') + '</div>' +
          '</div>' +
        '</div>'
      );
    }

    _renderHeader(d) {
      const name = d.name || '';
      // Flag only shows for country-level destinations, and only if toggle is on.
      const flag = (this.c.showFlag && d.level === 'country') ? flagEmoji(name) : '';
      const flagHtml = flag ? '<span class="tgw-title-flag" aria-hidden="true">' + flag + '</span>' : '';
      // Eyebrow: region (if present) else the destination level.
      const levelLabel = d.level === 'country' ? this.t('levelCountry') : d.level === 'city' ? this.t('levelCity') : this.t('levelResort');
      const eyebrowText = d.region ? d.region : levelLabel;

      return (
        '<div class="tgw-header">' +
          '<p class="tgw-eyebrow">' + icon('cloud', 11) + '<span>' + esc(eyebrowText) + '</span></p>' +
          '<h2 class="tgw-title">' + flagHtml + '<span>' + esc(name) + '</span></h2>' +
        '</div>'
      );
    }

    _renderCallout(d) {
      const season = d.climate && d.climate.season;
      if (!Array.isArray(season) || season.length !== 12) return '';

      const m = new Date().getMonth();
      const s = season[m] || 'off';

      let pillLabel, headlineText, iconName;
      if (s === 'best') {
        pillLabel = this.t('peakSeason');
        headlineText = this.t('perfectTime');
        iconName = 'sun';
      } else if (s === 'shoulder') {
        pillLabel = this.t('shoulderSeason');
        headlineText = this.t('goodTime');
        iconName = 'cloud';
      } else {
        pillLabel = this.t('offSeason');
        headlineText = this.t('quieterTime');
        iconName = 'snowflake';
      }

      const temps = d.climate && d.climate.temps;
      const unit = this._tempUnit;
      const monthsFull = this.t('monthsFull');
      const tRaw = typeof temps[m] === 'number' ? temps[m] : null;
      const tDisp = tRaw === null ? '' : (unit === 'F' ? Math.round(tRaw * 9 / 5 + 32) : tRaw);
      const tempSentence = tRaw === null ? '' :
        this.t('typically', { temp: tDisp, unit: unit, month: monthsFull[m] });

      return (
        '<div class="tgw-callout">' +
          '<div class="tgw-callout-icon">' + icon(iconName, 18) + '</div>' +
          '<div class="tgw-callout-body">' +
            '<p class="tgw-callout-label">' + esc(monthsFull[m]) + '</p>' +
            '<p class="tgw-callout-text">' +
              '<span class="tgw-callout-pill" data-season="' + esc(s) + '">' + esc(pillLabel) + '</span>' +
              esc(headlineText) +
            '</p>' +
            (tempSentence ? '<p class="tgw-callout-sub">' + esc(tempSentence) + '</p>' : '') +
          '</div>' +
        '</div>'
      );
    }

    _renderClimate(d) {
      const temps = d.climate.temps;
      const rain = d.climate.rainfall;
      const season = d.climate.season;

      const currentMonth = new Date().getMonth();
      const unit = this._tempUnit;
      // Coerce every temp to a finite number. The temps array is remote data
      // (only <script> is stripped upstream), and in Celsius mode the value was
      // previously concatenated straight into innerHTML — a string entry like
      // '<img onerror=...>' would have executed. Non-numbers become null and
      // render as a dash with no markup.
      const conv = (c) => { const n = Number(c); return Number.isFinite(n) ? (unit === 'F' ? Math.round(n * 9 / 5 + 32) : n) : null; };

      const displayTemps = temps.map(conv);
      const finiteTemps = displayTemps.filter(n => Number.isFinite(n));
      const maxDisplay = finiteTemps.length ? Math.max.apply(null, finiteTemps) : (unit === 'F' ? 86 : 30);
      const minTempForScaling = unit === 'F' ? 32 : 0;
      const range = Math.max(maxDisplay - minTempForScaling, 1);

      const hasRain = Array.isArray(rain) && rain.length === 12;
      const maxRain = hasRain ? (Math.max.apply(null, rain.filter(n => typeof n === 'number')) || 1) : 1;

      const bars = displayTemps.map((t, i) => {
        const valid = Number.isFinite(t);
        const h = valid ? Math.max(6, Math.round(((t - minTempForScaling) / range) * 100)) : 6;
        const s = season[i] || 'off';
        const isCurrent = i === currentMonth;
        const currentAttr = isCurrent ? ' data-current="true"' : '';
        return (
          '<div class="tgw-climate-col"' + currentAttr + '>' +
            '<span class="tgw-climate-temp">' + (valid ? t : '–') + '°</span>' +
            '<div class="tgw-climate-bar" data-season="' + esc(s) + '" style="height:' + h + '%;" aria-hidden="true"></div>' +
          '</div>'
        );
      }).join('');

      const rainCells = hasRain ? rain.map((r, i) => {
        const h = Math.max(2, Math.round((r / maxRain) * 100));
        const currentAttr = i === currentMonth ? ' data-current="true"' : '';
        return '<div class="tgw-climate-rain-cell"' + currentAttr + ' style="height:' + h + '%;" aria-hidden="true"></div>';
      }).join('') : '';

      const months = MONTH_LABELS.map((m, i) => {
        const isCurrent = i === currentMonth;
        return '<span class="tgw-climate-month"' + (isCurrent ? ' data-current="true"' : '') + '>' + esc(m) + '</span>';
      }).join('');

      const srDesc = climateSrDescription(d.name || this.t('thisDestination'), temps, season, this.t);

      const unitToggle = (
        '<div class="tgw-climate-units" role="group" aria-label="' + esc(this.t('tempUnits')) + '">' +
          '<button type="button" class="tgw-climate-unit" data-unit="C" aria-pressed="' + (unit === 'C' ? 'true' : 'false') + '">°C</button>' +
          '<button type="button" class="tgw-climate-unit" data-unit="F" aria-pressed="' + (unit === 'F' ? 'true' : 'false') + '">°F</button>' +
        '</div>'
      );

      return (
        '<div class="tgw-climate">' +
          '<div class="tgw-climate-header">' +
            '<h3 class="tgw-climate-heading">' + esc(this.c.headings.climate) + '</h3>' +
            unitToggle +
          '</div>' +
          '<p class="tgw-climate-sr-only">' + esc(srDesc) + '</p>' +
          '<div class="tgw-climate-chart" role="img" aria-label="' + esc(srDesc) + '">' + bars + '</div>' +
          (rainCells ? '<div class="tgw-climate-rain" aria-hidden="true">' + rainCells + '</div>' : '') +
          '<div class="tgw-climate-months" aria-hidden="true">' + months + '</div>' +
          '<div class="tgw-climate-legend" aria-hidden="true">' +
            '<span class="tgw-climate-legend-item"><span class="tgw-climate-legend-swatch" style="background:var(--tgw-season-best);"></span>' + esc(this.t('legendBest')) + '</span>' +
            '<span class="tgw-climate-legend-item"><span class="tgw-climate-legend-swatch" style="background:var(--tgw-season-shoulder);"></span>' + esc(this.t('legendShoulder')) + '</span>' +
            '<span class="tgw-climate-legend-item"><span class="tgw-climate-legend-swatch" style="background:var(--tgw-season-off);"></span>' + esc(this.t('legendOff')) + '</span>' +
            (rainCells ? '<span class="tgw-climate-legend-item"><span class="tgw-climate-legend-swatch" style="background:var(--tgw-rain);"></span>' + esc(this.t('legendRainfall')) + '</span>' : '') +
          '</div>' +
        '</div>'
      );
    }

    _renderBestMonths(d) {
      const temps = d.climate.temps;
      const rain = Array.isArray(d.climate.rainfall) ? d.climate.rainfall : new Array(12).fill(null);
      const season = d.climate.season;
      const unit = this._tempUnit;

      const bestIdx = pickBestMonths(temps, rain, season, 3);
      if (bestIdx.length === 0) return '';

      const items = bestIdx.map(i => {
        const reason = reasonForMonth(i, temps, rain, season, unit, this.t) || this.t('goodWindow');
        return (
          '<li class="tgw-best-item">' +
            '<span class="tgw-best-month">' + esc(monthLabelShort(i, this.t)) + '</span>' +
            '<span class="tgw-best-reason">' + esc(reason) + '</span>' +
          '</li>'
        );
      }).join('');

      return (
        '<div class="tgw-best">' +
          '<h3 class="tgw-best-heading">' + icon('sparkle', 13) + ' ' + esc(this.c.headings.bestMonths) + '</h3>' +
          '<ul class="tgw-best-list">' + items + '</ul>' +
        '</div>'
      );
    }

    _renderCta() {
      const cta = this.c.cta || {};
      if (!cta.title && !cta.buttonLabel && !cta.url) return '';
      const url = safeUrl(cta.url, true);
      // A CTA with no valid destination is a dead-end control for a live
      // visitor, so omit the whole section. The disabled button is kept only
      // as an editor-preview affordance (the editor iframe sets __TG_PREVIEW__)
      // so the agent can see the CTA before filling in the URL.
      const isPreview = typeof window !== 'undefined' && window.__TG_PREVIEW__;
      if (!url && !isPreview) return '';
      const buttonHtml = url
        ? '<a class="tgw-cta-btn" href="' + esc(url) + '" rel="noopener">' + esc(cta.buttonLabel || this.t('enquire')) + icon('arrow', 13) + '</a>'
        : '<button class="tgw-cta-btn" type="button" disabled aria-disabled="true" style="opacity:0.8;cursor:not-allowed;">' + esc(cta.buttonLabel || this.t('enquire')) + icon('arrow', 13) + '</button>';

      return (
        '<div class="tgw-cta">' +
          '<div class="tgw-cta-body">' +
            '<h3 class="tgw-cta-title">' + esc(cta.title || '') + '</h3>' +
            (cta.subtitle ? '<p class="tgw-cta-sub">' + esc(cta.subtitle) + '</p>' : '') +
          '</div>' +
          buttonHtml +
        '</div>'
      );
    }

    _renderNotFound() {
      this.root.innerHTML =
        '<div class="tgw-notice">' +
          '<div class="tgw-notice-icon">' + icon('info', 18) + '</div>' +
          '<h2 class="tgw-notice-title">' + esc(this.t('noDataTitle')) + '</h2>' +
          '<p class="tgw-notice-body">' + esc(this.t('noDataBody')) + '</p>' +
        '</div>';
    }

    _renderError() {
      this.root.innerHTML =
        '<div class="tgw-notice">' +
          '<div class="tgw-notice-icon">' + icon('alert', 18) + '</div>' +
          '<h2 class="tgw-notice-title">' + esc(this.t('errorTitle')) + '</h2>' +
          '<p class="tgw-notice-body">' + esc(this.t('errorBody')) + '</p>' +
        '</div>';
    }

    _bind() {
      const r = this.root;
      if (!r) return;
      const unitBtns = r.querySelectorAll('.tgw-climate-unit');
      unitBtns.forEach(btn => {
        btn.addEventListener('click', () => {
          const unit = btn.getAttribute('data-unit');
          if (!unit || unit === this._tempUnit) return;
          this._tempUnit = unit;
          this._renderContent();
        });
      });
    }

    update(newConfig) {
      this.c = this._defaults(Object.assign({}, this.c, newConfig));
      ensureFont(this.c.fontFamily);   // load the client-chosen web font on the host site (house rule 2)
      this.t = makeT(this.c);
      // Reset unit state so editor config changes to temperatureUnit take effect
      if (newConfig && 'temperatureUnit' in newConfig) this._tempUnit = null;
      this._renderShell();
      if (this.c.destinationData) {
        this._destination = this.c.destinationData;
        this._renderContent();
      } else if (this.c.widgetId) {
        this._loadDestination();
      } else if (this._destination) {
        this._renderContent();
      } else {
        this._renderNotFound();
      }
    }

    destroy() {
      try { while (this.shadow.firstChild) this.shadow.removeChild(this.shadow.firstChild); } catch (e) { /* noop */ }
      this.el.removeAttribute('data-tg-initialised');
      this.el.__tgWeather = null;
    }
  }

  /* ------------------------------------------------------------------
   * Auto-initialiser
   * ------------------------------------------------------------------ */
  async function init() {
    const containers = document.querySelectorAll('[data-tg-widget="weather"]:not([data-tg-initialised])');
    for (const el of containers) {
      try {
        const inline = el.getAttribute('data-tg-config');
        if (inline) {
          let cfg = {};
          try { cfg = JSON.parse(inline); } catch { cfg = {}; }
          const w = new TGWeatherWidget(el, cfg);
          el.__tgWeather = w;
          continue;
        }

        const id = el.getAttribute('data-tg-id');
        if (id) {
          // Timeout-guard the config fetch — a stalled request aborts and
          // falls through to the catch fallback instead of hanging silently.
          const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
          const timer = ctrl ? setTimeout(() => ctrl.abort(), 9000) : null;
          const res = await fetch(API_BASE + '?id=' + encodeURIComponent(id),
            ctrl ? { credentials: 'omit', signal: ctrl.signal } : { credentials: 'omit' });
          if (timer) clearTimeout(timer);
          if (!res.ok) throw new Error('Widget config fetch failed (' + res.status + ')');
          const data = await res.json();
          const cfg = data && (data.config || data);
          cfg.widgetId = id;
          const w = new TGWeatherWidget(el, cfg);
          el.__tgWeather = w;
          continue;
        }
        console.warn('[TG Weather] Container has neither data-tg-id nor data-tg-config');
      } catch (err) {
        console.error('[TG Weather] Failed to initialise:', err);
        try {
          el.innerHTML = ''; el.style.display = 'none'; // fail quiet — never paint an error box on a client page
        } catch (e) { /* noop */ }
      }
    }
  }

  if (typeof window !== 'undefined') {
    window.TGWeatherWidget = TGWeatherWidget;
    window.__TG_WEATHER_VERSION__ = VERSION;
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', init);
    } else {
      init();
    }
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
              if (node.matches && node.matches('[data-tg-widget="weather"]:not([data-tg-initialised])')) {
                scheduleInit(); return;
              }
              if (node.querySelector && node.querySelector('[data-tg-widget="weather"]:not([data-tg-initialised])')) {
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
