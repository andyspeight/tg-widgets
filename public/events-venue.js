/**
 * Venues surface — what is on at a ground.
 *
 *   events-venue.html                    searchable directory of 958 venues
 *   events-venue.html?key=wembleystadium what is on there
 *
 * The venue page is where the two supplier id spaces become visible. Wembley is
 * 2024 to SportsEvents365 and a GUID to XS2Event, and the whole reason a venue
 * has a page at all is that the normalisation pass keyed both onto one name.
 */
(function () {
  'use strict';

  var T = window.TGEvents;
  var main = document.getElementById('main');
  T.mountChrome('events-venue.html');
  T.mountSidebar({ page: 'events-venue.html' });

  function render() {
    var key = T.param('key');
    return key ? renderVenue(key) : renderDirectory();
  }

  function renderDirectory() {
    document.title = 'Venues — Events Explorer — Travelgenix';
    T.clear(main);
    main.appendChild(T.sidebarToggle());
    main.appendChild(T.el('h1', { text: 'Venues' }));
    main.appendChild(T.el('p', {
      class: 'ev-lede',
      text: 'Every stadium, arena and theatre in the feed, with both suppliers’ inventory pooled '
        + 'under one name. Search, or pick from the busiest.',
    }));

    var input = T.el('input', {
      type: 'search',
      id: 'venue-search',
      placeholder: 'Wembley, Madison Square Garden, Sphere…',
      autocomplete: 'off',
    });
    main.appendChild(T.el('div', { class: 'ev-filters' }, [
      T.el('div', { class: 'ev-field' }, [
        T.el('label', { for: 'venue-search', text: 'Search venues' }),
        input,
      ]),
    ]));

    var host = T.el('div', {});
    main.appendChild(host);

    function load(term) {
      T.showSkeleton(host, 4);
      T.fetchFeed({ view: 'venues', q: term, limit: 120 }).then(function (data) {
        T.clear(host);
        if (!data.items.length) {
          T.showEmpty(host, 'No venues match', 'Try a shorter search, or part of the name.');
          return;
        }
        host.appendChild(T.el('div', { class: 'ev-section-head' }, [
          T.el('h2', { text: term ? 'Matches' : 'Busiest venues' }),
          T.el('span', {
            class: 'ev-count tnum',
            text: data.total > data.items.length
              ? 'Showing ' + data.items.length + ' of ' + data.total
              : T.plural(data.total, 'venue'),
          }),
        ]));
        var grid = T.el('div', { class: 'ev-grid' });
        data.items.forEach(function (v) {
          grid.appendChild(T.entityTile(v, 'events-venue.html?key=' + encodeURIComponent(v.key), T.plural(v.events, 'event')));
        });
        host.appendChild(grid);
      }).catch(function (err) {
        T.showError(host, err.message, function () { load(term); });
      });
    }

    // Debounced at 300ms per the design rules, so typing does not fire a
    // request per keystroke.
    input.addEventListener('input', T.debounce(function () { load(input.value.trim()); }, 300));
    load('');
  }

  function renderVenue(key) {
    T.clear(main);
    var host = T.el('div', {});
    main.appendChild(host);
    T.showSkeleton(host, 5);

    T.fetchFeed({ view: 'venue', key: key, limit: 100 }).then(function (data) {
      var v = data.venue;
      document.title = v.name + ' — Events Explorer — Travelgenix';
      T.clear(host);

      host.appendChild(T.crumbs([
        { label: 'Venues', href: 'events-venue.html' },
        { label: v.name },
      ]));

      var supplierIds = Object.keys(v.ids || {});
      host.appendChild(T.el('div', { class: 'ev-hero' }, [
        T.badge(v, 'lg'),
        T.el('div', { class: 'ev-hero-body' }, [
          T.el('h1', { text: v.name }),
          T.el('div', { class: 'ev-hero-meta' }, [
            T.el('span', { class: 'tnum', text: T.plural(v.events, 'event') }),
            T.el('span', { class: 'ev-dot', text: '·' }),
            T.el('span', { class: 'tnum', text: T.formatDate(v.from) + ' to ' + T.formatDate(v.to) }),
          ]),
          v.aliases && v.aliases.length
            ? T.el('div', { class: 'ev-hero-meta', style: 'margin-top:8px' }, [
              T.el('span', { class: 'ev-chip', text: 'Also listed as ' + v.aliases.join(', ') }),
            ])
            : null,
          // Two suppliers, two id spaces, one ground. This is the join the
          // normalisation pass exists to make, so the page shows its working.
          supplierIds.length > 1
            ? T.el('div', { class: 'ev-hero-meta', style: 'margin-top:8px' },
              supplierIds.map(function (s) {
                return T.el('span', { class: 'ev-chip', text: s + ': ' + v.ids[s].join(', ') });
              }))
            : null,
        ]),
      ]));

      // ── Plan your visit: map, photo and fact sheet ─────────────────────
      // Every line here is sourced: the map and coordinates from the supplier
      // feed, the facts from Wikidata matched by those coordinates, airports
      // from the suite's own list. A missing fact is omitted, never guessed.
      var facts = v.facts || {};
      var geo = v.geo || null;
      if (geo) {
        var visit = T.el('div', { class: 'ev-visit' });

        var mapUrl = 'https://api.maptiler.com/maps/streets-v2/static/'
          + geo.lng + ',' + geo.lat + ',14/640x400@2x.png?key=zSDRMRY6Fi2YzknQVzXf&attribution=bottomleft';
        var media = T.el('div', { class: 'ev-visit-media' }, [
          T.el('div', { class: 'ev-map' }, [
            T.el('img', { src: mapUrl, alt: 'Map of ' + v.name, loading: 'lazy' }),
            T.el('span', { class: 'ev-map-pin', 'aria-hidden': 'true' }),
            T.el('a', {
              class: 'ev-map-open',
              href: 'https://www.google.com/maps/dir/?api=1&destination=' + geo.lat + ',' + geo.lng,
              target: '_blank', rel: 'noopener noreferrer',
              text: 'Directions',
            }),
          ]),
        ]);
        if (facts.img && facts.img.u) {
          media.appendChild(T.el('figure', { class: 'ev-photo' }, [
            T.el('img', { src: facts.img.u, alt: v.name, loading: 'lazy' }),
            T.el('figcaption', {}, [
              T.el('a', { href: facts.img.page, target: '_blank', rel: 'noopener noreferrer',
                text: 'Photo' + (facts.img.by ? ': ' + facts.img.by : '') + (facts.img.lic ? ' (' + facts.img.lic + ')' : '') }),
            ]),
          ]));
        }
        visit.appendChild(media);

        var rows = [];
        var place = [facts.city, facts.country].filter(Boolean).join(', ');
        if (place) rows.push(['Where', place]);
        if (facts.cap) rows.push(['Capacity', facts.cap.toLocaleString('en-GB')]);
        if (facts.opened) rows.push(['Opened', String(facts.opened)]);
        if (facts.tz) rows.push(['Time zone', facts.tz.replace(/_/g, ' ')]);
        if (facts.air && facts.air.length) {
          rows.push(['Nearest airports', facts.air.map(function (a) {
            return a[1] + ' (' + a[0] + ') · ' + a[2] + ' km';
          }).join('\n')]);
        }

        // Home clubs, worked out from the fixtures on this page.
        var clubCount = {};
        (data.events || []).forEach(function (e) {
          if (e.homeTeam && e.venue && e.venue.key === v.key) clubCount[e.homeTeam] = (clubCount[e.homeTeam] || 0) + 1;
        });
        var clubs = Object.keys(clubCount).filter(function (c) { return clubCount[c] >= 3; })
          .sort(function (a, b) { return clubCount[b] - clubCount[a]; }).slice(0, 3);
        if (clubs.length) rows.push(['Home of', clubs.join(', ')]);

        var sheet = T.el('div', { class: 'ev-visit-facts' }, [
          T.el('h2', { text: 'Plan your visit' }),
        ]);
        var dl = T.el('dl', { class: 'ev-facts' });
        rows.forEach(function (r) {
          dl.appendChild(T.el('div', { class: 'ev-fact' }, [
            T.el('dt', { text: r[0] }),
            T.el('dd', { text: r[1] }),
          ]));
        });
        sheet.appendChild(dl);

        var links = T.el('div', { class: 'ev-visit-links' });
        if (facts.web) links.appendChild(T.el('a', { class: 'ev-btn-ghost', href: facts.web, target: '_blank', rel: 'noopener noreferrer', text: 'Official site' }));
        if (facts.wiki) links.appendChild(T.el('a', { class: 'ev-btn-ghost', href: facts.wiki, target: '_blank', rel: 'noopener noreferrer', text: 'Wikipedia' }));
        links.appendChild(T.el('a', { class: 'ev-btn-ghost', href: 'https://www.openstreetmap.org/?mlat=' + geo.lat + '&mlon=' + geo.lng + '#map=16/' + geo.lat + '/' + geo.lng, target: '_blank', rel: 'noopener noreferrer', text: 'OpenStreetMap' }));
        sheet.appendChild(links);
        sheet.appendChild(T.el('p', { class: 'ev-visit-note',
          text: 'Airport distances are straight-line. Facts from Wikidata; map \u00a9 MapTiler \u00a9 OpenStreetMap contributors.' }));

        visit.appendChild(sheet);
        host.appendChild(visit);
      }

      var notice = T.deeplinkNotice(data.meta);
      if (notice) host.appendChild(notice);

      host.appendChild(T.el('div', { class: 'ev-section-head' }, [
        T.el('h2', { text: "What's on" }),
        T.el('span', {
          class: 'ev-count tnum',
          text: data.total > data.events.length ? 'Showing ' + data.events.length + ' of ' + data.total : T.plural(data.total, 'event'),
        }),
      ]));

      if (!data.events.length) {
        T.showEmpty(host, 'Nothing scheduled', 'No events at this venue in the current snapshot.');
        return;
      }
      var list = T.el('div', { class: 'ev-list' });
      data.events.forEach(function (e) { list.appendChild(T.eventCard(e, { venue: false })); });
      host.appendChild(list);

      if (data.total > data.events.length) {
        host.appendChild(T.el('p', { class: 'ev-pager-info', style: 'text-align:center;margin-top:16px' }, [
          T.el('a', { href: 'events-browse.html?venue=' + encodeURIComponent(v.key), text: 'Browse all ' + data.total }),
        ]));
      }
    }).catch(function (err) {
      if (err.status === 404) {
        T.clear(host);
        host.appendChild(T.crumbs([{ label: 'Venues', href: 'events-venue.html' }, { label: 'Not found' }]));
        host.appendChild(T.el('h1', { text: 'Venue not found' }));
        T.showEmpty(host, 'No such venue', 'That venue is not in the current snapshot.');
        return;
      }
      T.showError(host, err.message, render);
    });
  }

  window.addEventListener('popstate', render);
  render();
}());
