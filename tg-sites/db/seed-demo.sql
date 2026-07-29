-- One tenant to build against.
--
-- Not fixture data for a test, and not a migration either: it is the first
-- real row, so the editor has something to open before there is any way to
-- create a site through the UI. Safe to re-run.
--
-- Delete it once real clients exist. Nothing references it by id.

insert into public.tenants (slug, name, plan, status)
values ('demo', 'Demo Travel', 'ignite', 'active')
on conflict (slug) do nothing;

-- The staging hostname (demo.tgsites.io) resolves without a domains row,
-- because resolve_tenant derives it from the slug. A custom domain is added
-- here so the other half of the resolver has something to answer with too.
insert into public.domains (tenant_id, hostname, is_primary, ssl_status)
select id, 'demo-travel.example', true, 'pending'
from public.tenants where slug = 'demo'
on conflict (hostname) do nothing;

select id, slug, name, plan from public.tenants where slug = 'demo';
