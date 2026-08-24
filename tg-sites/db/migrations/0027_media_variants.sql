-- ---------------------------------------------------------------------------
-- 0027  The smaller copies of an image
-- ---------------------------------------------------------------------------
--
-- A visitor on a 390px phone downloads the 2400px file. Measured on 23 Aug 2026
-- with npm run perf: one hero image was 450 KB of a 482 KB page, and the largest
-- paint landed at 2676 ms on slow 4G with no server time in the measurement at
-- all. Nothing else on a published page is within an order of magnitude of it.
--
-- Uploads have been re-encoded to WebP at up to 2400px for a long time, so the
-- format was never the problem. The size was. The browser now also encodes 400,
-- 800 and 1600px copies from the same decoded bitmap, and this column is where
-- the addresses of those copies live so the renderer can build an srcset.
--
-- WHY A COLUMN ON media AND NOT A TABLE OF ITS OWN. A variant has no identity
-- worth addressing: nothing links to one, nothing edits one, and the only
-- question ever asked is "what other sizes does THIS picture have", which is a
-- property of the row you already have. A join table would buy referential
-- tidiness and cost a join on the one query that runs on every page view.
--
-- WHY jsonb AND NOT AN ARRAY OF URLS. The renderer needs the width to build an
-- srcset, and it needs it without fetching anything. A bare url array would mean
-- parsing a width back out of a filename, which is the kind of thing that works
-- until somebody uploads a picture called "photo-800.webp".
--
-- SHAPE, and it is read defensively rather than trusted:
--   [{ "url": "...", "width": 800, "height": 533, "bytes": 41234 }]
--
-- DEFAULT '[]' AND NOT NULL, so every row that predates this reads as "no
-- variants" rather than as null. That is the honest answer for them and it is
-- also the safe one: an empty list makes the renderer emit a single src, which
-- is exactly what it does today. Nothing regresses on an old image, it simply
-- does not improve until it is re-uploaded or a backfill runs.
--
-- NO BACKFILL HERE. Regenerating variants for images already in the bank means
-- re-decoding originals, which is a job for a tool that can be watched and
-- retried, not for a migration that has to be atomic and fast.

alter table public.media
  add column if not exists variants jsonb not null default '[]'::jsonb;

comment on column public.media.variants is
  'Smaller copies of this image for an srcset: [{url,width,height,bytes}]. Empty means the single original is all there is.';
