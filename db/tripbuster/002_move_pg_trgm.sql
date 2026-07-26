-- ============================================================================
-- Tripbuster 002 — move pg_trgm out of the public schema
-- ============================================================================
-- Supabase's database linter flags extensions living in `public`. Keep public for
-- application tables only. Existing indexes bind the operator class by OID, so
-- relocating the extension leaves deals_resort_trgm working.
--
-- Anything querying the trigram operators (%) needs `extensions` on its
-- search_path — tb_search_deals pins `search_path = public, extensions` for this
-- reason.
-- ============================================================================

create schema if not exists extensions;
alter extension pg_trgm set schema extensions;
grant usage on schema extensions to postgres, anon, authenticated, service_role;
