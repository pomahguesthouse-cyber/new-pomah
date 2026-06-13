CREATE OR REPLACE FUNCTION public.set_updated_at_timestamp()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TABLE public.page_sections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  page_id UUID NOT NULL REFERENCES public.seo_landing_pages(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  desktop_config JSONB NOT NULL DEFAULT '{}'::jsonb,
  mobile_config JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_mobile_custom BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (page_id, id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.page_sections TO authenticated;
GRANT SELECT ON public.page_sections TO anon;
GRANT ALL ON public.page_sections TO service_role;
ALTER TABLE public.page_sections ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public can view sections of published pages" ON public.page_sections FOR SELECT TO anon, authenticated USING (EXISTS (SELECT 1 FROM public.seo_landing_pages p WHERE p.id = page_sections.page_id AND p.published = true));
CREATE POLICY "Staff manage page sections" ON public.page_sections FOR ALL TO authenticated USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));

CREATE TABLE public.page_elements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  page_id UUID NOT NULL REFERENCES public.seo_landing_pages(id) ON DELETE CASCADE,
  section_id UUID NOT NULL,
  type TEXT NOT NULL,
  content JSONB NOT NULL DEFAULT '{}'::jsonb,
  desktop_style JSONB NOT NULL DEFAULT '{}'::jsonb,
  mobile_style JSONB NOT NULL DEFAULT '{}'::jsonb,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT page_elements_section_page_fk FOREIGN KEY (page_id, section_id) REFERENCES public.page_sections(page_id, id) ON DELETE CASCADE
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.page_elements TO authenticated;
GRANT SELECT ON public.page_elements TO anon;
GRANT ALL ON public.page_elements TO service_role;
ALTER TABLE public.page_elements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public can view elements of published pages" ON public.page_elements FOR SELECT TO anon, authenticated USING (EXISTS (SELECT 1 FROM public.seo_landing_pages p WHERE p.id = page_elements.page_id AND p.published = true));
CREATE POLICY "Staff manage page elements" ON public.page_elements FOR ALL TO authenticated USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));

CREATE INDEX page_sections_page_order_idx ON public.page_sections(page_id, sort_order);
CREATE INDEX page_elements_page_section_order_idx ON public.page_elements(page_id, section_id, sort_order);
CREATE TRIGGER set_page_sections_updated_at BEFORE UPDATE ON public.page_sections FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_timestamp();
CREATE TRIGGER set_page_elements_updated_at BEFORE UPDATE ON public.page_elements FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_timestamp();

WITH source_sections AS (
  SELECT p.id AS page_id, section.value AS desktop_section, section.ordinality::integer - 1 AS sort_order
  FROM public.seo_landing_pages p
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE
      WHEN jsonb_typeof(p.sections) = 'array' THEN p.sections
      WHEN jsonb_typeof(p.sections) = 'object' AND COALESCE((p.sections->>'split')::boolean, false) THEN COALESCE(p.sections->'desktop', '[]'::jsonb)
      ELSE '[]'::jsonb
    END
  ) WITH ORDINALITY AS section(value, ordinality)
), inserted_sections AS (
  INSERT INTO public.page_sections (page_id, type, sort_order, desktop_config, mobile_config, is_mobile_custom)
  SELECT s.page_id,
         COALESCE(s.desktop_section->>'type', 'unknown'),
         s.sort_order,
         s.desktop_section - 'id' - 'type' - 'styles',
         COALESCE(m.mobile_section - 'id' - 'type' - 'styles', '{}'::jsonb),
         m.mobile_section IS NOT NULL
  FROM source_sections s
  LEFT JOIN LATERAL (
    SELECT mobile.value AS mobile_section
    FROM public.seo_landing_pages p2
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE WHEN jsonb_typeof(p2.sections) = 'object' THEN COALESCE(p2.sections->'mobile', '[]'::jsonb) ELSE '[]'::jsonb END
    ) WITH ORDINALITY AS mobile(value, ordinality)
    WHERE p2.id = s.page_id
      AND (mobile.value->>'id' = s.desktop_section->>'id' OR mobile.ordinality::integer - 1 = s.sort_order)
    ORDER BY CASE WHEN mobile.value->>'id' = s.desktop_section->>'id' THEN 0 ELSE 1 END
    LIMIT 1
  ) m ON true
  RETURNING id, page_id, type, sort_order, desktop_config, mobile_config
)
INSERT INTO public.page_elements (page_id, section_id, type, content, desktop_style, mobile_style, sort_order)
SELECT i.page_id,
       i.id,
       i.type,
       i.desktop_config,
       COALESCE((SELECT s.desktop_section->'styles'->'desktop' FROM source_sections s WHERE s.page_id = i.page_id AND s.sort_order = i.sort_order), '{}'::jsonb),
       COALESCE((SELECT s.desktop_section->'styles'->'mobile' FROM source_sections s WHERE s.page_id = i.page_id AND s.sort_order = i.sort_order), '{}'::jsonb),
       0
FROM inserted_sections i;