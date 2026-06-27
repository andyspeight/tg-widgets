/* ============================================================================
 * widget-offer-builder.js  ·  Travelgenix Widget Suite
 * Special Offer Builder — the creation form (v0.1.0)
 *
 * An embeddable, shadow-DOM widget that lets a travel agent build a single
 * special offer by filling a simple form, optionally drafted for them by AI
 * from a plain-English description. This file is ONLY the form: it collects
 * and validates the offer, then fires a `tg-offer-created` event with the
 * structured offer object. The card output and the public offer page are
 * deliberately not built yet (see roadmap), so on submit the widget shows a
 * success panel and hands the data back to the host.
 *
 * Embed:
 *   <div data-tg-widget="offer-builder" data-tg-id="YOUR_WIDGET_ID"></div>
 * or inline (demo / preview):
 *   <div data-tg-widget="offer-builder" data-tg-config='{...}'></div>
 *
 * Conventions match widget-offers.js: IIFE, Shadow DOM, scoped --tgo-* tokens,
 * theme + brand config, CSP-clean (no inline handlers), auto-init.
 * ========================================================================== */
(function () {
  'use strict';

  const VERSION = '0.1.0';
  const API_BASE = '/api/widget-config';

  // ── Small helpers ─────────────────────────────────────────────────────────
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function currencySymbol(code) {
    return { GBP: '£', EUR: '€', USD: '$', AUD: '$', CAD: '$' }[code] || '£';
  }
  // Build an <option> list, marking `selected` when it matches.
  function options(list, selected) {
    return list.map(function (o) {
      const v = typeof o === 'string' ? o : o.value;
      return '<option' + (v === selected ? ' selected' : '') + '>' + esc(v) + '</option>';
    }).join('');
  }

  // ── Default option lists (host-overridable via config) ────────────────────
  const OFFER_TYPES = [
    'Package holiday (flight + hotel)', 'Hotel / accommodation only', 'Flight only',
    'City break', 'Cruise', 'Escorted tour', 'Multi-centre', 'Ski holiday',
    'Rail holiday', 'Excursion / day trip'
  ];
  const HOLIDAY_STYLES = [
    'All inclusive', 'Beach & resort', 'Family', 'Adults only', 'Luxury',
    'Honeymoon', 'Adventure', 'Culture & sightseeing'
  ];
  const STAR_RATINGS = ['5 star', '4 star', '3 star', 'Unrated / villa'];
  const BOARD_BASES = ['All inclusive', 'Full board', 'Half board', 'Bed & breakfast', 'Room only', 'Self catering'];
  const DATE_MODES = ['Selected dates in a period', 'Fixed departure date', 'Flexible / call for dates'];
  const FLIGHT_TYPES = ['Direct', 'Connecting', 'Not included'];
  const PRICE_BASES = ['per person', 'per couple', 'per night', 'total holiday price'];
  const BADGES = ['Save', 'Last minute', 'Exclusive', 'Best seller', 'Selling fast', 'Free child place', 'No badge'];
  const PROTECTIONS = ['ATOL protected', 'ABTA member', 'Both', 'Neither'];
  const DEFAULT_INCLUDES = [
    'Return flights', 'Airport transfers', '23kg luggage', 'All meals & drinks',
    'ABTA / ATOL protection', 'Rep service', 'Kids stay free', 'Free cancellation'
  ];
  const DEFAULT_TAGS = [
    'Family friendly', 'Adults only', 'Beachfront', 'Honeymoon', 'Last minute',
    'Early bird', 'Spa', 'Kids club', 'Swim-up rooms'
  ];

  // Canned AI draft used for previews/demos when cfg.aiMock is true. The real
  // build posts the description to cfg.aiEndpoint and uses its response.
  const DEMO_DRAFT = {
    fields: {
      title: '7 nights all inclusive in Cancun',
      type: 'Package holiday (flight + hotel)',
      style: 'All inclusive',
      teaser: 'Beachfront five star on the white sands of Costa Mujeres',
      country: 'Mexico', region: 'Riviera Maya', resort: 'Costa Mujeres, Cancun',
      origin: 'London Gatwick', property: 'Riu Palace Costa Mujeres', stars: '5 star',
      board: 'All inclusive', nights: '7', datemode: 'Selected dates in a period',
      period: 'Sep 2026 to Apr 2027', airline: 'TUI Airways', flighttype: 'Direct',
      price: '899', basis: 'per person', was: '1299', deposit: '60',
      badge: 'Save', urgency: 'Only 4 left at this price',
      bookby: '31 July 2026', avail: 'Limited rooms at this price',
      mapAddress: 'Costa Mujeres, Cancun, Mexico', mapLat: '21.0419', mapLng: '-86.8126', mapStyle: 'streets',
      video: 'https://www.youtube.com/watch?v=Scxs7L0vhZ4',
      description: 'Wake up to white sand and turquoise sea at the Riu Palace Costa Mujeres, a five star beachfront resort on one of the quietest stretches of the Mexican Caribbean. This all inclusive deal covers your direct flights from Gatwick plus every meal, drink and snack once you arrive.\n\nWith four pools, a spa, a kids club and a string of restaurants, it suits couples and families alike. Children stay free on selected dates. Book by 31 July to lock in the saving.'
    },
    includes: ['Return flights', 'Airport transfers', '23kg luggage', 'All meals & drinks', 'ABTA / ATOL protection', 'Rep service', 'Kids stay free'],
    tags: ['Family friendly', 'Beachfront', 'Kids club']
  };

  // ── Scoped styles (shadow DOM, --tgo-* tokens shared with widget-offers) ──
  const STYLES = `
    :host { all: initial; }
    * { box-sizing: border-box; }
    .ob-root {
      --tgo-brand: #1B2B5B; --tgo-accent: #00B4D8; --tgo-accent-hover: #0096B7;
      --tgo-accent-soft: #E0F4FA; --tgo-ai: #7C3AED; --tgo-ai-soft: #F3E8FF;
      --tgo-bg: transparent; --tgo-card: #FFFFFF; --tgo-card-alt: #FAFBFC;
      --tgo-text: #0F172A; --tgo-sub: #475569; --tgo-muted: #94A3B8;
      --tgo-border: #E2E8F0; --tgo-success: #10B981; --tgo-success-soft: #D1FAE5;
      --tgo-warn: #D97706; --tgo-error: #DC2626; --tgo-radius: 14px;
      --tgo-shadow: 0 1px 2px rgba(15,23,42,0.04);
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      color: var(--tgo-text); line-height: 1.5; background: var(--tgo-bg);
      width: 100%; max-width: 920px; margin: 0 auto; display: block;
    }
    .ob-root[data-theme="dark"] {
      --tgo-card: #1E293B; --tgo-card-alt: #0F172A; --tgo-text: #F1F5F9;
      --tgo-sub: #94A3B8; --tgo-muted: #64748B; --tgo-border: #334155;
      --tgo-accent-soft: rgba(56,189,248,0.12); --tgo-ai-soft: rgba(124,58,237,0.18);
    }
    .ob-head h2 { font-size: 24px; font-weight: 800; margin: 0 0 6px; letter-spacing: -0.4px; }
    .ob-head p { color: var(--tgo-sub); font-size: 15px; margin: 0 0 22px; }

    /* AI box */
    .ob-ai {
      background: linear-gradient(135deg, var(--tgo-ai-soft) 0%, var(--tgo-accent-soft) 100%);
      border: 1px solid var(--tgo-ai-soft); border-radius: var(--tgo-radius);
      padding: 18px; margin-bottom: 22px;
    }
    .ob-ai-head { display: flex; align-items: center; gap: 10px; margin-bottom: 4px; }
    .ob-ai-spark {
      width: 30px; height: 30px; border-radius: 8px; flex-shrink: 0; color: #fff;
      background: linear-gradient(135deg, var(--tgo-ai), var(--tgo-accent));
      display: flex; align-items: center; justify-content: center; font-size: 16px;
    }
    .ob-ai-head h3 { margin: 0; font-size: 16px; font-weight: 700; }
    .ob-ai-sub { font-size: 13px; color: var(--tgo-sub); margin: 0 0 14px 40px; }
    .ob-ai-row { display: flex; gap: 10px; align-items: stretch; }
    .ob-ai-row textarea {
      flex: 1; resize: vertical; min-height: 56px; border: 1px solid var(--tgo-border);
      border-radius: 10px; padding: 12px 14px; font: inherit; font-size: 14px;
      background: var(--tgo-card); color: var(--tgo-text);
    }
    .ob-ai-row textarea:focus { outline: 2px solid var(--tgo-ai); border-color: var(--tgo-ai); }
    .ob-ai-go {
      background: var(--tgo-ai); color: #fff; border: 0; border-radius: 10px;
      padding: 0 22px; font: inherit; font-weight: 700; font-size: 14px; cursor: pointer;
      white-space: nowrap; display: inline-flex; align-items: center; gap: 8px;
    }
    .ob-ai-go:hover { background: #6d28d9; }
    .ob-ai-go:disabled { opacity: 0.6; cursor: default; }
    .ob-ai-status { font-size: 13px; font-weight: 600; margin: 12px 0 0 40px; display: none; }
    .ob-ai-status.show { display: block; }
    .ob-ai-status.ok { color: var(--tgo-success); }
    .ob-ai-status.err { color: var(--tgo-error); }
    .ob-ai-status.busy { color: var(--tgo-ai); }

    /* Fieldsets */
    .ob-fs {
      background: var(--tgo-card); border: 1px solid var(--tgo-border);
      border-radius: var(--tgo-radius); padding: 18px; margin-bottom: 18px;
      box-shadow: var(--tgo-shadow);
    }
    .ob-fs h4 { font-size: 15px; font-weight: 700; margin: 0 0 3px; }
    .ob-fs .hint { font-size: 12px; color: var(--tgo-muted); margin: 0 0 14px; }
    .ob-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 14px; }
    .ob-field { display: flex; flex-direction: column; gap: 5px; }
    .ob-field.wide { grid-column: 1 / -1; }
    .ob-field label {
      font-size: 11px; color: var(--tgo-sub); font-weight: 600; text-transform: uppercase;
      letter-spacing: 0.5px; display: flex; align-items: center; gap: 6px;
    }
    .ob-field .opt { text-transform: none; color: var(--tgo-muted); font-weight: 500; letter-spacing: 0; }
    .ob-field input, .ob-field select, .ob-field textarea {
      padding: 9px 11px; border: 1px solid var(--tgo-border); border-radius: 9px;
      font: inherit; font-size: 14px; background: var(--tgo-card); color: var(--tgo-text); width: 100%;
    }
    .ob-field textarea { resize: vertical; min-height: 70px; }
    .ob-field input:focus, .ob-field select:focus, .ob-field textarea:focus {
      outline: 2px solid var(--tgo-accent); outline-offset: 1px; border-color: var(--tgo-accent);
    }
    .ob-field.invalid input, .ob-field.invalid select { border-color: var(--tgo-error); }
    .ob-err { font-size: 11px; color: var(--tgo-error); font-weight: 600; display: none; }
    .ob-field.invalid .ob-err { display: block; }
    .ob-prefix { position: relative; }
    .ob-prefix .sym { position: absolute; left: 11px; top: 50%; transform: translateY(-50%); color: var(--tgo-muted); pointer-events: none; }
    .ob-prefix input { padding-left: 24px; }
    .ob-suffix { position: absolute; right: 11px; top: 50%; transform: translateY(-50%); color: var(--tgo-muted); font-size: 13px; pointer-events: none; }

    /* AI-filled marker */
    .ob-field.ai input, .ob-field.ai select, .ob-field.ai textarea {
      border-left: 3px solid var(--tgo-ai); background: color-mix(in srgb, var(--tgo-ai) 4%, var(--tgo-card));
    }
    .ob-chip {
      font-size: 9px; font-weight: 700; letter-spacing: 0.4px; text-transform: uppercase;
      background: var(--tgo-ai-soft); color: var(--tgo-ai); padding: 2px 6px; border-radius: 999px;
    }

    /* Chips + includes */
    .ob-chips { display: flex; flex-wrap: wrap; gap: 8px; }
    .ob-toggle {
      border: 1px solid var(--tgo-border); background: var(--tgo-card); color: var(--tgo-sub);
      border-radius: 999px; padding: 7px 14px; font: inherit; font-size: 13px; cursor: pointer;
    }
    .ob-toggle:hover { border-color: var(--tgo-accent); }
    .ob-toggle.on { background: var(--tgo-accent-soft); border-color: var(--tgo-accent); color: var(--tgo-accent-hover); font-weight: 600; }
    .ob-toggle.on::before { content: '✓ '; }
    .ob-incl { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 10px; }
    .ob-incl label {
      display: flex; align-items: center; gap: 9px; font-size: 14px; padding: 9px 12px;
      border: 1px solid var(--tgo-border); border-radius: 9px; background: var(--tgo-card-alt); cursor: pointer;
    }
    .ob-incl label.on { background: var(--tgo-success-soft); border-color: var(--tgo-success); }
    .ob-incl input { width: auto; }

    /* Images (stub at this stage) */
    .ob-upload {
      border: 2px dashed var(--tgo-border); border-radius: 10px; padding: 20px; text-align: center;
      color: var(--tgo-muted); font-size: 13px; background: var(--tgo-card-alt); cursor: pointer;
    }
    .ob-upload b { color: var(--tgo-accent); }

    /* Actions */
    .ob-actions { display: flex; gap: 12px; justify-content: flex-end; flex-wrap: wrap; margin-top: 4px; }
    .ob-btn {
      border-radius: 10px; padding: 12px 22px; font: inherit; font-weight: 700; font-size: 14px;
      cursor: pointer; border: 1px solid var(--tgo-border); background: var(--tgo-card); color: var(--tgo-sub);
    }
    .ob-btn:hover { border-color: var(--tgo-accent); color: var(--tgo-text); }
    .ob-btn.primary { background: var(--tgo-accent); border-color: var(--tgo-accent); color: #fff; }
    .ob-btn.primary:hover { background: var(--tgo-accent-hover); }

    /* Success panel */
    .ob-success { text-align: center; padding: 40px 24px; }
    .ob-success .tick {
      width: 64px; height: 64px; border-radius: 50%; margin: 0 auto 16px;
      background: var(--tgo-success-soft); color: var(--tgo-success);
      display: flex; align-items: center; justify-content: center; font-size: 30px;
    }
    .ob-success h3 { font-size: 20px; font-weight: 700; margin: 0 0 6px; }
    .ob-success p { color: var(--tgo-sub); margin: 0 0 18px; }
    .ob-summary {
      text-align: left; background: var(--tgo-card-alt); border: 1px solid var(--tgo-border);
      border-radius: 10px; padding: 14px 16px; max-width: 560px; margin: 0 auto 18px;
      font-size: 13px; color: var(--tgo-sub); max-height: 220px; overflow: auto;
      white-space: pre-wrap; font-family: ui-monospace, 'JetBrains Mono', monospace;
    }
    /* Saved-offer link block on the success panel */
    .ob-saved { max-width: 560px; margin: 0 auto 16px; text-align: left; }
    .ob-saved-label { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: var(--tgo-muted); margin-bottom: 6px; }
    .ob-saved-row { display: flex; gap: 8px; }
    .ob-saved-link { flex: 1; min-width: 0; padding: 9px 11px; border: 1px solid var(--tgo-border); border-radius: 9px; font-size: 13px; background: var(--tgo-card-alt); color: var(--tgo-text); font-family: ui-monospace, 'JetBrains Mono', monospace; }
    .ob-saved.err { background: color-mix(in srgb, var(--tgo-error) 8%, transparent); border: 1px solid color-mix(in srgb, var(--tgo-error) 30%, transparent); border-radius: 10px; padding: 12px 14px; font-size: 13px; color: var(--tgo-text); }
    @media (max-width: 560px) { .ob-ai-row { flex-direction: column; } .ob-ai-go { padding: 12px; } .ob-saved-row { flex-wrap: wrap; } }
  `;

  // ── Widget class ──────────────────────────────────────────────────────────
  class TGOfferBuilderWidget {
    constructor(container, config) {
      this.el = container;
      // Mark the host so auto-init won't construct a second instance on a div
      // that was already wired up manually (e.g. in the demo / editor preview).
      container._tgInitialised = true;
      this.cfg = this._defaults(config);
      this.shadow = container.attachShadow({ mode: 'open' });
      this.root = null;
      this._render();
    }

    _defaults(c) {
      c = c || {};
      const bool = function (v, d) { return typeof v === 'boolean' ? v : d; };
      return {
        // Branding
        theme: c.theme === 'dark' ? 'dark' : 'light',
        brandColor: c.brandColor || '',
        accentColor: c.accentColor || '',
        radius: typeof c.radius === 'number' ? c.radius : 14,

        // Copy
        title: c.title || 'Create a special offer',
        intro: c.intro || 'Fill the form yourself, or describe the deal in a sentence and let AI draft it for you. Every AI suggestion is editable before you publish.',
        submitLabel: c.submitLabel || 'Save offer',
        successHeading: c.successHeading || 'Offer captured',
        successBody: c.successBody || 'Your special offer is ready. The card and offer page come next.',

        // AI assist
        aiEnabled: bool(c.aiEnabled, true),
        aiEndpoint: c.aiEndpoint || '',           // POST { description } → { fields, includes, tags }
        aiMock: bool(c.aiMock, false),            // preview/demo only: use the canned draft
        aiPlaceholder: c.aiPlaceholder || 'e.g. 7 nights all inclusive at the Riu Palace in Cancun, flying from Gatwick, was 1299 now from 899pp, kids stay free, book by end of July',

        // Saving: when on, submit persists the offer (needs a signed-in session)
        // and shows a shareable /offer page link. Off by default (fires the
        // tg-offer-created event only).
        save: bool(c.save, false),
        saveEndpoint: c.saveEndpoint || '/api/saved-offers',
        offerId: c.offerId || '',                 // set when editing an existing saved offer
        offerBaseUrl: c.offerBaseUrl || '',        // optional absolute base for the shareable link

        // Currency
        currency: c.currency || 'GBP',

        // Section visibility
        showDestination: bool(c.showDestination, true),
        showStayTravel: bool(c.showStayTravel, true),
        showPrice: bool(c.showPrice, true),
        showIncludes: bool(c.showIncludes, true),
        showTags: bool(c.showTags, true),
        showValidity: bool(c.showValidity, true),
        showImages: bool(c.showImages, true),
        showMap: bool(c.showMap, true),
        showDescription: bool(c.showDescription, true),
        showEnquiry: bool(c.showEnquiry, true),

        // Required fields
        requireTitle: bool(c.requireTitle, true),
        requirePrice: bool(c.requirePrice, true),

        // Editable option lists
        offerTypes: Array.isArray(c.offerTypes) && c.offerTypes.length ? c.offerTypes : OFFER_TYPES,
        includeOptions: Array.isArray(c.includeOptions) && c.includeOptions.length ? c.includeOptions : DEFAULT_INCLUDES,
        tagOptions: Array.isArray(c.tagOptions) && c.tagOptions.length ? c.tagOptions : DEFAULT_TAGS,

        // Enquiry routing defaults
        enquiryEmail: c.enquiryEmail || '',
        enquiryPhone: c.enquiryPhone || '',
        protection: c.protection || 'ATOL protected',

        // An existing offer to edit (prefills the form). Shape = builder output.
        offer: c.offer && typeof c.offer === 'object' ? c.offer : null,

        _widgetId: c._widgetId || ''
      };
    }

    // Populate the form from an existing offer (edit mode).
    _prefillOffer(offer) {
      if (!offer) return;
      const fields = (offer.fields && typeof offer.fields === 'object') ? offer.fields : offer;
      this.root.querySelectorAll('[data-key]').forEach((el) => {
        const v = fields[el.dataset.key];
        if (v != null && v !== '') el.value = v;
      });
      const inc = Array.isArray(offer.includes) ? offer.includes : [];
      this.root.querySelectorAll('.ob-incl input').forEach((i) => {
        if (inc.indexOf(i.dataset.incl) !== -1) { i.checked = true; i.closest('label').classList.add('on'); }
      });
      const tags = Array.isArray(offer.tags) ? offer.tags : [];
      this.root.querySelectorAll('.ob-toggle').forEach((c) => {
        if (tags.indexOf(c.dataset.tag) !== -1) c.classList.add('on');
      });
    }

    _render() {
      const cfg = this.cfg;
      const sym = currencySymbol(cfg.currency);

      this.root = document.createElement('div');
      this.root.className = 'ob-root';
      this.root.setAttribute('data-theme', cfg.theme);
      if (cfg.brandColor) this.root.style.setProperty('--tgo-brand', cfg.brandColor);
      if (cfg.accentColor) {
        this.root.style.setProperty('--tgo-accent', cfg.accentColor);
        this.root.style.setProperty('--tgo-accent-hover', cfg.accentColor);
      }
      if (cfg.radius) this.root.style.setProperty('--tgo-radius', cfg.radius + 'px');

      const aiBox = cfg.aiEnabled ? `
        <div class="ob-ai">
          <div class="ob-ai-head"><span class="ob-ai-spark">✨</span><h3>Describe your offer, we will fill in the rest</h3></div>
          <p class="ob-ai-sub">Type it the way you would say it to a customer. AI works out the destination, board basis, price basis, highlights and a polished description, then fills the form for you to check.</p>
          <div class="ob-ai-row">
            <textarea class="ob-ai-input" rows="2" placeholder="${esc(cfg.aiPlaceholder)}"></textarea>
            <button type="button" class="ob-ai-go">✨ Generate</button>
          </div>
          <div class="ob-ai-status"></div>
        </div>` : '';

      function field(key, label, control, opt, wide) {
        return '<div class="ob-field' + (wide ? ' wide' : '') + '" data-field="' + key + '">'
          + '<label>' + esc(label) + (opt ? ' <span class="opt">' + esc(opt) + '</span>' : '') + '</label>'
          + control
          + '<span class="ob-err">Required</span></div>';
      }
      const input = function (key, ph, type) {
        return '<input type="' + (type || 'text') + '" data-key="' + key + '" placeholder="' + esc(ph || '') + '" />';
      };
      const select = function (key, list, sel) {
        return '<select data-key="' + key + '">' + options(list, sel) + '</select>';
      };
      const money = function (key, ph) {
        return '<div class="ob-prefix"><span class="sym">' + sym + '</span>' + input(key, ph, 'number') + '</div>';
      };

      // ── Section: basics (always shown) ──
      let html = '<div class="ob-fs"><h4>1 · The basics</h4><p class="hint">What the offer is and the headline that grabs attention.</p><div class="ob-grid">'
        + field('title', 'Offer title', input('title', 'e.g. 7 nights all inclusive in Cancun'), '', true)
        + field('type', 'Offer type', select('type', cfg.offerTypes, cfg.offerTypes[0]))
        + field('style', 'Holiday style', select('style', HOLIDAY_STYLES, HOLIDAY_STYLES[0]))
        + field('teaser', 'Card teaser', input('teaser', 'One line shown on the card'), '(shown on the card)', true)
        + '</div></div>';

      if (cfg.showDestination) {
        html += '<div class="ob-fs"><h4>2 · Where &amp; from where</h4><p class="hint">Destination plus the departure points this price is valid from.</p><div class="ob-grid">'
          + field('country', 'Country', input('country', 'Mexico'))
          + field('region', 'Region / area', input('region', 'Riviera Maya'))
          + field('resort', 'Resort / city', input('resort', 'Costa Mujeres, Cancun'))
          + field('origin', 'Departure airport(s)', input('origin', 'London Gatwick, Manchester'))
          + '</div></div>';
      }

      if (cfg.showStayTravel) {
        html += '<div class="ob-fs"><h4>3 · Stay &amp; travel</h4><p class="hint">The property, the flights and how long the holiday is.</p><div class="ob-grid">'
          + field('property', 'Property name', input('property', 'Riu Palace Costa Mujeres'))
          + field('stars', 'Star rating', select('stars', STAR_RATINGS, STAR_RATINGS[0]))
          + field('board', 'Board basis', select('board', BOARD_BASES, BOARD_BASES[0]))
          + field('nights', 'Duration', '<div class="ob-prefix">' + input('nights', '7', 'number') + '<span class="ob-suffix">nights</span></div>')
          + field('datemode', 'Travel dates', select('datemode', DATE_MODES, DATE_MODES[0]))
          + field('period', 'Travel period', input('period', 'Sep 2026 to Apr 2027'))
          + field('airline', 'Airline', input('airline', 'TUI Airways'))
          + field('flighttype', 'Flights', select('flighttype', FLIGHT_TYPES, FLIGHT_TYPES[0]))
          + '</div></div>';
      }

      if (cfg.showPrice) {
        html += '<div class="ob-fs"><h4>4 · Price</h4><p class="hint">The lead-in price and the saving you want to shout about.</p><div class="ob-grid">'
          + field('price', 'Price from', money('price', '899'))
          + field('basis', 'Price basis', select('basis', PRICE_BASES, PRICE_BASES[0]))
          + field('was', 'Was price', money('was', '1299'), '(optional)')
          + field('deposit', 'Deposit from', money('deposit', '60'), '(optional)')
          + '</div></div>';
      }

      if (cfg.showIncludes) {
        html += '<div class="ob-fs"><h4>5 · What\'s included</h4><p class="hint">Tick what the price covers.</p><div class="ob-incl">'
          + cfg.includeOptions.map(function (i) {
              return '<label><input type="checkbox" data-incl="' + esc(i) + '" /> ' + esc(i) + '</label>';
            }).join('')
          + '</div></div>';
      }

      if (cfg.showTags) {
        html += '<div class="ob-fs"><h4>6 · Tags &amp; promo badge</h4><p class="hint">Tags help people filter. The badge is the coloured flash on the card.</p>'
          + '<div class="ob-field" style="margin-bottom:14px"><label>Tags</label><div class="ob-chips">'
          + cfg.tagOptions.map(function (t) { return '<button type="button" class="ob-toggle" data-tag="' + esc(t) + '">' + esc(t) + '</button>'; }).join('')
          + '</div></div><div class="ob-grid">'
          + field('badge', 'Promo badge', select('badge', BADGES, BADGES[0]))
          + field('badgeAmount', 'Badge amount', money('badgeAmount', '400'), '(for "Save")')
          + field('urgency', 'Urgency pill', input('urgency', 'Only 4 left at this price'), '(green flash)')
          + '</div></div>';
      }

      if (cfg.showValidity) {
        html += '<div class="ob-fs"><h4>7 · Validity &amp; availability</h4><p class="hint">When the deal expires and how tight availability is.</p><div class="ob-grid">'
          + field('bookby', 'Book by', input('bookby', '31 July 2026'))
          + field('avail', 'Availability note', input('avail', 'Limited rooms at this price'))
          + field('showFrom', 'Show from', input('showFrom', '', 'date'), '(optional)')
          + field('showUntil', 'Show until', input('showUntil', '', 'date'), '(optional)')
          + '</div><p class="hint" style="margin-top:10px">Show from / until control when the offer appears. Set either, neither or both. With no dates the offer always shows. "Show until" includes that whole day.</p></div>';
      }

      if (cfg.showImages) {
        html += '<div class="ob-fs"><h4>8 · Photos</h4><p class="hint">The images people will see. Upload handling comes in the next step.</p>'
          + '<div class="ob-upload">🖼️ Drag photos here, paste a hotel link, or <b>let AI suggest stock imagery</b> for the destination</div></div>';
      }

      if (cfg.showMap) {
        html += '<div class="ob-fs"><h4>9 · Map &amp; video</h4><p class="hint">Show the resort on a map and add a video tour. Both appear on the offer page.</p><div class="ob-grid">'
          + field('mapAddress', 'Map location', input('mapAddress', 'Costa Mujeres, Cancun, Mexico'), '(shown above the map)', true)
          + field('mapLat', 'Latitude', input('mapLat', 'e.g. 21.0419', 'text'), '(from Google Maps)')
          + field('mapLng', 'Longitude', input('mapLng', 'e.g. -86.8126', 'text'), '(from Google Maps)')
          + field('mapStyle', 'Map style', select('mapStyle', ['streets', 'minimal', 'muted', 'dark', 'satellite'], 'streets'))
          + field('video', 'Video link', input('video', 'YouTube, Vimeo or MP4 URL', 'text'), '(optional)', true)
          + '</div><p class="hint" style="margin-top:10px">Tip: in Google Maps, right-click the resort and click the coordinates to copy them. Leave the map blank to hide it.</p></div>';
      }

      if (cfg.showDescription) {
        html += '<div class="ob-fs"><h4>10 · Full description</h4><p class="hint">The longer write-up for the offer page. AI drafts it in your brand voice, then you edit.</p>'
          + '<div class="ob-field wide" data-field="description"><textarea data-key="description" rows="5" placeholder="A few warm, plain paragraphs about the resort, the location and why this deal is worth booking."></textarea></div></div>';
      }

      if (cfg.showEnquiry) {
        html += '<div class="ob-fs"><h4>11 · Where enquiries go</h4><p class="hint">Each offer page carries an enquiry form. Tell us who picks it up.</p><div class="ob-grid">'
          + field('enquiryEmail', 'Enquiry email', input('enquiryEmail', 'sales@youragency.co.uk', 'email'))
          + field('enquiryPhone', 'Phone shown on page', input('enquiryPhone', '0161 123 4567', 'tel'))
          + field('reference', 'Offer reference', input('reference', 'TG-CUN-0926'))
          + field('protection', 'Financial protection', select('protection', PROTECTIONS, cfg.protection))
          + '</div></div>';
      }

      html += '<div class="ob-actions">'
        + '<button type="button" class="ob-btn ob-reset">Clear form</button>'
        + '<button type="button" class="ob-btn primary ob-submit">' + esc(cfg.submitLabel) + '</button>'
        + '</div>';

      this.root.innerHTML =
        '<div class="ob-head"><h2>' + esc(cfg.title) + '</h2><p>' + esc(cfg.intro) + '</p></div>'
        + aiBox
        + '<form class="ob-form">' + html + '</form>';

      // Pre-fill enquiry routing defaults from config
      this.shadow.innerHTML = '<style>' + STYLES + '</style>';
      this.shadow.appendChild(this.root);
      this._prefill();
      this._bind();
      if (this.cfg.offer) this._prefillOffer(this.cfg.offer);
    }

    _prefill() {
      const cfg = this.cfg;
      const set = (k, v) => { const el = this.root.querySelector('[data-key="' + k + '"]'); if (el && v) el.value = v; };
      set('enquiryEmail', cfg.enquiryEmail);
      set('enquiryPhone', cfg.enquiryPhone);
    }

    _bind() {
      const root = this.root;

      // Tag chips
      root.querySelectorAll('.ob-toggle').forEach((c) =>
        c.addEventListener('click', () => c.classList.toggle('on')));
      // Includes
      root.querySelectorAll('.ob-incl input').forEach((i) =>
        i.addEventListener('change', () => i.closest('label').classList.toggle('on', i.checked)));
      // Clear validation as the user types
      root.querySelectorAll('[data-key]').forEach((el) =>
        el.addEventListener('input', () => { const f = el.closest('.ob-field'); if (f) f.classList.remove('invalid'); }));

      const aiGo = root.querySelector('.ob-ai-go');
      if (aiGo) aiGo.addEventListener('click', () => this._runAI());

      root.querySelector('.ob-submit').addEventListener('click', () => this._submit());
      root.querySelector('.ob-reset').addEventListener('click', () => this._render());
    }

    // ── AI assist ────────────────────────────────────────────────────────────
    async _runAI() {
      const root = this.root;
      const input = root.querySelector('.ob-ai-input');
      const status = root.querySelector('.ob-ai-status');
      const btn = root.querySelector('.ob-ai-go');
      const desc = (input.value || '').trim();

      if (desc.length < 8) {
        status.className = 'ob-ai-status show err';
        status.textContent = 'Add a sentence or two describing the offer first.';
        return;
      }
      btn.disabled = true;
      status.className = 'ob-ai-status show busy';
      status.textContent = '⏳ Reading your offer and filling the form…';

      try {
        const draft = await this._fetchDraft(desc);
        this._applyDraft(draft);
        const n = Object.keys(draft.fields || {}).length;
        status.className = 'ob-ai-status show ok';
        status.innerHTML = '✓ Done. Filled ' + n + ' fields. Check anything marked <span class="ob-chip">✨ AI</span> before you save.';
      } catch (err) {
        status.className = 'ob-ai-status show err';
        status.textContent = 'AI draft is not available right now. You can still fill the form by hand.';
        // eslint-disable-next-line no-console
        console.warn('[TGOfferBuilder] AI draft failed:', err && err.message);
      } finally {
        btn.disabled = false;
      }
    }

    _fetchDraft(description) {
      // Preview/demo path — resolve the canned draft without a backend.
      if (this.cfg.aiMock) {
        return new Promise((res) => setTimeout(() => res(DEMO_DRAFT), 900));
      }
      if (!this.cfg.aiEndpoint) return Promise.reject(new Error('No aiEndpoint configured'));
      return fetch(this.cfg.aiEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: description, widgetId: this.cfg._widgetId })
      }).then((r) => {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      });
    }

    _applyDraft(draft) {
      const root = this.root;
      const fields = (draft && draft.fields) || {};
      Object.keys(fields).forEach((k) => {
        const el = root.querySelector('[data-key="' + k + '"]');
        if (!el) return;
        el.value = fields[k];
        const f = el.closest('.ob-field');
        if (f && !f.classList.contains('ai')) {
          f.classList.add('ai');
          const label = f.querySelector('label');
          if (label && !label.querySelector('.ob-chip')) {
            const chip = document.createElement('span');
            chip.className = 'ob-chip';
            chip.textContent = '✨ AI';
            label.appendChild(chip);
          }
        }
      });
      const includes = (draft && draft.includes) || [];
      root.querySelectorAll('.ob-incl input').forEach((i) => {
        if (includes.indexOf(i.dataset.incl) !== -1) { i.checked = true; i.closest('label').classList.add('on'); }
      });
      const tags = (draft && draft.tags) || [];
      root.querySelectorAll('.ob-toggle').forEach((c) => {
        if (tags.indexOf(c.dataset.tag) !== -1) c.classList.add('on');
      });
    }

    // ── Collect, validate, submit ────────────────────────────────────────────
    _collect() {
      const root = this.root;
      const offer = { fields: {}, includes: [], tags: [], currency: this.cfg.currency };
      root.querySelectorAll('[data-key]').forEach((el) => {
        const v = (el.value || '').trim();
        if (v) offer.fields[el.dataset.key] = v;
      });
      root.querySelectorAll('.ob-incl input:checked').forEach((i) => offer.includes.push(i.dataset.incl));
      root.querySelectorAll('.ob-toggle.on').forEach((c) => offer.tags.push(c.dataset.tag));
      return offer;
    }

    _validate(offer) {
      const root = this.root;
      let ok = true;
      const flag = (key) => {
        const f = root.querySelector('.ob-field[data-field="' + key + '"]');
        if (f) f.classList.add('invalid');
        ok = false;
      };
      root.querySelectorAll('.ob-field.invalid').forEach((f) => f.classList.remove('invalid'));
      if (this.cfg.requireTitle && !offer.fields.title) flag('title');
      if (this.cfg.requirePrice && !offer.fields.price) flag('price');
      if (!ok) {
        const first = root.querySelector('.ob-field.invalid');
        if (first) first.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
      return ok;
    }

    _submit() {
      const offer = this._collect();
      if (!this._validate(offer)) return;

      // Fire the event the host (or a card/page renderer) listens for.
      this.el.dispatchEvent(new CustomEvent('tg-offer-created', {
        bubbles: true, composed: true, detail: offer
      }));

      if (this.cfg.save) this._saveOffer(offer);
      else this._success(offer);
    }

    // Persist the offer to the account and get back a shareable id + URL.
    _saveOffer(offer) {
      const btn = this.root.querySelector('.ob-submit');
      if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
      fetch(this.cfg.saveEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ id: this.cfg.offerId || undefined, offer: offer })
      })
        .then((r) => r.json().then((j) => ({ ok: r.ok, j: j })))
        .then((res) => {
          if (!res.ok) throw new Error((res.j && res.j.error) || 'Save failed');
          this.cfg.offerId = res.j.id;
          this.el.dispatchEvent(new CustomEvent('tg-offer-saved', { bubbles: true, composed: true, detail: { id: res.j.id, url: res.j.url, offer: offer } }));
          this._success(offer, res.j);
        })
        .catch((err) => { this._success(offer, null, String(err && err.message || err)); });
    }

    _success(offer, saved, err) {
      const cfg = this.cfg;
      let extra = '';
      if (saved && saved.id) {
        const link = (cfg.offerBaseUrl || '') + (saved.url || ('/offer?id=' + saved.id));
        extra = '<div class="ob-saved"><div class="ob-saved-label">Shareable offer page</div>'
          + '<div class="ob-saved-row"><input class="ob-saved-link" type="text" readonly value="' + esc(link) + '" />'
          + '<button type="button" class="ob-btn ob-copy">Copy</button>'
          + '<a class="ob-btn primary" href="' + esc(link) + '" target="_blank" rel="noopener">Open</a></div></div>';
      } else if (err) {
        extra = '<div class="ob-saved err">Could not save the offer (' + esc(err) + '). You can still copy the details below.</div>';
      }
      this.root.innerHTML =
        '<div class="ob-success"><div class="tick">✓</div>'
        + '<h3>' + esc(cfg.successHeading) + '</h3>'
        + '<p>' + esc(cfg.successBody) + '</p>'
        + extra
        + '<div class="ob-summary">' + esc(JSON.stringify(offer, null, 2)) + '</div>'
        + '<button type="button" class="ob-btn primary ob-again">Create another offer</button></div>';
      this.root.querySelector('.ob-again').addEventListener('click', () => this._render());
      const copy = this.root.querySelector('.ob-copy');
      if (copy) copy.addEventListener('click', () => {
        const inp = this.root.querySelector('.ob-saved-link');
        inp.select();
        try { navigator.clipboard.writeText(inp.value); } catch (e) { document.execCommand('copy'); }
        copy.textContent = 'Copied';
        setTimeout(() => { copy.textContent = 'Copy'; }, 1500);
      });
    }
  }

  // ── Auto-init ───────────────────────────────────────────────────────────────
  async function loadConfigFromApi(widgetId) {
    try {
      const res = await fetch(API_BASE + '?id=' + encodeURIComponent(widgetId));
      if (!res.ok) throw new Error('Config load failed: ' + res.status);
      const data = await res.json();
      if (data && data.config) return Object.assign({}, data.config, { _widgetId: widgetId });
      throw new Error('No config returned');
    } catch (err) {
      console.error('[TGOfferBuilder] Config load error:', err);
      return null;
    }
  }

  async function init() {
    const containers = document.querySelectorAll('[data-tg-widget="offer-builder"]');
    for (const el of containers) {
      // Skip anything already wired (flag set) or already hosting a shadow root
      // (manual construction in a demo/editor that also carries the attribute).
      if (el._tgInitialised || el.shadowRoot) continue;
      el._tgInitialised = true;
      let config = null;
      const inline = el.getAttribute('data-tg-config');
      const widgetId = el.getAttribute('data-tg-id');
      if (inline) {
        try { config = JSON.parse(inline); } catch (e) { console.error('[TGOfferBuilder] Invalid inline config:', e); continue; }
      } else if (widgetId) {
        config = await loadConfigFromApi(widgetId);
        if (!config) continue;
      } else {
        config = {};
      }
      new TGOfferBuilderWidget(el, config);
    }
  }

  if (typeof window !== 'undefined') {
    window.TGOfferBuilderWidget = TGOfferBuilderWidget;
    window.TGOfferBuilderWidget.version = VERSION;
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
  }
})();
