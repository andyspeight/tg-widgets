/**
 * Travelgenix Attraction Spotlight Widget v1.0.0
 * Self-contained, embeddable showcase for a theme park, resort complex,
 * water park, aquarium or cultural attraction.
 *
 * Zero dependencies. Shadow DOM isolation. One script tag on any website.
 * Content is fetched live from /api/attraction-content (never snapshotted).
 *
 * The Theme Parks and Attractions table has no image field, so the hero is a
 * branded gradient with an optional editor-supplied hero image.
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
  const VERSION = '1.0.0';

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

  /* ===== Widget class ===== */
  class TGAttractionWidget {
    constructor(container, config) {
      if (!container) throw new Error('TGAttractionWidget: container required');
      this.el = container;
      this.c = this._defaults(config);
      if (container.shadowRoot) {
        this.shadow = container.shadowRoot;
        while (this.shadow.firstChild) this.shadow.removeChild(this.shadow.firstChild);
      } else if (container.attachShadow) {
        this.shadow = container.attachShadow({ mode: 'open' });
      } else {
        this.shadow = container;
      }
      this._renderShell();
      if (this.c.attractionData && typeof this.c.attractionData === 'object') {
        this._data = this.c.attractionData;
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
        brandColor: '#1B2B5B',
        accentColor: '#00B4D8',
        radius: 16,
        fontFamily: '',
        heroImageUrl: '',
        recordId: null,
        sections: {
          hero: true, facts: true, bestfor: true, overview: true, star: true,
          guides: true, tickets: true, located: true, stay: true, food: true,
          tips: true, combine: true, operators: true, cta: true,
        },
        cta: {
          title: 'Plan your visit to {{name}}',
          subtitle: 'Speak to us about packaging tickets, hotels and transfers.',
          buttonLabel: 'Start your enquiry',
          buttonUrl: '',
        },
        attractionData: null,
      };
      if (!c || typeof c !== 'object') return base;
      const m = Object.assign({}, base, c);
      m.sections = Object.assign({}, base.sections, c.sections || {});
      m.cta = Object.assign({}, base.cta, c.cta || {});
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
      if (this.c.brandColor) root.style.setProperty('--tgx-brand', this.c.brandColor);
      if (this.c.accentColor) { root.style.setProperty('--tgx-accent', this.c.accentColor); root.style.setProperty('--tgx-accent-soft', hexToRgba(this.c.accentColor, 0.14)); }
      if (this.c.brandColor) root.style.setProperty('--tgx-brand-soft', hexToRgba(this.c.brandColor, 0.10));
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
      try {
        const qs = this.c.recordId
          ? '?recordId=' + encodeURIComponent(this.c.recordId)
          : '?id=' + encodeURIComponent(this.c.widgetId);
        const res = await fetch(CONTENT_API + qs, { credentials: 'omit' });
        if (!res.ok) { if (res.status === 404) return this._renderNotFound(); throw new Error('fetch ' + res.status); }
        const data = await res.json();
        if (!data || data.found === false || !data.attraction) return this._renderNotFound();
        this._data = data.attraction;
        this._renderContent();
      } catch (err) {
        console.error('[TG Attraction] load failed:', err);
        this._renderError();
      }
    }

    _renderContent() {
      const d = this._data;
      if (!d || !d.name) return this._renderNotFound();
      const s = this.c.sections;
      const html = [];
      if (s.hero)      html.push(this._renderHero(d));
      if (s.facts)     html.push(this._renderFacts(d));
      if (s.bestfor)   html.push(this._renderBestFor(d));
      if (s.overview)  html.push(this._renderOverview(d));
      if (s.star)      html.push(this._renderStar(d));
      if (s.guides)    html.push(this._renderGuides(d));
      if (s.tickets)   html.push(this._renderTickets(d));
      if (s.located)   html.push(this._renderLocated(d));
      if (s.stay)      html.push(this._renderStay(d));
      if (s.food)      html.push(this._renderFood(d));
      if (s.tips)      html.push(this._renderTips(d));
      if (s.combine)   html.push(this._renderCombine(d));
      if (s.operators) html.push(this._renderOperators(d));
      if (s.cta)       html.push(this._renderCta(d));
      this._root.innerHTML = html.filter(Boolean).join('');
    }

    _section(ico, kicker, h2, inner) {
      if (!inner) return '';
      return '<section class="tgx-section">' +
        '<div class="tgx-section-head"><span class="tgx-section-icon">' + icon(ico, 18) + '</span>' +
        '<span class="tgx-kicker">' + esc(kicker) + '</span></div>' +
        (h2 ? '<h2 class="tgx-h2">' + esc(h2) + '</h2>' : '') + inner + '</section>';
    }
    _prose(text, max) { const p = paras(text, max); return p ? '<div class="tgx-prose">' + p + '</div>' : ''; }
    _card(ico, title, body) {
      if (!body) return '';
      return '<div class="tgx-card"><div class="tgx-card-head"><span class="tgx-card-icon">' + icon(ico, 18) +
        '</span><h4 class="tgx-card-title">' + esc(title) + '</h4></div>' +
        '<div class="tgx-card-body">' + paras(body, 6) + '</div></div>';
    }

    _renderHero(d) {
      const heroImg = safeUrl(this.c.heroImageUrl);
      const eyebrow = [d.location, d.country, d.type].filter(Boolean).map(esc).join(' &middot; ');
      const badges = [];
      if (d.operator) badges.push('<span class="tgx-badge">' + esc(d.operator) + '</span>');
      if (d.hasOnSiteHotels) badges.push('<span class="tgx-badge is-on">' + icon('bed', 13) + ' On-site hotels</span>');
      if (d.dogFriendly) badges.push('<span class="tgx-badge is-on">' + icon('paw', 13) + ' Dog friendly</span>');
      const style = heroImg ? ' style="--tgx-hero-img:url(' + esc(heroImg) + ')"' : '';
      return '<header class="tgx-hero' + (heroImg ? ' has-img' : '') + '"' + style + '>' +
        (eyebrow ? '<div class="tgx-eyebrow"><span class="dot"></span>' + eyebrow + '</div>' : '') +
        '<h1 class="tgx-name">' + esc(d.name) + '</h1>' +
        (d.tagline ? '<p class="tgx-tagline">' + esc(d.tagline) + '</p>' : '') +
        (badges.length ? '<div class="tgx-badges">' + badges.join('') + '</div>' : '') +
        '</header>';
    }

    _fact(ico, label, value) {
      if (!value) return '';
      return '<div class="tgx-fact"><span class="tgx-fact-icon">' + icon(ico, 20) + '</span><div>' +
        '<div class="tgx-fact-label">' + esc(label) + '</div>' +
        '<div class="tgx-fact-value">' + esc(value) + '</div></div></div>';
    }
    _renderFacts(d) {
      const tiles = [
        this._fact('coin', 'Typical cost', d.priceBand),
        this._fact('calendar', 'Time needed', d.daysNeeded),
        this._fact('sun', 'Season', d.season),
        this._fact('bed', 'On-site hotels', d.hasOnSiteHotels ? 'Yes' : ''),
        this._fact('paw', 'Dog friendly', d.dogFriendly ? 'Yes' : ''),
      ].filter(Boolean).slice(0, 4);
      if (!tiles.length) return '';
      return '<div class="tgx-facts" data-count="' + tiles.length + '">' + tiles.join('') + '</div>';
    }

    _renderBestFor(d) {
      const tags = Array.isArray(d.bestFor) ? d.bestFor : [];
      if (!tags.length) return '';
      const pills = tags.map(t => '<span class="tgx-tag">' + icon('users', 13) + '<span>' + esc(t) + '</span></span>').join('');
      return this._section('users', 'Best for', '', '<div class="tgx-tags">' + pills + '</div>');
    }

    _renderOverview(d) {
      const body = this._prose(d.overview, 4) + (d.bestTime ? '<h3 class="tgx-subh">When to go</h3>' + this._prose(d.bestTime, 3) : '');
      if (!d.overview && !d.bestTime) return '';
      return this._section('info', 'Overview', 'The attraction in brief', body);
    }

    _renderStar(d) {
      if (!d.starAttractions) return '';
      return this._section('star', 'Star attractions', 'What not to miss', this._prose(d.starAttractions, 10));
    }

    _renderGuides(d) {
      const cards = [
        this._card('users', 'Families', d.familyGuide),
        this._card('zap', 'Thrill-seekers', d.thrillGuide),
        this._card('ruler', 'Height restrictions', d.heightRestrict),
        this._card('access', 'Accessibility', d.accessibility),
        this._card('forward', 'Skip the queue', d.fastTrack),
      ].filter(Boolean);
      if (!cards.length) return '';
      return this._section('shield', 'Good to know', 'Plan around your group', '<div class="tgx-cards">' + cards.join('') + '</div>');
    }

    _renderTickets(d) {
      if (!d.tickets) return '';
      return this._section('ticket', 'Tickets and prices', '', '<div class="tgx-callout">' + paras(d.tickets, 5) + '</div>');
    }

    _renderLocated(d) {
      const blocks = [];
      if (d.nearestAirport) blocks.push('<div class="tgx-block"><div class="tgx-block-label">' + icon('plane', 15) + ' Nearest airports</div>' + this._prose(d.nearestAirport, 3) + '</div>');
      if (d.gettingThere)   blocks.push('<div class="tgx-block"><div class="tgx-block-label">' + icon('car', 15) + ' Getting there</div>' + this._prose(d.gettingThere, 3) + '</div>');
      if (d.nearestTown)    blocks.push('<div class="tgx-block"><div class="tgx-block-label">' + icon('pin', 15) + ' Nearest town</div>' + this._prose(d.nearestTown, 2) + '</div>');
      const ll = (typeof d.lat === 'number' && typeof d.lng === 'number') ? [d.lat, d.lng] : null;
      let mapLinks = '';
      if (ll) {
        const g = 'https://www.google.com/maps/?q=' + ll[0] + ',' + ll[1];
        const a = 'https://maps.apple.com/?ll=' + ll[0] + ',' + ll[1] + '&q=' + encodeURIComponent(d.name || '');
        mapLinks = '<div class="tgx-maplinks">' +
          '<a class="tgx-maplink" href="' + esc(g) + '" target="_blank" rel="noopener noreferrer">Google Maps' + icon('arrow_out', 11) + '</a>' +
          '<a class="tgx-maplink" href="' + esc(a) + '" target="_blank" rel="noopener noreferrer">Apple Maps' + icon('arrow_out', 11) + '</a></div>';
      }
      if (!blocks.length && !mapLinks) return '';
      return this._section('compass', 'Getting there', '', blocks.join('') + mapLinks);
    }

    _renderStay(d) {
      const cards = [
        this._card('bed', 'On-site hotels', d.onSiteHotels),
        this._card('building', 'Nearby hotels', d.nearbyHotels),
      ].filter(Boolean);
      if (!cards.length) return '';
      return this._section('bed', 'Where to stay', '', '<div class="tgx-cards">' + cards.join('') + '</div>');
    }

    _renderFood(d) {
      if (!d.foodDrink) return '';
      return this._section('utensils', 'Food and drink', '', this._prose(d.foodDrink, 4));
    }

    _renderTips(d) {
      if (!d.quirks) return '';
      return this._section('alert', 'Insider tips', 'Things that catch first-timers out', '<div class="tgx-tips">' + paras(d.quirks, 6) + '</div>');
    }

    _renderCombine(d) {
      if (!d.combineWith) return '';
      return this._section('link', 'Combine your trip', 'Other attractions nearby', this._prose(d.combineWith, 3));
    }

    _renderOperators(d) {
      if (!d.tourOperators) return '';
      return this._section('briefcase', 'For travel agents', 'Who packages this', this._prose(d.tourOperators, 2));
    }

    _renderCta(d) {
      const cta = this.c.cta || {};
      const vars = { name: d.name || '', location: d.location || '', country: d.country || '' };
      const title = renderTemplate(cta.title || '', vars);
      const sub = renderTemplate(cta.subtitle || '', vars);
      const url = safeUrl(cta.buttonUrl, true);
      const official = safeUrl(d.officialWebsite);
      const verified = d.verifiedDate ? '<p class="tgx-verified">' + icon('check', 12) + ' Verified ' + esc(d.verifiedDate) + '</p>' : '';
      if (!title && !sub && !url && !official) return verified;
      return '<div class="tgx-cta">' +
        '<div class="tgx-cta-text">' +
          (title ? '<h3 class="tgx-cta-title">' + esc(title) + '</h3>' : '') +
          (sub ? '<p class="tgx-cta-sub">' + esc(sub) + '</p>' : '') +
        '</div>' +
        '<div class="tgx-cta-actions">' +
          (official ? '<a href="' + esc(official) + '" target="_blank" rel="noopener noreferrer" class="tgx-btn tgx-btn-ghost">Official website' + icon('arrow_out', 13) + '</a>' : '') +
          (url ? '<a href="' + esc(url) + '" class="tgx-btn tgx-btn-primary">' + esc(cta.buttonLabel || 'Enquire') + icon('arrow', 14) + '</a>' : '') +
        '</div>' + verified + '</div>';
    }

    _renderNotFound() {
      this._root.innerHTML = '<div class="tgx-notice"><div class="tgx-notice-icon">' + icon('info', 22) + '</div>' +
        '<h2 class="tgx-notice-title">Attraction not found</h2>' +
        '<p class="tgx-notice-body">This widget is looking for an attraction that is not in the content database yet.</p></div>';
    }
    _renderError() {
      this._root.innerHTML = '<div class="tgx-notice"><div class="tgx-notice-icon">' + icon('alert', 22) + '</div>' +
        '<h2 class="tgx-notice-title">Unable to load</h2>' +
        '<p class="tgx-notice-body">The attraction content is temporarily unavailable. Please try again in a moment.</p></div>';
    }

    update(newConfig) {
      this.c = this._defaults(Object.assign({}, this.c, newConfig || {}));
      this._renderShell();
      if (this.c.attractionData) { this._data = this.c.attractionData; this._renderContent(); }
      else if (this.c.widgetId || this.c.recordId) { this._load(); }
      else if (this._data) { this._renderContent(); }
      else { this._renderNotFound(); }
    }
    destroy() {
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
  :host { all: initial; }
  .tgx-root {
    --tgx-brand: #1B2B5B; --tgx-accent: #00B4D8;
    --tgx-brand-soft: rgba(27,43,91,0.10); --tgx-accent-soft: rgba(0,180,216,0.14);
    --tgx-radius: 16px; --tgx-radius-sm: 10px;
    --tgx-bg: #FFFFFF; --tgx-card: #FFFFFF; --tgx-border: #E2E8F0; --tgx-border-soft: #F1F5F9;
    --tgx-text: #0F172A; --tgx-sub: #475569; --tgx-muted: #94A3B8;
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    color: var(--tgx-text); background: var(--tgx-bg); display: block; line-height: 1.55;
    max-width: 1000px; margin: 0 auto; padding: 4px;
    -webkit-font-smoothing: antialiased;
  }
  .tgx-root[data-theme="dark"] {
    --tgx-bg: #0A0F1E; --tgx-card: #131A2E; --tgx-border: #283349; --tgx-border-soft: #1E283C;
    --tgx-text: #F8FAFC; --tgx-sub: #CBD5E1; --tgx-muted: #64748B;
  }
  .tgx-root *, .tgx-root *::before, .tgx-root *::after { box-sizing: border-box; }
  .tgx-loading { min-height: 280px; }
  .tgx-skel { height: 220px; border-radius: var(--tgx-radius); background: linear-gradient(90deg, var(--tgx-border-soft), var(--tgx-card), var(--tgx-border-soft)); background-size: 200% 100%; animation: tgxsh 1.4s ease infinite; }
  @keyframes tgxsh { 0%{background-position:200% 0} 100%{background-position:-200% 0} }

  /* Hero */
  .tgx-hero { position: relative; border-radius: var(--tgx-radius); padding: 40px 36px; color: #fff;
    background: var(--tgx-brand);
    background: linear-gradient(135deg, var(--tgx-brand), var(--tgx-accent)); overflow: hidden; }
  .tgx-hero.has-img::before { content:""; position:absolute; inset:0; background-image: var(--tgx-hero-img); background-size: cover; background-position: center; }
  .tgx-hero.has-img::after { content:""; position:absolute; inset:0; background: linear-gradient(135deg, rgba(15,23,42,0.78), rgba(15,23,42,0.45)); }
  .tgx-hero > * { position: relative; z-index: 1; }
  .tgx-eyebrow { display:inline-flex; align-items:center; gap:8px; font-size:12px; font-weight:600; letter-spacing:0.06em; text-transform:uppercase; opacity:0.92; margin-bottom:12px; }
  .tgx-eyebrow .dot { width:6px; height:6px; border-radius:50%; background: var(--tgx-accent); }
  .tgx-name { margin:0; font-size:34px; font-weight:800; letter-spacing:-0.02em; line-height:1.1; }
  .tgx-tagline { margin:10px 0 0; font-size:17px; opacity:0.94; max-width:62ch; }
  .tgx-badges { margin-top:18px; display:flex; flex-wrap:wrap; gap:8px; }
  .tgx-badge { display:inline-flex; align-items:center; gap:6px; font-size:12px; font-weight:600; padding:6px 12px; border-radius:999px; background: rgba(255,255,255,0.16); }
  .tgx-badge.is-on { background: rgba(255,255,255,0.22); }

  /* Sections */
  .tgx-section { margin: 36px 4px; }
  .tgx-section-head { display:flex; align-items:center; gap:10px; }
  .tgx-section-icon { width:34px; height:34px; flex:0 0 34px; border-radius:9px; background: var(--tgx-brand-soft); color: var(--tgx-brand); display:flex; align-items:center; justify-content:center; }
  .tgx-kicker { font-size:12px; font-weight:700; letter-spacing:0.08em; text-transform:uppercase; color: var(--tgx-muted); }
  .tgx-h2 { margin:14px 0 16px; font-size:22px; font-weight:700; letter-spacing:-0.015em; color: var(--tgx-text); }
  .tgx-subh { margin:18px 0 8px; font-size:15px; font-weight:700; color: var(--tgx-text); }
  .tgx-prose { font-size:15px; color: var(--tgx-sub); line-height:1.65; }
  .tgx-prose p { margin:0 0 12px; } .tgx-prose p:last-child { margin:0; }

  /* Facts */
  .tgx-facts { display:grid; grid-template-columns: repeat(4, 1fr); gap:14px; margin: 24px 4px; }
  .tgx-facts[data-count="1"]{grid-template-columns:1fr} .tgx-facts[data-count="2"]{grid-template-columns:repeat(2,1fr)} .tgx-facts[data-count="3"]{grid-template-columns:repeat(3,1fr)}
  .tgx-fact { display:flex; gap:12px; align-items:flex-start; padding:16px; background: var(--tgx-card); border:1px solid var(--tgx-border); border-radius: var(--tgx-radius-sm); }
  .tgx-fact-icon { width:38px; height:38px; flex:0 0 38px; border-radius:9px; background: var(--tgx-brand-soft); color: var(--tgx-brand); display:flex; align-items:center; justify-content:center; }
  .tgx-fact-label { font-size:11px; font-weight:600; letter-spacing:0.06em; text-transform:uppercase; color: var(--tgx-muted); margin-bottom:3px; }
  .tgx-fact-value { font-size:15px; font-weight:700; color: var(--tgx-text); line-height:1.3; }

  /* Tags */
  .tgx-tags { display:flex; flex-wrap:wrap; gap:10px; }
  .tgx-tag { display:inline-flex; align-items:center; gap:6px; padding:8px 14px; background: var(--tgx-card); border:1px solid var(--tgx-border); border-radius:999px; font-size:13px; font-weight:600; color: var(--tgx-text); }
  .tgx-tag svg { color: var(--tgx-accent); flex-shrink:0; }

  /* Cards */
  .tgx-cards { display:grid; grid-template-columns: repeat(2, 1fr); gap:16px; }
  .tgx-card { background: var(--tgx-card); border:1px solid var(--tgx-border); border-radius: var(--tgx-radius); padding:20px 22px; }
  .tgx-card-head { display:flex; align-items:center; gap:10px; margin-bottom:10px; }
  .tgx-card-icon { width:34px; height:34px; flex:0 0 34px; border-radius:9px; background: var(--tgx-accent-soft); color: var(--tgx-accent); display:flex; align-items:center; justify-content:center; }
  .tgx-card-title { margin:0; font-size:15px; font-weight:700; color: var(--tgx-text); }
  .tgx-card-body { font-size:14px; color: var(--tgx-sub); line-height:1.6; }
  .tgx-card-body p { margin:0 0 10px; } .tgx-card-body p:last-child { margin:0; }

  /* Blocks (getting there) */
  .tgx-block { padding:16px 0; border-top:1px solid var(--tgx-border-soft); }
  .tgx-block:first-child { border-top:0; padding-top:0; }
  .tgx-block-label { display:flex; align-items:center; gap:8px; font-size:13px; font-weight:700; color: var(--tgx-text); margin-bottom:8px; }
  .tgx-block-label svg { color: var(--tgx-brand); }
  .tgx-maplinks { display:flex; gap:14px; margin-top:6px; }
  .tgx-maplink { display:inline-flex; align-items:center; gap:5px; font-size:13px; font-weight:600; color: var(--tgx-accent); text-decoration:none; }

  /* Callout / tips */
  .tgx-callout { background: var(--tgx-accent-soft); border-radius: var(--tgx-radius-sm); padding:20px 24px; font-size:15px; color: var(--tgx-text); line-height:1.6; }
  .tgx-callout p { margin:0 0 10px; } .tgx-callout p:last-child { margin:0; }
  .tgx-tips { position:relative; background: var(--tgx-brand); color:#E6EAF4; border-radius: var(--tgx-radius-sm); padding:22px 26px 22px 52px; font-size:15px; line-height:1.65; }
  .tgx-tips::before { content:""; position:absolute; top:20px; left:22px; width:4px; height:calc(100% - 40px); background: var(--tgx-accent); border-radius:2px; }
  .tgx-tips p { margin:0 0 10px; } .tgx-tips p:last-child { margin:0; }

  /* CTA */
  .tgx-cta { margin: 40px 4px 8px; display:flex; align-items:center; justify-content:space-between; gap:28px; flex-wrap:wrap; padding:30px 34px; border-radius: var(--tgx-radius); background: var(--tgx-brand); background: linear-gradient(135deg, var(--tgx-brand), var(--tgx-accent)); color:#fff; }
  .tgx-cta-text { flex:1; min-width:240px; }
  .tgx-cta-title { margin:0 0 4px; font-size:20px; font-weight:700; }
  .tgx-cta-sub { margin:0; font-size:14px; opacity:0.88; }
  .tgx-cta-actions { display:flex; gap:12px; flex-wrap:wrap; }
  .tgx-btn { display:inline-flex; align-items:center; gap:8px; padding:12px 20px; border-radius:999px; font-size:14px; font-weight:700; text-decoration:none; cursor:pointer; }
  .tgx-btn-primary { background:#fff; color: var(--tgx-brand); }
  .tgx-btn-ghost { background: rgba(255,255,255,0.16); color:#fff; }
  .tgx-verified { flex-basis:100%; margin:14px 0 0; font-size:12px; opacity:0.8; display:inline-flex; align-items:center; gap:6px; }

  /* Notice */
  .tgx-notice { text-align:center; padding:60px 24px; }
  .tgx-notice-icon { width:52px; height:52px; margin:0 auto 16px; border-radius:14px; background: var(--tgx-brand-soft); color: var(--tgx-brand); display:flex; align-items:center; justify-content:center; }
  .tgx-notice-title { margin:0 0 6px; font-size:19px; color: var(--tgx-text); }
  .tgx-notice-body { margin:0; font-size:14px; color: var(--tgx-sub); }

  @media (max-width: 760px) {
    .tgx-hero { padding:30px 24px; } .tgx-name { font-size:27px; }
    .tgx-facts, .tgx-facts[data-count] { grid-template-columns: repeat(2, 1fr); }
    .tgx-cards { grid-template-columns: 1fr; }
    .tgx-cta { padding:24px; }
  }
  @media (max-width: 420px) { .tgx-facts, .tgx-facts[data-count] { grid-template-columns: 1fr; } }
  @media (prefers-reduced-motion: reduce) { .tgx-skel { animation: none; } }
  `;

  function init() {
    const nodes = document.querySelectorAll('[data-tg-widget="attraction"]:not([data-tg-initialised])');
    nodes.forEach(el => {
      try {
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
          fetch(CONFIG_API + '?id=' + encodeURIComponent(id), { credentials: 'omit' })
            .then(r => (r.ok ? r.json() : null))
            .then(data => {
              const cfg = (data && (data.config || data)) || {};
              cfg.widgetId = id;
              el.__tgAttraction = new TGAttractionWidget(el, cfg);
            })
            .catch(() => { el.__tgAttraction = new TGAttractionWidget(el, { widgetId: id }); });
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
