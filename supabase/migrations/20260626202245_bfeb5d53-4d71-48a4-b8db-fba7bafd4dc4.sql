
CREATE TABLE public.manager_test_modes (
  phone TEXT PRIMARY KEY,
  guest_mode BOOLEAN NOT NULL DEFAULT false,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.manager_test_modes TO authenticated;
GRANT ALL ON public.manager_test_modes TO service_role;
ALTER TABLE public.manager_test_modes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage test modes"
  ON public.manager_test_modes
  FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
