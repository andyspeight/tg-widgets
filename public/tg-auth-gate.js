/**
 * Travelgenix unified auth gate.
 *
 * One file, dropped into any Travelgenix product page, that:
 *   1. Verifies the user has a valid central session (cookie scoped to
 *      .travelify.io)
 *   2. If not, redirects to id.travelify.io/signin.html with a `next`
 *      param so the user lands back here after authenticating
 *   3. Exposes `window.tgAuth` with the user, client, and permissions
 *      that any page can read to render itself
 *
 * USAGE — minimum, in the page <head>:
 *
 *   <script src="https://id.travelify.io/tg-auth-gate.js"
 *           data-product="luna_marketing"></script>
 *
 * The `data-product` attribute is the slug from the Products table. If
 * the user has any active permission for that product, they're let in.
 * If not, they get bounced to a "no access" page.
 *
 * To skip the product check (e.g. for a page anyone signed-in can see):
 *
 *   <script src="https://id.travelify.io/tg-auth-gate.js"
 *           data-product="*"></script>
 *
 * After the script loads and resolves the session, it fires a custom
 * event 'tg-auth-ready' on `window`. Page code listens for this:
 *
 *   window.addEventListener('tg-auth-ready', function() {
 *     console.log(tgAuth.user.email);
 *     console.log(tgAuth.permissions);
 *     // build your UI
 *   });
 *
 * If the page needs to log the user out:
 *
 *   tgAuth.signOut();   // POSTs to /api/auth/signout, clears cookie,
 *                       // redirects to signin
 *
 * Why this design: every product uses the same call. When auth changes
 * (Google sign-in, magic link, MFA later), only this file changes.
 * Products inherit the upgrade automatically.
 */

(function () {
  'use strict';

  var ID_HOST = 'https://id.travelify.io';
  var ME_URL = ID_HOST + '/api/auth/me';
  var SIGNIN_URL = ID_HOST + '/signin.html';
  var SIGNOUT_URL = ID_HOST + '/api/auth/signout';

  // Find this script tag so we can read its data-product attribute.
  // currentScript is the safe way; document.scripts[last] is a fallback.
  var thisScript =
    document.currentScript ||
    (function () {
      var scripts = document.getElementsByTagName('script');
      return scripts[scripts.length - 1];
    })();

  var requiredProduct =
    (thisScript && thisScript.getAttribute('data-product')) || '*';

  // Public API (window.tgAuth) — page code reads from here after the
  // 'tg-auth-ready' event fires.
  var tgAuth = {
    ready: false,
    user: null,
    client: null,
    permissions: [],
    role: null, // resolved role for the requested product, if any

    /**
     * Returns true if this user holds a permission for the given product
     * slug. Useful for conditional UI ("show admin tab only if owner").
     */
    can: function (productSlug, allowedRoles) {
      if (!this.permissions || !this.permissions.length) return false;
      var match = this.permissions.find(function (p) {
        return p.product === productSlug;
      });
      if (!match) return false;
      if (!allowedRoles || !allowedRoles.length) return true;
      return allowedRoles.indexOf(match.role) !== -1;
    },

    /**
     * Sign out the user. POSTs to /api/auth/signout (clears cookie),
     * then redirects to the signin page.
     */
    signOut: function () {
      fetch(SIGNOUT_URL, {
        method: 'POST',
        credentials: 'include'
      })
        .catch(function () {})
        .finally(function () {
          window.location.href = SIGNIN_URL;
        });
    },

    /**
     * Force a fresh fetch of the session (e.g. after granting permissions
     * to oneself in the Identity Console). Resolves with the new state.
     */
    refresh: function () {
      return resolveSession(true);
    }
  };

  window.tgAuth = tgAuth;

  /**
   * Build the URL to send the user to for sign-in, with a `next` param
   * pointing back at the current full URL.
   */
  function buildSigninUrl(reason) {
    var here = window.location.href;
    var qs = '?next=' + encodeURIComponent(here);
    if (reason) qs += '&reason=' + encodeURIComponent(reason);
    return SIGNIN_URL + qs;
  }

  /**
   * Bounce to signin. Used when the cookie is missing or the session
   * has expired/been revoked.
   */
  function redirectToSignin(reason) {
    window.location.href = buildSigninUrl(reason);
  }

  /**
   * If the user is signed in but doesn't have the required product
   * permission, show a "no access" page rather than bouncing.
   * Better UX than an infinite redirect loop.
   */
  function showNoAccess(productSlug) {
    document.documentElement.innerHTML =
      '<head><title>No access</title>' +
      '<meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<style>' +
      'body{font-family:-apple-system,system-ui,sans-serif;background:#f8fafc;' +
      'color:#0f172a;margin:0;min-height:100vh;display:flex;align-items:center;' +
      'justify-content:center;padding:24px}' +
      '.box{background:#fff;border-radius:16px;box-shadow:0 1px 3px rgba(0,0,0,.06),' +
      '0 12px 32px rgba(0,0,0,.06);padding:40px;max-width:480px;width:100%;text-align:center}' +
      'h1{font-size:22px;margin:0 0 8px;font-weight:700}' +
      'p{color:#475569;line-height:1.6;margin:0 0 8px;font-size:15px}' +
      '.muted{color:#94a3b8;font-size:13px;margin-top:24px}' +
      '.btn{display:inline-block;margin-top:20px;padding:10px 20px;' +
      'background:#0ABAB5;color:#fff;text-decoration:none;border-radius:10px;' +
      'font-weight:600;font-size:14px}' +
      '.btn:hover{background:#089693}' +
      '.btn-ghost{background:transparent;color:#475569;border:1px solid #e2e8f0;margin-left:8px}' +
      '</style></head>' +
      '<body><div class="box">' +
      '<h1>You don\'t have access to this product</h1>' +
      '<p>You\'re signed in, but your account hasn\'t been granted access to ' +
      '<strong>' + escapeHtml(productSlug) + '</strong>.</p>' +
      '<p>If you think this is a mistake, contact your account manager.</p>' +
      '<a class="btn" href="' + ID_HOST + '">Back to dashboard</a>' +
      '<a class="btn btn-ghost" href="javascript:tgAuth.signOut()">Sign out</a>' +
      '<div class="muted">Signed in as ' + escapeHtml(tgAuth.user && tgAuth.user.email || '') + '</div>' +
      '</div></body>';
  }

  function escapeHtml(s) {
    return String(s || '').replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /**
   * Hit /api/auth/me and resolve the session. Sends the cookie via
   * credentials:'include'.
   *
   * @returns {Promise<boolean>} true if signed in, false otherwise.
   */
  function resolveSession(force) {
    return fetch(ME_URL + (force ? '?_=' + Date.now() : ''), {
      method: 'GET',
      credentials: 'include',
      cache: 'no-store'
    })
      .then(function (r) {
        if (r.status === 401) return null;
        if (!r.ok) throw new Error('me_failed_' + r.status);
        return r.json();
      })
      .then(function (data) {
        if (!data || !data.ok) return false;

        tgAuth.user = data.user || null;
        tgAuth.client = data.client || null;
        tgAuth.permissions = data.permissions || [];

        // Resolve role for the requested product (if any)
        if (requiredProduct && requiredProduct !== '*') {
          var p = tgAuth.permissions.find(function (x) {
            return x.product === requiredProduct;
          });
          tgAuth.role = p ? p.role : null;
        } else {
          tgAuth.role = null;
        }

        tgAuth.ready = true;
        return true;
      });
  }

  /**
   * Bootstrap: resolve the session, then either fire 'tg-auth-ready'
   * or redirect to signin / show no-access.
   */
  resolveSession()
    .then(function (signedIn) {
      if (!signedIn) {
        redirectToSignin('signed_out');
        return;
      }
      // Signed in. Now check product permission if one was specified.
      if (requiredProduct && requiredProduct !== '*') {
        if (!tgAuth.role) {
          showNoAccess(requiredProduct);
          return;
        }
      }
      // All good — let the page know it can render.
      try {
        window.dispatchEvent(new CustomEvent('tg-auth-ready', { detail: tgAuth }));
      } catch (e) {
        // IE fallback (extremely unlikely to be needed)
        var ev = document.createEvent('Event');
        ev.initEvent('tg-auth-ready', true, true);
        window.dispatchEvent(ev);
      }
    })
    .catch(function (err) {
      // Network error or unexpected response — bounce to signin so the
      // user can retry from a known good state.
      console.error('[tg-auth-gate] resolve failed', err);
      redirectToSignin('error');
    });
})();
