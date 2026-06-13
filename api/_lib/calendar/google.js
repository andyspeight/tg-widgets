/**
 * Google Calendar provider for the Appointment Scheduler.
 *
 * Thin fetch wrappers around Google OAuth 2.0 and the Calendar v3 API:
 * consent URL, code exchange, token refresh, free/busy query, and event
 * create / patch / delete. No SDK — keeps the serverless bundle tiny.
 *
 * Env required (set in Vercel):
 *   GOOGLE_CLIENT_ID
 *   GOOGLE_CLIENT_SECRET
 * The redirect URI is derived from the request host by the endpoints, so it
 * does not need an env var, but every redirect URI you use must be added to
 * the OAuth client's "Authorized redirect URIs" in the Google Cloud console:
 *   https://<your-host>/api/calendar/callback
 *
 * Scopes: openid + email (to label the connection) and calendar.events +
 * calendar.readonly (to read free/busy and create the booking event).
 */

export const PROVIDER = 'google';
export const SCOPES = [
  'openid',
  'email',
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar.readonly',
].join(' ');

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const USERINFO_URL = 'https://www.googleapis.com/oauth2/v3/userinfo';
const CAL_BASE = 'https://www.googleapis.com/calendar/v3';

export function configured() {
  return !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

export function authUrl(state, redirectUri) {
  const p = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID || '',
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: SCOPES,
    access_type: 'offline',
    include_granted_scopes: 'true',
    prompt: 'consent',           // force a refresh_token every time
    state,
  });
  return AUTH_URL + '?' + p.toString();
}

async function tokenRequest(body) {
  const r = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body).toString(),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error('google_token_' + r.status + ' ' + (j.error || ''));
  return j;
}

export async function exchangeCode(code, redirectUri) {
  return tokenRequest({
    code,
    client_id: process.env.GOOGLE_CLIENT_ID,
    client_secret: process.env.GOOGLE_CLIENT_SECRET,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
  });
}

export async function refresh(refreshToken) {
  return tokenRequest({
    refresh_token: refreshToken,
    client_id: process.env.GOOGLE_CLIENT_ID,
    client_secret: process.env.GOOGLE_CLIENT_SECRET,
    grant_type: 'refresh_token',
  });
}

export async function userEmail(accessToken) {
  try {
    const r = await fetch(USERINFO_URL, { headers: { Authorization: 'Bearer ' + accessToken } });
    if (!r.ok) return '';
    const j = await r.json();
    return j.email || '';
  } catch (e) { return ''; }
}

/**
 * Returns an array of { start, end } ISO busy intervals for `calendarId`
 * between timeMin and timeMax (ISO strings).
 */
export async function freeBusy(accessToken, calendarId, timeMin, timeMax) {
  const r = await fetch(CAL_BASE + '/freeBusy', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + accessToken, 'Content-Type': 'application/json' },
    body: JSON.stringify({ timeMin, timeMax, items: [{ id: calendarId || 'primary' }] }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error('google_freebusy_' + r.status);
  const cal = j.calendars && j.calendars[calendarId || 'primary'];
  return (cal && Array.isArray(cal.busy)) ? cal.busy : [];
}

export async function insertEvent(accessToken, calendarId, event) {
  const r = await fetch(CAL_BASE + '/calendars/' + encodeURIComponent(calendarId || 'primary') + '/events?sendUpdates=all&conferenceDataVersion=0', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + accessToken, 'Content-Type': 'application/json' },
    body: JSON.stringify(event),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error('google_insert_' + r.status + ' ' + (j.error && j.error.message || ''));
  return { id: j.id, htmlLink: j.htmlLink };
}

export async function patchEvent(accessToken, calendarId, eventId, patch) {
  const r = await fetch(CAL_BASE + '/calendars/' + encodeURIComponent(calendarId || 'primary') + '/events/' + encodeURIComponent(eventId) + '?sendUpdates=all', {
    method: 'PATCH',
    headers: { Authorization: 'Bearer ' + accessToken, 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error('google_patch_' + r.status);
  return { id: j.id, htmlLink: j.htmlLink };
}

export async function deleteEvent(accessToken, calendarId, eventId) {
  const r = await fetch(CAL_BASE + '/calendars/' + encodeURIComponent(calendarId || 'primary') + '/events/' + encodeURIComponent(eventId) + '?sendUpdates=all', {
    method: 'DELETE',
    headers: { Authorization: 'Bearer ' + accessToken },
  });
  // 410 = already gone, treat as success
  if (!r.ok && r.status !== 410 && r.status !== 404) throw new Error('google_delete_' + r.status);
  return true;
}
