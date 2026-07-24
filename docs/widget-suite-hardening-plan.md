# Widget Suite Hardening Plan

Owner: Andy Speight. Author: Claude Code. Started: 23 July 2026.

This plan exists because, as real clients started using the widgets, we hit a
run of failures in a single evening even though the widgets had been through
feature QA. This document explains, in plain terms, why that happened, what I
am going to do about it, how I will show you what I find, and what the fixes
will look like. Read it, and tell me what to change before I start the audit.

## Why this is happening (it is not sloppy work)

Almost none of the failures were bugs inside a widget. They were in the joins
between systems, and in the production setup. That is exactly the layer feature
QA cannot see. The QA that was done was real and necessary, it was just aimed at
"does this widget work", not "does the whole system hold up when a real client
signs in through the real flow and hits every corner". That second layer had not
been built yet. It is normal for a platform to reach this point as it goes from
demo to live. The way through it is to add the missing layer, not to blame the
past.

Two things also made it feel like a flood. The bugs were stacked, so fixing one
uncovered the next all evening (a good sign, it means we are clearing them in a
controlled way instead of one client email at a time). And we heard about them
from clients rather than spotting them first, which is the real risk to trust.

## The failure patterns we have actually seen

Every issue this week fits one of five patterns. This matters, because the list
of root causes is short, and each one has a systemic fix.

1. Configuration and environment gaps. A required setting was never added in
   Vercel, so a feature silently ran on a broken fallback. Examples: the
   Supabase telemetry keys (caused the six-day database overload behind the
   offers failures), and an Airtable table name the AI expected.

2. Cross-system contract drift. Two parts of the system that evolved separately
   stopped agreeing. Examples: the login now identifies a user by record, not
   email, but the AI still demanded an email ("Session error"), and editors sent
   widget names the AI endpoint did not recognise ("AI did not return a config",
   and the earlier Logos and Text FX failures).

3. Fragile handling of outside calls. When an outside service (our own proxy,
   Travelify, the AI model, Redis) returned something unexpected, the widget
   broke loudly. Examples: the raw "Unexpected end of JSON input" shown to
   visitors, no timeout on the offers proxy, and no retry when the AI returned
   an empty answer.

4. Access and isolation gaps. A client could reach something that was not theirs
   (the Worldchoice cross-client visibility incident).

5. Missing production monitoring. We had no early warning, so problems reached
   clients before we knew. The database overload ran for six days unseen.

## What I am going to do

### Stage 1: proactive audit (find the holes before clients do)

Instead of waiting for the next client report, I will sweep the whole suite,
widget by widget and endpoint by endpoint, checking each one against the five
patterns above. Concretely I will look for:

- every outside call that is not guarded against an empty or broken response
- every editor whose widget name or login assumptions the endpoints might reject
- every required setting or outside service that nothing checks is present
- every ownership or access check that could let one client reach another's data
- any widget that shows a raw error to a visitor instead of failing quietly

I will deliver this as a ranked findings list (see "How I will report" below).
This is the token-heavy part, because it fans out across 40-plus widgets, so it
is the piece I want your go-ahead on.

### Stage 2: systemic defences (stop the class, not just the instance)

- Contract tests at the joins. One test that checks every editor against the AI
  and config endpoints would have caught tonight's failures all at once, before
  any client. Cheap to add, catches the whole class forever.
- A config and dependency health check. One place that confirms every required
  setting is present and every outside service (Airtable, Redis, the AI, the
  offers proxy, Supabase) is alive, and alerts us if not. This catches the
  "setting never added" class before a client does.
- A synthetic "robot client" monitor. A scheduled job that loads a widget, calls
  the offers proxy and tries an AI action every few minutes, and alerts if any
  step fails. This is what flips "the client tells us" into "we already fixed
  it". It is what would have caught the database overload on day one.
- Graceful degradation everywhere. A hard rule that a broken widget hides itself
  or shows a calm message, never a raw error on a client's homepage. I started
  this on the offers widget tonight.
- A pre-deploy safety gate. Today every change goes straight to the live site. A
  short automated smoke check before a change reaches clients would catch config
  and contract breaks first.

### Stage 3: triage discipline (so it stays manageable)

Not every issue is equal, and treating them as if they are is what makes it feel
overwhelming. I will grade everything:

- SEV1: breaks a widget live on a client's website. Fix first.
- SEV2: breaks something in the editor only. Fix soon.
- SEV3: cosmetic or nice to have. Fix when convenient.

## How I will report what I find

A single findings list you can scan, one row per issue:

| ID | Widget or area | Pattern | Severity | What breaks for a client | Proposed fix | Effort |

You decide which to fix and in what order. Nothing gets changed on your live
site without you seeing it here first.

## What the fixes will look like

Each pattern has a standard, repeatable fix, so this is not 40 bespoke jobs:

- Fragile outside call, use the shared defensive read and a quiet fallback (the
  pattern already shipped on the offers widget).
- Contract drift, teach the endpoint to accept the input, or reject it cleanly
  with a clear message, and add a contract test so it cannot regress.
- Missing setting or service, add it to the health check and the required
  settings list, and alert if it goes missing.
- Access gap, fail closed on ownership and add a test that proves one client
  cannot see another's.
- No monitoring, feed telemetry (now flowing) and the robot client into clean,
  deduplicated alerts.

## What I need from you

1. Approval to run the Stage 1 audit (the token-heavy sweep).
2. Agreement on the severity order, client-facing widgets first.
3. A decision on two items already parked: the Luna routing gap in the enquiry
   form, and the Supabase row-level security note. Fold them into the audit, or
   handle separately.

## Progress log

- 23 Jul 2026: Plan written. Same evening, fixed the live run of AI and offers
  failures (PRs #92 to #98) and turned telemetry back on so we now have
  production data flowing.
- 23 Jul 2026: Fixed a further offers incident where a client building a widget
  tripped the public rate limit and blanked their own live site (PR #103), then
  ran the Stage 1 audit across the whole suite. Findings are in
  `widget-suite-audit-findings.md`. Headline: the scary classes (XSS, raw error
  leaks, cross-client access) are clean; the dominant weakness is missing
  timeouts on outside calls, one repeatable fix. Awaiting Andy's decision on fix
  order.
