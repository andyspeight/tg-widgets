# AI section builder — design

Living design for the AI builder Andy asked for on 3 Aug 2026: "an
industry-leading AI builder, starting with sections and then eventually on to
full-page builds ... as good as the Framer agent that can not only build, but
improve and tweak after a build, and that understands the business and the
industry (travel) so it's not generic, but hyper focused."

Read this before touching the builder. Update it as decisions land.

## The one decision everything rests on

**The AI writes a `Section` in our own schema, never HTML.** It composes out of
the same blocks a person drags in by hand (`lib/content/blocks.ts`), so a built
section:

- renders through the same `PageRenderer`,
- is validated by the same `SectionSchema` and cleaned by the same sanitiser,
- and, the instant it lands, is editable by the same contextual toolbar, colour
  controls and inline typing as everything else.

So "build it, then tweak it" is not a second system bolted on. The tweak is the
editor the client already has. This is exactly why the output must be native
JSON: you cannot reliably revise opaque HTML, but you can hand a `Section` back
to the model, get an edited `Section`, and drop it in place still editable.

Emitting HTML (like the import pipeline does for foreign designs) would give an
opaque `imported` block nobody can nudge — the opposite of the ask.

## Why it won't be generic

Three layers of grounding, strongest first, all already available:

1. **Brand** — the site's own profile (`companyName`, `companyAbout`,
   `toneOfVoice`, `avoid`), the same fields the copy assistant already uses.
   Placed in the system prompt as description the model must not treat as
   instructions (`lib/ai/prompt.ts` already does this for the copy assistant).
2. **Industry** — a travel-agency system prompt. It knows the domain a generic
   website builder does not: enquiry-led not checkout, ABTA/ATOL trust as a real
   selling point, destinations / offers / itineraries, the voice of a trusted
   travel adviser, UK-English house rules. This layer is what stops SaaS-generic
   output and makes it hyper-focused.
3. **Site** — the theme (so chosen tones and colours fit the brand) and, for a
   revise or a full page, the existing content (so a new section matches what is
   there and does not repeat it).

## The reliability spine (the hard, valuable core)

An AI builder is only as good as how rarely it produces something broken.

- **Palette** (`lib/ai/palette.ts`, built): the exact blocks the model may use
  and their fields, generated from the registry so it can never drift. A small
  blocklist withholds the blocks whose content is markup / code / a widget id /
  a collection, which a model cannot invent safely from a sentence.
- **Validate**: the model returns JSON; parse it against `SectionSchema`, then
  sanitise. Anything that fails is not shown.
- **Repair once**: on a validation miss, feed the specific error back for a
  single second attempt before giving up. Cheap, and it turns most near-misses
  into hits.
- **Reuse the guardrails**: same `requireSite` auth, same daily allowance
  (`claimRequest` / `recordTokens` / `DAILY_LIMIT`), same key check, same
  treat-output-as-untrusted stance as `writeCopyAction`. No new trust surface.

Because the model call is non-deterministic, the tests cover the deterministic
parts — palette generation, prompt assembly, parse/validate/repair — and the
live call is checked end-to-end against the real API and by eye in the editor.

## Model

The copy assistant runs on Haiku 4.5 deliberately: writing one paragraph from a
profile is a writing problem, not a reasoning one. A **section build is
different** — choose blocks, structure a layout, honour a palette, write
on-brand travel copy, and come back as valid JSON. That is a composition and
reasoning task, and it is infrequent (adding a section) and high-value. So the
builder should run on a **more capable model (Sonnet 5)** while copy stays on
Haiku, with the model a per-call parameter so it is one line to change.
**Pending Andy's call on cost vs quality.**

## Phases

1. **Compose a section** (first). The AI tab: describe a section → a validated,
   sanitised, native, editable `Section` is added. Brand + travel grounded. This
   builds the reliability spine everything else reuses.
2. **Revise after build.** Select a section → say what to change → an edited
   section. An AI action on the contextual toolbar (the sparkle). The Framer-like
   loop, made possible because the section is native JSON both ways.
3. **Full page.** Describe a page → several coordinated sections (hero, proof,
   offer, enquiry). A page-level plan that reuses the section composer per
   section.
4. **Advisory.** "This page has no call to action / no trust badges" → one-tap
   fixes, in the shape of the existing SEO audit engine.

## Decisions (settled 3 Aug 2026)

- **Model**: Sonnet 5 for the builder (`MODEL_BUILD`), Haiku stays for copy.
- **Compose result**: insert one section and let the client tweak it. Variants
  can come later once revise (phase 2) exists.

## Status

Phase 1 is built and live-pending-deploy:

- `lib/ai/palette.ts` — the palette, generated from the registry (tested).
- `lib/ai/section-build.ts` — the prompt (house voice + travel + palette +
  brand), the JSON extractor, and the normaliser that turns a model answer into
  a valid, sanitised, editable Section or an honest failure (tested).
- `app/actions/ai.ts` → `buildSectionAction` — the same four gates as the copy
  assistant, on Sonnet, with one repair attempt, both calls' tokens counted
  against one slot.
- `components/editor/AiPanel.tsx` — the AI tab: a description, some openers, a
  build button. On success the section is inserted and selected, so the dialog
  closes onto it ready to edit.
- Verified in the standalone harness end to end (describe → build → a native
  heading + three icon points + enquiry button lands, selected and editable),
  and the deterministic core is unit-tested. The live Sonnet call is exercised
  in production, since the harness has no key.

Next: **phase 2, revise after build** — an AI action on the contextual toolbar
that takes the selected section's JSON and an instruction and returns an edited
section. The normaliser and prompt spine are already in place for it.
