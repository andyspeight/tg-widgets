# Travelgenix Sites

The CMS shell for the Travelgenix website builder. Content model, block
library, server-side renderer and a working three-pane editor.

It lives inside the `tg-widgets` repo for now so the work is committed and
reviewable, and it is self-contained so it can be lifted into
`andyspeight/tg-sites` whenever that repo exists. Nothing here imports from
the widget suite and nothing in the widget suite imports from here. It
deploys as its own Vercel project rooted at `tg-sites`, separately from the
widgets deployment.

## Running it

```bash
cd tg-sites
npm install
npm run dev          # http://localhost:3100
```

| Route | What it is |
|---|---|
| `/` | Front door with links to the other two |
| `/editor` | The editor. Draft saves to localStorage |
| `/preview` | A server-rendered page. View source, the content is all there |

```bash
npm test         # 43 tests
npm run typecheck
npm run build
```

## The content model

```
Page
 └── Section        tone, width, vertical padding, optional background
      └── Row       column widths, gap, stacking, reverse-on-stack
           └── Column   width %, vertical alignment
                └── Block   the actual content
```

A page is JSON. Export it from the editor to see the whole shape, or read
`lib/content/seed.ts`, which is written out longhand as a worked example.

### About column widths

The V1 spec banned layout data in the content schema. Andy overruled that on
29 July 2026 in favour of draggable column widths, because that is how every
CMS an agent has used before behaves.

So `width` is stored, and it is the only layout number in the entire model.
Everything else that could have been a pixel value is an enum. There are no
positions, no margins and no per-breakpoint overrides.

Three rules contain the overrule, enforced in `lib/content/schema.ts` rather
than in the editor, because the editor is not the only thing that can write:

1. Widths are percentages that always sum to 100.
2. No column can go below 10%.
3. Columns always stack on small screens. A row chooses the breakpoint
   (`tablet` or `mobile`), it cannot choose "never".

Rule 3 is what makes free widths safe. Desktop layout is completely open,
and there is still no combination of editor actions that produces horizontal
scroll or an unreadable phone view. Elementor and Duda behave the same way.

## The blocks

Thirteen built-ins, in `lib/content/blocks.ts`. These are CMS primitives, not
Travelgenix widgets. TG widgets arrive later as a single `widget` block that
renders an embed by id.

| Group | Blocks |
|---|---|
| Text | heading, text (rich text), quote, list, icon and text |
| Media | image, video, gallery |
| Actions | button, button group |
| Layout | divider, spacer |
| Advanced | embed code (staff only) |

Adding one means three things: an entry in `BLOCKS`, a component in
`components/render/blocks.tsx`, and a case in `BlockRenderer.tsx`. The
properties pane builds itself from the field definitions, so there is nothing
to write there.

## How the pieces fit

**One renderer, two callers.** `components/render/` is used by both the
published page and the editor preview. The only difference is an `editable`
flag that adds selection hooks, empty states and resize handles. The preview
cannot drift from what ships because it is the same code.

**No event handlers in the renderer.** The editor attaches one delegated
listener to the canvas and reads `data-path` off the closest ancestor. That
is what keeps the renderer usable as a React Server Component.

**Container queries, not an iframe.** `.tgs-page` is a CSS container, so the
viewport switcher restacks rows for real by changing the preview's width.
No iframe, and no separate mobile preview mode to fall out of sync.

**Unknown blocks survive.** A block type this build does not recognise
renders as nothing on the published page and as a clear placeholder in the
editor, and it round trips through a save intact. A page saved by a newer
build is never destroyed by an older one.

## Security

- Rich text and embeds are sanitised against an allowlist on save and again
  on render, in `lib/content/sanitise.ts`. Stored HTML is never trusted.
- `javascript:`, `data:` and protocol-relative URLs are rejected everywhere.
  Links opening a new tab always get `rel="noopener noreferrer"`.
- Iframes are refused entirely in rich text, and in embeds only from an
  allowlisted host.
- The embed block is staff only.
- Column widths ride on a CSS custom property, so there is no inline CSS and
  a strict CSP needs no `unsafe-inline`.
- `npm audit` is clean. `sharp` and `postcss` are pinned forward via
  `overrides` because the versions Next depends on carry advisories, and
  `next` itself is pinned exactly to 15.5.22, the patched 15.x (15.1.6 has
  CVE-2025-66478).

Note that this repo gitignores `package-lock.json` as a convention, so there
is no lockfile committed here. The version pins above are in `package.json`
rather than only in a lockfile precisely so they survive that. When this moves
to its own repo, commit a lockfile there.

The sanitiser is a conservative allowlist tokeniser, not a full parser.
Before real client content ships it should be swapped for DOMPurify under
jsdom on the server. Its interface is deliberately narrow so that is a
one-file change, and the embed block stays staff-only until then.

## The database

Postgres 17 on Supabase. Schema, roles and row level security are in `db/`,
with the reasoning and the password setup step in `db/README.md`. The access
layer is `lib/db/`.

The short version: one database holds every client's site, every table carries
`tenant_id`, RLS is enabled and forced on all of them, and every policy keys
off a transaction-local setting. With no tenant set that setting is NULL, so a
query that forgets to scope itself returns nothing rather than everything.
`db/isolation-check.sql` tries twenty five ways to break that and expects to
fail at all of them.

```ts
await withTenant(tenantId, async (tx) => {
  await tx`select * from public.pages`;   // this tenant's pages, only
});
```

`withTenant` is the only door. It opens a transaction, sets the tenant as the
first statement, refuses anything that is not a uuid, and refuses a nested
call for a different tenant. `withPublicTenant` is the same thing on the
read-only role, for anything a visitor triggers.

Two roles rather than one: `tg_sites_app` for the editor, `tg_sites_renderer`
for the public site. The renderer cannot write, cannot see a draft and cannot
read the publish history, so a compromised public site cannot become a
compromised database.

## What is deliberately not here

No auth, no media library, no sections library, no widget bridge. The editor
still saves to localStorage: the database and its access layer exist, but the
editor does not call them yet. `commit()` in `EditorShell` already has the
shape `saveDraft` wants.
