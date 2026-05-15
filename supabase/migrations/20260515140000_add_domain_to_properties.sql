-- Add public and admin domain fields to properties table
alter table public.properties
  add column if not exists public_domain text,
  add column if not exists admin_domain text;
