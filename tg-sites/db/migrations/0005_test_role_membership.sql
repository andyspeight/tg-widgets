-- Let the admin role assume the two application roles.
--
-- Needed so the isolation suite can run AS tg_sites_app and tg_sites_renderer
-- rather than testing a set of policies while connected as a role that
-- bypasses all of them, which would prove nothing.
--
-- This does not weaken anything: postgres already holds BYPASSRLS, so it
-- could always see everything. The application itself never connects as
-- postgres, only as the two restricted roles.

grant tg_sites_app to postgres;
grant tg_sites_renderer to postgres;
