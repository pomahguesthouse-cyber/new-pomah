-- AI Lab config audit + rollback foundation
-- Run through Supabase migrations before enabling rollback actions in production.

create table if not exists public.ai_lab_config_audit (
  id uuid primary key default gen_random_uuid(),
  property_id uuid,
  changed_at timestamptz not null default now(),
  changed_by text default coalesce(auth.uid()::text, 'system'),
  section text not null default 'ai_lab_config',
  reason text not null default 'properties.ai_lab_config update',
  old_value jsonb,
  new_value jsonb
);

create index if not exists ai_lab_config_audit_property_changed_idx
  on public.ai_lab_config_audit(property_id, changed_at desc);

create or replace function public.audit_ai_lab_config_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.ai_lab_config is distinct from new.ai_lab_config then
    insert into public.ai_lab_config_audit(property_id, section, old_value, new_value)
    values (new.id, 'ai_lab_config', old.ai_lab_config, new.ai_lab_config);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_audit_ai_lab_config_update on public.properties;
create trigger trg_audit_ai_lab_config_update
after update of ai_lab_config on public.properties
for each row
execute function public.audit_ai_lab_config_update();

alter table public.ai_lab_config_audit enable row level security;

-- Admin-only policies can be tightened later when role mapping is finalized.
-- For now, authenticated staff can read audit logs through app auth middleware.
drop policy if exists "Authenticated staff can read ai lab audit" on public.ai_lab_config_audit;
create policy "Authenticated staff can read ai lab audit"
  on public.ai_lab_config_audit
  for select
  to authenticated
  using (true);
