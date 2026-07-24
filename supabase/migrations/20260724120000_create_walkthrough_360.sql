-- ============================================================
-- 360° Walkthrough (virtual tour) — per room type
-- ============================================================
-- One tour per room_type, made of ordered 360° scenes (equirectangular
-- photos) connected by navigation hotspots. Public viewer reads only
-- published tours; admins (authenticated) have full access.
-- ============================================================

-- ── Storage bucket for equirectangular 360 photos ───────────────────────────
insert into storage.buckets (id, name, public)
values ('walkthrough-360', 'walkthrough-360', true)
on conflict (id) do update set public = true;

drop policy if exists "walkthrough-360 public read" on storage.objects;
create policy "walkthrough-360 public read"
  on storage.objects for select
  using (bucket_id = 'walkthrough-360');

drop policy if exists "walkthrough-360 staff insert" on storage.objects;
create policy "walkthrough-360 staff insert"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'walkthrough-360');

drop policy if exists "walkthrough-360 staff update" on storage.objects;
create policy "walkthrough-360 staff update"
  on storage.objects for update to authenticated
  using (bucket_id = 'walkthrough-360')
  with check (bucket_id = 'walkthrough-360');

drop policy if exists "walkthrough-360 staff delete" on storage.objects;
create policy "walkthrough-360 staff delete"
  on storage.objects for delete to authenticated
  using (bucket_id = 'walkthrough-360');

-- ── Tables ──────────────────────────────────────────────────────────────────
create table if not exists public.walkthrough_tours (
  id               uuid primary key default gen_random_uuid(),
  property_id      uuid references public.properties(id) on delete cascade,
  room_type_id     uuid not null references public.room_types(id) on delete cascade,
  title            text,
  is_published     boolean not null default false,
  default_scene_id uuid,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (room_type_id)
);

create table if not exists public.walkthrough_scenes (
  id          uuid primary key default gen_random_uuid(),
  tour_id     uuid not null references public.walkthrough_tours(id) on delete cascade,
  title       text,
  image_path  text not null,
  image_url   text not null,
  order_index integer not null default 0,
  created_at  timestamptz not null default now()
);

create table if not exists public.walkthrough_hotspots (
  id              uuid primary key default gen_random_uuid(),
  scene_id        uuid not null references public.walkthrough_scenes(id) on delete cascade,
  target_scene_id uuid references public.walkthrough_scenes(id) on delete cascade,
  type            text not null default 'scene' check (type in ('scene', 'info')),
  label           text,
  -- 'hover' = show label only on hover (default), 'always' = label always visible.
  label_mode      text not null default 'hover' check (label_mode in ('hover', 'always')),
  pitch           numeric not null default 0,
  yaw             numeric not null default 0,
  created_at      timestamptz not null default now()
);

-- default_scene_id points at a scene once one exists (added after scenes table).
alter table public.walkthrough_tours
  drop constraint if exists walkthrough_tours_default_scene_fk;
alter table public.walkthrough_tours
  add constraint walkthrough_tours_default_scene_fk
  foreign key (default_scene_id) references public.walkthrough_scenes(id) on delete set null;

create index if not exists idx_walkthrough_scenes_tour   on public.walkthrough_scenes (tour_id, order_index);
create index if not exists idx_walkthrough_hotspots_scene on public.walkthrough_hotspots (scene_id);
create index if not exists idx_walkthrough_tours_roomtype on public.walkthrough_tours (room_type_id);

-- ── RLS ─────────────────────────────────────────────────────────────────────
alter table public.walkthrough_tours    enable row level security;
alter table public.walkthrough_scenes   enable row level security;
alter table public.walkthrough_hotspots enable row level security;

-- Public (anon) may read only PUBLISHED tours and their scenes/hotspots.
drop policy if exists "walkthrough_tours public read" on public.walkthrough_tours;
create policy "walkthrough_tours public read"
  on public.walkthrough_tours for select
  using (is_published = true);

drop policy if exists "walkthrough_scenes public read" on public.walkthrough_scenes;
create policy "walkthrough_scenes public read"
  on public.walkthrough_scenes for select
  using (exists (
    select 1 from public.walkthrough_tours t
    where t.id = walkthrough_scenes.tour_id and t.is_published = true
  ));

drop policy if exists "walkthrough_hotspots public read" on public.walkthrough_hotspots;
create policy "walkthrough_hotspots public read"
  on public.walkthrough_hotspots for select
  using (exists (
    select 1
    from public.walkthrough_scenes s
    join public.walkthrough_tours t on t.id = s.tour_id
    where s.id = walkthrough_hotspots.scene_id and t.is_published = true
  ));

-- Authenticated staff have full access (admin builder).
drop policy if exists "walkthrough_tours staff all" on public.walkthrough_tours;
create policy "walkthrough_tours staff all"
  on public.walkthrough_tours for all to authenticated
  using (true) with check (true);

drop policy if exists "walkthrough_scenes staff all" on public.walkthrough_scenes;
create policy "walkthrough_scenes staff all"
  on public.walkthrough_scenes for all to authenticated
  using (true) with check (true);

drop policy if exists "walkthrough_hotspots staff all" on public.walkthrough_hotspots;
create policy "walkthrough_hotspots staff all"
  on public.walkthrough_hotspots for all to authenticated
  using (true) with check (true);
