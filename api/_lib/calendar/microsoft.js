/**
 * Microsoft (Outlook / Microsoft 365) calendar provider via Microsoft Graph.
 *
 * Same interface as google.js so the rest of the scheduler is provider-neutral:
 * authUrl, exchangeCode, refresh, userEmail, freeBusy, insertEvent, patchEvent,
 * deleteEvent. The provider-neutral event shape (the one book.js builds, which
 * matches Google's) is translated to Graph's shape here.
 *
 * Env required (set in Vercel):
 *   MS_CLIENT_ID
 *   MS_CLIENT_SECRET
 * Azure AD app registration: add the redirect URI https://<host>/api/calendar/callback
 * and the delegated Graph permission Calendars.ReadWrite (offline_access is
 * requested for a refresh token). Multi-tenant + personal: uses the /common
 * authority so both work/school and personal Microsoft accounts can connect.
 */

export const PROVIDER = 'microsoft';
export const SCOPES = ['openid', 'email', 'offline_access', 'https://graph.microsoft.com/Calendars.ReadWrite'].join(' ');

const AUTHORITY = 'https://login.microsoftonline.com/common/oauth2/v2.0';
const GRAPH = 'https://graph.microsoft.com/v1.0';

export function configured() {
  return !!(process.env.MS_CLIENT_ID && process.env.MS_CLIENT_SECRET);
}

export function authUrl(state, redirectUri) {
  const p = new URLSearchParams({
    client_id: process.env.MS_CLIENT_ID || '',
    response_type: 'code',
    redirect_uri: redirectUri,
    response_mode: 'query',
    scope: SCOPES,
    state,
    prompt: 'select_account',
  });
  return AUTHORITY + '/authorize?' + p.toString();
}

async function tokenRequest(body) {
  const r = await fetch(AUTHORITY + '/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body).toString(),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error('ms_token_' + r.status + ' ' + (j.error || ''));
  return j;
}

export async function exchangeCode(code, redirectUri) {
  return tokenRequest({
    client_id: process.env.MS_CLIENT_ID,
    client_secret: process.env.MS_CLIENT_SECRET,
    code, redirect_uri: redirectUri, grant_type: 'authorization_code', scope: SCOPES,
  });
}

export async function refresh(refreshToken) {
  return tokenRequest({
    client_id: process.env.MS_CLIENT_ID,
    client_secret: process.env.MS_CLIENT_SECRET,
    refresh_token: refreshToken, grant_type: 'refresh_token', scope: SCOPES,
  });
}

export async function userEmail(accessToken) {
  try {
    const r = await fetch(GRAPH + '/me?$select=mail,userPrincipalName', { headers: { Authorization: 'Bearer ' + accessToken } });
    if (!r.ok) return '';
    const j = await r.json();
    return j.mail || j.userPrincipalName || '';
  } catch (e) { return ''; }
}

/** Graph wants a zone-less wall time + a timeZone; we give it UTC, unambiguously. */
export function toGraphDateTime(iso) {
  const d = new Date(iso); const p = (n) => String(n).padStart(2, '0');
  return { dateTime: d.getUTCFullYear() + '-' + p(d.getUTCMonth() + 1) + '-' + p(d.getUTCDate()) + 'T' + p(d.getUTCHours()) + ':' + p(d.getUTCMinutes()) + ':00', timeZone: 'UTC' };
}

/** Translate the provider-neutral event (Google-shaped) into a Graph event. */
export function toGraphEvent(ev) {
  const out = {
    subject: ev.summary || 'Appointment',
    body: { contentType: 'text', content: ev.description || '' },
    start: toGraphDateTime(ev.start && ev.start.dateTime),
    end: toGraphDateTime(ev.end && ev.end.dateTime),
  };
  if (ev.location) out.location = { displayName: String(ev.location) };
  if (Array.isArray(ev.attendees) && ev.attendees.length) {
    out.attendees = ev.attendees.map(a => ({ emailAddress: { address: a.email, name: a.displayName || a.email }, type: 'required' }));
  }
  // _conference (truthy) asks Graph to provision a Teams meeting for the event.
  if (ev._conference) {
    out.isOnlineMeeting = true;
    out.onlineMeetingProvider = 'teamsForBusiness';
  }
  return out;
}

const BUSY_STATES = new Set(['busy', 'tentative', 'oof']);

export async function freeBusy(accessToken, calendarId, timeMin, timeMax) {
  // List events in the window via calendarView (UTC), treat busy/tentative/oof as busy.
  const url = GRAPH + '/me/calendarView?startDateTime=' + encodeURIComponent(timeMin) + '&endDateTime=' + encodeURIComponent(timeMax) +
    '&$select=start,end,showAs&$top=200';
  const r = await fetch(url, { headers: { Authorization: 'Bearer ' + accessToken, Prefer: 'outlook.timezone="UTC"' } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error('ms_calendarview_' + r.status);
  const items = Array.isArray(j.value) ? j.value : [];
  return items
    .filter(e => !e.showAs || BUSY_STATES.has(String(e.showAs).toLowerCase()))
    .map(e => ({ start: e.start && e.start.dateTime ? e.start.dateTime + 'Z' : null, end: e.end && e.end.dateTime ? e.end.dateTime + 'Z' : null }))
    .filter(b => b.start && b.end);
}

/**
 * The upcoming diary: events between timeMin and timeMax, soonest first,
 * normalised to { id, title, startISO, endISO, allDay, link } — the same
 * shape google.js returns, so the agenda endpoint stays provider-neutral.
 */
export async function listEvents(accessToken, calendarId, timeMin, timeMax) {
  const url = GRAPH + '/me/calendarView?startDateTime=' + encodeURIComponent(timeMin) + '&endDateTime=' + encodeURIComponent(timeMax) +
    '&$orderby=start/dateTime&$top=25&$select=id,subject,start,end,isAllDay,webLink,isCancelled';
  const r = await fetch(url, { headers: { Authorization: 'Bearer ' + accessToken, Prefer: 'outlook.timezone="UTC"' } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error('ms_calendarview_' + r.status);
  return (Array.isArray(j.value) ? j.value : [])
    .filter(e => e && !e.isCancelled)
    .map(e => ({
      id: e.id,
      title: e.subject || '(no title)',
      startISO: e.start && e.start.dateTime ? (/[zZ]$/.test(e.start.dateTime) ? e.start.dateTime : e.start.dateTime + 'Z') : '',
      endISO: e.end && e.end.dateTime ? (/[zZ]$/.test(e.end.dateTime) ? e.end.dateTime : e.end.dateTime + 'Z') : '',
      allDay: !!e.isAllDay,
      link: e.webLink || '',
    }))
    .filter(e => e.startISO);
}

export async function insertEvent(accessToken, calendarId, event) {
  const r = await fetch(GRAPH + '/me/events', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + accessToken, 'Content-Type': 'application/json' },
    body: JSON.stringify(toGraphEvent(event)),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error('ms_insert_' + r.status + ' ' + (j.error && j.error.message || ''));
  return {
    id: j.id,
    htmlLink: j.webLink || '',
    meetingUrl: (j.onlineMeeting && j.onlineMeeting.joinUrl) || '',
  };
}

export async function patchEvent(accessToken, calendarId, eventId, patch) {
  const body = {};
  if (patch.start && patch.start.dateTime) body.start = toGraphDateTime(patch.start.dateTime);
  if (patch.end && patch.end.dateTime) body.end = toGraphDateTime(patch.end.dateTime);
  const r = await fetch(GRAPH + '/me/events/' + encodeURIComponent(eventId), {
    method: 'PATCH',
    headers: { Authorization: 'Bearer ' + accessToken, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error('ms_patch_' + r.status);
  return { id: j.id, htmlLink: j.webLink || '' };
}

export async function deleteEvent(accessToken, calendarId, eventId) {
  const r = await fetch(GRAPH + '/me/events/' + encodeURIComponent(eventId), {
    method: 'DELETE', headers: { Authorization: 'Bearer ' + accessToken },
  });
  if (!r.ok && r.status !== 404 && r.status !== 410) throw new Error('ms_delete_' + r.status);
  return true;
}
