# Appointment Scheduler — calendar OAuth setup

This is the backend that turns the Appointment Scheduler into a full booking
suite: real Google Calendar availability (no double-booking), a calendar event
created for every booking with an invite to the visitor, and working
reschedule and cancel links.

Built 13 June 2026. Logic is smoke-tested. The live Google round-trip is the
Monday job because it needs real OAuth credentials and a real calendar.

## What was built

Endpoints (Vercel serverless, file-routed):

- `GET  /api/calendar/connect` — starts Google OAuth for the signed-in client.
- `GET  /api/calendar/callback` — stores the encrypted refresh token.
- `GET  /api/calendar/status` — is this client connected (used by the editor).
- `POST /api/calendar/disconnect` — drop the connection.
- `GET  /api/appointment/availability?widgetId=&eventId=&from=&to=` — public,
  returns bookable slots with real busy time subtracted when connected.
- `POST /api/appointment/book` — public, books a slot, creates the calendar
  event, persists the booking, emails the agency, returns a manage link.
- `GET/POST /api/appointment/manage` — view, cancel or reschedule by token.

Shared libraries in `api/_lib/calendar/`: `google.js` (provider), `store.js`
(Redis + encrypted tokens), `slots.js` (availability maths, mirrors the
widget), `state.js` (signed OAuth state, booking refs, widget lookup).

Front end: the widget uses the backend automatically when it has a saved id;
the editor has a "Your calendar" connect panel; `/manage-booking` is the
visitor's reschedule/cancel page.

## Required environment variables (Vercel → Settings → Environment Variables)

| Var | Purpose | Notes |
|-----|---------|-------|
| `GOOGLE_CLIENT_ID` | OAuth client id | from Google Cloud console |
| `GOOGLE_CLIENT_SECRET` | OAuth client secret | same |
| `TG_ENCRYPTION_KEY` | AES key for refresh tokens | 64 hex chars. Generate: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. May already be set (shared with client-integrations). |
| `UPSTASH_REDIS_REST_URL` | booking + connection store | already used by the world map cache |
| `UPSTASH_REDIS_REST_TOKEN` | "" | "" |
| `SENDGRID_API_KEY` | agency notification email | already set |
| `TG_OAUTH_STATE_SECRET` | optional | falls back to `TG_ENCRYPTION_KEY` |

Without `UPSTASH_*` the scheduler still works as a request form and emails the
agency, but bookings are not persisted, so there are no manage links and no
double-booking guard. Set Redis for the full suite.

## Google Cloud console steps

1. Create (or reuse) a project, enable the **Google Calendar API**.
2. OAuth consent screen: External, add the scopes
   `calendar.events` and `calendar.readonly`, plus `openid` and `email`.
   While testing, add the agent emails as test users (or publish the app).
3. Credentials → Create credentials → OAuth client ID → Web application.
4. Authorized redirect URIs — add one per host you test on:
   - `https://widgets.travelify.io/api/calendar/callback`
   - `https://tg-widgets.vercel.app/api/calendar/callback`
   - the current Vercel preview URL's `/api/calendar/callback`
5. Copy the client id and secret into the Vercel env vars above.

## Monday test pass

1. Open `/editor-appointment`, Settings → Your calendar → Connect Google
   Calendar. Complete consent. You should return with "Calendar connected".
2. Put a busy event in that calendar, reload the widget preview / demo, and
   confirm the overlapping time disappears.
3. Book a slot on `/demo-appointment` (use a saved widget id so it runs in
   backend mode). Confirm: event appears in the calendar, the visitor gets the
   invite, the agency gets the email, the confirmation shows a manage link.
4. Open the manage link: cancel removes the calendar event; reschedule moves it.

## Honest limits (post-Monday)

- Google only for now. Outlook/Microsoft is the same shape via Microsoft Graph
  and would slot in behind the provider abstraction in `api/_lib/calendar/`.
- One availability schedule per client (the widget config), not per calendar.
- Reminders use the calendar's own defaults; no separate reminder emails yet.
