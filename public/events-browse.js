/**
 * What's on — the widest net over the feed.
 *
 * Filters on date range, category, competition, venue and free text, paged 50
 * at a time. Every filter is in the URL, so a filtered view is a link someone
 * can send: events-browse.html?category=football&from=2026-09-01
 *
 * The search matches the CANONICAL names, not the raw feed strings, because the
 * feed writes the same club both ways. Typing "Arsenal" finds the rows the feed
 * wrote as "Arsenal FC" too.
 */
(function () {
  'use strict';

  var T = window.TGEvents;
  var main = document.getElementById('main');
  T.mountChrome('events-browse.html');
  T.mountSidebar({ page: 'events-browse.html' });

  var PAGE = 50;
  var indexData = null;
  var resultsHost = null;

  function currentFilters() {
    return {
      from: T.param('from'),
      to: T.param('to'),
      category: T.param('category'),
      competition: T.param('competition'),
      venue: T.param('venue'),
      q: T.param('q'),
      offset: parseInt(T.param('offset'), 10) || 0,
    };
  }

  function shell() {
    document.title = "What's on — Events Explorer — Travelgenix";
    T.clear(main);
    main.appendChild(T.sidebarToggle());
    main.appendChild(T.el('h1', { text: "What's on" }));
    main.appendChild(T.el('p', {
      class: 'ev-lede',
      text: 'Everything in the feed, filtered any way round. Every filter lands in the address bar, '
        + 'so a view you like is a link you can send.',
    }));

    var f = currentFilters();

    var qInput = T.el('input', { type: 'search', id: 'f-q', value: f.q, placeholder: 'Team, artist, venue…', autocomplete: 'off' });
    var fromInput = T.el('input', { type: 'date', id: 'f-from', value: f.from });
    var toInput = T.el('input', { type: 'date', id: 'f-to', value: f.to });
    var catSelect = T.el('select', { id: 'f-cat' }, [T.el('option', { value: '', text: 'All categories' })]);
    var compSelect = T.el('select', { id: 'f-comp' }, [T.el('option', { value: '', text: 'All competitions' })]);

    main.appendChild(T.el('div', { class: 'ev-filters' }, [
      T.el('div', { class: 'ev-field' }, [T.el('label', { for: 'f-q', text: 'Search' }), qInput]),
      T.el('div', { class: 'ev-field' }, [T.el('label', { for: 'f-cat', text: 'Category' }), catSelect]),
      T.el('div', { class: 'ev-field' }, [T.el('label', { for: 'f-comp', text: 'Competition' }), compSelect]),
      T.el('div', { class: 'ev-field' }, [T.el('label', { for: 'f-from', text: 'From' }), fromInput]),
      T.el('div', { class: 'ev-field' }, [T.el('label', { for: 'f-to', text: 'To' }), toInput]),
    ]));

    resultsHost = T.el('div', { id: 'results', 'aria-live': 'polite' });
    main.appendChild(resultsHost);

    function apply(reset) {
      T.setParams({
        q: qInput.value.trim(),
        category: catSelect.value,
        competition: compSelect.value,
        from: fromInput.value,
        to: toInput.value,
        offset: reset ? '' : String(currentFilters().offset),
      });
      load();
    }

    qInput.addEventListener('input', T.debounce(function () { apply(true); }, 300));
    [catSelect, compSelect, fromInput, toInput].forEach(function (node) {
      node.addEventListener('change', function () { apply(true); });
    });

    // The category list narrows the competition list, so the two selects stay
    // consistent rather than offering a combination with no results.
    catSelect.addEventListener('change', function () { fillCompetitions(compSelect, catSelect.value, ''); });

    T.index().then(function (data) {
      indexData = data;
      data.categories.forEach(function (c) {
        catSelect.appendChild(T.el('option', { value: c.slug, text: c.label + ' (' + c.events + ')' }));
      });
      catSelect.value = f.category || '';
      fillCompetitions(compSelect, catSelect.value, f.competition);
      load();
    }).catch(function (err) {
      T.showError(resultsHost, err.message, shell);
    });
  }

  function fillCompetitions(select, category, selected) {
    T.clear(select);
    select.appendChild(T.el('option', { value: '', text: 'All competitions' }));
    if (!indexData) return;
    indexData.competitions
      .filter(function (c) { return !category || c.category === category; })
      .forEach(function (c) {
        select.appendChild(T.el('option', { value: c.slug, text: c.label + ' (' + c.events + ')' }));
      });
    select.value = selected || '';
  }

  function load() {
    var f = currentFilters();
    T.showSkeleton(resultsHost, 6);

    T.fetchFeed({
      view: 'browse',
      from: f.from,
      to: f.to,
      category: f.category,
      competition: f.competition,
      venue: f.venue,
      q: f.q,
      limit: PAGE,
      offset: f.offset,
    }).then(function (data) {
      T.clear(resultsHost);

      var notice = T.deeplinkNotice(data.meta);
      if (notice) resultsHost.appendChild(notice);

      if (f.venue) {
        resultsHost.appendChild(T.el('div', { class: 'ev-hero-meta', style: 'margin-bottom:16px' }, [
          T.el('span', { class: 'ev-chip', text: 'Filtered to one venue' }),
          T.el('a', { href: 'events-browse.html', text: 'Clear' }),
        ]));
      }

      if (!data.total) {
        T.showEmpty(resultsHost, 'Nothing matches',
          'No events fit those filters. Widen the dates, or clear the search box.');
        return;
      }

      var first = data.offset + 1;
      var last = Math.min(data.offset + data.events.length, data.total);
      resultsHost.appendChild(T.el('div', { class: 'ev-section-head' }, [
        T.el('h2', { text: 'Results' }),
        T.el('span', { class: 'ev-count tnum', text: 'Showing ' + first + '–' + last + ' of ' + data.total }),
      ]));

      var list = T.el('div', { class: 'ev-list' });
      data.events.forEach(function (e) { list.appendChild(T.eventCard(e, {})); });
      resultsHost.appendChild(list);

      if (data.total > PAGE) {
        var prev = Math.max(0, data.offset - PAGE);
        var next = data.offset + PAGE;
        resultsHost.appendChild(T.el('div', { class: 'ev-pager' }, [
          T.el('button', {
            class: 'ev-btn ev-btn-secondary',
            type: 'button',
            'aria-disabled': data.offset === 0 ? 'true' : null,
            onclick: function () { go(prev); },
            text: 'Previous',
          }),
          T.el('span', { class: 'ev-pager-info tnum', text: first + '–' + last + ' of ' + data.total }),
          T.el('button', {
            class: 'ev-btn ev-btn-secondary',
            type: 'button',
            'aria-disabled': next >= data.total ? 'true' : null,
            onclick: function () { go(next); },
            text: 'Next',
          }),
        ]));
      }
    }).catch(function (err) {
      T.showError(resultsHost, err.message, load);
    });
  }

  function go(offset) {
    T.setParams({ offset: offset ? String(offset) : '' });
    load();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  window.addEventListener('popstate', function () { if (resultsHost) load(); });
  shell();
}());
