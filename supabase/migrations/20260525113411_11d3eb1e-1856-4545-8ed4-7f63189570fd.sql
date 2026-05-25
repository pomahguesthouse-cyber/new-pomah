
CREATE OR REPLACE FUNCTION public.get_public_property()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT to_jsonb(p)
       - 'google_places_api_key'
       - 'ai_api_key'
       - 'ai_base_url'
       - 'ai_model'
       - 'ai_lab_config'
       - 'fonnte_token'
       - 'smart_delay_config'
       - 'payment_bank_name'
       - 'payment_account_number'
       - 'payment_account_holder'
  FROM public.properties p
  ORDER BY p.created_at ASC
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_public_property() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_property() TO anon, authenticated;
