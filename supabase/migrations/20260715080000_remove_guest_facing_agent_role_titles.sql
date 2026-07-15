-- Prevent guest-facing AI instructions from exposing internal agent titles.
-- The public persona may introduce itself by name, but not as Pricing Specialist,
-- Pricing Agent, Front Office Agent, or another internal routing role.

BEGIN;

UPDATE public.ai_agents
SET
  custom_instructions = regexp_replace(
    regexp_replace(
      custom_instructions,
      'Anda adalah ([^,]+),[[:space:]]*(Pricing Specialist|Pricing Agent|Manajer Pricing)[^\.]*\.',
      'Anda adalah \1, bagian dari layanan tamu Pomah Guesthouse.',
      'gi'
    ),
    '(Saat memperkenalkan diri[^\.]*\.)',
    'Saat memperkenalkan diri, cukup sebut nama. Jangan menyebut jabatan internal, nama agent, specialist, divisi, atau proses routing.',
    'gi'
  ),
  updated_at = now()
WHERE agent_key = 'pricing'
  AND custom_instructions IS NOT NULL;

COMMIT;
