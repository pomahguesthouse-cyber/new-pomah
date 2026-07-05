-- Ensure the primary Pomah manager WhatsApp number is always treated as a manager.
-- Incoming WA numbers are normalized in code to Indonesian 62-prefix format, so store
-- the canonical phone as 6282226749990. The original local format is 082226749990.

ALTER TABLE public.property_managers
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;

WITH target_properties AS (
  SELECT id
  FROM public.properties
)
INSERT INTO public.property_managers (property_id, name, phone, role, is_active)
SELECT
  id,
  'Manager Pomah',
  '6282226749990',
  'super_admin',
  true
FROM target_properties
ON CONFLICT (property_id, phone)
DO UPDATE SET
  name = EXCLUDED.name,
  role = 'super_admin',
  is_active = true;

-- Make sure the manager is not left in guest-test mode.
INSERT INTO public.manager_test_modes (phone, guest_mode, updated_at)
VALUES
  ('6282226749990', false, now()),
  ('082226749990', false, now())
ON CONFLICT (phone)
DO UPDATE SET
  guest_mode = false,
  updated_at = now();
