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
| `isolation-check.sql` | 17 checks that try to break isolation and expect to fail |

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

The setting is written by `withTenant`, which wraps every query in a
transaction and does:

```sql
select set_config('app.current_tenant_id', $1, true)
```

The `true` is the local flag. It scopes the value to the transaction, so a
pooled connection cannot carry one client's tenant into the next request.
Nothing in the application may query outside `withTenant`.

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

Set them once, out of band, in the Supabase SQL editor:

```sql
alter role tg_sites_app      with password 'generate-a-long-random-one';
alter role tg_sites_renderer with password 'generate-a-different-one';
```

Generate them with something like `openssl rand -base64 32`. Then put the
connection strings in the environment, never in the repo:

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

Last run, 29 July 2026: 17 of 17 pass, and Supabase reports no security
advisors.

Run it again after any migration that adds a table or touches a policy. A new
table without RLS is the single most likely way this gets broken, and the
suite catches exactly that.

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
