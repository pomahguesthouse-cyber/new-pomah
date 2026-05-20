-- Migration: Create AI-native SEO structures
-- 1. Keywords Intelligence
create table if not exists public.seo_keywords (
  id uuid primary key default gen_random_uuid(),
  keyword text unique not null,
  search_volume integer default 0,
  difficulty integer default 0, -- 0-100
  intent text check (intent in ('informational', 'commercial', 'transactional', 'navigational')),
  priority text default 'medium' check (priority in ('high', 'medium', 'low')),
  ranking_position integer,
  traffic_opportunity numeric(10,2) default 0.0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 2. SEO Content Tasks / Articles
create table if not exists public.seo_content_tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  type text default 'article' check (type in ('article', 'landing_page', 'faq')),
  status text default 'draft' check (status in ('draft', 'reviewing', 'published')),
  keyword_focus text,
  readability_score integer default 0,
  seo_score integer default 0,
  content text,
  meta_title text,
  meta_description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 3. Conversational SEO (FAQ insights extracted from WhatsApp)
create table if not exists public.seo_faq_insights (
  id uuid primary key default gen_random_uuid(),
  question text not null,
  recurring_count integer default 1,
  source_conversations jsonb not null default '[]'::jsonb, -- snippets from chats
  suggested_answer text,
  status text default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 4. SEO Agent Logs & Actions
create table if not exists public.seo_agent_logs (
  id uuid primary key default gen_random_uuid(),
  agent_key text not null,
  task_description text not null,
  status text not null check (status in ('running', 'completed', 'failed')),
  details text,
  created_at timestamptz not null default now()
);

-- 5. Programmatic SEO Generated Pages
create table if not exists public.seo_generated_pages (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  title text not null,
  content text,
  meta_title text,
  meta_description text,
  schema_markup jsonb not null default '{}'::jsonb,
  published boolean default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 6. Schema Registry
create table if not exists public.seo_schema_registry (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  schema_type text not null, -- Hotel, FAQPage, LocalBusiness, etc.
  json_ld jsonb not null,
  active boolean default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 7. Internal Link Mapping
create table if not exists public.seo_internal_links (
  id uuid primary key default gen_random_uuid(),
  source_url text not null,
  target_url text not null,
  anchor_text text not null,
  suggested_by_ai boolean default true,
  status text default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now()
);

-- 8. Review Intelligence
create table if not exists public.seo_review_analysis (
  id uuid primary key default gen_random_uuid(),
  review_source text not null, -- Google Maps, Traveloka, Agoda, WA Feedback
  guest_name text,
  rating integer,
  content text,
  sentiment text check (sentiment in ('positive', 'neutral', 'negative')),
  extracted_keywords jsonb not null default '[]'::jsonb,
  seo_suggestions jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

-- 9. AI Search Visibility Tracker
create table if not exists public.seo_ai_visibility (
  id uuid primary key default gen_random_uuid(),
  engine text not null, -- ChatGPT, Gemini, Perplexity, Google AI Overview
  mention_count integer default 0,
  visibility_score integer default 0, -- 0-100
  uncovered_topics jsonb not null default '[]'::jsonb,
  last_checked timestamptz not null default now()
);

-- Enable Row Level Security (RLS) for all tables
alter table public.seo_keywords enable row level security;
alter table public.seo_content_tasks enable row level security;
alter table public.seo_faq_insights enable row level security;
alter table public.seo_agent_logs enable row level security;
alter table public.seo_generated_pages enable row level security;
alter table public.seo_schema_registry enable row level security;
alter table public.seo_internal_links enable row level security;
alter table public.seo_review_analysis enable row level security;
alter table public.seo_ai_visibility enable row level security;

-- Setup staff-only write/read access policies
create policy "staff manage seo_keywords" on public.seo_keywords for all to authenticated using (is_staff(auth.uid())) with check (is_staff(auth.uid()));
create policy "staff manage seo_content_tasks" on public.seo_content_tasks for all to authenticated using (is_staff(auth.uid())) with check (is_staff(auth.uid()));
create policy "staff manage seo_faq_insights" on public.seo_faq_insights for all to authenticated using (is_staff(auth.uid())) with check (is_staff(auth.uid()));
create policy "staff manage seo_agent_logs" on public.seo_agent_logs for all to authenticated using (is_staff(auth.uid())) with check (is_staff(auth.uid()));
create policy "staff manage seo_generated_pages" on public.seo_generated_pages for all to authenticated using (is_staff(auth.uid())) with check (is_staff(auth.uid()));
create policy "staff manage seo_schema_registry" on public.seo_schema_registry for all to authenticated using (is_staff(auth.uid())) with check (is_staff(auth.uid()));
create policy "staff manage seo_internal_links" on public.seo_internal_links for all to authenticated using (is_staff(auth.uid())) with check (is_staff(auth.uid()));
create policy "staff manage seo_review_analysis" on public.seo_review_analysis for all to authenticated using (is_staff(auth.uid())) with check (is_staff(auth.uid()));
create policy "staff manage seo_ai_visibility" on public.seo_ai_visibility for all to authenticated using (is_staff(auth.uid())) with check (is_staff(auth.uid()));

-- Setup public read policy for published programmatic pages
create policy "anyone read published generated pages" on public.seo_generated_pages for select to anon, authenticated using (published = true);

-- Add update triggers to automatically handle updated_at timestamps
create trigger seo_keywords_set_updated_at before update on public.seo_keywords for each row execute function public.set_updated_at();
create trigger seo_content_tasks_set_updated_at before update on public.seo_content_tasks for each row execute function public.set_updated_at();
create trigger seo_faq_insights_set_updated_at before update on public.seo_faq_insights for each row execute function public.set_updated_at();
create trigger seo_generated_pages_set_updated_at before update on public.seo_generated_pages for each row execute function public.set_updated_at();
create trigger seo_schema_registry_set_updated_at before update on public.seo_schema_registry for each row execute function public.set_updated_at();

-- Notify PostgREST to reload schema
notify pgrst, 'reload schema';
