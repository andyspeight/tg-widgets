# Turning the database on

Written for Andy, 29 July 2026. Five minutes, two browser tabs, one paste.

Everything else is built and tested. This is the only step that needs a human,
because it involves two passwords and a password in a migration is a password
in git.

**Supabase project**: `tg-sites`, ref `qvzbothxlrzeklcvdhzp`, London (eu-west-2)
**Vercel project**: `tg-sites-shell`

---

## Step 1. Get the pooler address

Open <https://supabase.com/dashboard/project/qvzbothxlrzeklcvdhzp>

Click the green **Connect** button at the top of the page. A panel opens.

Find the section called **Transaction pooler**. It shows a connection string
that looks like this:

```
postgresql://postgres.qvzbothxlrzeklcvdhzp:[YOUR-PASSWORD]@aws-0-eu-west-2.pooler.supabase.com:6543/postgres
```

You only need the bit in the middle, the host. It is the part between the `@`
and the `:6543`:

```
aws-0-eu-west-2.pooler.supabase.com
```

Copy that. The `aws-0` might be `aws-1` for this project, which is why you are
copying it rather than trusting what is written here.

---

## Step 2. Set the passwords

Open <https://supabase.com/dashboard/project/qvzbothxlrzeklcvdhzp/sql/new>

Paste the whole block below in. **Before running it**, replace
`PASTE-POOLER-HOST-HERE` on the third line with what you copied in step 1.

```sql
-- Generates two strong passwords, sets them on the two roles, and prints
-- the finished connection strings ready to paste into Vercel.
create temp table setup as
select 'PASTE-POOLER-HOST-HERE'::text as pooler_host,
       'qvzbothxlrzeklcvdhzp'::text   as project_ref,
       replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '') as app_pw,
       replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '') as renderer_pw;

do $$
declare s record;
begin
  select * into s from setup;
  execute format('alter role tg_sites_app      with password %L', s.app_pw);
  execute format('alter role tg_sites_renderer with password %L', s.renderer_pw);
end $$;

select 'DATABASE_URL' as name,
       format('postgresql://tg_sites_app.%s:%s@%s:6543/postgres',
              project_ref, app_pw, pooler_host) as value
from setup
union all
select 'RENDERER_DATABASE_URL',
       format('postgresql://tg_sites_renderer.%s:%s@%s:6543/postgres',
              project_ref, renderer_pw, pooler_host)
from setup;
```

Press **Run**.

You get back two rows, a `name` and a `value`. Those two values are the
finished connection strings. Leave the tab open.

The passwords are 64 characters of hex, generated inside the database. Nobody
has seen them, including me. If you lose them, run the block again and it makes
new ones, which is safe: setting a password just overwrites the old one.

---

## Step 3. Put them into Vercel

Open <https://vercel.com/agendasgroup/tg-sites-shell/settings/environment-variables>

Add two variables. For each one:

1. **Key**: `DATABASE_URL` (then repeat for `RENDERER_DATABASE_URL`)
2. **Value**: the matching `value` from step 2
3. Tick **all three** environments: Production, Preview, Development
4. Leave it as a plain Environment Variable, not a Secret
5. **Save**

---

## Step 4. Check it took

Back in the Supabase SQL editor, run this:

```sql
select rolname,
       case when rolpassword is not null then 'set' else 'MISSING' end as password,
       case when rolcanlogin then 'yes' else 'no' end as can_log_in,
       case when rolbypassrls then 'YES, THIS IS WRONG' else 'no' end as bypasses_security
from pg_authid
where rolname in ('tg_sites_app', 'tg_sites_renderer');
```

You want two rows, both saying `set`, `yes`, `no`.

Nothing will redeploy on its own. The next deploy picks the variables up, and
until the editor actually talks to the database it makes no difference either
way.

---

## If something goes wrong

**"role tg_sites_app does not exist"** — the migrations have not run on this
project. Check you are on `qvzbothxlrzeklcvdhzp` and not another Supabase
project.

**"password authentication failed" later on** — the most likely cause is the
username. Through the pooler it must be `tg_sites_app.qvzbothxlrzeklcvdhzp`,
role and project ref joined by a dot. On a direct connection it is just
`tg_sites_app`.

**Tempted to paste Supabase's own connection string instead** — do not. That
one connects as `postgres`, which bypasses row level security entirely and
would show every client every other client's site. `lib/db/client.ts` refuses
to start if it spots this, but it is worth knowing why.
