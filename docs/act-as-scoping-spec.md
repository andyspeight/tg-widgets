# Scoped "act as client" — design spec for sign-off

Status: DRAFT for Andy to approve before any build.
Date: 9 July 2026.
Owner: Andy Speight. Author: Claude Code session.

This is a design document, not shipped code. It describes how to move "act as
client" from a whole-login switch to a scoped, per-tool impersonation, so that
acting as a client in one tool can never silently change another tool (the
calendar incident, July 2026). It also lists every place that has to change,
including tools that may live in other repos.

The loud interim safety banner described at the end is already live (shipped 9
July 2026). This spec is about the real fix that comes after it.

---

## 1. What happens today

"Act as client" is one endpoint: `POST /api/auth/switch-client`.

When a Travelgenix staff member picks a client to act as, that endpoint:

1. mints a brand new `tg_session` JWT whose `clientId` is the target client,
2. revokes all of the staff member's other sessions,
3. sets the new cookie on `.travelify.io`.

The `tg_session` cookie is the single shared sign-in for every tool on
`*.travelify.io` (the SSO cookie). `requireAuth` in
`api/_lib/auth/middleware.js` reads the client from that cookie for every
request, and for staff it honours whatever `clientId` the cookie carries.

So the model is: one session, one "current client", shared by every tool. The
moment you act as a client, every tool that reads the cookie flips to that
client at once. There is no per-tool scope. That is the whole bug.

Concretely, while acting as Cypher Travel:

- the scheduler drawer and the appointment editor read the session, so they
  showed Cypher's Google diary, not Andy's,
- the account header still showed Andy's name (that comes from the user, not
  the client), so the drawer read as "these are not my meetings",
- the contact engine, the widget dashboard and any other tool would have
  flipped the same way.

## 2. What we want

Andy's words: "it should only change the one tool I'm acting as a client for."

Goal: acting as a client applies only in the tool (and tab) where the staff
member turned it on. Every other tool and tab stays as the real staff member.
The default everywhere is always "myself". Impersonation is an explicit,
visible, temporary overlay, never a silent global state.

Non goals: we are not changing how a genuine multi company MEMBER switches
between their own companies. That is a real membership, not impersonation, and
a shared "current company" is fine for it. This spec is only about staff acting
as a client they are not a member of.

## 3. Recommended design (Option A: real identity always, per-tab overlay)

Keep the base session cookie as the real staff user at all times. Never
re-mint it to the client. Impersonation becomes a short lived, signed grant
that the acting tool presents on each request. Tools that do not present it see
the real staff user, which is the safe default.

### 3.1 The pieces

1. Base session unchanged in identity. The `tg_session` cookie always
   represents the real signed-in staff member. Acting as a client never
   rewrites it. This alone removes the silent global flip.

2. Act-as grant. A new endpoint `POST /api/auth/act-as/start` (staff only,
   origin checked, rate limited, audited) validates that the caller is staff
   and the target client is live, then returns a short lived signed grant:
   `{ staffUserId, targetClientId, issuedAt }`, with an idle timeout (say 30
   minutes) and an absolute cap. `POST /api/auth/act-as/stop` ends it.

3. Per-tab transport. The acting tool stores the grant in that tab's
   `sessionStorage` (so a new tab or a different tool starts clean) and attaches
   it on its API calls as a header, for example `X-TG-Act-As: <grant>`. A
   header, not a cookie, is deliberate: a cookie is shared across tabs and
   subdomains, which is exactly the bleed we are removing. The header is sent
   only by the tool the staff member chose to act inside.

4. Resolution in `requireAuth`. Always resolve the real user from the cookie
   first. Then, only if a valid `X-TG-Act-As` grant is present, the user is
   staff, and the target is live, apply the overlay: set
   `ctx.clientRecordId = target`, and add `ctx.actingAs = { realUserId, target,
   targetName }`. No header, or an invalid or expired grant, means the request
   runs as the real staff member. It never errors into the target. Fail closed
   to "myself", never to "them".

5. Product code is unchanged. Everything that already reads
   `ctx.clientRecordId` keeps working. Inside an acting request it sees the
   target, exactly as today. Outside one it sees the real staff member. No
   endpoint needs to know about impersonation except the ones that render the
   banner or audit writes.

6. Banner keys off `ctx.actingAs`. Same loud amber banner as the interim, but
   driven by the real grant rather than by comparing clients.

7. Audit. `act-as/start`, `act-as/stop` and every write performed under an
   act-as grant are tagged with the real user id and the target, so the trail
   reads "Andy, acting as Cypher, changed X".

### 3.2 Why this shape

- "Myself" is the safe default on every surface, including any tool that has
  not yet been taught about act-as. A tool that does nothing shows the staff
  member's own account, which is safe and correct.
- Impersonation is opt-in per tool and per tab, which is precisely the scope
  Andy asked for.
- The base cookie never changes identity, so there is no way for one tool to
  flip another.

### 3.3 Alternatives considered

- Path scoped act-as cookie. A cookie scoped to one product's path or
  subdomain. Rejected: brittle across our mix of paths and subdomains, and a
  cookie still tends to bleed across tabs of the same tool.
- Server-side "acting as X for product P" state in Redis. Rejected: still
  shared across every tab of that product, and heavier to reason about than an
  explicit per request header.
- Harden the global switch only (loud banner, re-confirm per tool). This is the
  interim we shipped, not the fix. Andy was explicit: "that can't happen".

## 4. Everything that has to change

### 4.1 In this repo (tg-widgets)

- `api/_lib/auth/middleware.js`: resolve the act-as overlay from the header,
  add `ctx.actingAs` and `ctx.realUserId`.
- `api/auth/act-as/start.js` and `api/auth/act-as/stop.js`: new endpoints.
- `api/auth/switch-client.js`: remove the staff act-as path (source
  `staff_act_as`). Keep it only for genuine multi company members switching
  their own default company.
- `public/editor-shell.js`: the shell fetch interceptor attaches
  `X-TG-Act-As` from sessionStorage when a grant is present.
- `public/staff-switcher.js`: "Act as" sets the per-tab grant and reloads that
  tab only, instead of calling the global switch. "Exit" clears the grant.
- `public/index.html` and `public/dashboard.html`: same switcher behaviour.
- `extension/scheduler-companion`: because the extension is its own context,
  the per-tab model means it defaults to the real staff member's diary, which
  is the desired behaviour. It only acts as a client if the staff member
  explicitly starts act-as inside the panel. The interim strip stays as the
  visible cue.
- Audit helpers to tag writes with `realUserId` + target.

### 4.2 Other tools that share the login

Confirmed by Andy on 9 July 2026: every tool shares the same `travelify.io`
login. So the contact engine, Luna Marketing (`marketing.travelify.io`), TG
Control, Contracting and the widget suite all read the same `tg_session`
cookie, and today they all flip together on a global switch.

Under the new model each of them needs two small changes: attach the
`X-TG-Act-As` header from its own fetch layer when acting, and show the banner.
Crucially this is safe by default (see 4.3): until a tool is updated it simply
shows the real staff member, never a client, so nothing breaks and nothing
flips while we work through them one at a time.

Still to confirm, so we can size the work rather than change the design: which
of these live in this repo and which are separate apps or repos. The widget
suite and the shared auth endpoints are here in tg-widgets. If the contact
engine and Luna are separate deployments they each need their own small update,
and (see the caveat below) they do not yet carry even the interim banner.

### 4.3 Safe by default (why the rollout has no unsafe window)

Because the base cookie is always the real staff user and impersonation is
opt-in per tool, any tool that has not been updated to send the header resolves
to the staff member's own account. The failure mode of an un-updated tool is
"shows you as yourself", never "silently shows you a client". So the calendar
bleed stops the moment this repo ships the server overlay and switches its own
switcher (phases 1 and 2), and every other tool can be migrated later with no
window where it could flip unseen.

### 4.4 Interim banner coverage caveat (today, before the real fix)

The interim banner shipped on 9 July 2026 lives in this repo, so it covers the
widget editors, the admin pages, the dashboard, the widget index and the
scheduler side panel. It does NOT cover the contact engine or Luna if those are
separate apps, because this session can only deploy tg-widgets. Until the real
fix lands, those tools still flip on a global switch with no banner. Two ways
to close that gap: add the same `staff-switcher.js` banner to those repos now,
or accept the exposure there until the scoped fix ships. This needs the
repo answer above.

## 5. Security requirements

- Staff only. The grant is minted only for `isTravelgenixStaff`, checked server
  side, never trusted from the client.
- Non escalating. The grant names one target client and cannot widen scope. A
  member acting on their own companies is unchanged and unaffected.
- Fail closed to self. Any doubt (missing, expired, malformed, wrong user)
  resolves to the real staff member, never to the target.
- Audited. Start, stop and every write under act-as carry the real user id and
  the target.
- Origin checked and rate limited, as `switch-client` is today.

## 6. Rollout

- Phase 0 (done, 9 July 2026): loud interim banner on every staff surface so
  act-as can never again be silent while we build the real fix.
- Phase 1 (done, 9 July 2026): the header overlay is in `requireAuth`, plus the
  grant module (`api/_lib/auth/actas.js`) and the staff-only mint endpoint
  (`POST /api/auth/act-as/start`). Additive and dormant: no tool sends the
  header yet, so nothing changed in practice. Covered by `npm run test:actas`
  (24 checks). The banner is deliberately NOT repointed yet, so it keeps working
  off the current global-switch signal until phase 2.
- Phase 2: switch `staff-switcher.js` and the shell to the per-tab grant. Keep
  the global switch for genuine members only.
- Phase 3: roll the header attach and banner into each other tool that shares
  the login (needs the answer from section 4.2).
- Phase 4: remove the staff path from `switch-client.js` once every tool uses
  the scoped model.

## 7. Open questions for Andy

1. Answered 9 July 2026: all tools share the `travelify.io` login. Remaining
   detail, for sizing not design: which of the contact engine and Luna are
   separate repos or deployments, so we know how many places phase 3 (and the
   interim banner, section 4.4) has to reach.
2. Idle timeout for an act-as grant: 30 minutes of inactivity, then it drops
   back to yourself. Happy with that, or do you want a different figure.
3. Should exiting act-as in one tab also end it in any other tab where you had
   started it, or leave each tab independent.
4. Sign-off: happy with the Option A shape in section 3 before any build.
