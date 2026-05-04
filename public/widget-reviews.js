/**
 * Travelgenix Google Reviews Widget v1.0.0
 * Self-contained, embeddable reviews widget
 * Zero dependencies — works on any website via a single script tag
 *
 * Usage:
 *   <div data-tg-widget="reviews" data-tg-id="YOUR_WIDGET_ID"></div>
 *   <script src="https://tg-widgets.vercel.app/widget-reviews.js"></script>
 *
 * Or inline: <div data-tg-widget="reviews" data-tg-config='{ ... }'></div>
 */
(function () {
  'use strict';
  const API_BASE = (typeof window !== 'undefined' && window.__TG_WIDGET_API__) || '/api/widget-config';
  const VERSION = '1.0.0';

  /* ━━━ SVG ICONS ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
  const IC = {
    star: '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>',
    thumbsUp: '<path d="M14 9V5a3 3 0 00-3-3l-4 9v11h11.28a2 2 0 002-1.7l1.38-9a2 2 0 00-2-2.3H14zM7 22H4a2 2 0 01-2-2v-7a2 2 0 012-2h3"/>',
    msgSq: '<path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>',
    extLink: '<path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>',
    shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
    quote: '<path d="M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V21z"/><path d="M15 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2h.75c0 2.25.25 4-2.75 4v3c0 1 0 1 1 1z"/>',
    chevL: '<polyline points="15 18 9 12 15 6"/>',
    chevR: '<polyline points="9 18 15 12 9 6"/>',
    x: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
    arrowUp: '<line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/>',
    heart: '<path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/>',
    users: '<path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/>',
    trending: '<polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/>',
    award: '<circle cx="12" cy="8" r="7"/><polyline points="8.21 13.89 7 23 12 20 17 23 15.79 13.88"/>',
    sparkles: '<path d="M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5L12 3z"/><path d="M19 13l.75 2.25L22 16l-2.25.75L19 19l-.75-2.25L16 16l2.25-.75L19 13z"/>',
    helpCircle: '<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
    filter: '<polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>',
    google: '<svg viewBox="0 0 24 24" style="width:16px;height:16px"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>',
  };

  function icon(n, cls) {
    if (n === 'google') return IC.google;
    return `<svg class="${cls || ''}" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">${IC[n] || ''}</svg>`;
  }

  function stars(count, size, color) {
    let h = '';
    for (let i = 1; i <= 5; i++) {
      const fill = i <= count ? color : 'none';
      const stroke = i <= count ? color : '#D1D5DB';
      h += `<svg style="width:${size}px;height:${size}px" viewBox="0 0 24 24"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/></svg>`;
    }
    return `<span class="tgr-stars">${h}</span>`;
  }

  /* ━━━ CSS ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
  const STYLES = `
    :host { all:initial; display:block; font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; line-height:1.5; -webkit-font-smoothing:antialiased; }
    *,*::before,*::after { box-sizing:border-box; margin:0; padding:0; }

    .tgr-root {
      --tgr-brand:#0891B2; --tgr-accent:#6366F1; --tgr-star:#F59E0B;
      --tgr-bg:#F8FAFC; --tgr-card:#FFFFFF; --tgr-text:#0F172A; --tgr-sub:#64748B; --tgr-muted:#94A3B8;
      --tgr-border:#E2E8F0; --tgr-radius:16px; --tgr-radius-sm:12px;
      width:100%; padding:48px 24px; background:var(--tgr-bg); color:var(--tgr-text); transition:background .3s;
    }
    .tgr-root[data-theme="dark"] {
      --tgr-bg:#0F172A; --tgr-card:#1E293B; --tgr-text:#F1F5F9; --tgr-sub:#94A3B8; --tgr-muted:#64748B; --tgr-border:#334155;
    }

    /* Header */
    .tgr-header { display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:16px; margin-bottom:24px; }
    .tgr-header-left { display:flex; align-items:center; gap:16px; }
    .tgr-rating-box { width:56px; height:56px; border-radius:16px; display:flex; align-items:center; justify-content:center; background:color-mix(in srgb, var(--tgr-brand) 10%, transparent); }
    .tgr-rating-box svg { width:24px; height:24px; fill:var(--tgr-brand); stroke:var(--tgr-brand); }
    .tgr-rating-num { font-size:32px; font-weight:800; letter-spacing:-.03em; color:var(--tgr-text); font-variant-numeric:tabular-nums; }
    .tgr-rating-info { font-size:14px; color:var(--tgr-sub); }
    .tgr-rating-info strong { color:var(--tgr-text); font-weight:600; }
    .tgr-stars { display:inline-flex; gap:2px; vertical-align:middle; }
    .tgr-stars svg { display:inline-block; }
    .tgr-cta { display:inline-flex; align-items:center; gap:8px; padding:10px 20px; border-radius:var(--tgr-radius-sm); font-size:14px; font-weight:600; color:#fff; background:linear-gradient(135deg,var(--tgr-brand),color-mix(in srgb,var(--tgr-brand) 80%,transparent)); text-decoration:none; transition:all .2s; border:none; cursor:pointer; font-family:inherit; }
    .tgr-cta:hover { box-shadow:0 6px 16px color-mix(in srgb,var(--tgr-brand) 35%,transparent); transform:scale(1.03); }
    .tgr-cta svg { width:14px; height:14px; stroke:currentColor; fill:none; stroke-width:2; stroke-linecap:round; stroke-linejoin:round; }

    /* AI Highlights */
    .tgr-ai { margin-bottom:28px; }
    .tgr-ai-label { display:flex; align-items:center; gap:8px; margin-bottom:12px; font-size:11px; font-weight:700; color:var(--tgr-muted); text-transform:uppercase; letter-spacing:.5px; }
    .tgr-ai-icon { width:20px; height:20px; border-radius:6px; display:flex; align-items:center; justify-content:center; background:linear-gradient(135deg,#8B5CF6,#06B6D4); }
    .tgr-ai-icon svg { width:11px; height:11px; stroke:#fff; fill:none; stroke-width:2; stroke-linecap:round; stroke-linejoin:round; }
    .tgr-ai-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(200px,1fr)); gap:12px; }
    .tgr-ai-card { background:var(--tgr-card); border:1px solid var(--tgr-border); border-radius:var(--tgr-radius-sm); padding:16px; transition:all .2s; }
    .tgr-ai-card:hover { box-shadow:0 4px 12px rgba(0,0,0,.06); transform:translateY(-2px); }
    .tgr-ai-card-icon { width:32px; height:32px; border-radius:8px; display:flex; align-items:center; justify-content:center; margin-bottom:8px; }
    .tgr-ai-card-icon svg { width:15px; height:15px; stroke-width:2; stroke-linecap:round; stroke-linejoin:round; fill:none; }
    .tgr-ai-card-label { font-size:11px; font-weight:700; color:var(--tgr-muted); margin-bottom:2px; }
    .tgr-ai-card-value { font-size:14px; font-weight:600; color:var(--tgr-text); line-height:1.3; }

    /* Tags */
    .tgr-tags { display:flex; flex-wrap:wrap; gap:8px; margin-bottom:24px; align-items:center; }
    .tgr-tag { display:inline-flex; align-items:center; gap:4px; padding:6px 14px; border-radius:20px; font-size:12px; font-weight:600; border:1px solid var(--tgr-border); background:var(--tgr-card); color:var(--tgr-sub); cursor:pointer; transition:all .2s; font-family:inherit; }
    .tgr-tag:hover { border-color:color-mix(in srgb,var(--tgr-brand) 40%,transparent); }
    .tgr-tag.active { background:color-mix(in srgb,var(--tgr-brand) 10%,transparent); border-color:color-mix(in srgb,var(--tgr-brand) 40%,transparent); color:var(--tgr-brand); }
    .tgr-tag svg { width:11px; height:11px; stroke:currentColor; fill:none; stroke-width:2; stroke-linecap:round; stroke-linejoin:round; }
    .tgr-tags-icon svg { width:13px; height:13px; stroke:var(--tgr-muted); fill:none; stroke-width:2; stroke-linecap:round; stroke-linejoin:round; }

    /* Card base */
    .tgr-card { background:var(--tgr-card); border:1px solid var(--tgr-border); border-radius:var(--tgr-radius); padding:20px; transition:all .3s; }
    .tgr-card:hover { box-shadow:0 8px 24px rgba(0,0,0,.06); border-color:color-mix(in srgb,var(--tgr-border) 70%,transparent); }
    .tgr-card-head { display:flex; align-items:flex-start; justify-content:space-between; margin-bottom:12px; }
    .tgr-card-author { display:flex; align-items:center; gap:12px; }
    .tgr-avatar { width:40px; height:40px; border-radius:20px; display:flex; align-items:center; justify-content:center; color:#fff; font-weight:700; font-size:13px; flex-shrink:0; }
    .tgr-avatar-sm { width:32px; height:32px; border-radius:16px; font-size:11px; }
    .tgr-avatar-xs { width:28px; height:28px; border-radius:14px; font-size:10px; }
    .tgr-author-name { font-size:14px; font-weight:700; color:var(--tgr-text); }
    .tgr-author-meta { display:flex; align-items:center; gap:8px; margin-top:2px; }
    .tgr-date { font-size:12px; color:var(--tgr-muted); }
    .tgr-google { display:flex; align-items:center; gap:6px; font-size:11px; font-weight:600; color:var(--tgr-muted); }
    .tgr-google svg { width:16px; height:16px; }

    .tgr-photo { margin-bottom:12px; border-radius:var(--tgr-radius-sm); overflow:hidden; }
    .tgr-photo img { width:100%; height:144px; object-fit:cover; display:block; transition:transform .5s; }
    .tgr-card:hover .tgr-photo img { transform:scale(1.04); }
    .tgr-photo-hero img { height:192px; }

    .tgr-text { font-size:14px; color:var(--tgr-sub); line-height:1.6; }
    .tgr-readmore { font-weight:600; color:var(--tgr-brand); cursor:pointer; background:none; border:none; font-family:inherit; font-size:14px; margin-left:4px; }

    .tgr-card-tags { display:flex; flex-wrap:wrap; gap:6px; margin-top:12px; }
    .tgr-card-tag { font-size:11px; padding:2px 10px; border-radius:12px; background:color-mix(in srgb,var(--tgr-border) 50%,transparent); color:var(--tgr-sub); font-weight:500; }

    .tgr-card-foot { display:flex; align-items:center; justify-content:space-between; margin-top:16px; padding-top:12px; border-top:1px solid color-mix(in srgb,var(--tgr-border) 50%,transparent); }
    .tgr-helpful { display:flex; align-items:center; gap:6px; font-size:12px; color:var(--tgr-muted); background:none; border:none; cursor:pointer; font-family:inherit; transition:color .2s; }
    .tgr-helpful:hover { color:var(--tgr-text); }
    .tgr-helpful svg { width:12px; height:12px; stroke:currentColor; fill:none; stroke-width:2; stroke-linecap:round; stroke-linejoin:round; }
    .tgr-reply-btn { display:flex; align-items:center; gap:4px; font-size:12px; font-weight:600; color:var(--tgr-brand); background:none; border:none; cursor:pointer; font-family:inherit; }
    .tgr-reply-btn svg { width:11px; height:11px; stroke:currentColor; fill:none; stroke-width:2; stroke-linecap:round; stroke-linejoin:round; }
    .tgr-reply { margin-top:12px; padding:12px; border-radius:var(--tgr-radius-sm); background:color-mix(in srgb,var(--tgr-border) 30%,transparent); border:1px solid var(--tgr-border); }
    .tgr-reply-author { font-size:12px; font-weight:700; color:var(--tgr-text); margin-bottom:4px; }
    .tgr-reply-text { font-size:12px; color:var(--tgr-sub); line-height:1.5; }

    /* Grid layout */
    .tgr-grid { display:grid; gap:16px; }
    .tgr-grid[data-cols="2"] { grid-template-columns:repeat(2,1fr); }
    .tgr-grid[data-cols="3"] { grid-template-columns:repeat(3,1fr); }
    @media(max-width:900px) { .tgr-grid[data-cols="3"] { grid-template-columns:repeat(2,1fr); } }
    @media(max-width:600px) { .tgr-grid[data-cols="2"],.tgr-grid[data-cols="3"] { grid-template-columns:1fr; } .tgr-root { padding:32px 16px; } }

    /* Masonry */
    .tgr-masonry { column-count:3; column-gap:16px; }
    .tgr-masonry > * { break-inside:avoid; margin-bottom:16px; }
    @media(max-width:900px) { .tgr-masonry { column-count:2; } }
    @media(max-width:600px) { .tgr-masonry { column-count:1; } }

    /* Masonry variants */
    .tgr-card-quote { background:color-mix(in srgb,var(--tgr-brand) 4%,var(--tgr-card)); }
    .tgr-card-quote .tgr-quote-icon { opacity:.15; margin-bottom:8px; }
    .tgr-card-quote .tgr-quote-icon svg { width:24px; height:24px; stroke:var(--tgr-brand); fill:none; stroke-width:1.5; stroke-linecap:round; stroke-linejoin:round; }
    .tgr-card-quote .tgr-text { font-size:16px; font-weight:500; color:var(--tgr-text); }
    .tgr-card-compact { padding:16px; }
    .tgr-card-compact .tgr-text { font-size:13px; }
    .tgr-card-photohero .tgr-photo-overlay { position:relative; }
    .tgr-card-photohero .tgr-photo-overlay-inner { position:absolute; bottom:0; left:0; right:0; padding:12px 16px; background:linear-gradient(to top,rgba(0,0,0,.5),transparent); display:flex; align-items:center; gap:8px; }
    .tgr-card-photohero .tgr-photo-overlay-inner .tgr-author-name { color:#fff; font-size:12px; }
    .tgr-card-photohero .tgr-photo-overlay img { height:192px; }

    /* Carousel */
    .tgr-carousel-wrap { position:relative; }
    .tgr-carousel { display:flex; gap:16px; overflow-x:auto; scroll-snap-type:x mandatory; scroll-behavior:smooth; -ms-overflow-style:none; scrollbar-width:none; padding-bottom:4px; }
    .tgr-carousel::-webkit-scrollbar { display:none; }
    .tgr-carousel > * { flex-shrink:0; width:320px; scroll-snap-align:start; }
    .tgr-carousel-btn { position:absolute; top:50%; transform:translateY(-50%); width:40px; height:40px; border-radius:20px; background:var(--tgr-card); border:1px solid var(--tgr-border); box-shadow:0 2px 8px rgba(0,0,0,.08); display:flex; align-items:center; justify-content:center; cursor:pointer; opacity:0; transition:all .2s; z-index:5; color:var(--tgr-brand); }
    .tgr-carousel-wrap:hover .tgr-carousel-btn { opacity:1; }
    .tgr-carousel-btn:hover { box-shadow:0 4px 12px rgba(0,0,0,.12); transform:translateY(-50%) scale(1.08); }
    .tgr-carousel-btn svg { width:18px; height:18px; stroke:currentColor; fill:none; stroke-width:2; stroke-linecap:round; stroke-linejoin:round; }
    .tgr-carousel-prev { left:-16px; }
    .tgr-carousel-next { right:-16px; }

    /* Spotlight */
    .tgr-spotlight { text-align:center; max-width:640px; margin:0 auto; padding:24px 0; }
    .tgr-spotlight .tgr-quote-icon { margin:0 auto 16px; opacity:.1; }
    .tgr-spotlight .tgr-quote-icon svg { width:40px; height:40px; stroke:var(--tgr-brand); fill:none; stroke-width:1; stroke-linecap:round; stroke-linejoin:round; }
    .tgr-spotlight .tgr-text { font-size:20px; font-weight:500; color:var(--tgr-text); line-height:1.5; margin-bottom:24px; }
    .tgr-spotlight-author { display:flex; align-items:center; justify-content:center; gap:12px; }
    .tgr-spotlight-dots { display:flex; justify-content:center; gap:8px; margin-top:24px; }
    .tgr-dot { width:8px; height:8px; border-radius:4px; background:var(--tgr-border); border:none; cursor:pointer; padding:0; transition:all .3s; }
    .tgr-dot.active { background:var(--tgr-brand); transform:scale(1.3); }

    /* Badge */
    .tgr-badge-wrap { display:flex; align-items:center; justify-content:center; padding:48px 0; position:relative; }
    .tgr-badge { display:inline-flex; align-items:center; gap:10px; padding:10px 20px; background:var(--tgr-card); border-radius:28px; box-shadow:0 4px 16px rgba(0,0,0,.08); border:1px solid var(--tgr-border); cursor:pointer; transition:all .2s; font-family:inherit; }
    .tgr-badge:hover { box-shadow:0 8px 24px rgba(0,0,0,.12); transform:scale(1.03); }
    .tgr-badge-star { width:28px; height:28px; border-radius:14px; display:flex; align-items:center; justify-content:center; background:color-mix(in srgb,var(--tgr-brand) 12%,transparent); }
    .tgr-badge-star svg { width:14px; height:14px; fill:var(--tgr-star); stroke:var(--tgr-star); }
    .tgr-badge-num { font-size:16px; font-weight:800; color:var(--tgr-text); }
    .tgr-badge-count { font-size:12px; color:var(--tgr-muted); font-weight:500; }
    .tgr-badge-popup { position:absolute; bottom:calc(100% - 24px); right:50%; transform:translateX(50%); width:320px; background:var(--tgr-card); border-radius:var(--tgr-radius); box-shadow:0 16px 48px rgba(0,0,0,.15); border:1px solid var(--tgr-border); padding:20px; display:none; z-index:20; }
    .tgr-badge-popup.open { display:block; }
    .tgr-badge-popup-head { display:flex; justify-content:space-between; margin-bottom:16px; }
    .tgr-badge-popup-close { background:none; border:none; cursor:pointer; color:var(--tgr-muted); padding:4px; }
    .tgr-badge-popup-close svg { width:16px; height:16px; stroke:currentColor; fill:none; stroke-width:2; stroke-linecap:round; stroke-linejoin:round; }
    .tgr-badge-reviews { max-height:200px; overflow-y:auto; margin-bottom:12px; }
    .tgr-badge-review { display:flex; gap:10px; padding:8px 0; border-bottom:1px solid var(--tgr-border); }
    .tgr-badge-review:last-child { border:none; }
    .tgr-badge-review-text { font-size:12px; color:var(--tgr-sub); line-height:1.4; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; }
    .tgr-badge-allbtn { display:flex; align-items:center; justify-content:center; gap:6px; width:100%; padding:10px; border-radius:var(--tgr-radius-sm); font-size:12px; font-weight:600; color:#fff; background:var(--tgr-brand); border:none; cursor:pointer; font-family:inherit; transition:all .2s; }
    .tgr-badge-allbtn:hover { opacity:.9; }
    .tgr-badge-allbtn svg { width:12px; height:12px; stroke:currentColor; fill:none; stroke-width:2; stroke-linecap:round; stroke-linejoin:round; }

    /* Ticker */
    .tgr-ticker-wrap { overflow:hidden; padding:8px 0; }
    .tgr-ticker { display:flex; gap:24px; animation:tgr-scroll 35s linear infinite; width:max-content; }
    @keyframes tgr-scroll { 0%{transform:translateX(0)} 100%{transform:translateX(-50%)} }
    .tgr-ticker-item { display:flex; align-items:center; gap:10px; flex-shrink:0; background:var(--tgr-card); border:1px solid var(--tgr-border); border-radius:24px; padding:6px 20px 6px 6px; }
    .tgr-ticker-item .tgr-text { font-size:12px; white-space:nowrap; font-weight:500; }
    .tgr-ticker-item .tgr-date { margin-left:4px; }

    /* Trust footer */
    .tgr-trust { display:flex; align-items:center; justify-content:center; gap:8px; margin-top:32px; opacity:.4; }
    .tgr-trust svg { width:14px; height:14px; stroke:var(--tgr-muted); fill:none; stroke-width:2; stroke-linecap:round; stroke-linejoin:round; }
    .tgr-trust span { font-size:12px; font-weight:500; color:var(--tgr-muted); }

    @media(prefers-reduced-motion:reduce) {
      .tgr-card:hover,.tgr-ai-card:hover,.tgr-cta:hover,.tgr-badge:hover { transform:none; }
      .tgr-ticker { animation:none; }
    }
  `;

  /* ━━━ HELPERS ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
  function esc(s) { const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }
  const COLORS = ['#3B82F6','#10B981','#8B5CF6','#F59E0B','#EC4899','#0891B2','#6366F1','#14B8A6'];
  function avatarColor(name) { return COLORS[(name || '').charCodeAt(0) % COLORS.length]; }
  function initials(name) { return (name || 'U').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase(); }
  function avatar(name, cls) {
    return `<div class="tgr-avatar ${cls||''}" style="background:${avatarColor(name)}">${initials(name)}</div>`;
  }

  /* ━━━ WIDGET CLASS ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
  class TGReviewsWidget {
    constructor(container, config) {
      this.el = container;
      this.c = this._defaults(config);
      this.shadow = container.attachShadow({ mode: 'open' });
      this.activeTag = null;
      this.spotlightIdx = 0;
      this.badgeOpen = false;
      this._render();
    }

    _defaults(c) {
      return Object.assign({
        place: { name: 'My Business', rating: 4.8, total: 50 },
        header: { title: '', subtitle: '' },
        brandColor: '#0891B2', accentColor: '#6366F1', pageBg: '#F8FAFC', cardBg: '#FFFFFF',
        textColor: '#0F172A', subtextColor: '#64748B', borderRadius: 16,
        layout: 'cards', theme: 'light', fontFamily: '',
        showHeader: true, showAI: true, showTags: true, showPhotos: true,
        showReplies: true, showHelpful: true, showTrust: true, showCTA: true,
        trustText: 'Verified reviews powered by Google',
        ctaText: 'Write a Review', ctaUrl: '#',
        aiHighlights: [
          { label: 'Most praised', value: 'Personal service', color: '#EC4899', icon: 'heart' },
          { label: '98% recommend', value: 'for friends and family', color: '#8B5CF6', icon: 'users' },
          { label: 'Trending up', value: 'Rating improved this year', color: '#10B981', icon: 'trending' },
          { label: 'Top strength', value: 'Great value for money', color: '#F59E0B', icon: 'award' },
        ],
        reviews: [],
      }, c || {});
    }

    _render() {
      const c = this.c;
      const reviews = this._filtered();
      let html = `<style>${STYLES}</style>`;
      html += `<div class="tgr-root" data-theme="${c.theme}" style="--tgr-brand:${c.brandColor};--tgr-accent:${c.accentColor};--tgr-bg:${c.theme==='dark'?'#0F172A':c.pageBg};--tgr-card:${c.theme==='dark'?'#1E293B':c.cardBg};--tgr-text:${c.theme==='dark'?'#F1F5F9':c.textColor};--tgr-sub:${c.theme==='dark'?'#94A3B8':c.subtextColor};--tgr-border:${c.theme==='dark'?'#334155':'#E2E8F0'};--tgr-radius:${c.borderRadius}px;--tgr-radius-sm:${Math.max(c.borderRadius-4,8)}px">`;

      if (c.showHeader) html += this._header();
      if (c.showAI && c.layout !== 'badge' && c.layout !== 'ticker') html += this._ai();
      if (c.showTags && c.layout !== 'badge' && c.layout !== 'ticker' && c.layout !== 'spotlight') html += this._tags();

      switch (c.layout) {
        case 'masonry': html += this._masonry(reviews); break;
        case 'carousel': html += this._carousel(reviews); break;
        case 'spotlight': html += this._spotlight(reviews); break;
        case 'badge': html += this._badge(); break;
        case 'ticker': html += this._ticker(reviews); break;
        default: html += this._grid(reviews);
      }

      if (c.showTrust) html += this._trust();
      html += `</div>`;
      this.shadow.innerHTML = html;

      // Font override — when fontFamily is set, override the host's hardcoded
      // Inter stack. Setting font-family on the root cascades to all descendants
      // and beats the :host rule because root is more specific.
      if (c.fontFamily && typeof c.fontFamily === 'string') {
        const root = this.shadow.querySelector('.tgr-root');
        if (root) {
          root.style.fontFamily = "'" + c.fontFamily.replace(/'/g, '') + "', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
        }
      }

      this._bind();
    }

    _filtered() {
      if (!this.activeTag) return this.c.reviews;
      return this.c.reviews.filter(r => r.tags && r.tags.includes(this.activeTag));
    }

    _allTags() {
      const t = new Set();
      this.c.reviews.forEach(r => (r.tags || []).forEach(tag => t.add(tag)));
      return [...t];
    }

    /* ── Header ── */
    _header() {
      const c = this.c, p = c.place;
      let h = `<div class="tgr-header"><div class="tgr-header-left">`;
      h += `<div class="tgr-rating-box">${icon('star')}</div>`;
      h += `<div><div style="display:flex;align-items:baseline;gap:8px;margin-bottom:4px"><span class="tgr-rating-num">${p.rating}</span>${stars(Math.round(p.rating),18,c.brandColor)}</div>`;
      h += `<p class="tgr-rating-info">Based on <strong>${p.total} reviews</strong> on Google</p></div></div>`;
      if (c.showCTA) {
        h += `<a href="${esc(c.ctaUrl)}" class="tgr-cta" target="_blank" rel="noopener">${icon('msgSq')}${esc(c.ctaText)}${icon('extLink')}</a>`;
      }
      return h + `</div>`;
    }

    /* ── AI Highlights ── */
    _ai() {
      const hl = this.c.aiHighlights;
      if (!hl || !hl.length) return '';
      let h = `<div class="tgr-ai"><div class="tgr-ai-label"><div class="tgr-ai-icon">${icon('sparkles')}</div>AI Insights</div><div class="tgr-ai-grid">`;
      hl.forEach(a => {
        h += `<div class="tgr-ai-card"><div class="tgr-ai-card-icon" style="background:${a.color}15">${icon(a.icon||'heart')}</div><div class="tgr-ai-card-label">${esc(a.label)}</div><div class="tgr-ai-card-value">${esc(a.value)}</div></div>`;
      });
      return h + `</div></div>`;
    }

    /* ── Tags ── */
    _tags() {
      const tags = this._allTags();
      if (!tags.length) return '';
      let h = `<div class="tgr-tags"><span class="tgr-tags-icon">${icon('filter')}</span>`;
      h += `<button class="tgr-tag${this.activeTag?'':' active'}" data-tag="">All</button>`;
      tags.forEach(t => { h += `<button class="tgr-tag${this.activeTag===t?' active':''}" data-tag="${esc(t)}">${esc(t)}</button>`; });
      return h + `</div>`;
    }

    /* ── Standard review card ── */
    _card(r, variant) {
      const c = this.c;
      const cls = variant ? ` tgr-card-${variant}` : '';
      let h = `<div class="tgr-card${cls}" data-id="${r.id||''}">`;

      // Photo hero variant
      if (variant === 'photohero' && r.hasPhoto && r.photoUrl) {
        h += `<div class="tgr-photo-overlay"><div class="tgr-photo tgr-photo-hero"><img src="${esc(r.photoUrl)}" alt="" loading="lazy"></div>`;
        h += `<div class="tgr-photo-overlay-inner">${avatar(r.author,'tgr-avatar-sm')}<div><p class="tgr-author-name">${esc(r.author)}</p>${stars(r.rating,10,'#FBBF24')}</div></div></div>`;
        h += `<div style="padding:4px 0 0"><p class="tgr-text">${esc(r.text).slice(0,150)}${r.text.length>150?'...':''}</p>`;
        h += `<div class="tgr-card-foot"><span class="tgr-date">${esc(r.date)}</span><span class="tgr-google">${icon('google')}Google</span></div></div>`;
        return h + `</div>`;
      }

      // Quote variant
      if (variant === 'quote') {
        h += `<div class="tgr-quote-icon">${icon('quote')}</div>`;
        h += `<p class="tgr-text">"${esc(r.text).slice(0,180)}${r.text.length>180?'...':''}"</p>`;
        h += `<div style="display:flex;align-items:center;gap:10px;margin-top:14px">${avatar(r.author,'tgr-avatar-sm')}<div><p class="tgr-author-name" style="font-size:13px">${esc(r.author)}</p>${stars(r.rating,11,c.brandColor)}</div><span class="tgr-date" style="margin-left:auto">${esc(r.date)}</span></div>`;
        return h + `</div>`;
      }

      // Compact variant
      if (variant === 'compact') {
        h += `<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">${avatar(r.author,'tgr-avatar-sm')}<p class="tgr-author-name" style="font-size:12px;flex:1">${esc(r.author)}</p>${stars(r.rating,10,c.brandColor)}</div>`;
        h += `<p class="tgr-text" style="font-size:13px">${esc(r.text).slice(0,100)}...</p>`;
        if (r.tags) { h += `<div class="tgr-card-tags">${r.tags.slice(0,2).map(t=>`<span class="tgr-card-tag">${esc(t)}</span>`).join('')}</div>`; }
        return h + `</div>`;
      }

      // Standard / withReply
      h += `<div class="tgr-card-head"><div class="tgr-card-author">${avatar(r.author)}<div><p class="tgr-author-name">${esc(r.author)}</p><div class="tgr-author-meta">${stars(r.rating,12,'#F59E0B')}<span class="tgr-date">${esc(r.date)}</span></div></div></div><span class="tgr-google">${icon('google')}Google</span></div>`;

      if (c.showPhotos && r.hasPhoto && r.photoUrl) {
        h += `<div class="tgr-photo"><img src="${esc(r.photoUrl)}" alt="" loading="lazy"></div>`;
      }

      const limit = variant === 'carousel' ? 120 : 200;
      const text = r.text || '';
      h += `<p class="tgr-text">${esc(text.slice(0,limit))}${text.length>limit?`...<button class="tgr-readmore">Read more</button>`:''}</p>`;

      if (r.tags) { h += `<div class="tgr-card-tags">${r.tags.map(t=>`<span class="tgr-card-tag">${esc(t)}</span>`).join('')}</div>`; }

      h += `<div class="tgr-card-foot">`;
      if (c.showHelpful) h += `<button class="tgr-helpful">${icon('thumbsUp')}Helpful (${r.helpful||0})</button>`;
      if (c.showReplies && r.reply) h += `<button class="tgr-reply-btn" data-reply="${r.id||''}">${icon('msgSq')}Owner replied</button>`;
      h += `</div>`;

      // Reply (shown by default for withReply variant)
      if (r.reply && (variant === 'withReply')) {
        h += `<div class="tgr-reply"><p class="tgr-reply-author">${esc(r.reply.author)} replied</p><p class="tgr-reply-text">${esc(r.reply.text)}</p></div>`;
      }

      return h + `</div>`;
    }

    /* ── Grid layout ── */
    _grid(reviews) {
      const cols = Math.min(reviews.length, 3);
      return `<div class="tgr-grid" data-cols="${cols}">${reviews.map(r => this._card(r)).join('')}</div>`;
    }

    /* ── Masonry layout ── */
    _masonry(reviews) {
      const getVariant = (r, i) => {
        if (i === 0 && r.hasPhoto) return 'photohero';
        if (i === 1 || i === 5) return 'quote';
        if (i === 3 || i === 7) return 'compact';
        if (r.reply && (i === 2 || i === 4)) return 'withReply';
        return '';
      };
      return `<div class="tgr-masonry">${reviews.map((r, i) => this._card(r, getVariant(r, i))).join('')}</div>`;
    }

    /* ── Carousel layout ── */
    _carousel(reviews) {
      let h = `<div class="tgr-carousel-wrap"><button class="tgr-carousel-btn tgr-carousel-prev">${icon('chevL')}</button>`;
      h += `<div class="tgr-carousel">${reviews.map(r => this._card(r, 'carousel')).join('')}</div>`;
      h += `<button class="tgr-carousel-btn tgr-carousel-next">${icon('chevR')}</button></div>`;
      return h;
    }

    /* ── Spotlight layout ── */
    _spotlight(reviews) {
      const fives = reviews.filter(r => r.rating === 5);
      if (!fives.length) return '<p>No 5-star reviews to spotlight.</p>';
      const r = fives[this.spotlightIdx % fives.length] || fives[0];
      let h = `<div class="tgr-spotlight"><div class="tgr-quote-icon">${icon('quote')}</div>`;
      h += `<p class="tgr-text">"${esc(r.text)}"</p>`;
      h += `<div class="tgr-spotlight-author">${avatar(r.author)}<div style="text-align:left"><p class="tgr-author-name">${esc(r.author)}</p><div class="tgr-author-meta">${stars(r.rating,13,'#F59E0B')}<span class="tgr-date">${esc(r.date)}</span></div></div></div>`;
      h += `<div class="tgr-spotlight-dots">${fives.map((_,i)=>`<button class="tgr-dot${i===this.spotlightIdx%fives.length?' active':''}" data-dot="${i}"></button>`).join('')}</div>`;
      return h + `</div>`;
    }

    /* ── Badge layout ── */
    _badge() {
      const c = this.c, p = c.place, reviews = c.reviews.slice(0, 3);
      let h = `<div class="tgr-badge-wrap"><div style="position:relative">`;
      h += `<button class="tgr-badge tgr-badge-toggle"><div class="tgr-badge-star">${icon('star')}</div><span class="tgr-badge-num">${p.rating}</span>${stars(5,11,'#F59E0B')}<span class="tgr-badge-count">${p.total} reviews</span><span class="tgr-google">${icon('google')}</span></button>`;
      h += `<div class="tgr-badge-popup${this.badgeOpen?' open':''}">`;
      h += `<div class="tgr-badge-popup-head"><div><p class="tgr-author-name">${esc(p.name)}</p><div style="display:flex;align-items:center;gap:8px;margin-top:4px"><span class="tgr-rating-num" style="font-size:24px">${p.rating}</span><div>${stars(5,13,c.brandColor)}<p style="font-size:11px;color:var(--tgr-muted);margin-top:2px">${p.total} reviews</p></div></div></div><button class="tgr-badge-popup-close tgr-badge-close">${icon('x')}</button></div>`;
      h += `<div class="tgr-badge-reviews">${reviews.map(r=>`<div class="tgr-badge-review">${avatar(r.author,'tgr-avatar-xs')}<div style="flex:1;min-width:0"><div style="display:flex;align-items:center;gap:6px"><p class="tgr-author-name" style="font-size:11px">${esc(r.author)}</p>${stars(r.rating,9,'#F59E0B')}</div><p class="tgr-badge-review-text">${esc(r.text).slice(0,80)}...</p></div></div>`).join('')}</div>`;
      h += `<button class="tgr-badge-allbtn">See all reviews ${icon('arrowUp')}</button>`;
      return h + `</div></div></div>`;
    }

    /* ── Ticker layout ── */
    _ticker(reviews) {
      const items = [...reviews, ...reviews];
      let h = `<div class="tgr-ticker-wrap"><div class="tgr-ticker">`;
      items.forEach(r => {
        h += `<div class="tgr-ticker-item">${avatar(r.author,'tgr-avatar-sm')}${stars(r.rating,10,'#F59E0B')}<span class="tgr-text">"${esc(r.text).slice(0,50)}..."</span><span class="tgr-date">— ${esc(r.author.split(' ')[0])}</span></div>`;
      });
      return h + `</div></div>`;
    }

    /* ── Trust ── */
    _trust() {
      return `<div class="tgr-trust">${icon('shield')}<span>${esc(this.c.trustText)}</span></div>`;
    }

    /* ── Events ── */
    _bind() {
      // Tags
      this.shadow.querySelectorAll('.tgr-tag').forEach(btn => {
        btn.addEventListener('click', () => {
          const tag = btn.dataset.tag;
          this.activeTag = tag || null;
          this._render();
        });
      });

      // Carousel
      const prev = this.shadow.querySelector('.tgr-carousel-prev');
      const next = this.shadow.querySelector('.tgr-carousel-next');
      const track = this.shadow.querySelector('.tgr-carousel');
      if (prev) prev.addEventListener('click', () => track.scrollBy({ left: -340, behavior: 'smooth' }));
      if (next) next.addEventListener('click', () => track.scrollBy({ left: 340, behavior: 'smooth' }));

      // Spotlight dots
      this.shadow.querySelectorAll('.tgr-dot').forEach(dot => {
        dot.addEventListener('click', () => {
          this.spotlightIdx = parseInt(dot.dataset.dot);
          this._render();
        });
      });

      // Spotlight auto-rotate
      if (this.c.layout === 'spotlight') {
        if (this._spotTimer) clearInterval(this._spotTimer);
        const fives = this.c.reviews.filter(r => r.rating === 5);
        this._spotTimer = setInterval(() => {
          this.spotlightIdx = (this.spotlightIdx + 1) % fives.length;
          this._render();
        }, 6000);
      }

      // Badge toggle
      const badgeBtn = this.shadow.querySelector('.tgr-badge-toggle');
      const badgeClose = this.shadow.querySelector('.tgr-badge-close');
      if (badgeBtn) badgeBtn.addEventListener('click', () => { this.badgeOpen = !this.badgeOpen; this._render(); });
      if (badgeClose) badgeClose.addEventListener('click', (e) => { e.stopPropagation(); this.badgeOpen = false; this._render(); });

      // Reply toggles
      this.shadow.querySelectorAll('.tgr-reply-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const card = btn.closest('.tgr-card');
          let reply = card.querySelector('.tgr-reply');
          if (reply) { reply.remove(); return; }
          const id = card.dataset.id;
          const review = this.c.reviews.find(r => String(r.id) === id);
          if (review && review.reply) {
            const div = document.createElement('div');
            div.className = 'tgr-reply';
            div.innerHTML = `<p class="tgr-reply-author">${esc(review.reply.author)} replied</p><p class="tgr-reply-text">${esc(review.reply.text)}</p>`;
            card.appendChild(div);
          }
        });
      });

      // Read more
      this.shadow.querySelectorAll('.tgr-readmore').forEach(btn => {
        btn.addEventListener('click', () => {
          const card = btn.closest('.tgr-card');
          const id = card.dataset.id;
          const review = this.c.reviews.find(r => String(r.id) === id);
          if (review) {
            const p = btn.parentElement;
            p.textContent = review.text;
          }
        });
      });
    }

    update(newConfig) { this.c = this._defaults(newConfig); this.activeTag = null; this.spotlightIdx = 0; this._render(); }
    destroy() { if (this._spotTimer) clearInterval(this._spotTimer); this.shadow.innerHTML = ''; }
  }

  /* ━━━ INITIALIZER ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
  async function init() {
    const containers = document.querySelectorAll('[data-tg-widget="reviews"]');
    for (const el of containers) {
      const inlineConfig = el.dataset.tgConfig;
      if (inlineConfig) {
        try { new TGReviewsWidget(el, JSON.parse(inlineConfig)); } catch (e) { console.error('[TG Reviews] Invalid config:', e); }
        continue;
      }
      const widgetId = el.dataset.tgId;
      if (widgetId) {
        try {
          const resp = await fetch(`${API_BASE}?id=${encodeURIComponent(widgetId)}`);
          if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
          new TGReviewsWidget(el, await resp.json());
        } catch (e) { console.error('[TG Reviews] Failed to load:', e); }
        continue;
      }
      console.warn('[TG Reviews] Container missing data-tg-id or data-tg-config');
    }
  }

  window.TGReviewsWidget = TGReviewsWidget;
  window.__TG_REVIEWS_VERSION__ = VERSION;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
