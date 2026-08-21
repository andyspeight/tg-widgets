/**
 * Artists surface — a tour-date list per act.
 *
 *   events-artist.html                      all 98 acts in the feed
 *   events-artist.html?key=olivia-rodrigo   her 88 dates
 *
 * Concert rows arrive as "Performer-City, Country", which the normalisation
 * pass splits so an act becomes an entity rather than a string. That split is
 * what makes this page possible, and it is also why Jay-Z keeps his hyphen: the
 * parser takes the last hyphen whose right-hand side looks like a location.
 */
(function () {
  'use strict';

  var T = window.TGEvents;
  var main = document.getElementById('main');
  T.mountChrome('events-artist.html');

  function render() {
    var key = T.param('key');
    return key ? renderArtist(key) : renderDirectory();
  }

  function renderDirectory() {
    document.title = 'Artists — Events Explorer — Travelgenix';
    T.clear(main);
    main.appendChild(T.el('h1', { text: 'Artists' }));
    main.appendChild(T.el('p', {
      class: 'ev-lede',
      text: 'Every act with dates in the feed, ordered by how many. Pick one for the tour list.',
    }));

    var input = T.el('input', {
      type: 'search',
      id: 'artist-search',
      placeholder: 'Olivia Rodrigo, Metallica, Sting…',
      autocomplete: 'off',
    });
    main.appendChild(T.el('div', { class: 'ev-filters' }, [
      T.el('div', { class: 'ev-field' }, [
        T.el('label', { for: 'artist-search', text: 'Search artists' }),
        input,
      ]),
    ]));

    var host = T.el('div', {});
    main.appendChild(host);

    function load(term) {
      T.showSkeleton(host, 4);
      T.fetchFeed({ view: 'performers', q: term, limit: 200 }).then(function (data) {
        T.clear(host);
        if (!data.items.length) {
          T.showEmpty(host, 'No artists match', 'Try part of the name.');
          return;
        }
        host.appendChild(T.el('div', { class: 'ev-section-head' }, [
          T.el('h2', { text: term ? 'Matches' : 'Most dates' }),
          T.el('span', { class: 'ev-count tnum', text: T.plural(data.total, 'artist') }),
        ]));
        var grid = T.el('div', { class: 'ev-grid' });
        data.items.forEach(function (p) {
          var meta = T.plural(p.events, 'date') + ' · ' + T.plural(p.cities, 'city', 'cities');
          grid.appendChild(T.entityTile(p, 'events-artist.html?key=' + encodeURIComponent(p.key), meta));
        });
        host.appendChild(grid);
      }).catch(function (err) {
        T.showError(host, err.message, function () { load(term); });
      });
    }

    input.addEventListener('input', T.debounce(function () { load(input.value.trim()); }, 300));
    load('');
  }

  function renderArtist(key) {
    T.clear(main);
    var host = T.el('div', {});
    main.appendChild(host);
    T.showSkeleton(host, 6);

    T.fetchFeed({ view: 'performer', key: key, limit: 100 }).then(function (data) {
      var p = data.performer;
      document.title = p.name + ' — Events Explorer — Travelgenix';
      T.clear(host);

      host.appendChild(T.crumbs([
        { label: 'Artists', href: 'events-artist.html' },
        { label: p.name },
      ]));

      host.appendChild(T.el('div', { class: 'ev-hero' }, [
        T.badge(p, 'lg'),
        T.el('div', { class: 'ev-hero-body' }, [
          T.el('h1', { text: p.name }),
          T.el('div', { class: 'ev-hero-meta' }, [
            T.el('span', { class: 'tnum', text: T.plural(p.events, 'date') }),
            T.el('span', { class: 'ev-dot', text: '·' }),
            T.el('span', { class: 'tnum', text: T.plural(p.cities, 'city', 'cities') }),
            T.el('span', { class: 'ev-dot', text: '·' }),
            T.el('span', { class: 'tnum', text: T.plural(p.venues, 'venue') }),
            T.el('span', { class: 'ev-dot', text: '·' }),
            T.el('span', { class: 'tnum', text: T.formatDate(p.from) + ' to ' + T.formatDate(p.to) }),
          ]),
          p.aliases && p.aliases.length
            ? T.el('div', { class: 'ev-hero-meta', style: 'margin-top:8px' }, [
              T.el('span', { class: 'ev-chip', text: 'Also listed as ' + p.aliases.join(', ') }),
            ])
            : null,
        ]),
      ]));

      var notice = T.deeplinkNotice(data.meta);
      if (notice) host.appendChild(notice);

      if (!data.events.length) {
        T.showEmpty(host, 'No dates', 'No dates for this act in the current snapshot.');
        return;
      }

      // Grouped by month, which is how a tour actually reads.
      var groups = [];
      var seen = {};
      data.events.forEach(function (e) {
        var parts = T.dateParts(e.startDate);
        var label = parts ? monthName(parts.m) + ' ' + parts.y : 'Date to be confirmed';
        if (!seen[label]) { seen[label] = { label: label, rows: [] }; groups.push(seen[label]); }
        seen[label].rows.push(e);
      });

      host.appendChild(T.el('div', { class: 'ev-section-head' }, [
        T.el('h2', { text: 'Tour dates' }),
        T.el('span', {
          class: 'ev-count tnum',
          text: data.total > data.events.length ? 'Showing ' + data.events.length + ' of ' + data.total : T.plural(data.total, 'date'),
        }),
      ]));

      groups.forEach(function (g) {
        var section = T.el('section', { class: 'ev-section' }, [
          T.el('h3', { text: g.label }),
        ]);
        var list = T.el('div', { class: 'ev-list' });
        g.rows.forEach(function (e) { list.appendChild(T.eventCard(e, { competition: false })); });
        section.appendChild(list);
        host.appendChild(section);
      });
    }).catch(function (err) {
      if (err.status === 404) {
        T.clear(host);
        host.appendChild(T.crumbs([{ label: 'Artists', href: 'events-artist.html' }, { label: 'Not found' }]));
        host.appendChild(T.el('h1', { text: 'Artist not found' }));
        T.showEmpty(host, 'No such artist', 'That act is not in the current snapshot.');
        return;
      }
      T.showError(host, err.message, render);
    });
  }

  function monthName(m) {
    return ['January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'][m - 1] || '';
  }

  window.addEventListener('popstate', render);
  render();
}());
