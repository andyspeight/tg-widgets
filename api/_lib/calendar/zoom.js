/**
 * Zoom integration for the Appointment Scheduler — Calendly-parity video
 * meetings: each booking creates a REAL scheduled Zoom meeting with its own
 * join link, updated on reschedule and removed on cancel.
 *
 * Server setup (one-off): create a "General App" (user-managed OAuth) in the
 * Zoom App Marketplace, set the redirect URL to
 *   https://widgets.travelify.io/api/calendar/callback
 * grant the scopes meeting:write:meeting + user:read:user (classic apps:
 * meeting:write + user:read), then set ZOOM_CLIENT_ID and ZOOM_CLIENT_SECRET
 * in Vercel.
 *
 * IMPORTANT Zoom quirk: the refresh token ROTATES on every refresh. The store
 * persists the replacement each time (see getZoomAccessToken) — losing it
 * kills the connection.
 */

const AUTH_BASE = 'https://zoom.us/oauth';
const API_BASE = 'https://api.zoom.us/v2';

export const PROVIDER = 'zoom';

export function configured() {
  return !!(process.env.ZOOM_CLIENT_ID && process.env.ZOOM_CLIENT_SECRET);
}

function basicAuth() {
  return 'Basic ' + Buffer.from(process.env.ZOOM_CLIENT_ID + ':' + process.env.ZOOM_CLIENT_SECRET).toString('base64');
}

export function authUrl(state, redirectUri) {
  const q = new URLSearchParams({
    response_type: 'code',
    client_id: process.env.ZOOM_CLIENT_ID,
    redirect_uri: redirectUri,
    state,
  });
  return AUTH_BASE + '/authorize?' + q.toString();
}

async function tokenCall(params) {
  const r = await fetch(AUTH_BASE + '/token', {
    method: 'POST',
    headers: { Authorization: basicAuth(), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString(),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error('zoom_token_' + r.status + ' ' + (j.reason || j.error || ''));
  return j;
}

export async function exchangeCode(code, redirectUri) {
  return tokenCall({ grant_type: 'authorization_code', code, redirect_uri: redirectUri });
}

export async function refresh(refreshToken) {
  return tokenCall({ grant_type: 'refresh_token', refresh_token: refreshToken });
}

export async function userEmail(accessToken) {
  try {
    const r = await fetch(API_BASE + '/users/me', { headers: { Authorization: 'Bearer ' + accessToken } });
    const j = await r.json().catch(() => ({}));
    return (r.ok && j.email) || '';
  } catch (e) { return ''; }
}

/** Zoom wants UTC as yyyy-MM-ddTHH:mm:ssZ (no milliseconds). */
function zoomStamp(iso) {
  return new Date(iso).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/**
 * Create a scheduled meeting on the connected account.
 * Returns { id, join_url } — join_url is what travels to the customer.
 */
export async function createMeeting(accessToken, { topic, startISO, durationMins, timezone, agenda }) {
  const r = await fetch(API_BASE + '/users/me/meetings', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + accessToken, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      topic: String(topic || 'Appointment').slice(0, 190),
      type: 2, // scheduled
      start_time: zoomStamp(startISO),
      duration: Math.max(5, Math.min(480, Number(durationMins) || 30)),
      timezone: timezone || 'UTC',
      agenda: String(agenda || '').slice(0, 250),
      settings: { waiting_room: true, join_before_host: false },
    }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error('zoom_create_' + r.status + ' ' + (j.message || ''));
  return { id: j.id, join_url: j.join_url || '' };
}

/** Move a meeting to a new time. 204 on success; 404 tolerated (gone). */
export async function updateMeeting(accessToken, meetingId, { startISO, durationMins, timezone }) {
  const r = await fetch(API_BASE + '/meetings/' + encodeURIComponent(meetingId), {
    method: 'PATCH',
    headers: { Authorization: 'Bearer ' + accessToken, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      start_time: zoomStamp(startISO),
      duration: Math.max(5, Math.min(480, Number(durationMins) || 30)),
      timezone: timezone || 'UTC',
    }),
  });
  if (!r.ok && r.status !== 404) throw new Error('zoom_update_' + r.status);
  return true;
}

/** Delete a meeting. 404 tolerated — already gone is the desired state. */
export async function deleteMeeting(accessToken, meetingId) {
  const r = await fetch(API_BASE + '/meetings/' + encodeURIComponent(meetingId) + '?schedule_for_reminder=false', {
    method: 'DELETE',
    headers: { Authorization: 'Bearer ' + accessToken },
  });
  if (!r.ok && r.status !== 404) throw new Error('zoom_delete_' + r.status);
  return true;
}
