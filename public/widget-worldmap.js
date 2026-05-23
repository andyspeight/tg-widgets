/**
 * Travelgenix World Map Widget v3.2.0
 * Real-map version using Leaflet + CartoDB Voyager tiles.
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
 * Envelope mode only in this version. Fullscreen mode comes later.
 */
(function () {
  'use strict';

  const VERSION = '3.2.0';
  const API_BASE = (typeof window !== 'undefined' && window.__TG_WIDGET_API__) || '';
  const OFFERS_URL = API_BASE + '/api/destination-map-offers';
  const CONFIG_URL = API_BASE + '/api/widget-config';

  const LEAFLET_JS_URL = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';

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
  function formatPrice(p, currency) {
    if (!Number.isFinite(p) || p <= 0) return '';
    const sym = currency === 'GBP' ? '£' : currency === 'EUR' ? '€' : currency === 'USD' ? '$' : '';
    return sym + Math.round(p).toLocaleString('en-GB');
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
  function resolveCountryName(c) {
    return c.country || COUNTRY_NAMES[c.countryCode] || c.countryCode || 'Destination';
  }

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
      gap: 5px;
      padding: 5px 10px;
      background: #FFFFFF;
      border: 1px solid #E2E8F0;
      border-radius: 999px;
      font-size: 12px;
      font-weight: 700;
      line-height: 1;
      box-shadow: 0 2px 6px rgba(15,23,42,.12), 0 1px 2px rgba(15,23,42,.06);
      white-space: nowrap;
      cursor: pointer;
      transition: transform 180ms var(--tgwm-ease), box-shadow 180ms, border-color 180ms;
      color: #0F172A;
    }
    .tg-price-tag:hover {
      transform: translateY(-2px) scale(1.05);
      box-shadow: 0 6px 16px rgba(15,23,42,.16), 0 2px 4px rgba(15,23,42,.08);
      border-color: var(--tgwm-pin-anchor-active);
    }
    .tg-price-tag .tg-tag-country {
      color: #64748B;
      font-weight: 500;
    }
    .tg-price-tag .tg-tag-price {
      color: #0F172A;
      font-weight: 700;
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
      box-shadow: 0 4px 12px rgba(15,23,42,.18);
      transition: transform 160ms var(--tgwm-ease), box-shadow 160ms;
    }
    .tgwm-fs-btn:hover {
      transform: translateY(-1px);
      box-shadow: 0 8px 20px rgba(15,23,42,.24);
    }
    .tgwm-fs-btn:active { transform: translateY(0); }
    .tgwm-fs-btn svg { width: 14px; height: 14px; }
    @media (prefers-reduced-motion: reduce) { .tgwm-fs-btn { transition: none; } }
  `;

  const DEFAULTS = {
    theme: 'light',
    title: 'Where will you go next?',
    subtitle: 'Browse our latest offers from around the world',
    ctaLabel: 'View fullscreen',
    showFullscreenButton: true,
    // Click handler url — opened in new tab when fullscreen button clicked.
    // Fullscreen overlay (modal on same page) is a future enhancement.
    fullscreenUrl: '',
    // Origin airport code shown in pin context, also used for fullscreen link.
    origin: 'LGW',
    // How many top destinations to show in envelope mode. World view gets crowded fast.
    maxPins: 10,
    // Optional per-widget MapTiler key override. Leave empty to use the shared key.
    mapKey: '',
  };

  // ── Widget class

  class TGWorldMapWidget {
    constructor(container, config) {
      if (!container) return;
      this.host = container;
      this.cfg = Object.assign({}, DEFAULTS, config || {});
      this.shadow = container.attachShadow({ mode: 'open' });
      this.data = null;
      this.map = null;
      this.markers = [];
      this._render();
      this._init();
    }

    async _init() {
      try {
        const [L, offers] = await Promise.all([
          loadLeaflet(),
          this._loadOffers(),
        ]);
        this.data = offers;
        this._renderMap(L);
        this._hideLoading();
      } catch (e) {
        console.warn('[tgwm v3] init failed:', e.message);
        this._showError('Map unavailable. Please try again later.');
      }
    }

    async _loadOffers() {
      const res = await fetch(OFFERS_URL, { credentials: 'omit' });
      if (!res.ok) throw new Error('offers HTTP ' + res.status);
      return await res.json();
    }

    _render() {
      const c = this.cfg;
      const html = `
        <style>${LEAFLET_CSS}${STYLES}</style>
        <div class="tgwm-root" data-theme="${esc(c.theme)}">
          <div class="tgwm-header">
            <h2 class="tgwm-title">${esc(c.title)}</h2>
            <p class="tgwm-subtitle">${esc(c.subtitle)}</p>
          </div>
          <div class="tgwm-map-wrap">
            <div class="tgwm-map" data-map></div>
            <div class="tgwm-loading" data-loading>
              <div class="tgwm-spinner" aria-hidden="true"></div>
              <span data-loading-text>Loading map…</span>
            </div>
            ${c.showFullscreenButton ? `
              <button class="tgwm-fs-btn" data-fs-btn aria-label="View map in fullscreen">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <polyline points="15 3 21 3 21 9"/>
                  <polyline points="9 21 3 21 3 15"/>
                  <line x1="21" y1="3" x2="14" y2="10"/>
                  <line x1="3" y1="21" x2="10" y2="14"/>
                </svg>
                <span>${esc(c.ctaLabel)}</span>
              </button>` : ''}
          </div>
        </div>
      `;
      this.shadow.innerHTML = html;
      this._bind();
    }

    _bind() {
      const fsBtn = this.shadow.querySelector('[data-fs-btn]');
      if (fsBtn) {
        fsBtn.addEventListener('click', () => this._openFullscreen());
      }
    }

    _openFullscreen() {
      const url = this.cfg.fullscreenUrl;
      if (url) {
        const safe = safeUrl(url);
        if (safe !== '#') window.open(safe, '_blank', 'noopener');
        return;
      }
      // No URL configured — log placeholder for now. Modal mode comes next session.
      console.info('[tgwm v3] Fullscreen mode coming soon — configure fullscreenUrl for now');
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

      // Collision check at world-zoom projection (z=2, viewBox-ish):
      // Two pins within ~12 latitude AND ~35 longitude overlap visually.
      // Walk from highest-scored down, accept each pin only if no accepted pin is too close.
      const MIN_LAT = 12;
      const MIN_LNG = 35;
      const max = this.cfg.maxPins || 10;
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

    _renderMap(L) {
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

      // Fit world — slightly off-centre and zoomed to crop Antarctica
      this.map.setView([25, 10], 2);

      // Drop the pins
      for (const c of featured) {
        const name = resolveCountryName(c);
        // Per-person price per the locked display rule (£460 total shows as £230).
        const priceLabel = formatPrice(c.fromPricePP || c.fromPrice, c.currency);
        const html = `
          <div class="tg-pin-wrap" data-country="${esc(name)}">
            <div class="tg-price-tag" title="${esc(name)} — from ${esc(priceLabel)} per person">
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
      // In envelope mode, clicking a pin opens fullscreen (deal cards happen there).
      // For now we just emit a console event — proper hook comes when fullscreen exists.
      console.info('[tgwm v3] pin clicked:', resolveCountryName(country), '— fullscreen flow will pick this up');
      this._openFullscreen();
    }

    update(newConfig) {
      this.cfg = Object.assign({}, this.cfg, newConfig || {});
      if (this.map) {
        this.map.remove();
        this.map = null;
        this.markers = [];
      }
      this._render();
      this._init();
    }

    destroy() {
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
