/**
 * Events Explorer — shared client for the supplier event prototype surfaces.
 *
 * One API (/api/events-feed), one set of renderers, four pages on top:
 * events-league.html, events-venue.html, events-artist.html,
 * events-browse.html, plus the events.html hub.
 *
 * Rules it holds to, all from CLAUDE.md:
 *   - Nothing off the network reaches innerHTML. Every value is written with
 *     textContent or through el(), which sets properties, never markup.
 *   - No inline handlers and no injected script, so the pages stay CSP-clean.
 *   - Every list has a loading, empty and error state. A fetch that fails says
 *     what failed and offers a retry, rather than leaving a blank panel.
 */
(function (global) {
  'use strict';

  var API = '/api/events-feed';

  // ── DOM helpers ──────────────────────────────────────────────────────────

  /**
   * Build an element. Children are strings (set as text) or nodes. Attributes
   * are set with setAttribute, so nothing here can introduce markup.
   */
  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v === null || v === undefined || v === false) return;
        if (k === 'class') node.className = v;
        else if (k === 'text') node.textContent = v;
        else if (k === 'style') node.setAttribute('style', v);
        else if (k.indexOf('on') === 0 && typeof v === 'function') node.addEventListener(k.slice(2), v);
        else node.setAttribute(k, v === true ? '' : String(v));
      });
    }
    (children || []).forEach(function (c) {
      if (c === null || c === undefined || c === false) return;
      node.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
    });
    return node;
  }

  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

  /**
   * Lucide-style icons, inlined. Paths only, so no external requests and no
   * emoji standing in for an icon.
   */
  var ICON_PATHS = {
    ticket: 'M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z M13 5v14',
    trophy: 'M6 9H4.5a2.5 2.5 0 0 1 0-5H6 M18 9h1.5a2.5 2.5 0 0 0 0-5H18 M4 22h16 M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22 M14 14.66V17c0 .55.47.98.97 1.21 1.18.54 2.03 2.03 2.03 3.79 M18 2H6v7a6 6 0 0 0 12 0V2Z',
    pin: 'M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z M12 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z',
    music: 'M9 18V5l12-2v13 M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z M21 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z',
    calendar: 'M8 2v4 M16 2v4 M3 10h18 M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z',
    clock: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z M12 6v6l4 2',
    external: 'M15 3h6v6 M10 14 21 3 M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6',
    search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16Z M21 21l-4.3-4.3',
    alert: 'M12 9v4 M12 17h.01 M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z',
    empty: 'M3 3h18v18H3z M3 9h18 M9 21V9',
    sun: 'M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10Z M12 1v2 M12 21v2 M4.22 4.22l1.42 1.42 M18.36 18.36l1.42 1.42 M1 12h2 M21 12h2 M4.22 19.78l1.42-1.42 M18.36 5.64l1.42-1.42',
    moon: 'M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z',
    back: 'M19 12H5 M12 19l-7-7 7-7',
    users: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z M22 21v-2a4 4 0 0 0-3-3.87 M16 3.13a4 4 0 0 1 0 7.75',
    chevron: 'M9 18l6-6-6-6',
    menu: 'M3 12h18 M3 6h18 M3 18h18',
    close: 'M18 6 6 18 M6 6l12 12',
  };

  function icon(name, extraClass) {
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '1.8');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    if (extraClass) svg.setAttribute('class', extraClass);
    (ICON_PATHS[name] || '').split(' M').forEach(function (d, i) {
      var p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      p.setAttribute('d', i === 0 ? d : 'M' + d);
      svg.appendChild(p);
    });
    return svg;
  }

  // ── Formatting ───────────────────────────────────────────────────────────

  var DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  /**
   * Split 'YYYY-MM-DD' by hand rather than through Date.
   *
   * new Date('2026-08-22') is parsed as UTC midnight and then rendered in the
   * viewer's zone, which shows an evening kick-off in Los Angeles as the day
   * before. The feed's dates carry no zone, so they are calendar dates and are
   * formatted as calendar dates. Day-of-week alone needs a Date, and that one
   * is built from explicit local parts.
   */
  function dateParts(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
    if (!m) return null;
    var y = +m[1], mo = +m[2], d = +m[3];
    return { y: y, m: mo, d: d, dow: DOW[new Date(y, mo - 1, d).getDay()], mon: MON[mo - 1] };
  }

  function formatDate(iso) {
    var p = dateParts(iso);
    return p ? p.dow + ' ' + p.d + ' ' + p.mon + ' ' + p.y : '';
  }

  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : (many || one + 's')); }

  // ── API ──────────────────────────────────────────────────────────────────

  function apiUrl(params) {
    var q = new URLSearchParams();
    Object.keys(params || {}).forEach(function (k) {
      var v = params[k];
      if (v !== null && v !== undefined && v !== '') q.set(k, v);
    });
    var s = q.toString();
    return API + (s ? '?' + s : '');
  }

  function fetchFeed(params) {
    return fetch(apiUrl(params), { headers: { Accept: 'application/json' } }).then(function (r) {
      if (!r.ok) {
        return r.json().catch(function () { return {}; }).then(function (body) {
          var err = new Error(body.error || ('Request failed (' + r.status + ')'));
          err.status = r.status;
          throw err;
        });
      }
      return r.json();
    });
  }

  /**
   * The index is wanted by both the page and the side menu on every load.
   * Memoised so that is one request, not two. A failure is not cached, so a
   * retry can actually retry.
   */
  var indexPromise = null;
  function index() {
    if (!indexPromise) {
      indexPromise = fetchFeed({}).catch(function (err) { indexPromise = null; throw err; });
    }
    return indexPromise;
  }

  // ── State renderers ──────────────────────────────────────────────────────

  function showSkeleton(node, rows) {
    clear(node);
    var wrap = el('div', { class: 'ev-skeleton', 'aria-busy': 'true', 'aria-live': 'polite' });
    for (var i = 0; i < (rows || 4); i++) wrap.appendChild(el('div', { class: 'ev-skel-row' }));
    node.appendChild(wrap);
  }

  function showEmpty(node, title, message) {
    clear(node);
    node.appendChild(el('div', { class: 'ev-empty' }, [
      icon('empty'),
      el('h3', { text: title }),
      el('p', { text: message }),
    ]));
  }

  function showError(node, message, onRetry) {
    clear(node);
    node.appendChild(el('div', { class: 'ev-error', role: 'alert' }, [
      icon('alert'),
      el('h3', { text: 'That did not load' }),
      el('p', { text: message }),
      onRetry ? el('p', { style: 'margin-top:16px' }, [
        el('button', { class: 'ev-btn ev-btn-secondary', type: 'button', onclick: onRetry, text: 'Try again' }),
      ]) : null,
    ]));
  }

  // ── Cards and tiles ──────────────────────────────────────────────────────

  function badge(entity, size) {
    return el('div', {
      class: 'ev-badge' + (size ? ' ev-badge-' + size : ''),
      style: '--hue:' + (entity && typeof entity.hue === 'number' ? entity.hue : 210),
      'aria-hidden': 'true',
    }, [entity && entity.initials ? entity.initials : '??']);
  }

  /**
   * One event row. `links` controls which parts become navigation, so the same
   * card works on a team page (where linking back to the team is pointless) and
   * in the browser (where everything is a way in).
   */
  function eventCard(ev, links) {
    links = links || {};
    var p = dateParts(ev.startDate);

    var meta = [];
    if (ev.timeKnown && ev.startTime) {
      meta.push(el('span', { class: 'tnum' }, [icon('clock'), ' ' + ev.startTime]));
    } else {
      meta.push(el('span', { class: 'ev-chip', title: 'The supplier did not give a start time for this event' }, ['Time TBC']));
    }

    if (ev.venue && ev.venue.name) {
      meta.push(el('span', { class: 'ev-dot', 'aria-hidden': 'true' }, ['·']));
      var venueNode = links.venue === false
        ? el('span', {}, [icon('pin'), ' ' + ev.venue.name])
        : el('a', { href: 'events-venue.html?key=' + encodeURIComponent(ev.venue.key) }, [icon('pin'), ' ' + ev.venue.name]);
      meta.push(venueNode);
    }

    if (ev.competitionLabel && links.competition !== false) {
      meta.push(el('span', { class: 'ev-dot', 'aria-hidden': 'true' }, ['·']));
      meta.push(el('a', { href: 'events-league.html?competition=' + encodeURIComponent(ev.competition) }, [ev.competitionLabel]));
    }

    // A time the two suppliers disagree on is shown, not hidden. See
    // docs/supplier-event-feed.md: neither feed is known to be venue-local.
    if (ev.startTimeConflict && ev.startTimeConflict.length > 1) {
      meta.push(el('span', {
        class: 'ev-chip ev-chip-warn',
        title: 'Suppliers disagree on the start time: ' + ev.startTimeConflict.join(' and '),
      }, ['Time disputed']));
    }

    if (ev.hasPlaceholderTeams) {
      meta.push(el('span', { class: 'ev-chip', title: 'One side is not decided yet' }, ['TBC']));
    }

    var titleText = ev.title + (ev.phase ? ' · ' + ev.phase : '');
    var actions = [];
    if (ev.booking && ev.booking.url) {
      actions.push(el('a', {
        class: 'ev-btn',
        href: ev.booking.url,
        target: '_blank',
        rel: 'noopener noreferrer',
        title: ev.booking.note || 'Open this event in the booking engine',
        'aria-label': 'Book ' + titleText,
      }, ['Book', icon('external')]));
    } else {
      actions.push(el('span', {
        class: 'ev-btn ev-btn-secondary',
        'aria-disabled': 'true',
        title: (ev.booking && ev.booking.note) || 'No booking link',
      }, ['No link']));
    }

    return el('article', { class: 'ev-card' }, [
      el('div', { class: 'ev-date tnum' }, p ? [
        el('span', { class: 'ev-date-dow', text: p.dow }),
        el('span', { class: 'ev-date-day', text: String(p.d) }),
        el('span', { class: 'ev-date-mon', text: p.mon + ' ' + String(p.y).slice(2) }),
      ] : [el('span', { class: 'ev-date-mon', text: 'TBC' })]),
      el('div', { class: 'ev-card-main' }, [
        el('h3', { class: 'ev-card-title', text: titleText }),
        el('div', { class: 'ev-card-meta' }, meta),
      ]),
      el('div', { class: 'ev-card-actions' }, actions),
    ]);
  }

  function entityTile(entity, href, metaText, onClick) {
    var body = el('div', { class: 'ev-tile-body' }, [
      el('div', { class: 'ev-tile-name', text: entity.name }),
      el('div', { class: 'ev-tile-meta', text: metaText, title: metaText }),
    ]);
    var attrs = { class: 'ev-tile', title: entity.name + ' — ' + metaText };
    if (onClick) { attrs.type = 'button'; attrs.onclick = onClick; }
    else { attrs.href = href; }
    return el(onClick ? 'button' : 'a', attrs, [badge(entity), body]);
  }

  // ── Chrome ───────────────────────────────────────────────────────────────

  var NAV = [
    { href: 'events.html', label: 'Overview', icon: 'ticket' },
    { href: 'events-league.html', label: 'Competitions', icon: 'trophy' },
    { href: 'events-venue.html', label: 'Venues', icon: 'pin' },
    { href: 'events-artist.html', label: 'Artists', icon: 'music' },
    { href: 'events-browse.html', label: "What's on", icon: 'calendar' },
    { href: 'events-search.html', label: 'Search', icon: 'search' },
  ];

  function mountChrome(current) {
    var top = document.getElementById('ev-top');
    if (!top) return;

    var nav = el('nav', { class: 'ev-nav', 'aria-label': 'Event surfaces' },
      NAV.map(function (item) {
        var isCurrent = item.href === current;
        return el('a', {
          href: item.href,
          'aria-current': isCurrent ? 'page' : null,
        }, [icon(item.icon), item.label]);
      }));

    var toggle = el('button', {
      class: 'ev-icon-btn',
      type: 'button',
      'aria-label': 'Switch between light and dark mode',
      onclick: toggleTheme,
    }, [icon('sun', 'icon-sun'), icon('moon', 'icon-moon')]);

    clear(top);
    top.appendChild(el('a', { class: 'ev-brand', href: 'events.html' }, [
      el('span', { class: 'ev-mark' }, [icon('ticket')]),
      el('span', {}, [
        el('span', { class: 'ev-brand-name', text: 'Events Explorer' }),
        el('span', { class: 'ev-brand-sub', text: 'Travelgenix supplier inventory' }),
      ]),
    ]));
    top.appendChild(el('div', { style: 'display:flex;align-items:center;gap:8px;flex-wrap:wrap' }, [nav, toggle]));
  }


  // ── Side menu ────────────────────────────────────────────────────────────

  /**
   * The competition menu, on every page.
   *
   * Modelled on the way a travel site lists its football trips: one row per
   * competition, the country after the name, a chevron to say it goes
   * somewhere. Grouped by sport with football first, because football is 58% of
   * the feed and burying the Premier League under Athletics would be perverse.
   *
   * A drawer below 1024px. Escape closes it, focus returns to the button that
   * opened it, and the backdrop is a real button so it is reachable without a
   * mouse.
   */
  var sidebarMounted = false;

  /**
   * Move the highlight without rebuilding. The league page changes competition
   * without a page load, and re-mounting would throw away whatever the visitor
   * had typed in the search box and re-request the index.
   */
  function setSidebarActive(competitionSlug) {
    var links = document.querySelectorAll('.ev-side-scroll .ev-side-link');
    for (var i = 0; i < links.length; i++) {
      var slug = links[i].getAttribute('data-competition') || '';
      if (slug && slug === competitionSlug) links[i].setAttribute('aria-current', 'page');
      else links[i].removeAttribute('aria-current');
    }
  }

  function mountSidebar(options) {
    var opts = options || {};
    var side = document.getElementById('ev-side');
    if (!side) return;
    if (sidebarMounted) { setSidebarActive(opts.competition || ''); return; }
    sidebarMounted = true;

    clear(side);

    var searchHost = el('div', { class: 'ev-search' });
    var head = el('div', { class: 'ev-side-head' }, [
      el('h2', { text: 'Browse' }),
      el('button', {
        class: 'ev-side-close',
        type: 'button',
        'aria-label': 'Close menu',
        onclick: closeSidebar,
      }, [icon('close')]),
    ]);
    var scroll = el('div', { class: 'ev-side-scroll' });

    side.appendChild(head);
    side.appendChild(searchHost);
    side.appendChild(scroll);
    mountSearch(searchHost);

    // Backdrop and toggle live outside the aside so the drawer can slide over
    // the page rather than pushing it.
    if (!document.querySelector('.ev-side-backdrop')) {
      document.body.appendChild(el('button', {
        class: 'ev-side-backdrop',
        type: 'button',
        tabindex: '-1',
        'aria-label': 'Close menu',
        onclick: closeSidebar,
      }));
    }

    scroll.appendChild(el('a', {
      class: 'ev-side-link ev-side-all',
      href: 'events-league.html',
      'aria-current': opts.competition || opts.page !== 'events-league.html' ? null : 'page',
    }, [
      el('span', { class: 'ev-side-label', text: 'All competitions' }),
      icon('chevron', 'ev-side-chev'),
    ]));

    index().then(function (data) {
      var byCategory = {};
      data.competitions.forEach(function (c) {
        (byCategory[c.category] = byCategory[c.category] || []).push(c);
      });
      data.categories.forEach(function (cat) {
        var list = byCategory[cat.slug];
        if (!list || !list.length) return;
        // Busiest first inside a sport: that is the order someone scans for.
        list = list.slice().sort(function (a, b) { return b.events - a.events; });
        scroll.appendChild(el('div', { class: 'ev-side-group', text: cat.label }));
        list.forEach(function (c) {
          scroll.appendChild(el('a', {
            class: 'ev-side-link',
            'data-competition': c.slug,
            href: 'events-league.html?competition=' + encodeURIComponent(c.slug),
            'aria-current': c.slug === opts.competition ? 'page' : null,
            title: c.label + (c.country ? ' - ' + c.country : '') + ' · ' + plural(c.events, 'event'),
          }, [
            el('span', { class: 'ev-side-label' }, [
              c.label,
              c.country ? el('span', { class: 'ev-side-country', text: ' - ' + c.country }) : null,
            ]),
            el('span', { class: 'ev-side-count', text: String(c.events) }),
            icon('chevron', 'ev-side-chev'),
          ]));
        });
      });
    }).catch(function (err) {
      scroll.appendChild(el('div', { class: 'ev-suggest-empty', text: 'Menu did not load: ' + err.message }));
    });
  }

  var sidebarOpener = null;

  function openSidebar(fromButton) {
    sidebarOpener = fromButton || null;
    document.body.setAttribute('data-side', 'open');
    if (fromButton) fromButton.setAttribute('aria-expanded', 'true');
    var first = document.querySelector('.ev-side .ev-side-close');
    if (first) first.focus();
  }

  function closeSidebar() {
    document.body.removeAttribute('data-side');
    var toggle = document.querySelector('.ev-side-toggle');
    if (toggle) toggle.setAttribute('aria-expanded', 'false');
    if (sidebarOpener) { sidebarOpener.focus(); sidebarOpener = null; }
  }

  /** The button that opens the drawer. Rendered above the page content. */
  function sidebarToggle() {
    var btn = el('button', {
      class: 'ev-side-toggle',
      type: 'button',
      'aria-expanded': 'false',
      'aria-controls': 'ev-side',
    }, [icon('menu'), 'Browse competitions']);
    btn.addEventListener('click', function () {
      if (document.body.getAttribute('data-side') === 'open') closeSidebar();
      else openSidebar(btn);
    });
    return btn;
  }

  // ── Search ───────────────────────────────────────────────────────────────

  /**
   * One box over everything.
   *
   * Typing "Wembley" should surface the ground and both the football and the
   * concerts at it; "Arsenal" should surface the club and its games home and
   * away. The suggestions show the entities, Enter goes to the full results.
   *
   * Built as a combobox: aria-expanded on the input, a listbox of options, and
   * arrow keys that move an aria-activedescendant rather than the focus, so the
   * typed text stays where it is.
   */
  function mountSearch(host, initialValue) {
    var input = el('input', {
      type: 'search',
      id: 'ev-q',
      placeholder: 'Search teams, venues, artists…',
      autocomplete: 'off',
      role: 'combobox',
      'aria-expanded': 'false',
      'aria-controls': 'ev-suggest',
      'aria-autocomplete': 'list',
      'aria-label': 'Search everything',
      value: initialValue || '',
    });
    var panel = el('div', { class: 'ev-suggest', id: 'ev-suggest', role: 'listbox', 'aria-label': 'Search suggestions', hidden: true });

    host.appendChild(el('div', { class: 'ev-search-field' }, [icon('search'), input]));
    host.appendChild(panel);

    var options = [];
    var activeIndex = -1;

    function close() {
      panel.hidden = true;
      input.setAttribute('aria-expanded', 'false');
      input.removeAttribute('aria-activedescendant');
      activeIndex = -1;
    }

    function setActive(i) {
      if (!options.length) return;
      if (activeIndex >= 0 && options[activeIndex]) options[activeIndex].classList.remove('is-active');
      activeIndex = (i + options.length) % options.length;
      var node = options[activeIndex];
      node.classList.add('is-active');
      input.setAttribute('aria-activedescendant', node.id);
      node.scrollIntoView({ block: 'nearest' });
    }

    function goToResults() {
      var term = input.value.trim();
      if (term) global.location.href = 'events-search.html?q=' + encodeURIComponent(term);
    }

    function group(label) { return el('div', { class: 'ev-suggest-group', text: label }); }

    function option(entity, href, meta, i) {
      var node = el('a', {
        class: 'ev-suggest-item',
        id: 'ev-sug-' + i,
        role: 'option',
        href: href,
        'aria-selected': 'false',
      }, [
        badge(entity),
        el('span', { class: 'ev-suggest-name', text: entity.name }),
        el('span', { class: 'ev-suggest-meta', text: meta }),
      ]);
      options.push(node);
      return node;
    }

    var run = debounce(function () {
      var term = input.value.trim();
      if (term.length < 2) { close(); return; }
      fetchFeed({ view: 'search', q: term, limit: 1 }).then(function (data) {
        if (input.value.trim() !== term) return;   // a later keystroke won
        clear(panel);
        options = [];
        activeIndex = -1;
        var i = 0;

        function section(label, items, hrefFor, metaFor) {
          if (!items || !items.length) return;
          panel.appendChild(group(label));
          items.slice(0, 4).forEach(function (x) {
            panel.appendChild(option(x, hrefFor(x), metaFor(x), i++));
          });
        }

        section('Competitions', data.competitions.map(function (c) {
          return { name: c.label + (c.country ? ' - ' + c.country : ''), initials: initialsOf(c.label), hue: hashHue(c.slug), slug: c.slug };
        }), function (c) { return 'events-league.html?competition=' + encodeURIComponent(c.slug); },
        function () { return 'League'; });

        // A club page needs a competition alongside the team, because that is
        // the tab it opens on. A club with none (an event whose competition the
        // feed never gave) falls back to the full results rather than a link
        // that would quietly land on the competition index.
        section('Clubs', data.teams, function (t) {
          if (!t.competitions || !t.competitions.length) return 'events-search.html?q=' + encodeURIComponent(t.name);
          return 'events-league.html?competition=' + encodeURIComponent(t.competitions[0])
            + '&team=' + encodeURIComponent(t.key);
        }, function (t) { return plural(t.events, 'game'); });

        section('Venues', data.venues, function (v) {
          return 'events-venue.html?key=' + encodeURIComponent(v.key);
        }, function (v) { return plural(v.events, 'event'); });

        section('Artists', data.performers, function (p) {
          return 'events-artist.html?key=' + encodeURIComponent(p.key);
        }, function (p) { return plural(p.events, 'date'); });

        if (!options.length && !data.total) {
          panel.appendChild(el('div', { class: 'ev-suggest-empty', text: 'Nothing matches “' + term + '”' }));
        } else {
          var all = el('a', {
            class: 'ev-suggest-item ev-suggest-all',
            id: 'ev-sug-' + i,
            role: 'option',
            href: 'events-search.html?q=' + encodeURIComponent(term),
            'aria-selected': 'false',
          }, [
            el('span', { class: 'ev-suggest-name', text: 'See all results for “' + term + '”' }),
            el('span', { class: 'ev-suggest-meta', text: plural(data.total, 'event') }),
          ]);
          options.push(all);
          panel.appendChild(all);
        }

        panel.hidden = false;
        input.setAttribute('aria-expanded', 'true');
      }).catch(function () { close(); });
    }, 250);

    input.addEventListener('input', run);
    input.addEventListener('focus', function () { if (input.value.trim().length >= 2 && options.length) { panel.hidden = false; input.setAttribute('aria-expanded', 'true'); } });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { close(); return; }
      if (e.key === 'ArrowDown') { e.preventDefault(); if (panel.hidden) run(); else setActive(activeIndex + 1); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setActive(activeIndex - 1); return; }
      if (e.key === 'Enter') {
        e.preventDefault();
        if (activeIndex >= 0 && options[activeIndex]) options[activeIndex].click();
        else goToResults();
      }
    });

    document.addEventListener('click', function (e) {
      if (!host.contains(e.target)) close();
    });

    return input;
  }

  // Competitions have no stored badge, so the menu and the suggestions derive
  // one the same way the registries do. Same hash, same colour everywhere.
  function initialsOf(name) {
    var words = String(name || '').split(/[\s.]+/).filter(function (w) {
      return w && !/^(the|of|and|de|cup|league)$/i.test(w);
    });
    if (!words.length) return '??';
    if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
    return (words[0][0] + words[1][0]).toUpperCase();
  }

  function hashHue(key) {
    var h = 0x811c9dc5;
    var s = String(key);
    for (var i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h % 360;
  }

  var THEME_KEY = 'tgev_theme';

  function applyTheme(theme) {
    if (theme === 'dark' || theme === 'light') document.documentElement.setAttribute('data-theme', theme);
    else document.documentElement.removeAttribute('data-theme');
  }

  function currentTheme() {
    var stored = null;
    try { stored = localStorage.getItem(THEME_KEY); } catch (e) { /* private mode */ }
    if (stored === 'dark' || stored === 'light') return stored;
    return global.matchMedia && global.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  function toggleTheme() {
    var next = currentTheme() === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    try { localStorage.setItem(THEME_KEY, next); } catch (e) { /* private mode */ }
  }

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && document.body.getAttribute('data-side') === 'open') closeSidebar();
  });

  function initTheme() {
    var stored = null;
    try { stored = localStorage.getItem(THEME_KEY); } catch (e) { /* private mode */ }
    if (stored) applyTheme(stored);
  }

  function crumbs(items) {
    var nodes = [];
    items.forEach(function (item, i) {
      if (i) nodes.push(el('span', { 'aria-hidden': 'true', text: '/' }));
      nodes.push(item.href
        ? el('a', { href: item.href, text: item.label })
        : el('span', { class: 'current', 'aria-current': 'page', text: item.label }));
    });
    return el('nav', { class: 'ev-crumbs', 'aria-label': 'Breadcrumb' }, nodes);
  }

  /** The banner every page shows while the deeplink spec is still a draft. */
  function deeplinkNotice(meta) {
    if (!meta || meta.deeplinkVerified) return null;
    return el('div', { class: 'ev-notice' }, [
      icon('alert'),
      el('div', {}, [
        el('strong', { text: 'Booking links are provisional' }),
        el('p', {
          text: 'Every Book button is built to the draft Travelify ticket spec and has not been '
            + 'confirmed against a live link yet. The event ids behind them are the real ones from '
            + 'the supplier feed, so only the URL shape is in question.',
        }),
      ]),
    ]);
  }

  function param(name) {
    return new URLSearchParams(global.location.search).get(name) || '';
  }

  /** Change the query string without reloading, so Back works as expected. */
  function setParams(next, replace) {
    var q = new URLSearchParams(global.location.search);
    Object.keys(next).forEach(function (k) {
      if (next[k]) q.set(k, next[k]); else q.delete(k);
    });
    var url = global.location.pathname + (q.toString() ? '?' + q.toString() : '');
    if (replace) history.replaceState(null, '', url); else history.pushState(null, '', url);
  }

  function debounce(fn, ms) {
    var t = null;
    return function () {
      var args = arguments, self = this;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(self, args); }, ms);
    };
  }

  global.TGEvents = {
    el: el,
    clear: clear,
    icon: icon,
    badge: badge,
    eventCard: eventCard,
    entityTile: entityTile,
    fetchFeed: fetchFeed,
    index: index,
    showSkeleton: showSkeleton,
    showEmpty: showEmpty,
    showError: showError,
    mountChrome: mountChrome,
    mountSidebar: mountSidebar,
    setSidebarActive: setSidebarActive,
    mountSearch: mountSearch,
    sidebarToggle: sidebarToggle,
    initialsOf: initialsOf,
    hashHue: hashHue,
    initTheme: initTheme,
    crumbs: crumbs,
    deeplinkNotice: deeplinkNotice,
    formatDate: formatDate,
    dateParts: dateParts,
    plural: plural,
    param: param,
    setParams: setParams,
    debounce: debounce,
  };

  initTheme();
}(window));
