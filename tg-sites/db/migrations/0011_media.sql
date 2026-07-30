-- The image bank: uploads and Pexels imports, per tenant.
--
-- The media table already exists, created empty by 0004_future_tables.sql so its
-- row level security would be written by someone with the isolation rules fresh
-- in mind rather than bolted on in a hurry. Those policies are still right and
-- are not touched here. This migration only fills in the columns the feature
-- turned out to need.
--
-- WHERE THE BYTES LIVE, AND WHY IT IS NOT POSTGRES THIS TIME
--
-- 0010_fonts.sql put font bytes in a bytea column and named the threshold for
-- changing that: images, because they are bigger and far more numerous. This is
-- that feature. It predicted Supabase Storage. It got Vercel Blob, for three
-- reasons that all point the same way.
--
-- Supabase Storage is reached over the Supabase HTTP API with a service_role
-- key, and that key bypasses row level security completely. lib/db/client.ts
-- exists to keep exactly that credential out of this application. Adding it back
-- to hold some JPEGs would undo the thing the isolation suite proves.
--
-- Vercel Blob needs no such key. It takes a store token that can write blobs and
-- nothing else, cannot see this database, and is already how the widget suite
-- stores offer photos and client logos: api/upload-photo.js in the same
-- repository mints a short-lived client token so the bytes go from the browser
-- straight to the store. That matters more than it sounds. A serverless function
-- has a 4.5MB request body limit, so any upload path that passes the file
-- THROUGH the server caps out below the size of a photograph off a modern phone.
--
-- And this table was designed for an object store from the start. storage_key is
-- the column that has been waiting for it.
--
-- Fonts stay in Postgres. They are tens of kilobytes, there are one or two per
-- site, and moving them would change a working route for no gain.
--
-- WHAT IS NOT IN HERE
--
-- No thumbnail or derivative columns. The bank shows the original scaled down by
-- the browser, and the upload path downscales before sending, so an 8MB camera
-- JPEG arrives as a few hundred kilobytes rather than being stored at full size
-- and shrunk on every view. If real responsive sizes are wanted later they are a
-- second table, not more columns here.

-- ---------------------------------------------------------------------------
-- The columns the feature needs
-- ---------------------------------------------------------------------------

alter table public.media
  -- The name the file had when it arrived, cleaned. This is how a person finds
  -- the thing they uploaded twenty images ago, so it is worth keeping even
  -- though nothing technical depends on it.
  add column if not exists filename text not null default '',

  -- The public URL to serve.
  --
  -- Stored rather than derived, because a Vercel Blob URL cannot be rebuilt from
  -- the pathname: the host carries the store id and the path carries a random
  -- suffix the store chooses. Deriving it would work in development against one
  -- store and break against another.
  add column if not exists url text not null default '',

  -- Where it came from. Drives the credit line and tells a client which images
  -- are theirs to move elsewhere and which came with a licence attached.
  add column if not exists source text not null default 'upload'
    check (source in ('upload', 'pexels')),

  /*
   * Attribution, for anything that came from a library.
   *
   * The Pexels licence does not require credit on the page, but the Pexels API
   * terms DO require the photographer to be credited and a link back to Pexels
   * wherever their photos appear. Storing it at import time is the only moment
   * the information exists: search results are not kept, so if the credit is not
   * captured here it cannot be recovered later without matching the image back
   * up by eye.
   *
   * Shape: { photographer, photographerUrl, providerUrl, providerId }. Empty for
   * an upload.
   */
  add column if not exists credit jsonb not null default '{}'::jsonb,

  add column if not exists updated_at timestamptz not null default now();

-- The defaults above exist so the ALTER can run at all. Every one of these is
-- required in practice, and the table is empty, so drop the defaults that would
-- otherwise let a caller insert a row with no url and no filename.
alter table public.media alter column filename drop default;
alter table public.media alter column url      drop default;

-- ---------------------------------------------------------------------------
-- Guards on what can be stored
-- ---------------------------------------------------------------------------

/*
 * The mime whitelist, and the one format that is deliberately missing.
 *
 * SVG is not on this list. An SVG is an XML document that can carry script and
 * external references, so serving one from the same origin as the editor would
 * be handing anybody who can upload a file a way to run code in a signed-in
 * session. The widget suite's own upload route refuses it for the same reason.
 * If vector logos are wanted later they need their own path, sanitised, not a
 * sixth entry here.
 *
 * Written as a constraint rather than left to the application because this is
 * the last line: the upload token restricts content types too, but the token is
 * minted by code and this is enforced by the database.
 */
alter table public.media
  drop constraint if exists media_mime_allowed;
alter table public.media
  add constraint media_mime_allowed check (
    mime in ('image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/gif')
  );

/*
 * An upper bound on size, which the existing check did not have.
 *
 * 15MB is generous on purpose. The browser downscales before uploading, so a
 * normal photograph lands at well under a megabyte and this ceiling is only
 * reached by something that skipped that path. It is here to stop the store
 * filling up, not to police quality.
 */
alter table public.media
  drop constraint if exists media_bytes_check;
alter table public.media
  add constraint media_bytes_check check (bytes > 0 and bytes <= 15728640);

-- Pixel dimensions stay nullable: an upload has them because the browser
-- measured the image on its way past, and a Pexels import has them because the
-- API reports them, but neither is worth failing an insert over.
alter table public.media
  drop constraint if exists media_dimensions_sane;
alter table public.media
  add constraint media_dimensions_sane check (
    (width  is null or (width  > 0 and width  <= 20000)) and
    (height is null or (height > 0 and height <= 20000))
  );

-- ---------------------------------------------------------------------------
-- Ordering
-- ---------------------------------------------------------------------------

-- The bank is always read newest first, scoped to one tenant. Without this the
-- listing sorts in memory, which is fine at ten images and not at two thousand.
create index if not exists media_tenant_created_idx
  on public.media (tenant_id, created_at desc);

-- OR REPLACE, not a plain CREATE. Postgres has no CREATE TRIGGER IF NOT EXISTS,
-- and every other statement in this file can be run twice without complaint. One
-- that cannot turns a re-run into a half-applied migration, which is worse than
-- either outcome.
create or replace trigger media_touch before update on public.media
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Row level security and grants: already correct, restated for the reader
-- ---------------------------------------------------------------------------

-- 0004 enabled and FORCED row level security on this table, gave tg_sites_app
-- read and write scoped to current_tenant(), gave tg_sites_renderer select on
-- the same condition, and revoked everything from public, anon and
-- authenticated. Nothing here changes any of that.
--
-- The renderer needs select for the same reason it needs to read font files: an
-- image on a published page is fetched by a browser with no session. In this
-- case it is only reading the row, not the bytes, because the bytes are served
-- by the blob store's own CDN and never pass through this database.
