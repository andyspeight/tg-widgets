# The database

Postgres 17 on Supabase. One database, many clients, and the only thing
standing between one travel agent's website and another's is row level
security. That is why this directory has a test suite of its own.

## Files

| File | What it does |
|---|---|
| `migrations/0001_roles_and_helpers.sql` | The two application roles and `current_tenant()` |
| `migrations/0002_core_tables.sql` | `tenants`, `domains`, `tenant_users` |
| `migrations/0003_pages.sql` | `pages`, `publish_events`, the `updated_at` trigger |
| `migrations/0004_future_tables.sql` | `media`, `collections`, `collection_items`, `navigations` |
| `migrations/0005_test_role_membership.sql` | Lets the admin role assume the app roles, so the isolation suite can test them |
| `migrations/0006_resolve_tenant.sql` | `resolve_tenant()`, and the reserved staging suffix |
| `migrations/0007_unwrap_double_encoded_json.sql` | A one-off repair for content stored as a string of JSON |
| `migrations/0008_auth.sql` | `auth_users`, and the login-email setting |
| `migrations/0009_close_public_function_grants.sql` | Takes EXECUTE back off `public`, `anon` and `authenticated` |
| `migrations/0010_fonts.sql` | `fonts` and `font_files`, which the renderer may read and never write |
| `migrations/0011_media.sql` | `media`, and its `updated_at` trigger |
| `migrations/0012_site_settings.sql` | `site_settings`, with the staff-only columns apart |
| `migrations/0013_preview_domain.sql` | The preview subdomain column |
| `migrations/0014_publish_snapshots.sql` | Publish snapshots, with no UPDATE grant so history cannot be edited |
| `migrations/0015_ai_usage.sql` | `ai_usage`, the daily meter |
| `migrations/0016_site_regions.sql` | `site_regions`: the header and footer, with a COLUMN grant rather than a row policy |
| `migrations/0017_collection_items_touch.sql` | The `updated_at` trigger `collection_items` never had |
| `migrations/0018_page_redirects.sql` | `page_redirects`, so renaming a page stops breaking every link to it |
| `migrations/0019_site_invites.sql` | `site_invites`, so a site can have more than one person in it |
| `isolation-check.sql` | 90-odd checks that try to break isolation and expect to fail |

Run them in order. Each is idempotent, so re-running is safe.

## How isolation actually works

Three moving parts, and all three have to hold:

1. **Every table carries `tenant_id`** and has RLS `enabled` *and* `forced`.
   Forced matters: without it the table owner is exempt from its own
   policies.
2. **Every policy compares `tenant_id` to `public.current_tenant()`**, which
   reads a transaction-local setting. With nothing set it returns NULL, and
   `tenant_id = NULL` is not true, so a query that forgets to set the tenant
   returns **zero rows rather than everything**. Failing closed is the design,
   not a happy accident.
3. **Neither application role holds `BYPASSRLS`.** A role that bypasses RLS
   makes every policy in here decorative.

The setting is written by `withTenant` (`lib/db/withTenant.ts`), which wraps
every query in a transaction and makes this its first statement:

```sql
select set_config('app.current_tenant_id', $1, true)
```

The `true` is the local flag. It scopes the value to the transaction, so a
pooled connection cannot carry one client's tenant into the next request.
Nothing in the application may query outside `withTenant`, and
`tests/db.test.ts` fails the build if anything imports the pool directly.

## The one thing that runs before a tenant is known

A request arrives knowing only a hostname. The lookup that turns a hostname
into a tenant lives in `domains`, which is itself behind RLS keyed on the
tenant we do not have yet. Done naively that lookup returns nothing and every
request 404s.

`resolve_tenant(host)` breaks the loop. It is `SECURITY DEFINER`, so it is the
only thing in this database that sees past RLS, and it is kept as small as
that privilege allows: a hostname in, one uuid out, nothing else reachable.
The isolation suite asserts there is exactly one such function, so a second
one cannot be added quietly.

Every tenant is reachable at `{slug}.travelgenixsites.com` before any DNS is
pointed, and that suffix is reserved by a check constraint on `domains`.
Without it, one tenant could register another's preview hostname as a custom
domain and the resolver would have two honest answers.

The suffix is a separate registrable domain, not a subdomain of `travelify.io`,
and that is deliberate: site owners can inject script, and the `tg_session`
cookie is scoped to `.travelify.io` across five other products. See
`0013_preview_domain.sql` and `tg-sites/lib/domains/preview.ts`. It has been the
wrong domain twice, so the suffix is written in one TypeScript module and the
tests read the migrations to check the SQL agrees.

## The two roles

| Role | Used by | Can do |
|---|---|---|
| `tg_sites_app` | The editor and its API | Read and write its own tenant's rows |
| `tg_sites_renderer` | The public website | Read published rows of its own tenant. Nothing else |

The renderer is separate on purpose. If the public site is ever compromised,
the credential it holds cannot write anything, cannot see a draft, and cannot
read the publish history.

`anon` and `authenticated` (Supabase's PostgREST roles) are revoked from every
table outright. RLS would return nothing to them anyway, but a table nobody
can reach beats a table that returns nothing.

## Setting the role passwords

Both roles are created with `LOGIN` but **no password**, so neither can
authenticate yet. That is deliberate: a password in a migration is a password
in git.

**Step by step, with the right URLs and a block to paste: [SETUP.md](./SETUP.md).**

The short version, in the Supabase SQL editor:

```sql
alter role tg_sites_app      with password 'generate-a-long-random-one';
alter role tg_sites_renderer with password 'generate-a-different-one';
```

Then put the connection strings in the environment, never in the repo:

```
DATABASE_URL=postgresql://tg_sites_app:PASSWORD@HOST:6543/postgres
RENDERER_DATABASE_URL=postgresql://tg_sites_renderer:PASSWORD@HOST:6543/postgres
```

Port 6543 is Supabase's transaction pooler. It suits serverless, and
`set_config(..., true)` is transaction-scoped so it works correctly through
it. Port 5432 is the direct connection, for migrations and psql.

Supabase's own `postgres` and `service_role` credentials should not be used by
the application at all. Both bypass RLS.

## Proving it, rather than assuming it

```bash
psql "$DATABASE_URL" -f db/isolation-check.sql
```

Or paste it into the Supabase SQL editor. It seeds two tenants, tries every
route one could take to the other's data, prints a PASS or FAIL per check and
removes its own fixtures. **Any FAIL is a ship blocker.**

Last run, 29 July 2026: 25 of 25 pass, and Supabase reports no security
advisors.

Run it again after any migration that adds a table or touches a policy. A new
table without RLS is the single most likely way this gets broken, and the
suite catches exactly that.

The TypeScript half is covered separately by `npm test`, which stands a fake
driver in for Postgres and asserts on the exact sequence of statements: that
the tenant is set first, that nothing runs outside a transaction, and that a
nested call for a second tenant is refused. Those are ordering properties, and
ordering is not something reading rows back can show you.

### Three traps this file survived

Written down because all three produced a green run that proved nothing:

1. **Catching an exception in PL/pgSQL rolls back that block's
   subtransaction**, which silently undoes any `SET LOCAL ROLE` made inside
   it. The rest of the script then runs as the admin role, which bypasses
   RLS, and everything passes. Set the role outside the exception block.
2. **`set_config(..., true)` lasts for the whole transaction**, not for one
   block. A later block testing "no tenant set" is still holding the tenant an
   earlier block set, so the single most important check becomes a no-op. It
   has to clear the value explicitly.
3. **Absolute row counts are fragile.** One row left behind by someone poking
   at the database makes a correct policy look broken. Every count is scoped
   to the script's own fixture ids.
