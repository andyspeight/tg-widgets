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

Needs `DATABASE_URL` and `RENDERER_DATABASE_URL`. See `db/SETUP.md`.

| Route | What it is |
|---|---|
| `/` | Front door |
| `/sites` | The page list. Create, rename, delete, publish |
| `/editor?page=<id>` | The editor. Saves to Postgres as you type |
| `/preview/<path>` | The published page, server rendered. View source, it is all there |

```bash
npm test                            # 111 tests
npm run typecheck
npm run build
node tools/build-standalone.mjs     # one shareable HTML file
node tools/verify-standalone.mjs    # 37 checks in a real browser
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

So `width` is stored. Section height followed on 29 July for the same reason
and under the same conditions: Andy asked to drag a section taller, and every
CMS an agent has used before lets them.

Those two are the whole list. Everything else that could have been a pixel
value is an enum, and there are no positions, no margins and no
per-breakpoint overrides.

Three rules contain the overrule, enforced in `lib/content/schema.ts` rather
than in the editor, because the editor is not the only thing that can write:

1. Widths are percentages that always sum to 100.
2. No column can go below 10%.
3. Columns always stack on small screens. A row chooses the breakpoint
   (`tablet` or `mobile`), it cannot choose "never".

Rule 3 is what makes free widths safe. Desktop layout is completely open,
and there is still no combination of editor actions that produces horizontal
scroll or an unreadable phone view. Elementor and Duda behave the same way.

Section height is contained the same way: it snaps to the 4px grid so a site
keeps a rhythm, it is clamped at both ends so nothing can be dragged to
nothing or to absurdity, and the HORIZONTAL padding stays a token. A section
can be taller or shorter, never a different shape.

`normaliseSectionPadding` also translates the six names the field used to
hold, so content saved before the change keeps its spacing rather than
silently reverting to a default.

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
- Column widths and section heights ride on CSS custom properties rather than
  on generated rules, so the values are content and the rules stay in the
  stylesheet. They are still set through a `style` attribute, so a strict CSP
  needs `style-src 'unsafe-inline'` until that is replaced with a nonce.
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

## Signing in

Two cookies. `tgs_session` is signed with `SESSION_SECRET` and says who you
are; only the server can write a valid one. `tgs_site` holds a tenant slug and
is not signed, because it is a preference rather than a permission: every read
of it goes through the membership list, so a hand-edited value either names a
site you belong to or is ignored.

**A tenant id only ever comes from the database**, in answer to "which sites
does this user belong to". Nothing accepts one from a request. That is why the
site cookie stores a slug: a slug has to be looked up, and the lookup is the
check.

Three questions run before a tenant is known, and each has its own
transaction-local setting rather than its own privileged function:

| Question | Setting | Door |
| --- | --- | --- |
| Which tenant owns this hostname | none, argument | `resolve_tenant` |
| Who is signing in | `app.login_email` | `findCredentials` |
| Which sites are mine | `app.current_user_id` | `listMemberships` |

`resolve_tenant` is still the only `SECURITY DEFINER` function in the
database, and `db/isolation-check.sql` asserts it.

Identity sits behind `IdentityProvider`, with a scrypt password provider that
works today and a Travelify SSO adapter that throws rather than pretending.
`id.travelify.io` is meant to own identity; `auth_users` exists so the sign-in
path could be finished and tested before those endpoint details arrived, and
can be dropped when they do.

There is no self-service sign-up and should not be one. Make the first account
with:

```
node --experimental-strip-types db/make-user.mjs you@example.com 'a long passphrase' demo
```

It prints SQL to paste into the Supabase editor and touches nothing itself.

## What is deliberately not here

No media library, no sections library, no widget bridge.

**Travelify SSO.** The adapter is written and throws on use. It needs three
facts from the Travelify side: the authorise and token endpoints, the client
credentials, and which claim carries the subject that `tenant_users.user_id`
should match.

**Sessions cannot be revoked one at a time.** The token is signed rather than
stored, so a stolen one stays valid until it expires, and the only way to kill
every session is to rotate `SESSION_SECRET`. The fix, if that ever stops being
the right trade, is a revocation list keyed on the token's `jti`, not a
rewrite.

**No sliding expiry.** Thirty days fixed, so a daily user signs in again once
a month. Renewal needs middleware or an action, and neither is worth adding
until somebody minds.

The dashboard has no browser coverage of its own, where the editor has 43
checks. That gap is why a broken dialog shipped once, and `noUnusedLocals`
now catches that particular shape of it. Worth adding properly before this
grows further.
