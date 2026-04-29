/**
 * Travelgenix Logo Picker
 *
 * Reusable picker component for selecting logos from the Travelgenix Logo Library.
 * Pairs with shared/logo-picker.css.
 *
 * USAGE:
 *
 *   LogoPicker.open({
 *     onSelect: (brand) => {
 *       // brand = {
 *       //   name: "Virgin Atlantic",
 *       //   domain: "virginatlantic.com",
 *       //   category: "Airline",
 *       //   colourPrimary: "#101921",
 *       //   colourSecondary: "#DA0630",
 *       //   preferredUrl: "https://....png",   // SVG if available, else PNG-Transparent
 *       //   assets: [...]                      // all available variants
 *       // }
 *     },
 *     onCancel: () => {},   // optional
 *     tgSuppliersOnly: false // optional, default false (shows all brands)
 *   });
 *
 * The picker stores the brand domain (not the file URL) so logo updates
 * in the library propagate to widgets automatically.
 */

(function (global) {
  'use strict';

  const API_BASE = 'https://tg-logo-library.vercel.app';
  const SEARCH_DEBOUNCE_MS = 200;
  const MIN_SEARCH_LENGTH = 1;

  let modal = null;
  let searchTimer = null;
  let currentOptions = null;
  let lastQuery = '';

  function escapeHtml(s) {
    return String(s || '').replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  function buildModal() {
    if (modal) return modal;

    const el = document.createElement('div');
    el.className = 'lp-backdrop';
    el.innerHTML = `
      <div class="lp-modal" role="dialog" aria-labelledby="lp-title" aria-modal="true">
        <div class="lp-header">
          <div class="lp-header-title">
            <h2 id="lp-title">Choose a logo</h2>
            <p>From the Travelgenix Logo Library</p>
          </div>
          <button class="lp-close" type="button" aria-label="Close picker">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <div class="lp-search-bar">
          <input type="text" class="lp-search-input" placeholder="Search brand name or domain..." autocomplete="off">
          <button class="lp-filter-toggle" type="button" data-filter="tg">
            TG Suppliers only
          </button>
        </div>
        <div class="lp-results">
          <div class="lp-empty">
            <h3>Start typing to search</h3>
            <p>Try a brand name like "Virgin Atlantic" or "British Airways"</p>
          </div>
        </div>
        <div class="lp-footer">
          <span>Logos managed at <a href="${API_BASE}/browse.html" target="_blank" rel="noopener">tg-logo-library.vercel.app</a></span>
          <span class="lp-result-count"></span>
        </div>
      </div>
    `;

    document.body.appendChild(el);
    modal = el;

    const closeBtn = el.querySelector('.lp-close');
    const input = el.querySelector('.lp-search-input');
    const filterBtn = el.querySelector('.lp-filter-toggle');
    const results = el.querySelector('.lp-results');

    closeBtn.addEventListener('click', close);
    el.addEventListener('click', (e) => {
      if (e.target === el) close();
    });
    document.addEventListener('keydown', (e) => {
      if (modal && modal.classList.contains('lp-show') && e.key === 'Escape') close();
    });

    input.addEventListener('input', () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => doSearch(input.value), SEARCH_DEBOUNCE_MS);
    });

    filterBtn.addEventListener('click', () => {
      filterBtn.classList.toggle('lp-active');
      doSearch(input.value);
    });

    results.addEventListener('click', (e) => {
      const card = e.target.closest('.lp-card');
      if (!card) return;
      const idx = parseInt(card.dataset.index, 10);
      if (Number.isNaN(idx) || !modal._lastResults) return;
      const brand = modal._lastResults[idx];
      if (currentOptions && typeof currentOptions.onSelect === 'function') {
        currentOptions.onSelect(brand);
      }
      close();
    });

    return el;
  }

  async function doSearch(query) {
    const trimmed = (query || '').trim();
    lastQuery = trimmed;

    const results = modal.querySelector('.lp-results');
    const filterBtn = modal.querySelector('.lp-filter-toggle');
    const tgOnly = filterBtn.classList.contains('lp-active');

    if (trimmed.length < MIN_SEARCH_LENGTH) {
      results.innerHTML = `
        <div class="lp-empty">
          <h3>Start typing to search</h3>
          <p>Try a brand name like "Virgin Atlantic" or "British Airways"</p>
        </div>
      `;
      modal.querySelector('.lp-result-count').textContent = '';
      return;
    }

    results.innerHTML = `<div class="lp-loading"><div class="lp-spinner"></div></div>`;

    try {
      const url = `${API_BASE}/api/search?q=${encodeURIComponent(trimmed)}&limit=24`;
      const r = await fetch(url);
      if (!r.ok) throw new Error('Search failed');
      const data = await r.json();

      // Bail if user typed something else while we were waiting
      if (lastQuery !== trimmed) return;

      let items = data.results || [];
      if (tgOnly) {
        // Search API doesn't expose TG flag — would need an extra round trip.
        // For now, the TG filter is informational only; we'll wire it up properly
        // once we add the TG flag to the search response.
        // No-op for now.
      }

      modal._lastResults = items;

      if (items.length === 0) {
        results.innerHTML = `
          <div class="lp-empty">
            <h3>No matches</h3>
            <p>Try a different search, or add this brand to the library first.</p>
          </div>
        `;
        modal.querySelector('.lp-result-count').textContent = '';
        return;
      }

      const grid = items.map((b, i) => {
        const initial = (b.name || '?').charAt(0).toUpperCase();
        const img = b.preferredUrl
          ? `<img src="${escapeHtml(b.preferredUrl)}" alt="" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'lp-card-image-empty',textContent:'${escapeHtml(initial)}'}))">`
          : `<span class="lp-card-image-empty">${escapeHtml(initial)}</span>`;
        return `
          <div class="lp-card" data-index="${i}" tabindex="0" role="button" aria-label="Select ${escapeHtml(b.name)}">
            <div class="lp-card-image">${img}</div>
            <div class="lp-card-name">${escapeHtml(b.name)}</div>
            <div class="lp-card-domain">${escapeHtml(b.domain)}</div>
          </div>
        `;
      }).join('');

      results.innerHTML = `<div class="lp-grid">${grid}</div>`;
      modal.querySelector('.lp-result-count').textContent =
        `${items.length} result${items.length === 1 ? '' : 's'}`;

    } catch (err) {
      console.error('[LogoPicker] Search error:', err);
      results.innerHTML = `
        <div class="lp-empty">
          <h3>Couldn't search</h3>
          <p>${escapeHtml(err.message || 'Network error')}</p>
        </div>
      `;
    }
  }

  function open(options) {
    currentOptions = options || {};
    buildModal();

    // Reset state
    const input = modal.querySelector('.lp-search-input');
    const filterBtn = modal.querySelector('.lp-filter-toggle');
    input.value = '';
    if (currentOptions.tgSuppliersOnly) {
      filterBtn.classList.add('lp-active');
    } else {
      filterBtn.classList.remove('lp-active');
    }

    doSearch('');
    modal.classList.add('lp-show');

    // Focus the input after the transition starts
    setTimeout(() => input.focus(), 50);
  }

  function close() {
    if (!modal) return;
    modal.classList.remove('lp-show');
    if (currentOptions && typeof currentOptions.onCancel === 'function') {
      currentOptions.onCancel();
    }
    currentOptions = null;
  }

  global.LogoPicker = { open, close };

})(typeof window !== 'undefined' ? window : this);
