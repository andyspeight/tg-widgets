/**
 * Travelgenix Maps Widget v1.0.0
 * Self-contained, embeddable map widget — Leaflet + MapTiler tiles
 * (same mapping stack as the World Map widget — no Google key, low tile cost).
 *
 * Features
 *  - Single-location and multi-location modes from one widget
 *  - Per-location: title, address or lat/lng, description, image, link, pin colour, category
 *  - Custom coloured SVG pins (Leaflet divIcon)
 *  - Our own zoom controls + recenter — fully styled inside the Shadow DOM
 *  - Custom info card on pin click (docked) with optional "Get directions"
 *  - Optional location list panel for multi-location maps
 *  - Map style presets via MapTiler slugs (streets/minimal/muted/dark/satellite)
 *  - Dark mode (`theme: "dark" | "light" | "auto"`), reduced-motion aware
 *  - Fully responsive from 320px upwards, keyboard accessible, XSS-hardened
 *
 * Tiles: MapTiler — single shared Travelgenix key (domain-restricted in the
 * MapTiler dashboard). Necessarily visible client-side (true of any map tiles);
 * the domain restriction is the protection. Override per-widget via config.mapKey.
 *
 * Usage (remote config):
 *   <div data-tg-widget="maps" data-tg-id="YOUR_WIDGET_ID"></div>
 *   <script src="https://tg-widgets.vercel.app/widget-maps.js"></script>
 *
 * Usage (inline config):
 *   <div data-tg-widget="maps" data-tg-config='{"locations":[...]}'></div>
 *   <script src="https://tg-widgets.vercel.app/widget-maps.js"></script>
 *
 * © Travelgenix. All rights reserved.
 */
(function () {
  'use strict';

  // ═══════════════════════════════════════════════════════════
  // API base resolution (for data-tg-id config loads)
  // ═══════════════════════════════════════════════════════════
  function resolveApiBase() {
    if (typeof window === 'undefined') return '/api/widget-config';
    if (window.__TG_WIDGET_API__) return window.__TG_WIDGET_API__;
    try {
      const me = document.currentScript;
      if (me && me.src) return new URL(me.src).origin + '/api/widget-config';
      const scripts = document.getElementsByTagName('script');
      for (let i = scripts.length - 1; i >= 0; i--) {
        const s = scripts[i].src || '';
        if (/\/widget\-maps\.js(\?|$|#)/.test(s)) return new URL(s).origin + '/api/widget-config';
      }
    } catch (e) { /* fall through */ }
    return '/api/widget-config';
  }

  const API_BASE = resolveApiBase();
  const VERSION = '1.0.1';

  // ─── i18n ───────────────────────────────────────────────────
  // Fixed UI chrome only (control aria-labels, empty/error states, the
  // directions action). Location titles, addresses, descriptions, link URLs and
  // any author-set labels are content, translated separately. English is the
  // source + fallback.
  const MESSAGES = {
    en: {
      locations: 'Locations', location: 'Location', map: 'Map',
      locationDetails: 'Location details', zoomIn: 'Zoom in', zoomOut: 'Zoom out',
      recentre: 'Recentre map', close: 'Close',
      visitWebsite: 'Visit website', getDirections: 'Get directions',
      emptyTitle: 'No locations yet',
      emptySub: 'Add at least one location with a valid address or coordinates to see it on the map.',
      errorTitle: 'Map unavailable',
      errorSub: 'The map library could not load. Please try again later.',
    },
    fr: {
      locations: 'Emplacements', location: 'Emplacement', map: 'Carte',
      locationDetails: "Détails de l'emplacement", zoomIn: 'Zoom avant', zoomOut: 'Zoom arrière',
      recentre: 'Recentrer la carte', close: 'Fermer',
      visitWebsite: 'Visiter le site', getDirections: 'Itinéraire',
      emptyTitle: 'Aucun emplacement pour le moment',
      emptySub: 'Ajoutez au moins un emplacement avec une adresse ou des coordonnées valides pour le voir sur la carte.',
      errorTitle: 'Carte indisponible',
      errorSub: "La bibliothèque cartographique n'a pas pu se charger. Veuillez réessayer plus tard.",
    },
    de: {
      locations: 'Standorte', location: 'Standort', map: 'Karte',
      locationDetails: 'Standortdetails', zoomIn: 'Vergrößern', zoomOut: 'Verkleinern',
      recentre: 'Karte zentrieren', close: 'Schließen',
      visitWebsite: 'Website besuchen', getDirections: 'Route',
      emptyTitle: 'Noch keine Standorte',
      emptySub: 'Fügen Sie mindestens einen Standort mit einer gültigen Adresse oder Koordinaten hinzu, um ihn auf der Karte zu sehen.',
      errorTitle: 'Karte nicht verfügbar',
      errorSub: 'Die Kartenbibliothek konnte nicht geladen werden. Bitte versuchen Sie es später erneut.',
    },
    es: {
      locations: 'Ubicaciones', location: 'Ubicación', map: 'Mapa',
      locationDetails: 'Detalles de la ubicación', zoomIn: 'Acercar', zoomOut: 'Alejar',
      recentre: 'Recentrar el mapa', close: 'Cerrar',
      visitWebsite: 'Visitar el sitio', getDirections: 'Cómo llegar',
      emptyTitle: 'Aún no hay ubicaciones',
      emptySub: 'Añade al menos una ubicación con una dirección o coordenadas válidas para verla en el mapa.',
      errorTitle: 'Mapa no disponible',
      errorSub: 'No se pudo cargar la biblioteca de mapas. Inténtalo de nuevo más tarde.',
    },
    it: {
      locations: 'Posizioni', location: 'Posizione', map: 'Mappa',
      locationDetails: 'Dettagli della posizione', zoomIn: 'Ingrandisci', zoomOut: 'Riduci',
      recentre: 'Ricentra la mappa', close: 'Chiudi',
      visitWebsite: 'Visita il sito', getDirections: 'Indicazioni',
      emptyTitle: 'Nessuna posizione ancora',
      emptySub: 'Aggiungi almeno una posizione con un indirizzo o coordinate validi per vederla sulla mappa.',
      errorTitle: 'Mappa non disponibile',
      errorSub: 'Impossibile caricare la libreria della mappa. Riprova più tardi.',
    },
    ro: {
      locations: 'Locații', location: 'Locație', map: 'Hartă',
      locationDetails: 'Detalii locație', zoomIn: 'Mărește', zoomOut: 'Micșorează',
      recentre: 'Recentrează harta', close: 'Închide',
      visitWebsite: 'Vizitează site-ul', getDirections: 'Indicații',
      emptyTitle: 'Încă nicio locație',
      emptySub: 'Adăugați cel puțin o locație cu o adresă sau coordonate valide pentru a o vedea pe hartă.',
      errorTitle: 'Hartă indisponibilă',
      errorSub: 'Biblioteca de hărți nu a putut fi încărcată. Vă rugăm să încercați din nou mai târziu.',
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

  // ═══════════════════════════════════════════════════════════
  // Mapping stack — Leaflet + MapTiler (mirrors widget-worldmap.js)
  // ═══════════════════════════════════════════════════════════
  const LEAFLET_JS_URL = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
  const MAPTILER_KEY = 'zSDRMRY6Fi2YzknQVzXf'; // shared, domain-restricted in MapTiler dashboard
  const TILE_ATTRIBUTION = '&copy; <a href="https://www.maptiler.com/copyright/">MapTiler</a> &copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>';

  // Friendly preset name → MapTiler raster style slug
  const STYLE_SLUGS = {
    streets: 'streets-v2', light: 'streets-v2', classic: 'streets-v2',
    minimal: 'basic-v2', muted: 'dataviz', dataviz: 'dataviz',
    dark: 'streets-v2-dark', retro: 'outdoor-v2', outdoor: 'outdoor-v2',
    satellite: 'hybrid', hybrid: 'hybrid',
  };
  function styleSlug(name, theme) {
    let n = (name || 'streets');
    if (n === 'auto') n = theme === 'dark' ? 'dark' : 'streets';
    return STYLE_SLUGS[n] || 'streets-v2';
  }

  // Leaflet loader — one fetch even with multiple map widgets on the page
  let _leafletPromise = null;
  function loadLeaflet() {
    if (typeof window !== 'undefined' && typeof window.L !== 'undefined') return Promise.resolve(window.L);
    if (_leafletPromise) return _leafletPromise;
    _leafletPromise = new Promise(function (resolve, reject) {
      const s = document.createElement('script');
      s.src = LEAFLET_JS_URL;
      s.async = true;
      s.onload = function () { resolve(window.L); };
      s.onerror = function () { reject(new Error('leaflet-load-failed')); };
      document.head.appendChild(s);
      setTimeout(function () { if (typeof window.L === 'undefined') reject(new Error('timeout')); }, 12000);
    });
    return _leafletPromise;
  }

  // Canonical Leaflet 1.9.4 CSS — inlined so it lives inside the Shadow DOM
  // (<link> tags don't penetrate shadow roots).
  const LEAFLET_CSS = "/* required styles */\r\n\r\n.leaflet-pane,\r\n.leaflet-tile,\r\n.leaflet-marker-icon,\r\n.leaflet-marker-shadow,\r\n.leaflet-tile-container,\r\n.leaflet-pane > svg,\r\n.leaflet-pane > canvas,\r\n.leaflet-zoom-box,\r\n.leaflet-image-layer,\r\n.leaflet-layer {\r\n\tposition: absolute;\r\n\tleft: 0;\r\n\ttop: 0;\r\n\t}\r\n.leaflet-container {\r\n\toverflow: hidden;\r\n\t}\r\n.leaflet-tile,\r\n.leaflet-marker-icon,\r\n.leaflet-marker-shadow {\r\n\t-webkit-user-select: none;\r\n\t   -moz-user-select: none;\r\n\t        user-select: none;\r\n\t  -webkit-user-drag: none;\r\n\t}\r\n/* Prevents IE11 from highlighting tiles in blue */\r\n.leaflet-tile::selection {\r\n\tbackground: transparent;\r\n}\r\n/* Safari renders non-retina tile on retina better with this, but Chrome is worse */\r\n.leaflet-safari .leaflet-tile {\r\n\timage-rendering: -webkit-optimize-contrast;\r\n\t}\r\n/* hack that prevents hw layers \"stretching\" when loading new tiles */\r\n.leaflet-safari .leaflet-tile-container {\r\n\twidth: 1600px;\r\n\theight: 1600px;\r\n\t-webkit-transform-origin: 0 0;\r\n\t}\r\n.leaflet-marker-icon,\r\n.leaflet-marker-shadow {\r\n\tdisplay: block;\r\n\t}\r\n/* .leaflet-container svg: reset svg max-width decleration shipped in Joomla! (joomla.org) 3.x */\r\n/* .leaflet-container img: map is broken in FF if you have max-width: 100% on tiles */\r\n.leaflet-container .leaflet-overlay-pane svg {\r\n\tmax-width: none !important;\r\n\tmax-height: none !important;\r\n\t}\r\n.leaflet-container .leaflet-marker-pane img,\r\n.leaflet-container .leaflet-shadow-pane img,\r\n.leaflet-container .leaflet-tile-pane img,\r\n.leaflet-container img.leaflet-image-layer,\r\n.leaflet-container .leaflet-tile {\r\n\tmax-width: none !important;\r\n\tmax-height: none !important;\r\n\twidth: auto;\r\n\tpadding: 0;\r\n\t}\r\n\r\n.leaflet-container img.leaflet-tile {\r\n\t/* See: https://bugs.chromium.org/p/chromium/issues/detail?id=600120 */\r\n\tmix-blend-mode: plus-lighter;\r\n}\r\n\r\n.leaflet-container.leaflet-touch-zoom {\r\n\t-ms-touch-action: pan-x pan-y;\r\n\ttouch-action: pan-x pan-y;\r\n\t}\r\n.leaflet-container.leaflet-touch-drag {\r\n\t-ms-touch-action: pinch-zoom;\r\n\t/* Fallback for FF which doesn't support pinch-zoom */\r\n\ttouch-action: none;\r\n\ttouch-action: pinch-zoom;\r\n}\r\n.leaflet-container.leaflet-touch-drag.leaflet-touch-zoom {\r\n\t-ms-touch-action: none;\r\n\ttouch-action: none;\r\n}\r\n.leaflet-container {\r\n\t-webkit-tap-highlight-color: transparent;\r\n}\r\n.leaflet-container a {\r\n\t-webkit-tap-highlight-color: rgba(51, 181, 229, 0.4);\r\n}\r\n.leaflet-tile {\r\n\tfilter: inherit;\r\n\tvisibility: hidden;\r\n\t}\r\n.leaflet-tile-loaded {\r\n\tvisibility: inherit;\r\n\t}\r\n.leaflet-zoom-box {\r\n\twidth: 0;\r\n\theight: 0;\r\n\t-moz-box-sizing: border-box;\r\n\t     box-sizing: border-box;\r\n\tz-index: 800;\r\n\t}\r\n/* workaround for https://bugzilla.mozilla.org/show_bug.cgi?id=888319 */\r\n.leaflet-overlay-pane svg {\r\n\t-moz-user-select: none;\r\n\t}\r\n\r\n.leaflet-pane         { z-index: 400; }\r\n\r\n.leaflet-tile-pane    { z-index: 200; }\r\n.leaflet-overlay-pane { z-index: 400; }\r\n.leaflet-shadow-pane  { z-index: 500; }\r\n.leaflet-marker-pane  { z-index: 600; }\r\n.leaflet-tooltip-pane   { z-index: 650; }\r\n.leaflet-popup-pane   { z-index: 700; }\r\n\r\n.leaflet-map-pane canvas { z-index: 100; }\r\n.leaflet-map-pane svg    { z-index: 200; }\r\n\r\n.leaflet-vml-shape {\r\n\twidth: 1px;\r\n\theight: 1px;\r\n\t}\r\n.lvml {\r\n\tbehavior: url(#default#VML);\r\n\tdisplay: inline-block;\r\n\tposition: absolute;\r\n\t}\r\n\r\n\r\n/* control positioning */\r\n\r\n.leaflet-control {\r\n\tposition: relative;\r\n\tz-index: 800;\r\n\tpointer-events: visiblePainted; /* IE 9-10 doesn't have auto */\r\n\tpointer-events: auto;\r\n\t}\r\n.leaflet-top,\r\n.leaflet-bottom {\r\n\tposition: absolute;\r\n\tz-index: 1000;\r\n\tpointer-events: none;\r\n\t}\r\n.leaflet-top {\r\n\ttop: 0;\r\n\t}\r\n.leaflet-right {\r\n\tright: 0;\r\n\t}\r\n.leaflet-bottom {\r\n\tbottom: 0;\r\n\t}\r\n.leaflet-left {\r\n\tleft: 0;\r\n\t}\r\n.leaflet-control {\r\n\tfloat: left;\r\n\tclear: both;\r\n\t}\r\n.leaflet-right .leaflet-control {\r\n\tfloat: right;\r\n\t}\r\n.leaflet-top .leaflet-control {\r\n\tmargin-top: 10px;\r\n\t}\r\n.leaflet-bottom .leaflet-control {\r\n\tmargin-bottom: 10px;\r\n\t}\r\n.leaflet-left .leaflet-control {\r\n\tmargin-left: 10px;\r\n\t}\r\n.leaflet-right .leaflet-control {\r\n\tmargin-right: 10px;\r\n\t}\r\n\r\n\r\n/* zoom and fade animations */\r\n\r\n.leaflet-fade-anim .leaflet-popup {\r\n\topacity: 0;\r\n\t-webkit-transition: opacity 0.2s linear;\r\n\t   -moz-transition: opacity 0.2s linear;\r\n\t        transition: opacity 0.2s linear;\r\n\t}\r\n.leaflet-fade-anim .leaflet-map-pane .leaflet-popup {\r\n\topacity: 1;\r\n\t}\r\n.leaflet-zoom-animated {\r\n\t-webkit-transform-origin: 0 0;\r\n\t    -ms-transform-origin: 0 0;\r\n\t        transform-origin: 0 0;\r\n\t}\r\nsvg.leaflet-zoom-animated {\r\n\twill-change: transform;\r\n}\r\n\r\n.leaflet-zoom-anim .leaflet-zoom-animated {\r\n\t-webkit-transition: -webkit-transform 0.25s cubic-bezier(0,0,0.25,1);\r\n\t   -moz-transition:    -moz-transform 0.25s cubic-bezier(0,0,0.25,1);\r\n\t        transition:         transform 0.25s cubic-bezier(0,0,0.25,1);\r\n\t}\r\n.leaflet-zoom-anim .leaflet-tile,\r\n.leaflet-pan-anim .leaflet-tile {\r\n\t-webkit-transition: none;\r\n\t   -moz-transition: none;\r\n\t        transition: none;\r\n\t}\r\n\r\n.leaflet-zoom-anim .leaflet-zoom-hide {\r\n\tvisibility: hidden;\r\n\t}\r\n\r\n\r\n/* cursors */\r\n\r\n.leaflet-interactive {\r\n\tcursor: pointer;\r\n\t}\r\n.leaflet-grab {\r\n\tcursor: -webkit-grab;\r\n\tcursor:    -moz-grab;\r\n\tcursor:         grab;\r\n\t}\r\n.leaflet-crosshair,\r\n.leaflet-crosshair .leaflet-interactive {\r\n\tcursor: crosshair;\r\n\t}\r\n.leaflet-popup-pane,\r\n.leaflet-control {\r\n\tcursor: auto;\r\n\t}\r\n.leaflet-dragging .leaflet-grab,\r\n.leaflet-dragging .leaflet-grab .leaflet-interactive,\r\n.leaflet-dragging .leaflet-marker-draggable {\r\n\tcursor: move;\r\n\tcursor: -webkit-grabbing;\r\n\tcursor:    -moz-grabbing;\r\n\tcursor:         grabbing;\r\n\t}\r\n\r\n/* marker & overlays interactivity */\r\n.leaflet-marker-icon,\r\n.leaflet-marker-shadow,\r\n.leaflet-image-layer,\r\n.leaflet-pane > svg path,\r\n.leaflet-tile-container {\r\n\tpointer-events: none;\r\n\t}\r\n\r\n.leaflet-marker-icon.leaflet-interactive,\r\n.leaflet-image-layer.leaflet-interactive,\r\n.leaflet-pane > svg path.leaflet-interactive,\r\nsvg.leaflet-image-layer.leaflet-interactive path {\r\n\tpointer-events: visiblePainted; /* IE 9-10 doesn't have auto */\r\n\tpointer-events: auto;\r\n\t}\r\n\r\n/* visual tweaks */\r\n\r\n.leaflet-container {\r\n\tbackground: #ddd;\r\n\toutline-offset: 1px;\r\n\t}\r\n.leaflet-container a {\r\n\tcolor: #0078A8;\r\n\t}\r\n.leaflet-zoom-box {\r\n\tborder: 2px dotted #38f;\r\n\tbackground: rgba(255,255,255,0.5);\r\n\t}\r\n\r\n\r\n/* general typography */\r\n.leaflet-container {\r\n\tfont-family: \"Helvetica Neue\", Arial, Helvetica, sans-serif;\r\n\tfont-size: 12px;\r\n\tfont-size: 0.75rem;\r\n\tline-height: 1.5;\r\n\t}\r\n\r\n\r\n/* general toolbar styles */\r\n\r\n.leaflet-bar {\r\n\tbox-shadow: 0 1px 5px rgba(0,0,0,0.65);\r\n\tborder-radius: 4px;\r\n\t}\r\n.leaflet-bar a {\r\n\tbackground-color: #fff;\r\n\tborder-bottom: 1px solid #ccc;\r\n\twidth: 26px;\r\n\theight: 26px;\r\n\tline-height: 26px;\r\n\tdisplay: block;\r\n\ttext-align: center;\r\n\ttext-decoration: none;\r\n\tcolor: black;\r\n\t}\r\n.leaflet-bar a,\r\n.leaflet-control-layers-toggle {\r\n\tbackground-position: 50% 50%;\r\n\tbackground-repeat: no-repeat;\r\n\tdisplay: block;\r\n\t}\r\n.leaflet-bar a:hover,\r\n.leaflet-bar a:focus {\r\n\tbackground-color: #f4f4f4;\r\n\t}\r\n.leaflet-bar a:first-child {\r\n\tborder-top-left-radius: 4px;\r\n\tborder-top-right-radius: 4px;\r\n\t}\r\n.leaflet-bar a:last-child {\r\n\tborder-bottom-left-radius: 4px;\r\n\tborder-bottom-right-radius: 4px;\r\n\tborder-bottom: none;\r\n\t}\r\n.leaflet-bar a.leaflet-disabled {\r\n\tcursor: default;\r\n\tbackground-color: #f4f4f4;\r\n\tcolor: #bbb;\r\n\t}\r\n\r\n.leaflet-touch .leaflet-bar a {\r\n\twidth: 30px;\r\n\theight: 30px;\r\n\tline-height: 30px;\r\n\t}\r\n.leaflet-touch .leaflet-bar a:first-child {\r\n\tborder-top-left-radius: 2px;\r\n\tborder-top-right-radius: 2px;\r\n\t}\r\n.leaflet-touch .leaflet-bar a:last-child {\r\n\tborder-bottom-left-radius: 2px;\r\n\tborder-bottom-right-radius: 2px;\r\n\t}\r\n\r\n/* zoom control */\r\n\r\n.leaflet-control-zoom-in,\r\n.leaflet-control-zoom-out {\r\n\tfont: bold 18px 'Lucida Console', Monaco, monospace;\r\n\ttext-indent: 1px;\r\n\t}\r\n\r\n.leaflet-touch .leaflet-control-zoom-in, .leaflet-touch .leaflet-control-zoom-out  {\r\n\tfont-size: 22px;\r\n\t}\r\n\r\n\r\n/* layers control */\r\n\r\n.leaflet-control-layers {\r\n\tbox-shadow: 0 1px 5px rgba(0,0,0,0.4);\r\n\tbackground: #fff;\r\n\tborder-radius: 5px;\r\n\t}\r\n.leaflet-control-layers-toggle {\r\n\tbackground-image: url(images/layers.png);\r\n\twidth: 36px;\r\n\theight: 36px;\r\n\t}\r\n.leaflet-retina .leaflet-control-layers-toggle {\r\n\tbackground-image: url(images/layers-2x.png);\r\n\tbackground-size: 26px 26px;\r\n\t}\r\n.leaflet-touch .leaflet-control-layers-toggle {\r\n\twidth: 44px;\r\n\theight: 44px;\r\n\t}\r\n.leaflet-control-layers .leaflet-control-layers-list,\r\n.leaflet-control-layers-expanded .leaflet-control-layers-toggle {\r\n\tdisplay: none;\r\n\t}\r\n.leaflet-control-layers-expanded .leaflet-control-layers-list {\r\n\tdisplay: block;\r\n\tposition: relative;\r\n\t}\r\n.leaflet-control-layers-expanded {\r\n\tpadding: 6px 10px 6px 6px;\r\n\tcolor: #333;\r\n\tbackground: #fff;\r\n\t}\r\n.leaflet-control-layers-scrollbar {\r\n\toverflow-y: scroll;\r\n\toverflow-x: hidden;\r\n\tpadding-right: 5px;\r\n\t}\r\n.leaflet-control-layers-selector {\r\n\tmargin-top: 2px;\r\n\tposition: relative;\r\n\ttop: 1px;\r\n\t}\r\n.leaflet-control-layers label {\r\n\tdisplay: block;\r\n\tfont-size: 13px;\r\n\tfont-size: 1.08333em;\r\n\t}\r\n.leaflet-control-layers-separator {\r\n\theight: 0;\r\n\tborder-top: 1px solid #ddd;\r\n\tmargin: 5px -10px 5px -6px;\r\n\t}\r\n\r\n/* Default icon URLs */\r\n.leaflet-default-icon-path { /* used only in path-guessing heuristic, see L.Icon.Default */\r\n\tbackground-image: url(images/marker-icon.png);\r\n\t}\r\n\r\n\r\n/* attribution and scale controls */\r\n\r\n.leaflet-container .leaflet-control-attribution {\r\n\tbackground: #fff;\r\n\tbackground: rgba(255, 255, 255, 0.8);\r\n\tmargin: 0;\r\n\t}\r\n.leaflet-control-attribution,\r\n.leaflet-control-scale-line {\r\n\tpadding: 0 5px;\r\n\tcolor: #333;\r\n\tline-height: 1.4;\r\n\t}\r\n.leaflet-control-attribution a {\r\n\ttext-decoration: none;\r\n\t}\r\n.leaflet-control-attribution a:hover,\r\n.leaflet-control-attribution a:focus {\r\n\ttext-decoration: underline;\r\n\t}\r\n.leaflet-attribution-flag {\r\n\tdisplay: inline !important;\r\n\tvertical-align: baseline !important;\r\n\twidth: 1em;\r\n\theight: 0.6669em;\r\n\t}\r\n.leaflet-left .leaflet-control-scale {\r\n\tmargin-left: 5px;\r\n\t}\r\n.leaflet-bottom .leaflet-control-scale {\r\n\tmargin-bottom: 5px;\r\n\t}\r\n.leaflet-control-scale-line {\r\n\tborder: 2px solid #777;\r\n\tborder-top: none;\r\n\tline-height: 1.1;\r\n\tpadding: 2px 5px 1px;\r\n\twhite-space: nowrap;\r\n\t-moz-box-sizing: border-box;\r\n\t     box-sizing: border-box;\r\n\tbackground: rgba(255, 255, 255, 0.8);\r\n\ttext-shadow: 1px 1px #fff;\r\n\t}\r\n.leaflet-control-scale-line:not(:first-child) {\r\n\tborder-top: 2px solid #777;\r\n\tborder-bottom: none;\r\n\tmargin-top: -2px;\r\n\t}\r\n.leaflet-control-scale-line:not(:first-child):not(:last-child) {\r\n\tborder-bottom: 2px solid #777;\r\n\t}\r\n\r\n.leaflet-touch .leaflet-control-attribution,\r\n.leaflet-touch .leaflet-control-layers,\r\n.leaflet-touch .leaflet-bar {\r\n\tbox-shadow: none;\r\n\t}\r\n.leaflet-touch .leaflet-control-layers,\r\n.leaflet-touch .leaflet-bar {\r\n\tborder: 2px solid rgba(0,0,0,0.2);\r\n\tbackground-clip: padding-box;\r\n\t}\r\n\r\n\r\n/* popup */\r\n\r\n.leaflet-popup {\r\n\tposition: absolute;\r\n\ttext-align: center;\r\n\tmargin-bottom: 20px;\r\n\t}\r\n.leaflet-popup-content-wrapper {\r\n\tpadding: 1px;\r\n\ttext-align: left;\r\n\tborder-radius: 12px;\r\n\t}\r\n.leaflet-popup-content {\r\n\tmargin: 13px 24px 13px 20px;\r\n\tline-height: 1.3;\r\n\tfont-size: 13px;\r\n\tfont-size: 1.08333em;\r\n\tmin-height: 1px;\r\n\t}\r\n.leaflet-popup-content p {\r\n\tmargin: 17px 0;\r\n\tmargin: 1.3em 0;\r\n\t}\r\n.leaflet-popup-tip-container {\r\n\twidth: 40px;\r\n\theight: 20px;\r\n\tposition: absolute;\r\n\tleft: 50%;\r\n\tmargin-top: -1px;\r\n\tmargin-left: -20px;\r\n\toverflow: hidden;\r\n\tpointer-events: none;\r\n\t}\r\n.leaflet-popup-tip {\r\n\twidth: 17px;\r\n\theight: 17px;\r\n\tpadding: 1px;\r\n\r\n\tmargin: -10px auto 0;\r\n\tpointer-events: auto;\r\n\r\n\t-webkit-transform: rotate(45deg);\r\n\t   -moz-transform: rotate(45deg);\r\n\t    -ms-transform: rotate(45deg);\r\n\t        transform: rotate(45deg);\r\n\t}\r\n.leaflet-popup-content-wrapper,\r\n.leaflet-popup-tip {\r\n\tbackground: white;\r\n\tcolor: #333;\r\n\tbox-shadow: 0 3px 14px rgba(0,0,0,0.4);\r\n\t}\r\n.leaflet-container a.leaflet-popup-close-button {\r\n\tposition: absolute;\r\n\ttop: 0;\r\n\tright: 0;\r\n\tborder: none;\r\n\ttext-align: center;\r\n\twidth: 24px;\r\n\theight: 24px;\r\n\tfont: 16px/24px Tahoma, Verdana, sans-serif;\r\n\tcolor: #757575;\r\n\ttext-decoration: none;\r\n\tbackground: transparent;\r\n\t}\r\n.leaflet-container a.leaflet-popup-close-button:hover,\r\n.leaflet-container a.leaflet-popup-close-button:focus {\r\n\tcolor: #585858;\r\n\t}\r\n.leaflet-popup-scrolled {\r\n\toverflow: auto;\r\n\t}\r\n\r\n.leaflet-oldie .leaflet-popup-content-wrapper {\r\n\t-ms-zoom: 1;\r\n\t}\r\n.leaflet-oldie .leaflet-popup-tip {\r\n\twidth: 24px;\r\n\tmargin: 0 auto;\r\n\r\n\t-ms-filter: \"progid:DXImageTransform.Microsoft.Matrix(M11=0.70710678, M12=0.70710678, M21=-0.70710678, M22=0.70710678)\";\r\n\tfilter: progid:DXImageTransform.Microsoft.Matrix(M11=0.70710678, M12=0.70710678, M21=-0.70710678, M22=0.70710678);\r\n\t}\r\n\r\n.leaflet-oldie .leaflet-control-zoom,\r\n.leaflet-oldie .leaflet-control-layers,\r\n.leaflet-oldie .leaflet-popup-content-wrapper,\r\n.leaflet-oldie .leaflet-popup-tip {\r\n\tborder: 1px solid #999;\r\n\t}\r\n\r\n\r\n/* div icon */\r\n\r\n.leaflet-div-icon {\r\n\tbackground: #fff;\r\n\tborder: 1px solid #666;\r\n\t}\r\n\r\n\r\n/* Tooltip */\r\n/* Base styles for the element that has a tooltip */\r\n.leaflet-tooltip {\r\n\tposition: absolute;\r\n\tpadding: 6px;\r\n\tbackground-color: #fff;\r\n\tborder: 1px solid #fff;\r\n\tborder-radius: 3px;\r\n\tcolor: #222;\r\n\twhite-space: nowrap;\r\n\t-webkit-user-select: none;\r\n\t-moz-user-select: none;\r\n\t-ms-user-select: none;\r\n\tuser-select: none;\r\n\tpointer-events: none;\r\n\tbox-shadow: 0 1px 3px rgba(0,0,0,0.4);\r\n\t}\r\n.leaflet-tooltip.leaflet-interactive {\r\n\tcursor: pointer;\r\n\tpointer-events: auto;\r\n\t}\r\n.leaflet-tooltip-top:before,\r\n.leaflet-tooltip-bottom:before,\r\n.leaflet-tooltip-left:before,\r\n.leaflet-tooltip-right:before {\r\n\tposition: absolute;\r\n\tpointer-events: none;\r\n\tborder: 6px solid transparent;\r\n\tbackground: transparent;\r\n\tcontent: \"\";\r\n\t}\r\n\r\n/* Directions */\r\n\r\n.leaflet-tooltip-bottom {\r\n\tmargin-top: 6px;\r\n}\r\n.leaflet-tooltip-top {\r\n\tmargin-top: -6px;\r\n}\r\n.leaflet-tooltip-bottom:before,\r\n.leaflet-tooltip-top:before {\r\n\tleft: 50%;\r\n\tmargin-left: -6px;\r\n\t}\r\n.leaflet-tooltip-top:before {\r\n\tbottom: 0;\r\n\tmargin-bottom: -12px;\r\n\tborder-top-color: #fff;\r\n\t}\r\n.leaflet-tooltip-bottom:before {\r\n\ttop: 0;\r\n\tmargin-top: -12px;\r\n\tmargin-left: -6px;\r\n\tborder-bottom-color: #fff;\r\n\t}\r\n.leaflet-tooltip-left {\r\n\tmargin-left: -6px;\r\n}\r\n.leaflet-tooltip-right {\r\n\tmargin-left: 6px;\r\n}\r\n.leaflet-tooltip-left:before,\r\n.leaflet-tooltip-right:before {\r\n\ttop: 50%;\r\n\tmargin-top: -6px;\r\n\t}\r\n.leaflet-tooltip-left:before {\r\n\tright: 0;\r\n\tmargin-right: -12px;\r\n\tborder-left-color: #fff;\r\n\t}\r\n.leaflet-tooltip-right:before {\r\n\tleft: 0;\r\n\tmargin-left: -12px;\r\n\tborder-right-color: #fff;\r\n\t}\r\n\r\n/* Printing */\r\n\r\n@media print {\r\n\t/* Prevent printers from removing background-images of controls. */\r\n\t.leaflet-control {\r\n\t\t-webkit-print-color-adjust: exact;\r\n\t\tprint-color-adjust: exact;\r\n\t\t}\r\n\t}\r\n";

  // ═══════════════════════════════════════════════════════════
  // Utilities
  // ═══════════════════════════════════════════════════════════
  function esc(s) {
    if (s === null || s === undefined) return '';
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  }
  function safeUrl(u) {
    if (!u) return '';
    const s = String(u).trim();
    if (!s) return '';
    if (/^javascript:/i.test(s) || /^vbscript:/i.test(s)) return '';
    if (/^data:/i.test(s)) return '';
    if (/^(https?:|mailto:|tel:|#|\/|\?)/i.test(s)) return s;
    if (/^[a-z0-9.-]+\.[a-z]{2,}/i.test(s)) return 'https://' + s;
    return '';
  }
  function safeImageUrl(u) {
    if (!u) return '';
    const s = String(u).trim();
    if (!s) return '';
    if (/^javascript:/i.test(s) || /^vbscript:/i.test(s)) return '';
    if (/^data:/i.test(s) && !/^data:image\//i.test(s)) return '';
    return s;
  }
  function num(v) {
    if (v === '' || v === null || v === undefined) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  function coord(loc) {
    const lat = num(loc && loc.lat), lng = num(loc && loc.lng);
    if (lat === null || lng === null) return null;
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
    return { lat: lat, lng: lng };
  }
  function safeFont(f) {
    if (!f) return '';
    return String(f).replace(/[^a-z0-9 ,'"\-]/gi, '').slice(0, 120);
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
  function safeColor(c, fallback) {
    if (typeof c === 'string' && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(c.trim())) return c.trim();
    return fallback;
  }
  function pinSvg(color) {
    const c = safeColor(color, '#0891B2');
    return '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="42" viewBox="0 0 32 42">' +
      '<path d="M16 0C7.7 0 1 6.7 1 15c0 10.5 13.2 25.4 13.8 26a1.6 1.6 0 0 0 2.4 0C17.8 40.4 31 25.5 31 15 31 6.7 24.3 0 16 0z" ' +
      'fill="' + c + '" stroke="#ffffff" stroke-width="2"/>' +
      '<circle cx="16" cy="15" r="5.5" fill="#ffffff"/></svg>';
  }

  const IC = {
    plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
    minus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M5 12h14"/></svg>',
    locate: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/></svg>',
    close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    pin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z"/><circle cx="12" cy="10" r="3"/></svg>',
    directions: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="3 11 22 2 13 21 11 13 3 11"/></svg>',
    external: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><path d="M15 3h6v6M10 14L21 3"/></svg>',
    warn: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/></svg>',
  };
  function icon(n) { return IC[n] || ''; }

  // ═══════════════════════════════════════════════════════════
  // Defaults
  // ═══════════════════════════════════════════════════════════
  const DEFAULTS = {
    title: '', subtitle: '',
    locations: [],
    mapStyle: 'streets',      // streets | minimal | muted | dark | satellite | auto
    zoom: 13,                 // used when not auto-fitting / single location
    autoFit: true,
    center: null,
    height: 460,
    accent: '#0891B2',
    showControls: true,
    scrollWheel: false,       // off by default — embed-friendly (use +/- or pinch)
    showList: 'auto',         // auto | always | never
    showInfoCard: true,
    directionsButton: true,
    openFirst: false,
    theme: 'light',           // light | dark | auto
    fontFamily: '',
    radius: 16,
    mapKey: '',               // optional MapTiler key override
  };

  // ═══════════════════════════════════════════════════════════
  // Widget chrome styles (Shadow DOM)
  // ═══════════════════════════════════════════════════════════
  function buildStyles() {
    return LEAFLET_CSS + `
:host { all: initial; display: block; }
.tgm-root *, .tgm-root *::before, .tgm-root *::after { box-sizing: border-box; }
.tgm-root {
  --tgm-accent:#0891B2; --tgm-bg:#fff; --tgm-surface:#fff; --tgm-surface-2:#f8fafc;
  --tgm-text:#0f172a; --tgm-sub:#64748b; --tgm-border:#e2e8f0;
  --tgm-shadow:0 10px 15px rgba(15,23,42,.08),0 4px 6px rgba(15,23,42,.04);
  --tgm-shadow-sm:0 1px 3px rgba(15,23,42,.10),0 1px 2px rgba(15,23,42,.05);
  --tgm-radius:16px;
  font-family: var(--tgm-font,'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif);
  color: var(--tgm-text); line-height: 1.6; -webkit-font-smoothing: antialiased;
}
.tgm-root[data-theme="dark"] {
  --tgm-bg:#0f172a; --tgm-surface:#1e293b; --tgm-surface-2:#16233b;
  --tgm-text:#f8fafc; --tgm-sub:#94a3b8; --tgm-border:#334155;
  --tgm-shadow:0 10px 15px rgba(0,0,0,.35),0 4px 6px rgba(0,0,0,.25);
  --tgm-shadow-sm:0 1px 3px rgba(0,0,0,.35);
}
.tgm-head { margin: 0 0 14px; }
.tgm-title { margin:0; font-size:22px; font-weight:700; letter-spacing:-.01em; color:var(--tgm-text); }
.tgm-subtitle { margin:4px 0 0; font-size:15px; color:var(--tgm-sub); }

.tgm-shell {
  position:relative; display:grid; grid-template-columns:1fr; gap:0;
  border:1px solid var(--tgm-border); border-radius:var(--tgm-radius); overflow:hidden;
  background:var(--tgm-surface); box-shadow:var(--tgm-shadow);
}
.tgm-shell.has-list { grid-template-columns:280px 1fr; }

.tgm-list { border-right:1px solid var(--tgm-border); background:var(--tgm-surface); overflow-y:auto; max-height:var(--tgm-h,460px); }
.tgm-list-item {
  display:flex; gap:10px; align-items:flex-start; width:100%; text-align:left;
  padding:14px 16px; border:0; border-bottom:1px solid var(--tgm-border);
  background:transparent; cursor:pointer; color:var(--tgm-text); font:inherit; transition:background .15s ease;
}
.tgm-list-item:hover { background:var(--tgm-surface-2); }
.tgm-list-item.is-active { background:color-mix(in srgb,var(--tgm-accent) 10%,transparent); }
.tgm-list-item:focus-visible { outline:2px solid var(--tgm-accent); outline-offset:-2px; }
.tgm-li-dot { flex:0 0 auto; width:14px; height:18px; margin-top:2px; }
.tgm-li-dot svg { width:14px; height:18px; }
.tgm-li-body { min-width:0; }
.tgm-li-title { font-size:14px; font-weight:600; line-height:1.35; }
.tgm-li-sub { font-size:12px; color:var(--tgm-sub); margin-top:2px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }

.tgm-stage { position:relative; min-width:0; }
.tgm-map { width:100%; height:var(--tgm-h,460px); background:var(--tgm-surface-2); }
.tgm-map.leaflet-container { font:inherit; background:var(--tgm-surface-2); }

/* Custom coloured pins (Leaflet divIcon) */
.tgm-pin { filter: drop-shadow(0 2px 3px rgba(0,0,0,.30)); cursor:pointer; }
.tgm-pin svg { display:block; transition: transform .12s ease; }
.tgm-pin:hover svg { transform: translateY(-2px) scale(1.06); }

/* Attribution (license-required) — themed */
.tgm-root .leaflet-control-attribution {
  background: rgba(255,255,255,.82) !important; color:#64748b !important;
  font-size:10px !important; padding:1px 6px !important;
}
.tgm-root .leaflet-control-attribution a { color:#475569 !important; }
.tgm-root[data-theme="dark"] .leaflet-control-attribution { background: rgba(15,23,42,.82) !important; color:#94a3b8 !important; }
.tgm-root[data-theme="dark"] .leaflet-control-attribution a { color:#cbd5e1 !important; }

/* Custom controls */
.tgm-ctrls { position:absolute; right:12px; bottom:12px; display:flex; flex-direction:column; gap:8px; z-index:600; }
.tgm-ctrl {
  width:40px; height:40px; display:grid; place-items:center;
  border:1px solid var(--tgm-border); border-radius:10px; background:var(--tgm-surface);
  color:var(--tgm-text); cursor:pointer; box-shadow:var(--tgm-shadow-sm);
  transition:transform .12s ease, background .15s ease;
}
.tgm-ctrl:hover { background:var(--tgm-surface-2); }
.tgm-ctrl:active { transform:scale(.94); }
.tgm-ctrl:focus-visible { outline:2px solid var(--tgm-accent); outline-offset:2px; }
.tgm-ctrl svg { width:18px; height:18px; }
.tgm-zoom { display:flex; flex-direction:column; border-radius:10px; overflow:hidden; box-shadow:var(--tgm-shadow-sm); }
.tgm-zoom .tgm-ctrl { border-radius:0; box-shadow:none; }
.tgm-zoom .tgm-ctrl + .tgm-ctrl { border-top:0; }

/* Info card (our own — not a Leaflet popup) */
.tgm-card {
  position:absolute; left:12px; right:12px; bottom:12px; max-width:360px; z-index:700;
  background:var(--tgm-surface); border:1px solid var(--tgm-border);
  border-radius:14px; box-shadow:var(--tgm-shadow); overflow:hidden;
  opacity:0; transform:translateY(10px); pointer-events:none;
  transition:opacity .2s ease, transform .2s ease;
}
.tgm-card.is-open { opacity:1; transform:translateY(0); pointer-events:auto; }
.tgm-card-img { width:100%; height:132px; object-fit:cover; display:block; background:var(--tgm-surface-2); }
.tgm-card-body { padding:14px 16px 16px; position:relative; }
.tgm-card-close {
  position:absolute; top:10px; right:10px; width:28px; height:28px; display:grid; place-items:center;
  border:0; border-radius:8px; background:rgba(15,23,42,.06); color:var(--tgm-text); cursor:pointer;
}
.tgm-root[data-theme="dark"] .tgm-card-close { background:rgba(255,255,255,.12); }
.tgm-card-close svg { width:15px; height:15px; }
.tgm-card-close:focus-visible { outline:2px solid var(--tgm-accent); outline-offset:2px; }
.tgm-card.has-img .tgm-card-close { background:rgba(0,0,0,.45); color:#fff; }
.tgm-card-title { margin:0 28px 0 0; font-size:16px; font-weight:700; line-height:1.3; }
.tgm-card-addr { margin:4px 0 0; font-size:13px; color:var(--tgm-sub); }
.tgm-card-desc { margin:8px 0 0; font-size:13px; color:var(--tgm-text); }
.tgm-card-actions { display:flex; flex-wrap:wrap; gap:8px; margin-top:12px; }
.tgm-btn {
  display:inline-flex; align-items:center; gap:6px; height:36px; padding:0 14px;
  border-radius:9px; font-size:13px; font-weight:600; cursor:pointer; text-decoration:none;
  border:1px solid transparent; transition:filter .15s ease;
}
.tgm-btn svg { width:15px; height:15px; }
.tgm-btn-primary { background:var(--tgm-accent); color:#fff; }
.tgm-btn-primary:hover { filter:brightness(.94); }
.tgm-btn-ghost { background:transparent; border-color:var(--tgm-border); color:var(--tgm-text); }
.tgm-btn-ghost:hover { background:var(--tgm-surface-2); }
.tgm-btn:focus-visible { outline:2px solid var(--tgm-accent); outline-offset:2px; }

/* States */
.tgm-state { display:flex; flex-direction:column; align-items:center; justify-content:center; gap:10px; height:var(--tgm-h,460px); padding:24px; text-align:center; color:var(--tgm-sub); background:var(--tgm-surface-2); }
.tgm-state svg { width:32px; height:32px; opacity:.6; }
.tgm-state-title { font-size:15px; font-weight:600; color:var(--tgm-text); }
.tgm-state-sub { font-size:13px; max-width:320px; }
.tgm-skel { position:relative; overflow:hidden; }
.tgm-skel::after { content:''; position:absolute; inset:0; background:linear-gradient(90deg,transparent,rgba(148,163,184,.18),transparent); transform:translateX(-100%); animation:tgm-shimmer 1.4s infinite; }
@keyframes tgm-shimmer { 100% { transform:translateX(100%); } }

@media (max-width:640px) {
  .tgm-shell.has-list { grid-template-columns:1fr; }
  .tgm-shell.has-list .tgm-list { grid-row:2; border-right:0; border-top:1px solid var(--tgm-border); max-height:200px; }
  .tgm-card { left:8px; right:8px; bottom:8px; max-width:none; }
}
@media (prefers-reduced-motion: reduce) {
  .tgm-card, .tgm-ctrl, .tgm-list-item, .tgm-btn, .tgm-pin svg { transition:none; }
  .tgm-skel::after { animation:none; }
}
`;
  }

  // ═══════════════════════════════════════════════════════════
  // Widget
  // ═══════════════════════════════════════════════════════════
  class TGMapsWidget {
    constructor(container, config) {
      this.el = container;
      this.cfg = Object.assign({}, DEFAULTS, config || {});
      ensureFont(this.cfg.fontFamily); // load the client-chosen web font on the host site (house rule 2)
      this.t = makeT(this.cfg);   // resolve viewer language + UI strings
      this.shadow = container.shadowRoot || container.attachShadow({ mode: 'open' });
      this.map = null;
      this.markers = [];
      this.activeIdx = -1;
      this._onResize = () => { if (this.map) this.map.invalidateSize(); };
      this._render();
    }

    _validLocations() {
      const list = Array.isArray(this.cfg.locations) ? this.cfg.locations : [];
      return list.map((l, i) => {
        const c = coord(l);
        if (!c) return null;
        return {
          idx: i,
          title: l.title || '',
          address: l.address || '',
          description: l.description || '',
          image: safeImageUrl(l.image),
          link: safeUrl(l.link),
          linkLabel: l.linkLabel || this.t('visitWebsite'),
          color: safeColor(l.color, safeColor(this.cfg.accent, '#0891B2')),
          lat: c.lat, lng: c.lng,
        };
      }).filter(Boolean);
    }

    _themeMode() {
      const t = this.cfg.theme || 'light';
      if (t === 'auto' && typeof window !== 'undefined' && window.matchMedia) {
        return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
      }
      return t === 'dark' ? 'dark' : 'light';
    }

    _render() {
      const accent = safeColor(this.cfg.accent, '#0891B2');
      const theme = this._themeMode();
      const h = Math.max(220, num(this.cfg.height) || 460);
      const radius = Math.max(0, num(this.cfg.radius) != null ? num(this.cfg.radius) : 16);
      const locs = this._validLocations();
      const wantList = this.cfg.showList === 'always' ? true : this.cfg.showList === 'never' ? false : locs.length > 1;

      const head = (this.cfg.title || this.cfg.subtitle) ? `
        <div class="tgm-head">
          ${this.cfg.title ? `<h3 class="tgm-title">${esc(this.cfg.title)}</h3>` : ''}
          ${this.cfg.subtitle ? `<p class="tgm-subtitle">${esc(this.cfg.subtitle)}</p>` : ''}
        </div>` : '';

      const list = wantList && locs.length ? `
        <div class="tgm-list" role="listbox" aria-label="${esc(this.t('locations'))}">
          ${locs.map((l) => `
            <button class="tgm-list-item" type="button" role="option" data-idx="${l.idx}" aria-selected="false">
              <span class="tgm-li-dot" style="color:${esc(l.color)}">${icon('pin')}</span>
              <span class="tgm-li-body">
                <span class="tgm-li-title">${esc(l.title || this.t('location'))}</span>
                ${l.address ? `<span class="tgm-li-sub">${esc(l.address)}</span>` : ''}
              </span>
            </button>`).join('')}
        </div>` : '';

      const ctrls = this.cfg.showControls ? `
        <div class="tgm-ctrls">
          <div class="tgm-zoom">
            <button class="tgm-ctrl" type="button" data-act="zoom-in" aria-label="${esc(this.t('zoomIn'))}">${icon('plus')}</button>
            <button class="tgm-ctrl" type="button" data-act="zoom-out" aria-label="${esc(this.t('zoomOut'))}">${icon('minus')}</button>
          </div>
          ${locs.length ? `<button class="tgm-ctrl" type="button" data-act="recenter" aria-label="${esc(this.t('recentre'))}">${icon('locate')}</button>` : ''}
        </div>` : '';

      this.shadow.innerHTML = `
        <style>${buildStyles()}</style>
        <div class="tgm-root" data-theme="${theme}" style="
          --tgm-accent:${esc(accent)}; --tgm-h:${h}px; --tgm-radius:${radius}px;
          ${this.cfg.fontFamily ? `--tgm-font:${safeFont(this.cfg.fontFamily)}, 'Inter', sans-serif;` : ''}">
          ${head}
          <div class="tgm-shell ${wantList && locs.length ? 'has-list' : ''}">
            ${list}
            <div class="tgm-stage">
              <div class="tgm-map tgm-skel" aria-label="${esc(this.t('map'))}"></div>
              ${ctrls}
              <div class="tgm-card" role="dialog" aria-live="polite" aria-label="${esc(this.t('locationDetails'))}" hidden></div>
            </div>
          </div>
        </div>`;

      this.root = this.shadow.querySelector('.tgm-root');
      this.mapEl = this.shadow.querySelector('.tgm-map');
      this.cardEl = this.shadow.querySelector('.tgm-card');
      this._locs = locs;
      this._bindChrome();

      if (!locs.length) {
        this._renderState('empty', this.t('emptyTitle'), this.t('emptySub'));
        return;
      }

      loadLeaflet()
        .then((L) => this._initMap(L))
        .catch(() => this._renderState('error', this.t('errorTitle'), this.t('errorSub')));
    }

    _initMap(L) {
      this.mapEl.classList.remove('tgm-skel');
      const locs = this._locs;
      const first = locs[0];
      const theme = this._themeMode();

      this.map = L.map(this.mapEl, {
        zoomControl: false,
        attributionControl: true,
        scrollWheelZoom: !!this.cfg.scrollWheel,
        dragging: true,
        touchZoom: true,
        doubleClickZoom: true,
        minZoom: 1,
        maxZoom: 19,
        center: (this.cfg.center && coord(this.cfg.center)) ? [coord(this.cfg.center).lat, coord(this.cfg.center).lng] : [first.lat, first.lng],
        zoom: Math.min(19, Math.max(1, num(this.cfg.zoom) || 13)),
      });
      this.map.attributionControl.setPosition('bottomleft');

      const slug = styleSlug(this.cfg.mapStyle, theme);
      const mapKey = this.cfg.mapKey || MAPTILER_KEY;
      const tileUrl = 'https://api.maptiler.com/maps/' + slug + '/{z}/{x}/{y}.png?key=' + encodeURIComponent(mapKey);
      L.tileLayer(tileUrl, { attribution: TILE_ATTRIBUTION, maxZoom: 19, crossOrigin: true }).addTo(this.map);

      this.bounds = L.latLngBounds(locs.map((l) => [l.lat, l.lng]));
      this.markers = locs.map((l) => {
        const m = L.marker([l.lat, l.lng], {
          title: l.title || l.address || '',
          icon: L.divIcon({ html: pinSvg(l.color), className: 'tgm-pin', iconSize: [32, 42], iconAnchor: [16, 42] }),
          riseOnHover: true,
          keyboard: false,
        });
        m.on('click', () => this._select(l.idx));
        m.addTo(this.map);
        return m;
      });

      if (locs.length > 1 && this.cfg.autoFit !== false) {
        this.map.fitBounds(this.bounds, { padding: [48, 48], maxZoom: 16 });
      } else {
        this.map.setView([first.lat, first.lng], Math.min(19, Math.max(1, num(this.cfg.zoom) || 14)));
      }

      // Leaflet needs a size recalc once the container is laid out / visible,
      // and again whenever the container resizes (editor viewport switches,
      // responsive embeds). ResizeObserver covers both; window resize is a fallback.
      setTimeout(() => { if (this.map) this.map.invalidateSize(); }, 0);
      setTimeout(() => { if (this.map) this.map.invalidateSize(); }, 250);
      if (typeof ResizeObserver !== 'undefined') {
        this._ro = new ResizeObserver(() => { if (this.map) this.map.invalidateSize(); });
        this._ro.observe(this.mapEl);
      } else {
        window.addEventListener('resize', this._onResize);
      }

      if (this.cfg.openFirst && this.cfg.showInfoCard) setTimeout(() => this._select(first.idx), 80);
    }

    _bindChrome() {
      this.shadow.querySelectorAll('.tgm-list-item').forEach((btn) => {
        btn.addEventListener('click', () => this._select(parseInt(btn.getAttribute('data-idx'), 10)));
      });
      this.shadow.querySelectorAll('.tgm-ctrl').forEach((btn) => {
        btn.addEventListener('click', () => {
          if (!this.map) return;
          const act = btn.getAttribute('data-act');
          if (act === 'zoom-in') this.map.zoomIn();
          else if (act === 'zoom-out') this.map.zoomOut();
          else if (act === 'recenter') {
            if (this._locs.length > 1 && this.bounds) this.map.fitBounds(this.bounds, { padding: [48, 48], maxZoom: 16 });
            else if (this._locs.length === 1) this.map.setView([this._locs[0].lat, this._locs[0].lng], num(this.cfg.zoom) || 14);
          }
        });
      });
    }

    _select(idx) {
      const loc = this._locs.find((l) => l.idx === idx);
      if (!loc) return;
      this.activeIdx = idx;
      if (this.map) {
        this.map.panTo([loc.lat, loc.lng]);
        if ((this.map.getZoom() || 0) < 13) this.map.setZoom(14);
      }
      this.shadow.querySelectorAll('.tgm-list-item').forEach((b) => {
        const on = parseInt(b.getAttribute('data-idx'), 10) === idx;
        b.classList.toggle('is-active', on);
        b.setAttribute('aria-selected', on ? 'true' : 'false');
      });
      if (this.cfg.showInfoCard) this._showCard(loc);
    }

    _showCard(loc) {
      const dir = this.cfg.directionsButton
        ? 'https://www.google.com/maps/dir/?api=1&destination=' + encodeURIComponent(loc.lat + ',' + loc.lng)
        : '';
      const hasImg = !!loc.image;
      this.cardEl.classList.toggle('has-img', hasImg);
      this.cardEl.innerHTML = `
        ${hasImg ? `<img class="tgm-card-img" src="${esc(loc.image)}" alt="${esc(loc.title || this.t('location'))}" loading="lazy">` : ''}
        <div class="tgm-card-body">
          <button class="tgm-card-close" type="button" aria-label="${esc(this.t('close'))}">${icon('close')}</button>
          <h4 class="tgm-card-title">${esc(loc.title || this.t('location'))}</h4>
          ${loc.address ? `<p class="tgm-card-addr">${esc(loc.address)}</p>` : ''}
          ${loc.description ? `<p class="tgm-card-desc">${esc(loc.description)}</p>` : ''}
          <div class="tgm-card-actions">
            ${dir ? `<a class="tgm-btn tgm-btn-primary" href="${esc(dir)}" target="_blank" rel="noopener noreferrer">${icon('directions')} ${esc(this.t('getDirections'))}</a>` : ''}
            ${loc.link ? `<a class="tgm-btn tgm-btn-ghost" href="${esc(loc.link)}" target="_blank" rel="noopener noreferrer">${icon('external')} ${esc(loc.linkLabel || this.t('visitWebsite'))}</a>` : ''}
          </div>
        </div>`;
      this.cardEl.hidden = false;
      void this.cardEl.offsetWidth;
      this.cardEl.classList.add('is-open');
      const close = this.cardEl.querySelector('.tgm-card-close');
      if (close) close.addEventListener('click', () => this._hideCard());
      // Hide the card image if it fails to load so a broken or hotlink-blocked
      // URL never shows the browser's broken-image glyph. CSP-safe: attached
      // here, not via inline onerror.
      const cardImg = this.cardEl.querySelector('.tgm-card-img');
      if (cardImg) {
        cardImg.addEventListener('error', () => {
          cardImg.remove();
          this.cardEl.classList.remove('has-img');
        }, { once: true });
      }
    }

    _hideCard() {
      this.cardEl.classList.remove('is-open');
      this.activeIdx = -1;
      this.shadow.querySelectorAll('.tgm-list-item').forEach((b) => { b.classList.remove('is-active'); b.setAttribute('aria-selected', 'false'); });
      setTimeout(() => { if (!this.cardEl.classList.contains('is-open')) this.cardEl.hidden = true; }, 220);
    }

    _renderState(kind, title, sub) {
      const stage = this.shadow.querySelector('.tgm-stage');
      if (!stage) return;
      stage.innerHTML = `
        <div class="tgm-state" role="status">
          ${kind === 'error' ? icon('warn') : icon('pin')}
          <div class="tgm-state-title">${esc(title)}</div>
          <div class="tgm-state-sub">${esc(sub)}</div>
        </div>`;
    }

    update(newConfig) {
      this.cfg = Object.assign({}, this.cfg, newConfig || {});
      ensureFont(this.cfg.fontFamily); // load the client-chosen web font on the host site (house rule 2)
      this.t = makeT(this.cfg);
      this.destroy(true);
      this._render();
    }

    destroy(keepShadow) {
      try { window.removeEventListener('resize', this._onResize); } catch (e) {}
      try { if (this._ro) { this._ro.disconnect(); this._ro = null; } } catch (e) {}
      try { if (this.map) this.map.remove(); } catch (e) {}
      this.markers = [];
      this.map = null;
      if (!keepShadow && this.shadow) this.shadow.innerHTML = '';
    }
  }

  // ═══════════════════════════════════════════════════════════
  // Boot
  // ═══════════════════════════════════════════════════════════
  async function fetchConfig(id) {
    try {
      const r = await fetch(API_BASE + '?id=' + encodeURIComponent(id), { method: 'GET', credentials: 'omit' });
      if (!r.ok) return null;
      const data = await r.json();
      return data && data.config ? data.config : null;
    } catch (e) { return null; }
  }

  async function init() {
    const containers = document.querySelectorAll('[data-tg-widget="maps"]');
    for (const el of containers) {
      if (el.__tgInited) continue;
      el.__tgInited = true;
      let cfg = null;
      const inline = el.getAttribute('data-tg-config');
      if (inline) { try { cfg = JSON.parse(inline); } catch (e) { cfg = null; } }
      else { const id = el.getAttribute('data-tg-id'); if (id) cfg = await fetchConfig(id); }
      try { new TGMapsWidget(el, cfg || {}); }
      catch (e) { if (window.console) console.error('[TGMaps] init failed', e); }
    }
  }

  window.TGMapsWidget = TGMapsWidget;
  window.__TG_MAPS_VERSION__ = VERSION;

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
