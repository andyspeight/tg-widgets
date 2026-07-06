/**
 * Travelgenix World Map Widget v3.3.0
 * Real-map version using Leaflet + MapTiler Streets tiles.
 *
 * Usage:
 *   <div data-tg-widget="worldmap" data-tg-id="YOUR_WIDGET_ID"></div>
 *   <script src="https://tg-widgets.vercel.app/widget-worldmap.js"></script>
 *
 * Or with inline config for testing:
 *   <div data-tg-widget="worldmap" data-tg-config='{"theme":"light","ctaUrl":"..."}'></div>
 *
 * Reads from /api/destination-map-offers which is never empty (Redis →
 * seed fallback). Widget renders even if the cache is cold.
 *
 * v3.3.0: adds the in-page fullscreen overlay (shell). The fullscreen button
 * and pin clicks open a full-viewport overlay in the same Shadow DOM
 * (Escape / backdrop / close button to dismiss, focus-trapped, scroll-locked).
 * A configured fullscreenUrl still wins (opens in a new tab) for back-compat.
 * The interactive map + deal cards + filters mount into the overlay body next.
 */
(function () {
  'use strict';

  const VERSION = '3.11.0';

  // ─── i18n ───────────────────────────────────────────────────
  // Fixed UI chrome only (map controls, legend, popup/card chrome, filter and
  // empty/loading/error states, aria-labels). Destination/country/resort/airport
  // names, hotel names, prices, currency codes and dates are data, never
  // translated. English is the source + fallback.
  const MESSAGES = {
    en: {
      title: 'Where will you go next?', subtitle: 'Browse our latest offers from around the world',
      viewFullscreen: 'View fullscreen', viewMapFullscreen: 'View map in fullscreen',
      closeFullscreen: 'Close fullscreen map', fullscreenSuffix: 'fullscreen', destinationMap: 'Destination map',
      destination: 'Destination', loadingMap: 'Loading map…',
      mapUnavailable: 'Map unavailable. Please try again later.',
      noDestinations: 'No destinations available right now. Please try again later.',
      latestDeals: 'Latest deals', tapDestination: 'Tap any destination on the map to see its deals.',
      pickDestination: 'Pick a destination to see live deals — tap a price on the map.',
      rating: 'Rating', maxBudget: 'Max budget',
      filterByRating: 'Filter by star rating', filterByBudget: 'Filter by maximum budget', filterByRegion: 'Filter the map by region',
      from: 'from', perPerson: 'per person', tapToView: 'tap to view', worldwide: 'Worldwide', any: 'Any',
      findingDeals: 'Finding the best deals…', findingResortDeals: 'Finding {resort} deals…',
      noDealsFiltered: 'No deals match your filters',
      noDealsFilteredLong: 'No deals match these filters. Try widening your budget or rating.',
      noDealsNow: 'No deals to show right now.',
      noDealsCountry: 'No deals available for {name} right now. Try another destination.',
      dealsLoadError: "Couldn't load deals just now. Please try again in a moment.",
      dealsInResort: '{n} deals in {resort}', showAll: 'Show all {country}',
      dealsMatch: '{n} of {total} deals match · cheapest first',
      dealsCount: '{n} of {total} deals · cheapest first',
      hotel: 'Hotel', direct: 'Direct', viewDeal: 'View deal', pp: 'pp', total: 'total',
      night: 'night', nights: 'nights',
      boardRoomOnly: 'Room only', boardSelfCatering: 'Self catering', boardBedAndBreakfast: 'B&B',
      boardHalfBoard: 'Half board', boardFullBoard: 'Full board', boardAllInclusive: 'All inclusive',
      boardAllInclusivePlus: 'All inclusive+',
    },
    fr: {
      title: 'Où irez-vous ensuite ?', subtitle: 'Parcourez nos dernières offres du monde entier',
      viewFullscreen: 'Plein écran', viewMapFullscreen: 'Voir la carte en plein écran',
      closeFullscreen: 'Fermer la carte plein écran', fullscreenSuffix: 'plein écran', destinationMap: 'Carte des destinations',
      destination: 'Destination', loadingMap: 'Chargement de la carte…',
      mapUnavailable: 'Carte indisponible. Veuillez réessayer plus tard.',
      noDestinations: 'Aucune destination disponible pour le moment. Veuillez réessayer plus tard.',
      latestDeals: 'Dernières offres', tapDestination: 'Touchez une destination sur la carte pour voir ses offres.',
      pickDestination: 'Choisissez une destination pour voir les offres en direct — touchez un prix sur la carte.',
      rating: 'Catégorie', maxBudget: 'Budget max.',
      filterByRating: 'Filtrer par nombre d’étoiles', filterByBudget: 'Filtrer par budget maximum', filterByRegion: 'Filtrer la carte par région',
      from: 'à partir de', perPerson: 'par personne', tapToView: 'touchez pour voir', worldwide: 'Monde entier', any: 'Tous',
      findingDeals: 'Recherche des meilleures offres…', findingResortDeals: 'Recherche des offres à {resort}…',
      noDealsFiltered: 'Aucune offre ne correspond à vos filtres',
      noDealsFilteredLong: 'Aucune offre ne correspond à ces filtres. Essayez d’élargir votre budget ou votre catégorie.',
      noDealsNow: 'Aucune offre à afficher pour le moment.',
      noDealsCountry: 'Aucune offre disponible pour {name} pour le moment. Essayez une autre destination.',
      dealsLoadError: 'Impossible de charger les offres pour le moment. Veuillez réessayer dans un instant.',
      dealsInResort: '{n} offres à {resort}', showAll: 'Voir tout {country}',
      dealsMatch: '{n} offres sur {total} correspondent · les moins chères d’abord',
      dealsCount: '{n} offres sur {total} · les moins chères d’abord',
      hotel: 'Hôtel', direct: 'Direct', viewDeal: 'Voir l’offre', pp: 'p.p.', total: 'au total',
      night: 'nuit', nights: 'nuits',
      boardRoomOnly: 'Sans repas', boardSelfCatering: 'Logement avec cuisine', boardBedAndBreakfast: 'B&B',
      boardHalfBoard: 'Demi-pension', boardFullBoard: 'Pension complète', boardAllInclusive: 'Tout compris',
      boardAllInclusivePlus: 'Tout compris+',
    },
    de: {
      title: 'Wohin geht die Reise als Nächstes?', subtitle: 'Entdecken Sie unsere neuesten Angebote aus aller Welt',
      viewFullscreen: 'Vollbild', viewMapFullscreen: 'Karte im Vollbild ansehen',
      closeFullscreen: 'Vollbildkarte schließen', fullscreenSuffix: 'Vollbild', destinationMap: 'Reisezielkarte',
      destination: 'Reiseziel', loadingMap: 'Karte wird geladen…',
      mapUnavailable: 'Karte nicht verfügbar. Bitte versuchen Sie es später erneut.',
      noDestinations: 'Derzeit keine Reiseziele verfügbar. Bitte versuchen Sie es später erneut.',
      latestDeals: 'Aktuelle Angebote', tapDestination: 'Tippen Sie auf ein Reiseziel auf der Karte, um die Angebote zu sehen.',
      pickDestination: 'Wählen Sie ein Reiseziel für Live-Angebote — tippen Sie auf einen Preis auf der Karte.',
      rating: 'Kategorie', maxBudget: 'Max. Budget',
      filterByRating: 'Nach Sternebewertung filtern', filterByBudget: 'Nach Höchstbudget filtern', filterByRegion: 'Karte nach Region filtern',
      from: 'ab', perPerson: 'pro Person', tapToView: 'zum Anzeigen tippen', worldwide: 'Weltweit', any: 'Alle',
      findingDeals: 'Die besten Angebote werden gesucht…', findingResortDeals: 'Angebote für {resort} werden gesucht…',
      noDealsFiltered: 'Keine Angebote entsprechen Ihren Filtern',
      noDealsFilteredLong: 'Keine Angebote entsprechen diesen Filtern. Erweitern Sie Ihr Budget oder Ihre Kategorie.',
      noDealsNow: 'Derzeit keine Angebote verfügbar.',
      noDealsCountry: 'Derzeit keine Angebote für {name} verfügbar. Probieren Sie ein anderes Reiseziel.',
      dealsLoadError: 'Angebote konnten gerade nicht geladen werden. Bitte versuchen Sie es gleich noch einmal.',
      dealsInResort: '{n} Angebote in {resort}', showAll: 'Alle {country} anzeigen',
      dealsMatch: '{n} von {total} Angeboten passen · günstigste zuerst',
      dealsCount: '{n} von {total} Angeboten · günstigste zuerst',
      hotel: 'Hotel', direct: 'Direkt', viewDeal: 'Angebot ansehen', pp: 'p.P.', total: 'gesamt',
      night: 'Nacht', nights: 'Nächte',
      boardRoomOnly: 'Nur Übernachtung', boardSelfCatering: 'Selbstverpflegung', boardBedAndBreakfast: 'Ü/F',
      boardHalfBoard: 'Halbpension', boardFullBoard: 'Vollpension', boardAllInclusive: 'All-Inclusive',
      boardAllInclusivePlus: 'All-Inclusive+',
    },
    es: {
      title: '¿A dónde irás después?', subtitle: 'Explora nuestras últimas ofertas de todo el mundo',
      viewFullscreen: 'Pantalla completa', viewMapFullscreen: 'Ver el mapa en pantalla completa',
      closeFullscreen: 'Cerrar el mapa en pantalla completa', fullscreenSuffix: 'pantalla completa', destinationMap: 'Mapa de destinos',
      destination: 'Destino', loadingMap: 'Cargando el mapa…',
      mapUnavailable: 'Mapa no disponible. Inténtalo de nuevo más tarde.',
      noDestinations: 'No hay destinos disponibles en este momento. Inténtalo de nuevo más tarde.',
      latestDeals: 'Últimas ofertas', tapDestination: 'Toca un destino en el mapa para ver sus ofertas.',
      pickDestination: 'Elige un destino para ver ofertas en directo — toca un precio en el mapa.',
      rating: 'Categoría', maxBudget: 'Presupuesto máx.',
      filterByRating: 'Filtrar por estrellas', filterByBudget: 'Filtrar por presupuesto máximo', filterByRegion: 'Filtrar el mapa por región',
      from: 'desde', perPerson: 'por persona', tapToView: 'toca para ver', worldwide: 'Todo el mundo', any: 'Todos',
      findingDeals: 'Buscando las mejores ofertas…', findingResortDeals: 'Buscando ofertas en {resort}…',
      noDealsFiltered: 'Ninguna oferta coincide con tus filtros',
      noDealsFilteredLong: 'Ninguna oferta coincide con estos filtros. Prueba a ampliar tu presupuesto o tu categoría.',
      noDealsNow: 'No hay ofertas para mostrar ahora mismo.',
      noDealsCountry: 'No hay ofertas disponibles para {name} ahora mismo. Prueba otro destino.',
      dealsLoadError: 'No se han podido cargar las ofertas ahora mismo. Inténtalo de nuevo en un momento.',
      dealsInResort: '{n} ofertas en {resort}', showAll: 'Ver todo {country}',
      dealsMatch: '{n} de {total} ofertas coinciden · las más baratas primero',
      dealsCount: '{n} de {total} ofertas · las más baratas primero',
      hotel: 'Hotel', direct: 'Directo', viewDeal: 'Ver oferta', pp: 'p.p.', total: 'total',
      night: 'noche', nights: 'noches',
      boardRoomOnly: 'Solo alojamiento', boardSelfCatering: 'Apartamento con cocina', boardBedAndBreakfast: 'Aloj. y desayuno',
      boardHalfBoard: 'Media pensión', boardFullBoard: 'Pensión completa', boardAllInclusive: 'Todo incluido',
      boardAllInclusivePlus: 'Todo incluido+',
    },
    it: {
      title: 'Dove andrai la prossima volta?', subtitle: 'Sfoglia le nostre ultime offerte da tutto il mondo',
      viewFullscreen: 'Schermo intero', viewMapFullscreen: 'Vedi la mappa a schermo intero',
      closeFullscreen: 'Chiudi la mappa a schermo intero', fullscreenSuffix: 'schermo intero', destinationMap: 'Mappa delle destinazioni',
      destination: 'Destinazione', loadingMap: 'Caricamento della mappa…',
      mapUnavailable: 'Mappa non disponibile. Riprova più tardi.',
      noDestinations: 'Nessuna destinazione disponibile al momento. Riprova più tardi.',
      latestDeals: 'Ultime offerte', tapDestination: 'Tocca una destinazione sulla mappa per vedere le sue offerte.',
      pickDestination: 'Scegli una destinazione per vedere le offerte in tempo reale — tocca un prezzo sulla mappa.',
      rating: 'Categoria', maxBudget: 'Budget max.',
      filterByRating: 'Filtra per stelle', filterByBudget: 'Filtra per budget massimo', filterByRegion: 'Filtra la mappa per regione',
      from: 'da', perPerson: 'a persona', tapToView: 'tocca per vedere', worldwide: 'Tutto il mondo', any: 'Tutte',
      findingDeals: 'Ricerca delle migliori offerte…', findingResortDeals: 'Ricerca delle offerte a {resort}…',
      noDealsFiltered: 'Nessuna offerta corrisponde ai tuoi filtri',
      noDealsFilteredLong: 'Nessuna offerta corrisponde a questi filtri. Prova ad ampliare il budget o la categoria.',
      noDealsNow: 'Nessuna offerta da mostrare al momento.',
      noDealsCountry: 'Nessuna offerta disponibile per {name} al momento. Prova un’altra destinazione.',
      dealsLoadError: 'Impossibile caricare le offerte in questo momento. Riprova tra un attimo.',
      dealsInResort: '{n} offerte a {resort}', showAll: 'Mostra tutte {country}',
      dealsMatch: '{n} di {total} offerte corrispondono · le più economiche prima',
      dealsCount: '{n} di {total} offerte · le più economiche prima',
      hotel: 'Hotel', direct: 'Diretto', viewDeal: 'Vedi offerta', pp: 'p.p.', total: 'totale',
      night: 'notte', nights: 'notti',
      boardRoomOnly: 'Solo pernottamento', boardSelfCatering: 'Appartamento con angolo cottura', boardBedAndBreakfast: 'B&B',
      boardHalfBoard: 'Mezza pensione', boardFullBoard: 'Pensione completa', boardAllInclusive: 'Tutto incluso',
      boardAllInclusivePlus: 'Tutto incluso+',
    },
    ro: {
      title: 'Unde vei merge data viitoare?', subtitle: 'Răsfoiește cele mai noi oferte din întreaga lume',
      viewFullscreen: 'Ecran complet', viewMapFullscreen: 'Vezi harta pe ecran complet',
      closeFullscreen: 'Închide harta pe ecran complet', fullscreenSuffix: 'ecran complet', destinationMap: 'Harta destinațiilor',
      destination: 'Destinație', loadingMap: 'Se încarcă harta…',
      mapUnavailable: 'Harta este indisponibilă. Te rugăm să încerci din nou mai târziu.',
      noDestinations: 'Nicio destinație disponibilă momentan. Te rugăm să încerci din nou mai târziu.',
      latestDeals: 'Cele mai noi oferte', tapDestination: 'Atinge o destinație pe hartă pentru a-i vedea ofertele.',
      pickDestination: 'Alege o destinație pentru a vedea ofertele live — atinge un preț pe hartă.',
      rating: 'Categorie', maxBudget: 'Buget max.',
      filterByRating: 'Filtrează după stele', filterByBudget: 'Filtrează după bugetul maxim', filterByRegion: 'Filtrează harta după regiune',
      from: 'de la', perPerson: 'de persoană', tapToView: 'atinge pentru a vedea', worldwide: 'În toată lumea', any: 'Toate',
      findingDeals: 'Se caută cele mai bune oferte…', findingResortDeals: 'Se caută ofertele din {resort}…',
      noDealsFiltered: 'Nicio ofertă nu corespunde filtrelor tale',
      noDealsFilteredLong: 'Nicio ofertă nu corespunde acestor filtre. Încearcă să mărești bugetul sau categoria.',
      noDealsNow: 'Nicio ofertă de afișat momentan.',
      noDealsCountry: 'Nicio ofertă disponibilă pentru {name} momentan. Încearcă altă destinație.',
      dealsLoadError: 'Ofertele nu au putut fi încărcate momentan. Te rugăm să încerci din nou imediat.',
      dealsInResort: '{n} oferte în {resort}', showAll: 'Arată toate {country}',
      dealsMatch: '{n} din {total} oferte corespund · cele mai ieftine întâi',
      dealsCount: '{n} din {total} oferte · cele mai ieftine întâi',
      hotel: 'Hotel', direct: 'Direct', viewDeal: 'Vezi oferta', pp: 'pers.', total: 'total',
      night: 'noapte', nights: 'nopți',
      boardRoomOnly: 'Doar cazare', boardSelfCatering: 'Cazare cu bucătărie', boardBedAndBreakfast: 'Mic dejun inclus',
      boardHalfBoard: 'Demipensiune', boardFullBoard: 'Pensiune completă', boardAllInclusive: 'All inclusive',
      boardAllInclusivePlus: 'All inclusive+',
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

  // Resolve OUR origin so every API call and asset load hits where the widget
  // script is served from (widgets.travelify.io), NOT the embedding client's
  // domain. Order: explicit global, then the origin of our own <script> tag,
  // then a script-tag scan, then relative as a last resort. Every other TG
  // widget does this; the map must too — without it, on a site that doesn't set
  // the global, API_BASE was '' and calls 404'd against the client domain,
  // showing "Map unavailable".
  function resolveApiOrigin() {
    if (typeof window === 'undefined') return '';
    if (window.__TG_WIDGET_API__) return window.__TG_WIDGET_API__;
    try {
      const me = document.currentScript;
      if (me && me.src) return new URL(me.src).origin;
      const scripts = document.getElementsByTagName('script');
      for (let i = scripts.length - 1; i >= 0; i--) {
        const s = scripts[i].src || '';
        if (/\/widget-worldmap\.js(\?|$|#)/.test(s)) return new URL(s).origin;
      }
    } catch (e) { /* fall through */ }
    return '';
  }
  const API_BASE = resolveApiOrigin();
  const OFFERS_URL = API_BASE + '/api/destination-map-offers';
  const DEALS_URL = API_BASE + '/api/destination-map-deals';
  const RESORTS_URL = API_BASE + '/api/destination-map-resorts';
  const CONFIG_URL = API_BASE + '/api/widget-config';
  const FX_RATES_URL = API_BASE + '/api/fx-rates';

  // Telemetry: report a load heartbeat and any failure to /api/widget-log so we
  // hear about a broken embed before the client does. Posts to our own API
  // origin (connect-src), so a client site's script-src CSP can't block it, and
  // it never throws.
  function tgReport(event, widgetId, message, detail) {
    try {
      var u = API_BASE + '/api/widget-log';
      var b = JSON.stringify({
        event: event, widget: 'worldmap', widgetId: String(widgetId || ''),
        message: String(message || '').slice(0, 300), detail: String(detail || '').slice(0, 500),
        url: (function () { try { return location.href; } catch (e) { return ''; } })(),
      });
      if (navigator && typeof navigator.sendBeacon === 'function' && navigator.sendBeacon(u, new Blob([b], { type: 'text/plain' }))) return;
      fetch(u, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: b, keepalive: true, credentials: 'omit' }).catch(function () {});
    } catch (e) { /* telemetry must never throw */ }
  }

  // Max deal cards rendered per country (cheapest first). One-line tunable.
  const MAX_DEAL_CARDS = 20;

  // Leaflet is served from OUR origin (vendored in public/vendor), not a public
  // CDN: a client site's Content-Security-Policy that allows our widget script
  // but not unpkg would block the CDN load and the map would show "unavailable".
  // Loading from the same origin as the widget itself is always permitted.
  const LEAFLET_JS_URL = API_BASE + '/vendor/leaflet-1.9.4.js';

  // MapTiler Streets — the chosen provider. The key is a single shared
  // Travelgenix key, domain-restricted in the MapTiler dashboard to
  // *.tg-widgets.vercel.app and client domains. It is necessarily visible
  // in client-side code (unavoidable for map tiles); domain restriction is
  // the protection. Can be overridden per-widget via config.mapKey if ever needed.
  const MAPTILER_KEY = 'zSDRMRY6Fi2YzknQVzXf';
  const TILE_TEMPLATE = 'https://api.maptiler.com/maps/streets-v2/{z}/{x}/{y}.png?key=';
  const TILE_ATTRIBUTION = '&copy; <a href="https://www.maptiler.com/copyright/">MapTiler</a> &copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>';

  // ── Leaflet loader — ensures only ONE fetch even if multiple widgets are on the page

  let leafletPromise = null;
  function loadLeaflet() {
    if (typeof window.L !== 'undefined') return Promise.resolve(window.L);
    if (leafletPromise) return leafletPromise;
    leafletPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = LEAFLET_JS_URL;
      s.async = true;
      s.onload = () => resolve(window.L);
      s.onerror = () => reject(new Error('Leaflet failed to load'));
      document.head.appendChild(s);
    });
    return leafletPromise;
  }

  // ── Helpers

  function esc(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function safeUrl(url) {
    if (!url) return '#';
    const s = String(url).trim();
    if (s.startsWith('#') || s.startsWith('/')) return s;
    if (/^(https?|mailto|tel):/i.test(s)) return s;
    return '#';
  }
  // Board basis → Travelify deeplink brd code (per the deeplink spec).
  const TVLLNK_BASE = 'https://dl.tvllnk.com';
  function brdCode(b) {
    const k = String(b || '').toLowerCase().replace(/[^a-z]/g, '');
    return ({ roomonly: 'RoomOnly', selfcatering: 'SelfCatering', bedandbreakfast: 'BedAndBreakfast',
      breakfast: 'BedAndBreakfast', halfboard: 'HalfBoard', fullboard: 'FullBoard', allinclusive: 'AllInclusive' })[k] || '';
  }
  // Build a Travelify booking deeplink for THIS client FROM the offer's details,
  // per Travelify's deeplink spec: dl.tvllnk.com/deeplink/{AppID}?st=...&params.
  // We build from the structured fields rather than reuse the cached results URL
  // (that carries a demo search session and expires), so a click runs a fresh
  // live search in the client's own Travelify application. No AppID (inline
  // embed / missing creds) → '' so the caller can fall back to the raw link.
  function buildDeeplink(o, appId) {
    const id = String(appId || '').trim();
    if (!id || !o) return '';
    const type = String(o.type || 'Packages');
    const st = type === 'Flights' ? 'Flights' : type === 'Accommodation' ? 'Accommodation' : 'DynamicPackaging';
    const p = new URLSearchParams();
    p.set('st', st);
    let hasDst = false;
    if (st !== 'Accommodation') { if (o.origin) p.set('org', o.origin); if (o.airport) { p.set('dst', o.airport); hasDst = true; } }
    if (st !== 'Flights') {
      // loc is the resort name, and Travelify hard-matches it as a City: an
      // unrecognised name (e.g. "Hadaba", "South Male Atoll") fails the WHOLE
      // deeplink with "Unable to match location City". Only send it when there
      // is no airport dst to anchor on. The airport IATA is a reliable anchor,
      // the resort name is not, so packages/flights rely on dst + ctry and the
      // exact property comes from refn below. Accommodation-only offers have no
      // airport, so loc stays as their one geo hint.
      if (!hasDst && o.resort) p.set('loc', o.resort);
      if (o.countryCode) p.set('ctry', o.countryCode);
    }
    const start = String(o.outboundDate || o.checkinDate || '');
    if (/^\d{4}-\d{2}-\d{2}/.test(start)) p.set('fr', start.slice(0, 10));
    if (o.nights) p.set('dur', String(o.nights));
    // Adults only: child ages are not stored and the spec requires an age per
    // child, so a child search would be invalid — search adults (the cache is
    // built on adult searches) rather than send a broken link.
    p.set('adt', String(o.adults || 2));
    if (st !== 'Flights') {
      const brd = brdCode(o.boardBasis); if (brd) p.set('brd', brd);
      if (o.rating) p.set('rat', String(o.rating));
    }
    if (o.currency) p.set('curr', o.currency);
    if (st !== 'Accommodation') {
      if (o.direct) p.set('dir', 'true');
      if (o.cabinClass) p.set('cabin', o.cabinClass);
      if (o.carrierCode) p.set('carrier', o.carrierCode);
    }
    // uniqueRef pins the exact property (e.g. TTI:83099724). URLSearchParams
    // encodes the colon, per Travelify's "URL encode to be safe".
    if (st !== 'Flights' && o.accommodationUniqueRef) p.set('refn', o.accommodationUniqueRef);
    return TVLLNK_BASE + '/deeplink/' + encodeURIComponent(id) + '?' + p.toString();
  }
  // Per-client supplier visibility. The map's deal cards are package deals, so
  // an offer is kept when its Packages supplier id (flightSid, which equals
  // accommodationSid on a package) is in the client's allowed packages list.
  // Empty/absent list = show all. Missing sid (pre-rollout cache) = keep.
  function mapSupplierAllows(o, sf) {
    if (!sf || !sf.packages || !sf.packages.length) return true;
    const sid = Number.isFinite(o.flightSid) ? o.flightSid
      : (Number.isFinite(o.accommodationSid) ? o.accommodationSid : null);
    return sid == null ? true : sf.packages.indexOf(sid) !== -1;
  }
  // Accept ONLY #RGB or #RRGGBB. Anything else (named colours, rgb(), url(),
  // javascript:, garbage) returns '' so it can never reach a style attribute.
  // This is what makes config-driven colours safe to inline.
  function safeHex(v) {
    if (typeof v !== 'string') return '';
    const s = v.trim();
    return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(s) ? s : '';
  }
  // Build the inline custom-property overrides for brand colours from config.
  // accent  → --tgwm-pin-anchor-active (highlight/active)
  // primary → --tgwm-pin-anchor + --tgwm-cta-bg (structural navy)
  // Returns '' when neither is set, so the stylesheet defaults stand.
  function brandStyleAttr(cfg) {
    const a = safeHex(cfg && cfg.accent);
    const p = safeHex(cfg && cfg.primary);
    let s = '';
    if (a) s += '--tgwm-pin-anchor-active:' + a + ';';
    if (p) s += '--tgwm-pin-anchor:' + p + ';--tgwm-cta-bg:' + p + ';';
    return s;
  }
  // ── Currency conversion (display only — the offer cache stays GBP) ──────
  // Cached map prices are GBP. We convert at render time to the viewer's chosen
  // currency using rates from our own /api/fx-rates (ECB), falling back to a
  // built-in table if that feed is unreachable so a price always shows. This
  // mirrors the Travel Offers widget so the two read identically. ACTIVE_CUR is
  // set from the instance's this.cur before each price-rendering pass.
  const FX_FALLBACK = { GBP: 1, EUR: 1.17, USD: 1.27, AUD: 1.92, CAD: 1.72, NZD: 2.08,
    CHF: 1.13, JPY: 198, SEK: 13.4, NOK: 13.6, DKK: 8.72, PLN: 5.0, CZK: 29.3, HUF: 456,
    RON: 5.8, BGN: 2.29, ISK: 175, ZAR: 23.2, SGD: 1.71, HKD: 9.9, THB: 46, INR: 106,
    CNY: 9.1, TRY: 41, MXN: 23, BRL: 6.9, ILS: 4.7, IDR: 20500, KRW: 1730, MYR: 5.6, PHP: 72 };
  const CURRENCIES = { GBP: 'British Pound', EUR: 'Euro', USD: 'US Dollar',
    AUD: 'Australian Dollar', CAD: 'Canadian Dollar', NZD: 'New Zealand Dollar',
    CHF: 'Swiss Franc', JPY: 'Japanese Yen', SEK: 'Swedish Krona', NOK: 'Norwegian Krone',
    DKK: 'Danish Krone', PLN: 'Polish Zloty', CZK: 'Czech Koruna', HUF: 'Hungarian Forint',
    RON: 'Romanian Leu', BGN: 'Bulgarian Lev', ISK: 'Icelandic Krona', ZAR: 'South African Rand',
    SGD: 'Singapore Dollar', HKD: 'Hong Kong Dollar', THB: 'Thai Baht', INR: 'Indian Rupee',
    CNY: 'Chinese Yuan', TRY: 'Turkish Lira', MXN: 'Mexican Peso', BRL: 'Brazilian Real',
    ILS: 'Israeli Shekel', IDR: 'Indonesian Rupiah', KRW: 'South Korean Won',
    MYR: 'Malaysian Ringgit', PHP: 'Philippine Peso' };
  const CURRENCY_ORDER = Object.keys(CURRENCIES);
  let ACTIVE_CUR = { code: 'GBP', rates: { GBP: 1 } };
  function setActiveCur(cur) { if (cur && cur.rates) ACTIVE_CUR = cur; }
  function fmtCur(amount, code) {
    const rounded = Math.round(amount);
    try { return new Intl.NumberFormat('en-GB', { style: 'currency', currency: code, maximumFractionDigits: 0 }).format(rounded); }
    catch (e) { return code + ' ' + rounded.toLocaleString('en-GB'); }
  }
  // Fetch GBP→codes rates from our FX proxy, filling any gaps from the fallback.
  // Never rejects (resolves to the fallback table) so it is safe in Promise.all.
  function loadFxRates(codes) {
    const want = [...new Set((codes || []).filter((c) => c && c !== 'GBP'))];
    const withFallback = () => { const r = { GBP: 1 }; want.forEach((c) => { r[c] = FX_FALLBACK[c] || 1; }); return r; };
    if (!want.length) return Promise.resolve({ GBP: 1 });
    return fetch(FX_RATES_URL + '?base=GBP&symbols=' + encodeURIComponent(want.join(',')))
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d || !d.rates) return withFallback();
        const r = { GBP: 1 };
        want.forEach((c) => { r[c] = (typeof d.rates[c] === 'number' && d.rates[c] > 0) ? d.rates[c] : (FX_FALLBACK[c] || 1); });
        return r;
      })
      .catch(withFallback);
  }
  // Format a cached price (in srcCurrency, normally GBP) in the active display
  // currency. The per-person display rule is applied by the caller.
  function formatPrice(p, srcCurrency) {
    if (!Number.isFinite(p) || p <= 0) return '';
    const from = (srcCurrency && CURRENCIES[srcCurrency]) ? srcCurrency : 'GBP';
    // Normalise to GBP (rates are units-per-1-GBP), then to the active currency.
    const fromRate = (ACTIVE_CUR.rates[from] > 0) ? ACTIVE_CUR.rates[from] : (FX_FALLBACK[from] || 1);
    const gbp = (from === 'GBP') ? p : p / fromRate;
    const code = ACTIVE_CUR.code || 'GBP';
    const rate = (ACTIVE_CUR.rates[code] > 0) ? ACTIVE_CUR.rates[code] : (FX_FALLBACK[code] || 1);
    return fmtCur(gbp * rate, code);
  }

  // Travelify boardBasis comes camelCase ("AllInclusivePlus"); humanise + localise
  // for display. Each known basis maps to a translation key (the strings live in
  // MESSAGES); t is threaded in from the widget so the viewer's language wins.
  const BOARD_KEYS = {
    RoomOnly: 'boardRoomOnly',
    SelfCatering: 'boardSelfCatering',
    BedAndBreakfast: 'boardBedAndBreakfast',
    HalfBoard: 'boardHalfBoard',
    FullBoard: 'boardFullBoard',
    AllInclusive: 'boardAllInclusive',
    AllInclusivePlus: 'boardAllInclusivePlus',
  };
  function boardLabel(b, t) {
    if (!b) return '';
    if (BOARD_KEYS[b] && t) return t(BOARD_KEYS[b]);
    // Fallback: split camelCase into words.
    return String(b).replace(/([a-z])([A-Z])/g, '$1 $2');
  }

  // Star rating → inline SVG string. Supports half stars (e.g. 4.5).
  function starsSvg(rating) {
    const r = Number(rating);
    if (!Number.isFinite(r) || r <= 0) return '';
    const full = Math.floor(r);
    const half = (r - full) >= 0.5;
    const FULL = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>';
    const HALF = '<svg viewBox="0 0 24 24" aria-hidden="true"><defs><linearGradient id="tgwmhalf"><stop offset="50%" stop-color="currentColor"/><stop offset="50%" stop-color="transparent"/></linearGradient></defs><path fill="url(#tgwmhalf)" stroke="currentColor" stroke-width="1" d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>';
    const EMPTY = '<svg viewBox="0 0 24 24" fill="currentColor" class="tgwm-star-empty" aria-hidden="true"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>';
    let out = '';
    for (let i = 0; i < 5; i++) {
      if (i < full) out += FULL;
      else if (i === full && half) out += HALF;
      else out += EMPTY;
    }
    return out;
  }

  // Two-letter ISO country code → display name. The live offers payload keys
  // countries by code (e.g. "ES"); seed payloads carry a "country" name instead.
  // resolveCountryName() prefers an explicit name, then this map, then the raw code.
  const COUNTRY_NAMES = {
    ES: 'Spain', PT: 'Portugal', GR: 'Greece', IT: 'Italy', CY: 'Cyprus',
    MT: 'Malta', TR: 'Turkey', HR: 'Croatia', FR: 'France', AE: 'UAE',
    EG: 'Egypt', MA: 'Morocco', TN: 'Tunisia', CV: 'Cape Verde', MU: 'Mauritius',
    TZ: 'Tanzania', ZA: 'South Africa', MV: 'Maldives', TH: 'Thailand',
    ID: 'Indonesia', LK: 'Sri Lanka', IN: 'India', VN: 'Vietnam', MX: 'Mexico',
    US: 'USA', DO: 'Dominican Republic', JM: 'Jamaica', BB: 'Barbados',
    AG: 'Antigua', LC: 'Saint Lucia', CU: 'Cuba', AU: 'Australia',
  };
  function resolveCountryName(c, t) {
    // Country names themselves are data and never translated; only the generic
    // last-resort fallback ("Destination") is chrome.
    return c.country || COUNTRY_NAMES[c.countryCode] || c.countryCode || (t ? t('destination') : 'Destination');
  }

  // UK (and Ireland) departure airports → [lat, lng] + short label. Used to draw
  // Google-Flights-style routes from the gateway to the selected destination and
  // to pin the departure airport(s). Only the airports that actually appear in
  // the offers data are needed; unknown codes are simply skipped (no line drawn).
  const UK_AIRPORTS = {
    LGW: { lat: 51.1537, lng: -0.1821, label: 'London Gatwick' },
    LHR: { lat: 51.4700, lng: -0.4543, label: 'London Heathrow' },
    STN: { lat: 51.8849, lng: 0.2389, label: 'London Stansted' },
    LTN: { lat: 51.8747, lng: -0.3683, label: 'London Luton' },
    LCY: { lat: 51.5053, lng: 0.0553, label: 'London City' },
    SEN: { lat: 51.5714, lng: 0.6956, label: 'Southend' },
    MAN: { lat: 53.3650, lng: -2.2728, label: 'Manchester' },
    BHX: { lat: 52.4539, lng: -1.7480, label: 'Birmingham' },
    NCL: { lat: 55.0375, lng: -1.6917, label: 'Newcastle' },
    GLA: { lat: 55.8719, lng: -4.4331, label: 'Glasgow' },
    EDI: { lat: 55.9500, lng: -3.3725, label: 'Edinburgh' },
    BRS: { lat: 51.3827, lng: -2.7191, label: 'Bristol' },
    LBA: { lat: 53.8659, lng: -1.6606, label: 'Leeds Bradford' },
    EMA: { lat: 52.8311, lng: -1.3281, label: 'East Midlands' },
    BOH: { lat: 50.7800, lng: -1.8425, label: 'Bournemouth' },
    LPL: { lat: 53.3336, lng: -2.8497, label: 'Liverpool' },
    BFS: { lat: 54.6575, lng: -6.2158, label: 'Belfast Intl' },
    BHD: { lat: 54.6181, lng: -5.8725, label: 'Belfast City' },
    // Irish airports — the cache sweeps the Irish departure market too, so
    // Irish-origin offers appear in the data and need routes and pins.
    DUB: { lat: 53.4213, lng: -6.2701, label: 'Dublin' },
    ORK: { lat: 51.8413, lng: -8.4911, label: 'Cork' },
    SNN: { lat: 52.7020, lng: -8.9248, label: 'Shannon' },
    NOC: { lat: 53.9103, lng: -8.8185, label: 'Ireland West Knock' },
    KIR: { lat: 52.1809, lng: -9.5238, label: 'Kerry' },
  };

  // ── Leaflet CSS (inlined — needs to live inside Shadow DOM since <link> tags don't penetrate)

  const LEAFLET_CSS = `/* required styles */

.leaflet-pane,
.leaflet-tile,
.leaflet-marker-icon,
.leaflet-marker-shadow,
.leaflet-tile-container,
.leaflet-pane > svg,
.leaflet-pane > canvas,
.leaflet-zoom-box,
.leaflet-image-layer,
.leaflet-layer {
	position: absolute;
	left: 0;
	top: 0;
	}
.leaflet-container {
	overflow: hidden;
	}
.leaflet-tile,
.leaflet-marker-icon,
.leaflet-marker-shadow {
	-webkit-user-select: none;
	   -moz-user-select: none;
	        user-select: none;
	  -webkit-user-drag: none;
	}
/* Prevents IE11 from highlighting tiles in blue */
.leaflet-tile::selection {
	background: transparent;
}
/* Safari renders non-retina tile on retina better with this, but Chrome is worse */
.leaflet-safari .leaflet-tile {
	image-rendering: -webkit-optimize-contrast;
	}
/* hack that prevents hw layers "stretching" when loading new tiles */
.leaflet-safari .leaflet-tile-container {
	width: 1600px;
	height: 1600px;
	-webkit-transform-origin: 0 0;
	}
.leaflet-marker-icon,
.leaflet-marker-shadow {
	display: block;
	}
/* .leaflet-container svg: reset svg max-width decleration shipped in Joomla! (joomla.org) 3.x */
/* .leaflet-container img: map is broken in FF if you have max-width: 100% on tiles */
.leaflet-container .leaflet-overlay-pane svg {
	max-width: none !important;
	max-height: none !important;
	}
.leaflet-container .leaflet-marker-pane img,
.leaflet-container .leaflet-shadow-pane img,
.leaflet-container .leaflet-tile-pane img,
.leaflet-container img.leaflet-image-layer,
.leaflet-container .leaflet-tile {
	max-width: none !important;
	max-height: none !important;
	width: auto;
	padding: 0;
	}

.leaflet-container img.leaflet-tile {
	/* See: https://bugs.chromium.org/p/chromium/issues/detail?id=600120 */
	mix-blend-mode: plus-lighter;
}

.leaflet-container.leaflet-touch-zoom {
	-ms-touch-action: pan-x pan-y;
	touch-action: pan-x pan-y;
	}
.leaflet-container.leaflet-touch-drag {
	-ms-touch-action: pinch-zoom;
	/* Fallback for FF which doesn't support pinch-zoom */
	touch-action: none;
	touch-action: pinch-zoom;
}
.leaflet-container.leaflet-touch-drag.leaflet-touch-zoom {
	-ms-touch-action: none;
	touch-action: none;
}
.leaflet-container {
	-webkit-tap-highlight-color: transparent;
}
.leaflet-container a {
	-webkit-tap-highlight-color: rgba(51, 181, 229, 0.4);
}
.leaflet-tile {
	filter: inherit;
	visibility: hidden;
	}
.leaflet-tile-loaded {
	visibility: inherit;
	}
.leaflet-zoom-box {
	width: 0;
	height: 0;
	-moz-box-sizing: border-box;
	     box-sizing: border-box;
	z-index: 800;
	}
/* workaround for https://bugzilla.mozilla.org/show_bug.cgi?id=888319 */
.leaflet-overlay-pane svg {
	-moz-user-select: none;
	}

.leaflet-pane         { z-index: 400; }

.leaflet-tile-pane    { z-index: 200; }
.leaflet-overlay-pane { z-index: 400; }
.leaflet-shadow-pane  { z-index: 500; }
.leaflet-marker-pane  { z-index: 600; }
.leaflet-tooltip-pane   { z-index: 650; }
.leaflet-popup-pane   { z-index: 700; }

.leaflet-map-pane canvas { z-index: 100; }
.leaflet-map-pane svg    { z-index: 200; }

.leaflet-vml-shape {
	width: 1px;
	height: 1px;
	}
.lvml {
	behavior: url(#default#VML);
	display: inline-block;
	position: absolute;
	}


/* control positioning */

.leaflet-control {
	position: relative;
	z-index: 800;
	pointer-events: visiblePainted; /* IE 9-10 doesn't have auto */
	pointer-events: auto;
	}
.leaflet-top,
.leaflet-bottom {
	position: absolute;
	z-index: 1000;
	pointer-events: none;
	}
.leaflet-top {
	top: 0;
	}
.leaflet-right {
	right: 0;
	}
.leaflet-bottom {
	bottom: 0;
	}
.leaflet-left {
	left: 0;
	}
.leaflet-control {
	float: left;
	clear: both;
	}
.leaflet-right .leaflet-control {
	float: right;
	}
.leaflet-top .leaflet-control {
	margin-top: 10px;
	}
.leaflet-bottom .leaflet-control {
	margin-bottom: 10px;
	}
.leaflet-left .leaflet-control {
	margin-left: 10px;
	}
.leaflet-right .leaflet-control {
	margin-right: 10px;
	}


/* zoom and fade animations */

.leaflet-fade-anim .leaflet-popup {
	opacity: 0;
	-webkit-transition: opacity 0.2s linear;
	   -moz-transition: opacity 0.2s linear;
	        transition: opacity 0.2s linear;
	}
.leaflet-fade-anim .leaflet-map-pane .leaflet-popup {
	opacity: 1;
	}
.leaflet-zoom-animated {
	-webkit-transform-origin: 0 0;
	    -ms-transform-origin: 0 0;
	        transform-origin: 0 0;
	}
svg.leaflet-zoom-animated {
	will-change: transform;
}

.leaflet-zoom-anim .leaflet-zoom-animated {
	-webkit-transition: -webkit-transform 0.25s cubic-bezier(0,0,0.25,1);
	   -moz-transition:    -moz-transform 0.25s cubic-bezier(0,0,0.25,1);
	        transition:         transform 0.25s cubic-bezier(0,0,0.25,1);
	}
.leaflet-zoom-anim .leaflet-tile,
.leaflet-pan-anim .leaflet-tile {
	-webkit-transition: none;
	   -moz-transition: none;
	        transition: none;
	}

.leaflet-zoom-anim .leaflet-zoom-hide {
	visibility: hidden;
	}


/* cursors */

.leaflet-interactive {
	cursor: pointer;
	}
.leaflet-grab {
	cursor: -webkit-grab;
	cursor:    -moz-grab;
	cursor:         grab;
	}
.leaflet-crosshair,
.leaflet-crosshair .leaflet-interactive {
	cursor: crosshair;
	}
.leaflet-popup-pane,
.leaflet-control {
	cursor: auto;
	}
.leaflet-dragging .leaflet-grab,
.leaflet-dragging .leaflet-grab .leaflet-interactive,
.leaflet-dragging .leaflet-marker-draggable {
	cursor: move;
	cursor: -webkit-grabbing;
	cursor:    -moz-grabbing;
	cursor:         grabbing;
	}

/* marker & overlays interactivity */
.leaflet-marker-icon,
.leaflet-marker-shadow,
.leaflet-image-layer,
.leaflet-pane > svg path,
.leaflet-tile-container {
	pointer-events: none;
	}

.leaflet-marker-icon.leaflet-interactive,
.leaflet-image-layer.leaflet-interactive,
.leaflet-pane > svg path.leaflet-interactive,
svg.leaflet-image-layer.leaflet-interactive path {
	pointer-events: visiblePainted; /* IE 9-10 doesn't have auto */
	pointer-events: auto;
	}

/* visual tweaks */

.leaflet-container {
	background: #ddd;
	outline-offset: 1px;
	}
.leaflet-container a {
	color: #0078A8;
	}
.leaflet-zoom-box {
	border: 2px dotted #38f;
	background: rgba(255,255,255,0.5);
	}


/* general typography */
.leaflet-container {
	font-family: "Helvetica Neue", Arial, Helvetica, sans-serif;
	font-size: 12px;
	font-size: 0.75rem;
	line-height: 1.5;
	}


/* general toolbar styles */

.leaflet-bar {
	box-shadow: 0 1px 5px rgba(0,0,0,0.65);
	border-radius: 4px;
	}
.leaflet-bar a {
	background-color: #fff;
	border-bottom: 1px solid #ccc;
	width: 26px;
	height: 26px;
	line-height: 26px;
	display: block;
	text-align: center;
	text-decoration: none;
	color: black;
	}
.leaflet-bar a,
.leaflet-control-layers-toggle {
	background-position: 50% 50%;
	background-repeat: no-repeat;
	display: block;
	}
.leaflet-bar a:hover,
.leaflet-bar a:focus {
	background-color: #f4f4f4;
	}
.leaflet-bar a:first-child {
	border-top-left-radius: 4px;
	border-top-right-radius: 4px;
	}
.leaflet-bar a:last-child {
	border-bottom-left-radius: 4px;
	border-bottom-right-radius: 4px;
	border-bottom: none;
	}
.leaflet-bar a.leaflet-disabled {
	cursor: default;
	background-color: #f4f4f4;
	color: #bbb;
	}

.leaflet-touch .leaflet-bar a {
	width: 30px;
	height: 30px;
	line-height: 30px;
	}
.leaflet-touch .leaflet-bar a:first-child {
	border-top-left-radius: 2px;
	border-top-right-radius: 2px;
	}
.leaflet-touch .leaflet-bar a:last-child {
	border-bottom-left-radius: 2px;
	border-bottom-right-radius: 2px;
	}

/* zoom control */

.leaflet-control-zoom-in,
.leaflet-control-zoom-out {
	font: bold 18px 'Lucida Console', Monaco, monospace;
	text-indent: 1px;
	}

.leaflet-touch .leaflet-control-zoom-in, .leaflet-touch .leaflet-control-zoom-out  {
	font-size: 22px;
	}


/* layers control */

.leaflet-control-layers {
	box-shadow: 0 1px 5px rgba(0,0,0,0.4);
	background: #fff;
	border-radius: 5px;
	}
.leaflet-control-layers-toggle {
	background-image: url(images/layers.png);
	width: 36px;
	height: 36px;
	}
.leaflet-retina .leaflet-control-layers-toggle {
	background-image: url(images/layers-2x.png);
	background-size: 26px 26px;
	}
.leaflet-touch .leaflet-control-layers-toggle {
	width: 44px;
	height: 44px;
	}
.leaflet-control-layers .leaflet-control-layers-list,
.leaflet-control-layers-expanded .leaflet-control-layers-toggle {
	display: none;
	}
.leaflet-control-layers-expanded .leaflet-control-layers-list {
	display: block;
	position: relative;
	}
.leaflet-control-layers-expanded {
	padding: 6px 10px 6px 6px;
	color: #333;
	background: #fff;
	}
.leaflet-control-layers-scrollbar {
	overflow-y: scroll;
	overflow-x: hidden;
	padding-right: 5px;
	}
.leaflet-control-layers-selector {
	margin-top: 2px;
	position: relative;
	top: 1px;
	}
.leaflet-control-layers label {
	display: block;
	font-size: 13px;
	font-size: 1.08333em;
	}
.leaflet-control-layers-separator {
	height: 0;
	border-top: 1px solid #ddd;
	margin: 5px -10px 5px -6px;
	}

/* Default icon URLs */
.leaflet-default-icon-path { /* used only in path-guessing heuristic, see L.Icon.Default */
	background-image: url(images/marker-icon.png);
	}


/* attribution and scale controls */

.leaflet-container .leaflet-control-attribution {
	background: #fff;
	background: rgba(255, 255, 255, 0.8);
	margin: 0;
	}
.leaflet-control-attribution,
.leaflet-control-scale-line {
	padding: 0 5px;
	color: #333;
	line-height: 1.4;
	}
.leaflet-control-attribution a {
	text-decoration: none;
	}
.leaflet-control-attribution a:hover,
.leaflet-control-attribution a:focus {
	text-decoration: underline;
	}
.leaflet-attribution-flag {
	display: inline !important;
	vertical-align: baseline !important;
	width: 1em;
	height: 0.6669em;
	}
.leaflet-left .leaflet-control-scale {
	margin-left: 5px;
	}
.leaflet-bottom .leaflet-control-scale {
	margin-bottom: 5px;
	}
.leaflet-control-scale-line {
	border: 2px solid #777;
	border-top: none;
	line-height: 1.1;
	padding: 2px 5px 1px;
	white-space: nowrap;
	-moz-box-sizing: border-box;
	     box-sizing: border-box;
	background: rgba(255, 255, 255, 0.8);
	text-shadow: 1px 1px #fff;
	}
.leaflet-control-scale-line:not(:first-child) {
	border-top: 2px solid #777;
	border-bottom: none;
	margin-top: -2px;
	}
.leaflet-control-scale-line:not(:first-child):not(:last-child) {
	border-bottom: 2px solid #777;
	}

.leaflet-touch .leaflet-control-attribution,
.leaflet-touch .leaflet-control-layers,
.leaflet-touch .leaflet-bar {
	box-shadow: none;
	}
.leaflet-touch .leaflet-control-layers,
.leaflet-touch .leaflet-bar {
	border: 2px solid rgba(0,0,0,0.2);
	background-clip: padding-box;
	}


/* popup */

.leaflet-popup {
	position: absolute;
	text-align: center;
	margin-bottom: 20px;
	}
.leaflet-popup-content-wrapper {
	padding: 1px;
	text-align: left;
	border-radius: 12px;
	}
.leaflet-popup-content {
	margin: 13px 24px 13px 20px;
	line-height: 1.3;
	font-size: 13px;
	font-size: 1.08333em;
	min-height: 1px;
	}
.leaflet-popup-content p {
	margin: 17px 0;
	margin: 1.3em 0;
	}
.leaflet-popup-tip-container {
	width: 40px;
	height: 20px;
	position: absolute;
	left: 50%;
	margin-top: -1px;
	margin-left: -20px;
	overflow: hidden;
	pointer-events: none;
	}
.leaflet-popup-tip {
	width: 17px;
	height: 17px;
	padding: 1px;

	margin: -10px auto 0;
	pointer-events: auto;

	-webkit-transform: rotate(45deg);
	   -moz-transform: rotate(45deg);
	    -ms-transform: rotate(45deg);
	        transform: rotate(45deg);
	}
.leaflet-popup-content-wrapper,
.leaflet-popup-tip {
	background: white;
	color: #333;
	box-shadow: 0 3px 14px rgba(0,0,0,0.4);
	}
.leaflet-container a.leaflet-popup-close-button {
	position: absolute;
	top: 0;
	right: 0;
	border: none;
	text-align: center;
	width: 24px;
	height: 24px;
	font: 16px/24px Tahoma, Verdana, sans-serif;
	color: #757575;
	text-decoration: none;
	background: transparent;
	}
.leaflet-container a.leaflet-popup-close-button:hover,
.leaflet-container a.leaflet-popup-close-button:focus {
	color: #585858;
	}
.leaflet-popup-scrolled {
	overflow: auto;
	}

.leaflet-oldie .leaflet-popup-content-wrapper {
	-ms-zoom: 1;
	}
.leaflet-oldie .leaflet-popup-tip {
	width: 24px;
	margin: 0 auto;

	-ms-filter: "progid:DXImageTransform.Microsoft.Matrix(M11=0.70710678, M12=0.70710678, M21=-0.70710678, M22=0.70710678)";
	filter: progid:DXImageTransform.Microsoft.Matrix(M11=0.70710678, M12=0.70710678, M21=-0.70710678, M22=0.70710678);
	}

.leaflet-oldie .leaflet-control-zoom,
.leaflet-oldie .leaflet-control-layers,
.leaflet-oldie .leaflet-popup-content-wrapper,
.leaflet-oldie .leaflet-popup-tip {
	border: 1px solid #999;
	}


/* div icon */

.leaflet-div-icon {
	background: #fff;
	border: 1px solid #666;
	}


/* Tooltip */
/* Base styles for the element that has a tooltip */
.leaflet-tooltip {
	position: absolute;
	padding: 6px;
	background-color: #fff;
	border: 1px solid #fff;
	border-radius: 3px;
	color: #222;
	white-space: nowrap;
	-webkit-user-select: none;
	-moz-user-select: none;
	-ms-user-select: none;
	user-select: none;
	pointer-events: none;
	box-shadow: 0 1px 3px rgba(0,0,0,0.4);
	}
.leaflet-tooltip.leaflet-interactive {
	cursor: pointer;
	pointer-events: auto;
	}
.leaflet-tooltip-top:before,
.leaflet-tooltip-bottom:before,
.leaflet-tooltip-left:before,
.leaflet-tooltip-right:before {
	position: absolute;
	pointer-events: none;
	border: 6px solid transparent;
	background: transparent;
	content: "";
	}

/* Directions */

.leaflet-tooltip-bottom {
	margin-top: 6px;
}
.leaflet-tooltip-top {
	margin-top: -6px;
}
.leaflet-tooltip-bottom:before,
.leaflet-tooltip-top:before {
	left: 50%;
	margin-left: -6px;
	}
.leaflet-tooltip-top:before {
	bottom: 0;
	margin-bottom: -12px;
	border-top-color: #fff;
	}
.leaflet-tooltip-bottom:before {
	top: 0;
	margin-top: -12px;
	margin-left: -6px;
	border-bottom-color: #fff;
	}
.leaflet-tooltip-left {
	margin-left: -6px;
}
.leaflet-tooltip-right {
	margin-left: 6px;
}
.leaflet-tooltip-left:before,
.leaflet-tooltip-right:before {
	top: 50%;
	margin-top: -6px;
	}
.leaflet-tooltip-left:before {
	right: 0;
	margin-right: -12px;
	border-left-color: #fff;
	}
.leaflet-tooltip-right:before {
	left: 0;
	margin-left: -12px;
	border-right-color: #fff;
	}

/* Printing */

@media print {
	/* Prevent printers from removing background-images of controls. */
	.leaflet-control {
		-webkit-print-color-adjust: exact;
		print-color-adjust: exact;
		}
	}
`;

  // ── Widget styles

  const STYLES = `
    :host { all: initial; display: block; font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
    *, *::before, *::after { box-sizing: border-box; }

    .tgwm-root {
      --tgwm-bg: #FFFFFF;
      --tgwm-surface: #F8FAFC;
      --tgwm-border: #E2E8F0;
      --tgwm-text: #0F172A;
      --tgwm-text-muted: #64748B;
      --tgwm-pin-anchor: #1B2B5B;
      --tgwm-pin-anchor-active: #00B4D8;
      --tgwm-cta-bg: #1B2B5B;
      --tgwm-cta-fg: #FFFFFF;
      --tgwm-radius: 16px;
      --tgwm-radius-sm: 10px;
      --tgwm-shadow-md: 0 4px 12px rgba(15,23,42,.10), 0 2px 4px rgba(15,23,42,.06);
      --tgwm-shadow-lg: 0 20px 40px rgba(15,23,42,.14);
      --tgwm-ease: cubic-bezier(.22, .61, .36, 1);

      position: relative;
      width: 100%;
      background: var(--tgwm-bg);
      color: var(--tgwm-text);
      border-radius: var(--tgwm-radius);
      overflow: hidden;
      border: 1px solid var(--tgwm-border);
    }

    .tgwm-root[data-theme="dark"] {
      --tgwm-bg: #0F172A;
      --tgwm-surface: #1E293B;
      --tgwm-border: #334155;
      --tgwm-text: #F8FAFC;
      --tgwm-text-muted: #CBD5E1;
    }

    .tgwm-header {
      padding: 16px 20px 12px;
    }
    .tgwm-title {
      margin: 0 0 2px;
      font-size: 16px;
      font-weight: 700;
      line-height: 1.2;
      letter-spacing: -0.005em;
    }
    .tgwm-subtitle {
      margin: 0;
      font-size: 13px;
      color: var(--tgwm-text-muted);
      line-height: 1.4;
    }

    .tgwm-map-wrap {
      position: relative;
      width: 100%;
      aspect-ratio: 16 / 9;
      background: #A5D2EC;  /* MapTiler Streets ocean tone while tiles load */
      overflow: hidden;
    }
    .tgwm-map {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
    }

    /* Hide Leaflet's flag/branding link, keep legal attribution */
    .leaflet-control-attribution a[href*="leafletjs"] { display: none !important; }
    .leaflet-control-attribution {
      font-size: 10px !important;
      background: rgba(255,255,255,0.9) !important;
      padding: 2px 6px !important;
      color: var(--tgwm-text-muted) !important;
    }
    .leaflet-control-attribution a {
      color: var(--tgwm-text-muted) !important;
      text-decoration: none !important;
    }
    [data-theme="dark"] .leaflet-control-attribution {
      background: rgba(30,41,59,.9) !important;
      color: var(--tgwm-text-muted) !important;
    }

    /* Loading state — full-cover spinner over the map */
    .tgwm-loading {
      position: absolute; inset: 0;
      display: flex; align-items: center; justify-content: center;
      flex-direction: column; gap: 12px;
      background: var(--tgwm-bg);
      color: var(--tgwm-text-muted);
      font-size: 13px;
      z-index: 1000;
      transition: opacity 220ms var(--tgwm-ease);
    }
    .tgwm-loading.is-hidden { opacity: 0; pointer-events: none; }
    .tgwm-spinner {
      width: 24px; height: 24px;
      border-radius: 50%;
      border: 2px solid var(--tgwm-border);
      border-top-color: var(--tgwm-pin-anchor-active);
      animation: tgwm-spin 700ms linear infinite;
    }
    @keyframes tgwm-spin { to { transform: rotate(360deg); } }
    @media (prefers-reduced-motion: reduce) { .tgwm-spinner { animation: none; } }

    /* ── Price-tag pins ──────────────────────────────────────────────── */
    /* Note: these get rendered via Leaflet's L.divIcon, so they sit INSIDE
       the map container. Leaflet's L.divIcon HTML lands in the
       .leaflet-marker-pane — so styles need to be specific enough to
       work there. */

    .tg-pin-wrap {
      display: inline-flex;
      flex-direction: column;
      align-items: center;
      gap: 3px;
      transform: translate(-50%, -100%);
      pointer-events: none;  /* container doesn't catch events */
    }
    .tg-price-tag {
      pointer-events: auto;  /* but the tag does */
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 3px 7px;
      background: #FFFFFF;
      border: 1px solid #E2E8F0;
      border-radius: 999px;
      font-size: 11px;
      font-weight: 700;
      line-height: 1;
      box-shadow: 0 1px 4px rgba(15,23,42,.16), 0 1px 2px rgba(15,23,42,.08);
      white-space: nowrap;
      cursor: pointer;
      transition: transform 180ms var(--tgwm-ease), box-shadow 180ms, border-color 180ms;
      color: #0F172A;
    }
    .tg-price-tag:hover {
      transform: translateY(-2px) scale(1.06);
      box-shadow: 0 6px 16px rgba(15,23,42,.18), 0 2px 4px rgba(15,23,42,.08);
      border-color: var(--tgwm-pin-anchor-active);
      z-index: 1000;
    }
    /* Compact pins: the price is the hero; the place name is a small label that
       only shows on wider pins / hover so close-together pins stay tiny. */
    .tg-price-tag .tg-tag-country {
      color: #64748B;
      font-weight: 500;
      font-size: 10px;
      max-width: 96px;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .tg-price-tag .tg-tag-price {
      color: #0F172A;
      font-weight: 800;
    }
    .tg-price-anchor {
      pointer-events: auto;
      width: 8px; height: 8px;
      background: var(--tgwm-pin-anchor);
      border: 2px solid #FFFFFF;
      border-radius: 50%;
      box-shadow: 0 1px 3px rgba(15,23,42,.3);
    }

    [data-theme="dark"] .tg-price-tag {
      background: #1E293B;
      border-color: #334155;
      color: #F8FAFC;
    }
    [data-theme="dark"] .tg-price-tag .tg-tag-country { color: #CBD5E1; }
    [data-theme="dark"] .tg-price-tag .tg-tag-price { color: #F8FAFC; }
    [data-theme="dark"] .tg-price-anchor {
      background: var(--tgwm-pin-anchor-active);
      border-color: #0F172A;
    }

    /* ── Departure (UK origin) pin + flight route ────────────────────────
       Shown only on drill-down for the selected destination. The pin is the
       brand primary colour with a plane glyph so it reads as "fly from here",
       clearly different from the white price pins. */
    .tgwm-dep-wrap {
      display: inline-flex; align-items: center; gap: 5px;
      transform: translate(-50%, -50%);
      pointer-events: none;
    }
    .tgwm-dep-pin {
      pointer-events: auto;
      display: inline-flex; align-items: center; gap: 5px;
      padding: 4px 9px 4px 7px;
      background: var(--tgwm-pin-anchor);
      color: #FFFFFF;
      border-radius: 999px;
      font-size: 11px; font-weight: 700; line-height: 1; white-space: nowrap;
      box-shadow: 0 2px 8px rgba(15,23,42,.28);
      border: 1.5px solid rgba(255,255,255,.85);
    }
    .tgwm-dep-pin svg { width: 12px; height: 12px; flex: 0 0 auto; }
    .tgwm-dep-pin .tgwm-dep-label { font-weight: 600; opacity: .92; }
    [data-theme="dark"] .tgwm-dep-pin { border-color: rgba(15,23,42,.6); }

    /* ── View Fullscreen CTA ─────────────────────────────────────────── */

    .tgwm-fs-btn {
      position: absolute;
      right: 14px;
      bottom: 14px;
      z-index: 800;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 10px 16px;
      background: var(--tgwm-cta-bg);
      color: var(--tgwm-cta-fg);
      border: 0;
      border-radius: var(--tgwm-radius-sm);
      font-size: 13px;
      font-weight: 600;
      font-family: inherit;
      cursor: pointer;
      /* White ring so the navy pill always separates from the map behind it,
         whatever the tile colour in that corner. */
      box-shadow: 0 0 0 1.5px rgba(255,255,255,.9), 0 4px 12px rgba(15,23,42,.28);
      transition: transform 160ms var(--tgwm-ease), box-shadow 160ms;
    }
    .tgwm-fs-btn:hover {
      transform: translateY(-1px);
      box-shadow: 0 0 0 1.5px rgba(255,255,255,.9), 0 8px 20px rgba(15,23,42,.34);
    }
    .tgwm-fs-btn:active { transform: translateY(0); }
    .tgwm-fs-btn:focus-visible {
      outline: none;
      box-shadow: 0 0 0 3px rgba(0,180,216,.55), 0 4px 12px rgba(15,23,42,.28);
    }
    .tgwm-fs-btn svg { width: 14px; height: 14px; }
    @media (prefers-reduced-motion: reduce) { .tgwm-fs-btn { transition: none; } }

    /* ── Fullscreen overlay shell ────────────────────────────────────── */
    /* Lives inside the same Shadow DOM, so host-page CSS can't bleed in and
       the widget's own --tgwm-* tokens cascade straight through. Fixed to the
       viewport at max z-index so it sits above all host page content. */

    .tgwm-overlay {
      position: fixed;
      inset: 0;
      z-index: 2147483647;
      display: flex;
      flex-direction: column;
      background: var(--tgwm-bg);
      color: var(--tgwm-text);
      opacity: 0;
      transform: scale(.985);
      transition: opacity 240ms var(--tgwm-ease), transform 240ms var(--tgwm-ease);
      /* font re-declared because :host { all:initial } stops inheritance into
         a fixed child that escapes the normal flow in some engines */
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      /* While not open, the overlay must never intercept clicks meant for the
         map/pins beneath it. pointer-events is re-enabled only on .is-open. */
      pointer-events: none;
    }
    /* [hidden] loses to display:flex on specificity (documented gotcha), so
       force it. A hidden overlay is fully removed from hit-testing. */
    .tgwm-overlay[hidden] { display: none !important; }
    .tgwm-overlay.is-open { opacity: 1; transform: scale(1); pointer-events: auto; }
    @media (prefers-reduced-motion: reduce) {
      .tgwm-overlay { transition: opacity 240ms var(--tgwm-ease); transform: none; }
      .tgwm-overlay.is-open { transform: none; }
    }

    /* Backdrop sits behind the panel; click-to-close lives here. In the full
       split-view (pieces 2-4) the panel fills the overlay, but the backdrop
       stays as the click-out target during the open/close transition. */
    .tgwm-overlay-backdrop {
      position: absolute;
      inset: 0;
      background: var(--tgwm-bg);
      cursor: default;
    }

    .tgwm-overlay-header {
      position: relative;
      z-index: 2;
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 14px 16px;
      border-bottom: 1px solid var(--tgwm-border);
      background: var(--tgwm-bg);
      flex: 0 0 auto;
    }
    .tgwm-overlay-titles { min-width: 0; flex: 1 1 auto; }
    .tgwm-overlay-title {
      margin: 0;
      font-size: 16px;
      font-weight: 700;
      line-height: 1.2;
      letter-spacing: -0.005em;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .tgwm-overlay-sub {
      margin: 2px 0 0;
      font-size: 13px;
      color: var(--tgwm-text-muted);
      line-height: 1.3;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .tgwm-overlay-close {
      flex: 0 0 auto;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 44px;
      height: 44px;
      border: 1px solid var(--tgwm-border);
      border-radius: var(--tgwm-radius-sm);
      background: var(--tgwm-surface);
      color: var(--tgwm-text);
      cursor: pointer;
      transition: background 160ms var(--tgwm-ease), border-color 160ms var(--tgwm-ease), transform 120ms var(--tgwm-ease);
    }
    .tgwm-overlay-close:hover { background: var(--tgwm-border); }
    .tgwm-overlay-close:active { transform: scale(.94); }
    .tgwm-overlay-close:focus-visible {
      outline: none;
      border-color: var(--tgwm-pin-anchor-active);
      box-shadow: 0 0 0 3px rgba(0,180,216,.25);
    }
    .tgwm-overlay-close svg { width: 20px; height: 20px; }
    @media (prefers-reduced-motion: reduce) { .tgwm-overlay-close { transition: none; } }
    .tgwm-ov-cur {
      flex: 0 0 auto; display: inline-flex; align-items: center; gap: 6px;
      margin-right: 10px; opacity: .85;
    }
    .tgwm-ov-cur select {
      font: inherit; font-size: 13px; padding: 6px 8px;
      border: 1px solid rgba(128,128,128,.35); border-radius: 8px;
      background: rgba(255,255,255,.92); color: #0f172a; cursor: pointer; max-width: 96px;
    }

    /* Content area — pieces 2-4 (map + deal cards + filters) mount in here.
       For piece 1 it just holds the empty/placeholder state. */
    .tgwm-overlay-body {
      position: relative;
      z-index: 2;
      flex: 1 1 auto;
      min-height: 0;
      display: flex;
      overflow: hidden;
    }

    .tgwm-overlay-empty {
      flex: 1 1 auto;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 10px;
      padding: 40px 24px;
      text-align: center;
      color: var(--tgwm-text-muted);
    }
    .tgwm-overlay-empty[hidden] { display: none !important; }
    .tgwm-overlay-empty svg { width: 40px; height: 40px; opacity: .5; }
    .tgwm-overlay-empty p { margin: 0; font-size: 14px; line-height: 1.5; max-width: 40ch; }

    /* ── Big interactive map (Piece 2) ───────────────────────────────── */
    /* Fills the overlay body. Fully interactive (drag/zoom/controls), unlike
       the small envelope map. Lives in a relatively-positioned wrapper so the
       map loading veil can sit over it. */
    .tgwm-ov-mapcol {
      position: relative;
      flex: 1 1 auto;
      min-width: 0;
      min-height: 0;
    }
    /* Absolute-fill rather than height:100% — a percentage height inside a
       flex-stretched parent computes to 0 in several engines, which left
       Leaflet initialising into a zero-height box (infinite "Loading map…"). */
    .tgwm-ov-map {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      background: #A5D2EC; /* ocean tone while tiles load */
    }
    .tgwm-ov-map .leaflet-container { width: 100%; height: 100%; background: #A5D2EC; }

    /* ── Region pills (float over the map top) ─────────────────────────── */
    .tgwm-ov-regions {
      position: absolute;
      top: 12px;
      left: 12px;
      right: 64px; /* leave room for the zoom control top-right */
      z-index: 620; /* above edge arrows (600), below zoom controls (700) */
      display: flex;
      gap: 6px;
      overflow-x: auto;
      padding: 2px;
      scrollbar-width: none;
      -ms-overflow-style: none;
    }
    .tgwm-ov-regions[hidden] { display: none; }
    .tgwm-ov-regions::-webkit-scrollbar { display: none; }
    .tgwm-region-pill {
      flex: 0 0 auto;
      appearance: none;
      border: 1px solid var(--tgwm-border);
      background: var(--tgwm-bg, #fff);
      color: var(--tgwm-text);
      font: inherit;
      font-size: 12px;
      font-weight: 600;
      line-height: 1;
      padding: 8px 12px;
      border-radius: 999px;
      cursor: pointer;
      white-space: nowrap;
      box-shadow: 0 1px 3px rgba(15,23,42,.12);
      transition: background 140ms, color 140ms, border-color 140ms, box-shadow 140ms;
    }
    .tgwm-region-pill:hover { border-color: var(--tgwm-pin-anchor-active, #00B4D8); }
    .tgwm-region-pill[aria-pressed="true"] {
      background: var(--tgwm-pin-anchor, #1B2B5B);
      border-color: var(--tgwm-pin-anchor, #1B2B5B);
      color: #fff;
      box-shadow: 0 2px 6px rgba(15,23,42,.2);
    }
    .tgwm-region-pill .tgwm-region-count {
      opacity: .6;
      font-weight: 600;
      margin-left: 4px;
    }
    .tgwm-region-pill[aria-pressed="true"] .tgwm-region-count { opacity: .8; }
    @media (prefers-reduced-motion: reduce) { .tgwm-region-pill { transition: none; } }

    /* ── Off-screen deal indicators (edge arrows) ──────────────────────── */
    /* A screen-fixed layer over the map; chips pin to the viewport edges and
       point toward deals that are currently off-screen. Pointer-events are
       off on the layer, on per-chip, so the map stays draggable between them. */
    .tgwm-ov-edges {
      position: absolute;
      inset: 0;
      pointer-events: none;
      z-index: 600; /* above tiles + markers, below zoom controls (700) */
      overflow: hidden;
    }
    .tgwm-edge-chip {
      position: absolute;
      pointer-events: auto;
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 4px 8px;
      background: var(--tgwm-pin-anchor, #1B2B5B);
      color: #fff;
      border-radius: 999px;
      font-size: 11px;
      font-weight: 700;
      line-height: 1;
      white-space: nowrap;
      cursor: pointer;
      box-shadow: 0 2px 8px rgba(15,23,42,.28);
      transition: box-shadow 140ms, background 140ms;
    }
    .tgwm-edge-chip:hover {
      background: var(--tgwm-pin-anchor-active, #00B4D8);
      box-shadow: 0 4px 12px rgba(15,23,42,.34);
    }
    .tgwm-edge-chip svg { width: 11px; height: 11px; flex: 0 0 auto; }
    .tgwm-edge-chip .tgwm-edge-name {
      max-width: 90px; overflow: hidden; text-overflow: ellipsis;
      font-weight: 600; opacity: .92;
    }
    .tgwm-edge-chip .tgwm-edge-price { font-weight: 800; }
    [data-theme="dark"] .tgwm-edge-chip { background: var(--tgwm-pin-anchor-active, #00B4D8); }
    @media (prefers-reduced-motion: reduce) { .tgwm-edge-chip { transition: none; } }

    /* Loading veil specific to the big map (separate from the small map's). */
    .tgwm-ov-loading {
      position: absolute; inset: 0;
      display: flex; align-items: center; justify-content: center;
      flex-direction: column; gap: 12px;
      background: var(--tgwm-bg);
      color: var(--tgwm-text-muted);
      font-size: 13px;
      z-index: 1200;
      transition: opacity 220ms var(--tgwm-ease);
    }
    .tgwm-ov-loading.is-hidden { opacity: 0; pointer-events: none; }

    /* Zoom controls — restyle Leaflet's default to match the brand. These only
       appear in the big map (the small map has zoomControl:false). */
    .tgwm-ov-map .leaflet-control-zoom {
      border: 1px solid var(--tgwm-border) !important;
      border-radius: var(--tgwm-radius-sm) !important;
      box-shadow: var(--tgwm-shadow-md) !important;
      overflow: hidden;
    }
    .tgwm-ov-map .leaflet-control-zoom a {
      width: 36px !important;
      height: 36px !important;
      line-height: 36px !important;
      background: var(--tgwm-bg) !important;
      color: var(--tgwm-text) !important;
      border-bottom: 1px solid var(--tgwm-border) !important;
      font-size: 18px !important;
      transition: background 140ms var(--tgwm-ease);
    }
    .tgwm-ov-map .leaflet-control-zoom a:last-child { border-bottom: 0 !important; }
    .tgwm-ov-map .leaflet-control-zoom a:hover { background: var(--tgwm-surface) !important; }

    /* Reuse the existing tg-pin styling for the big-map pins — they share the
       .tg-pin-wrap / .tg-price-tag classes so no new pin CSS needed. The big
       map shows ALL pins, so they may sit closer; that's fine when zoomed in. */

    /* Active resort pin (clicked) — teal tag so the selection reads on the map. */
    .tg-pin-wrap.is-active .tg-price-tag {
      background: var(--tgwm-pin-anchor-active);
      border-color: var(--tgwm-pin-anchor-active);
    }
    .tg-pin-wrap.is-active .tg-tag-country,
    .tg-pin-wrap.is-active .tg-tag-price { color: #fff; }
    .tg-pin-wrap.is-active .tg-price-anchor { background: var(--tgwm-pin-anchor-active); }

    /* "Show all <country>" link in the cards meta when a resort filter is on. */
    .tgwm-clear-resort {
      background: none;
      border: 0;
      padding: 0;
      font: inherit;
      font-size: 12px;
      color: var(--tgwm-pin-anchor-active);
      font-weight: 600;
      cursor: pointer;
      text-decoration: underline;
    }
    .tgwm-clear-resort:hover { opacity: .85; }

    /* ── Deal cards panel (Piece 3) ──────────────────────────────────── */
    /* Split layout: cards left ~40%, map right ~60% (Google Flights Explore).
       The overlay body is a flex row; the cards column is a fixed-ish width and
       the map column flexes to fill. On narrow widths (container query) they
       stack — map on top, cards scroll beneath. */
    /* The container is the OVERLAY, one level above the body: a container
       query can never match rules on the container element itself, and the
       stacking rule below styles .tgwm-overlay-body directly. With the
       container ON the body (as originally written) that rule silently never
       applied — phones kept the row layout, the map column crushed to zero
       width and the deals panel floated at 55% height over blank space (the
       reported mobile bug). */
    .tgwm-overlay { container-type: inline-size; container-name: tgwmbody; }

    .tgwm-ov-cards {
      flex: 0 0 40%;
      max-width: 460px;
      min-width: 0;
      display: flex;
      flex-direction: column;
      border-right: 1px solid var(--tgwm-border);
      background: var(--tgwm-bg);
      overflow: hidden;
      transition: flex-basis 280ms var(--tgwm-ease), max-width 280ms var(--tgwm-ease);
    }
    /* Collapsed until a destination is picked — map takes the full width. */
    .tgwm-overlay-body[data-cards-hidden] .tgwm-ov-cards {
      flex-basis: 0;
      max-width: 0;
      border-right: 0;
    }
    @media (prefers-reduced-motion: reduce) { .tgwm-ov-cards { transition: none; } }
    .tgwm-ov-cards-head {
      flex: 0 0 auto;
      padding: 14px 16px 10px;
      border-bottom: 1px solid var(--tgwm-border);
    }
    .tgwm-ov-cards-title {
      margin: 0;
      font-size: 15px;
      font-weight: 700;
      line-height: 1.2;
      color: var(--tgwm-text);
    }
    .tgwm-ov-cards-meta {
      margin: 3px 0 0;
      font-size: 12px;
      color: var(--tgwm-text-muted);
      line-height: 1.3;
    }
    /* ── In-country filter row ─────────────────────────────────────────── */
    .tgwm-ov-filters {
      display: flex;
      flex-wrap: wrap;
      gap: 12px 18px;
      margin-top: 10px;
    }
    .tgwm-ov-filters[hidden] { display: none; }
    .tgwm-filter-group { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
    .tgwm-filter-label {
      font-size: 10px;
      font-weight: 700;
      letter-spacing: .04em;
      text-transform: uppercase;
      color: var(--tgwm-text-muted);
    }
    .tgwm-seg {
      display: inline-flex;
      background: var(--tgwm-surface, #F1F5F9);
      border: 1px solid var(--tgwm-border);
      border-radius: 8px;
      padding: 2px;
      gap: 2px;
    }
    .tgwm-seg button {
      appearance: none;
      border: 0;
      background: none;
      font: inherit;
      font-size: 12px;
      font-weight: 600;
      line-height: 1;
      color: var(--tgwm-text-muted);
      padding: 6px 9px;
      border-radius: 6px;
      cursor: pointer;
      white-space: nowrap;
      transition: background 140ms, color 140ms;
    }
    .tgwm-seg button:hover:not([disabled]) { color: var(--tgwm-text); }
    .tgwm-seg button[aria-pressed="true"] {
      background: var(--tgwm-pin-anchor-active, #00B4D8);
      color: #fff;
    }
    .tgwm-seg button[disabled] { opacity: .38; cursor: not-allowed; }
    @media (prefers-reduced-motion: reduce) { .tgwm-seg button { transition: none; } }

    /* The scrolling list fills the column beneath the fixed head. min-height:0
       is essential — without it this flex child won't shrink below its content
       height, so it never scrolls. */
    .tgwm-ov-cards-scroll {
      flex: 1 1 auto;
      min-height: 0;
      overflow-y: auto;
      overflow-x: hidden;
      padding: 14px 16px;
      display: block;            /* NOT flex — flex would shrink the cards */
      -webkit-overflow-scrolling: touch;
    }
    /* Spacing between cards (gap doesn't apply to block flow). */
    .tgwm-ov-cards-scroll > .tgwm-card { margin-bottom: 12px; }
    .tgwm-ov-cards-scroll > .tgwm-skel { margin-bottom: 12px; }
    .tgwm-ov-cards-scroll > *:last-child { margin-bottom: 0; }

    /* The deal card — image dominant, price-pp, hotel + stars, facts, CTA.
       Whole card is a clickable anchor to the Travelify deeplink. */
    .tgwm-card {
      display: flex;
      flex-direction: column;
      text-decoration: none;
      color: inherit;
      background: var(--tgwm-bg);
      border: 1px solid var(--tgwm-border);
      border-radius: var(--tgwm-radius-sm);
      overflow: hidden;
      box-shadow: var(--tgwm-shadow-md);
      transition: transform 160ms var(--tgwm-ease), box-shadow 160ms var(--tgwm-ease), border-color 160ms var(--tgwm-ease);
      cursor: pointer;
    }
    .tgwm-card:hover {
      transform: translateY(-2px);
      box-shadow: var(--tgwm-shadow-lg);
      border-color: var(--tgwm-pin-anchor-active);
    }
    .tgwm-card:focus-visible {
      outline: none;
      border-color: var(--tgwm-pin-anchor-active);
      box-shadow: 0 0 0 3px rgba(0,180,216,.3);
    }
    @media (prefers-reduced-motion: reduce) { .tgwm-card { transition: none; } }

    .tgwm-card-img {
      position: relative;
      width: 100%;
      height: 168px;           /* explicit height — robust against flex/aspect-ratio edge cases */
      flex: 0 0 auto;          /* never shrink the image */
      background: var(--tgwm-surface);
      overflow: hidden;
    }
    .tgwm-card-img img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      display: block;
    }
    /* Price chip overlaid on the image, bottom-left */
    .tgwm-card-price {
      position: absolute;
      left: 10px;
      bottom: 10px;
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 1px;
      padding: 6px 10px;
      background: rgba(255,255,255,.96);
      border-radius: var(--tgwm-radius-sm);
      box-shadow: 0 2px 8px rgba(15,23,42,.18);
    }
    .tgwm-card-price-pp {
      font-size: 16px;
      font-weight: 800;
      line-height: 1;
      color: #0F172A;
      font-variant-numeric: tabular-nums;
    }
    .tgwm-card-price-pp span { font-size: 11px; font-weight: 600; color: #64748B; }
    .tgwm-card-price-total {
      font-size: 11px;
      color: #64748B;
      line-height: 1;
      font-variant-numeric: tabular-nums;
    }
    [data-theme="dark"] .tgwm-card-price { background: rgba(30,41,59,.96); }
    [data-theme="dark"] .tgwm-card-price-pp { color: #F8FAFC; }
    [data-theme="dark"] .tgwm-card-price-pp span,
    [data-theme="dark"] .tgwm-card-price-total { color: #CBD5E1; }

    /* Direct-flight badge, image top-right */
    .tgwm-card-badge {
      position: absolute;
      top: 10px;
      right: 10px;
      padding: 4px 8px;
      background: rgba(16,185,129,.95);
      color: #fff;
      font-size: 10px;
      font-weight: 700;
      letter-spacing: .02em;
      border-radius: var(--tgwm-radius-sm);
      text-transform: uppercase;
    }

    .tgwm-card-body { padding: 10px 12px 12px; flex: 0 0 auto; }
    .tgwm-card-hotel {
      margin: 0;
      font-size: 14px;
      font-weight: 700;
      line-height: 1.25;
      color: var(--tgwm-text);
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }
    .tgwm-card-resort {
      margin: 2px 0 0;
      font-size: 12px;
      color: var(--tgwm-text-muted);
      line-height: 1.3;
    }
    .tgwm-card-stars {
      display: inline-flex;
      gap: 1px;
      margin-top: 6px;
      color: #F59E0B;
    }
    .tgwm-card-stars svg { width: 14px; height: 14px; }
    .tgwm-card-stars .tgwm-star-empty { color: var(--tgwm-border); }

    .tgwm-card-facts {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin-top: 10px;
    }
    .tgwm-card-fact {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 3px 8px;
      background: var(--tgwm-surface);
      border: 1px solid var(--tgwm-border);
      border-radius: var(--tgwm-radius-sm);
      font-size: 11px;
      font-weight: 500;
      color: var(--tgwm-text-muted);
      white-space: nowrap;
    }
    .tgwm-card-fact svg { width: 12px; height: 12px; opacity: .8; }

    .tgwm-card-cta {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-top: 12px;
      padding-top: 10px;
      border-top: 1px solid var(--tgwm-border);
    }
    .tgwm-card-cta-label {
      font-size: 13px;
      font-weight: 700;
      color: var(--tgwm-pin-anchor-active);
      display: inline-flex;
      align-items: center;
      gap: 4px;
    }
    .tgwm-card-cta-label svg { width: 15px; height: 15px; }
    .tgwm-card-carrier { font-size: 11px; color: var(--tgwm-text-muted); }

    /* Cards panel: prompt / loading / empty / error states */
    .tgwm-ov-cards-state {
      flex: 1 1 auto;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 10px;
      padding: 32px 24px;
      text-align: center;
      color: var(--tgwm-text-muted);
    }
    .tgwm-ov-cards-state[hidden] { display: none !important; }
    .tgwm-ov-cards-state svg { width: 36px; height: 36px; opacity: .5; }
    .tgwm-ov-cards-state p { margin: 0; font-size: 13px; line-height: 1.5; max-width: 34ch; }

    /* Skeleton card shimmer for the loading state */
    .tgwm-skel {
      border: 1px solid var(--tgwm-border);
      border-radius: var(--tgwm-radius-sm);
      overflow: hidden;
      background: var(--tgwm-bg);
    }
    .tgwm-skel-img { width: 100%; height: 168px; }
    .tgwm-skel-line { height: 12px; margin: 10px 12px; border-radius: 4px; }
    .tgwm-skel-img, .tgwm-skel-line {
      background: linear-gradient(90deg, var(--tgwm-surface) 25%, var(--tgwm-border) 37%, var(--tgwm-surface) 63%);
      background-size: 400% 100%;
      animation: tgwm-shimmer 1.4s ease infinite;
    }
    .tgwm-skel-line.short { width: 50%; }
    @keyframes tgwm-shimmer { 0% { background-position: 100% 0; } 100% { background-position: -100% 0; } }
    @media (prefers-reduced-motion: reduce) { .tgwm-skel-img, .tgwm-skel-line { animation: none; } }

    /* ── Responsive: stack on narrow containers (your locked @container rule) ── */
    @container tgwmbody (max-width: 720px) {
      .tgwm-overlay-body { flex-direction: column; }
      .tgwm-ov-cards {
        /* Deals take a fixed ~70% of the height once a destination is tapped;
           the map fills the remaining ~30%. Rigid basis (no grow/shrink) so
           it's a true 70%, not just a cap. The collapsed rule below overrides
           this to zero height before a destination is picked. */
        flex: 0 0 70%;
        max-width: none;
        width: 100%;
        border-right: 0;
        border-top: 1px solid var(--tgwm-border);
        order: 2;            /* map on top, cards below */
        max-height: 70%;
      }
      /* Map fills whatever the deals don't: 100% before a tap (deals
         collapsed), ~30% after (deals at 70%). Must stay flex:1 1 auto so it
         grows back to full-screen when the deals panel is hidden. */
      .tgwm-ov-mapcol { order: 1; flex: 1 1 auto; min-height: 160px; }
      /* Collapsed state, stacked axis. The base collapse rule zeroes WIDTH
         (right for the desktop side-by-side layout), but stacked the main
         axis is vertical — inheriting it here left a zero-width panel still
         flex-growing to half the screen, so the map sat squashed above a
         blank bottom half (the reported mobile bug). Collapse the HEIGHT
         instead and give the width back: the map fills the phone screen
         until a destination is tapped, then the deals take up to 55%. */
      .tgwm-overlay-body[data-cards-hidden] .tgwm-ov-cards {
        flex-grow: 0;
        max-width: none;
        max-height: 0;
        border-top: 0;
      }
    }

    /* Prevent the host page scrolling behind the overlay while it's open.
       Applied to the host <html> element via JS (class added/removed there). */
  `;

  const DEFAULTS = {
    theme: 'light',
    // Author-configurable copy. Left empty so the localised default is used
    // (see makeT / MESSAGES) unless the author sets their own text.
    title: '',
    subtitle: '',
    ctaLabel: '',
    showFullscreenButton: true,
    // Brand colours (editor-driven). Empty = use the built-in navy/teal tokens.
    // accent  → the active/highlight colour (default teal #00B4D8)
    // primary → the structural colour: pin anchors + CTA background (default navy #1B2B5B)
    // Both are validated as #RGB/#RRGGBB before being applied; anything else is ignored.
    accent: '',
    primary: '',
    // Country allow-list (array of ISO country codes, e.g. ['GR','ES']). Empty/absent
    // = show every country with offers (current behaviour). When non-empty, only these
    // countries are pinned. Regions are resolved to country codes in the editor before
    // save, so there is no separate regions key here.
    countries: [],
    // Click handler url — opened in new tab when fullscreen button clicked.
    // Fullscreen overlay (modal on same page) is a future enhancement.
    fullscreenUrl: '',
    // Origin airport code shown in pin context, also used for fullscreen link.
    origin: 'LGW',
    // How many top destinations to show in envelope mode. World view gets crowded fast.
    maxPins: 10,
    // Optional per-widget MapTiler key override. Leave empty to use the shared key.
    mapKey: '',
    // Display currency. Prices are cached in GBP and converted at render time to
    // this currency. showCurrencySwitcher adds a picker in the fullscreen overlay
    // so a visitor can change it themselves (mirrors the Travel Offers widget).
    displayCurrency: 'GBP',
    showCurrencySwitcher: false,
  };

  // ── Widget class

  class TGWorldMapWidget {
    constructor(container, config) {
      if (!container) return;
      this.host = container;
      this.widgetId = (config && config.widgetId) || (container.getAttribute && container.getAttribute('data-tg-id')) || '';
      this.cfg = Object.assign({}, DEFAULTS, config || {});
      // Display currency state. Prices are cached GBP, converted at render time;
      // rates load in _init (fallback table used until they arrive).
      this.cur = { code: (this.cfg.displayCurrency || 'GBP'), rates: { GBP: 1 } };
      setActiveCur(this.cur);
      this.t = makeT(this.cfg);   // resolve viewer language + UI strings
      this.shadow = container.attachShadow({ mode: 'open' });
      this.data = null;
      this.map = null;
      this.markers = [];
      // Fullscreen overlay state
      this.overlayEl = null;
      this._overlayOpen = false;
      this._activeCountry = null;
      this._lastFocus = null;
      this._onKeydown = null;
      this._prevHtmlOverflow = '';
      // Overlay (big) map state
      this.ovMap = null;
      this.ovMarkers = [];
      this._ovMapHeightRetried = false;
      this._ovHasView = false;
      this._dealsToken = 0;
      // Resort drill-down state
      this._pinMode = 'country';
      this._resortMarkers = [];
      this._depLayers = [];
      this._activeResort = null;
      this._dealsCache = null;
      this._resortSummary = null; // full resort list from the resorts endpoint
      this._resortToken = 0;
      this._activeResortAirportName = null;
      this._resortDealsToken = 0;
      // Filter state (in-country): max budget pp + min star rating.
      this._filterMaxPrice = null;  // null = Any
      this._filterMinRating = null; // null = Any
      // Region selector state (world map). null = Worldwide (cluster view).
      this._activeRegion = null;
      this._render();
      this._init();
    }

    async _init() {
      try {
        // With the switcher on we fetch the whole set so a visitor's change is
        // instant; otherwise just the configured display currency. loadFxRates
        // never rejects, so it can't fail the map init.
        const need = this.cfg.showCurrencySwitcher ? CURRENCY_ORDER.slice() : [this.cur.code];
        const [L, offers, rates] = await Promise.all([
          loadLeaflet(),
          this._loadOffers(),
          loadFxRates(need),
        ]);
        this.cur.rates = rates || { GBP: 1 };
        setActiveCur(this.cur);
        this.data = this._applyCountryAllowList(offers);
        this._renderMap(L);
        this._hideLoading();
        tgReport('load', this.widgetId, 'ok');
      } catch (e) {
        console.warn('[tgwm v3] init failed:', e.message);
        this._showError(this.t('mapUnavailable'));
        tgReport('error', this.widgetId, 'map init failed', e && e.message);
      }
    }

    /** If the config carries a non-empty countries allow-list, keep only those
     *  countries in the summary. Done once here so every downstream consumer
     *  (compact pins, overlay pins, edge arrows, region pills) is filtered
     *  consistently. Empty/absent list = show everything (current behaviour). */
    _applyCountryAllowList(offers) {
      const allow = Array.isArray(this.cfg.countries)
        ? this.cfg.countries.map(x => String(x || '').toUpperCase().trim()).filter(Boolean)
        : [];
      if (!allow.length || !offers || !Array.isArray(offers.countries)) return offers;
      const set = new Set(allow);
      const filtered = offers.countries.filter(c => set.has(String(c.countryCode || '').toUpperCase()));
      // Return a shallow copy so we never mutate the fetched object.
      return Object.assign({}, offers, { countries: filtered });
    }

    async _loadOffers() {
      const res = await fetch(OFFERS_URL, { credentials: 'omit' });
      if (!res.ok) throw new Error('offers HTTP ' + res.status);
      return await res.json();
    }

    _render() {
      const c = this.cfg;
      const t = this.t;
      const brand = brandStyleAttr(c);
      const html = `
        <style>${LEAFLET_CSS}${STYLES}</style>
        <div class="tgwm-root" data-theme="${esc(c.theme)}"${brand ? ` style="${brand}"` : ''}>
          <div class="tgwm-header">
            <h2 class="tgwm-title">${esc(c.title || t('title'))}</h2>
            <p class="tgwm-subtitle">${esc(c.subtitle || t('subtitle'))}</p>
          </div>
          <div class="tgwm-map-wrap">
            <div class="tgwm-map" data-map></div>
            <div class="tgwm-loading" data-loading>
              <div class="tgwm-spinner" aria-hidden="true"></div>
              <span data-loading-text>${esc(t('loadingMap'))}</span>
            </div>
            <button class="tgwm-fs-btn" data-fs-btn aria-label="${esc(t('viewMapFullscreen'))}">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="15 3 21 3 21 9"/>
                <polyline points="9 21 3 21 3 15"/>
                <line x1="21" y1="3" x2="14" y2="10"/>
                <line x1="3" y1="21" x2="10" y2="14"/>
              </svg>
              <span>${esc(c.ctaLabel || t('viewFullscreen'))}</span>
            </button>
          </div>
        </div>
      `;
      this.shadow.innerHTML = html;
      this._bind();
    }

    _bind() {
      const fsBtn = this.shadow.querySelector('[data-fs-btn]');
      if (fsBtn) {
        fsBtn.addEventListener('click', () => {
          // Button open = "explore everything" → world view, not last country.
          this._activeCountry = null;
          this._openFullscreen();
        });
      }
    }

    _openFullscreen() {
      // Backwards-compatible escape hatch: if a widget has fullscreenUrl set,
      // honour the old behaviour and open it in a new tab. Otherwise open the
      // in-page overlay (the default from v3.3.0 onwards).
      const url = this.cfg.fullscreenUrl;
      if (url) {
        const safe = safeUrl(url);
        if (safe !== '#') window.open(safe, '_blank', 'noopener');
        return;
      }
      this._showOverlay();
    }

    /** Build (once) and reveal the fullscreen overlay. */
    _showOverlay() {
      if (this._overlayOpen) return;
      // Remember what had focus so we can restore it on close (a11y).
      this._lastFocus = (this.shadow.activeElement) || document.activeElement || null;

      if (!this.overlayEl) this._buildOverlay();

      // Lock host-page scroll. Store the prior inline value so we restore
      // exactly what was there (don't clobber a host that set its own).
      const root = document.documentElement;
      this._prevHtmlOverflow = root.style.overflow;
      root.style.overflow = 'hidden';

      this._overlayOpen = true;
      this._ovMapHeightRetried = false;
      this.overlayEl.hidden = false;
      // Force a reflow so the transition runs from the hidden state.
      // eslint-disable-next-line no-unused-expressions
      this.overlayEl.offsetHeight;
      this.overlayEl.classList.add('is-open');

      // Wire global key handling (Escape + focus trap) while open.
      this._onKeydown = (e) => this._handleOverlayKeydown(e);
      this.shadow.addEventListener('keydown', this._onKeydown, true);

      // Move focus into the overlay (close button is a safe first stop).
      const closeBtn = this.overlayEl.querySelector('[data-ov-close]');
      if (closeBtn) closeBtn.focus();

      // Init or refresh the big map once the overlay is actually visible.
      // Leaflet needs a sized, visible container to render tiles correctly, so
      // we defer to the end of the open transition. If the map already exists
      // (a later open), just invalidate its size and re-fit.
      const startMap = () => {
        if (!this._overlayOpen) return; // closed again before we got here
        const L = window.L;
        if (!L) {
          // Leaflet not yet present (small map hadn't loaded it) — load then retry.
          loadLeaflet().then(() => { if (this._overlayOpen) this._renderOverlayMap(window.L); })
            .catch(() => this._overlayMapError());
          return;
        }
        if (this.ovMap) {
          this.ovMap.invalidateSize(false);
          this._fitOverlayMap();
          this._thinOverlayPins();
          this._hideOverlayLoading();
        } else {
          this._renderOverlayMap(L);
        }
      };
      const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (reduce) {
        startMap();
      } else {
        // Run after the 240ms open transition; rAF nudge guards against engines
        // that don't fire it reliably for transform/opacity.
        let ran = false;
        const once = () => { if (ran) return; ran = true; this.overlayEl.removeEventListener('transitionend', onOpenEnd); startMap(); };
        const onOpenEnd = (e) => { if (e.target === this.overlayEl && e.propertyName === 'opacity') once(); };
        this.overlayEl.addEventListener('transitionend', onOpenEnd);
        setTimeout(once, 300);
      }
    }

    _overlayMapError() {
      this._hideOverlayLoading();
      const empty = this.overlayEl && this.overlayEl.querySelector('[data-ov-empty]');
      const col = this.overlayEl && this.overlayEl.querySelector('[data-ov-mapcol]');
      if (empty) { empty.hidden = false; empty.querySelector('p').textContent = this.t('mapUnavailable'); }
      if (col) col.hidden = true;
    }

    /** Hide the overlay, restore scroll + focus. Does not destroy the DOM —
     *  it's reused on next open (cheaper, and piece 2's map can persist). */
    _closeOverlay() {
      if (!this._overlayOpen || !this.overlayEl) return;
      this._overlayOpen = false;

      this.overlayEl.classList.remove('is-open');

      // Restore host-page scroll.
      document.documentElement.style.overflow = this._prevHtmlOverflow || '';

      // Detach key handler.
      if (this._onKeydown) {
        this.shadow.removeEventListener('keydown', this._onKeydown, true);
        this._onKeydown = null;
      }

      // Hide after the exit transition (or immediately under reduced motion).
      // Guard against a re-open during the transition: only apply hidden if the
      // overlay is still closed when the timer/event fires.
      const finish = () => { if (this.overlayEl && !this._overlayOpen) this.overlayEl.hidden = true; };
      const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (reduce) {
        finish();
      } else {
        let done = false;
        const onEnd = (e) => {
          if (e.target !== this.overlayEl || e.propertyName !== 'opacity') return;
          done = true;
          this.overlayEl.removeEventListener('transitionend', onEnd);
          finish();
        };
        this.overlayEl.addEventListener('transitionend', onEnd);
        // Safety net in case transitionend doesn't fire.
        setTimeout(() => { if (!done) { this.overlayEl && this.overlayEl.removeEventListener('transitionend', onEnd); finish(); } }, 360);
      }

      // Return focus to whatever triggered the open.
      if (this._lastFocus && typeof this._lastFocus.focus === 'function') {
        try { this._lastFocus.focus(); } catch (_) {}
      }
      this._lastFocus = null;
    }

    /** Construct the overlay DOM inside the Shadow root (built once, reused). */
    _buildOverlay() {
      const c = this.cfg;
      const t = this.t;
      const wrap = document.createElement('div');
      wrap.className = 'tgwm-overlay';
      wrap.setAttribute('role', 'dialog');
      wrap.setAttribute('aria-modal', 'true');
      wrap.setAttribute('aria-label', (c.title || t('destinationMap')) + ' — ' + t('fullscreenSuffix'));
      wrap.setAttribute('data-theme', esc(c.theme));
      // Brand colour overrides (validated hex only) — mirror the compact root so
      // the fullscreen overlay carries the agency's accent/primary too.
      const _accent = safeHex(c.accent), _primary = safeHex(c.primary);
      if (_accent) wrap.style.setProperty('--tgwm-pin-anchor-active', _accent);
      if (_primary) { wrap.style.setProperty('--tgwm-pin-anchor', _primary); wrap.style.setProperty('--tgwm-cta-bg', _primary); }
      wrap.hidden = true;
      wrap.innerHTML = `
        <div class="tgwm-overlay-backdrop" data-ov-backdrop></div>
        <header class="tgwm-overlay-header">
          <div class="tgwm-overlay-titles">
            <h2 class="tgwm-overlay-title">${esc(c.title || t('title'))}</h2>
            <p class="tgwm-overlay-sub">${esc(c.subtitle || t('subtitle'))}</p>
          </div>
          ${c.showCurrencySwitcher ? `<label class="tgwm-ov-cur" aria-label="Display currency">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
            <select data-ov-cur>${CURRENCY_ORDER.map((cc) => `<option value="${cc}"${cc === (this.cur.code || 'GBP') ? ' selected' : ''}>${cc}</option>`).join('')}</select>
          </label>` : ''}
          <button class="tgwm-overlay-close" data-ov-close type="button" aria-label="${esc(t('closeFullscreen'))}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <line x1="18" y1="6" x2="6" y2="18"/>
              <line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </header>
        <div class="tgwm-overlay-body" data-ov-body data-cards-hidden>
          <aside class="tgwm-ov-cards" data-ov-cards>
            <div class="tgwm-ov-cards-head">
              <h3 class="tgwm-ov-cards-title" data-ov-cards-title>${esc(t('latestDeals'))}</h3>
              <p class="tgwm-ov-cards-meta" data-ov-cards-meta>${esc(t('tapDestination'))}</p>
              <div class="tgwm-ov-filters" data-ov-filters hidden>
                <div class="tgwm-filter-group" data-ov-filter-rating>
                  <span class="tgwm-filter-label">${esc(t('rating'))}</span>
                  <div class="tgwm-seg" role="group" aria-label="${esc(t('filterByRating'))}" data-ov-rating-seg></div>
                </div>
                <div class="tgwm-filter-group" data-ov-filter-budget>
                  <span class="tgwm-filter-label">${esc(t('maxBudget'))}</span>
                  <div class="tgwm-seg" role="group" aria-label="${esc(t('filterByBudget'))}" data-ov-budget-seg></div>
                </div>
              </div>
            </div>
            <div class="tgwm-ov-cards-scroll" data-ov-cards-scroll>
              <div class="tgwm-ov-cards-state" data-ov-cards-prompt>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/>
                  <circle cx="12" cy="10" r="3"/>
                </svg>
                <p>${esc(t('pickDestination'))}</p>
              </div>
            </div>
          </aside>
          <div class="tgwm-ov-mapcol" data-ov-mapcol>
            <div class="tgwm-ov-map" data-ov-map></div>
            <div class="tgwm-ov-edges" data-ov-edges aria-hidden="true"></div>
            <div class="tgwm-ov-regions" data-ov-regions role="group" aria-label="${esc(t('filterByRegion'))}" hidden></div>
            <div class="tgwm-ov-loading" data-ov-loading>
              <div class="tgwm-spinner" aria-hidden="true"></div>
              <span>${esc(t('loadingMap'))}</span>
            </div>
          </div>
          <div class="tgwm-overlay-empty" data-ov-empty hidden>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="10"/>
              <line x1="2" y1="12" x2="22" y2="12"/>
              <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
            </svg>
            <p>${esc(t('noDestinations'))}</p>
          </div>
        </div>
      `;

      // Close affordances: button, backdrop click.
      wrap.querySelector('[data-ov-close]').addEventListener('click', () => this._closeOverlay());
      wrap.querySelector('[data-ov-backdrop]').addEventListener('click', () => this._closeOverlay());

      // Currency switcher (fullscreen overlay only, opt-in via showCurrencySwitcher).
      // Repaint the open country's cards + resort pins in the new currency. Off by
      // default, so it never affects a client who has not enabled it.
      const curSel = wrap.querySelector('[data-ov-cur]');
      if (curSel) curSel.addEventListener('change', () => {
        try {
          const code = curSel.value;
          if (!CURRENCIES[code]) return;
          this.cur.code = code;
          setActiveCur(this.cur);
          if (this._dealsCache) this._onFilterChange();
        } catch (e) { /* a currency change must never break the overlay */ }
      });

      this.shadow.querySelector('.tgwm-root').appendChild(wrap);
      this.overlayEl = wrap;
    }

    /** Escape to close + Tab focus trap, scoped to the overlay while open. */
    _handleOverlayKeydown(e) {
      if (!this._overlayOpen) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        this._closeOverlay();
        return;
      }
      if (e.key !== 'Tab') return;

      const focusables = this.overlayEl.querySelectorAll(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      if (!focusables.length) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = this.shadow.activeElement;

      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    }

    /** Build the interactive overlay map (once) and drop all pins. Leaflet must
     *  init while the container has a real size, so this is called after the
     *  open transition (see _showOverlay). On later opens we just re-fit. */
    _renderOverlayMap(L) {
      const mapEl = this.overlayEl && this.overlayEl.querySelector('[data-ov-map]');
      if (!mapEl) return;

      const countries = (this.data && Array.isArray(this.data.countries))
        ? this.data.countries.filter(c => typeof c.lat === 'number' && typeof c.lng === 'number')
        : [];

      // No data → show the empty fallback, hide the loading veil, bail.
      if (!countries.length) {
        this._hideOverlayLoading();
        const empty = this.overlayEl.querySelector('[data-ov-empty]');
        const col = this.overlayEl.querySelector('[data-ov-mapcol]');
        if (empty) empty.hidden = false;
        if (col) col.hidden = true;
        return;
      }

      // Guard: if the container has no height yet (CSS height chain not resolved),
      // Leaflet would init into a 0px box and never render. Retry shortly.
      if (mapEl.clientHeight < 40 && !this._ovMapHeightRetried) {
        this._ovMapHeightRetried = true;
        console.warn('[tgwm v3] overlay map container height', mapEl.clientHeight, '— retrying init');
        setTimeout(() => { if (this._overlayOpen) this._renderOverlayMap(L); }, 120);
        return;
      }

      try {
        // Build the map once.
        if (!this.ovMap) {
          this.ovMap = L.map(mapEl, {
            zoomControl: true,
            scrollWheelZoom: true,
            doubleClickZoom: true,
            dragging: true,
            worldCopyJump: true,
            minZoom: 2,
            maxZoom: 12,
            attributionControl: true,
          });
          this.ovMap.zoomControl.setPosition('topright');

          const mapKey = this.cfg.mapKey || MAPTILER_KEY;
          const tileUrl = TILE_TEMPLATE + encodeURIComponent(mapKey);
          L.tileLayer(tileUrl, {
            attribution: TILE_ATTRIBUTION,
            maxZoom: 19,
            crossOrigin: true,
          }).addTo(this.ovMap);

          // Build a marker per country, paired with its data, sorted cheapest
          // first so the thinning pass always keeps the best-value pin when two
          // would collide. Markers are all added once; visibility is then driven
          // by _thinOverlayPins() on every zoom/move (Google-Flights style).
          const priceOf = c => c.fromPricePP || c.fromPrice || Infinity;
          const sorted = countries.slice().sort((a, b) => priceOf(a) - priceOf(b));

          this.ovMarkers = [];
          for (const c of sorted) {
            const name = resolveCountryName(c, this.t);
            const priceLabel = formatPrice(c.fromPricePP || c.fromPrice, c.currency);
            const html = `
              <div class="tg-pin-wrap" data-country="${esc(name)}">
                <div class="tg-price-tag" title="${esc(name)} — ${esc(this.t('from'))} ${esc(priceLabel)} ${esc(this.t('perPerson'))}">
                  <span class="tg-tag-country">${esc(name)}</span>
                  <span class="tg-tag-price">${esc(priceLabel)}</span>
                </div>
                <div class="tg-price-anchor"></div>
              </div>
            `;
            const marker = L.marker([c.lat, c.lng], {
              icon: L.divIcon({ html, className: '', iconSize: [0, 0], iconAnchor: [0, 0] }),
              keyboard: false,
              interactive: true,
              riseOnHover: true,
            });
            marker.on('click', () => this._onOverlayPinClick(c));
            marker.addTo(this.ovMap);
            // Pair the country with its marker for the thinning pass.
            this.ovMarkers.push({ country: c, marker });
          }

          // Re-thin pins whenever the view changes. moveend covers pan + zoom.
          this.ovMap.on('moveend', () => this._onOverlayMapMove());
        }

        // Leaflet sized itself before the overlay finished animating in some
        // engines — recompute now that it's visible, then fit the view.
        this.ovMap.invalidateSize(false);
        this._fitOverlayMap();
        this._thinOverlayPins();
        this._buildRegionPills();
        this._hideOverlayLoading();
      } catch (err) {
        console.error('[tgwm v3] overlay map init failed:', err);
        this._overlayMapError();
      }
    }

    /** Thin-and-reveal: show a pin only if it doesn't collide (in screen pixels
     *  at the current zoom) with an already-shown, cheaper pin. Walks the
     *  price-sorted marker list so the best-value pin always wins a collision.
     *  Re-runs on every zoom/pan, so zooming into a dense region reveals more
     *  pins as they stop overlapping — the Google Flights behaviour. */
    _thinOverlayPins() {
      if (!this.ovMap || !Array.isArray(this.ovMarkers) || !this.ovMarkers.length) return;

      // Collision footprint of a price tag in screen pixels. Tightened so close
      // neighbours (e.g. Portugal next to Spain) survive at world zoom rather
      // than the whole region collapsing to one pin; the rest reveal on zoom-in.
      const PAD_X = 38; // horizontal clearance
      const PAD_Y = 20; // vertical clearance
      const map = this.ovMap;
      const shownPts = [];

      for (const entry of this.ovMarkers) {
        const c = entry.country;
        const el = entry.marker.getElement();
        if (!el) continue; // not yet in DOM

        let pt;
        try { pt = map.latLngToContainerPoint([c.lat, c.lng]); }
        catch (_) { continue; }

        // The active (selected) country is always shown, even if it would collide.
        const isActive = this._activeCountry &&
          this._activeCountry.countryCode === c.countryCode &&
          this._activeCountry.lat === c.lat;

        const collides = !isActive && shownPts.some(p =>
          Math.abs(p.x - pt.x) < PAD_X && Math.abs(p.y - pt.y) < PAD_Y
        );

        if (collides) {
          el.style.display = 'none';
        } else {
          el.style.display = '';
          shownPts.push(pt);
        }
      }
    }

    /** Build resort-level pins for the active country. Accepts EITHER raw offers
     *  (resortLat/resortLng + pricePP) OR pre-aggregated resort summaries
     *  (lat/lng + fromPricePP) from the resorts endpoint, so it works whichever
     *  source fed it. Switches the map into resort mode and drops the markers. */
    _buildResortPins(items, fitToResorts) {
      setActiveCur(this.cur);
      if (!this.ovMap || !Array.isArray(items)) return;

      // Distinct resorts → cheapest. Tolerate both shapes:
      //   offer:           { resort, resortLat, resortLng, pricePP|price }
      //   resort summary:  { resort, lat, lng, fromPricePP|fromPrice }
      const byResort = new Map();
      for (const o of items) {
        const r = o.resort;
        const lat = (typeof o.resortLat === 'number') ? o.resortLat : o.lat;
        const lng = (typeof o.resortLng === 'number') ? o.resortLng : o.lng;
        if (!r || typeof lat !== 'number' || typeof lng !== 'number') continue;
        const pp = o.pricePP || o.fromPricePP || o.price || o.fromPrice || Infinity;
        const cur = byResort.get(r);
        if (!cur || pp < cur.pp) byResort.set(r, {
          resort: r, lat, lng, pp, currency: o.currency,
          // Carry the gateway through so a pin click can fetch this resort's
          // deals by airport (resort summaries have it; raw offers have it too).
          airport: o.airport || null,
          airportName: o.airportName || null,
        });
      }

      this._clearResortPins();
      this._resortMarkers = [];
      const L = window.L;
      if (!L) return;

      const latlngs = [];
      for (const r of byResort.values()) {
        const priceLabel = formatPrice(r.pp, r.currency);
        const active = this._activeResort === r.resort;
        const html = `
          <div class="tg-pin-wrap${active ? ' is-active' : ''}" data-resort="${esc(r.resort)}">
            <div class="tg-price-tag" title="${esc(r.resort)} — ${esc(this.t('from'))} ${esc(priceLabel)} ${esc(this.t('perPerson'))}">
              <span class="tg-tag-country">${esc(r.resort)}</span>
              <span class="tg-tag-price">${esc(priceLabel)}</span>
            </div>
            <div class="tg-price-anchor"></div>
          </div>`;
        const marker = L.marker([r.lat, r.lng], {
          icon: L.divIcon({ html, className: '', iconSize: [0, 0], iconAnchor: [0, 0] }),
          keyboard: false, interactive: true, riseOnHover: true,
        });
        marker.on('click', () => this._onResortPinClick(r));
        marker.addTo(this.ovMap);
        this._resortMarkers.push({ resort: r, marker });
        latlngs.push([r.lat, r.lng]);
      }

      // Switch to resort mode: hide country pins.
      this._pinMode = 'resort';
      this._setCountryPinsVisible(false);
      this._clearEdgeArrows();
      const regionBar = this.overlayEl && this.overlayEl.querySelector('[data-ov-regions]');
      if (regionBar) regionBar.hidden = true;

      // On initial entry, frame the actual spread of resorts rather than flying
      // to one fixed point — so a country like Portugal (Porto far north,
      // Algarve south) shows its resorts filling the view, not two lone pins.
      if (fitToResorts && latlngs.length) {
        try {
          if (latlngs.length === 1) {
            this.ovMap.setView(latlngs[0], 8);
          } else {
            const bounds = L.latLngBounds(latlngs);
            this.ovMap.fitBounds(bounds, { padding: [60, 60], maxZoom: 9, animate: true, duration: 0.6 });
          }
          this._ovHasView = true;
        } catch (_) {}
      }
      // fitBounds fires moveend → thinning runs automatically. If we didn't fit
      // (e.g. an active-resort rebuild), thin now so pins still de-clutter.
      if (!fitToResorts) this._thinResortPins();
    }

    /** Fetch the COMPLETE resort list for a country and pin every resort. Falls
     *  back to deriving resorts from the (capped) deals offers if the resorts
     *  endpoint is unavailable or empty — so the map still works during rollout.
     *  Token-guarded so a slower response for a previous country can't overwrite
     *  pins for the one now selected. */
    _loadResortPins(cc, fitToResorts) {
      // Drop any previous country's full list so it can't pin the wrong place
      // during the fetch window.
      this._resortSummary = null;
      // Immediate pins from whatever deals we already hold, so there's no blank
      // gap while the fuller list loads.
      if (this._dealsCache && Array.isArray(this._dealsCache.offers)) {
        this._buildResortPins(this._applyFilters(this._dealsCache.offers), fitToResorts);
      }
      if (!cc) return;
      const token = (this._resortToken = (this._resortToken || 0) + 1);
      fetch(RESORTS_URL + '?country=' + encodeURIComponent(cc), { credentials: 'omit' })
        .then(r => r.ok ? r.json() : Promise.reject(new Error('resorts HTTP ' + r.status)))
        .then(data => {
          if (token !== this._resortToken) return;          // superseded
          if (this._pinMode !== 'resort') return;            // left resort mode
          const resorts = (data && Array.isArray(data.resorts)) ? data.resorts : [];
          if (!resorts.length) return;                       // keep the deals-derived pins
          this._resortSummary = resorts;
          // Rebuild from the full list. Don't re-fit here — the initial fit
          // already happened from the deals-derived pins; refitting would yank.
          this._buildResortPins(resorts, false);
        })
        .catch(() => { /* keep deals-derived pins */ });
    }

    /** Draw Google-Flights-style routes from the UK departure airport(s) that
     *  serve this destination to the destination centroid, plus a pin at each
     *  departure airport. Shown only in drill-down (a destination is selected),
     *  so the overview stays clean. Caps to the busiest few origins to avoid a
     *  spider-web. Safe to call repeatedly — clears previous routes first. */
    _drawDepartureRoutes(country, offers) {
      const L = window.L;
      if (!L || !this.ovMap || !country) return;
      if (typeof country.lat !== 'number' || typeof country.lng !== 'number') return;
      this._clearDepartureRoutes();

      // Count offers per UK origin we have coordinates for; keep the top few.
      const counts = new Map();
      for (const o of (offers || [])) {
        const code = (o.origin || '').toUpperCase();
        if (UK_AIRPORTS[code]) counts.set(code, (counts.get(code) || 0) + 1);
      }
      if (!counts.size) return; // no known UK origins → draw nothing
      const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(e => e[0]);

      const dest = [country.lat, country.lng];
      const accent = (this.cfg && safeHex(this.cfg.accent)) || '#00B4D8';
      this._depLayers = this._depLayers || [];

      for (const code of top) {
        const ap = UK_AIRPORTS[code];
        const from = [ap.lat, ap.lng];
        // A gentle two-segment arc via a lifted midpoint reads as a flight path
        // (Leaflet polylines are straight lines; a curved control point fakes it).
        const midLat = (from[0] + dest[0]) / 2;
        const midLng = (from[1] + dest[1]) / 2;
        const lift = Math.max(2, Math.abs(from[0] - dest[0]) * 0.18); // arc height ~ distance
        const arc = this._arcPoints(from, dest, lift);
        const line = L.polyline(arc, {
          color: accent, weight: 2, opacity: 0.7, dashArray: '5 6',
          lineCap: 'round', interactive: false,
        }).addTo(this.ovMap);
        this._depLayers.push(line);

        // Departure pin (divIcon) at the airport.
        const html = '<div class="tgwm-dep-wrap"><span class="tgwm-dep-pin">'
          + '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M21 16v-2l-8-5V3.5a1.5 1.5 0 0 0-3 0V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L12 19v-5.5z"/></svg>'
          + '<span class="tgwm-dep-label">' + esc(code) + '</span></span></div>';
        const marker = L.marker(from, {
          icon: L.divIcon({ html, className: '', iconSize: [0, 0], iconAnchor: [0, 0] }),
          keyboard: false, interactive: false, zIndexOffset: -200,
        }).addTo(this.ovMap);
        this._depLayers.push(marker);
      }
    }

    /** Build a smooth-ish arc as a points array between two latlngs, lifting the
     *  midpoint by `lift` degrees so a straight polyline reads as a flight curve. */
    _arcPoints(from, to, lift) {
      const steps = 24;
      const pts = [];
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const lat = from[0] + (to[0] - from[0]) * t;
        const lng = from[1] + (to[1] - from[1]) * t;
        // Parabolic lift, peaking at the midpoint, applied to latitude.
        const lifted = lat + lift * Math.sin(Math.PI * t);
        pts.push([lifted, lng]);
      }
      return pts;
    }

    _clearDepartureRoutes() {
      if (Array.isArray(this._depLayers)) {
        for (const layer of this._depLayers) {
          try { this.ovMap.removeLayer(layer); } catch (_) {}
        }
      }
      this._depLayers = [];
    }

    _clearResortPins() {
      if (Array.isArray(this._resortMarkers)) {
        for (const e of this._resortMarkers) {
          try { this.ovMap.removeLayer(e.marker); } catch (_) {}
        }
      }
      this._resortMarkers = [];
    }

    /** Which items to build resort pins from on a rebuild (click/filter change):
     *  - no in-country filter active → the FULL resort summary (every resort);
     *  - a filter active → deals-derived resorts, which carry the per-offer
     *    detail (rating/price) needed to filter accurately. The summary only
     *    holds each resort's cheapest price, so it can't honour a rating filter. */
    _resortPinSource() {
      const filtering = (this._filterMaxPrice != null || this._filterMinRating != null);
      if (!filtering && Array.isArray(this._resortSummary) && this._resortSummary.length) {
        return this._resortSummary;
      }
      return this._dealsCache ? this._applyFilters(this._dealsCache.offers) : [];
    }

    _setCountryPinsVisible(visible) {
      if (!Array.isArray(this.ovMarkers)) return;
      for (const entry of this.ovMarkers) {
        const el = entry.marker.getElement();
        if (el) el.style.display = visible ? '' : 'none';
      }
    }

    _onResortPinClick(r) {
      this._activeResort = r.resort;
      // Zoom in tight to the resort (town level) so the click clearly drills in,
      // not just a gentle nudge. flyTo is safe — a view always exists by now.
      if (this.ovMap) {
        const targetZoom = Math.max(this.ovMap.getZoom(), 11);
        this.ovMap.flyTo([r.lat, r.lng], targetZoom, { duration: 0.7 });
      }
      // Pass the whole resort object so the card loader can fetch this resort's
      // real deals by airport when they're outside the country's cheapest slice.
      this._filterCardsByResort(r);
      // Re-render resort pins so the clicked one shows as active. Uses the full
      // resort set when unfiltered, deals-derived when a filter is active.
      this._buildResortPins(this._resortPinSource());
    }

    /** Thin resort pins the same way as country pins (pixel collision). */
    _thinResortPins() {
      if (!this.ovMap || !Array.isArray(this._resortMarkers) || !this._resortMarkers.length) return;
      // Compact pins → tighter collision footprint, so tightly-clustered
      // resorts (e.g. the Algarve strip) surface more pins at the same zoom.
      const PAD_X = 26, PAD_Y = 16;
      const map = this.ovMap;
      const shownPts = [];
      // Active resort first so it always survives a collision.
      const ordered = this._resortMarkers.slice().sort((a, b) => {
        const aa = this._activeResort === a.resort.resort ? -1 : 0;
        const bb = this._activeResort === b.resort.resort ? -1 : 0;
        return aa - bb || (a.resort.pp - b.resort.pp);
      });
      for (const entry of ordered) {
        const el = entry.marker.getElement();
        if (!el) continue;
        let pt;
        try { pt = map.latLngToContainerPoint([entry.resort.lat, entry.resort.lng]); }
        catch (_) { continue; }
        const isActive = this._activeResort === entry.resort.resort;
        const collides = !isActive && shownPts.some(p =>
          Math.abs(p.x - pt.x) < PAD_X && Math.abs(p.y - pt.y) < PAD_Y);
        if (collides) { el.style.display = 'none'; }
        else { el.style.display = ''; shownPts.push(pt); }
      }
    }

    /** Return to country mode: clear resort pins, show country pins, re-thin. */
    _exitResortMode() {
      this._clearResortPins();
      this._clearDepartureRoutes();
      this._pinMode = 'country';
      this._activeResort = null;
      this._dealsCache = null;
      this._resortSummary = null;
      this._setCountryPinsVisible(true);
      this._thinOverlayPins();
      this._renderEdgeArrows();
      this._buildRegionPills();
    }

    // Zoom at/above this shows resort pins; below it, country pins.
    // Country fly-to lands at z5, so the threshold sits just under it.
    static get RESORT_ZOOM() { return 5; }

    /** moveend handler: keep pins thinned, and switch between country/resort
     *  modes based on zoom. Zoom out far enough → back to country pins. */
    _onOverlayMapMove() {
      if (!this.ovMap) return;
      const z = this.ovMap.getZoom();
      if (this._pinMode === 'resort') {
        if (z < TGWorldMapWidget.RESORT_ZOOM) {
          // Zoomed back out — leave resort mode, reset the cards panel.
          this._exitResortMode();
          this._resetCardsPanel();
        } else {
          this._thinResortPins();
        }
        this._clearEdgeArrows(); // no edge arrows while drilled into one country
      } else {
        this._thinOverlayPins();
        this._renderEdgeArrows();
      }
    }

    /** Draw chips at the viewport edges pointing toward country deals that are
     *  currently off-screen, each showing the cheapest price in that direction.
     *  Click flies the map to that country. Country mode only. */
    _renderEdgeArrows() {
      const layer = this.overlayEl && this.overlayEl.querySelector('[data-ov-edges]');
      if (!layer || !this.ovMap || !Array.isArray(this.ovMarkers)) return;
      this._clearEdgeArrows();

      const map = this.ovMap;
      const size = map.getSize();          // {x,y} pixels
      const W = size.x, H = size.y;
      if (!W || !H) return;
      const bounds = map.getBounds();
      const cx = W / 2, cy = H / 2;
      const MARGIN = 14;                   // inset from the very edge
      const MAX_CHIPS = 5;                 // cheapest few only

      // Off-screen countries, cheapest first.
      const off = this.ovMarkers
        .map(m => m.country)
        .filter(c => c && typeof c.lat === 'number' && typeof c.lng === 'number')
        .filter(c => !bounds.contains([c.lat, c.lng]))
        .sort((a, b) => (a.fromPricePP || a.fromPrice || Infinity) - (b.fromPricePP || b.fromPrice || Infinity))
        .slice(0, MAX_CHIPS);

      if (!off.length) return;

      const placed = [];
      for (const c of off) {
        let p;
        try { p = map.latLngToContainerPoint([c.lat, c.lng]); }
        catch (_) { continue; }

        // Direction from centre to the off-screen pin.
        let dx = p.x - cx, dy = p.y - cy;
        if (dx === 0 && dy === 0) continue;

        // Find where that ray exits the padded viewport rectangle.
        const halfW = cx - MARGIN, halfH = cy - MARGIN;
        const scale = Math.min(
          halfW / Math.abs(dx || 1e-6),
          halfH / Math.abs(dy || 1e-6)
        );
        let ex = cx + dx * scale;
        let ey = cy + dy * scale;
        ex = Math.max(MARGIN, Math.min(W - MARGIN, ex));
        ey = Math.max(MARGIN, Math.min(H - MARGIN, ey));

        // De-clutter: skip if within ~28px of an already-placed chip.
        if (placed.some(q => Math.abs(q.x - ex) < 28 && Math.abs(q.y - ey) < 28)) continue;
        placed.push({ x: ex, y: ey });

        // Which way does the arrow point? Dominant axis of travel.
        const horiz = Math.abs(dx) > Math.abs(dy);
        const dir = horiz ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up');
        // Which viewport edge the chip pins to (so it can be pushed inward).
        const edge = horiz ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'bottom' : 'top');
        layer.appendChild(this._edgeChip(c, ex, ey, dir, edge));
      }
    }

    _edgeChip(country, x, y, dir, edge) {
      const name = resolveCountryName(country, this.t);
      const price = formatPrice(country.fromPricePP || country.fromPrice, country.currency);
      const ARROWS = {
        left:  '<polyline points="15 18 9 12 15 6"/>',
        right: '<polyline points="9 18 15 12 9 6"/>',
        up:    '<polyline points="18 15 12 9 6 15"/>',
        down:  '<polyline points="6 9 12 15 18 9"/>',
      };
      const arrow = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ARROWS[dir] || ARROWS.right}</svg>`;
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'tgwm-edge-chip';
      chip.style.left = x + 'px';
      chip.style.top = y + 'px';
      // Pin the chip's OUTER edge to the anchor and grow inward, so the whole
      // chip (label + arrow) stays inside the map and never clips.
      const T = {
        left:   'translate(0, -50%)',
        right:  'translate(-100%, -50%)',
        top:    'translate(-50%, 0)',
        bottom: 'translate(-50%, -100%)',
      };
      chip.style.transform = T[edge] || 'translate(-50%, -50%)';
      chip.title = name + ' — ' + this.t('from') + ' ' + price + ', ' + this.t('tapToView');
      // Arrow on the leading side: left/up arrows before the label, right/down after.
      const label = `<span class="tgwm-edge-name">${esc(name)}</span><span class="tgwm-edge-price">${esc(price)}</span>`;
      chip.innerHTML = (dir === 'left' || dir === 'up') ? (arrow + label) : (label + arrow);
      chip.addEventListener('click', () => this._goToCountry(country));
      return chip;
    }

    /** Fly to an off-screen country and select it (loads deals, resort pins). */
    _goToCountry(country) {
      if (!this.ovMap) return;
      this._activeCountry = country;
      this._clearEdgeArrows();
      if (this._ovHasView) this.ovMap.flyTo([country.lat, country.lng], 6, { duration: 0.7 });
      else { this.ovMap.setView([country.lat, country.lng], 6); this._ovHasView = true; }
      this._loadDeals(country);
    }

    _clearEdgeArrows() {
      const layer = this.overlayEl && this.overlayEl.querySelector('[data-ov-edges]');
      if (layer) layer.innerHTML = '';
    }

    /** Decide the initial view: zoom to the country we arrived from (pin click
     *  on the small map), otherwise show the whole world with all pins.
     *  Leaflet's flyTo() calls getCenter() internally and throws if the map has
     *  never had a view — so the FIRST positioning must use setView(); animated
     *  flyTo is only safe once a view already exists. */
    _fitOverlayMap() {
      if (!this.ovMap) return;
      const hasView = this._ovHasView === true;
      const c = this._activeCountry;
      if (c && typeof c.lat === 'number' && typeof c.lng === 'number') {
        // Point-based "zoom to country" — no per-country bounds in the payload,
        // so centre on the country's point at a country-ish zoom.
        if (hasView) this.ovMap.flyTo([c.lat, c.lng], 5, { duration: 0.6 });
        else this.ovMap.setView([c.lat, c.lng], 5);
        // Arrived focused on a country (small-map pin path) → load its deals.
        this._loadDeals(c);
      } else {
        // Button-open: instead of the whole world (where dense regions look
        // sparse), open framed on where the offers actually cluster. Fit to the
        // main cluster of country pins, ignoring a few far-flung outliers so
        // they don't drag the zoom back out to a full-world view.
        if (this._pinMode === 'resort') this._exitResortMode();
        this._fitToPinCluster();
        this._resetCardsPanel();
      }
      this._ovHasView = true;
    }

    /** Fit the overlay map to the densest cluster of country pins. Outliers
     *  (e.g. a lone USA or Maldives pin) are excluded so the view frames the
     *  bulk of the deals rather than zooming out to fit the whole globe. */
    _fitToPinCluster() {
      const L = window.L;
      const pts = Array.isArray(this.ovMarkers)
        ? this.ovMarkers
            .map(m => m.country)
            .filter(c => c && typeof c.lat === 'number' && typeof c.lng === 'number')
            .map(c => [c.lat, c.lng])
        : [];
      // Fallbacks if we somehow have no/very few pins.
      if (!L || pts.length === 0) { this.ovMap.setView([25, 10], 2); return; }
      if (pts.length <= 2) { this.ovMap.fitBounds(L.latLngBounds(pts), { padding: [60, 60], maxZoom: 5 }); return; }

      // If the agency has curated to a subset, every pin was chosen deliberately,
      // so frame ALL of them — no outlier exclusion. (The median-band heuristic
      // below is only for the full uncurated world, where lone long-haul pins
      // would otherwise zoom the map out to a sparse whole-world view.)
      const curated = Array.isArray(this.cfg.countries) && this.cfg.countries.length > 0;
      if (curated) { this.ovMap.fitBounds(L.latLngBounds(pts), { padding: [50, 50], maxZoom: 6 }); return; }

      // Median centre is robust to outliers (unlike the mean).
      const lats = pts.map(p => p[0]).sort((a, b) => a - b);
      const lngs = pts.map(p => p[1]).sort((a, b) => a - b);
      const mid = arr => arr[Math.floor(arr.length / 2)];
      const mLat = mid(lats), mLng = mid(lngs);

      // Keep pins within a sensible band of the median (the main cluster).
      // ~40° lat / ~60° lng covers Europe+Med+N.Africa together while dropping
      // long-haul singletons. Always keep at least the closest few.
      const within = pts.filter(p => Math.abs(p[0] - mLat) <= 40 && Math.abs(p[1] - mLng) <= 60);
      const cluster = within.length >= 3 ? within : pts;

      this.ovMap.fitBounds(L.latLngBounds(cluster), { padding: [50, 50], maxZoom: 5 });
    }

    // Display order for region pills (only those present in the data show).
    static get REGION_ORDER() {
      return ['Europe', 'Mediterranean', 'Middle East', 'Africa', 'Asia', 'Americas', 'Caribbean', 'Indian Ocean', 'Oceania', 'Other'];
    }

    /** Build the region pill row from the regions actually present in the pins.
     *  "Worldwide" resets to the cluster view; each region reframes to its pins.
     *  Counts come from how many country pins fall in each region. */
    _buildRegionPills() {
      const bar = this.overlayEl && this.overlayEl.querySelector('[data-ov-regions]');
      if (!bar || !Array.isArray(this.ovMarkers)) return;

      // Tally regions across the country pins.
      const counts = new Map();
      for (const m of this.ovMarkers) {
        const r = m.country && m.country.region;
        if (!r) continue;
        counts.set(r, (counts.get(r) || 0) + 1);
      }

      // Fewer than two regions → a region selector adds nothing; hide it.
      if (counts.size < 2) { bar.hidden = true; bar.innerHTML = ''; return; }

      // Order: known order first, then any unexpected regions alphabetically.
      const order = TGWorldMapWidget.REGION_ORDER;
      const present = Array.from(counts.keys()).sort((a, b) => {
        const ia = order.indexOf(a), ib = order.indexOf(b);
        if (ia === -1 && ib === -1) return a.localeCompare(b);
        if (ia === -1) return 1;
        if (ib === -1) return -1;
        return ia - ib;
      });

      bar.innerHTML = '';
      // Worldwide reset pill first.
      bar.appendChild(this._regionPill(this.t('worldwide'), null, this._activeRegion == null));
      for (const r of present) {
        bar.appendChild(this._regionPill(r, r, this._activeRegion === r, counts.get(r)));
      }
      bar.hidden = false;
    }

    _regionPill(label, regionValue, pressed, count) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'tgwm-region-pill';
      b.setAttribute('aria-pressed', pressed ? 'true' : 'false');
      b.innerHTML = esc(label) +
        (count != null ? `<span class="tgwm-region-count">${count}</span>` : '');
      b.addEventListener('click', () => this._selectRegion(regionValue));
      return b;
    }

    /** Reframe the map to a region's pins (or the cluster view for Worldwide).
     *  Pins all stay visible — this only moves the view, per the locked decision. */
    _selectRegion(region) {
      this._activeRegion = region;
      // Refresh pressed states.
      this._buildRegionPills();

      if (!this.ovMap) return;
      const L = window.L;

      if (region == null) {
        // Worldwide → back to the default cluster framing.
        this._fitToPinCluster();
        return;
      }

      const pts = (this.ovMarkers || [])
        .map(m => m.country)
        .filter(c => c && c.region === region && typeof c.lat === 'number' && typeof c.lng === 'number')
        .map(c => [c.lat, c.lng]);

      if (!L || pts.length === 0) return;
      if (pts.length === 1) {
        this.ovMap.flyTo(pts[0], 5, { duration: 0.7 });
      } else {
        this.ovMap.flyToBounds(L.latLngBounds(pts), { padding: [60, 60], maxZoom: 6, duration: 0.7 });
      }
    }

    /** Reset the left cards panel to its initial "pick a destination" prompt. */
    _resetCardsPanel() {
      if (!this.overlayEl) return;
      this._dealsToken = (this._dealsToken || 0) + 1; // cancel any in-flight fetch
      // Collapse the panel — nothing to show until a destination is picked.
      this._setCardsPanelVisible(false);
      // Clear filters + their controls, and un-dim any world pins.
      this._filterMaxPrice = null;
      this._filterMinRating = null;
      const filterWrap = this.overlayEl.querySelector('[data-ov-filters]');
      if (filterWrap) filterWrap.hidden = true;
      this._applyWorldPriceFilter();
      const titleEl = this.overlayEl.querySelector('[data-ov-cards-title]');
      const metaEl = this.overlayEl.querySelector('[data-ov-cards-meta]');
      const scroll = this.overlayEl.querySelector('[data-ov-cards-scroll]');
      if (titleEl) titleEl.textContent = this.t('latestDeals');
      if (metaEl) metaEl.textContent = this.t('tapDestination');
      if (scroll) {
        scroll.innerHTML = `
          <div class="tgwm-ov-cards-state">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>
            </svg>
            <p>${esc(this.t('pickDestination'))}</p>
          </div>`;
      }
    }

    /** Show/collapse the left cards column. Reflows the map after the width
     *  transition so Leaflet recomputes its size (no grey tile strip). */
    _setCardsPanelVisible(visible) {
      const body = this.overlayEl && this.overlayEl.querySelector('[data-ov-body]');
      if (!body) return;
      const wasHidden = body.hasAttribute('data-cards-hidden');
      if (visible && wasHidden) body.removeAttribute('data-cards-hidden');
      else if (!visible && !wasHidden) body.setAttribute('data-cards-hidden', '');
      else return; // no change → no reflow needed
      // Recompute map size after the 280ms width transition settles.
      const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      const after = () => { if (this.ovMap) this.ovMap.invalidateSize(false); };
      if (reduce) after();
      else setTimeout(after, 300);
    }

    _onOverlayPinClick(country) {
      // Store the selection, zoom in, and load its deals into the left panel.
      this._activeCountry = country;
      if (this.ovMap && typeof country.lat === 'number') {
        // A view always exists by the time a pin is clickable, so flyTo is safe.
        if (this._ovHasView) this.ovMap.flyTo([country.lat, country.lng], 6, { duration: 0.6 });
        else { this.ovMap.setView([country.lat, country.lng], 6); this._ovHasView = true; }
      }
      this._loadDeals(country);
    }

    _hideOverlayLoading() {
      const el = this.overlayEl && this.overlayEl.querySelector('[data-ov-loading]');
      if (el) el.classList.add('is-hidden');
    }

    /** Fetch + render deals for a selected country into the left cards panel.
     *  Caches the offers so the cards can be re-filtered by resort without a
     *  re-fetch, and builds resort pins from the same payload.
     *  Guards against out-of-order responses (rapid pin clicks) with a token. */
    _loadDeals(country) {
      if (!this.overlayEl || !country) return;
      const cc = country.countryCode;
      const name = resolveCountryName(country, this.t);
      const scroll = this.overlayEl.querySelector('[data-ov-cards-scroll]');
      const titleEl = this.overlayEl.querySelector('[data-ov-cards-title]');
      const metaEl = this.overlayEl.querySelector('[data-ov-cards-meta]');
      if (!scroll) return;

      // A destination was picked → reveal the cards panel (slides in).
      this._setCardsPanelVisible(true);

      // If we already have this country's offers cached, reuse them — no fetch.
      if (this._dealsCache && this._dealsCache.cc === cc) {
        this._activeResort = null;
        this._buildFilterControls(this._dealsCache.offers);
        const shown = this._applyFilters(this._dealsCache.offers);
        this._renderCards(shown, this._dealsCache.total, name);
        this._loadResortPins(cc, true);
        this._drawDepartureRoutes(country, this._dealsCache.offers);
        return;
      }

      if (titleEl) titleEl.textContent = name;
      if (metaEl) metaEl.textContent = this.t('findingDeals');

      // Token to discard stale responses if another country is picked mid-fetch.
      const token = (this._dealsToken = (this._dealsToken || 0) + 1);

      // Loading skeletons.
      scroll.innerHTML = this._skeletonsHtml(4);

      if (!cc) { this._renderDealsError(scroll, metaEl); return; }

      fetch(DEALS_URL + '?country=' + encodeURIComponent(cc), { credentials: 'omit' })
        .then(r => r.ok ? r.json() : Promise.reject(new Error('deals HTTP ' + r.status)))
        .then(data => {
          if (token !== this._dealsToken) return; // superseded
          const offers = ((data && Array.isArray(data.offers)) ? data.offers : [])
            .filter(o => mapSupplierAllows(o, this.cfg.supplierFilter));
          if (!offers.length) { this._renderDealsEmpty(scroll, metaEl, name); return; }
          const total = data.total || offers.length;
          // Cache for resort filtering + zoom re-entry.
          this._dealsCache = { cc, name, offers, total };
          this._activeResort = null;
          // New country → reset filters, rebuild the controls from its prices.
          this._filterMaxPrice = null;
          this._filterMinRating = null;
          this._buildFilterControls(offers);
          this._renderCards(offers, total, name);
          this._loadResortPins(cc, true);
          this._drawDepartureRoutes(country, offers);
        })
        .catch(err => {
          if (token !== this._dealsToken) return;
          console.warn('[tgwm v3] deals fetch failed:', err.message);
          this._renderDealsError(scroll, metaEl);
        });
    }

    /** Return the offers passing the active in-country filters (budget + rating). */
    _applyFilters(offers) {
      if (!Array.isArray(offers)) return [];
      const maxP = this._filterMaxPrice;
      const minR = this._filterMinRating;
      return offers.filter(o => {
        const pp = o.pricePP || o.price || Infinity;
        if (maxP != null && pp > maxP) return false;
        if (minR != null && (typeof o.rating !== 'number' || o.rating < minR)) return false;
        return true;
      });
    }

    /** Build the rating + budget segmented controls for the loaded country.
     *  Budget presets are derived from the country's own price spread so they're
     *  always meaningful; options that would yield zero results are disabled. */
    _buildFilterControls(offers) {
      const wrap = this.overlayEl && this.overlayEl.querySelector('[data-ov-filters]');
      const ratingSeg = this.overlayEl && this.overlayEl.querySelector('[data-ov-rating-seg]');
      const budgetSeg = this.overlayEl && this.overlayEl.querySelector('[data-ov-budget-seg]');
      if (!wrap || !ratingSeg || !budgetSeg) return;

      const prices = offers.map(o => o.pricePP || o.price).filter(n => typeof n === 'number');
      const minPrice = prices.length ? Math.min(...prices) : 0;
      const maxPrice = prices.length ? Math.max(...prices) : 0;

      // Rating options: Any, 3★+, 4★+, 5★. Disable any with no matching offers.
      const ratingOpts = [
        { label: this.t('any'), val: null },
        { label: '3★+', val: 3 },
        { label: '4★+', val: 4 },
        { label: '5★', val: 5 },
      ];
      ratingSeg.innerHTML = '';
      for (const opt of ratingOpts) {
        const has = opt.val == null || offers.some(o => typeof o.rating === 'number' && o.rating >= opt.val);
        ratingSeg.appendChild(this._segButton(opt.label, this._filterMinRating === opt.val, !has, () => {
          this._filterMinRating = opt.val;
          this._onFilterChange();
        }));
      }

      // Budget options: Any + up to three round thresholds spanning the spread.
      const budgetOpts = [{ label: this.t('any'), val: null }];
      if (maxPrice > minPrice) {
        const span = maxPrice - minPrice;
        const round = n => {
          const step = n < 400 ? 50 : (n < 1000 ? 100 : 250);
          return Math.ceil(n / step) * step;
        };
        const t1 = round(minPrice + span * 0.34);
        const t2 = round(minPrice + span * 0.67);
        const t3 = round(maxPrice);
        [t1, t2, t3].filter((v, i, a) => a.indexOf(v) === i) // dedupe
          .forEach(v => budgetOpts.push({ label: '≤ ' + formatPrice(v), val: v }));
      }
      budgetSeg.innerHTML = '';
      for (const opt of budgetOpts) {
        const has = opt.val == null || offers.some(o => (o.pricePP || o.price || Infinity) <= opt.val);
        budgetSeg.appendChild(this._segButton(opt.label, this._filterMaxPrice === opt.val, !has, () => {
          this._filterMaxPrice = opt.val;
          this._onFilterChange();
        }));
      }

      wrap.hidden = false;
    }

    _segButton(label, pressed, disabled, onClick) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      b.setAttribute('aria-pressed', pressed ? 'true' : 'false');
      if (disabled) b.disabled = true;
      else b.addEventListener('click', onClick);
      return b;
    }

    /** Re-apply filters: refresh pressed states, re-render cards + resort pins
     *  from the filtered set, and clear any active resort filter. */
    _onFilterChange() {
      if (!this._dealsCache) return;
      this._activeResort = null;
      this._activeResortAirportName = null;
      const shown = this._applyFilters(this._dealsCache.offers);
      // Refresh the controls so pressed states + disabled options stay correct.
      this._buildFilterControls(this._dealsCache.offers);
      this._renderCards(shown, this._dealsCache.total, this._dealsCache.name);
      this._buildResortPins(this._resortPinSource(), false);
      // Map-level: also dim country pins above the budget cap (price-only).
      this._applyWorldPriceFilter();
    }

    /** World-map price filter: hide country pins whose cheapest price exceeds
     *  the active max budget. Rating can't apply here (summary has no ratings).
     *  Only meaningful in country mode. */
    _applyWorldPriceFilter() {
      if (this._pinMode === 'resort' || !Array.isArray(this.ovMarkers)) return;
      const maxP = this._filterMaxPrice;
      for (const entry of this.ovMarkers) {
        const c = entry.country;
        const el = entry.marker.getElement();
        if (!el) continue;
        const pp = c.fromPricePP || c.fromPrice || Infinity;
        el.style.opacity = (maxP != null && pp > maxP) ? '0.28' : '';
      }
    }

    /** Render cards from a set of offers (cheapest first, capped). Used for the
     *  full country list, resort-filtered subsets, and filter-narrowed sets. */
    _renderCards(offers, total, countryName, resortName) {
      setActiveCur(this.cur);
      const scroll = this.overlayEl.querySelector('[data-ov-cards-scroll]');
      const titleEl = this.overlayEl.querySelector('[data-ov-cards-title]');
      const metaEl = this.overlayEl.querySelector('[data-ov-cards-meta]');
      if (!scroll) return;

      if (titleEl) {
        if (resortName) {
          // "Akrotiri · Santorini" when we know the gateway, else "Akrotiri, Greece".
          const gateway = this._activeResortAirportName;
          titleEl.textContent = gateway
            ? (resortName + ' · ' + gateway)
            : (resortName + ', ' + countryName);
        } else {
          titleEl.textContent = countryName;
        }
      }

      // Zero matches (usually from an over-tight filter) → friendly empty state.
      if (!offers.length) {
        const filtered = (this._filterMaxPrice != null || this._filterMinRating != null);
        if (metaEl) metaEl.textContent = filtered ? this.t('noDealsFiltered') : '';
        scroll.innerHTML = `
          <div class="tgwm-ov-cards-state">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
            <p>${esc(filtered ? this.t('noDealsFilteredLong') : this.t('noDealsNow'))}</p>
          </div>`;
        return;
      }

      const sorted = offers.slice().sort((a, b) =>
        (a.pricePP || a.price || Infinity) - (b.pricePP || b.price || Infinity)
      ).slice(0, MAX_DEAL_CARDS);

      const filterActive = (this._filterMaxPrice != null || this._filterMinRating != null);
      if (metaEl) {
        if (resortName) {
          metaEl.innerHTML = esc(this.t('dealsInResort', { n: sorted.length, resort: resortName })) +
            ' · <button type="button" class="tgwm-clear-resort" data-ov-clear-resort>' + esc(this.t('showAll', { country: countryName })) + '</button>';
          const clr = metaEl.querySelector('[data-ov-clear-resort]');
          if (clr) clr.addEventListener('click', () => this._clearResortFilter());
        } else if (filterActive) {
          metaEl.textContent = this.t('dealsMatch', { n: sorted.length, total: (total || offers.length).toLocaleString('en-GB') });
        } else {
          metaEl.textContent = this.t('dealsCount', { n: sorted.length, total: (total || offers.length).toLocaleString('en-GB') });
        }
      }
      scroll.innerHTML = sorted.map(o => this._cardHtml(o)).join('');
      scroll.scrollTop = 0;
    }

    /** Show deals for a single resort. Accepts the resort object (preferred,
     *  carries airport) or a bare resort name. If the country cache already has
     *  offers for the resort, filter to them; otherwise the resort's deals are
     *  outside the cheapest slice, so fetch them by the resort's airport. */
    _filterCardsByResort(resortArg) {
      if (!this._dealsCache) return;
      const resort = (typeof resortArg === 'string') ? resortArg : (resortArg && resortArg.resort);
      const airport = (resortArg && typeof resortArg === 'object') ? resortArg.airport : null;
      if (!resort) return;
      this._activeResort = resort;
      // Remember the gateway name so the cards header can say where this is
      // (e.g. "Akrotiri · Santorini") — helps when the resort name alone is
      // unfamiliar or you've zoomed into an island you can't identify.
      this._activeResortAirportName = (resortArg && typeof resortArg === 'object') ? (resortArg.airportName || null) : null;

      const country = this._dealsCache.name;
      const subset = this._applyFilters(this._dealsCache.offers).filter(o => o.resort === resort);

      if (subset.length) {
        // Cache already holds this resort's offers — render straight away.
        this._renderCards(subset, subset.length, country, resort);
        return;
      }

      // Not in the cached slice → fetch this resort's deals by its airport.
      if (!airport) {
        // No airport to fetch with; show an honest empty rather than a wrong one.
        this._renderCards([], 0, country, resort);
        return;
      }
      const scroll = this.overlayEl && this.overlayEl.querySelector('[data-ov-cards-scroll]');
      const titleEl = this.overlayEl && this.overlayEl.querySelector('[data-ov-cards-title]');
      const metaEl = this.overlayEl && this.overlayEl.querySelector('[data-ov-cards-meta]');
      if (titleEl) titleEl.textContent = resort + ', ' + country;
      if (metaEl) metaEl.textContent = this.t('findingResortDeals', { resort: resort });
      if (scroll) scroll.innerHTML = this._skeletonsHtml(3);

      const token = (this._resortDealsToken = (this._resortDealsToken || 0) + 1);
      // Request the airport's full set (endpoint max 200), not the cheapest 60 —
      // we're narrowing to ONE resort, and dearer resorts (e.g. Imerovigli on
      // Santorini) sit outside the cheapest 60 for a busy gateway like JTR.
      fetch(DEALS_URL + '?airport=' + encodeURIComponent(airport) + '&limit=200', { credentials: 'omit' })
        .then(r => r.ok ? r.json() : Promise.reject(new Error('deals HTTP ' + r.status)))
        .then(data => {
          if (token !== this._resortDealsToken) return;   // superseded by another click
          if (this._activeResort !== resort) return;        // user moved on
          const offers = (data && Array.isArray(data.offers)) ? data.offers : [];
          // The airport may serve several resorts — narrow to this one, then
          // honour any active in-country filters.
          let mine = offers.filter(o => o.resort === resort);
          if (this._filterMaxPrice != null) mine = mine.filter(o => (o.pricePP || o.price || Infinity) <= this._filterMaxPrice);
          if (this._filterMinRating != null) mine = mine.filter(o => typeof o.rating === 'number' && o.rating >= this._filterMinRating);
          this._renderCards(mine, mine.length, country, resort);
        })
        .catch(() => {
          if (token !== this._resortDealsToken) return;
          this._renderCards([], 0, country, resort);
        });
    }

    _clearResortFilter() {
      if (!this._dealsCache) return;
      this._activeResort = null;
      this._activeResortAirportName = null;
      const shown = this._applyFilters(this._dealsCache.offers);
      this._renderCards(shown, this._dealsCache.total, this._dealsCache.name);
      // Re-highlight: rebuild resort pins so none is marked active.
      this._buildResortPins(this._resortPinSource());
    }

    _skeletonsHtml(n) {
      let out = '';
      for (let i = 0; i < n; i++) {
        out += `<div class="tgwm-skel"><div class="tgwm-skel-img"></div><div class="tgwm-skel-line"></div><div class="tgwm-skel-line short"></div></div>`;
      }
      return out;
    }

    _renderDealsEmpty(scroll, metaEl, name) {
      if (metaEl) metaEl.textContent = '';
      scroll.innerHTML = `
        <div class="tgwm-ov-cards-state">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <p>${esc(this.t('noDealsCountry', { name: name }))}</p>
        </div>`;
    }

    _renderDealsError(scroll, metaEl) {
      if (metaEl) metaEl.textContent = '';
      scroll.innerHTML = `
        <div class="tgwm-ov-cards-state">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
          <p>${esc(this.t('dealsLoadError'))}</p>
        </div>`;
    }

    /** Build one deal card. Whole card is an anchor to the Travelify deeplink. */
    _cardHtml(o) {
      const href = safeUrl(buildDeeplink(o, this.cfg.appId) || o.url);
      const img = safeUrl(o.image);
      const t = this.t;
      const pp = formatPrice(o.pricePP || o.price, o.currency);
      const total = (o.price && o.pricePP && o.price !== o.pricePP)
        ? formatPrice(o.price, o.currency) + ' ' + t('total') : '';
      const hotel = esc(o.hotel || t('hotel'));
      const resort = esc([o.resort, o.airportName ? o.airportName.replace(/\s*\([^)]*\)\s*$/, '') : '']
        .filter(Boolean).join(' · '));
      const stars = starsSvg(o.rating);
      const facts = [];
      if (o.boardBasis) facts.push(this._factHtml('board', boardLabel(o.boardBasis, t)));
      if (o.nights) facts.push(this._factHtml('moon', o.nights + ' ' + (o.nights === 1 ? t('night') : t('nights'))));
      if (o.resort) facts.push(this._factHtml('pin', esc(o.resort)));
      const carrier = o.carrier ? esc(o.carrier) : '';
      const directBadge = o.direct ? `<span class="tgwm-card-badge">${esc(t('direct'))}</span>` : '';
      const imgHtml = img !== '#'
        ? `<img src="${img}" alt="${hotel}" loading="lazy" onerror="this.style.display='none'">`
        : '';

      return `
        <a class="tgwm-card" href="${href}" target="_blank" rel="noopener noreferrer">
          <div class="tgwm-card-img">
            ${imgHtml}
            ${directBadge}
            <div class="tgwm-card-price">
              <span class="tgwm-card-price-pp">${esc(pp)}<span> ${esc(t('pp'))}</span></span>
              ${total ? `<span class="tgwm-card-price-total">${esc(total)}</span>` : ''}
            </div>
          </div>
          <div class="tgwm-card-body">
            <h4 class="tgwm-card-hotel">${hotel}</h4>
            ${resort ? `<p class="tgwm-card-resort">${resort}</p>` : ''}
            ${stars ? `<div class="tgwm-card-stars">${stars}</div>` : ''}
            <div class="tgwm-card-facts">${facts.join('')}</div>
            <div class="tgwm-card-cta">
              <span class="tgwm-card-cta-label">${esc(t('viewDeal'))}
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
              </span>
              ${carrier ? `<span class="tgwm-card-carrier">${carrier}</span>` : ''}
            </div>
          </div>
        </a>`;
    }

    _factHtml(icon, label) {
      const ICONS = {
        board: '<path d="M3 11h18M3 11a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2M5 11v8a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-8M9 9V7a3 3 0 0 1 6 0v2"/>',
        moon: '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>',
        pin: '<path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>',
      };
      const path = ICONS[icon] || '';
      return `<span class="tgwm-card-fact"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>${label}</span>`;
    }

    _hideLoading() {
      const el = this.shadow.querySelector('[data-loading]');
      if (el) el.classList.add('is-hidden');
    }

    _showError(msg) {
      const el = this.shadow.querySelector('[data-loading]');
      if (!el) return;
      const txt = el.querySelector('[data-loading-text]');
      if (txt) txt.textContent = msg;
      const sp = el.querySelector('.tgwm-spinner');
      if (sp) sp.style.display = 'none';
    }

    /** Pick destinations to show in envelope mode.
     *  Strategy: walk in attractiveness order, drop any candidate that
     *  would visually collide with an already-placed pin at world zoom.
     *  Result: ~8 well-spaced, high-value destinations. Crowded regions
     *  like Europe get represented by their cheapest country only. */
    _selectFeatured(countries) {
      // Display price is per-person (fromPricePP); fall back to fromPrice for
      // older seed payloads that don't carry a per-person figure.
      const priceOf = c => c.fromPricePP || c.fromPrice || Infinity;
      // Breadth score: new payload uses airportCount; seed used destinationCount.
      const breadthOf = c => c.airportCount || c.destinationCount || c.offerCount || 0;
      const minPrice = Math.min(...countries.map(priceOf));
      const maxOffers = Math.max(...countries.map(breadthOf), 1);
      const scored = countries.map(c => {
        const p = priceOf(c);
        const priceScore = minPrice && Number.isFinite(p) ? (minPrice / p) : 0;
        const offerScore = breadthOf(c) / maxOffers;
        return { ...c, _score: priceScore * 0.55 + offerScore * 0.45 };
      }).sort((a, b) => b._score - a._score);

      // Collision check at world-zoom projection. Two pins overlap visually if
      // close in BOTH lat and lng. The longitude box was far too wide (35°
      // ≈ Lisbon→Moscow), which culled every European/Med country behind Spain.
      // Tightened so neighbours like Portugal, Italy, Greece survive while the
      // view stays tidy.
      const MIN_LAT = 9;
      const MIN_LNG = 13;
      const max = this.cfg.maxPins || 12;
      const accepted = [];
      for (const c of scored) {
        if (accepted.length >= max) break;
        const tooClose = accepted.some(a =>
          Math.abs(a.lat - c.lat) < MIN_LAT && Math.abs(a.lng - c.lng) < MIN_LNG
        );
        if (!tooClose) accepted.push(c);
      }
      return accepted;
    }

    /** Set the overview opening view. If the agency curated to a subset
     *  (cfg.countries non-empty), fit the bounds of the shown countries so the
     *  map opens framed on that area. Otherwise keep the off-centre world view.
     *  Single country → tighter zoom; a region → fit its spread. */
    _fitOverviewToData(L, featured) {
      const curated = Array.isArray(this.cfg.countries) && this.cfg.countries.length > 0;
      const pts = (featured || [])
        .filter(c => typeof c.lat === 'number' && typeof c.lng === 'number')
        .map(c => [c.lat, c.lng]);
      if (!curated || pts.length === 0) {
        this.map.setView([25, 10], 2); // default world view
        return;
      }
      if (pts.length === 1) {
        this.map.setView(pts[0], 5); // single country — as close as overview maxZoom allows
        return;
      }
      try {
        this.map.fitBounds(L.latLngBounds(pts), { padding: [40, 40], maxZoom: 5 });
      } catch (_) {
        this.map.setView([25, 10], 2);
      }
    }

    _renderMap(L) {
      setActiveCur(this.cur);
      const mapEl = this.shadow.querySelector('[data-map]');
      if (!mapEl) return;
      if (!this.data || !Array.isArray(this.data.countries)) return;

      const featured = this._selectFeatured(this.data.countries.filter(c => typeof c.lat === 'number' && typeof c.lng === 'number'));

      // Create Leaflet map with envelope-mode restrictions
      this.map = L.map(mapEl, {
        zoomControl: false,
        scrollWheelZoom: false,
        doubleClickZoom: false,
        dragging: false,
        keyboard: false,
        touchZoom: false,
        boxZoom: false,
        attributionControl: true,
        minZoom: 1,
        maxZoom: 5,
      });

      // Build the tile URL with the MapTiler key (config override allowed).
      const mapKey = this.cfg.mapKey || MAPTILER_KEY;
      const tileUrl = TILE_TEMPLATE + encodeURIComponent(mapKey);

      L.tileLayer(tileUrl, {
        attribution: TILE_ATTRIBUTION,
        maxZoom: 19,
        // crossOrigin needed so tiles work inside Shadow DOM in some browsers
        crossOrigin: true,
      }).addTo(this.map);

      // Opening view. When the agency has curated to a subset of destinations
      // (config.countries non-empty), frame those instead of the whole world —
      // a Europe-only or single-country map should open ON that area, not show
      // a lonely cluster of pins floating in an empty world.
      this._fitOverviewToData(L, featured);

      // Drop the pins
      for (const c of featured) {
        const name = resolveCountryName(c, this.t);
        // Per-person price per the locked display rule (£460 total shows as £230).
        const priceLabel = formatPrice(c.fromPricePP || c.fromPrice, c.currency);
        const html = `
          <div class="tg-pin-wrap" data-country="${esc(name)}">
            <div class="tg-price-tag" title="${esc(name)} — ${esc(this.t('from'))} ${esc(priceLabel)} ${esc(this.t('perPerson'))}">
              <span class="tg-tag-country">${esc(name)}</span>
              <span class="tg-tag-price">${esc(priceLabel)}</span>
            </div>
            <div class="tg-price-anchor"></div>
          </div>
        `;
        const marker = L.marker([c.lat, c.lng], {
          icon: L.divIcon({
            html,
            className: '',
            iconSize: [0, 0],
            iconAnchor: [0, 0],
          }),
          keyboard: false,
          interactive: true,
          riseOnHover: true,
        });
        marker.on('click', () => this._onPinClick(c));
        marker.addTo(this.map);
        this.markers.push(marker);
      }
    }

    _onPinClick(country) {
      // Stash the clicked country so the overlay (piece 2) can zoom to its
      // bounds and load its deals. Honour the fullscreenUrl escape hatch via
      // _openFullscreen() — which opens the overlay when no URL is configured.
      this._activeCountry = country;
      this._openFullscreen();
    }

    update(newConfig) {
      this.cfg = Object.assign({}, this.cfg, newConfig || {});
      this.t = makeT(this.cfg);
      // _render() wipes shadow.innerHTML, which orphans the overlay node.
      // Reset its state so a fresh one is built on next open. Also undo any
      // live scroll lock so we don't strand the host page.
      if (this._overlayOpen) {
        document.documentElement.style.overflow = this._prevHtmlOverflow || '';
        if (this._onKeydown) {
          this.shadow.removeEventListener('keydown', this._onKeydown, true);
          this._onKeydown = null;
        }
      }
      this._overlayOpen = false;
      this.overlayEl = null;
      if (this.ovMap) {
        this.ovMap.remove();
        this.ovMap = null;
        this.ovMarkers = [];
        this._resortMarkers = [];
        this._pinMode = 'country';
                this._activeResort = null;
        this._dealsCache = null;
        this._resortSummary = null;
        this._ovHasView = false;
        this._activeRegion = null;
        this._depLayers = [];
      }
      if (this.map) {
        this.map.remove();
        this.map = null;
        this.markers = [];
      }
      this._render();
      this._init();
    }

    destroy() {
      // If the widget is destroyed while the overlay is open, undo the
      // global side-effects first (host scroll lock + key handler).
      if (this._overlayOpen) {
        document.documentElement.style.overflow = this._prevHtmlOverflow || '';
        if (this._onKeydown) {
          this.shadow.removeEventListener('keydown', this._onKeydown, true);
          this._onKeydown = null;
        }
        this._overlayOpen = false;
      }
      this.overlayEl = null;
      if (this.ovMap) {
        this.ovMap.remove();
        this.ovMap = null;
        this.ovMarkers = [];
        this._resortMarkers = [];
        this._pinMode = 'country';
                this._activeResort = null;
        this._dealsCache = null;
        this._resortSummary = null;
        this._ovHasView = false;
        this._activeRegion = null;
        this._depLayers = [];
      }
      if (this.map) {
        this.map.remove();
        this.map = null;
      }
      if (this.shadow) this.shadow.innerHTML = '';
    }
  }

  // ── Auto-init

  async function init() {
    const containers = document.querySelectorAll('[data-tg-widget="worldmap"]');
    for (const el of containers) {
      if (el.__tgwmInit) continue;
      el.__tgwmInit = true;

      let cfg = {};
      const inlineCfg = el.getAttribute('data-tg-config');
      if (inlineCfg) {
        try { cfg = JSON.parse(inlineCfg); }
        catch (e) { console.warn('[tgwm v3] bad data-tg-config', e); }
      }
      const widgetId = el.getAttribute('data-tg-id');
      if (widgetId && !inlineCfg) {
        try {
          const res = await fetch(CONFIG_URL + '?id=' + encodeURIComponent(widgetId));
          if (res.ok) {
            const r = await res.json();
            cfg = r.config || r;
          }
        } catch (e) { console.warn('[tgwm v3] config fetch failed', e.message); }
      }
      new TGWorldMapWidget(el, cfg);
    }
  }

  window.TGWorldMapWidget = TGWorldMapWidget;
  window.__TG_WORLDMAP_VERSION__ = VERSION;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
