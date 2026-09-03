/**
 * Travelgenix Attraction Spotlight Widget v1.4.0
 * Self-contained, embeddable showcase for a theme park, resort complex,
 * water park, aquarium or cultural attraction.
 *
 * Zero dependencies. Shadow DOM isolation. One script tag on any website.
 * Content is fetched live from /api/attraction-content (never snapshotted).
 *
 * The Theme Parks and Attractions table has no image field, so the hero is a
 * branded gradient (with a ferris-wheel watermark) or an optional
 * editor-supplied hero image under a brand-tinted duotone.
 *
 * Layout (v1.4, shared with the Destination and Airport Spotlights): compact
 * hero (Best For chips inside it), quick-facts rail across its bottom edge,
 * then a two-column body on wide embeds (config.layout 'auto' | 'stacked'):
 *   main: overview · star · guides · tickets · located · stay · food
 *   side: tips · combine · cta
 *
 * Usage (remote config, default):
 *   <div data-tg-widget="attraction" data-tg-id="YOUR_WIDGET_ID"></div>
 *   <script src="https://tg-widgets.vercel.app/widget-attraction.js"></script>
 *
 * Usage (inline config, editor preview / demo):
 *   <div data-tg-widget="attraction" data-tg-config='{...}'></div>
 * Inline config may pass `attractionData` to bypass the live fetch.
 */
(function () {
  'use strict';

  function resolveBase(path) {
    if (typeof window === 'undefined') return path;
    try {
      const me = document.currentScript;
      if (me && me.src) return new URL(me.src).origin + path;
      const scripts = document.getElementsByTagName('script');
      for (let i = scripts.length - 1; i >= 0; i--) {
        const s = scripts[i].src || '';
        if (/\/widget\-attraction\.js(\?|$|#)/.test(s)) return new URL(s).origin + path;
      }
    } catch (e) { /* fall through */ }
    return path;
  }
  const CONFIG_API  = (typeof window !== 'undefined' && window.__TG_WIDGET_API__) || resolveBase('/api/widget-config');
  const CONTENT_API = (typeof window !== 'undefined' && window.__TG_ATTRACTION_API__) || resolveBase('/api/attraction-content');
  const VERSION = '1.4.0';

  // Start a content fetch early (in parallel with the config fetch) so the two
  // requests don't wait on each other; the load method consumes it. Carries its
  // own timeout. (Spotlight-family speed, step 3.)
  function startContent(url) {
    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, 9000) : null;
    var p = fetch(url, ctrl ? { credentials: 'omit', signal: ctrl.signal } : { credentials: 'omit' });
    if (timer) p.then(function () { clearTimeout(timer); }, function () { clearTimeout(timer); });
    p.catch(function () {}); // handled so an unconsumed prefetch can't raise an unhandled rejection
    return p;
  }

  // The hero is a CSS background image, discovered late by the browser. A
  // preload link fetches it high-priority straight away so the hero paints
  // sooner. The URL is already validated by the caller. (Step 4.)
  function preloadImage(url) {
    try {
      if (!url || typeof document === 'undefined' || !document.head) return;
      var links = document.head.querySelectorAll('link[rel="preload"][as="image"]');
      for (var i = 0; i < links.length; i++) { if (links[i].getAttribute('href') === url) return; }
      var l = document.createElement('link');
      l.setAttribute('rel', 'preload');
      l.setAttribute('as', 'image');
      l.setAttribute('href', url);
      l.setAttribute('fetchpriority', 'high');
      document.head.appendChild(l);
    } catch (e) { /* noop */ }
  }

  // ─── i18n ───────────────────────────────────────────────────
  // Fixed UI chrome only (fact/section labels, badges, CTA button, empty/error
  // states and aria-labels). The attraction name, description, fact VALUES,
  // prices and place names are author/data content, translated upstream. English
  // is the source + fallback.
  const MESSAGES = {
    en: {
      onSiteHotels: 'On-site hotels', dogFriendly: 'Dog friendly', yes: 'Yes',
      typicalCost: 'Typical cost', timeNeeded: 'Time needed', season: 'Season',
      bestFor: 'Best for',
      overview: 'Overview', overviewSub: 'The attraction in brief', whenToGo: 'When to go',
      starAttractions: 'Star attractions', starSub: 'What not to miss',
      goodToKnow: 'Good to know', goodToKnowSub: 'Plan around your group',
      families: 'Families', thrillSeekers: 'Thrill-seekers',
      heightRestrictions: 'Height restrictions', accessibility: 'Accessibility',
      ticketsAndPrices: 'Tickets and prices', ticketsSub: 'Ticket types and passes',
      fastTrack: 'Fast-track and skip-the-queue',
      gettingThere: 'Getting there', nearestAirports: 'Nearest airports', nearestTown: 'Nearest town',
      whereToStay: 'Where to stay', nearbyHotels: 'Nearby hotels',
      foodAndDrink: 'Food and drink',
      insiderTips: 'Insider tips', insiderTipsSub: 'Things that catch first-timers out',
      combineTrip: 'Combine your trip', combineSub: 'Other attractions nearby',
      enquire: 'Enquire', startEnquiry: 'Start your enquiry', verified: 'Verified {date}',
      mapLabel: 'Map showing {name}',
      atAGlance: 'At a glance',
      notFoundTitle: 'Attraction not found',
      notFoundBody: 'This widget is looking for an attraction that is not in the content database yet.',
      errorTitle: 'Unable to load',
      errorBody: 'The attraction content is temporarily unavailable. Please try again in a moment.',
    },
    fr: {
      onSiteHotels: 'Hôtels sur place', dogFriendly: 'Chiens admis', yes: 'Oui',
      typicalCost: 'Coût habituel', timeNeeded: 'Temps nécessaire', season: 'Saison',
      bestFor: 'Idéal pour',
      overview: 'Aperçu', overviewSub: 'L\'attraction en bref', whenToGo: 'Quand y aller',
      starAttractions: 'Attractions phares', starSub: 'À ne pas manquer',
      goodToKnow: 'Bon à savoir', goodToKnowSub: 'Préparez selon votre groupe',
      families: 'Familles', thrillSeekers: 'Amateurs de sensations',
      heightRestrictions: 'Restrictions de taille', accessibility: 'Accessibilité',
      ticketsAndPrices: 'Billets et tarifs', ticketsSub: 'Types de billets et pass',
      fastTrack: 'Coupe-file et accès rapide',
      gettingThere: 'Comment s\'y rendre', nearestAirports: 'Aéroports les plus proches', nearestTown: 'Ville la plus proche',
      whereToStay: 'Où séjourner', nearbyHotels: 'Hôtels à proximité',
      foodAndDrink: 'Restauration',
      insiderTips: 'Conseils d\'initiés', insiderTipsSub: 'Ce qui surprend les nouveaux venus',
      combineTrip: 'Combinez votre voyage', combineSub: 'Autres attractions à proximité',
      enquire: 'Faire une demande', startEnquiry: 'Commencer votre demande', verified: 'Vérifié le {date}',
      mapLabel: 'Carte montrant {name}',
      notFoundTitle: 'Attraction introuvable',
      notFoundBody: 'Ce widget recherche une attraction qui n\'est pas encore dans la base de contenu.',
      errorTitle: 'Chargement impossible',
      errorBody: 'Le contenu de l\'attraction est temporairement indisponible. Veuillez réessayer dans un instant.',
    },
    de: {
      onSiteHotels: 'Hotels vor Ort', dogFriendly: 'Hunde erlaubt', yes: 'Ja',
      typicalCost: 'Typische Kosten', timeNeeded: 'Benötigte Zeit', season: 'Saison',
      bestFor: 'Ideal für',
      overview: 'Überblick', overviewSub: 'Die Attraktion im Überblick', whenToGo: 'Wann hinfahren',
      starAttractions: 'Top-Attraktionen', starSub: 'Das sollten Sie nicht verpassen',
      goodToKnow: 'Gut zu wissen', goodToKnowSub: 'Planen Sie nach Ihrer Gruppe',
      families: 'Familien', thrillSeekers: 'Adrenalinsuchende',
      heightRestrictions: 'Größenbeschränkungen', accessibility: 'Barrierefreiheit',
      ticketsAndPrices: 'Tickets und Preise', ticketsSub: 'Ticketarten und Pässe',
      fastTrack: 'Schnelleinlass ohne Anstehen',
      gettingThere: 'Anfahrt', nearestAirports: 'Nächste Flughäfen', nearestTown: 'Nächste Stadt',
      whereToStay: 'Unterkünfte', nearbyHotels: 'Hotels in der Nähe',
      foodAndDrink: 'Essen und Trinken',
      insiderTips: 'Insider-Tipps', insiderTipsSub: 'Worüber Erstbesucher stolpern',
      combineTrip: 'Reise kombinieren', combineSub: 'Weitere Attraktionen in der Nähe',
      enquire: 'Anfragen', startEnquiry: 'Anfrage starten', verified: 'Geprüft am {date}',
      mapLabel: 'Karte mit {name}',
      notFoundTitle: 'Attraktion nicht gefunden',
      notFoundBody: 'Dieses Widget sucht eine Attraktion, die noch nicht in der Inhaltsdatenbank ist.',
      errorTitle: 'Laden nicht möglich',
      errorBody: 'Der Attraktionsinhalt ist vorübergehend nicht verfügbar. Bitte versuchen Sie es gleich erneut.',
    },
    es: {
      onSiteHotels: 'Hoteles en el lugar', dogFriendly: 'Se admiten perros', yes: 'Sí',
      typicalCost: 'Coste típico', timeNeeded: 'Tiempo necesario', season: 'Temporada',
      bestFor: 'Ideal para',
      overview: 'Resumen', overviewSub: 'La atracción en breve', whenToGo: 'Cuándo ir',
      starAttractions: 'Atracciones estrella', starSub: 'Lo que no te puedes perder',
      goodToKnow: 'Bueno saber', goodToKnowSub: 'Planifica según tu grupo',
      families: 'Familias', thrillSeekers: 'Amantes de la emoción',
      heightRestrictions: 'Restricciones de altura', accessibility: 'Accesibilidad',
      ticketsAndPrices: 'Entradas y precios', ticketsSub: 'Tipos de entradas y pases',
      fastTrack: 'Acceso rápido sin colas',
      gettingThere: 'Cómo llegar', nearestAirports: 'Aeropuertos más cercanos', nearestTown: 'Ciudad más cercana',
      whereToStay: 'Dónde alojarse', nearbyHotels: 'Hoteles cercanos',
      foodAndDrink: 'Comida y bebida',
      insiderTips: 'Consejos de expertos', insiderTipsSub: 'Lo que sorprende a los primerizos',
      combineTrip: 'Combina tu viaje', combineSub: 'Otras atracciones cercanas',
      enquire: 'Consultar', startEnquiry: 'Iniciar tu consulta', verified: 'Verificado el {date}',
      mapLabel: 'Mapa que muestra {name}',
      notFoundTitle: 'Atracción no encontrada',
      notFoundBody: 'Este widget busca una atracción que aún no está en la base de contenido.',
      errorTitle: 'No se puede cargar',
      errorBody: 'El contenido de la atracción no está disponible temporalmente. Inténtalo de nuevo en un momento.',
    },
    it: {
      onSiteHotels: 'Hotel in loco', dogFriendly: 'Cani ammessi', yes: 'Sì',
      typicalCost: 'Costo tipico', timeNeeded: 'Tempo necessario', season: 'Stagione',
      bestFor: 'Ideale per',
      overview: 'Panoramica', overviewSub: 'L\'attrazione in breve', whenToGo: 'Quando andare',
      starAttractions: 'Attrazioni di punta', starSub: 'Da non perdere',
      goodToKnow: 'Buono a sapersi', goodToKnowSub: 'Organizza in base al tuo gruppo',
      families: 'Famiglie', thrillSeekers: 'Amanti del brivido',
      heightRestrictions: 'Limiti di altezza', accessibility: 'Accessibilità',
      ticketsAndPrices: 'Biglietti e prezzi', ticketsSub: 'Tipi di biglietti e pass',
      fastTrack: 'Accesso rapido salta-coda',
      gettingThere: 'Come arrivare', nearestAirports: 'Aeroporti più vicini', nearestTown: 'Città più vicina',
      whereToStay: 'Dove alloggiare', nearbyHotels: 'Hotel nelle vicinanze',
      foodAndDrink: 'Cibo e bevande',
      insiderTips: 'Consigli degli esperti', insiderTipsSub: 'Cosa spiazza chi arriva la prima volta',
      combineTrip: 'Combina il tuo viaggio', combineSub: 'Altre attrazioni nelle vicinanze',
      enquire: 'Richiedi info', startEnquiry: 'Inizia la richiesta', verified: 'Verificato il {date}',
      mapLabel: 'Mappa che mostra {name}',
      notFoundTitle: 'Attrazione non trovata',
      notFoundBody: 'Questo widget cerca un\'attrazione non ancora presente nel database dei contenuti.',
      errorTitle: 'Impossibile caricare',
      errorBody: 'Il contenuto dell\'attrazione è temporaneamente non disponibile. Riprova tra un istante.',
    },
    ro: {
      onSiteHotels: 'Hoteluri la fața locului', dogFriendly: 'Câini acceptați', yes: 'Da',
      typicalCost: 'Cost obișnuit', timeNeeded: 'Timp necesar', season: 'Sezon',
      bestFor: 'Ideal pentru',
      overview: 'Prezentare generală', overviewSub: 'Atracția pe scurt', whenToGo: 'Când să mergi',
      starAttractions: 'Atracții principale', starSub: 'Ce nu trebuie ratat',
      goodToKnow: 'Bine de știut', goodToKnowSub: 'Planifică în funcție de grupul tău',
      families: 'Familii', thrillSeekers: 'Iubitori de senzații tari',
      heightRestrictions: 'Restricții de înălțime', accessibility: 'Accesibilitate',
      ticketsAndPrices: 'Bilete și prețuri', ticketsSub: 'Tipuri de bilete și abonamente',
      fastTrack: 'Acces rapid fără coadă',
      gettingThere: 'Cum ajungi', nearestAirports: 'Cele mai apropiate aeroporturi', nearestTown: 'Cel mai apropiat oraș',
      whereToStay: 'Unde să stai', nearbyHotels: 'Hoteluri din apropiere',
      foodAndDrink: 'Mâncare și băutură',
      insiderTips: 'Sfaturi din interior', insiderTipsSub: 'Ce îi încurcă pe cei aflați prima dată',
      combineTrip: 'Combină-ți călătoria', combineSub: 'Alte atracții din apropiere',
      enquire: 'Trimite o solicitare', startEnquiry: 'Începe solicitarea', verified: 'Verificat la {date}',
      mapLabel: 'Hartă care arată {name}',
      notFoundTitle: 'Atracție negăsită',
      notFoundBody: 'Acest widget caută o atracție care nu se află încă în baza de conținut.',
      errorTitle: 'Nu se poate încărca',
      errorBody: 'Conținutul atracției este temporar indisponibil. Te rugăm să încerci din nou în câteva momente.',
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

  /* ===== Leaflet loader (same free CARTO/OSM tiles as the other widgets) === */
  const LEAFLET_JS  = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
  const LEAFLET_CSS = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
  const LEAFLET_JS_SRI  = 'sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=';
  const LEAFLET_CSS_SRI = 'sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=';
  let _leafletPromise = null;
  function loadLeaflet() {
    if (typeof window !== 'undefined' && window.L && window.L.map) return Promise.resolve(window.L);
    if (_leafletPromise) return _leafletPromise;
    _leafletPromise = new Promise((resolve, reject) => {
      if (!document.querySelector('link[data-tgx-leaflet]')) {
        const link = document.createElement('link');
        link.rel = 'stylesheet'; link.href = LEAFLET_CSS; link.integrity = LEAFLET_CSS_SRI;
        link.crossOrigin = ''; link.setAttribute('data-tgx-leaflet', '1');
        document.head.appendChild(link);
      }
      const s = document.createElement('script');
      s.src = LEAFLET_JS; s.integrity = LEAFLET_JS_SRI; s.crossOrigin = ''; s.async = true;
      s.onload = () => resolve(window.L);
      s.onerror = () => reject(new Error('Failed to load Leaflet'));
      document.head.appendChild(s);
    });
    return _leafletPromise;
  }

  /* ===== Icons (Lucide-style inline SVG paths) ===================== */
  const IC = {
    pin:      '<path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>',
    coin:     '<circle cx="12" cy="12" r="9"/><path d="M14.8 9a2 2 0 0 0-1.8-1h-2a2 2 0 0 0 0 4h2a2 2 0 0 1 0 4h-2a2 2 0 0 1-1.8-1"/><path d="M12 6v2"/><path d="M12 16v2"/>',
    calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
    sun:      '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>',
    bed:      '<path d="M2 4v16"/><path d="M2 8h18a2 2 0 0 1 2 2v10"/><path d="M2 17h20"/><path d="M6 8V6a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v2"/>',
    paw:      '<circle cx="11" cy="4" r="2"/><circle cx="18" cy="8" r="2"/><circle cx="20" cy="16" r="2"/><path d="M9 10a5 5 0 0 1 5 5v3a2.5 2.5 0 0 1-5 0 2.5 2.5 0 0 0-5 0 2.5 2.5 0 0 1-5 0v-1a5 5 0 0 1 5-5z"/>',
    star:     '<path d="M11.5 3.5a.55.55 0 0 1 1 0l2.14 6.58h6.92a.55.55 0 0 1 .32.99l-5.6 4.07 2.14 6.58a.55.55 0 0 1-.85.61L12 17.27l-5.6 4.06a.55.55 0 0 1-.85-.61l2.14-6.58-5.6-4.07a.55.55 0 0 1 .32-.99h6.92z"/>',
    users:    '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
    zap:      '<path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/>',
    ruler:    '<path d="M21.3 8.7 8.7 21.3a1 1 0 0 1-1.4 0l-4.6-4.6a1 1 0 0 1 0-1.4L15.3 2.7a1 1 0 0 1 1.4 0l4.6 4.6a1 1 0 0 1 0 1.4z"/><path d="m7.5 10.5 2 2M10.5 7.5l2 2M13.5 4.5l2 2"/>',
    access:   '<circle cx="12" cy="4" r="2"/><path d="M19 13v-2a7 7 0 0 0-14 0v2"/><path d="M12 6v8"/><path d="M9 22a4 4 0 0 1 0-8M15 22a4 4 0 0 0 0-8"/>',
    ticket:   '<path d="M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2z"/><path d="M13 5v14"/>',
    plane:    '<path d="M17.8 19.2 16 11l3.5-3.5c.5-.5 1-2.5.5-3-1-.5-3 0-3.5.5L13 8.5 4.8 6.5c-.5-.1-.9.2-.9.7v.4c0 .3.2.6.5.8L8 10.5 6 14H3l-.5 1.5L5 17l1.5 2.5L8 19v-3l3.5-2 2.8 3.5c.2.3.5.5.8.5h.4c.5 0 .8-.4.7-.9z"/>',
    car:      '<path d="M14 16H9m10 0h3v-3.15a1 1 0 0 0-.84-.99L16 11l-2.7-3.6a1 1 0 0 0-.8-.4H5.24a2 2 0 0 0-1.8 1.1l-.8 1.63A6 6 0 0 0 2 12.42V16h2"/><circle cx="6.5" cy="16.5" r="2.5"/><circle cx="16.5" cy="16.5" r="2.5"/>',
    building: '<rect x="4" y="2" width="16" height="20" rx="2"/><path d="M9 22v-4h6v4"/><path d="M8 6h.01M12 6h.01M16 6h.01M8 10h.01M12 10h.01M16 10h.01"/>',
    utensils: '<path d="M3 2v7a3 3 0 0 0 6 0V2M6 9v13"/><path d="M16 2a4 4 0 0 0-4 4v5h4m0-9v20"/>',
    forward:  '<path d="m13 19 9-7-9-7v14z"/><path d="M2 19l9-7-9-7v14z"/>',
    alert:    '<path d="m21.73 18-8-14a2 2 0 0 0-3.46 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3z"/><path d="M12 9v4M12 17h.01"/>',
    link:     '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
    briefcase:'<rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>',
    info:     '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>',
    check:    '<path d="M20 6 9 17l-5-5"/>',
    arrow:    '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
    arrow_out:'<path d="M7 7h10v10"/><path d="M7 17 17 7"/>',
    compass:  '<circle cx="12" cy="12" r="10"/><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"/>',
    shield:   '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
    coaster:  '<path d="M6 19V5"/><path d="M10 19V6.8"/><path d="M14 19v-7.8"/><path d="M18 5v4"/><path d="M18 19v-6"/><path d="M22 19V9"/><path d="M2 19V9a8 8 0 0 1 8-8c4 0 5 2 8 2"/>',
    sparkles: '<path d="M9.5 2.5 11 6.8l4.3 1.5L11 9.8l-1.5 4.3L8 9.8 3.7 8.3 8 6.8z"/><path d="M18 3.5l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7z"/><path d="M18.5 15l.6 1.7 1.7.6-1.7.6-.6 1.7-.6-1.7-1.7-.6 1.7-.6z"/>',
    ferris:   '<circle cx="12" cy="12" r="2"/><path d="M12 2v4"/><path d="m6.8 15-3.5 2"/><path d="m20.7 7-3.5 2"/><path d="M6.8 9 3.3 7"/><path d="m20.7 17-3.5-2"/><path d="m9 22 3-8 3 8"/><path d="M8 22h8"/><path d="M18 18.7a9 9 0 1 0-12 0"/>',
    rocket:   '<path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"/><path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"/><path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0"/><path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5"/>',
  };
  function icon(name, size) {
    const path = IC[name] || IC.info;
    const s = size || 18;
    return '<svg xmlns="http://www.w3.org/2000/svg" width="' + s + '" height="' + s +
      '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"' +
      ' stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + path + '</svg>';
  }

  /* ===== Safety helpers ===== */
  function esc(str) {
    if (str == null) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function safeUrl(url, allowMailtoTel) {
    if (typeof url !== 'string') return '';
    const t = url.trim();
    if (!t) return '';
    if (/^https?:\/\//i.test(t)) return t;
    if (allowMailtoTel && /^(mailto|tel):/i.test(t)) return t;
    return '';
  }
  function renderTemplate(str, vars) {
    if (typeof str !== 'string' || !str) return '';
    if (!vars) return str;
    return str.replace(/\{\{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*\}\}/g, (_, k) => (vars[k] == null ? '' : String(vars[k])))
      .replace(/\s{2,}/g, ' ').trim();
  }
  function paras(text, max) {
    return String(text || '').split(/\n{2,}/).map(s => s.trim()).filter(Boolean)
      .slice(0, max || 8).map(p => '<p>' + esc(p).replace(/\n/g, '<br>') + '</p>').join('');
  }

  /* ------------------------------------------------------------------
   * Client content overrides.
   *
   * Content is fetched live from Luna Brain and never snapshotted into
   * config. Clients may rewrite the editorial prose in their own voice;
   * those rewrites live in config.contentOverrides (keyed by attraction
   * recordId) and are merged over the live payload here, at render time.
   * Only the whitelisted prose fields are overridable — facts, badges,
   * location, map coordinates and the verified date always stay live, so a
   * stale rewrite can never publish a wrong fact. Each override is { v, o }
   * where v is the client's text and o is the Luna original at edit time
   * (o is used by the editor for drift detection; the widget ignores it).
   * ------------------------------------------------------------------ */
  var OVERRIDABLE_FIELDS = [
    'tagline', 'overview', 'bestTime', 'starAttractions', 'familyGuide',
    'thrillGuide', 'heightRestrict', 'accessibility', 'tickets', 'fastTrack',
    'nearestAirport', 'gettingThere', 'nearestTown', 'onSiteHotels',
    'nearbyHotels', 'foodDrink', 'quirks', 'combineWith',
  ];
  function applyContentOverrides(data, ov) {
    if (!data || !ov || typeof ov !== 'object') return data;
    // Return a shallow copy — never mutate the caller's object. The editor
    // renders its live preview in-page and hands us a reference to its cached
    // Luna payload; mutating it would corrupt the editor's "revert to Luna"
    // and drift detection. Only top-level scalar prose fields are replaced.
    var out = {};
    for (var key in data) { if (Object.prototype.hasOwnProperty.call(data, key)) out[key] = data[key]; }
    OVERRIDABLE_FIELDS.forEach(function (k) {
      var o = ov[k];
      if (o && typeof o.v === 'string') out[k] = o.v;
    });
    return out;
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

  /* ===== Widget class ===== */
  class TGAttractionWidget {
    constructor(container, config) {
      if (!container) throw new Error('TGAttractionWidget: container required');
      this.el = container;
      this.c = this._defaults(config);
      ensureFont(this.c.fontFamily);   // load the client-chosen web font on the host site (house rule 2)
      this.t = makeT(this.c);   // resolve viewer language + UI strings
      if (container.shadowRoot) {
        this.shadow = container.shadowRoot;
        while (this.shadow.firstChild) this.shadow.removeChild(this.shadow.firstChild);
      } else if (container.attachShadow) {
        this.shadow = container.attachShadow({ mode: 'open' });
      } else {
        this.shadow = container;
      }
      this._mapInst = null;
      this._renderShell();
      if (this.c.attractionData && typeof this.c.attractionData === 'object') {
        this._data = this._withOverrides(this.c.attractionData);
        this._renderContent();
      } else if (this.c.widgetId || this.c.recordId) {
        this._load();
      } else {
        this._renderNotFound();
      }
      container.setAttribute('data-tg-initialised', 'true');
    }

    _defaults(c) {
      const base = {
        widgetId: null,
        theme: 'light',
        layout: 'auto',   // 'auto' (side column once the widget is 900px wide) | 'stacked'
        brandColor: '#1B2B5B',
        accentColor: '#00B4D8',
        radius: 16,
        fontFamily: '',
        heroImageUrl: '',
        showMap: true,
        recordId: null,
        sections: {
          hero: true, facts: true, bestfor: true, overview: true, star: true,
          guides: true, tickets: true, located: true, stay: true, food: true,
          tips: true, combine: true, cta: true,
        },
        cta: {
          title: 'Plan your visit to {{name}}',
          subtitle: 'Speak to us about packaging tickets, hotels and transfers.',
          buttonLabel: '',   // empty = localised default (this.t('startEnquiry'))
          buttonUrl: '',
        },
        attractionData: null,
        contentOverrides: {},   // client rewrites, keyed by attraction recordId
      };
      if (!c || typeof c !== 'object') return base;
      const m = Object.assign({}, base, c);
      m.sections = Object.assign({}, base.sections, c.sections || {});
      m.cta = Object.assign({}, base.cta, c.cta || {});
      m.layout = m.layout === 'stacked' ? 'stacked' : 'auto';
      return m;
    }

    _renderShell() {
      while (this.shadow.firstChild) this.shadow.removeChild(this.shadow.firstChild);
      try { if (this.el.style && this.el.style.display === 'none') this.el.style.display = ''; } catch (e) {}
      const style = document.createElement('style');
      style.textContent = STYLES;
      this.shadow.appendChild(style);
      const root = document.createElement('div');
      root.className = 'tgx-root';
      root.setAttribute('data-theme', this.c.theme === 'dark' ? 'dark' : 'light');
      root.setAttribute('data-layout', this.c.layout === 'stacked' ? 'stacked' : 'auto');
      if (this.c.brandColor) root.style.setProperty('--tgx-brand', this.c.brandColor);
      if (this.c.accentColor) {
        root.style.setProperty('--tgx-accent', this.c.accentColor);
        root.style.setProperty('--tgx-accent-soft', hexToRgba(this.c.accentColor, 0.14));
        root.style.setProperty('--tgx-accent-tint', hexToRgba(this.c.accentColor, 0.38));
      }
      if (this.c.brandColor) {
        root.style.setProperty('--tgx-brand-soft', hexToRgba(this.c.brandColor, 0.10));
        root.style.setProperty('--tgx-brand-tint', hexToRgba(this.c.brandColor, 0.78));
        root.style.setProperty('--tgx-brand-tint-2', hexToRgba(this.c.brandColor, 0.35));
      }
      if (this.c.radius != null) {
        const n = Math.max(0, Math.min(24, parseInt(this.c.radius, 10) || 16));
        root.style.setProperty('--tgx-radius', n + 'px');
        root.style.setProperty('--tgx-radius-sm', Math.max(4, n - 6) + 'px');
      }
      if (this.c.fontFamily) root.style.fontFamily = "'" + String(this.c.fontFamily).replace(/'/g, '') + "', 'Inter', -apple-system, sans-serif";
      root.innerHTML = '<div class="tgx-loading"><div class="tgx-skel"></div></div>';
      this.shadow.appendChild(root);
      this._root = root;
    }

    async _load() {
      // Timeout-guard the content fetch — a hung upstream (dead proxy, captive
      // portal) aborts and falls through to the error notice instead of leaving
      // the loading skeleton shimmering forever (23 Jul 2026 audit).
      const qs = this.c.recordId
        ? '?recordId=' + encodeURIComponent(this.c.recordId)
        : '?id=' + encodeURIComponent(this.c.widgetId);
      // Reuse the content request the init fired in parallel with the config
      // fetch (it carries its own timeout). Consume once, then fall back to a
      // fresh timeout-guarded fetch on any re-load.
      const prefetched = this.c && this.c.__contentResponse;
      if (this.c) this.c.__contentResponse = null;
      const ctrl = (!prefetched && typeof AbortController !== 'undefined') ? new AbortController() : null;
      const timer = ctrl ? setTimeout(() => ctrl.abort(), 9000) : null;
      try {
        const res = await (prefetched || fetch(CONTENT_API + qs, ctrl ? { credentials: 'omit', signal: ctrl.signal } : { credentials: 'omit' }));
        if (!res.ok) { if (res.status === 404) return this._renderNotFound(); throw new Error('fetch ' + res.status); }
        const data = await res.json();
        if (!data || data.found === false || !data.attraction) return this._renderNotFound();
        this._data = this._withOverrides(data.attraction);
        this._renderContent();
      } catch (err) {
        console.error('[TG Attraction] load failed:', err);
        this._renderError();
      } finally {
        if (timer) clearTimeout(timer);
      }
    }

    // Merge the client's content overrides for THIS attraction over a
    // freshly-fetched Luna payload. Keyed by recordId; whitelisted prose only.
    _withOverrides(data) {
      // The editor saves the selection as config.attraction.recordId; a legacy
      // top-level recordId is honoured as a fallback.
      const id = (this.c.attraction && this.c.attraction.recordId) || this.c.recordId || '';
      const all = this.c.contentOverrides;
      if (!id || !all || typeof all !== 'object') return data;
      const ov = all[id];
      return ov ? applyContentOverrides(data, ov) : data;
    }

    _renderContent() {
      const d = this._data;
      if (!d || !d.name) return this._renderNotFound();
      const s = this.c.sections;
      // Layout (v1.4): a compact opener, then a two-column body.
      //   hero, with the Best For chips inside it
      //   quick-facts rail, riding across the hero's bottom edge on wide embeds
      //   body: main column = overview → star → guides → tickets → located → stay → food
      //         side column = insider tips → combine your trip → CTA
      // The side column sits to the right once the widget is 900px wide
      // (container query; never when config.layout is 'stacked') and stacks
      // beneath the main column otherwise, so this DOM order is also the phone
      // reading order. Toggles still remove any part; an empty column collapses.
      const bestForHtml = s.bestfor ? this._renderBestForChips(d) : '';
      const factsHtml = s.facts ? this._renderFacts(d) : '';
      const html = [];
      if (s.hero) html.push(this._renderHero(d, bestForHtml, !!factsHtml));
      else if (bestForHtml) html.push(this._renderBestFor(d));
      if (factsHtml) html.push('<section class="tgx-facts-wrap" aria-label="' + esc(this.t('atAGlance')) + '">' + factsHtml + '</section>');

      const main = [
        s.overview ? this._renderOverview(d) : '',
        s.star     ? this._renderStar(d) : '',
        s.guides   ? this._renderGuides(d) : '',
        s.tickets  ? this._renderTickets(d) : '',
        s.located  ? this._renderLocated(d) : '',
        s.stay     ? this._renderStay(d) : '',
        s.food     ? this._renderFood(d) : '',
      ].filter(Boolean);
      const side = [
        s.tips    ? this._renderTips(d) : '',
        s.combine ? this._renderCombine(d) : '',
        s.cta     ? this._renderCta(d) : '',
      ].filter(Boolean);
      if (main.length || side.length) {
        html.push(
          '<div class="tgx-body" data-side="' + (main.length && side.length ? '1' : '0') + '">' +
            (main.length ? '<div class="tgx-main">' + main.join('') + '</div>' : '') +
            (side.length ? '<aside class="tgx-side">' + side.join('') + '</aside>' : '') +
          '</div>'
        );
      }
      this._root.innerHTML = html.filter(Boolean).join('');
      if (s.located && this.c.showMap !== false && typeof d.lat === 'number' && typeof d.lng === 'number') {
        this._initMap(d);
      }
    }

    _initMap(d) {
      const host = this.shadow.querySelector('[data-tgx-map]');
      if (!host) return;
      // Shadow DOM is style-encapsulated, so the Leaflet stylesheet must also be
      // added inside the shadow root or tiles render as broken images.
      if (!this.shadow.querySelector('link[data-tgx-leaflet-shadow]')) {
        const link = document.createElement('link');
        link.rel = 'stylesheet'; link.href = LEAFLET_CSS; link.integrity = LEAFLET_CSS_SRI;
        link.crossOrigin = ''; link.setAttribute('data-tgx-leaflet-shadow', '1');
        this.shadow.appendChild(link);
      }
      loadLeaflet().then(L => {
        if (this._mapInst) { try { this._mapInst.remove(); } catch (e) {} this._mapInst = null; }
        const map = L.map(host, { zoomControl: true, scrollWheelZoom: false });
        this._mapInst = map;
        L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
          attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
          subdomains: 'abcd', maxZoom: 19,
        }).addTo(map);
        const pin = L.divIcon({ className: '', html: '<div class="tgx-pin"></div>', iconSize: [28, 28], iconAnchor: [14, 28] });
        L.marker([d.lat, d.lng], { icon: pin }).addTo(map)
          .bindPopup('<strong>' + esc(d.name) + '</strong>' + (d.location ? '<br>' + esc(d.location) : ''));
        map.setView([d.lat, d.lng], 12);
        map.on('click', () => map.scrollWheelZoom.enable());
        map.on('mouseout', () => map.scrollWheelZoom.disable());
      }).catch(() => { /* silent: the text directions still show */ });
    }

    // One heading per section (the section's name, with its icon inline) and
    // the editorial line beneath it as a subline. The old kicker-above-h2 pair
    // cost ~90px per section and read the same everywhere.
    _section(ico, kicker, h2, inner) {
      if (!inner) return '';
      return '<section class="tgx-section">' +
        '<div class="tgx-section-head">' +
          '<h2 class="tgx-h2"><span class="tgx-section-icon" aria-hidden="true">' + icon(ico, 18) + '</span><span>' + esc(kicker) + '</span></h2>' +
          (h2 ? '<p class="tgx-section-sub">' + esc(h2) + '</p>' : '') +
        '</div>' + inner + '</section>';
    }
    _prose(text, max) { const p = paras(text, max); return p ? '<div class="tgx-prose">' + p + '</div>' : ''; }
    _card(ico, title, body) {
      if (!body) return '';
      return '<div class="tgx-card"><div class="tgx-card-head"><span class="tgx-card-icon">' + icon(ico, 15) +
        '</span><h3 class="tgx-card-title">' + esc(title) + '</h3></div>' +
        '<div class="tgx-card-body">' + paras(body, 6) + '</div></div>';
    }

    _renderHero(d, bestForHtml, hasRail) {
      let heroImg = safeUrl(this.c.heroImageUrl);
      // The URL goes into a background url() inside a style attribute — reject
      // any URL with characters that could close url()/the attribute or add CSS
      // declarations (e.g. 'https://a.png);position:fixed;inset:0;...').
      if (heroImg && !/^https?:\/\/[^\s"'()<>;\\]+$/i.test(heroImg)) heroImg = '';
      if (heroImg) preloadImage(heroImg); // fetch the background hero early
      const eyebrow = [d.location, d.country, d.type].filter(Boolean).map(esc).join(' &middot; ');
      const badges = [];
      if (d.operator) badges.push('<span class="tgx-badge">' + esc(d.operator) + '</span>');
      if (d.hasOnSiteHotels) badges.push('<span class="tgx-badge is-on">' + icon('bed', 13) + ' ' + esc(this.t('onSiteHotels')) + '</span>');
      if (d.dogFriendly) badges.push('<span class="tgx-badge is-on">' + icon('paw', 13) + ' ' + esc(this.t('dogFriendly')) + '</span>');
      const style = heroImg ? ' style="--tgx-hero-img:url(' + esc(heroImg) + ')"' : '';
      const cls = 'tgx-hero' + (heroImg ? ' has-img' : '') + (hasRail ? ' has-rail' : '');
      return '<header class="' + cls + '"' + style + '>' +
        // No photo: a large ferris-wheel glyph as a watermark gives the brand
        // gradient a subject, so the imageless hero still reads as a day out.
        (heroImg ? '' : '<span class="tgx-hero-mark" aria-hidden="true">' + icon('ferris', 270) + '</span>') +
        '<div class="tgx-hero-content">' +
          (eyebrow ? '<div class="tgx-eyebrow"><span class="dot"></span>' + eyebrow + '</div>' : '') +
          '<h1 class="tgx-name">' + esc(d.name) + '</h1>' +
          (d.tagline ? '<p class="tgx-tagline">' + esc(d.tagline) + '</p>' : '') +
          (badges.length ? '<div class="tgx-badges">' + badges.join('') + '</div>' : '') +
          (bestForHtml || '') +
        '</div>' +
        '</header>';
    }

    _fact(ico, label, value) {
      if (!value) return '';
      return '<div class="tgx-fact"><span class="tgx-fact-icon">' + icon(ico, 18) + '</span><div>' +
        '<div class="tgx-fact-label">' + esc(label) + '</div>' +
        '<div class="tgx-fact-value">' + esc(value) + '</div></div></div>';
    }
    _renderFacts(d) {
      const tiles = [
        this._fact('coin', this.t('typicalCost'), d.priceBand),
        this._fact('calendar', this.t('timeNeeded'), d.daysNeeded),
        this._fact('sun', this.t('season'), d.season),
        this._fact('bed', this.t('onSiteHotels'), d.hasOnSiteHotels ? this.t('yes') : ''),
        this._fact('paw', this.t('dogFriendly'), d.dogFriendly ? this.t('yes') : ''),
      ].filter(Boolean).slice(0, 4);
      if (!tiles.length) return '';
      return '<div class="tgx-facts" data-count="' + tiles.length + '">' + tiles.join('') + '</div>';
    }

    // Best For chips. They sit inside the hero when there is one (with the
    // name and tagline, where a visitor scans first) and become their own small
    // section only when the hero is toggled off.
    _renderBestForChips(d) {
      const tags = Array.isArray(d.bestFor) ? d.bestFor : [];
      if (!tags.length) return '';
      const pills = tags.map(t => '<li class="tgx-tag">' + icon('users', 13) + '<span>' + esc(t) + '</span></li>').join('');
      return '<div class="tgx-bestfor">' +
        '<span class="tgx-bestfor-label">' + esc(this.t('bestFor')) + '</span>' +
        '<ul class="tgx-tags" aria-label="' + esc(this.t('bestFor')) + '">' + pills + '</ul>' +
      '</div>';
    }
    _renderBestFor(d) {
      const tags = Array.isArray(d.bestFor) ? d.bestFor : [];
      if (!tags.length) return '';
      const pills = tags.map(t => '<li class="tgx-tag">' + icon('users', 13) + '<span>' + esc(t) + '</span></li>').join('');
      return this._section('users', this.t('bestFor'), '', '<ul class="tgx-tags">' + pills + '</ul>');
    }

    _renderOverview(d) {
      const body = this._prose(d.overview, 4) + (d.bestTime ? '<h3 class="tgx-subh">' + esc(this.t('whenToGo')) + '</h3>' + this._prose(d.bestTime, 3) : '');
      if (!d.overview && !d.bestTime) return '';
      return this._section('info', this.t('overview'), this.t('overviewSub'), body);
    }

    _renderStar(d) {
      if (!d.starAttractions) return '';
      return this._section('sparkles', this.t('starAttractions'), this.t('starSub'), this._prose(d.starAttractions, 10));
    }

    _renderGuides(d) {
      const cards = [
        this._card('users', this.t('families'), d.familyGuide),
        this._card('coaster', this.t('thrillSeekers'), d.thrillGuide),
        this._card('ruler', this.t('heightRestrictions'), d.heightRestrict),
        this._card('access', this.t('accessibility'), d.accessibility),
      ].filter(Boolean);
      if (!cards.length) return '';
      return this._section('ferris', this.t('goodToKnow'), this.t('goodToKnowSub'), '<div class="tgx-cards">' + cards.join('') + '</div>');
    }

    _renderTickets(d) {
      const main = d.tickets ? '<div class="tgx-callout">' + paras(d.tickets, 5) + '</div>' : '';
      const fast = d.fastTrack
        ? '<h3 class="tgx-subh">' + esc(this.t('fastTrack')) + '</h3>' + this._prose(d.fastTrack, 3) : '';
      if (!main && !fast) return '';
      return this._section('ticket', this.t('ticketsAndPrices'), this.t('ticketsSub'), main + fast);
    }

    _renderLocated(d) {
      const blocks = [];
      if (d.nearestAirport) blocks.push('<div class="tgx-block"><div class="tgx-block-label">' + icon('plane', 15) + '<span>' + esc(this.t('nearestAirports')) + '</span></div>' + this._prose(d.nearestAirport, 3) + '</div>');
      if (d.gettingThere)   blocks.push('<div class="tgx-block"><div class="tgx-block-label">' + icon('car', 15) + '<span>' + esc(this.t('gettingThere')) + '</span></div>' + this._prose(d.gettingThere, 3) + '</div>');
      if (d.nearestTown)    blocks.push('<div class="tgx-block"><div class="tgx-block-label">' + icon('pin', 15) + '<span>' + esc(this.t('nearestTown')) + '</span></div>' + this._prose(d.nearestTown, 2) + '</div>');
      const hasLL = typeof d.lat === 'number' && typeof d.lng === 'number';
      const mapEl = (hasLL && this.c.showMap !== false)
        ? '<div class="tgx-map" data-tgx-map role="region" aria-label="' + esc(this.t('mapLabel', { name: d.name })) + '"></div>' : '';
      if (!blocks.length && !mapEl) return '';
      return this._section('compass', this.t('gettingThere'), '',
        '<div class="tgx-locate">' +
          (mapEl ? '<div class="tgx-locate-map">' + mapEl + '</div>' : '') +
          (blocks.length ? '<div class="tgx-locate-text">' + blocks.join('') + '</div>' : '') +
        '</div>');
    }

    _renderStay(d) {
      const cards = [
        this._card('bed', this.t('onSiteHotels'), d.onSiteHotels),
        this._card('building', this.t('nearbyHotels'), d.nearbyHotels),
      ].filter(Boolean);
      if (!cards.length) return '';
      return this._section('bed', this.t('whereToStay'), '', '<div class="tgx-cards">' + cards.join('') + '</div>');
    }

    _renderFood(d) {
      if (!d.foodDrink) return '';
      return this._section('utensils', this.t('foodAndDrink'), '', this._prose(d.foodDrink, 4));
    }

    _renderTips(d) {
      if (!d.quirks) return '';
      return this._section('alert', this.t('insiderTips'), this.t('insiderTipsSub'), '<div class="tgx-tips">' + paras(d.quirks, 6) + '</div>');
    }

    _renderCombine(d) {
      if (!d.combineWith) return '';
      return this._section('link', this.t('combineTrip'), this.t('combineSub'), this._prose(d.combineWith, 3));
    }

    _renderCta(d) {
      const cta = this.c.cta || {};
      const vars = { name: d.name || '', location: d.location || '', country: d.country || '' };
      const title = renderTemplate(cta.title || '', vars);
      const sub = renderTemplate(cta.subtitle || '', vars);
      const url = safeUrl(cta.buttonUrl, true);
      // No official-website link by design: agents do not want to send their
      // visitors off to book direct. The CTA drives the enquiry to the agent.
      const verified = d.verifiedDate ? '<p class="tgx-verified">' + icon('check', 12) + '<span>' + esc(this.t('verified', { date: d.verifiedDate })) + '</span></p>' : '';
      if (!title && !sub && !url) return verified;
      return '<div class="tgx-cta">' +
        '<div class="tgx-cta-text">' +
          (title ? '<h3 class="tgx-cta-title">' + esc(title) + '</h3>' : '') +
          (sub ? '<p class="tgx-cta-sub">' + esc(sub) + '</p>' : '') +
        '</div>' +
        (url ? '<div class="tgx-cta-actions"><a href="' + esc(url) + '" class="tgx-btn tgx-btn-primary">' + esc(cta.buttonLabel || this.t('startEnquiry')) + icon('arrow', 14) + '</a></div>' : '') +
        verified + '</div>';
    }

    _renderNotFound() {
      this._root.innerHTML = '<div class="tgx-notice"><div class="tgx-notice-icon">' + icon('info', 22) + '</div>' +
        '<h2 class="tgx-notice-title">' + esc(this.t('notFoundTitle')) + '</h2>' +
        '<p class="tgx-notice-body">' + esc(this.t('notFoundBody')) + '</p></div>';
    }
    _renderError() {
      this._root.innerHTML = '<div class="tgx-notice"><div class="tgx-notice-icon">' + icon('alert', 22) + '</div>' +
        '<h2 class="tgx-notice-title">' + esc(this.t('errorTitle')) + '</h2>' +
        '<p class="tgx-notice-body">' + esc(this.t('errorBody')) + '</p></div>';
    }

    update(newConfig) {
      this.c = this._defaults(Object.assign({}, this.c, newConfig || {}));
      ensureFont(this.c.fontFamily);   // load the client-chosen web font on the host site (house rule 2)
      this.t = makeT(this.c);
      this._renderShell();
      if (this.c.attractionData) { this._data = this._withOverrides(this.c.attractionData); this._renderContent(); }
      else if (this.c.widgetId || this.c.recordId) { this._load(); }
      else if (this._data) { this._renderContent(); }
      else { this._renderNotFound(); }
    }
    destroy() {
      if (this._mapInst) { try { this._mapInst.remove(); } catch (e) {} this._mapInst = null; }
      try { while (this.shadow.firstChild) this.shadow.removeChild(this.shadow.firstChild); } catch (e) {}
      this.el.removeAttribute('data-tg-initialised');
      this.el.__tgAttraction = null;
    }
  }

  function hexToRgba(hex, alpha) {
    if (typeof hex !== 'string') return 'rgba(0,0,0,' + alpha + ')';
    let h = hex.replace('#', '').trim();
    if (h.length === 3) h = h.split('').map(c => c + c).join('');
    if (h.length !== 6 || !/^[0-9a-f]{6}$/i.test(h)) return 'rgba(0,0,0,' + alpha + ')';
    return 'rgba(' + parseInt(h.slice(0, 2), 16) + ',' + parseInt(h.slice(2, 4), 16) + ',' + parseInt(h.slice(4, 6), 16) + ',' + alpha + ')';
  }

  const STYLES = `
  :host { all: initial; display: block; box-sizing: border-box; }
  :host *, :host *::before, :host *::after { box-sizing: border-box; }

  /* ─── TOKENS ─────────────────────────────────────────
     The Spotlight family's compact editorial system (shared with Destination
     and Airport): hero, facts rail, two-column body, hairline rails. */
  .tgx-root {
    --tgx-brand: #1B2B5B;
    --tgx-brand-light: #2A3F7A;
    --tgx-brand-ink: var(--tgx-brand);
    --tgx-brand-tint: rgba(27,43,91,0.78);
    --tgx-brand-tint-2: rgba(27,43,91,0.35);
    --tgx-accent: #00B4D8;
    --tgx-accent-tint: rgba(0,180,216,0.38);
    --tgx-brand-soft: rgba(27,43,91,0.08);
    --tgx-accent-soft: rgba(0,180,216,0.12);
    --tgx-radius: 16px;
    --tgx-radius-sm: 10px;
    --tgx-radius-xs: 6px;
    --tgx-gap: 28px;
    --tgx-bg: #FFFFFF; --tgx-card: #F8FAFC; --tgx-border: #E2E8F0; --tgx-border-soft: #F1F5F9;
    --tgx-text: #0F172A; --tgx-sub: #475569; --tgx-muted: #64748B; --tgx-faint: #94A3B8;
    --tgx-shadow-sm: 0 1px 2px rgba(15,23,42,0.05), 0 1px 3px rgba(27,43,91,0.06);
    --tgx-shadow-md: 0 12px 32px -12px rgba(27,43,91,0.18), 0 2px 6px rgba(15,23,42,0.05);
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    font-size: 15px;
    color: var(--tgx-text); background: var(--tgx-bg); display: block; line-height: 1.5;
    max-width: 1200px; margin: 0 auto;
    /* Respond to the WIDGET's own width, not the browser window. Embedded on a
       customer page the widget often sits in a column far narrower than the
       viewport, so every layout breakpoint below is @container. */
    container-type: inline-size; container-name: tgx;
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
  }
  @supports (color: color-mix(in srgb, red, blue)) {
    .tgx-root { --tgx-brand-light: color-mix(in srgb, var(--tgx-brand) 82%, #FFFFFF); }
  }
  .tgx-root[data-theme="dark"] {
    --tgx-bg: #0F172A; --tgx-card: #1E293B; --tgx-border: #334155; --tgx-border-soft: #1E293B;
    --tgx-text: #F8FAFC; --tgx-sub: #CBD5E1; --tgx-muted: #94A3B8; --tgx-faint: #64748B;
    --tgx-brand-soft: rgba(0,180,216,0.12); --tgx-accent-soft: rgba(0,180,216,0.16);
    --tgx-brand-ink: var(--tgx-accent);
    --tgx-shadow-sm: 0 1px 2px rgba(0,0,0,0.25);
    --tgx-shadow-md: 0 12px 32px -12px rgba(0,0,0,0.5), 0 2px 6px rgba(0,0,0,0.25);
  }
  .tgx-loading { min-height: 240px; }
  .tgx-skel { min-height: clamp(220px, 30cqi, 400px); border-radius: var(--tgx-radius); background: linear-gradient(90deg, var(--tgx-border-soft), var(--tgx-card), var(--tgx-border-soft)); background-size: 200% 100%; animation: tgxsh 1.4s ease infinite; }
  @keyframes tgxsh { 0%{background-position:200% 0} 100%{background-position:-200% 0} }

  /* ─── HERO ───────────────────────────────────────── */
  .tgx-hero {
    position: relative;
    display: flex; flex-direction: column; justify-content: flex-end;
    min-height: clamp(220px, 30cqi, 400px);
    border-radius: var(--tgx-radius);
    overflow: hidden;
    color: #fff;
    background: var(--tgx-brand);
    box-shadow: var(--tgx-shadow-md);
    isolation: isolate;
  }
  /* The attractions table has no image field, so the default hero is the brand
     gradient with one accent glow and a large ferris-wheel glyph as a watermark.
     An editor-supplied photo sits under a brand-tinted duotone. */
  .tgx-hero::before {
    content: ""; position: absolute; inset: 0; z-index: -2;
    background:
      radial-gradient(70% 90% at 100% 0%, var(--tgx-accent-tint) 0%, rgba(0,180,216,0) 62%),
      linear-gradient(135deg, var(--tgx-brand) 0%, var(--tgx-brand-light) 100%);
  }
  .tgx-hero.has-img::before { background-image: var(--tgx-hero-img); background-size: cover; background-position: center; }
  .tgx-hero.has-img::after {
    content: ""; position: absolute; inset: 0; z-index: -1;
    background:
      linear-gradient(180deg, rgba(8,15,30,0) 40%, rgba(8,15,30,0.55) 100%),
      linear-gradient(135deg, var(--tgx-brand-tint) 0%, var(--tgx-brand-tint-2) 55%, var(--tgx-accent-tint) 100%);
  }
  .tgx-hero-mark {
    position: absolute; right: -30px; top: -34px; z-index: -1;
    width: 270px; height: 270px;
    color: #fff; opacity: 0.09;
    transform: rotate(-8deg);
    pointer-events: none;
  }
  .tgx-hero-mark svg { width: 100%; height: 100%; }
  .tgx-hero-content {
    position: relative;
    padding: clamp(18px, 3.2cqi, 40px);
    animation: tgx-rise 640ms cubic-bezier(.22,1,.36,1) both;
  }
  @keyframes tgx-rise {
    from { opacity: 0; transform: translateY(10px); }
    to   { opacity: 1; transform: translateY(0); }
  }
  .tgx-eyebrow { display:inline-flex; align-items:center; gap:8px; font-size:11px; font-weight:600; letter-spacing:0.1em; text-transform:uppercase; color: rgba(255,255,255,0.86); margin-bottom:10px; }
  .tgx-eyebrow .dot { width:6px; height:6px; border-radius:50%; background: var(--tgx-accent); flex: 0 0 6px; }
  .tgx-name { margin:0; font-size: clamp(28px, 5cqi, 52px); font-weight:700; letter-spacing:-0.03em; line-height:1.02; text-shadow: 0 2px 20px rgba(0,0,0,0.3); overflow-wrap: anywhere; }
  .tgx-tagline { margin:10px 0 0; font-size: clamp(15px, 1.45cqi, 18px); line-height: 1.4; color: rgba(255,255,255,0.92); max-width:62ch; }
  .tgx-badges { margin-top:12px; display:flex; flex-wrap:wrap; gap:6px; }
  .tgx-badge {
    display:inline-flex; align-items:center; gap:5px;
    font-size:12px; font-weight:600; line-height: 1.2;
    padding:5px 10px; border-radius:999px;
    background: rgba(255,255,255,0.14);
    border: 1px solid rgba(255,255,255,0.24);
    box-shadow: inset 0 1px 0 rgba(255,255,255,0.12);
    backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
  }
  .tgx-badge.is-on { background: rgba(16,185,129,0.28); border-color: rgba(16,185,129,0.5); }

  /* Best For chips: inside the hero when there is one, a small section otherwise. */
  .tgx-bestfor {
    display:flex; align-items:center; flex-wrap:wrap; gap: 8px 12px;
    margin-top:14px; padding-top:12px;
    border-top: 1px solid rgba(255,255,255,0.18);
  }
  .tgx-bestfor-label { font-size:11px; font-weight:600; letter-spacing:0.08em; text-transform:uppercase; color: rgba(255,255,255,0.75); flex-shrink:0; }
  .tgx-tags { display:flex; flex-wrap:wrap; gap:6px; margin:0; padding:0; list-style:none; }
  .tgx-tag { display:inline-flex; align-items:center; gap:5px; padding:5px 10px; background: var(--tgx-card); border:1px solid var(--tgx-border); border-radius:999px; font-size:12px; font-weight:600; line-height:1.2; color: var(--tgx-text); }
  .tgx-tag svg { color: var(--tgx-accent); flex-shrink:0; }
  .tgx-hero-content .tgx-tag { background: rgba(255,255,255,0.14); border-color: rgba(255,255,255,0.24); color:#fff; box-shadow: inset 0 1px 0 rgba(255,255,255,0.12); backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); }
  .tgx-hero-content .tgx-tag svg { color: rgba(255,255,255,0.9); }

  /* ─── QUICK FACTS RAIL ───────────────────────────── */
  .tgx-facts-wrap { position: relative; z-index: 2; margin: 14px 0 0; }
  .tgx-facts {
    display:grid;
    /* auto-fit so the rail reflows to the container width instead of forcing
       fixed columns that overflow a narrow embed. */
    grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
    background: var(--tgx-bg);
    border: 1px solid var(--tgx-border);
    border-radius: var(--tgx-radius-sm);
    box-shadow: var(--tgx-shadow-md);
    overflow: hidden;
  }
  .tgx-fact { display:flex; gap:10px; align-items:center; padding:12px 14px; min-width:0; background: var(--tgx-bg); box-shadow: -1px -1px 0 0 var(--tgx-border); }
  .tgx-fact > div { min-width: 0; }
  .tgx-fact-icon { width:30px; height:30px; flex:0 0 30px; border-radius:8px; background: var(--tgx-brand-soft); color: var(--tgx-brand-ink); display:flex; align-items:center; justify-content:center; }
  .tgx-fact-label { font-size:11px; font-weight:600; letter-spacing:0.06em; text-transform:uppercase; color: var(--tgx-muted); margin-bottom:2px; line-height:1.2; }
  .tgx-fact-value { font-size:14px; font-weight:600; color: var(--tgx-text); line-height:1.3; overflow-wrap: anywhere; }

  /* ─── BODY GRID ──────────────────────────────────── */
  .tgx-body { display:grid; grid-template-columns: minmax(0, 1fr); gap: 0 32px; margin-top: var(--tgx-gap); }
  .tgx-main, .tgx-side { min-width:0; container-type: inline-size; }
  .tgx-main { container-name: tgx-main; }
  .tgx-side { container-name: tgx-side; }
  .tgx-side > .tgx-section:first-child { margin-top: var(--tgx-gap); }

  /* ─── SECTIONS ───────────────────────────────────── */
  .tgx-section { margin: 0 0 var(--tgx-gap); }
  .tgx-section:last-child { margin-bottom: 0; }
  .tgx-section-head { margin-bottom: 12px; }
  .tgx-h2 { display:flex; align-items:center; gap:8px; margin:0; font-size:17px; font-weight:600; letter-spacing:-0.01em; line-height:1.3; color: var(--tgx-text); }
  .tgx-section-icon { width:22px; height:22px; flex:0 0 22px; display:inline-flex; align-items:center; justify-content:center; color: var(--tgx-brand-ink); }
  .tgx-section-sub { margin:4px 0 0; font-size:13.5px; line-height:1.45; color: var(--tgx-sub); }
  .tgx-subh { margin:14px 0 6px; font-size:14px; font-weight:600; color: var(--tgx-text); }
  .tgx-prose { font-size:15px; color: var(--tgx-sub); line-height:1.6; max-width: 72ch; }
  .tgx-prose p { margin:0 0 12px; } .tgx-prose p:last-child { margin:0; }

  /* ─── CARDS: hairline bento ──────────────────────── */
  .tgx-cards { display:grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); background: var(--tgx-card); border:1px solid var(--tgx-border); border-radius: var(--tgx-radius-sm); overflow:hidden; }
  .tgx-card { background: var(--tgx-bg); padding:14px 16px; min-width:0; box-shadow: -1px -1px 0 0 var(--tgx-border); transition: background .18s ease-out; }
  .tgx-card:hover { background: var(--tgx-card); }
  .tgx-card-head { display:flex; align-items:center; gap:8px; margin-bottom:6px; }
  .tgx-card-icon { width:26px; height:26px; flex:0 0 26px; border-radius:7px; background: var(--tgx-brand-soft); color: var(--tgx-brand-ink); display:flex; align-items:center; justify-content:center; }
  .tgx-card-title { margin:0; font-size:14px; font-weight:600; color: var(--tgx-text); line-height:1.3; }
  .tgx-card-body { font-size:13px; color: var(--tgx-sub); line-height:1.5; }
  .tgx-card-body p { margin:0 0 8px; } .tgx-card-body p:last-child { margin:0; }

  /* ─── GETTING THERE: map + text blocks ───────────── */
  .tgx-locate { display:grid; grid-template-columns: minmax(0, 1fr); gap:16px; align-items:start; }
  .tgx-locate > div { min-width:0; }
  .tgx-map { height:220px; border-radius: var(--tgx-radius-sm); overflow:hidden; border:1px solid var(--tgx-border); background: var(--tgx-border-soft); }
  .tgx-map .leaflet-container { height:100%; width:100%; font: inherit; background: var(--tgx-border-soft); }
  .tgx-pin { width:26px; height:26px; border-radius:50% 50% 50% 0; background: var(--tgx-accent); border:3px solid #fff; box-shadow:0 3px 8px rgba(15,23,42,0.35); transform: rotate(-45deg); }
  .tgx-block { padding:10px 0; }
  .tgx-block:first-child { padding-top: 0; }
  .tgx-block + .tgx-block { border-top:1px solid var(--tgx-border); }
  .tgx-block-label { display:flex; align-items:center; gap:7px; font-size:13px; font-weight:600; color: var(--tgx-text); margin-bottom:4px; }
  .tgx-block-label svg { color: var(--tgx-brand-ink); flex-shrink:0; }
  .tgx-block .tgx-prose { font-size:14px; }

  /* ─── TICKETS callout, TIPS ──────────────────────── */
  .tgx-callout { background: var(--tgx-accent-soft); border: 1px solid rgba(0,180,216,0.28); border-radius: var(--tgx-radius-sm); padding:14px 16px; font-size:14px; color: var(--tgx-text); line-height:1.55; }
  .tgx-callout p { margin:0 0 8px; } .tgx-callout p:last-child { margin:0; }
  .tgx-tips { position:relative; background: var(--tgx-brand); color:#E6EAF4; border-radius: var(--tgx-radius-sm); padding:14px 16px 14px 30px; font-size:13.5px; line-height:1.55; }
  .tgx-root[data-theme="dark"] .tgx-tips { border: 1px solid rgba(255,255,255,0.08); }
  .tgx-tips::before { content:""; position:absolute; top:14px; left:14px; width:3px; height:calc(100% - 28px); background: var(--tgx-accent); border-radius:2px; }
  .tgx-tips p { margin:0 0 8px; } .tgx-tips p:last-child { margin:0; }
  .tgx-side .tgx-prose { font-size: 14px; }

  /* ─── CTA (side card, or a band when it spans the width) ─── */
  .tgx-cta {
    position:relative; overflow:hidden;
    display:flex; flex-direction:column; align-items:stretch; gap:14px;
    padding:22px 24px;
    border-radius: var(--tgx-radius-sm);
    background: var(--tgx-brand); color:#fff;
    box-shadow: var(--tgx-shadow-md);
  }
  .tgx-root[data-theme="dark"] .tgx-cta { border: 1px solid rgba(255,255,255,0.08); }
  .tgx-cta::before { content:""; position:absolute; right:-50px; bottom:-70px; width:190px; height:190px; border-radius:50%; background: var(--tgx-accent); opacity:0.22; pointer-events:none; }
  .tgx-cta-text { position:relative; flex:1 1 auto; min-width:0; }
  .tgx-cta-title { margin:0 0 4px; font-size:18px; font-weight:600; letter-spacing:-0.01em; line-height:1.25; }
  .tgx-cta-sub { margin:0; font-size:13.5px; opacity:0.85; line-height:1.45; }
  .tgx-cta-actions { position:relative; display:flex; flex-direction:column; gap:8px; }
  .tgx-btn { display:inline-flex; align-items:center; justify-content:center; gap:8px; padding:10px 18px; min-height:44px; border-radius:10px; font-size:14px; font-weight:600; text-decoration:none; cursor:pointer; transition: transform .15s ease-out, filter .15s ease-out; }
  .tgx-btn-primary { background: var(--tgx-accent); color:#fff; }
  .tgx-btn-primary:hover, .tgx-btn-primary:focus-visible { filter: brightness(1.06); transform: translateY(-1px); outline:none; }
  .tgx-btn-primary:focus-visible { box-shadow: 0 0 0 3px rgba(255,255,255,0.4); }
  .tgx-btn-ghost { background: rgba(255,255,255,0.12); color:#fff; border:1px solid rgba(255,255,255,0.25); }
  .tgx-verified { position:relative; margin:0; font-size:12px; opacity:0.8; display:inline-flex; align-items:center; gap:6px; }
  .tgx-root > .tgx-verified, .tgx-side > .tgx-verified { margin-top: 12px; color: var(--tgx-muted); opacity: 1; }
  @container tgx-side (min-width: 560px) {
    .tgx-cta { flex-direction:row; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:16px 24px; padding:24px 28px; }
    .tgx-cta-actions { flex-direction:row; flex:0 0 auto; }
    .tgx-verified { flex-basis:100%; }
  }

  /* ─── NOTICE ─────────────────────────────────────── */
  .tgx-notice { text-align:center; padding:36px 24px; border:1px dashed var(--tgx-border); border-radius: var(--tgx-radius); }
  .tgx-notice-icon { width:44px; height:44px; margin:0 auto 12px; border-radius:50%; background: var(--tgx-brand-soft); color: var(--tgx-brand-ink); display:flex; align-items:center; justify-content:center; }
  .tgx-notice-title { margin:0 0 6px; font-size:16px; font-weight:600; color: var(--tgx-text); }
  .tgx-notice-body { margin:0; font-size:14px; color: var(--tgx-sub); }

  /* ─── FOCUS ──────────────────────────────────────── */
  .tgx-root a:focus-visible, .tgx-root button:focus-visible { outline: 2px solid var(--tgx-accent); outline-offset: 3px; border-radius: 4px; }

  /* ─── RESPONSIVE (container-relative — tracks .tgx-root width) ─── */
  @container tgx (min-width: 720px) {
    .tgx-hero.has-rail .tgx-hero-content { padding-bottom: calc(clamp(18px, 3.2cqi, 40px) + 30px); }
    .tgx-hero.has-rail + .tgx-facts-wrap { margin: -34px clamp(16px, 3.2cqi, 40px) 0; }
  }
  @container tgx (min-width: 900px) {
    .tgx-root:not([data-layout="stacked"]) .tgx-body[data-side="1"] { grid-template-columns: minmax(0, 1fr) minmax(280px, 34%); align-items: start; }
    .tgx-root:not([data-layout="stacked"]) .tgx-body[data-side="1"] .tgx-side > .tgx-section:first-child { margin-top: 0; }
  }
  @container tgx (max-width: 719px) {
    .tgx-root { --tgx-gap: 24px; }
  }
  @container tgx-main (min-width: 640px) {
    .tgx-locate { grid-template-columns: minmax(0, 5fr) minmax(0, 7fr); gap: 20px; }
    .tgx-map { height: 260px; }
  }
  @media (prefers-reduced-motion: reduce) {
    .tgx-skel { animation: none; }
    .tgx-hero-content { animation: none; }
    .tgx-btn, .tgx-card { transition: none !important; }
    .tgx-btn-primary:hover { transform: none !important; }
  }
  `;

  function init() {
    const nodes = document.querySelectorAll('[data-tg-widget="attraction"]:not([data-tg-initialised])');
    nodes.forEach(el => {
      try {
        if (el.hasAttribute('data-tg-no-autoinit')) return;
        const inline = el.getAttribute('data-tg-config');
        if (inline) {
          let cfg = {}; try { cfg = JSON.parse(inline); } catch (e) { cfg = {}; }
          el.__tgAttraction = new TGAttractionWidget(el, cfg);
          return;
        }
        const id = el.getAttribute('data-tg-id');
        if (id) {
          // Two-step embed (matches the other widgets): fetch the saved display
          // config (colours, sections, CTA, hero image) from /api/widget-config,
          // then the widget fetches its content from /api/attraction-content?id=.
          // Mark synchronously before the async fetch so a re-entrant init()
          // (fired by the MutationObserver mid-fetch) skips this element instead
          // of building a second widget on it. The constructor re-sets it.
          el.setAttribute('data-tg-initialised', 'true');
          // The content only needs the widget id, so fire it now, in parallel
          // with the config fetch, rather than after it (step 3).
          const contentP = startContent(CONTENT_API + '?id=' + encodeURIComponent(id));
          fetch(CONFIG_API + '?id=' + encodeURIComponent(id), { credentials: 'omit' })
            .then(r => (r.ok ? r.json() : null))
            .then(data => {
              const cfg = (data && (data.config || data)) || {};
              cfg.widgetId = id;
              cfg.__contentResponse = contentP;
              el.__tgAttraction = new TGAttractionWidget(el, cfg);
            })
            .catch(() => { el.__tgAttraction = new TGAttractionWidget(el, { widgetId: id, __contentResponse: contentP }); });
          return;
        }
        const rec = el.getAttribute('data-tg-record');
        if (rec) { el.__tgAttraction = new TGAttractionWidget(el, { recordId: rec }); return; }
        console.warn('[TG Attraction] container has no data-tg-id, data-tg-record or data-tg-config');
      } catch (err) { console.error('[TG Attraction] init failed:', err); }
    });
  }

  if (typeof window !== 'undefined') { window.TGAttractionWidget = TGAttractionWidget; window.__TG_ATTRACTION_VERSION__ = VERSION; }
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
    if (typeof MutationObserver !== 'undefined') {
      try {
        let scheduled = false;
        const mo = new MutationObserver(() => { if (scheduled) return; scheduled = true; setTimeout(() => { scheduled = false; init(); }, 120); });
        mo.observe(document.body || document.documentElement, { childList: true, subtree: true });
      } catch (e) {}
    }
  }
})();
