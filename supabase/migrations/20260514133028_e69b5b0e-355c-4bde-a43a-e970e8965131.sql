
create table public.seasonal_rates (
  id uuid primary key default gen_random_uuid(),
  room_type_id uuid not null,
  name text not null,
  start_date date not null,
  end_date date not null,
  multiplier numeric not null default 1.0,
  nightly_rate numeric,
  min_stay integer not null default 1,
  created_at timestamptz not null default now()
);
alter table public.seasonal_rates enable row level security;
create policy "anyone read seasonal_rates" on public.seasonal_rates for select to anon, authenticated using (true);
create policy "staff write seasonal_rates" on public.seasonal_rates for all to authenticated using (is_staff(auth.uid())) with check (is_staff(auth.uid()));

create table public.ai_conversation_logs (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid,
  user_message text,
  ai_response text not null,
  rating text check (rating in ('good','bad')),
  correction text,
  used boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.ai_conversation_logs enable row level security;
create policy "staff manage ai_logs" on public.ai_conversation_logs for all to authenticated using (is_staff(auth.uid())) with check (is_staff(auth.uid()));
-- allow inserts from server-side auth context (still staff-gated by middleware, but draftAiReply runs as the staff user)

create table public.seo_pages (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  title text not null,
  description text,
  og_image_url text,
  updated_at timestamptz not null default now()
);
alter table public.seo_pages enable row level security;
create policy "anyone read seo_pages" on public.seo_pages for select to anon, authenticated using (true);
create policy "staff write seo_pages" on public.seo_pages for all to authenticated using (is_staff(auth.uid())) with check (is_staff(auth.uid()));
create trigger seo_pages_set_updated_at before update on public.seo_pages for each row execute function public.set_updated_at();

insert into public.seo_pages (slug, title, description) values
  ('/', 'Pomah Guesthouse — Boutique stays, AI-native hospitality', 'A small house run with great care. Book direct, message us on WhatsApp.'),
  ('/rooms', 'Rooms — Pomah Guesthouse', 'A small, considered selection of rooms in our boutique guesthouse.'),
  ('/book', 'Book direct — Pomah Guesthouse', 'Reserve your stay in seconds. No commissions, better rates.');
