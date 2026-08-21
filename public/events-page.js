/**
 * Events Explorer hub.
 *
 * Four ways into the same 10,087 events, plus the numbers behind them and what
 * the normalisation pass had to decide. The diagnostics are on the page on
 * purpose: the interesting part of this data is what the two suppliers disagree
 * about, and hiding that behind a clean list would misrepresent it.
 */
(function () {
  'use strict';

  var T = window.TGEvents;
  var main = document.getElementById('main');
  T.mountChrome('events.html');

  var SURFACES = [
    {
      href: 'events-league.html',
      icon: 'trophy',
      title: 'Competitions',
      body: 'Every league, its clubs as badges, and each club’s fixtures. Start at the Premier League.',
      cta: 'Browse competitions',
    },
    {
      href: 'events-venue.html',
      icon: 'pin',
      title: 'Venues',
      body: 'What is on at a ground, with both suppliers’ inventory pooled under one name.',
      cta: 'Browse venues',
    },
    {
      href: 'events-artist.html',
      icon: 'music',
      title: 'Artists',
      body: 'Tour dates per act, grouped by month, from Olivia Rodrigo down to a single night.',
      cta: 'Browse artists',
    },
    {
      href: 'events-browse.html',
      icon: 'calendar',
      title: "What's on",
      body: 'The whole feed with filters on date, category, competition and free text.',
      cta: 'Start browsing',
    },
  ];

  function render() {
    T.clear(main);
    main.appendChild(T.el('h1', { text: 'Events Explorer' }));
    main.appendChild(T.el('p', {
      class: 'ev-lede',
      text: 'Four ways into the supplier ticket feed, all reading one normalised snapshot through '
        + '/api/events-feed. Every event carries a Travelify booking deeplink.',
    }));

    var host = T.el('div', {});
    main.appendChild(host);
    T.showSkeleton(host, 3);

    T.fetchFeed({}).then(function (data) {
      T.clear(host);

      var c = data.meta.counts;
      host.appendChild(T.el('div', { class: 'ev-stats' }, [
        stat(c.events, 'events'),
        stat(c.competitions, 'competitions'),
        stat(c.teams, 'teams'),
        stat(c.performers, 'artists'),
        stat(c.venues, 'venues'),
      ]));

      var notice = T.deeplinkNotice(data.meta);
      if (notice) host.appendChild(notice);

      // Surfaces
      var grid = T.el('div', { class: 'ev-grid', style: 'grid-template-columns:repeat(auto-fit,minmax(280px,1fr))' });
      SURFACES.forEach(function (s) {
        grid.appendChild(T.el('a', {
          class: 'ev-tile',
          href: s.href,
          style: 'flex-direction:column;align-items:flex-start;gap:12px;min-height:0;padding:24px',
        }, [
          T.el('span', { class: 'ev-mark' }, [T.icon(s.icon)]),
          T.el('div', { class: 'ev-tile-body' }, [
            T.el('div', { class: 'ev-tile-name', style: 'font-size:18px', text: s.title }),
            T.el('div', { class: 'ev-tile-meta', style: 'line-height:1.5', text: s.body }),
          ]),
          T.el('span', { class: 'ev-chip', text: s.cta }),
        ]));
      });
      host.appendChild(T.el('section', { class: 'ev-section' }, [
        T.el('h2', { text: 'Surfaces' }),
        grid,
      ]));

      // A shortcut straight into the biggest rosters, which is where the
      // competition surface is most convincing.
      var withTeams = data.competitions.filter(function (x) { return x.teams >= 10; }).slice(0, 12);
      if (withTeams.length) {
        var quick = T.el('div', { class: 'ev-hero-meta' }, []);
        withTeams.forEach(function (x) {
          quick.appendChild(T.el('a', {
            class: 'ev-chip',
            href: 'events-league.html?competition=' + encodeURIComponent(x.slug),
            text: x.label + ' (' + x.teams + ')',
          }));
        });
        host.appendChild(T.el('section', { class: 'ev-section' }, [
          T.el('div', { class: 'ev-section-head' }, [
            T.el('h2', { text: 'Straight to a league' }),
            T.el('span', { class: 'ev-count', text: 'Competitions with a full roster' }),
          ]),
          quick,
        ]));
      }

      renderDiagnostics(host, data.meta);
    }).catch(function (err) {
      T.showError(host, err.message, render);
    });
  }

  function stat(value, label) {
    return T.el('div', { class: 'ev-stat' }, [
      T.el('div', { class: 'ev-stat-value tnum', text: Number(value).toLocaleString('en-GB') }),
      T.el('div', { class: 'ev-stat-label', text: label }),
    ]);
  }

  function renderDiagnostics(host, meta) {
    var section = T.el('section', { class: 'ev-section' }, [
      T.el('div', { class: 'ev-section-head' }, [
        T.el('h2', { text: 'What the feed disagrees about' }),
        T.el('span', { class: 'ev-count', text: 'Snapshot built ' + T.formatDate(meta.generatedAt) }),
      ]),
    ]);
    var body = T.el('div', {});
    section.appendChild(body);
    host.appendChild(section);
    T.showSkeleton(body, 2);

    T.fetchFeed({ view: 'diagnostics' }).then(function (data) {
      var r = data.report;
      T.clear(body);

      body.appendChild(T.el('div', { class: 'ev-stats' }, [
        stat(r.rowsIn, 'rows in'),
        stat(r.mergedAway, 'duplicates merged'),
        stat(r.crossSupplierMerges, 'sold by both'),
        stat(r.nameTruncated, 'names cut by the feed'),
        stat(r.placeholderTeams, 'sides still TBC'),
      ]));

      if (r.timeOffsets && r.timeOffsets.length) {
        body.appendChild(T.el('div', { class: 'ev-notice' }, [
          T.icon('alert'),
          T.el('div', {}, [
            T.el('strong', { text: 'The two suppliers do not share a timezone' }),
            T.el('p', {
              text: 'The gaps land on the hour, not at random: '
                + r.timeOffsets.slice(0, 3).map(function (o) {
                  var top = Object.keys(o.competitions)[0];
                  return (o.offsetMinutes > 0 ? '+' : '') + o.offsetMinutes + ' min on ' + o.count + ' events (' + top + ')';
                }).join(', ')
                + '. Neither feed is known to be venue-local, so nothing is converted. Where they '
                + 'disagree, a card is marked "Time disputed" and shows both. Resolving it needs a '
                + 'venue-to-timezone table the feed does not carry.',
            }),
          ]),
        ]));
      }

      if (r.venueAliasCandidates && r.venueAliasCandidates.length) {
        body.appendChild(reviewList(
          'Venue names to confirm',
          'The same fixture listed at two venue names. Most are one ground under two names, a few are feed errors, so none are applied automatically.',
          r.venueAliasCandidates.slice(0, 8).map(function (v) {
            return v.names[0] + '  =  ' + v.names[1] + '  (' + v.support + ')';
          })
        ));
      }

      if (r.teamAliasCandidates && r.teamAliasCandidates.length) {
        body.appendChild(reviewList(
          'Club names to confirm',
          'Clubs in one competition whose keys sit in a prefix relationship. Some are aliases, some are real rivals — Dundee FC and Dundee United are two clubs — so a person decides.',
          r.teamAliasCandidates.slice(0, 8).map(function (t) { return t.shorter + '  vs  ' + t.longer; })
        ));
      }
    }).catch(function (err) {
      T.showError(body, err.message, function () { renderDiagnostics(host, meta); });
    });
  }

  function reviewList(title, blurb, rows) {
    var wrap = T.el('div', { style: 'margin-top:24px' }, [
      T.el('h3', { text: title }),
      T.el('p', { class: 'ev-tile-meta', style: 'max-width:68ch;margin:0 0 12px', text: blurb }),
    ]);
    var list = T.el('div', { class: 'ev-list' });
    rows.forEach(function (text) {
      list.appendChild(T.el('div', {
        class: 'ev-card',
        style: 'grid-template-columns:1fr;padding:12px 16px',
      }, [T.el('div', { class: 'ev-card-meta', text: text })]));
    });
    wrap.appendChild(list);
    return wrap;
  }

  render();
}());
