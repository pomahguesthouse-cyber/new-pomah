-- Keyword briefs + verified landmarks for /lp builder pages.
-- Lovable deploy does NOT run migrations. Apply this file manually after deploy.
-- Until it is applied, the app must keep working: brief/landmark queries
-- treat a missing table as empty and do not throw on public pages.

-- 1. Landmarks. Public reads only verified rows. Staff manage every row.
create table if not exists public.seo_landmarks (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text not null default 'lainnya',
  lat double precision,
  lng double precision,
  road_distance_km numeric(6,2),
  travel_minutes integer,
  verified boolean not null default false,
  notes text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint seo_landmarks_name_key unique (name)
);

comment on table public.seo_landmarks is
  'Jarak dari Pomah Guesthouse. Hanya baris verified=true yang boleh dipakai sebagai klaim jarak di halaman publik.';

alter table public.seo_landmarks enable row level security;

drop policy if exists "Public read verified landmarks" on public.seo_landmarks;
create policy "Public read verified landmarks"
  on public.seo_landmarks
  for select
  to anon, authenticated
  using (verified = true);

drop policy if exists "Staff manage landmarks" on public.seo_landmarks;
create policy "Staff manage landmarks"
  on public.seo_landmarks
  for all
  to authenticated
  using (public.is_staff(auth.uid()))
  with check (public.is_staff(auth.uid()));

grant select on table public.seo_landmarks to anon, authenticated;
grant insert, update, delete on table public.seo_landmarks to authenticated;

-- 2. Briefs. Staff only. Owner sets status to approved before generation.
create table if not exists public.seo_landing_briefs (
  id uuid primary key default gen_random_uuid(),
  primary_keyword text not null,
  secondary_keywords text[] not null default '{}',
  intent text not null default '',
  slug text not null,
  target_audience text not null default '',
  unique_angle text not null default '',
  landmark_ids uuid[] not null default '{}',
  faq_seeds text[] not null default '{}',
  review_keywords text[] not null default '{}',
  explore_slugs text[] not null default '{}',
  room_type_ids uuid[] not null default '{}',
  min_capacity integer,
  status text not null default 'draft',
  landing_page_id uuid references public.seo_landing_pages(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint seo_landing_briefs_status_check check (status in ('draft', 'approved', 'generated')),
  constraint seo_landing_briefs_slug_key unique (slug)
);

comment on table public.seo_landing_briefs is
  'Brief keyword landing page. Generasi AI hanya jalan setelah status approved.';

alter table public.seo_landing_briefs enable row level security;

drop policy if exists "Staff manage landing briefs" on public.seo_landing_briefs;
create policy "Staff manage landing briefs"
  on public.seo_landing_briefs
  for all
  to authenticated
  using (public.is_staff(auth.uid()))
  with check (public.is_staff(auth.uid()));

grant select, insert, update, delete on table public.seo_landing_briefs to authenticated;

-- 3. Landing page columns used by the generator and the explore backlink.
alter table public.seo_landing_pages
  add column if not exists brief_id uuid,
  add column if not exists related_explore_slugs text[] not null default '{}';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'seo_landing_pages_brief_id_fkey'
  ) then
    alter table public.seo_landing_pages
      add constraint seo_landing_pages_brief_id_fkey
      foreign key (brief_id) references public.seo_landing_briefs(id) on delete set null;
  end if;
exception
  when duplicate_object then null;
end $$;

-- 4. Approximate landmark seeds. verified=false until staff checks the road distance.
insert into public.seo_landmarks
  (name, category, lat, lng, road_distance_km, travel_minutes, verified, notes, sort_order)
values
  ('Unwahas Menoreh', 'kampus', -7.0152, 110.3964, 1.5, 5, false, 'Perkiraan dari Pomah (-7.0209, 110.3881). Belum diverifikasi.', 10),
  ('UNIKA Soegijapranata', 'kampus', -6.9988, 110.4092, 4.2, 12, false, 'Perkiraan kampus Bendan Duwur. Belum diverifikasi.', 20),
  ('UNNES Sekaran', 'kampus', -7.0508, 110.3922, 4.7, 11, false, 'Perkiraan. Angka mengikuti salinan yang sudah disetujui, tetap unverified sampai diukur ulang.', 30),
  ('UNNES Kampus Sampangan', 'kampus', -6.9978, 110.4098, 3.5, 9, false, 'Perkiraan Kelud Utara III. Belum diverifikasi.', 40),
  ('RSUP Kariadi', 'rumah sakit', -6.9934, 110.4072, 5.0, 15, false, 'Perkiraan. Belum diverifikasi.', 50),
  ('Sam Poo Kong', 'wisata', -6.9965, 110.3984, 4.0, 12, false, 'Perkiraan. Belum diverifikasi.', 60),
  ('Goa Kreo', 'wisata', -7.0384, 110.3476, 6.5, 16, false, 'Perkiraan. Belum diverifikasi.', 70),
  ('Lawang Sewu', 'wisata', -6.9839, 110.4105, 6.0, 15, false, 'Perkiraan. Belum diverifikasi.', 80),
  ('Simpang Lima', 'pusat kota', -6.9903, 110.4228, 6.2, 18, false, 'Perkiraan. Belum diverifikasi.', 90)
on conflict (name) do nothing;

-- 5. Programmatic seo_generated_pages stay in the database but are not public.
drop policy if exists "anyone read published generated pages" on public.seo_generated_pages;

notify pgrst, 'reload schema';
