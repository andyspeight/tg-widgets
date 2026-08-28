-- ---------------------------------------------------------------------------
-- 0033  A media row can come from AI image generation
-- ---------------------------------------------------------------------------
--
-- WHY. The image bank had two origins, an upload and a Pexels import, and the
-- source column's check constraint listed exactly those two. AI image
-- generation adds a third: a picture the client asked a model to draw, stored
-- in their own bank like any other. It owes no credit (nobody else made it) and
-- it is theirs to move, so it behaves like an upload everywhere except that
-- naming it 'ai' keeps the record honest about where it came from.
--
-- The default stays 'upload'. Only the generate path writes 'ai'.

alter table public.media drop constraint if exists media_source_check;

alter table public.media
  add constraint media_source_check
  check (source in ('upload', 'pexels', 'ai'));
