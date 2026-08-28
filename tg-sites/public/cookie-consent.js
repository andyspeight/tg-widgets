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
 * THEMED FROM THE SITE. The colours are the page's own theme tokens, so the
 * banner belongs to the site rather than looking bolted on, with plain
 * fallbacks for the rare page that has none.
 *
 * @version 1.0.0
 */
(function () {
  'use strict';

  if (window.__TG_SITES_CONSENT__) return;
  window.__TG_SITES_CONSENT__ = '1.0.0';

  var COOKIE = 'tgs_consent';
  var MAX_AGE = 60 * 60 * 24 * 180; // Six months, then we ask again.

  var mount = document.getElementById('tgs-consent');
  if (!mount) return;

  var cfg = {
    title: mount.getAttribute('data-title') || 'Cookies on this site',
    message: mount.getAttribute('data-message') || '',
    accept: mount.getAttribute('data-accept') || 'Accept',
    reject: mount.getAttribute('data-reject') || 'Reject',
    policy: mount.getAttribute('data-policy') || '',
  };

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
  };

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
      border: '1px solid ' + TOKEN.border,
      // Accept and Reject are the SAME size and weight on purpose: consent is not
      // consent if saying no is harder than saying yes.
      background: primary ? TOKEN.accent : 'transparent',
      color: primary ? TOKEN.onAccent : TOKEN.text,
    });
    if (primary) b.style.borderColor = 'transparent';
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

  function show() {
    if (banner) return;

    banner = document.createElement('div');
    banner.setAttribute('role', 'dialog');
    banner.setAttribute('aria-label', cfg.title);
    banner.setAttribute('aria-live', 'polite');
    set(banner, {
      position: 'fixed',
      zIndex: '2147483000',
      left: '16px',
      right: '16px',
      bottom: '16px',
      maxWidth: '520px',
      margin: '0 auto',
      padding: '20px',
      background: TOKEN.surface,
      color: TOKEN.text,
      font: TOKEN.font,
      border: '1px solid ' + TOKEN.border,
      borderRadius: TOKEN.radius,
      boxShadow: 'var(--tgs-shadow-soft, 0 10px 40px rgba(0,0,0,0.18))',
    });

    var heading = document.createElement('p');
    heading.textContent = cfg.title;
    set(heading, { margin: '0 0 6px', fontWeight: '700', fontSize: '1rem' });
    banner.appendChild(heading);

    var body = document.createElement('p');
    body.textContent = cfg.message;
    set(body, { margin: '0 0 16px', fontSize: '0.9rem', lineHeight: '1.5', color: TOKEN.muted });

    if (cfg.policy) {
      var link = document.createElement('a');
      link.href = cfg.policy;
      link.textContent = 'Read our cookie policy';
      link.rel = 'noopener';
      set(link, { color: TOKEN.text, textDecoration: 'underline', marginLeft: '4px' });
      body.appendChild(document.createTextNode(' '));
      body.appendChild(link);
    }
    banner.appendChild(body);

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
    banner.appendChild(row);

    document.body.appendChild(banner);
    // Focus the first control so a keyboard visitor lands on the choice.
    try {
      accept.focus();
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
      border: '1px solid ' + TOKEN.border,
      background: TOKEN.surface,
      color: TOKEN.muted,
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
