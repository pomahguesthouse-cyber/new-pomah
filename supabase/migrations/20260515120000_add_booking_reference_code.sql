-- Add a human-readable reference code to bookings (e.g. "PG-MYH90").
-- The UUID `id` remains the primary key; this column is purely for display.
-- Uses a Crockford-ish base32 alphabet (no I/O/L/U) so codes are easy
-- to read aloud and dictate over phone or WhatsApp.

-- 1. Generator: returns "PG-XXXXX" using a 30-char unambiguous alphabet.
create or replace function public.generate_booking_reference()
returns text
language plpgsql
volatile
as $$
declare
  alphabet constant text := 'ABCDEFGHJKMNPQRSTVWXYZ23456789';
  result text := '';
  i int;
begin
  for i in 1..5 loop
    result := result || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
  end loop;
  return 'PG-' || result;
end;
$$;

-- 2. Add the column (nullable for now so we can backfill).
alter table public.bookings
  add column if not exists reference_code text;

-- 3. Backfill existing rows with retry-on-collision.
do $$
declare
  row_id uuid;
  candidate text;
  attempts int;
begin
  for row_id in select id from public.bookings where reference_code is null loop
    attempts := 0;
    loop
      attempts := attempts + 1;
      candidate := public.generate_booking_reference();
      begin
        update public.bookings set reference_code = candidate where id = row_id;
        exit;
      exception when unique_violation then
        if attempts >= 20 then
          raise exception 'Could not generate unique reference_code for booking %', row_id;
        end if;
      end;
    end loop;
  end loop;
end $$;

-- 4. Lock down: not null + unique, then make the default the generator.
create unique index if not exists bookings_reference_code_unique on public.bookings (reference_code);
alter table public.bookings
  alter column reference_code set not null,
  alter column reference_code set default public.generate_booking_reference();

-- 5. BEFORE INSERT trigger: if a caller explicitly sets reference_code to
--    something that collides, retry. Keeps inserts safe even if app code
--    races (default expression is evaluated only once per row).
create or replace function public.bookings_ensure_reference_code()
returns trigger
language plpgsql
as $$
declare
  candidate text;
  attempts int := 0;
  exists_row boolean;
begin
  if new.reference_code is null then
    new.reference_code := public.generate_booking_reference();
  end if;
  loop
    select exists(
      select 1 from public.bookings
      where reference_code = new.reference_code
        and id is distinct from new.id
    ) into exists_row;
    exit when not exists_row;
    attempts := attempts + 1;
    if attempts >= 20 then
      raise exception 'Could not generate unique booking reference after 20 attempts';
    end if;
    new.reference_code := public.generate_booking_reference();
  end loop;
  return new;
end;
$$;

drop trigger if exists bookings_set_reference_code on public.bookings;
create trigger bookings_set_reference_code
  before insert on public.bookings
  for each row execute function public.bookings_ensure_reference_code();
