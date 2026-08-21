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
| `GOOGLE_CLIENT_ID` | Google OAuth client id | from Google Cloud console |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret | same |
| `MS_CLIENT_ID` | Outlook/Microsoft app id | from Azure AD (optional, enables Outlook) |
| `MS_CLIENT_SECRET` | Outlook/Microsoft client secret | same |
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

## Outlook / Microsoft 365 setup (optional second provider)

Both providers share one callback and one connection store; the editor shows a
Connect button for each provider whose credentials are set.

1. Azure Portal → App registrations → New registration. Supported account
   types: "Accounts in any organizational directory and personal Microsoft
   accounts" (so work and personal both connect).
2. Redirect URI (Web): `https://<your-host>/api/calendar/callback` — add one
   per host, same as Google.
3. API permissions → Microsoft Graph → Delegated → `Calendars.ReadWrite`
   (and `offline_access`, `openid`, `email`). Grant admin consent if required.
4. Certificates & secrets → new client secret. Copy the value.
5. Set `MS_CLIENT_ID` (the Application/client id) and `MS_CLIENT_SECRET` in
   Vercel.

Microsoft free/busy uses Graph `calendarView` (events shown as busy, tentative
or out-of-office block a slot); events are created on the user's default
calendar and Graph emails the invitee.

## Hardening (public endpoint defences)

The scheduler's public endpoints are rate limited via the existing Upstash
limiter (`api/_lib/auth/ratelimit.js`), all fail-open so a Redis blip never
blocks a real booking on the stand:

- `book` — 8 per 10 min per IP (it creates calendar events + sends mail).
- `manage` POST — 12 per 10 min per manage token (a leaked link can't spam
  cancel/reschedule emails).
- `admin-action` — 60 per 10 min per signed-in user.

Other defences already in place: honeypot + time-trap on `book`; visitor
answers bounded (≤20 fields, ≤80-char keys, ≤500-char values, control
characters stripped); all single-line fields stripped of control characters
(no CR/LF into emails, .ics or logs); HMAC-signed, timing-safe, TTL'd OAuth
state and unguessable 192-bit manage tokens; server-side slot revalidation on
every booking; Airtable formula inputs escaped; agency list scoped to the
caller's own client and `admin-action` ownership-checked.

## Monday test pass

1. Open `/editor-appointment`, Settings → Your calendar → Connect Google
   Calendar. Complete consent. You should return with "Calendar connected".
2. Put a busy event in that calendar, reload the widget preview / demo, and
   confirm the overlapping time disappears.
3. Book a slot on `/demo-appointment` (use a saved widget id so it runs in
   backend mode). Confirm: event appears in the calendar, the visitor gets the
   invite, the agency gets the email, the confirmation shows a manage link.
4. Open the manage link: cancel removes the calendar event; reschedule moves it.

## Added after the first build (same weekend)

- **Email lifecycle**: visitor confirmation, reschedule and cancellation
  emails, each with a proper `.ics` attachment, plus an agency notification.
  Works with or without a connected calendar (uses `SENDGRID_API_KEY`).
- **Buffers**: before/after gaps kept clear around each booking.
- **Split daily hours**: multiple time ranges per weekday (e.g. a lunch gap).
- **Daily booking cap**: max bookings per day, enforced in availability and
  at book time, decremented on cancel and moved on reschedule.
- **Reminders cron**: `/api/cron/appointment-reminders` (hourly in
  `vercel.json`) emails reminders per the widget's configurable plan
  (`config.reminders`, up to three offsets 1–72h before; default one at 24h;
  editor: Settings → Reminder emails). The plan is stamped onto each booking
  at create time (`_lib/calendar/reminders.js`); a reschedule re-arms it for
  the new time. Needs `CRON_SECRET` set (same secret the map cron uses).
  Optional `APP_BASE_URL` for the manage link in reminder emails (otherwise
  derived from the host).
- **Agency view + actions**: `/bookings` page and `GET /api/appointment/list`
  (auth) show the client's upcoming and recent bookings, and let the agency
  cancel or reschedule one (`POST /api/appointment/admin-action`, ownership
  checked). Reschedule reuses the scheduler in an admin mode; cancel/reschedule
  share one code path with the visitor flow (`_lib/calendar/actions.js`).

These all rely on `UPSTASH_*`. Without Redis they no-op cleanly.

## Honest limits (post-Monday)

- Google and Outlook/Microsoft are both supported (behind the provider
  registry in `api/_lib/calendar/providers.js`). A client connects one
  calendar; the connection records which provider.
- One availability schedule per client (the widget config), not per calendar.

## Added 21 Aug 2026 (Calendly gap, Tier 1)

- **Configurable reminders**: up to two editor-set offsets (config supports
  three), stamped per booking, re-armed on reschedule. See the cron note above.
- **Display modes**: `config.displayMode` `inline` (default) / `popup`
  (launcher button) / `bubble` (floating corner button). Popup and bubble open
  the scheduler in an accessible overlay (Escape, backdrop click, focus trap);
  same embed code for all three.
- **Date-specific hours**: `config.dateOverrides` maps `YYYY-MM-DD` to time
  ranges that REPLACE the weekly hours on that date (blackouts still close a
  day outright). Implemented identically in `slots.js` and the widget.
- **Slot interval + half-hour boundaries** now exposed in the editor.
- **Bookings admin**: `/bookings` gained search, a status filter, CSV export
  (formula-injection safe) and the source page each booking came from
  (`sourceUrl` now returned by `GET /api/appointment/list`).

## Added 21 Aug 2026, round 2

- **Lead routing**: every booking now also dispatches through the unified
  lead router (`bookingToLead` in `api/appointment/book.js`) — a Submissions
  record plus whatever destinations the client configured, exactly like
  Popup leads. Best-effort: routing can never fail a booking. `'appointment'`
  joined `KNOWN_WIDGETS`; `resolveWidget` now returns the widget row's own
  `recordId` (the router's key) and `clientName`.
- **AI builder + Templates**: live in the editor. `APPOINTMENT` is a
  passthrough type on `/api/widget-ai` (the editor owns the instruction and
  schema and clamps the result onto the config); four templates patch copy,
  meeting types and questions while leaving colours, font, availability and
  the calendar connection alone.
- **SMS reminders (dark-launched)**: `api/_lib/calendar/sms.js` sends via the
  Twilio REST API once `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` and
  `TWILIO_FROM` exist in Vercel env. Per-widget opt-in `config.smsReminders`
  (editor: Reminder emails → "Also send a text reminder"; the hint reflects
  `/api/calendar/status`'s new `sms` flag). Texts ride the email reminder
  cadence, UK numbers are normalised to E.164 and anything ambiguous is
  skipped rather than guessed. Until the env vars exist everything no-ops.
