CREATE TABLE public.expenses (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  expense_date DATE NOT NULL DEFAULT CURRENT_DATE,
  category TEXT NOT NULL DEFAULT 'lain-lain',
  description TEXT,
  vendor TEXT,
  amount NUMERIC NOT NULL DEFAULT 0,
  payment_method TEXT,
  receipt_url TEXT,
  notes TEXT,
  created_by UUID,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX expenses_expense_date_idx ON public.expenses (expense_date DESC);
CREATE INDEX expenses_category_idx ON public.expenses (category);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.expenses TO authenticated;
GRANT ALL ON public.expenses TO service_role;

ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated staff can read expenses"
  ON public.expenses FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated staff can insert expenses"
  ON public.expenses FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated staff can update expenses"
  ON public.expenses FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated staff can delete expenses"
  ON public.expenses FOR DELETE TO authenticated USING (true);

CREATE OR REPLACE FUNCTION public.expenses_set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER expenses_updated_at
  BEFORE UPDATE ON public.expenses
  FOR EACH ROW EXECUTE FUNCTION public.expenses_set_updated_at();