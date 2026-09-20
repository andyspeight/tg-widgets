# tg-sites handover

**Written 25 Aug 2026, at the end of the performance and fidelity session.**
Living doc. Read it at the start of any tg-sites session, update it at the end.

Companions, all still current:

- `docs/tg-sites-speed-and-visibility.md` (23 Aug) is the ANALYSIS: what was
  slow, what was invisible, measured from the repository. This doc is the
  STATE: what got built, what is still open.
- `docs/duda-gap-analysis.md` (23 Aug) is the platform-level comparison. The
  element axis closed on 21 Aug (`docs/duda-element-audit.md`), so a new "how
  do we compare" question belongs in the gap analysis, not a fresh sweep.
- `docs/motion-engine.md` (25 Aug) is what is BUILT and switchable.
  `references/motion-recipes.md` in travelgenix-taste is the design catalogue.

Airtable project record: base `appj9tksreHOwkhYg`, table `tblpyhPNhiQg3XkkT`.

---

## Latest: the React Bits review and the shapes slice (15 Sep 2026)

Andy: "the layouts, etc are fairly basic. Review reactbits.dev and see what we
can learn." The review is `docs/react-bits-review.md`: 171 effects read against
what the engine already has, five words missing from our vocabulary (shapes,
backdrops, words arriving, under the pointer, menus), ninety-odd components
skipped by reason, and a five-slice build order. Nothing imported, directions
only, the Scrolltide rule.

**Slice 1, Shapes, shipped the same day.** A `shape` on Cards and the Collection
loop (even, bento, featured), three gallery layouts (mosaic, wall, deck), four
presets, `tests/shapes.test.ts`, and a Chromium check through the real renderer
at 1280 and 390 and under reduced motion. Three bugs were found by that check and
not by the source tests: a phone reset losing to the desktop rules on specificity,
the deck still dealing under reduced motion for the same reason, and a mosaic
rhythm leaving holes. The lesson is the one `tools/preview-presets.mjs` was
written for: a value that is right and draws wrong is only found by looking.

**Slice 2, Backdrops, shipped the same afternoon.** A `backdrop` on the section
(aurora, light rays, waves, drifting specks, map contours, grain), CSS only, in
the section's own colours, never with a photograph, still on the canvas and
under reduced motion; six pictureless presets wear one. `tests/backdrops.test.ts`
and a Chromium check of all six on all four tones. Full detail in
`docs/motion-engine.md` under Backdrops.

**Slice 3, Words, shipped the same evening.** `lib/content/words.ts` splits a
heading's sanitised markup into word (or letter) spans on the server. The
Heading gains *The words arrive* (four ways), *Words that take turns* (the
`{{turn}}` marker and a list), *Under the pointer* (lift, focus frame, swell;
Andy's ask that day) and *Outlined letters*; Text gains *Word by word as you
scroll*. `tg-motion.js` 1.2.0 carries `setUpArrive` and `setUpProximity`, and
`needsMotionScript` now walks the blocks. Not with the animated gradient
(background-clip: text would paint moving words clear). Three presets dressed
(`hero-big-title`, new `hero-turning-word`, `text-statement`).
`tests/words.test.ts`, and a Chromium check with the script, without it, under
reduced motion and on a phone. Detail in `docs/motion-engine.md` under Words.

**Slice 4, Under the pointer for cards and buttons, shipped the same night.**
Three section toggles beside lift, zoom and tint (spotlight, tilt, glare) and an
`effect` on the Button and the Buttons row (sheen, magnetic, trace). Mouse only,
still under reduced motion, nothing on the canvas, every layer lets the click
through. `tg-motion.js` 1.3.0 (`setUpCardPointer`, `setUpMagnets`); the script is
pulled only for the spotlight, the tilt and a magnet. Three presets dressed
(`features-bento-destinations`, `hero-cards-below`, `hero-turning-word`).
`tests/pointer.test.ts`, and a Chromium check with the script, without it, under
reduced motion and on a phone. Detail in `docs/motion-engine.md` under Cards and
buttons under the pointer.

A question Andy asked that day, worth keeping: "why can't I just move my mouse
over the words?" Because nothing moves on the editing canvas, by design: the
canvas reads a heading's markup back and saves it, so the word spans cannot be
added there, and a card that leans or a button that slides would slide away from
the person selecting it. The pointer effects work on the published page and in
the editor's Preview (the eye), and nowhere else.

**Slice 5, Menus, shipped the same night, and the review is complete.** The
Menu block gains a link `style` (plain, pill, underline sweep) and a `panel`
behind the burger (the panel under the bar, the whole screen, cards). Under
it, one thing no menu had before: the CURRENT PAGE, marked by `fillNavFolders`
from the route's address and rendered as `aria-current="page"`, which the
site, the standalone preview and the editor canvas all now pass. The full
screen is a fixed overlay, links at display size cascading in, and it carries
the answer to the August focus concern with it: `tg-motion.js` 1.4.0 makes the
page beneath inert and closes it on Escape, before the script's reduced-motion
return. Never on the editing canvas, which is not an iframe; there it opens as
the panel. Three header presets (`header-cta-bar` pills, `header-dark-bar`
underline, new `header-logo-full-menu`). `tests/menus.test.ts`, and a
Chromium check with the script, without it, under reduced motion and on a
phone. Detail in `docs/motion-engine.md` under Menus.

**Elementor gap #2, form actions, shipped later the same night.** A form can
now also POST each enquiry to a webhook (signed with HMAC-SHA256 when the site
has a secret, https to a public name only, re-checked at send time) and add
the sender to a Brevo list. The address, secret, key and list live once in
Settings, Forms; the two switches are per form on the Form block. After the
store, best effort, never the visitor's problem, the same stance as the
courtesy email. `lib/settings/schema.ts` (`FormActionsSettings`,
`cleanWebhookUrl`), `lib/forms/actions.ts` (pure, fetch as a parameter),
`app/site/[host]/_form/route.ts`, `tests/form-actions.test.ts`, and a check
against a real local HTTP receiver that verifies the signature on the bytes it
received. The contract for the other end is `docs/tg-sites-form-actions.md`.

**The Duda visibility review, written the same night** (Andy: "review the Duda
website and in particular their visibility tool for AI and SEO, the reporting
they offer and how it all works, the display, and then we need to upgrade our
version"). `docs/duda-visibility-review.md`: Duda measures OUTPUTS (a prompt set,
a share-of-voice score, competitors, sentiment, crawler visits, a monthly
white-labelled report, an add-on from about $19 a domain); we measure INPUTS
(the audit and plumbing, which are ahead of theirs) and record nothing. Five
slices proposed: A log who reads the site (crawlers and AI-referred visitors,
no keys, a day), B ask the assistants monthly with a prompt set per site
(Perplexity, ChatGPT, Gemini, Claude; Duda's score formula), C history, D the
monthly report sent, E a miss becomes a page through the AI writer. duda.co is
blocked from the session, so Duda's side is search snippets; distrust the price,
the engine list and the cadence until read live.

**Slice A of that upgrade is built and live (15 Sep 2026, late).** Andy: "Let's
start the build. I'd like to end up with a dashboard for the client with lots of
charts and tools to show results. People want visuals, they don't want to read."
Every request to a published page is now counted (`page_visits`, migration
0034: per tenant, UTC day, path, kind and source, counts only, nothing about
anybody, so the consent banner is untouched) as a person, a person sent by an AI
assistant, a named crawler (ChatGPT, Perplexity, Claude, Google, Bing and the
rest, tagged AI or Search) or some other robot, from the user agent and referer
alone, after the response in the site route's `after()`. The /seo screen
gained "Who is reading your site": four tinted tiles with sparklines and the
change on the month before, a roster of the ten AI engines showing which have
found the site and which are still to come, a donut of who read the pages,
thirty stacked daily columns that rise in with a hover tooltip and a table view,
crawlers by name with the day last seen, the assistants people arrived from, and
the pages each group read most. All HTML, CSS and inline SVG, no script, dark
theme included. Andy's first look at the plain version was "it's a bit boring";
the roster, donut, washes, sparklines and movement are the answer, and the
bar for the rest of the dashboard. `docs/duda-visibility-review.md` slice A has the full "Built" note.
The nightly prune (`/api/cron/housekeeping`, 04:30 UTC, ninety days) waits on
CRON_SECRET like reference-sync does; until then the table grows, harmlessly.
The tally is also the visitor number the monthly report has been missing, not
yet wired into it. Next slices in order: B ask the assistants (needs
OPENAI_API_KEY and CRON_SECRET in Vercel, and a Perplexity key), C history, D
the monthly report sent, E a miss becomes a page.

**The results board (16 Sep 2026, early).** Andy: "Before we go any further I
want to see a few mock ups of potential designs for the dashboard." Three
directions on one canvas (https://claude.ai/artifact/L7SPgbjqB4nfSWqovvCMpq):
A a bento board, B an editorial monthly story, C a dense command centre. He
went with the recommendation, A with B's habit of a plain sentence beside each
big number. Built as `/results` (`app/results/page.tsx`,
`components/results/ResultsDashboard.tsx`, `results.css`): a twelve-column
board of cards; two rings up top (site health from the audit, with its verdict
sentence, and how many of the ten AI engines have found the site, with the
search engines' visits in a line beneath); four tiles with sparklines and the
change on the window before (people, sent by an AI assistant, AI crawler
visits, enquiries, the last one neutral slate because it is not a reader
series); day by day; the engine roster; who read the pages; sent by an AI
assistant; fix these first (capped at four, the rest against the pages); working
well; pages people and engines read most; crawlers by name; every published
page. A 30 or 90 day window from a pill in the header (90 shows no change chips
because the tally keeps 90 days, so there is no whole window before). The old
`/seo` address forwards here permanently; `SeoDashboard.tsx` is gone, its
audit, fix list, wins and per-page list live on the board; the chart parts in
`components/seo/VisitCharts.tsx` are now exported building blocks, and the
enquiries come from `readEnquiryDays` in `lib/db/report.ts` through the pure
`lib/results/enquiries.ts`. The Site dashboard button and the editor rail say
Results. The AI visibility panels (share of voice, the fifty questions, six
months of history) are still to come with slices B and C.

**The copilot review (16 Sep 2026, afternoon).** Andy sent a brief for an
assistant panel in tg-sites, written against Duda's Copilot (in Duda's editor
since 26 Aug 2026, charging credits since 3 Aug). Slice 0 is done:
`docs/tg-sites-copilot-review.md` carries the research, an inventory of the AI
the codebase already has (eleven server actions, sixteen prompt modules in
`lib/ai/`, the `ai_usage` ledger from migration 0015, the capability presets,
the editor's own history, the generated `block-catalogue.json`, llms.txt already
served), a gap table, the eleven hard rules checked against the code, and the
six-slice plan with the changes I would make (apply through the editor's history
so there is one persistence path; scope roles by the capabilities that exist
rather than a new lock model; the binding guard is the loop token, and it should
also go in front of the existing section rewrite, which does not look for one
today; extend `lib/ai/anthropic.ts` with a streaming tool call rather than adding
the SDK; two cheap read tools in slice 1 for the results board and the
enquiries). Three panel directions are on a canvas
(https://claude.ai/artifact/JPhHqEGyaVSZ29RD8rSYnR): A the rail panel
(recommended), B a command bar under the canvas, C a room of its own. Andy
picks before any panel UI is built. Andy answered three of the four questions
the same afternoon: the allowance is unlimited to start (the ledger counts pence
anyway), access is for client and staff from slice 1, and the name is **Luna
Assist** (one constant, `lib/assist/brand.ts`; code paths are `assist`).
The key was never a blocker: `ANTHROPIC_API_KEY` has been on tg-sites-shell
all along (Andy, 17 Sep), and `ai_usage` proves it, with 28 answered requests
on 27 August whose token counts were written back after Anthropic replied.
Every AI feature, Luna Assist included, reads that one variable through
`lib/ai/anthropic.ts`. The only thing still pending is the panel direction.

**Luna Assist slice 1, the foundations (16 Sep 2026, evening).** Everything
under the panel, built before the panel because it is the same under every
direction. `POST /api/assist` takes `{mode, message, pageId?, thread?}` and
streams newline-delimited JSON: `{type:"text", delta}` lines while the answer
is written, then `{type:"answer"}` or `{type:"question", question, options}`
(the model asked one, with two to four options; the person's reply is the next
request) or `{type:"error"}`; a refusal before the turn starts is a plain JSON
status (503 no key, 401 no session, 403 no site, 400 bad body, 429 a limit).
The order in the route is the safety and `tests/assist.test.ts` pins it: key,
session and capabilities, body, the ledger claim, then the site and page are
loaded, then the model. `lib/ai/anthropic.ts` gained `converse()` beside the
untouched `ask()`: the same key and headers, streaming, tools, the system prompt
marked as a cache breakpoint, the event stream parsed by the pure
`lib/ai/stream.ts` (thinking blocks and signatures are kept so a tool loop can
hand the turn back). `lib/assist/` is the rest: `brand.ts` (the name, once),
`pricing.ts` (list prices pinned, 78p a dollar pinned, cost in pence),
`limits.ts` (40 turns a person an hour per site, 300 a site a day, a monthly
allowance in pence that is unset for everyone), `mask.ts` (the people removed
from enquiries before the model reads them), `context.ts` (a page as a compact
outline with ids kept and `[bound {{token}}]` on any block holding a loop
token), `tools.ts` (six readers, and the filter by mode and capability that
rule 4 and rule 7 come down to), `prompt.ts` (rules and mode in the system
prompt, the site and page and request in the user turn inside named blocks
with the tags stripped from values), `runners.ts` (read_page, read_site,
read_catalogue, read_results, read_enquiries, all tenant-scoped and capped) and
`service.ts` (one turn from claim to answer, at most five model calls, an
unknown tool refused and logged, testable with fakes). Migration `0035_assist`
is applied live: `assist_usage` (a row per turn, written before the call, tokens
and pence after) and `assist_log` (events, never prompts or enquiry content),
both RLS forced, read through `lib/db/assist.ts`. The allowance lives on the
tenant row as `staff_settings.assistAllowancePence`; unset is unlimited. Build
mode is accepted and behaves as Plan until slice 2 brings `propose_changes`.
Things that will bite: prior turns are replayed as plain text only (no tool
calls or results), so a long conversation does not carry every page it read;
`ask_user` ends the turn; the per-person hourly count is per site, because the
table is tenant-scoped; the route's `maxDuration` is 120 seconds for a turn of
several calls.

**Luna Assist slice 1, the panel (17 Sep 2026).** Andy picked direction A from
the canvas, so the assistant lives in the column the rail already opens.
`components/assist/AssistPanel.tsx` is the conversation and serves both
surfaces: a fourth rail icon in the editor (`Rail.tsx` gained an `assist`
panel, `EditorShell.tsx` renders it beside the canvas) and a drawer from the
right on the site dashboard (`AssistDrawer.tsx`, first button in the row).
`lib/assist/client.ts` is its pure half: reading newline-delimited JSON out of
a chunked response, the thread that goes back to the server, and the "Read the
page and the results board" line. The styles are the `.ed-assist` block at the
end of `components/editor/editor.css`, which the dashboard already loads
through `sites.css`.

What it does: openers that fill the box on a click, the site, page and section
as chips (each of the last two switches off), the answer streaming in as text
with its line breaks kept, questions drawn with their options so clicking one
answers, and a plain sentence when the server refuses. What it deliberately
does NOT have yet: a Plan and Build switch (Build has nothing to do that Plan
does not until slice 2) and any mention of money (the allowance is unlimited,
so there is nothing true to show).

**Three ways in (Andy, 17 Sep: "the sparkle should also be there on the page,
and the section").** The rail icon, the pill on the canvas, and the properties
head. All three call one `openAssist` in the shell; none of them carries the
context. The panel reads the selection from the editor, so the section chip
follows whatever you click, at any depth: selecting a heading inside the hero
points it at the hero. A chip switched off comes back when you select something
else, because a new selection is a new intent. The section is real, not a
label: it goes to the route, which checks the page actually has it, and the
outline the model reads marks it `[selected]` with the system prompt saying
that a question with no subject is about it.

**Luna Assist slice 2, Build mode (17 Sep 2026).** The assistant can now
propose changes, and the person applies or skips them. `lib/assist/operations.ts`
is the whole of what it may change: `set_text` (a block's words), `set_setting`
(one of its settings) and `set_page_seo`. Structure operations wait for 2b, on
purpose: the machinery is the risky half and three operations prove it as well
as eight.

How a change gets made, in order. The model calls `propose_changes`, the only
writer in the registry and the one Plan mode drops. The server applies the
operations to a COPY of the page: each one finds its block by id (inside a
container or a loop too), checks the field against `lib/content/blocks.ts`,
refuses anything that would drop a `{{token}}`, applies with the editor's own
tree helpers and parses the result with the page schema. Valid changes become
the proposal and refusals go back to the model, which is what lets it correct
one line. Nothing is written. The panel draws each change as what it says now,
what it would say and why. Apply hands the OPERATIONS to the editor, which runs
them through one `commit`, so the proposal is a single step on the same history
as typing and Undo puts all of it back at once. `app/actions/assist.ts` records
that it happened; it writes no page, so there is still one save path.

Two things left out deliberately. There is no `assist_change_sets` table: with
apply going through the editor, a row would be a record rather than a
mechanism, and `assist_log` already carries proposed and applied. It belongs
with applying from the dashboard, which has no editor to apply into. And the
Build switch only appears where there IS a page and a history, so the dashboard
drawer stays Plan rather than offering a control that could not work.

**Luna Assist slice 2b, the section operations (17 Sep 2026).** Three more
operations, so "make the change I asked for" covers the shape of a page and not
only its words: `add_section` (a design from the library, positioned), 
`move_section` and `remove_section`. All three need the `structure` capability,
which the permissions screen already calls "Add, remove and move sections", so
nothing new had to be granted or explained.

What is worth knowing about them:

- **`add_section` names a design, never markup.** The id comes from the same
  library the Designed panel offers, filtered to page scope so a footer cannot
  land halfway down an About page, and `read_catalogue` shows exactly the list
  `add_section` accepts. A test adds every one of the 134 and expects no
  refusal, so a renamed preset fails here rather than in front of a client.
- **It can arrive with its own words.** `heading` and `text` are optional and go
  into the slots the preset DECLARES (`presetRoles`), not by position, so a
  section asked for lands saying what was asked for rather than the library's
  placeholder copy. The words are `content` and the section is `structure`:
  words without the content capability are refused with a sentence saying to ask
  for the section on its own.
- **Position is one field.** `after` is a section id, or the word `start` for
  the top, or absent for the end. `move_section` does the arithmetic that
  `moveSection` needs (the section comes out of the list before it goes back in,
  so a target below it is one index lower), and a move that would change nothing
  is refused rather than drawn as a change that did nothing.
- **Removing says what is lost first**, including "It is filled from a
  collection" when the section holds a loop. That check asks each block with
  `isBound` rather than walking the section, because `tokensIn` stops eight
  levels down and a loop's card sits below that from a section.

TWO THINGS FIXED IN THE SAME PASS. The system prompt still told Build mode that
"proposing changes is not switched on yet", which slice 2 had made untrue: the
model was handed the writer and told not to use it, so it would have answered
with a numbered list on Andy's first live turn. And `propose_changes` had
`content` as its single capability floor, which locked a restructure-only member
out of the very thing their permission is named after; the floor is now any of
content, structure or seo, with every operation still checked field by field.

`read_catalogue` now asks WHICH catalogue (`of: "sections"` or `of: "blocks"`).
Not tidiness: the block list alone is nearly 11,000 characters against a 12,000
cap, so one answer carrying both would have been silently cut off and the model
would have been reading a truncated library without knowing it.

**The binding question, settled (17 Sep 2026).** Yesterday's note said the
existing "rewrite this section" could overwrite a collection binding with plain
words. It cannot, and the reason is worth keeping: `slotsOf` in
`lib/ai/page-fill.ts` walks sections, rows, columns and their blocks, and stops
there. A loop keeps its card in `props.columns[0].blocks` (a container with one
column, see `loopCardTemplate`), so the bound blocks are never collected, never
offered to the model and never written back. `stripUnfilled` cannot remove a
loop either: it only strips the four structured types. So there is no live bug
in the rewrite.

What WAS broken was ours, shipped 16 Sep: `lib/assist/context.ts` looked for a
block's children in `props.template` and `props.blocks`, neither of which the
product has ever written. The assistant's outline was therefore blind inside
every container and every loop, and the `[bound]` marks that rule 6 rests on
could never appear on a real page. It now uses `containerColumns`, the accessor
the editor's own tree uses, and the test fixture is pinned to
`loopCardTemplate` so a fixture cannot agree with a shape the product does not
store. When slice 2 adds writers, the guard has something true to guard.

Things that will bite here: the answer is rendered as TEXT and must stay that
way, so no markdown renderer without a sanitiser; `editor.css` sets no global
box model, so anything with `width: 100%` and padding needs its own
`box-sizing` (the composer was quietly clipped until it was looked at); and at
720px and under the shell only shows that column when `data-pane="outline"` is
set, which the smoke harness has to set too or it tests an invisible panel.
The browser smoke is `scratchpad/assist-smoke/` (38 checks at 1280 and 390,
dark, reduced motion, empty, a scripted stream, a question, a refusal).

Next: Andy to look at the five React Bits slices in the live editor (Preview,
the eye, or the published page; the pointer and word effects and the full-screen
menu never run on the editing canvas), and to try the form actions against a
real Zapier or Make hook. Not built on purpose: a retry queue, a delivery status
on the Enquiries screen, a second named integration.

---

## Latest: editor AI + client-site compliance (28 Aug 2026, fifth session)

All merged to `main` and live on `travelgenixsites.com` (tg-sites-shell
production READY). tsc clean, 3823 tests passing, next build green. Four
things shipped, none touching the destination corpus or the publish work:

1. **Section-level AI in the editor.** Rewrite a selected section (touches only
   the slot COPY, never the design), suggest the next section, and save a
   section as a reusable per-tenant template shown under a **My sections** tab.
   `lib/ai/section-rewrite.ts`, `lib/db/section-templates.ts`,
   `app/actions/section-templates.ts`, migration `0032_section_templates`.
   `buildOneSection` in `app/actions/ai.ts` is the one engine behind both
   Add-a-section-with-AI and Suggest-the-next-section.

2. **AI image generation.** OpenAI `gpt-image-1` (webp), in the media picker
   Generate tab and wired into the AI section builder's hero, **gated behind
   `OPENAI_API_KEY`**. Confined to `lib/media/imagegen.ts`; metered against the
   same daily AI claim as the writer; a generated image is an ordinary media
   row, source `'ai'` (migration `0033_media_ai_source`).

3. **Six designed section presets** in `lib/content/presets-page.ts` (cta-phone,
   features-reassurance, features-included, steps-plan-trip, stats-proof,
   banner-reassurance). Adding a preset needs nothing beyond the data array.

4. **Cookie consent banner** for published sites — a real Google Consent Mode v2
   gate (all client-side, so pages stay cacheable), four looks (card default,
   bar, corner, solid) and an optional granular per-category mode (Essential /
   Analytics / Marketing). `components/render/CookieConsent.tsx` +
   `public/cookie-consent.js` (registered in `middleware` SITE_ASSETS and the
   matcher — `tests/site-assets.test.ts` pins this).

**Waiting on Andy:** add `OPENAI_API_KEY` in Vercel to switch image generation
on (gpt-image-1 may also need OpenAI org verification); test all four; decide
the consent default look (kept `card`) and whether granular defaults on (kept
off). The full state is in the Airtable record and its Decisions Locked.

---

## The font fix is done

**Merged and verified live on 25 Aug 2026.** Main is at `9a7275b`, the
production deployment is READY in `lhr1`, and every published client site now
loads the typeface its design committed to. Nothing here is outstanding; start
at the open queue below.

How it was proved, in case the method is useful again. The decisive evidence
came BEFORE the deploy: the same file id was fetched from the running
production site under both URL shapes, so the only variable was the tenant
segment.

| URL | Result |
|---|---|
| `/fonts/coastwise.travelgenixsites.com/<id>.woff2` (what the page asked for) | 404 |
| `/fonts/coastwise/<id>.woff2` (what the fix asks for) | 200, `font/woff2`, 34,928 bytes |

That is causation rather than inference, and it means a fix like this can be
confirmed without spending a deploy on the question.

After the deploy, the served homepage and the search results page both carry
eight slug-shaped font URLs and zero hostname-shaped ones, three `rel=preload`
links among them, sixteen `@font-face` blocks across weights 400 to 700, and
`--tgs-font-display` resolving to Archivo. Three of the eight URLs were fetched
and returned real WOFF2 bytes.

Sandbox egress is blocked, so all of that went through
`mcp__Vercel__web_fetch_vercel_url`. The responses are large; parse them as JSON
and grep rather than reading them whole.

### Two things worth keeping from this

**The renderer role could have failed here and only in production.** The fix
reads the slug through `getPublicTenantSlug`, which uses the read-only renderer
role. That works because `public.tenants` carries a TABLE-level grant to
`tg_sites_renderer`, so the `slug` column is covered without a column grant, and
because both `resolve_tenant` and the `tenants_renderer` policy require
`status = 'active'` — so if a page rendered at all, the slug read cannot come
back empty. Check both halves before adding another renderer-role read.

**The `?? slug` fallback in the published route is unreachable, not
load-bearing.** If it ever does fire it silently restores the 404, so do not
treat it as a safety net.

### Why this matters more than it looks

Every published client site has been loading its fonts from a 404 for as long
as the font route has existed. Nothing errored. No page broke. No test failed.
The sites have simply been rendering in a system fallback instead of the
typeface their design committed to.

`/fonts/<tenant>/<file>` takes a bare slug and builds the hostname itself,
refusing anything with a dot in it on purpose so a slug cannot be dressed up as
another domain. The published route was handing it `decodeURIComponent(host)`,
so the URL was `/fonts/coastwise.travelgenixsites.com/...`. Confirmed 404
against the live site on 25 Aug.

It surfaced only because Andy noticed a Coastwise headline sitting on one line
live and two lines in the editor, and asked why the two did not match. The
editor was right the whole time. It passes `site.slug`.

The variable in the published route is called `slug` and holds a hostname.
That is most of why it read as correct for so long.

`tests/font-url.test.ts` now pins the contract from both ends.

**Do not "fix" this by deriving the slug from the hostname.** That works for
preview subdomains and nothing else. A client on their own domain has a
hostname with no slug anywhere in it.

---

## Numbers you can quote

Measured with `node tools/verify-perf.mjs`: Playwright, slow 4G, CPU throttled
4x, 390px viewport. Current state is recorded in `perf/baseline.json`.

| Profile | LCP before | LCP now |
|---|---|---|
| A page of native blocks | 4564 ms | **2128 ms** |
| An imported design | 8040 ms | **1892 ms** |

Both roughly halved. The remaining cost is different in each case: the designed
page is still carrying 820 KB of images, the native page is fast enough that
CSS is now the visible floor.

**Measured for real on 25 Aug 2026** (PageSpeed Insights, lab, no field data
because the site has no traffic yet): Performance **98 mobile / 99 desktop**,
Accessibility, Best Practices and SEO **100** on both. LCP 2.4 s mobile and
0.7 s desktop, CLS **0** on both, TBT 10 ms. Desktop FCP of 0.3 s is worth
noting on its own: FCP includes server time, so TTFB is already small, which
means edge caching buys less than the queue assumed.

Two caveats before quoting any of it:

- These are harness pages, not the live site. They render through the real
  `PageRenderer` with real CSS, so the shape is honest, but they do not include
  network TTFB from Vercel or the database.
- CLS is 0 across every profile and always has been. That is a real result, not
  a measurement gap.

### What is still fat

Not the CSS, whatever `cssUnusedPct` says. See the entry under "Things that
will bite you" before ranking that work again.

The honest remaining fat is image BYTES. On a designed page the two pictures
still on the critical path are 400 KB between them, and at 390px on a DPR-3
phone both legitimately want the 1600px candidate, so `sizes` will not save
them. Format would.

## What shipped this session

All on main already.

**Speed**

- `load()` wrapped in React `cache()`. A page view was running the same six
  database reads twice, once in `generateMetadata` and once in the component.
- Image variants generated in the browser at upload (migration 0027, applied).
  Widths 400/800/1600, with a rung only created when it saves at least 25% of
  the pixels. Ladder rule is in `lib/media/downscale.ts`.
- `srcset` for native blocks and for imported markup, the latter through a
  post-substitution pass on the slot tokens.
- Functions run in London (`regions` in vercel.json), where the database
  already is. Confirmed live: `x-vercel-id` shows `lhr1`.
- Backfill for images already in the bank, with orphan cleanup, so deleting a
  picture removes its smaller copies too.
- `lib/media/dimensions.ts` reads real pixel size from JPEG/PNG/WebP/GIF
  headers with no decoder, because stock imports were recording the provider's
  word about a bigger original rather than the file we actually stored.

**Editor fidelity**

- An `alignY` control, so a section taller than its content can say where the
  content sits.
- The editor badge now warns about the width that decides fidelity (1100px
  contained), not the width you typed.

**Motion**

- `docs/motion-engine.md`, written because I had undersold the engine as "Ken
  Burns and parallax" when it is nine recipes with three strengths, six reveal
  styles, plus background and hover effects.
- Fixed a scroll-driven recipe (S5) doing nothing at all on a first section:
  `animation-range: entry 0% cover 35%` is already complete at load. Now gated
  on `data-motion-lead` with a `scroll()` timeline.

Test suite: **3386 passing**, 8 skipped. Was 3321 at the start of the session.

---

## Destinations: what is built, and what it needs before it runs

**ALL THREE SLICES ARE ON MAIN AND LIVE.** Slices 1 and 2 shipped 25 Aug am;
slice 3, ADOPTION, shipped 25 Aug pm (commits `6172913d`..`0978ae88`), a few
hours after this section was first written, which is why the line below used to
say "next". It is done: a client opens a collection, presses **Add a
destination**, searches the corpus and adopts one, and a finished magazine
destination page appears with the facts panel. Verified 28 Aug: the live corpus
holds 1,158 records (495 resorts, 284 cities, 225 airports, 108 countries, 46
attractions), two resort pages are already adopted in production, and
`tests/adopt.test.ts` + `tests/collections.test.ts` are green (265). The code is
`lib/content/adopt.ts` (the seed), `lib/db/reference.ts` (`listAdoptable`,
`adoptDestination`), `app/actions/collections.ts` (the two actions),
`components/collections/AdoptDialog.tsx`, and the facts render in
`app/site/[host]/[[...path]]/page.tsx`.

The one thing still outstanding is OPERATIONAL, not code: **`CRON_SECRET` on
tg-sites-shell**, so the nightly sync keeps the corpus fresh (see below). The
data is already there from manual runs, so adoption works today; without the
secret it simply stops getting newer.

Note: the four "Destination" page templates added 28 Aug (page-templates.ts) are
a SEPARATE, manual path — a client building a destination page by hand without
adopting. Adoption has its own richer, place-aware seed in adopt.ts.

**BEFORE THE SYNC CAN RUN, three env vars and a migration.** Nothing built so
far changes a live page until these are set, and the cron will answer 500 every
night until they are.

1. DONE 25 Aug. `REFERENCE_EXPORT_SECRET` on the **tg-widgets** project. It
   gates `/api/reference/export`.
2. DONE 25 Aug. `REFERENCE_EXPORT_SECRET` on **tg-sites-shell**, same value.
3. DONE 25 Aug. `REFERENCE_EXPORT_URL` on tg-sites-shell:
   `https://tg-widgets.vercel.app/api/reference/export`
4. DONE 25 Aug. `0028_reference_records` applied to the tg-sites database
   (Supabase project `qvzbothxlrzeklcvdhzp`, eu-west-2). Verified after: RLS on
   and forced, two policies, and tg_sites_renderer holding SELECT and nothing
   else, matching every other table in the schema.

**STILL OUTSTANDING: `CRON_SECRET` on tg-sites-shell.** It did not exist, which
is why this is written down rather than assumed. Vercel only sends
`Authorization: Bearer <CRON_SECRET>` on a cron request when that variable is
set, so without it the nightly run arrives unauthenticated and the route
refuses it. Any long random string; it need not match anything else.

Note that a missing secret and a wrong one both answer 401, deliberately, so
the endpoint cannot be used to tell whether it is configured. The project's
settings are the only place that says.

**HOW A DESTINATION IS STORED.** An adopted destination is an ordinary
collection item, which gets it routing, entry pages, listings, cards, SEO,
search and the editor for free. It carries two kinds of value:

- PROSE, ordinary collection fields, seeded once at adoption and then the
  client's, never overwritten.
- FACTS, a payload under the reserved `__ref` key, refreshed on every sync and
  never editable.

`__ref` cannot collide with a client field because a field key goes through
`safeSlug`, which cannot emit an underscore. That is structural, not a
convention, and `tests/reference.test.ts` pins it.

**THE STATUS VOCABULARY DIFFERS PER TABLE.** Countries, cities and resorts run
Draft / Reviewed / Live. Airports run Todo / In progress / Done / Draft / Live.
Attractions add Published. The airports gate (Done, Live) applied to Countries
matches nothing, and an export of zero looks exactly like an empty table. That
is why `api/_lib/reference-status.js` states it per kind and the export reports
`seen` alongside `served`.

**A SYNC THAT RETURNS NOTHING IS A FAULT, NOT AN ANSWER.** Zero of 495 resorts
means a gate stopped matching or a credential lapsed. The sync throws, and the
cron answers 500 even when the other kinds were written.

---

## The open queue, in order

Re-ordered on 25 Aug 2026 after re-measuring. The order the queue had before
rested on a number that does not mean what it looks like.

1. **Published HTML CANNOT be cached at the edge as things stand, and the note
   that said it could is out of date.** Andy said yes to this on 20 Sep 2026 and
   it was not done, because the premise had died under it. The old entry read
   "no cookies, no geography, no user agent, no A/B or audience feature anywhere
   in tg-sites", which was true when it was written on 25 August. Since then two
   things shipped on that route:

   - **Audience targeting.** `readVisitorSignals` reads the cookie, the Vercel
     geo header, `accept-language`, the user agent and the referer, and
     `personaliseSections` drops sections and blocks per visitor. Cached, one
     visitor's variant is served to everyone for the length of the window.
   - **Visit counting.** `recordVisit` runs in `after()` on every render, and it
     is what fills the Results board and the Search and AI visibility screen. A
     cache HIT never renders, so it never counts. The site would look dead.

   `revalidate = 60` would therefore break two shipped features quietly, which is
   the worst way for anything to break. Do not set it without one of these first:

   - **Move visit counting into `middleware.ts`**, which runs on every request
     whether or not the page was cached. Then cache only pages carrying no
     audience rules, and leave the rest dynamic.
   - **Or leave the page dynamic and cache the READS instead.** The round trips
     are what cost the time, not the render: the page, the regions, the settings,
     the nav and the fonts are all per tenant and path and change only on publish.
     This keeps personalisation and counting exactly as they are.

   **MEASURE BEFORE CHOOSING.** Every speed number in this doc is a harness
   floor. Vercel's own Web Analytics needs a client script on client sites, which
   costs the no-JavaScript property and raises a consent question on sites that
   carry our cookie banner, so the cheaper honest answer is to time the render
   server-side where we already are, next to `recordVisit`.

2. **The CSS work, and its shape is now settled by the entry above.** Cached
   pages would have meant inlining each page's own CSS. Dynamic pages mean an
   external core stylesheet plus per-block files, and dynamic is where the route
   has to stay until visit counting moves. So this one can start: 174KB of
   stylesheet with 95 per cent of it unused on a simple page is the measurement
   to beat.

3. ~~**Let a block's Text size take a typed pixel value.**~~ ALREADY DONE, in
   578cb9e7, and nobody crossed it off, so it sat here for weeks as work still to
   do. Found on 20 Sep 2026 while answering "what is next". It had no browser
   check either, which put it in exactly the category that caused the sweep that
   day: built, believed, unverified. `verify-standalone` now proves the block
   stores what was typed and that 900 is pulled back to 200. Note while reading
   that check: a typed 96px draws at about 61px on the canvas because a heading is
   fluid and the canvas frame is about 680px wide, nearer a tablet than the
   desktop the Desktop button names. That is the parked canvas-fidelity question,
   not this control.

4. **Submit travelgenixsites.com to the Public Suffix List.** Free, and it
   matters more now the client subdomains are live: without it a script on one
   client's subdomain can set a cookie another client's subdomain receives.

5. **Backfill Demo Travel.** 9 images, dimensions also wrong. Coastwise is done.

6. **Per-column `sizes`.** Worth less than it looks: at 390px on a DPR-3 phone
   almost everything wants the 1600 candidate anyway.

7. **Site-wide widgets panel, cookie consent first.** Compliance exposure.

8. **Collections fed from an external source.**

9. **Luna Assist (the copilot brief, 16 Sep 2026).** Slices 1 to 6 in
   `docs/tg-sites-copilot-review.md`. Slices 1 and 2 are live: the route, the
   ledger, the outline, the read tools, the panel in direction A, Build mode
   with proposals applied through the editor's own history, and the section
   operations (add, move, remove).

   **THE CANVAS PREVIEW IS DECIDED, 20 Sep 2026: Apply plus one-step Undo, and no
   draft on the canvas.** Andy's brief asked for the draft to be drawn on the page
   before applying; he took the recommendation instead, so there is nothing to
   build for it. A proposal already lists what each change says now and what it
   would say, Apply lands the lot as one commit on the editor's own history, and
   the panel says "Applied. Undo puts it back, in one step." Drawing a draft on
   the canvas would have meant a second rendering path for content that is not in
   the page yet, which is the kind of thing that drifts from the real one and then
   lies about what you are going to get.

   Next is slice 3, the bigger asks: a page from a description, and a client's
   pasted notes turned into a checklist. NOBODY HAS TAKEN A LIVE TURN YET: every
   part is tested against fixtures and a scripted stream, and no real model answer
   has been through it.

10. ~~**`tools/verify-standalone.mjs` is ten expectations behind the app**~~
    DONE, 20 Sep 2026, and it was nineteen rather than ten. Reading them rather
    than bumping them was the right call: one was a real bug on live sites (the
    unnamed collection grid, below), six had been dead since 26 August, and four
    were mine, from the rem-to-em move the day before. See the sweep in "Things
    that will bite you".

Also parked: option A on canvas fidelity, a counter-scaled canvas. Read the note
in `components/editor/Canvas.tsx` around line 1041 before touching it.

## Things that will bite you

Hard-won, none of it obvious from the code.

**A CHAIN THAT STOPS AT THE FIRST FAILURE HIDES EVERYTHING BEHIND IT** (Andy,
20 Sep 2026, after the first thing he tested did not work: "pls go through and
make sure everything works as it should"). `verify:browser` was one shell line
with twelve commands joined by `&&`. On the morning of the 20th the eighth of
them, `verify-destination`, was throwing before it opened a browser, so the four
suites after it had not run in weeks and the one line that was printed looked
like an ordinary red test rather than a chain that had stopped.

What it was throwing on says something on its own. The destination fixture wrapped
its facts in a `__ref` key, which is the shape that design used before the facts
moved out of the item's own `data` and onto their own columns. The fixture was
never moved with it, so the check went from proving something to proving nothing,
silently, on a day nobody was looking at it.

`npm run verify:browser` now goes through `tools/verify-all.mjs`, which runs every
suite whatever the ones before it did, prints each suite's own summary, names any
suite that died before it could report, and exits non-zero if any of them failed.
The two builds at the front still stop the run, because a stale bundle makes
everything after it meaningless.

**WHAT WAS BEHIND IT**, all found on 20 Sep 2026 once the chain ran end to end:

- A card grid switched to "From a collection" but not yet pointed at one went on
  drawing the cards somebody had typed into it. See the next entry: that one is a
  real bug and it reached published sites.
- Six collection checks had been dead since 26 August, looking for a pair of
  buttons that had become a dropdown the day Andy said "make it a dropdown, as you
  can't read them as they are all truncated at the moment".
- The block picker count was 53 against a library of 54: the Loop block landed on
  10 September and the tripwire fired into a chain nobody was running.
- The picker's tab list had never seen "My sections"; the Add page composer had
  never seen the four destination starts; the settings screen had never seen
  "Floating widgets" or "Forms".
- Four were mine, from the previous afternoon: the size checks named the scale's
  VALUES (`2rem`, `1.25rem`, `0.75rem`) and the move to em left them selecting
  nothing, which Playwright reports as a thirty-second timeout on a locator with
  no hint that the product is fine.

**SO DRIVE A CONTROL BY ITS LABEL, NOT BY THE VALUE IT WRITES.** What a person
picks is a label. A check that names the value is a check that breaks the day the
value changes, and it breaks in the way that looks like the product broke. Where
the value matters to the assertion, carry back whatever the label turned out to
select: `const [chosen] = await select.selectOption({ label: 'Huge' })`.

**A GRID FED FROM A COLLECTION NOBODY HAS NAMED MUST NOT DRAW THE OLD CARDS**
(20 Sep 2026). Switch a Cards block from "Typed in here" to "From a collection"
and, until you typed a collection name, nothing happened: the three cards that
were already there stayed exactly where they were. `listingIn` had always said
what should happen instead, in its own comment, "a client who picked the source
and has not chosen a collection yet gets the placeholder rather than a silent
empty grid", and the renderer never did it, because its placeholder branch first
asked whether there were any cards to draw and there were: the old ones.

The editor half of that is an annoyance. The published half is not. A client who
moved a grid onto their blog, did not finish, and hit publish had three sample
cards about Greece, Italy and Portugal on their live site, under a heading that
promised their latest posts. The guard now comes first and does not ask what is in
the block, in both the editor and the published page, and the typed-in cards stay
stored so switching the source back brings them straight out again.

**SAY WHAT LANDED, NOT WHAT WAS PLANNED.** "Write this page" reported the SIZE OF
THE PHOTO PLAN as the number of pictures it had found. `fillPlannedPhotos` returns
on its second line when Pexels or the blob store is not configured, so a site
without them was told "six pictures asked for" and got none. It returns the count
it actually applied now. Any best-effort step that reports to a person has this
shape of bug available to it.

**EVERY VALUE A MENU CAN PRODUCE HAS TO SURVIVE THE GATE IT WILL BE SAVED
THROUGH.** A value `sanitiseStyle` does not recognise is DROPPED on the next save,
with no error. So a control can apply correctly, show the right thing, and lose it
the moment somebody saves. `tests/content.test.ts` now walks every size, font,
colour swatch, highlight, line spacing and letter spacing the menus offer and puts
each one through the gate it will be saved through, and checks that no two of them
collapse to the same stored value. It is written over the menus themselves, so a
new swatch is covered the day it is added.

**TWO CHECKS WERE NEVER IN THE CHAIN AT ALL.** `verify-overlap-css` and
`verify-slideshow` were written, committed, and never added to `verify:browser`,
so from the day each landed the only thing that ran it was somebody typing its
name. Both were green when they were added to the runner on 20 Sep 2026, which is
luck rather than evidence.

**A PUBLISHED PAGE IS FULLY SERVER-RENDERED, AND IT STILL SHIPS NEXT'S OWN
RUNTIME.** Worth writing down because the test list handed to Andy on 19 Sep 2026
said "there is no React runtime", and that half of it is not true. Checked in the
build manifest on 20 Sep: `/site/[host]/[[...path]]/page` carries webpack, the
framework chunk, main-app and its own route chunk, about 103 KB of first-load
JavaScript, which is what the App Router ships for any page whether or not it has
a single client component. What IS true, and is the property the project actually
depends on, is that every word of the page is in the first response and the page
reads and works with JavaScript off: no block hydrates to become useful, and the
four behaviour scripts (motion, slideshow, theme toggle, no-right-click) are
loaded only by the pages that ask for them.

Removing the runtime is an architecture question, not a fix: it means rendering
the site route outside the App Router. Not on the queue, and not something to
start without deciding it is worth it.

**THE PUBLISHED ROUTE IS NOT A PURE FUNCTION OF THE URL ANY MORE, WHATEVER AN
OLDER NOTE SAYS** (20 Sep 2026). Two things landed on it after the caching note
was written and neither announced itself as a caching decision. `readVisitorSignals`
reads the cookie, the geo header, `accept-language`, the user agent and the
referer, and `personaliseSections` drops sections and blocks per visitor; and
`recordVisit` runs in `after()` on every render, which is what fills the Results
board and the visibility screen. So `revalidate` on that route serves one
visitor's variant to everyone and stops the counting dead, both silently. The
module comment in `lib/site/visitor-signals.ts` even reasons from force-dynamic
being permanent.

The lesson generalises past caching: a feature that reads the request quietly
takes an option off the table somewhere else, and nothing in the code says so.
Before acting on a note in this file, check the claim still holds. The queue
entry has the two ways to get the option back.

**IT ALL RUNS IN CI NOW, ON PUSHES TO MAIN AS WELL AS ON PULL REQUESTS** (20 Sep
2026, Andy: yes to both). Until that afternoon nothing automated ran any of it:
`.github/workflows/test.yml` covers the widget suite at the repo root and stops
there, and everything in the entries above rotted in that gap.

`.github/workflows/tg-sites.yml` has two jobs. A fast one: typecheck, the unit
suite, the block catalogue, and a guard that the suite has not silently shrunk
below 4,000 tests. Then a browser one that installs Chromium, builds, and runs
the whole chain. Both are path filtered, so a commit touching only the widget
suite pays for neither.

ON PUSH AND NOT ONLY ON PULL REQUESTS, deliberately. The convention in this repo
is to commit straight to main and let Vercel deploy it, so a pull-request-only
workflow would almost never run and would be reassurance rather than a check. The
browser job is about twelve minutes and there are a few pushes on a busy day.

`tools/chromium.mjs` came out of the same work. Every verifier carried the same
hard-coded `/opt/pw-browsers/chromium-1194/...` path, which is this sandbox's and
nobody else's, and an executablePath that does not exist fails with a message
about a missing FILE rather than a missing browser, which is a confusing first
five minutes for whoever meets it. It now prefers `TG_CHROMIUM`, then the sandbox
copy if it is actually there, and otherwise hands back undefined, which is what
tells Playwright to use the browser it downloaded itself. Same command, three
right answers: here, on a laptop, and on a runner.

**A PUBLISHED PAGE IS FULLY SERVER-RENDERED, AND IT STILL SHIPS NEXT'S OWN
RUNTIME.** Worth writing down because the test list handed to Andy on 19 Sep 2026
said "there is no React runtime", and that half of it is not true. Checked in the
build manifest on 20 Sep: `/site/[host]/[[...path]]/page` carries webpack, the
framework chunk, main-app and its own route chunk, about 103 KB of first-load
JavaScript, which is what the App Router ships for any page whether or not it has
a single client component. What IS true, and is the property the project actually
depends on, is that every word of the page is in the first response and the page
reads and works with JavaScript off: no block hydrates to become useful, and the
four behaviour scripts (motion, slideshow, theme toggle, no-right-click) are
loaded only by the pages that ask for them.

Removing the runtime is an architecture question, not a fix: it means rendering
the site route outside the App Router. Not on the queue, and not something to
start without deciding it is worth it.

**AND NOTHING AUTOMATED RUNS ANY OF THIS.** `.github/workflows/test.yml` runs
`node --test test/*.test.mjs`, which is the widget suite at the repo root. tg-sites
has no CI at all: its typecheck, its 4,300 unit tests and its browser chain run
when somebody remembers. Everything in this entry rotted in that gap. Worth
deciding on, since a twelve-minute browser suite on every push is a real cost and
Andy's call rather than one to make quietly.

**"WRITE THIS PAGE": THE BRIEF BOX FOR A PAGE THAT ALREADY EXISTS** (Andy,
17 Sep 2026: "there is nowhere for me to tell the AI what the page is about and
form it to write the content and source the images"). He was right. The
whole-page writer only existed at the moment of creation, behind the "Describe
it with AI" start in the Add page composer. Pick one of the designed pages
instead, which is the obvious thing to do when the list of them is the first
thing you see, and you got a real design carrying placeholder copy with nowhere
afterwards to say what it was for.

It lives in the PROPERTIES PANEL WITH NOTHING SELECTED, which is exactly what
somebody is looking at the moment they add a page: a panel that until now said
"select a section and its settings appear here" and nothing else. A page is the
one thing in the editor with no settings screen of its own.

`writePageAction` (app/actions/ai.ts) FILLS, IT DOES NOT REBUILD. The sections
that come back are the sections that went in: same designs, same order, same
settings, new words. Somebody who chose "Destination, picture-led" chose it. It
also strips nothing, which is the one place it deliberately differs from the page
builder: that path drops sections the fill never reached, because a page nobody
has seen carrying a preset's example copy is a page about somebody else's coast.
Here the person can SEE the page, so a skipped section is theirs to notice, and
deleting part of the page they are looking at would be the more surprising
answer.

THE PICTURES COME BACK IN THE SAME ANSWER. `buildPhotoAsk` appends a request for
one `photo:N` key per section to the same call, and `fillFromModel` ignores every
key that is not a slot it offered, so the copy is untouched and the page costs
one request slot rather than two. `refreshPhotoPlan` (lib/content/photo-plan.ts)
then re-queries every place that ALREADY holds a picture: it plans from the
section rather than from a preset, because a page in the editor has no preset any
more. Nothing empty is filled and no background is added to a section that never
had one, since both are design decisions the person already made. A bound picture
is left alone. And the whole photo step is opt-out in the panel, because a page
somebody has put their own photographs on should not have them swapped for stock
just because they wanted the words rewritten.

**A SIZE THAT IS NOT RELATIVE TO ANYTHING CANNOT BE CALLED "LARGE"** (Andy,
17 Sep 2026: "the sizing of the text makes no sense. When you select large,
bigger, giant etc either nothing happens or the text gets smaller"). He was
right, and the arithmetic says why. The toolbar's size menu offered an absolute
rem ladder ending at 2.5rem, which is 40px. A theme's H1 is 48px, an H2 is 36px.
So on any heading worth styling, every option in that group was SMALLER than the
heading already was: Giant shrank an H1 by eight pixels, and picking H1 from the
theme group while already on an H1 did nothing at all, because it was already
that size. Every field was wired, every value valid, every unit test green: the
fault was in the arithmetic between two correct things.

The scale is in `em` now, so each label is true wherever it is used: on an H1,
Large is 60px and Giant is 120px; on a paragraph, Large is 21px. The theme group
stays absolute, because "make this phrase H2-sized" is a different and useful
request. THE OLD REM VALUES STILL VALIDATE and always must: a value
`sanitiseStyle` does not recognise is DROPPED on the next save, so without
`LEGACY_SIZE_VALUES` the fix would have silently unsized every phrase anybody had
ever sized, the first time they saved an old page. That would have been a worse
bug than the one being fixed, and an invisible one.

**THE EDITOR'S PREVIEW IS THE PUBLISHED DOM WITHOUT THE PUBLISHED SCRIPT.** Found
the same day, from "the effects on the text all work except words near the
pointer swell". The effect was fine: with the real stylesheet and
`public/tg-motion.js` it runs exactly as designed. What was missing was the
script, in the one place somebody would go to try the effect. In preview the
canvas renders with `editable=false`, so the word spans and `data-hover` are all
there and the two pointer effects that are pure CSS work; the third is the only
one that needs to be told where the pointer is, and the editor has never rendered
that file. `components/editor/Canvas.tsx` now adds it on entering preview and
calls `window.__TG_MOTION_INIT__` whenever the previewed tree changes, because a
`<script>` tag runs once and this canvas redraws under it. Editing loads nothing
and re-runs nothing.

The general lesson, and it is the third time this month: **a control can be
correctly wired and still do nothing a person can see.** Both of these passed
every unit test in the suite. `tools/verify-text-controls.mjs` measures the
result instead, in a browser, with a real pointer: 23 checks, and it fails on the
old scale with "Giant is 40px inside a 48px heading", which is Andy's report in
one line.

**A PANEL THAT GROWS WITH THE LIBRARY WILL ONE DAY NOT FIT ON THE SCREEN, AND
NOTHING YOU CAN ASSERT WILL SAY SO.** Andy, 17 Sep 2026: "adding a page doesnt
work". It worked. The Add page composer draws one card per designed page, and at
two dozen designs it stood 1,966px tall inside a 900px panel: the name box at the
top, the Add page button 1,800px below it, and the search box twelve pixels below
THAT. By the time you had scrolled to the button, the only text box in sight was
the wrong one, so the page name went into the search box and the composer
answered "Give the page a name". Thirty-nine assertions in
`tests/pages-panel.test.ts` passed throughout, because it is not a claim about a
function: it is whether the box you are asked to fill in is on the same screen as
the button you press.

Two rules out of it. A list that grows with a library gets a bound and its own
scroll, not the panel's. And a second text box must never sit below the button
somebody is about to press, whatever it is labelled. `tools/verify-pages-panel.mjs`
measures both and fails on the old CSS.

**NOTHING BUT THE BUILD ITSELF READS THE BUILD, SO A BROKEN ONE STAYS BROKEN.**
Found the same day, looking for somewhere to put that check:
`npm run verify:browser` had been dying at its first step for weeks, and it
turned out to be three separate drifts, each invisible to everything else. A
server action reaching a component with no swap in `tools/build-standalone.mjs`
(`app/actions/publish-site`, which drags Postgres, node:crypto and
node:async_hooks into a browser bundle), a double that had not kept up with its
real module's exports (`generateImageAction`, `listingCardsAction`,
`reorderItemsAction`), and two more actions with no double at all. The rule from
17 Aug 2026 was "add an action, add its swap"; the rule now is "add an action,
add its swap AND its export", and `tests/settings.test.ts` fails on both in a
millisecond rather than leaving it to a build nobody runs.

`tools/verify-standalone.mjs` is a separate matter: it runs again, and on 17 Sep
2026 ten of its expectations looked out of date because the app had moved on
while it was dead. THAT READING WAS WRONG ON BOTH COUNTS and it is worth leaving
the correction here rather than quietly fixing the sentence. There were nineteen,
not ten; they were not all stale numbers; and they were not all somebody else's.
One was a real fault that reached published client sites, four were caused by the
size-scale change made that same afternoon, and six had been dead since August.
The sweep on 20 Sep 2026, below, has the whole list.

**A RULE THAT READS A TOKEN THE THEME HAS NOT GOT DRAWS NOTHING, NOT THE
FALLBACK.** This is a hole in the whole stylesheet, found on 25 Aug 2026 in the
destination panel. A `var()` that cannot be substituted invalidates its
declaration AT COMPUTED-VALUE TIME, and the property then takes its INITIAL
value rather than falling back to the earlier declaration in the cascade, which
is what everybody expects. So
`background: color-mix(in srgb, var(--tgs-accent) 42%, var(--tgs-bg))` did not
come out grey from the rule above it. It came out TRANSPARENT, and two months of
a climate chart were simply absent with every unit test green.

The trap is that a CLIENT THEME IS SPARSER THAN THE DEFAULTS. Coastwise does not
define `--tgs-bg` at all. Before using a token in a rule, check a real tenant's
token set carries it, not just `:root` in globals.css.

**AND A TRIPWIRE NOBODY HAS WATCHED FAIL IS NOT ONE.**
`tools/verify-destination.mjs` took three goes. The first rendered with no theme
and passed the broken build. The second read the ground off `<body>` rather than
off what is actually behind the element, and passed it too. Only the third, which
carries a real tenant's sparse tokens, failed. Reintroduce the bug and watch the
check go red before believing it.

**ANYTHING A PUBLISHED PAGE LOADS BY NAME FROM OUR ORIGIN HAS TO BE LISTED IN
THE MIDDLEWARE.** This bit twice in one day. Everything on a client's hostname
is rewritten into the site renderer, and `isPlatformPath` names the exceptions.
The fonts were the first case (they asked by hostname instead of slug); the four
scripts in `public/` were the second, and they were simply missing from the list,
so `/tg-motion.js` on a client domain returned a 404 HTML document with a
JavaScript content type. Both were silent: nothing errored where anyone would
see it, the feature just did not happen. The list lives in `middleware.ts` as
`SITE_ASSETS` and is repeated in the matcher literal, because Next reads that at
build time and cannot call a function. `tests/site-assets.test.ts` checks the
directory, the function and the matcher against each other.

**CLS IS ZERO BECAUSE OF THE FONT PRELOADS, not by luck.** PageSpeed measured 0
on mobile and desktop on 25 Aug. `font-display: swap` with no metric overrides
would shift the layout if the font arrived after first paint; the three
`rel=preload` links in FontHead are what stop it arriving late. Forced to swap
in a probe (font held back 600 ms) the same page scored 0.047. If anyone ever
trims those preloads as dead weight, this comes back.

**LIGHTHOUSE'S "LEGACY JAVASCRIPT" IS NOT ACTIONABLE HERE.** Next emits the
polyfills chunk with `noModule`, so no browser supporting ES modules downloads
it and the 12 KiB it counts costs real users nothing. A browserslist does not
remove it either: measured both ways on identical code, adding
`supports es6-module, not dead` made the client bundle 23,336 bytes BIGGER,
because it is a wider target set than Next's own default.

**THE BIG "EFFICIENT CACHE LIFETIMES" NUMBER IS THE DEMO, NOT THE PRODUCT.**
PageSpeed reports about 1,789 KB of desktop savings, nearly all of it pictures.
Those are hardcoded Supabase urls in `tools/coastwise-seed`, put there by hand.
Real client media goes to Vercel Blob through `/api/media/upload`, which now asks
for a year. Fixing the demo's number means the bucket's own settings.

**`cssUnusedPct` does not mean what it looks like, and it mis-ranked the whole
queue.** It read 93 to 97 per cent and put "split the CSS" at the top. It is
Chrome coverage: a rule counts as used only if it matched an element during
that page load, so it excludes hover and focus states, container-query branches
for other widths, dark mode, and variants of blocks that ARE on the page. All of
those are needed. Measured properly with postcss and attribution by class root,
69.7 per cent of the code is block-attributable and a realistic page needs 53
per cent of it: about 8 KB brotli off a 17.9 KB stylesheet, not 96 per cent.

**And `globals.css` resists splitting anyway.** It alternates between shared and
block rules 49 times, with 102 KB of block rules sitting BEFORE the last shared
one. Lifting blocks into their own files reorders 792 rules against shared ones,
and any equal-specificity tie flips silently. A safe split needs a
conflict-detection pass, not just an attribution pass.

**The hero must be eager, and that is not the same as "the others are lazy".**
Making every picture lazy, hero included, measured 2916 ms. Hero eager with
`fetchpriority="high"` and the rest lazy measured 1892 ms. The all-lazy version
still saves the bytes below the fold, so it reads like a win while delaying
discovery of the one image being waited on. `tests/image-priority.test.ts`
asserts the first image is NOT lazy for exactly this reason.

**The harness diverged from the site a fourth time.** `perf/entry.tsx` called
`prepareSections` without `heroFirst`, so it measured an arrangement we do not
ship, and a thousand milliseconds sat in the difference. It is now pinned by a
test. Whenever you add a render-time option, ask what the harness passes.

**The canvas has already eaten two attempts.** `Canvas.tsx` lines 1041 to 1063
record them with measurements: a fixed width overflowed, and shrinking gave
20px insert buttons and a 13px handle. I nearly re-implemented attempt 2 from
scratch. Read the comment first.

**Rebuild before you measure.** `tools/build-perf-page.mjs` serves the BUILT
stylesheet from `.next/app-build-manifest.json`, not the source. Edit
`globals.css` without running `npx next build` and you measure the previous
one. There is now a guard that hard-stops on this, added after it caught me.

**The harness lies in three specific ways, all now fixed, all worth knowing
about if you extend it.** It used to serve raw `globals.css` (302 KB instead of
the built 129.6 KB, overstating CSS cost four times over). It used to dedupe
images, so a four-image page measured like a one-image page. It used to key
srcset on slot tokens, so an imported design got the srcset for a different
image entirely.

**`stillBackground` silently drops background motion.** It is
`Boolean(background) && !bgShow && !video`. The Coastwise hero is a three-photo
slideshow, so Ken Burns, A6 and S5 were all silently ignored. I told Andy twice
that the hero was moving when it never was. A2 is the recipe that suits a hero
of several photographs.

**Verify a webfont actually loaded before measuring type.** I measured line
counts against a system fallback and reported them as fact. Archivo had failed
to load in the local render. This is the same root cause as the live font bug
and I hit it from the other direction without noticing.

**`vercel.json` takes no comments.** Not even `"//"` keys. The schema permits
no unknown keys at all, and the failure mode is strange: the deployment ERRORS
before building, so there are no build logs whatsoever. No build logs at all
means the config was rejected, not that the build broke.

**Check CSS tokens one at a time.** I invented `--ed-surface-2` and
`--ed-radius-sm` in one session. The real one was `--ed-r-md`. Grep for each
token individually before using it.

**Table grants vs column grants.** `public.media` has a table-level grant so a
new column is covered automatically. `public.site_regions` uses column-level
ACLs and needs an explicit grant. Getting this wrong fails at runtime under the
renderer role only, which local work will not catch.

**Run `npm run test:offers-cache-only` from the repo ROOT, not `tg-sites/`.**

---

## Standing rules for this work

From `CLAUDE.md` and from Andy directly. Repeated here because they are the
ones that actually come up in tg-sites sessions.

- Never rebuild from scratch. Always upgrade existing code.
- Diagnose before patching. Evidence before hypothesis. Hard stop after two
  failed fixes and rethink from the top.
- Refinement preserves, redesign replaces, never split the difference.
- The unit of design is the tenant. `designs/<slug>/DESIGN.md` is the committed
  home of that client's world. If it does not exist, run the init conversation
  with Andy before designing anything.
- Offers are cache-only. A visitor's browser must never trigger a Travelify
  search, and there is no "fall back to live if the cache is empty" path.
- Andy relies on this doc and the Airtable record as an external brain. Anchor
  everything with dates, restate context rather than assuming it carried over.

### Coastwise specifics

`designs/coastwise/DESIGN.md` carries two corrections worth knowing:

- The one-authored-moment-per-page rule was lifted by Andy on 25 Aug.
- The hero photograph is already full-bleed. `width` only controls the text
  column, which is currently 1200.
