/**
 * The cookie consent banner on a published site.
 *
 * Loaded only for a site whose settings turn it on AND that has an analytics tag
 * to gate, so a site that asked for nothing ships nothing. Its whole job is to
 * turn Google Consent Mode, which lib/settings/head.ts has defaulted to DENIED,
 * to granted for whatever the visitor accepts, and to remember the choice.
 *
 * TWO WAYS TO ASK, one behaviour. Plain accept-or-reject is the default. When a
 * site turns on "let visitors choose", a third button opens a small preferences
 * view with Analytics and Marketing as separate switches, each mapped to its own
 * Consent Mode signal, with Essential always on. Either way the answer is kept in
 * one first-party cookie and applied the same way.
 *
 * FOUR LAYOUTS. card, bar, corner and solid change only how the compact banner is
 * placed and coloured. The preferences view is always a plain, legible card,
 * because a form is read, not glanced at.
 *
 * WHY VANILLA, NOT REACT. The published site ships no client JavaScript for its
 * content on purpose (see app/site/[host]/[[...path]]/page.tsx). Browser
 * behaviour is done the way the rest of it is done: one small same-origin script
 * that reads its settings off a data element and builds its own DOM.
 *
 * CSP-CLEAN: no inline handlers, no eval, no innerHTML with anything off the
 * page. Copy comes from the data element's attributes, which the server escaped,
 * and is written with textContent. THEMED FROM THE SITE via its theme tokens.
 *
 * @version 1.2.0
 */
(function () {
  'use strict';

  if (window.__TG_SITES_CONSENT__) return;
  window.__TG_SITES_CONSENT__ = '1.2.0';

  var COOKIE = 'tgs_consent';
  var MAX_AGE = 60 * 60 * 24 * 180; // Six months, then we ask again.

  var mount = document.getElementById('tgs-consent');
  if (!mount) return;

  var LAYOUTS = { card: 1, bar: 1, corner: 1, solid: 1 };
  var layout = mount.getAttribute('data-layout') || 'card';
  if (!LAYOUTS[layout]) layout = 'card';
  var solid = layout === 'solid';
  var granular = mount.getAttribute('data-granular') === '1';

  var cfg = {
    title: mount.getAttribute('data-title') || 'Cookies on this site',
    message: mount.getAttribute('data-message') || '',
    accept: mount.getAttribute('data-accept') || 'Accept',
    reject: mount.getAttribute('data-reject') || 'Reject',
    policy: mount.getAttribute('data-policy') || '',
  };

  // The two categories a site can actually control through Consent Mode, plus the
  // essential row which is never a choice. Kept short and honest.
  var CATEGORIES = [
    {
      key: 'analytics',
      title: 'Analytics',
      body: 'Helps us see how the site is used, so we can make it better.',
    },
    {
      key: 'marketing',
      title: 'Marketing',
      body: 'Used to measure and improve any advertising we run.',
    },
  ];

  // ------------------------------------------------------------------ storage

  // The choice is one small string: 'a1m0' is analytics yes, marketing no. The
  // older 'granted'/'denied' values are still read, so a visitor who chose under
  // the simple banner is not asked again after a site turns on categories.
  function decode(raw) {
    if (raw === 'granted') return { analytics: 1, marketing: 1 };
    if (raw === 'denied') return { analytics: 0, marketing: 0 };
    var m = /^a([01])m([01])$/.exec(raw || '');
    return m ? { analytics: Number(m[1]), marketing: Number(m[2]) } : null;
  }

  function encode(choice) {
    return 'a' + (choice.analytics ? 1 : 0) + 'm' + (choice.marketing ? 1 : 0);
  }

  function readChoice() {
    try {
      var match = document.cookie.match(/(?:^|;\s*)tgs_consent=([^;]*)/);
      return match ? decode(decodeURIComponent(match[1])) : null;
    } catch (error) {
      return null;
    }
  }

  function writeChoice(choice) {
    try {
      var secure = location.protocol === 'https:' ? '; Secure' : '';
      document.cookie =
        COOKIE + '=' + encode(choice) + '; Max-Age=' + MAX_AGE + '; Path=/; SameSite=Lax' + secure;
    } catch (error) {
      /* A visitor who blocks cookies gets the banner each visit, which is honest. */
    }
  }

  // ------------------------------------------------------------------ consent

  function gtag() {
    window.dataLayer = window.dataLayer || [];
    window.dataLayer.push(arguments);
  }

  function applyConsent(choice) {
    var ad = choice.marketing ? 'granted' : 'denied';
    gtag('consent', 'update', {
      analytics_storage: choice.analytics ? 'granted' : 'denied',
      ad_storage: ad,
      ad_user_data: ad,
      ad_personalization: ad,
    });
  }

  // ------------------------------------------------------------------ styling

  var TOKEN = {
    surface: 'var(--tgs-surface, #ffffff)',
    text: 'var(--tgs-text, #1a1a1a)',
    muted: 'var(--tgs-text-muted, #5a5a5a)',
    border: 'var(--tgs-border, rgba(0,0,0,0.14))',
    accent: 'var(--tgs-accent, #1a1a1a)',
    onAccent: 'var(--tgs-on-accent, #ffffff)',
    radius: 'var(--tgs-radius-md, 12px)',
    font: 'var(--tgs-font-body, inherit)',
    shadow: 'var(--tgs-shadow-soft, 0 10px 40px rgba(0,0,0,0.18))',
  };

  // On a solid banner the words sit on the accent, so the ink flips. The
  // preferences card is always neutral, so it uses TOKEN.text/muted directly.
  var INK = solid ? TOKEN.onAccent : TOKEN.text;
  var SUB = solid ? TOKEN.onAccent : TOKEN.muted;

  function set(node, styles) {
    for (var key in styles) {
      if (Object.prototype.hasOwnProperty.call(styles, key)) node.style[key] = styles[key];
    }
    return node;
  }

  /**
   * A button. `kind` is 'primary', 'secondary' or 'ghost'. On a solid banner the
   * primary flips to the surface colour so it reads as a button on the accent.
   * `onCard` forces the neutral palette, for the buttons in the preferences card.
   */
  function button(label, kind, onCard) {
    var b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    var filled = solid && !onCard;
    set(b, {
      font: 'inherit',
      fontWeight: kind === 'ghost' ? '600' : '600',
      fontSize: '0.9rem',
      lineHeight: '1',
      padding: '11px 18px',
      borderRadius: 'var(--tgs-radius-sm, 8px)',
      cursor: 'pointer',
      whiteSpace: 'nowrap',
      background: 'transparent',
      border: '1px solid transparent',
    });
    if (kind === 'primary') {
      b.style.background = filled ? TOKEN.surface : TOKEN.accent;
      b.style.color = filled ? TOKEN.accent : TOKEN.onAccent;
    } else if (kind === 'secondary') {
      b.style.border = '1px solid ' + (filled ? TOKEN.onAccent : TOKEN.border);
      b.style.color = onCard ? TOKEN.text : INK;
    } else {
      // ghost: quiet, for "Choose"
      b.style.color = onCard ? TOKEN.text : INK;
      b.style.textDecoration = 'underline';
    }
    return b;
  }

  // ------------------------------------------------------------------- banner

  var banner = null;

  function close() {
    if (banner && banner.parentNode) banner.parentNode.removeChild(banner);
    banner = null;
    reopener();
  }

  function choose(choice) {
    writeChoice(choice);
    applyConsent(choice);
    close();
  }

  /** The container styles for each look. */
  function placeCompact(node) {
    set(node, {
      position: 'fixed',
      zIndex: '2147483000',
      boxSizing: 'border-box',
      background: solid ? TOKEN.accent : TOKEN.surface,
      color: INK,
      font: TOKEN.font,
      boxShadow: TOKEN.shadow,
    });

    if (layout === 'bar') {
      set(node, {
        left: '0',
        right: '0',
        bottom: '0',
        padding: '16px 20px',
        borderTop: '1px solid ' + (solid ? 'transparent' : TOKEN.border),
        borderRadius: '0',
      });
      return;
    }

    set(node, {
      bottom: '16px',
      padding: layout === 'corner' ? '18px' : '20px',
      border: '1px solid ' + (solid ? 'transparent' : TOKEN.border),
      borderRadius: TOKEN.radius,
    });
    if (layout === 'corner') {
      set(node, { left: '16px', right: 'auto', maxWidth: '340px', margin: '0' });
    } else {
      set(node, { left: '16px', right: '16px', maxWidth: '520px', margin: '0 auto' });
    }
  }

  function heading(text, ink) {
    var h = document.createElement('p');
    h.textContent = text;
    set(h, { margin: '0 0 6px', fontWeight: '700', fontSize: '1rem', color: ink });
    return h;
  }

  function message(ink, sub) {
    var body = document.createElement('p');
    body.textContent = cfg.message;
    set(body, { margin: '0', fontSize: '0.9rem', lineHeight: '1.5', color: sub, opacity: solid ? '0.92' : '1' });
    if (cfg.policy) {
      var link = document.createElement('a');
      link.href = cfg.policy;
      link.textContent = 'Read our cookie policy';
      link.rel = 'noopener';
      set(link, { color: ink, textDecoration: 'underline', marginLeft: '4px' });
      body.appendChild(document.createTextNode(' '));
      body.appendChild(link);
    }
    return body;
  }

  function acceptAll() {
    choose({ analytics: 1, marketing: 1 });
  }
  function rejectAll() {
    choose({ analytics: 0, marketing: 0 });
  }

  /** The button row on the compact banner. */
  function compactControls() {
    var row = document.createElement('div');
    set(row, { display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' });

    var accept = button(granular ? cfg.accept + ' all' : cfg.accept, 'primary');
    accept.addEventListener('click', acceptAll);
    var reject = button(granular ? cfg.reject + ' all' : cfg.reject, 'secondary');
    reject.addEventListener('click', rejectAll);
    row.appendChild(accept);
    row.appendChild(reject);

    if (granular) {
      var chooseBtn = button('Choose', 'ghost');
      chooseBtn.addEventListener('click', showPreferences);
      row.appendChild(chooseBtn);
    }
    return { row: row, accept: accept };
  }

  function show() {
    if (banner) return;

    banner = document.createElement('div');
    banner.setAttribute('role', 'dialog');
    banner.setAttribute('aria-label', cfg.title);
    banner.setAttribute('aria-live', 'polite');
    placeCompact(banner);

    var head = heading(cfg.title, INK);
    var body = message(INK, SUB);
    var made = compactControls();

    if (layout === 'bar') {
      var inner = document.createElement('div');
      set(inner, {
        maxWidth: 'var(--tgs-width-contained, 1100px)',
        margin: '0 auto',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '16px 24px',
        flexWrap: 'wrap',
      });
      var words = document.createElement('div');
      set(words, { flex: '1 1 320px', minWidth: '0' });
      set(head, { margin: '0 0 2px', fontSize: '0.95rem' });
      words.appendChild(head);
      words.appendChild(body);
      set(made.row, { flex: '0 0 auto' });
      inner.appendChild(words);
      inner.appendChild(made.row);
      banner.appendChild(inner);
    } else {
      set(body, { marginBottom: '16px' });
      banner.appendChild(head);
      banner.appendChild(body);
      banner.appendChild(made.row);
    }

    document.body.appendChild(banner);
    focus(made.accept);
  }

  // --------------------------------------------------------------- preferences

  function categoryRow(cat, current) {
    var row = document.createElement('label');
    set(row, {
      display: 'flex',
      alignItems: 'flex-start',
      gap: '12px',
      padding: '12px 0',
      borderTop: '1px solid ' + TOKEN.border,
      cursor: 'pointer',
    });

    var toggle = document.createElement('input');
    toggle.type = 'checkbox';
    toggle.checked = Boolean(current);
    toggle.setAttribute('data-cat', cat.key);
    set(toggle, { marginTop: '3px', width: '18px', height: '18px', flex: '0 0 auto', accentColor: TOKEN.accent });

    var text = document.createElement('div');
    var t = document.createElement('div');
    t.textContent = cat.title;
    set(t, { fontWeight: '600', fontSize: '0.92rem', color: TOKEN.text });
    var d = document.createElement('div');
    d.textContent = cat.body;
    set(d, { fontSize: '0.82rem', lineHeight: '1.45', color: TOKEN.muted, marginTop: '2px' });
    text.appendChild(t);
    text.appendChild(d);

    row.appendChild(toggle);
    row.appendChild(text);
    return row;
  }

  function essentialRow() {
    var row = document.createElement('div');
    set(row, { display: 'flex', alignItems: 'flex-start', gap: '12px', padding: '12px 0' });
    var badge = document.createElement('span');
    badge.textContent = 'Always on';
    set(badge, {
      fontSize: '0.7rem',
      fontWeight: '600',
      color: TOKEN.muted,
      border: '1px solid ' + TOKEN.border,
      borderRadius: '999px',
      padding: '3px 8px',
      marginTop: '1px',
      whiteSpace: 'nowrap',
      flex: '0 0 auto',
    });
    var text = document.createElement('div');
    var t = document.createElement('div');
    t.textContent = 'Essential';
    set(t, { fontWeight: '600', fontSize: '0.92rem', color: TOKEN.text });
    var d = document.createElement('div');
    d.textContent = 'Needed for the site to work. These are always on.';
    set(d, { fontSize: '0.82rem', lineHeight: '1.45', color: TOKEN.muted, marginTop: '2px' });
    text.appendChild(t);
    text.appendChild(d);
    row.appendChild(badge);
    row.appendChild(text);
    return row;
  }

  function showPreferences() {
    if (banner) close();
    // A first-time visitor sees everything off, so Save with nothing ticked is a
    // reject: consent is opt-in. A returning one sees what they chose before.
    var current = readChoice() || { analytics: 0, marketing: 0 };

    banner = document.createElement('div');
    banner.setAttribute('role', 'dialog');
    banner.setAttribute('aria-label', 'Choose your cookies');
    set(banner, {
      position: 'fixed',
      zIndex: '2147483000',
      boxSizing: 'border-box',
      left: '16px',
      right: '16px',
      bottom: '16px',
      margin: '0 auto',
      maxWidth: '460px',
      padding: '22px',
      background: TOKEN.surface,
      color: TOKEN.text,
      font: TOKEN.font,
      border: '1px solid ' + TOKEN.border,
      borderRadius: TOKEN.radius,
      boxShadow: TOKEN.shadow,
      maxHeight: 'calc(100vh - 32px)',
      overflowY: 'auto',
    });

    banner.appendChild(heading('Choose your cookies', TOKEN.text));

    var list = document.createElement('div');
    set(list, { margin: '10px 0 18px' });
    list.appendChild(essentialRow());
    for (var i = 0; i < CATEGORIES.length; i += 1) {
      list.appendChild(categoryRow(CATEGORIES[i], current[CATEGORIES[i].key]));
    }
    // A closing hairline under the last row, so the list reads as a set.
    var end = document.createElement('div');
    set(end, { borderTop: '1px solid ' + TOKEN.border });
    list.appendChild(end);
    banner.appendChild(list);

    var row = document.createElement('div');
    set(row, { display: 'flex', gap: '10px', flexWrap: 'wrap' });
    var save = button('Save choices', 'primary', true);
    save.addEventListener('click', function () {
      var picked = { analytics: 0, marketing: 0 };
      var boxes = banner.querySelectorAll('input[data-cat]');
      for (var j = 0; j < boxes.length; j += 1) {
        picked[boxes[j].getAttribute('data-cat')] = boxes[j].checked ? 1 : 0;
      }
      choose(picked);
    });
    var all = button(cfg.accept + ' all', 'secondary', true);
    all.addEventListener('click', acceptAll);
    row.appendChild(save);
    row.appendChild(all);
    banner.appendChild(row);

    document.body.appendChild(banner);
    focus(save);
  }

  function focus(node) {
    try {
      node.focus();
    } catch (error) {
      /* Focus is a nicety, never a requirement. */
    }
  }

  // ------------------------------------------------------ reopen (withdrawal)

  var pill = null;

  function reopener() {
    if (pill || readChoice() === null) return;
    pill = document.createElement('button');
    pill.type = 'button';
    pill.textContent = 'Cookie settings';
    pill.setAttribute('aria-label', 'Change your cookie settings');
    set(pill, {
      position: 'fixed',
      zIndex: '2147482000',
      left: '16px',
      bottom: '16px',
      font: TOKEN.font,
      fontSize: '0.72rem',
      padding: '7px 12px',
      borderRadius: '999px',
      cursor: 'pointer',
      border: '1px solid var(--tgs-border, rgba(0,0,0,0.14))',
      background: 'var(--tgs-surface, #ffffff)',
      color: 'var(--tgs-text-muted, #5a5a5a)',
      opacity: '0.85',
    });
    pill.addEventListener('click', openSettings);
    document.body.appendChild(pill);
  }

  function openSettings() {
    if (pill && pill.parentNode) pill.parentNode.removeChild(pill);
    pill = null;
    // Reopening always offers the full choice when the site has categories on.
    if (granular) showPreferences();
    else show();
  }

  // A visitor can be pointed here from a footer link too.
  window.tgsCookieSettings = openSettings;

  // ------------------------------------------------------------------- start

  var choice = readChoice();
  if (choice) {
    applyConsent(choice);
    reopener();
  } else {
    show();
  }
})();
