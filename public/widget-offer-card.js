/* ============================================================================
 * widget-offer-card.js  ·  Travelgenix Widget Suite
 * Special Offer Card — the display card for a hand-built offer (v0.1.0)
 *
 * Renders one offer (the object the Special Offer Builder form emits) as a
 * card, in one of two layouts:
 *   - vertical   : image on top, body, price + CTA footer (grid-friendly)
 *   - horizontal : image left, body middle, price + CTA rail right (list/banner)
 *
 * It is layout only. Clicking the card (or its CTA) goes to ctaHref, which will
 * be the public offer page once that is built. Matches the house card anatomy
 * and --tgo-* tokens from widget-offers.js so hand-built cards sit beside the
 * live cached offers.
 *
 * Embed:
 *   <div data-tg-widget="offer-card" data-tg-id="YOUR_WIDGET_ID"></div>
 * or inline (demo / preview), offer + card options together in the config:
 *   <div data-tg-widget="offer-card"
 *        data-tg-config='{"layout":"vertical","offer":{...}}'></div>
 *
 * The offer shape is exactly the builder output:
 *   { fields:{title,teaser,country,region,resort,property,stars,board,style,
 *             type,nights,price,was,basis,badge,badgeAmount,urgency,image,...},
 *     includes:[...], tags:[...], currency:'GBP' }
 * Flat objects (no `fields` wrapper) are also accepted.
 * ========================================================================== */
(function () {
  'use strict';

  const VERSION = '0.1.0';
  const API_BASE = '/api/widget-config';

  // ── Helpers ────────────────────────────────────────────────────────────────
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function currencySymbol(code) {
    return { GBP: '£', EUR: '€', USD: '$', AUD: '$', CAD: '$' }[code] || '£';
  }
  // Format a price value (string or number) with thousands separators.
  function money(sym, val) {
    if (val == null || val === '') return '';
    const n = Number(String(val).replace(/[^0-9.]/g, ''));
    if (!isFinite(n) || n === 0) return '';
    return sym + n.toLocaleString('en-GB');
  }
  // '5 star' -> 5
  function parseStars(s) {
    const m = String(s || '').match(/\d/);
    return m ? Math.min(5, parseInt(m[0], 10)) : 0;
  }
  // 'Package holiday (flight + hotel)' -> 'Package holiday'; 'Hotel / accommodation only' -> 'Hotel'
  function shortType(t) {
    if (!t) return '';
    return String(t).split('(')[0].split('/')[0].replace(/\s+only$/i, '').trim();
  }
  // ── Scheduling: an offer shows only within its [showFrom, showUntil] window.
  // Either bound may be absent. Dates are compared at day granularity in the
  // viewer's local time, so a "show until" date is inclusive of that whole day.
  function parseDay(s) {
    if (!s) return null;
    const m = String(s).trim().match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (m) return new Date(+m[1], +m[2] - 1, +m[3]).getTime();
    const t = Date.parse(s);
    if (!isFinite(t)) return null;
    const dt = new Date(t);
    return new Date(dt.getFullYear(), dt.getMonth(), dt.getDate()).getTime();
  }
  function offerWindow(fromStr, untilStr) {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const from = parseDay(fromStr), until = parseDay(untilStr);
    if (from !== null && today < from) return { live: false, state: 'upcoming', from: from, until: until };
    if (until !== null && today > until) return { live: false, state: 'ended', from: from, until: until };
    return { live: true, state: 'live', from: from, until: until };
  }

  // URL-safe base64 of a (possibly unicode) string — used to carry a whole
  // offer to the /offer page when there is no saved id yet.
  function b64urlEncode(str) {
    const utf8 = unescape(encodeURIComponent(str));
    return btoa(utf8).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  // Only allow http(s) / relative URLs through to href + background-image.
  function safeUrl(u) {
    if (!u) return '';
    const s = String(u).trim();
    if (/^(https?:)?\/\//i.test(s) || s.startsWith('/') || s.startsWith('#')) return s;
    return '';
  }

  const PIN = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>';

  // ── Scoped styles (shadow DOM, --tgo-* tokens shared with widget-offers) ──
  const STYLES = `
    :host { all: initial; display: block; }
    * { box-sizing: border-box; }
    .tgoc-root {
      --tgo-brand: #1B2B5B; --tgo-accent: #00B4D8; --tgo-accent-hover: #0096B7;
      --tgo-card: #FFFFFF; --tgo-card-alt: #FAFBFC; --tgo-text: #0F172A;
      --tgo-sub: #64748B; --tgo-muted: #94A3B8; --tgo-border: #E2E8F0;
      --tgo-success: #10B981; --tgo-warn: #D97706; --tgo-strike: #94A3B8;
      --tgo-radius: 14px; --tgo-shadow: 0 1px 2px rgba(15,23,42,0.04);
      --tgo-shadow-hover: 0 8px 24px rgba(15,23,42,0.08);
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      color: var(--tgo-text); line-height: 1.5; width: 100%; max-width: 100%;
    }
    .tgoc-root[data-theme="dark"] {
      --tgo-card: #1E293B; --tgo-card-alt: #0F172A; --tgo-text: #F1F5F9;
      --tgo-sub: #94A3B8; --tgo-muted: #64748B; --tgo-border: #334155;
      --tgo-strike: #64748B; --tgo-shadow: 0 1px 2px rgba(0,0,0,0.3);
      --tgo-shadow-hover: 0 8px 24px rgba(0,0,0,0.4);
    }

    .tgoc-card {
      background: var(--tgo-card); border: 1px solid var(--tgo-border);
      border-radius: var(--tgo-radius); overflow: hidden; box-shadow: var(--tgo-shadow);
      transition: transform 0.15s ease, box-shadow 0.15s ease, border-color 0.15s ease;
      text-decoration: none; color: inherit; cursor: pointer; display: flex;
    }
    .tgoc-card:hover { transform: translateY(-2px); box-shadow: var(--tgo-shadow-hover); border-color: var(--tgo-accent); }
    @media (prefers-reduced-motion: reduce) { .tgoc-card { transition: none; } .tgoc-card:hover { transform: none; } }

    /* Image */
    .tgoc-img { position: relative; background: var(--tgo-card-alt) center/cover no-repeat; flex-shrink: 0; }
    .tgoc-img-ph {
      position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
      background: linear-gradient(135deg, var(--tgo-brand), var(--tgo-accent));
      color: rgba(255,255,255,0.92); font-size: 15px; font-weight: 700; letter-spacing: 0.5px;
      text-align: center; padding: 12px;
    }
    .tgoc-stars {
      position: absolute; top: 10px; left: 10px; background: rgba(0,0,0,0.7); color: #FFD166;
      padding: 4px 10px; border-radius: 6px; font-size: 12px; font-weight: 600;
      backdrop-filter: blur(4px); letter-spacing: 1px;
    }
    .tgoc-badge {
      position: absolute; top: 10px; right: 10px; background: var(--tgo-warn); color: #fff;
      padding: 4px 11px; border-radius: 6px; font-size: 11px; font-weight: 700;
      text-transform: uppercase; letter-spacing: 0.5px;
    }
    .tgoc-pill {
      position: absolute; bottom: 10px; left: 10px; background: var(--tgo-success); color: #fff;
      padding: 4px 11px; border-radius: 999px; font-size: 11px; font-weight: 700;
    }

    /* Body */
    .tgoc-body { padding: 14px 16px; display: flex; flex-direction: column; gap: 6px; min-width: 0; }
    .tgoc-eyebrow { font-size: 10px; color: var(--tgo-accent); font-weight: 700; text-transform: uppercase; letter-spacing: 0.6px; }
    .tgoc-title { font-weight: 700; font-size: 17px; line-height: 1.3; margin: 0; color: var(--tgo-text); }
    .tgoc-loc { font-size: 13px; color: var(--tgo-sub); display: inline-flex; align-items: center; gap: 5px; }
    .tgoc-loc svg { color: var(--tgo-muted); flex-shrink: 0; }
    .tgoc-teaser {
      font-size: 12px; color: var(--tgo-sub); line-height: 1.5; margin: 2px 0 0;
      display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
    }
    .tgoc-tags { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 4px; }
    .tgoc-tag {
      font-size: 10px; font-weight: 600; background: var(--tgo-card-alt); border: 1px solid var(--tgo-border);
      color: var(--tgo-sub); padding: 3px 8px; border-radius: 999px;
    }

    /* Price block + CTA */
    .tgoc-price-block { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
    .tgoc-was { font-size: 12px; color: var(--tgo-strike); text-decoration: line-through; }
    .tgoc-price { font-weight: 800; font-size: 23px; line-height: 1; color: var(--tgo-text); }
    .tgoc-price-sub { font-size: 11px; color: var(--tgo-sub); margin-top: 2px; }
    .tgoc-cta {
      background: var(--tgo-accent); color: #fff; border: 0; border-radius: 9px; padding: 10px 16px;
      font-weight: 700; font-size: 13px; cursor: pointer; white-space: nowrap; text-decoration: none;
      display: inline-flex; align-items: center; justify-content: center; font-family: inherit;
    }
    .tgoc-cta:hover { background: var(--tgo-accent-hover); }

    /* ── Vertical layout ── */
    .tgoc-card--vertical { flex-direction: column; max-width: 380px; }
    .tgoc-card--vertical .tgoc-img { aspect-ratio: 16 / 10; width: 100%; }
    .tgoc-card--vertical .tgoc-body { flex: 1; }
    .tgoc-card--vertical .tgoc-foot {
      display: flex; justify-content: space-between; align-items: flex-end; gap: 12px;
      padding: 12px 16px 16px; margin-top: auto;
    }

    /* ── Horizontal layout ── */
    .tgoc-card--horizontal { flex-direction: row; align-items: stretch; width: 100%; }
    .tgoc-card--horizontal .tgoc-img { width: 240px; min-height: 170px; align-self: stretch; }
    .tgoc-card--horizontal .tgoc-body { flex: 1; justify-content: center; padding: 18px 20px; }
    .tgoc-card--horizontal .tgoc-rail {
      flex-shrink: 0; width: 200px; border-left: 1px solid var(--tgo-border);
      padding: 18px 20px; display: flex; flex-direction: column; justify-content: center;
      align-items: flex-start; gap: 14px; background: var(--tgo-card-alt);
    }
    .tgoc-card--horizontal .tgoc-rail .tgoc-cta { width: 100%; }

    /* Horizontal collapses to a stacked card on narrow hosts */
    @media (max-width: 560px) {
      .tgoc-card--horizontal { flex-direction: column; }
      .tgoc-card--horizontal .tgoc-img { width: 100%; aspect-ratio: 16 / 10; min-height: 0; }
      .tgoc-card--horizontal .tgoc-rail {
        width: 100%; border-left: 0; border-top: 1px solid var(--tgo-border);
        flex-direction: row; justify-content: space-between; align-items: center;
      }
      .tgoc-card--horizontal .tgoc-rail .tgoc-cta { width: auto; }
    }

    /* ── Banner layout — full-bleed image, offer overlaid ── */
    .tgoc-card--banner { position: relative; flex-direction: column; justify-content: flex-end; width: 100%; min-height: 300px; color: #fff; overflow: hidden; }
    .tgoc-card--banner .tgoc-bimg { position: absolute; inset: 0; background-size: cover; background-position: center; transition: transform 0.4s ease; }
    .tgoc-card--banner:hover .tgoc-bimg { transform: scale(1.04); }
    .tgoc-card--banner .tgoc-bimg.ph { background: linear-gradient(135deg, var(--tgo-brand), var(--tgo-accent)); }
    .tgoc-card--banner::after {
      content: ''; position: absolute; inset: 0; pointer-events: none;
      background: linear-gradient(90deg, rgba(7,12,24,0.82) 0%, rgba(7,12,24,0.5) 42%, rgba(7,12,24,0.12) 100%),
                  linear-gradient(0deg, rgba(7,12,24,0.55) 0%, rgba(7,12,24,0) 55%);
    }
    .tgoc-card--banner.tgoc-flip::after {
      background: linear-gradient(270deg, rgba(7,12,24,0.82) 0%, rgba(7,12,24,0.5) 42%, rgba(7,12,24,0.12) 100%),
                  linear-gradient(0deg, rgba(7,12,24,0.55) 0%, rgba(7,12,24,0) 55%);
    }
    .tgoc-card--banner .tgoc-badge, .tgoc-card--banner .tgoc-pill { z-index: 3; }
    .tgoc-card--banner .tgoc-bwrap {
      position: relative; z-index: 2; display: flex; align-items: flex-end; justify-content: space-between;
      gap: 28px; padding: 26px 30px; width: 100%;
    }
    .tgoc-card--banner.tgoc-flip .tgoc-bwrap { flex-direction: row-reverse; text-align: right; }
    .tgoc-card--banner.tgoc-flip .tgoc-b-meta, .tgoc-card--banner.tgoc-flip .tgoc-tags { justify-content: flex-end; }
    .tgoc-b-text { min-width: 0; }
    .tgoc-b-eyebrow { font-size: 11px; font-weight: 700; letter-spacing: 1px; text-transform: uppercase; color: rgba(255,255,255,0.85); }
    .tgoc-b-title { font-size: clamp(22px, 3vw, 30px); font-weight: 800; line-height: 1.15; letter-spacing: -0.5px; margin: 6px 0 8px; text-shadow: 0 2px 18px rgba(0,0,0,0.4); }
    .tgoc-b-meta { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; font-size: 14px; }
    .tgoc-b-meta .tgoc-loc { color: rgba(255,255,255,0.92); }
    .tgoc-b-meta .tgoc-loc svg { color: rgba(255,255,255,0.8); }
    .tgoc-b-stars { color: var(--tgo-gold, #FFD166); letter-spacing: 1px; }
    .tgoc-card--banner .tgoc-tags { margin-top: 10px; }
    .tgoc-card--banner .tgoc-tag { background: rgba(255,255,255,0.16); border-color: rgba(255,255,255,0.28); color: #fff; }
    .tgoc-b-buy { flex-shrink: 0; display: flex; flex-direction: column; align-items: flex-end; gap: 12px; text-align: right; }
    .tgoc-card--banner .tgoc-price { color: #fff; font-size: 30px; }
    .tgoc-card--banner .tgoc-was { color: rgba(255,255,255,0.72); }
    .tgoc-card--banner .tgoc-price-sub { color: rgba(255,255,255,0.82); }
    .tgoc-card--banner .tgoc-price-block { align-items: flex-end; }
    .tgoc-card--banner .tgoc-cta { padding: 12px 22px; font-size: 14px; box-shadow: 0 8px 22px rgba(0,0,0,0.3); }

    @media (max-width: 600px) {
      .tgoc-card--banner { min-height: 0; }
      .tgoc-card--banner .tgoc-bwrap, .tgoc-card--banner.tgoc-flip .tgoc-bwrap {
        flex-direction: column; align-items: flex-start; text-align: left; gap: 16px; padding: 20px;
      }
      .tgoc-card--banner .tgoc-b-buy { align-items: flex-start; text-align: left; flex-direction: row; align-items: center; gap: 16px; }
      .tgoc-card--banner .tgoc-price-block { align-items: flex-start; }
    }

    /* ── Split layout — editorial 50/50 with a big price ── */
    .tgoc-card--split { flex-direction: row; width: 100%; min-height: 320px; }
    .tgoc-card--split.tgoc-flip { flex-direction: row-reverse; }
    .tgoc-card--split .tgoc-img { width: 46%; min-height: 320px; align-self: stretch; }
    .tgoc-card--split .tgoc-sbody { flex: 1; padding: 30px 36px; display: flex; flex-direction: column; justify-content: center; gap: 8px; min-width: 0; }
    .tgoc-card--split .tgoc-eyebrow { font-size: 11px; }
    .tgoc-s-title { font-size: clamp(22px, 2.4vw, 28px); font-weight: 800; line-height: 1.2; letter-spacing: -0.5px; margin: 4px 0 2px; }
    .tgoc-s-meta { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
    .tgoc-s-meta .tgoc-loc { font-size: 14px; }
    .tgoc-s-stars { color: var(--tgo-gold, #FFB703); letter-spacing: 1px; }
    .tgoc-s-teaser { font-size: 14.5px; color: var(--tgo-sub); line-height: 1.6; margin: 8px 0 0; max-width: 60ch; }
    .tgoc-card--split .tgoc-tags { margin-top: 12px; }
    .tgoc-sfoot { display: flex; align-items: flex-end; justify-content: space-between; gap: 18px; margin-top: 20px; padding-top: 18px; border-top: 1px solid var(--tgo-border); }
    .tgoc-card--split .tgoc-price { font-size: 30px; }
    .tgoc-card--split .tgoc-cta { padding: 12px 24px; font-size: 14px; }

    @media (max-width: 620px) {
      .tgoc-card--split, .tgoc-card--split.tgoc-flip { flex-direction: column; }
      .tgoc-card--split .tgoc-img { width: 100%; aspect-ratio: 16 / 10; min-height: 0; }
      .tgoc-card--split .tgoc-sbody { padding: 22px; }
    }
  `;

  // ── Widget class ──────────────────────────────────────────────────────────
  class TGOfferCardWidget {
    constructor(container, config) {
      this.el = container;
      container._tgInitialised = true;
      this.cfg = this._defaults(config);
      this.shadow = container.attachShadow({ mode: 'open' });
      this._render();
    }

    _defaults(c) {
      c = c || {};
      const layouts = ['vertical', 'horizontal', 'banner', 'split'];
      return {
        layout: layouts.indexOf(c.layout) !== -1 ? c.layout : 'vertical',
        imageSide: c.imageSide === 'right' ? 'right' : 'left',  // split + banner text alignment
        theme: c.theme === 'dark' ? 'dark' : 'light',
        brandColor: c.brandColor || '',
        accentColor: c.accentColor || '',
        radius: typeof c.radius === 'number' ? c.radius : 14,
        currency: c.currency || '',
        ctaText: c.ctaText || 'View deal',
        ctaHref: safeUrl(c.ctaHref) || '',
        // Offer-page linking. When ctaHref is not set explicitly, the card links
        // to offerPage, carrying the offer's saved id when there is one, else the
        // whole offer encoded in the URL so it works before offers are stored.
        offerPage: c.offerPage || '',
        offerId: c.offerId || '',
        ctaTarget: c.ctaTarget === '_blank' ? '_blank' : '',
        offer: c.offer && typeof c.offer === 'object' ? c.offer : {}
      };
    }

    // Resolve the destination for the card + its CTA.
    _href() {
      if (this.cfg.ctaHref) return this.cfg.ctaHref;
      const base = this.cfg.offerPage;
      if (!base) return '';
      const o = this.cfg.offer || {};
      const id = this.cfg.offerId || o.id || (o.fields && o.fields.id) || '';
      const sep = base.indexOf('?') >= 0 ? '&' : '?';
      if (id) return base + sep + 'id=' + encodeURIComponent(id);
      try { return base + sep + 'data=' + b64urlEncode(JSON.stringify(o)); }
      catch (e) { return base; }
    }

    // Pull a value from the offer, whether it is wrapped in `fields` or flat.
    _f(key) {
      const o = this.cfg.offer || {};
      if (o.fields && o.fields[key] != null && o.fields[key] !== '') return o.fields[key];
      if (o[key] != null && o[key] !== '') return o[key];
      return '';
    }

    _derive() {
      const o = this.cfg.offer || {};
      const sym = currencySymbol(this.cfg.currency || o.currency || 'GBP');
      const stars = parseStars(this._f('stars'));
      const eyebrow = [this._f('style'), shortType(this._f('type'))].filter(Boolean).join(' · ');
      const loc = [this._f('resort'), this._f('country')].filter(Boolean).join(', ') || this._f('region');
      const nights = this._f('nights');
      const priceSub = [this._f('basis'), nights ? nights + ' nights' : ''].filter(Boolean).join(' · ');

      // Promo badge — 'Save' uses the amount, others show their own label.
      const badge = this._f('badge');
      let badgeText = '';
      if (badge && badge !== 'No badge') {
        const amt = money(sym, this._f('badgeAmount'));
        badgeText = (badge === 'Save' && amt) ? 'Save ' + amt : badge;
      }

      const tags = Array.isArray(o.tags) ? o.tags.slice(0, 3) : [];

      return {
        sym: sym,
        stars: stars,
        eyebrow: eyebrow,
        title: this._f('title') || 'Untitled offer',
        loc: loc,
        teaser: this._f('teaser'),
        tags: tags,
        price: money(sym, this._f('price')),
        was: money(sym, this._f('was')),
        priceSub: priceSub,
        badgeText: badgeText,
        urgency: this._f('urgency'),
        image: safeUrl(this._f('image') || o.image)
      };
    }

    // Absolutely-positioned overlay chips (stars, promo badge, urgency pill),
    // shared by the image block and the banner layout.
    _chips(d) {
      const stars = d.stars ? '<span class="tgoc-stars">' + '★'.repeat(d.stars) + '</span>' : '';
      const badge = d.badgeText ? '<span class="tgoc-badge">' + esc(d.badgeText) + '</span>' : '';
      const pill = d.urgency ? '<span class="tgoc-pill">' + esc(d.urgency) + '</span>' : '';
      return stars + badge + pill;
    }

    _imageBlock(d) {
      const bg = d.image ? ' style="background-image:url(' + esc(d.image) + ')"' : '';
      const ph = d.image ? '' : '<div class="tgoc-img-ph">' + esc(d.loc || d.title) + '</div>';
      return '<div class="tgoc-img"' + bg + '>' + ph + this._chips(d) + '</div>';
    }

    _bodyBlock(d) {
      const eyebrow = d.eyebrow ? '<span class="tgoc-eyebrow">' + esc(d.eyebrow) + '</span>' : '';
      const loc = d.loc ? '<span class="tgoc-loc">' + PIN + esc(d.loc) + '</span>' : '';
      const teaser = d.teaser ? '<p class="tgoc-teaser">' + esc(d.teaser) + '</p>' : '';
      const tags = d.tags.length
        ? '<div class="tgoc-tags">' + d.tags.map(function (t) { return '<span class="tgoc-tag">' + esc(t) + '</span>'; }).join('') + '</div>'
        : '';
      return '<div class="tgoc-body">' + eyebrow
        + '<h3 class="tgoc-title">' + esc(d.title) + '</h3>'
        + loc + teaser + tags + '</div>';
    }

    _priceBlock(d) {
      const was = d.was ? '<span class="tgoc-was">' + esc(d.was) + '</span>' : '';
      const price = d.price ? '<div class="tgoc-price">' + esc(d.price) + '</div>' : '<div class="tgoc-price">POA</div>';
      const sub = d.priceSub ? '<span class="tgoc-price-sub">' + esc(d.priceSub) + '</span>' : '';
      return '<div class="tgoc-price-block">' + was + price + sub + '</div>';
    }

    _cta() {
      const href = this._linkHref || '#';
      const tgt = this.cfg.ctaTarget ? ' target="_blank" rel="noopener"' : '';
      return '<a class="tgoc-cta" href="' + esc(href) + '"' + tgt + '>' + esc(this.cfg.ctaText) + '</a>';
    }

    // Banner: full-bleed image with the offer overlaid. Punchy and promotional.
    _bannerCard(d) {
      const bg = d.image ? ' style="background-image:url(' + esc(d.image) + ')"' : '';
      const phCls = d.image ? '' : ' ph';
      const eyebrow = d.eyebrow ? '<span class="tgoc-b-eyebrow">' + esc(d.eyebrow) + '</span>' : '';
      const loc = d.loc ? '<span class="tgoc-loc">' + PIN + esc(d.loc) + '</span>' : '';
      const stars = d.stars ? '<span class="tgoc-b-stars">' + '★'.repeat(d.stars) + '</span>' : '';
      const tags = d.tags.length
        ? '<div class="tgoc-tags">' + d.tags.map(function (t) { return '<span class="tgoc-tag">' + esc(t) + '</span>'; }).join('') + '</div>'
        : '';
      const badge = d.badgeText ? '<span class="tgoc-badge">' + esc(d.badgeText) + '</span>' : '';
      const pill = d.urgency ? '<span class="tgoc-pill">' + esc(d.urgency) + '</span>' : '';
      return '<div class="tgoc-bimg' + phCls + '"' + bg + '></div>' + badge + pill
        + '<div class="tgoc-bwrap">'
          + '<div class="tgoc-b-text">' + eyebrow
            + '<h3 class="tgoc-b-title">' + esc(d.title) + '</h3>'
            + '<div class="tgoc-b-meta">' + loc + stars + '</div>' + tags
          + '</div>'
          + '<div class="tgoc-b-buy">' + this._priceBlock(d) + this._cta() + '</div>'
        + '</div>';
    }

    // Split: editorial 50/50 with a big price. For a featured deal.
    _splitCard(d) {
      const eyebrow = d.eyebrow ? '<span class="tgoc-eyebrow">' + esc(d.eyebrow) + '</span>' : '';
      const loc = d.loc ? '<span class="tgoc-loc">' + PIN + esc(d.loc) + '</span>' : '';
      const stars = d.stars ? '<span class="tgoc-s-stars">' + '★'.repeat(d.stars) + '</span>' : '';
      const teaser = d.teaser ? '<p class="tgoc-s-teaser">' + esc(d.teaser) + '</p>' : '';
      const tags = d.tags.length
        ? '<div class="tgoc-tags">' + d.tags.map(function (t) { return '<span class="tgoc-tag">' + esc(t) + '</span>'; }).join('') + '</div>'
        : '';
      return this._imageBlock(d)
        + '<div class="tgoc-sbody">' + eyebrow
          + '<h3 class="tgoc-s-title">' + esc(d.title) + '</h3>'
          + '<div class="tgoc-s-meta">' + loc + stars + '</div>'
          + teaser + tags
          + '<div class="tgoc-sfoot">' + this._priceBlock(d) + this._cta() + '</div>'
        + '</div>';
    }

    _render() {
      const cfg = this.cfg;

      // Scheduling: outside its show window the card renders nothing, so it
      // simply disappears from a listing until (and only while) it is live.
      this._window = offerWindow(this._f('showFrom'), this._f('showUntil'));
      if (!this._window.live) {
        this.shadow.innerHTML = '';
        this.el.setAttribute('data-tg-hidden', this._window.state);
        return;
      }
      this.el.removeAttribute('data-tg-hidden');

      const d = this._derive();

      this.root = document.createElement('div');
      this.root.className = 'tgoc-root';
      this.root.setAttribute('data-theme', cfg.theme);
      if (cfg.brandColor) this.root.style.setProperty('--tgo-brand', cfg.brandColor);
      if (cfg.accentColor) {
        this.root.style.setProperty('--tgo-accent', cfg.accentColor);
        this.root.style.setProperty('--tgo-accent-hover', cfg.accentColor);
      }
      if (cfg.radius) this.root.style.setProperty('--tgo-radius', cfg.radius + 'px');

      this._linkHref = this._href();

      let inner;
      if (cfg.layout === 'banner') {
        inner = this._bannerCard(d);
      } else if (cfg.layout === 'split') {
        inner = this._splitCard(d);
      } else if (cfg.layout === 'horizontal') {
        inner = this._imageBlock(d) + this._bodyBlock(d)
          + '<div class="tgoc-rail">' + this._priceBlock(d) + this._cta() + '</div>';
      } else {
        inner = this._imageBlock(d) + this._bodyBlock(d)
          + '<div class="tgoc-foot">' + this._priceBlock(d) + this._cta() + '</div>';
      }

      // The whole card is an <a> when a destination is set, else a div.
      const tag = this._linkHref ? 'a' : 'div';
      const card = document.createElement(tag);
      card.className = 'tgoc-card tgoc-card--' + cfg.layout
        + (cfg.imageSide === 'right' ? ' tgoc-flip' : '');
      if (this._linkHref) {
        card.setAttribute('href', this._linkHref);
        if (cfg.ctaTarget) { card.setAttribute('target', '_blank'); card.setAttribute('rel', 'noopener'); }
      }
      card.innerHTML = inner;
      this.root.appendChild(card);

      this.shadow.innerHTML = '<style>' + STYLES + '</style>';
      this.shadow.appendChild(this.root);
    }

    // Public: update the offer and/or card options and re-render in place.
    update(config) {
      this.cfg = this._defaults(Object.assign({}, this.cfg, config));
      this._render();
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
      console.error('[TGOfferCard] Config load error:', err);
      return null;
    }
  }

  async function init() {
    const containers = document.querySelectorAll('[data-tg-widget="offer-card"]');
    for (const el of containers) {
      if (el._tgInitialised || el.shadowRoot) continue;
      el._tgInitialised = true;
      let config = null;
      const inline = el.getAttribute('data-tg-config');
      const offerAttr = el.getAttribute('data-tg-offer');
      const widgetId = el.getAttribute('data-tg-id');
      if (inline) {
        try { config = JSON.parse(inline); } catch (e) { console.error('[TGOfferCard] Invalid inline config:', e); continue; }
      } else if (widgetId) {
        config = await loadConfigFromApi(widgetId);
        if (!config) continue;
      } else {
        config = {};
      }
      if (offerAttr && !config.offer) {
        try { config.offer = JSON.parse(offerAttr); } catch (e) { console.error('[TGOfferCard] Invalid data-tg-offer:', e); }
      }
      new TGOfferCardWidget(el, config);
    }
  }

  if (typeof window !== 'undefined') {
    window.TGOfferCardWidget = TGOfferCardWidget;
    window.TGOfferCardWidget.version = VERSION;
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
  }
})();
