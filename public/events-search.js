/**
 * Search results — one box over everything.
 *
 *   events-search.html?q=wembley   the ground, its football AND its concerts
 *   events-search.html?q=arsenal   the club, and its games home and away
 *
 * Results come back grouped rather than interleaved, because the useful answer
 * to "Wembley" is usually the venue page, and the useful answer to "Madrid" is
 * "which Madrid did you mean" — two clubs and three grounds. Matching entities
 * go first as cards, then every event that mentions the term.
 */
(function () {
  'use strict';

  var T = window.TGEvents;
  var main = document.getElementById('main');
  var PAGE = 50;

  T.mountChrome('events-search.html');
  T.mountSidebar({ page: 'events-search.html' });

  function render() {
    var q = T.param('q');
    var offset = parseInt(T.param('offset'), 10) || 0;
    document.title = q ? '“' + q + '” — Events Explorer' : 'Search — Events Explorer — Travelgenix';

    T.clear(main);
    main.appendChild(T.sidebarToggle());
    main.appendChild(T.el('h1', { text: 'Search' }));

    // A second box on the page itself, so the results page works when it is
    // opened cold from a link rather than through the sidebar.
    var form = T.el('div', { class: 'ev-search', style: 'border:1px solid var(--tg-border);border-radius:12px;background:var(--tg-bg-primary);margin-bottom:24px' });
    main.appendChild(form);
    T.mountSearch(form, q);

    var host = T.el('div', { 'aria-live': 'polite' });
    main.appendChild(host);

    if (!q) {
      T.showEmpty(host, 'Search everything',
        'Type a club, a ground, an act, a league or a city. "Wembley" finds the football and the '
        + 'concerts, "Arsenal" finds every game home and away.');
      return;
    }

    T.showSkeleton(host, 5);

    T.fetchFeed({ view: 'search', q: q, limit: PAGE, offset: offset }).then(function (data) {
      T.clear(host);

      var entityCount = data.competitionsTotal + data.teamsTotal + data.venuesTotal + data.performersTotal;
      if (!entityCount && !data.total) {
        T.showEmpty(host, 'Nothing matches “' + q + '”',
          'Try a shorter term, part of a name, or a city.');
        return;
      }

      // Name what matched rather than totalling it. "2 clubs and 3 venues" is
      // the answer to "which Madrid did you mean"; "5 pages" is not.
      var parts = [T.plural(data.total, 'event')];
      if (data.competitionsTotal) parts.push(T.plural(data.competitionsTotal, 'competition'));
      if (data.teamsTotal) parts.push(T.plural(data.teamsTotal, 'club'));
      if (data.venuesTotal) parts.push(T.plural(data.venuesTotal, 'venue'));
      if (data.performersTotal) parts.push(T.plural(data.performersTotal, 'artist'));
      host.appendChild(T.el('p', {
        class: 'ev-lede',
        text: parts.join(' · ') + ' matching “' + q + '”',
      }));

      var notice = T.deeplinkNotice(data.meta);
      if (notice) host.appendChild(notice);

      group(host, 'Competitions', data.competitions, data.competitionsTotal, function (c) {
        return {
          entity: { name: c.label + (c.country ? ' - ' + c.country : ''), initials: T.initialsOf(c.label), hue: T.hashHue(c.slug) },
          href: 'events-league.html?competition=' + encodeURIComponent(c.slug),
          meta: T.plural(c.events, 'event') + (c.teams ? ' · ' + T.plural(c.teams, 'team') : ''),
        };
      });

      group(host, 'Clubs', data.teams, data.teamsTotal, function (t) {
        var href = t.competitions && t.competitions.length
          ? 'events-league.html?competition=' + encodeURIComponent(t.competitions[0]) + '&team=' + encodeURIComponent(t.key)
          : null;
        return {
          entity: t,
          href: href,
          meta: T.plural(t.events, 'game') + ' · ' + t.home + ' home, ' + t.away + ' away',
        };
      });

      group(host, 'Venues', data.venues, data.venuesTotal, function (v) {
        return {
          entity: v,
          href: 'events-venue.html?key=' + encodeURIComponent(v.key),
          meta: T.plural(v.events, 'event'),
        };
      });

      group(host, 'Artists', data.performers, data.performersTotal, function (p) {
        return {
          entity: p,
          href: 'events-artist.html?key=' + encodeURIComponent(p.key),
          meta: T.plural(p.events, 'date') + (p.topLocation ? ' · ' + p.topLocation : ''),
        };
      });

      if (!data.total) return;

      var first = data.offset + 1;
      var last = Math.min(data.offset + data.events.length, data.total);
      host.appendChild(T.el('div', { class: 'ev-section-head' }, [
        T.el('h2', { text: 'Events' }),
        T.el('span', { class: 'ev-count tnum', text: 'Showing ' + first + '–' + last + ' of ' + data.total }),
      ]));

      var list = T.el('div', { class: 'ev-list' });
      data.events.forEach(function (e) { list.appendChild(T.eventCard(e, {})); });
      host.appendChild(list);

      if (data.total > PAGE) {
        host.appendChild(T.el('div', { class: 'ev-pager' }, [
          T.el('button', {
            class: 'ev-btn ev-btn-secondary', type: 'button',
            'aria-disabled': offset === 0 ? 'true' : null,
            onclick: function () { go(Math.max(0, offset - PAGE)); },
            text: 'Previous',
          }),
          T.el('span', { class: 'ev-pager-info tnum', text: first + '–' + last + ' of ' + data.total }),
          T.el('button', {
            class: 'ev-btn ev-btn-secondary', type: 'button',
            'aria-disabled': offset + PAGE >= data.total ? 'true' : null,
            onclick: function () { go(offset + PAGE); },
            text: 'Next',
          }),
        ]));
      }
    }).catch(function (err) {
      T.showError(host, err.message, render);
    });
  }

  /** One group of entity hits, or nothing at all when there are none. */
  function group(host, title, items, total, mapper) {
    if (!items || !items.length) return;
    host.appendChild(T.el('div', { class: 'ev-section-head' }, [
      T.el('h2', { text: title }),
      T.el('span', {
        class: 'ev-count tnum',
        text: total > items.length ? 'Top ' + items.length + ' of ' + total : String(total),
      }),
    ]));
    var grid = T.el('div', { class: 'ev-result-grid' });
    items.forEach(function (x) {
      var m = mapper(x);
      // A club with no competition has nowhere sensible to link, so it stays a
      // plain tile rather than a link that goes to the wrong page.
      grid.appendChild(m.href
        ? T.entityTile(m.entity, m.href, m.meta)
        : T.el('div', { class: 'ev-tile', style: 'cursor:default' }, [
          T.badge(m.entity),
          T.el('div', { class: 'ev-tile-body' }, [
            T.el('div', { class: 'ev-tile-name', text: m.entity.name }),
            T.el('div', { class: 'ev-tile-meta', text: m.meta }),
          ]),
        ]));
    });
    host.appendChild(grid);
  }

  function go(offset) {
    T.setParams({ offset: offset ? String(offset) : '' });
    render();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  window.addEventListener('popstate', render);
  render();
}());
