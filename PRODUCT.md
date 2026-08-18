# Product

## Register

product

Travelgenix Sites is a tool first. Its own surfaces (the editor, the dashboard,
the settings and admin screens) are Operate: someone is in a task and the
interface should disappear into it. The pages the tool EMITS are a second
register entirely, Persuade, and each one lives in its own committed world. See
the brand-law boundary below.

## Users

Two audiences, never mixed.

- Travelgenix-managed clients: small and mid-size travel agencies and tour
  operators. They log in to edit their own site, write pages, swap photography
  and publish. They are not designers and there is no self-serve signup. Every
  client is set up and supported by Travelgenix.
- The Travelgenix team: the people who build, restyle and manage those client
  sites, and who answer the in-editor review comments a client leaves. Staff see
  everything a client sees plus the staff-only controls.

Decided 17 Aug 2026 (Andy): NO billing and NO self-serve onboarding. Everyone is
a managed client. Do not design flows that assume a stranger signing themselves
up.

## Surfaces and the brand-law boundary

This is the rule that keeps two design systems from fighting. Read it before any
UI work in tg-sites.

- OPERATE, Travelgenix-branded. The editor, the dashboard, settings, members,
  domains, the account bar: the tool the client and the team work in. These
  carry the Travelgenix brand and are governed by the travelgenix-design and
  travelgenix-taste skills: Inter, navy #1B2B5B, teal #00B4D8. Restrained,
  familiar, the tool disappears into the task.
- PERSUADE, client-branded. The published client site the CMS renders: the
  content blocks in components/render, the emitted styles in lib/content, the
  site route in app/site. This is the client's own marketing surface and it is
  governed by Impeccable and the client's own designs/<slug>/DESIGN.md, not by
  the Travelgenix brand.
- WHERE THEY MEET, travelgenix-design wins. The editor chrome wraps a live
  preview of client output, so the two sit side by side. When a rule from one
  would touch the other, the tool stays Travelgenix. In particular Impeccable's
  "source a distinct display face" rule and its brand-level palette choices must
  NEVER be applied to the editor's own UI. The design detector is scoped away
  from the tool chrome and the widget suite for the same reason (see
  .impeccable/config.json); a finding it raises on an Operate file is governed by
  travelgenix-design and is discarded, not acted on.
- NOT IN SCOPE AT ALL. The embeddable widget suite (public/widget-*.js and their
  editors) and the TG Slicer extension are separate products. Impeccable never
  restyles or lints them.

## Product Purpose

Give a managed travel client a site they can run themselves and be proud of, and
give the Travelgenix team the leverage to build and restyle many client sites
without starting from scratch each time. Success: a client edits and publishes
their own pages without help, and the site they get looks like it was made for
their business, not stamped from a template. The travel advantage lives in the
widgets the CMS can embed and in the destination content, not in generic page
furniture.

## Brand Personality

For the Operate surfaces only. Calm, precise, quietly confident. It is a
professional tool for a small business owner who is not a designer, so it is
legible before it is clever and it never shows off at the expense of the task.
Warm, plain, UK English. The client's OWN personality is a separate question,
answered by their DESIGN.md.

## Anti-references

For the tool (Operate) surfaces:

- Consumer-app playfulness: bouncy motion, mascots, confetti, gratuitous
  gradients. This is someone's business, not a game.
- Marketing-site tricks inside the tool: hero-metric panels, three-up feature
  cards, scroll-jacking. The dashboard is a workspace.
- Strangeness without purpose: invented controls for standard tasks, mismatched
  form controls, a display font where a label belongs. Earned familiarity beats
  novelty here.

For the client (Persuade) sites the anti-references are not fixed here. Each
client's DESIGN.md names its own, because what is wrong for a luxury house is
right for a family-budget operator and the reverse.

## Design Principles

1. Two registers, one boundary. Operate is Travelgenix and disappears into the
   task. Persuade is the client and carries their world. Never let one leak into
   the other.
2. The client's world wins on their pages. On a published site the committed
   DESIGN.md beats a generic best practice and beats the assistant's habit.
   Honour the brief.
3. Genuinely diverge by segment. A luxury house and a budget family operator must
   not be the same site reskinned. If two client sites feel interchangeable, the
   design failed.
4. Legible before clever, in the tool. A control names its action, an error names
   the problem and the fix, and nothing decorative earns its place unless it also
   helps the task.
5. Every element earns its place, on both sides. Restraint is the default; commit
   the page to the one thing it is for.

## Accessibility & Inclusion

Baseline WCAG 2.1 AA on the tool AND on every published client site.

- Contrast checked, not eyeballed: body and placeholder text at least 4.5:1,
  large text at least 3:1.
- Keyboard reachable with a visible focus ring themed from the surface, never
  removed.
- prefers-reduced-motion honoured by every animation, tool and client site alike.
- Semantic HTML first, ARIA as a supplement not a workaround.
- Copy in plain UK English; jargon only where it is the real word for the thing.
