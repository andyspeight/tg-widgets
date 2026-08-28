/**
 * The cookie consent banner on a published site.
 *
 * Loaded only for a site whose settings turn it on AND that has an analytics tag
 * to gate, so a site that asked for nothing ships nothing. Its whole job is to
 * turn Google Consent Mode, which lib/settings/head.ts has defaulted to DENIED,
 * to granted when the visitor accepts, and to remember the choice.
 *
 * WHY VANILLA, NOT REACT. The published site ships no client JavaScript for its
 * content on purpose (see app/site/[host]/[[...path]]/page.tsx). Browser
 * behaviour is done the way the rest of it is done, no-right-click and the
 * widgets alike: one small same-origin script that reads its settings off a
 * data element and builds its own DOM.
 *
 * CSP-CLEAN, like everything else here: no inline handlers, no eval, no
 * innerHTML with anything off the page. The copy comes from the data element's
 * attributes, which the server escaped, and is written with textContent.
 *
 * FOUR LAYOUTS, ONE BEHAVIOUR. card, bar, corner and solid change only how the
 * banner is placed and coloured; the cookie, the consent update and the accept
 * and reject paths are identical. The choice is a data attribute the client set
 * in settings. THEMED FROM THE SITE: the colours are the page's own theme
 * tokens, with plain fallbacks for the rare page that has none.
 *
 * @version 1.1.0
 */
(function () {
  'use strict';

  if (window.__TG_SITES_CONSENT__) return;
  window.__TG_SITES_CONSENT__ = '1.1.0';

  var COOKIE = 'tgs_consent';
  var MAX_AGE = 60 * 60 * 24 * 180; // Six months, then we ask again.

  var mount = document.getElementById('tgs-consent');
  if (!mount) return;

  var LAYOUTS = { card: 1, bar: 1, corner: 1, solid: 1 };
  var layout = mount.getAttribute('data-layout') || 'card';
  if (!LAYOUTS[layout]) layout = 'card';

  var cfg = {
    title: mount.getAttribute('data-title') || 'Cookies on this site',
    message: mount.getAttribute('data-message') || '',
    accept: mount.getAttribute('data-accept') || 'Accept',
    reject: mount.getAttribute('data-reject') || 'Reject',
    policy: mount.getAttribute('data-policy') || '',
  };

  var solid = layout === 'solid';

  // ------------------------------------------------------------------ storage

  function readChoice() {
    try {
      var match = document.cookie.match(/(?:^|;\s*)tgs_consent=(granted|denied)(?:;|$)/);
      return match ? match[1] : '';
    } catch (error) {
      return '';
    }
  }

  function writeChoice(value) {
    try {
      var secure = location.protocol === 'https:' ? '; Secure' : '';
      document.cookie =
        COOKIE + '=' + value + '; Max-Age=' + MAX_AGE + '; Path=/; SameSite=Lax' + secure;
    } catch (error) {
      /* A visitor who blocks cookies gets the banner each visit, which is honest. */
    }
  }

  // ------------------------------------------------------------------ consent

  function gtag() {
    window.dataLayer = window.dataLayer || [];
    window.dataLayer.push(arguments);
  }

  function applyConsent(granted) {
    var state = granted ? 'granted' : 'denied';
    gtag('consent', 'update', {
      ad_storage: state,
      analytics_storage: state,
      ad_user_data: state,
      ad_personalization: state,
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

  // On a solid banner the words sit on the accent, so the ink flips.
  var INK = solid ? TOKEN.onAccent : TOKEN.text;
  var SUB = solid ? TOKEN.onAccent : TOKEN.muted;

  function set(node, styles) {
    for (var key in styles) {
      if (Object.prototype.hasOwnProperty.call(styles, key)) node.style[key] = styles[key];
    }
    return node;
  }

  function button(label, primary) {
    var b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    set(b, {
      font: 'inherit',
      fontWeight: '600',
      fontSize: '0.9rem',
      lineHeight: '1',
      padding: '11px 18px',
      borderRadius: 'var(--tgs-radius-sm, 8px)',
      cursor: 'pointer',
      whiteSpace: 'nowrap',
      // Accept and Reject are the SAME size and weight on purpose: consent is not
      // consent if saying no is harder than saying yes.
      border: '1px solid ' + (solid ? TOKEN.onAccent : TOKEN.border),
    });
    if (primary) {
      // On a solid banner the primary flips to the surface colour so it reads as
      // the button on the accent, not another block of accent.
      b.style.background = solid ? TOKEN.surface : TOKEN.accent;
      b.style.color = solid ? TOKEN.accent : TOKEN.onAccent;
      b.style.borderColor = 'transparent';
    } else {
      b.style.background = 'transparent';
      b.style.color = INK;
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

  function choose(granted) {
    writeChoice(granted ? 'granted' : 'denied');
    applyConsent(granted);
    close();
  }

  /** The container styles for each look. Everything shared is set after. */
  function place(node) {
    var common = {
      position: 'fixed',
      zIndex: '2147483000',
      boxSizing: 'border-box',
      background: solid ? TOKEN.accent : TOKEN.surface,
      color: INK,
      font: TOKEN.font,
      boxShadow: TOKEN.shadow,
    };
    set(node, common);

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

    // card, corner and solid are all rounded cards; corner hugs the left and is
    // narrower, the other two centre along the foot.
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

  function heading() {
    var h = document.createElement('p');
    h.textContent = cfg.title;
    set(h, { margin: '0 0 6px', fontWeight: '700', fontSize: '1rem', color: INK });
    return h;
  }

  function message() {
    var body = document.createElement('p');
    body.textContent = cfg.message;
    set(body, { margin: '0', fontSize: '0.9rem', lineHeight: '1.5', color: SUB, opacity: solid ? '0.92' : '1' });
    if (cfg.policy) {
      var link = document.createElement('a');
      link.href = cfg.policy;
      link.textContent = 'Read our cookie policy';
      link.rel = 'noopener';
      set(link, { color: INK, textDecoration: 'underline', marginLeft: '4px' });
      body.appendChild(document.createTextNode(' '));
      body.appendChild(link);
    }
    return body;
  }

  function controls() {
    var row = document.createElement('div');
    set(row, { display: 'flex', gap: '10px', flexWrap: 'wrap' });
    var accept = button(cfg.accept, true);
    accept.addEventListener('click', function () {
      choose(true);
    });
    var reject = button(cfg.reject, false);
    reject.addEventListener('click', function () {
      choose(false);
    });
    row.appendChild(accept);
    row.appendChild(reject);
    return { row: row, accept: accept };
  }

  function show() {
    if (banner) return;

    banner = document.createElement('div');
    banner.setAttribute('role', 'dialog');
    banner.setAttribute('aria-label', cfg.title);
    banner.setAttribute('aria-live', 'polite');
    place(banner);

    var head = heading();
    var body = message();
    var made = controls();

    if (layout === 'bar') {
      // Words on the left, buttons on the right, centred in a readable column.
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
    try {
      made.accept.focus();
    } catch (error) {
      /* Focus is a nicety, never a requirement. */
    }
  }

  // ------------------------------------------------------ reopen (withdrawal)

  var pill = null;

  function reopener() {
    if (pill || readChoice() === '') return;
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
    show();
  }

  // A visitor can be pointed here from a footer link too.
  window.tgsCookieSettings = openSettings;

  // ------------------------------------------------------------------- start

  var choice = readChoice();
  if (choice === 'granted') {
    // A returning visitor who already said yes: honour it without asking again.
    applyConsent(true);
    reopener();
  } else if (choice === 'denied') {
    reopener();
  } else {
    show();
  }
})();
