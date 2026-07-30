-- Take EXECUTE away from PUBLIC on every function in this schema.
--
-- WHY THIS EXISTS
--
-- Postgres grants EXECUTE to PUBLIC on every function the moment it is
-- created. resolve_tenant revokes it explicitly, because it is SECURITY
-- DEFINER and the consequences are obvious. The three settings helpers did
-- not, so anon and authenticated could call current_tenant(), current_user_id()
-- and login_email().
--
-- That is not a hole. All three read one session setting and return text; they
-- touch no table, and both PostgREST roles have had every table privilege in
-- this schema revoked anyway. Calling them as anon returns NULL, which is the
-- same nothing you get for free.
--
-- It is closed anyway for one reason: the invariant the isolation suite can
-- then assert is "anon can execute nothing in public", which is a single line
-- anyone can check. The alternative is a list of exceptions that are each
-- individually fine, and a list like that is where the fourth one hides.
--
-- ORDER MATTERS. touch_updated_at is a trigger function with no explicit grant
-- of its own, so it has been running on the PUBLIC grant this whole time.
-- Revoking that first would break updated_at on every table. The explicit
-- grants go in before anything is taken away.

grant execute on function public.current_tenant()   to tg_sites_app, tg_sites_renderer;
grant execute on function public.current_user_id()  to tg_sites_app, tg_sites_renderer;
grant execute on function public.login_email()      to tg_sites_app;
grant execute on function public.touch_updated_at() to tg_sites_app;

revoke execute on function public.current_tenant()   from public, anon, authenticated;
revoke execute on function public.current_user_id()  from public, anon, authenticated;
revoke execute on function public.login_email()      from public, anon, authenticated;
revoke execute on function public.touch_updated_at() from public, anon, authenticated;
