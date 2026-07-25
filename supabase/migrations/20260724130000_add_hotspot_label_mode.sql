-- Add per-hotspot label display mode. Separate migration so it also applies to
-- databases where 20260724120000_create_walkthrough_360.sql was already run
-- before the column was added to that file. Idempotent.

alter table public.walkthrough_hotspots
  add column if not exists label_mode text not null default 'hover';

alter table public.walkthrough_hotspots
  drop constraint if exists walkthrough_hotspots_label_mode_chk;

alter table public.walkthrough_hotspots
  add constraint walkthrough_hotspots_label_mode_chk
  check (label_mode in ('hover', 'always'));
