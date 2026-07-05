-- WPPConnect multi-device can identify the manager chat by WhatsApp LID instead
-- of the public phone number. The thread observed from production was saved as
-- 254932179501279, so keep this LID as an explicit manager alias too.

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
  '254932179501279',
  'super_admin',
  true
FROM target_properties
ON CONFLICT (property_id, phone)
DO UPDATE SET
  name = EXCLUDED.name,
  role = 'super_admin',
  is_active = true;

INSERT INTO public.manager_test_modes (phone, guest_mode, updated_at)
VALUES
  ('254932179501279', false, now())
ON CONFLICT (phone)
DO UPDATE SET
  guest_mode = false,
  updated_at = now();
