/**
 * Competitions surface — the one Andy asked for.
 *
 * Three states, all deep-linkable so a club page can be shared or bookmarked:
 *   events-league.html                                       every competition
 *   events-league.html?competition=english-premier-league     the 20 clubs
 *   events-league.html?competition=...&team=arsenal           that club's games
 *
 * The badges are generated monograms, not club crests. Real crests are licensed
 * artwork and the feed carries no images, so each club gets its initials on a
 * colour derived from its key: stable between deploys, distinct on a grid, and
 * honest about being a placeholder for real assets.
 */
(function () {
  'use strict';

  var T = window.TGEvents;
  var main = document.getElementById('main');
  T.mountChrome('events-league.html');

  function render() {
    var competition = T.param('competition');
    var team = T.param('team');
    if (team && competition) return renderTeam(competition, team);
    if (competition) return renderCompetition(competition);
    return renderIndex();
  }

  // ── All competitions, grouped by category ────────────────────────────────

  function renderIndex() {
    document.title = 'Competitions — Events Explorer — Travelgenix';
    T.clear(main);
    main.appendChild(T.el('h1', { text: 'Competitions' }));
    main.appendChild(T.el('p', {
      class: 'ev-lede',
      text: 'Every competition in the supplier feed, with the clubs and fixtures underneath. '
        + 'Pick one to see its teams.',
    }));
    var host = T.el('div', {});
    main.appendChild(host);
    T.showSkeleton(host, 6);

    T.fetchFeed({}).then(function (data) {
      T.clear(host);
      var notice = T.deeplinkNotice(data.meta);
      if (notice) host.appendChild(notice);

      var byCategory = {};
      data.competitions.forEach(function (c) {
        (byCategory[c.category] = byCategory[c.category] || []).push(c);
      });

      // Competitions with a roster first: those are the ones where a grid of
      // club badges is the natural way in.
      var cats = data.categories.filter(function (c) { return byCategory[c.slug]; });
      if (!cats.length) {
        T.showEmpty(host, 'No competitions', 'The snapshot holds no competitions yet.');
        return;
      }

      cats.forEach(function (cat) {
        var list = byCategory[cat.slug].slice().sort(function (a, b) { return b.teams - a.teams || b.events - a.events; });
        var section = T.el('section', { class: 'ev-section' }, [
          T.el('div', { class: 'ev-section-head' }, [
            T.el('h2', { text: cat.label }),
            T.el('span', { class: 'ev-count tnum', text: T.plural(list.length, 'competition') + ' · ' + T.plural(cat.events, 'event') }),
          ]),
        ]);
        var grid = T.el('div', { class: 'ev-grid' });
        list.forEach(function (c) {
          var meta = c.teams
            ? T.plural(c.teams, 'team') + ' · ' + T.plural(c.events, 'event')
            : T.plural(c.events, 'event');
          grid.appendChild(T.entityTile(
            { name: c.label, initials: initialsOf(c.label), hue: hueOf(c.slug) },
            'events-league.html?competition=' + encodeURIComponent(c.slug),
            meta
          ));
        });
        section.appendChild(grid);
        host.appendChild(section);
      });
    }).catch(function (err) {
      T.showError(host, err.message, render);
    });
  }

  // ── One competition: its clubs, then its fixtures ────────────────────────

  function renderCompetition(slug) {
    T.clear(main);
    var host = T.el('div', {});
    main.appendChild(host);
    T.showSkeleton(host, 5);

    T.fetchFeed({ view: 'competition', slug: slug, limit: 100 }).then(function (data) {
      var comp = data.competition;
      document.title = comp.label + ' — Events Explorer — Travelgenix';
      T.clear(host);

      host.appendChild(T.crumbs([
        { label: 'Competitions', href: 'events-league.html' },
        { label: comp.label },
      ]));

      host.appendChild(T.el('div', { class: 'ev-hero' }, [
        T.badge({ name: comp.label, initials: initialsOf(comp.label), hue: hueOf(comp.slug) }, 'lg'),
        T.el('div', { class: 'ev-hero-body' }, [
          T.el('h1', { text: comp.label }),
          T.el('div', { class: 'ev-hero-meta' }, [
            T.el('span', { class: 'ev-chip', text: comp.categoryLabel || 'Event' }),
            T.el('span', { class: 'tnum', text: T.plural(comp.events, 'event') }),
            comp.teams ? T.el('span', { class: 'ev-dot', text: '·' }) : null,
            comp.teams ? T.el('span', { class: 'tnum', text: T.plural(comp.teams, 'team') }) : null,
            T.el('span', { class: 'ev-dot', text: '·' }),
            T.el('span', { class: 'tnum', text: T.formatDate(comp.from) + ' to ' + T.formatDate(comp.to) }),
          ]),
        ]),
      ]));

      var notice = T.deeplinkNotice(data.meta);
      if (notice) host.appendChild(notice);

      if (data.teams && data.teams.length) {
        var section = T.el('section', { class: 'ev-section' }, [
          T.el('div', { class: 'ev-section-head' }, [
            T.el('h2', { text: 'Clubs' }),
            T.el('span', { class: 'ev-count', text: 'Pick a badge for that club’s games' }),
          ]),
        ]);
        var grid = T.el('div', { class: 'ev-grid' });
        data.teams.forEach(function (team) {
          grid.appendChild(T.entityTile(
            team,
            null,
            T.plural(team.home + team.away, 'game') + (team.homeVenueName ? ' · ' + team.homeVenueName : ''),
            function () {
              T.setParams({ team: team.key });
              render();
              window.scrollTo({ top: 0, behavior: 'smooth' });
            }
          ));
        });
        section.appendChild(grid);
        host.appendChild(section);
      }

      var fixtures = T.el('section', { class: 'ev-section' }, [
        T.el('div', { class: 'ev-section-head' }, [
          T.el('h2', { text: data.teams && data.teams.length ? 'All fixtures' : 'All events' }),
          T.el('span', { class: 'ev-count tnum', text: showingText(data) }),
        ]),
      ]);
      fixtures.appendChild(eventList(data.events, { competition: false }));
      if (data.total > data.events.length) {
        fixtures.appendChild(T.el('p', { class: 'ev-pager-info', style: 'text-align:center;margin-top:16px' }, [
          'Showing the first ' + data.events.length + ' of ' + data.total + '. ',
          T.el('a', { href: 'events-browse.html?competition=' + encodeURIComponent(slug), text: 'Browse them all' }),
        ]));
      }
      host.appendChild(fixtures);
    }).catch(function (err) {
      if (err.status === 404) {
        T.clear(host);
        host.appendChild(T.crumbs([{ label: 'Competitions', href: 'events-league.html' }, { label: 'Not found' }]));
        host.appendChild(T.el('h1', { text: 'Competition not found' }));
        T.showEmpty(host, 'No such competition', 'That competition is not in the current snapshot.');
        return;
      }
      T.showError(host, err.message, render);
    });
  }

  // ── One club ─────────────────────────────────────────────────────────────

  function renderTeam(competition, teamKey) {
    T.clear(main);
    var host = T.el('div', {});
    main.appendChild(host);
    T.showSkeleton(host, 5);

    T.fetchFeed({ view: 'team', key: teamKey, limit: 100 }).then(function (data) {
      var team = data.team;
      document.title = team.name + ' — Events Explorer — Travelgenix';
      T.clear(host);

      var comp = (data.competitions || []).filter(function (c) { return c.slug === competition; })[0];

      host.appendChild(T.crumbs([
        { label: 'Competitions', href: 'events-league.html' },
        { label: comp ? comp.label : 'Competition', href: 'events-league.html?competition=' + encodeURIComponent(competition) },
        { label: team.name },
      ]));

      host.appendChild(T.el('div', { class: 'ev-hero' }, [
        T.badge(team, 'lg'),
        T.el('div', { class: 'ev-hero-body' }, [
          T.el('h1', { text: team.name }),
          T.el('div', { class: 'ev-hero-meta' }, [
            T.el('span', { class: 'tnum', text: T.plural(team.events, 'game') }),
            T.el('span', { class: 'ev-dot', text: '·' }),
            T.el('span', { class: 'tnum', text: team.home + ' home, ' + team.away + ' away' }),
            team.homeVenueName ? T.el('span', { class: 'ev-dot', text: '·' }) : null,
            team.homeVenueName ? T.el('a', {
              href: 'events-venue.html?key=' + encodeURIComponent(team.homeVenueKey),
            }, [T.icon('pin'), ' ' + team.homeVenueName]) : null,
          ]),
          // The feed spells some clubs more than one way. Showing what was
          // folded together makes the club list auditable rather than magic.
          team.aliases && team.aliases.length
            ? T.el('div', { class: 'ev-hero-meta', style: 'margin-top:8px' }, [
              T.el('span', { class: 'ev-chip', text: 'Also listed as ' + team.aliases.join(', ') }),
            ])
            : null,
        ]),
        T.el('a', {
          class: 'ev-btn ev-btn-secondary',
          href: 'events-league.html?competition=' + encodeURIComponent(competition),
        }, [T.icon('back'), 'All clubs']),
      ]));

      var notice = T.deeplinkNotice(data.meta);
      if (notice) host.appendChild(notice);

      // A club plays in more than one competition, and the feed proves it:
      // Arsenal appear in the Premier League and in pre-season friendlies.
      if (data.competitions && data.competitions.length > 1) {
        var chips = T.el('div', { class: 'ev-hero-meta', style: 'margin-bottom:24px' }, [
          T.el('span', { class: 'ev-count', text: 'Also in:' }),
        ]);
        data.competitions.forEach(function (c) {
          if (c.slug === competition) return;
          chips.appendChild(T.el('a', {
            class: 'ev-chip',
            href: 'events-league.html?competition=' + encodeURIComponent(c.slug) + '&team=' + encodeURIComponent(team.key),
            text: c.label,
          }));
        });
        host.appendChild(chips);
      }

      var inComp = data.events.filter(function (e) { return e.competition === competition; });
      var elsewhere = data.events.filter(function (e) { return e.competition !== competition; });

      host.appendChild(section(
        comp ? comp.label : 'Fixtures',
        T.plural(inComp.length, 'game'),
        eventList(inComp, { competition: false })
      ));

      if (elsewhere.length) {
        host.appendChild(section('Other competitions', T.plural(elsewhere.length, 'game'), eventList(elsewhere, {})));
      }
    }).catch(function (err) {
      if (err.status === 404) {
        T.clear(host);
        host.appendChild(T.crumbs([{ label: 'Competitions', href: 'events-league.html' }, { label: 'Not found' }]));
        host.appendChild(T.el('h1', { text: 'Club not found' }));
        T.showEmpty(host, 'No such club', 'That club is not in the current snapshot.');
        return;
      }
      T.showError(host, err.message, render);
    });
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  function section(title, count, body) {
    return T.el('section', { class: 'ev-section' }, [
      T.el('div', { class: 'ev-section-head' }, [
        T.el('h2', { text: title }),
        T.el('span', { class: 'ev-count tnum', text: count }),
      ]),
      body,
    ]);
  }

  function eventList(events, links) {
    if (!events.length) {
      var box = T.el('div', {});
      T.showEmpty(box, 'Nothing scheduled', 'The snapshot holds no events here.');
      return box;
    }
    var list = T.el('div', { class: 'ev-list' });
    events.forEach(function (e) { list.appendChild(T.eventCard(e, links)); });
    return list;
  }

  function showingText(data) {
    return data.total > data.events.length
      ? 'Showing ' + data.events.length + ' of ' + data.total
      : T.plural(data.total, 'event');
  }

  // Competitions and categories get the same generated badge treatment as
  // clubs, using the same hash so a slug always draws the same colour.
  function initialsOf(name) {
    var words = String(name || '').split(/[\s.]+/).filter(function (w) {
      return w && !/^(the|of|and|de|cup|league)$/i.test(w);
    });
    if (!words.length) return '??';
    if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
    return (words[0][0] + words[1][0]).toUpperCase();
  }

  function hueOf(key) {
    var h = 0x811c9dc5;
    var s = String(key);
    for (var i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h % 360;
  }

  window.addEventListener('popstate', render);
  render();
}());
