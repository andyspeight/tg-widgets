/**
 * Client-side auth helper used by the dashboard and any signed-in widget editor.
 *
 * Usage:
 *   import { tgAuth } from '/auth-client.js';
 *
 *   const me = await tgAuth.requireSignedIn();   // redirects to /signin if not
 *   await tgAuth.fetchAuth('/api/something');    // adds Authorization header
 *   await tgAuth.signOut();                      // revokes server session, clears local
 *
 * On 401 from any auth-aware fetch, the helper clears local state and
 * redirects to /signin?next=<current-path>.
 */

(function (global) {
  const KEYS = {
    token:  'tg_token',
    user:   'tg_user',
    client: 'tg_client'
  };

  function getToken() {
    try { return localStorage.getItem(KEYS.token) || ''; } catch { return ''; }
  }

  function getUser() {
    try { return JSON.parse(localStorage.getItem(KEYS.user) || 'null'); } catch { return null; }
  }

  function getClient() {
    try { return JSON.parse(localStorage.getItem(KEYS.client) || 'null'); } catch { return null; }
  }

  function clearLocal() {
    try {
      localStorage.removeItem(KEYS.token);
      localStorage.removeItem(KEYS.user);
      localStorage.removeItem(KEYS.client);
    } catch {}
  }

  function redirectToSignin() {
    const next = encodeURIComponent(location.pathname + location.search);
    location.href = '/signin?next=' + next;
  }

  /**
   * Wrapped fetch that adds the Authorization header and handles 401 by
   * clearing local state and redirecting to sign-in.
   */
  async function fetchAuth(input, init) {
    const token = getToken();
    const headers = new Headers((init && init.headers) || {});
    if (token) headers.set('Authorization', 'Bearer ' + token);
    if (init && init.body && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }
    const res = await fetch(input, { ...(init || {}), headers });
    if (res.status === 401) {
      clearLocal();
      redirectToSignin();
      // Throw so the caller doesn't accidentally use the response
      throw new Error('Unauthorised');
    }
    return res;
  }

  /**
   * Verify the token is still valid by hitting /api/auth/me.
   * Returns the { user, client } payload on success, or redirects to /signin.
   */
  async function requireSignedIn() {
    if (!getToken()) {
      redirectToSignin();
      throw new Error('Not signed in');
    }
    const res = await fetchAuth('/api/auth/me');
    const data = await res.json().catch(() => ({}));
    if (!data.ok) {
      clearLocal();
      redirectToSignin();
      throw new Error('Auth check failed');
    }
    // Refresh local cache from server truth
    try {
      localStorage.setItem(KEYS.user, JSON.stringify(data.user || {}));
      if (data.client) localStorage.setItem(KEYS.client, JSON.stringify(data.client));
    } catch {}
    return { user: data.user, client: data.client };
  }

  /**
   * Sign out: revokes the server session, clears local, redirects.
   */
  async function signOut() {
    try {
      await fetchAuth('/api/auth/signout', { method: 'POST' });
    } catch { /* ignore — we're signing out anyway */ }
    clearLocal();
    location.href = '/signin';
  }

  /**
   * Sign out everywhere: revokes all server sessions for this user.
   */
  async function signOutAll() {
    try {
      await fetchAuth('/api/auth/signout-all', { method: 'POST' });
    } catch {}
    clearLocal();
    location.href = '/signin';
  }

  global.tgAuth = {
    getToken, getUser, getClient,
    fetchAuth, requireSignedIn,
    signOut, signOutAll,
    clearLocal
  };
})(typeof window !== 'undefined' ? window : globalThis);
