-- Editable public slug for each room-type 360° tour. When set, the public
-- viewer is reachable at /tour/<slug>. Falls back to the room type's own slug
-- when empty. Unique among non-null slugs.

alter table public.walkthrough_tours
  add column if not exists slug text;

create unique index if not exists idx_walkthrough_tours_slug
  on public.walkthrough_tours (slug)
  where slug is not null;
