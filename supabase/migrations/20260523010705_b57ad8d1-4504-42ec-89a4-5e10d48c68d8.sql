
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DO $$ BEGIN
  CREATE TYPE public.explore_category AS ENUM ('destination', 'culinary', 'event', 'news');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.explore_items (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category      public.explore_category NOT NULL,
  title         TEXT NOT NULL,
  description   TEXT,
  image_url     TEXT,
  rating        NUMERIC(2,1),
  badge         TEXT,
  date_text     TEXT,
  location_text TEXT,
  sort_order    INTEGER NOT NULL DEFAULT 0,
  is_published  BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_explore_items_cat_order
  ON public.explore_items (category, sort_order);

ALTER TABLE public.explore_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public can view published explore items" ON public.explore_items;
CREATE POLICY "Public can view published explore items"
  ON public.explore_items FOR SELECT
  USING (is_published = true);

DROP POLICY IF EXISTS "Authenticated can view all explore items" ON public.explore_items;
CREATE POLICY "Authenticated can view all explore items"
  ON public.explore_items FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "Authenticated can insert explore items" ON public.explore_items;
CREATE POLICY "Authenticated can insert explore items"
  ON public.explore_items FOR INSERT
  TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "Authenticated can update explore items" ON public.explore_items;
CREATE POLICY "Authenticated can update explore items"
  ON public.explore_items FOR UPDATE
  TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Authenticated can delete explore items" ON public.explore_items;
CREATE POLICY "Authenticated can delete explore items"
  ON public.explore_items FOR DELETE
  TO authenticated USING (true);

DROP TRIGGER IF EXISTS trg_explore_items_updated_at ON public.explore_items;
CREATE TRIGGER trg_explore_items_updated_at
  BEFORE UPDATE ON public.explore_items
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

INSERT INTO public.explore_items (category, title, description, image_url, rating, sort_order) VALUES
  ('destination', 'Lawang Sewu', 'Gedung bersejarah peninggalan Belanda yang ikonik dengan ribuan pintu dan arsitektur megah.', 'https://images.unsplash.com/photo-1549473889-14f410d83298?auto=format&fit=crop&q=80&w=600', 4.8, 1),
  ('destination', 'Kota Lama Semarang', 'Kawasan cagar budaya dengan bangunan-bangunan tua bernuansa Eropa klasik yang indah.', 'https://images.unsplash.com/photo-1629827014691-30cc0ed06927?auto=format&fit=crop&q=80&w=600', 4.9, 2),
  ('destination', 'Sam Poo Kong', 'Kelenteng bersejarah tempat persinggahan Laksamana Cheng Ho, dengan nuansa merah yang fotogenik.', 'https://images.unsplash.com/photo-1616239129525-24dbec2291cd?auto=format&fit=crop&q=80&w=600', 4.7, 3)
ON CONFLICT DO NOTHING;

INSERT INTO public.explore_items (category, title, description, image_url, badge, sort_order) VALUES
  ('culinary', 'Lumpia Gang Lombok', 'Lumpia legendaris Semarang dengan isian rebung segar, udang, dan telur.', 'https://images.unsplash.com/photo-1606525437679-03e62698a1c1?auto=format&fit=crop&q=80&w=400', 'Cemilan', 1),
  ('culinary', 'Tahu Gimbal Pak Edy', 'Perpaduan tahu goreng, gimbal udang, irisan kol, tauge, disiram kuah kacang petis.', 'https://images.unsplash.com/photo-1563379091339-03b21ab4a4f8?auto=format&fit=crop&q=80&w=400', 'Makan Siang', 2),
  ('culinary', 'Nasi Ayam Bu Wido', 'Nasi liwet khas Semarang disajikan dengan suwiran ayam, telur pindang, dan kuah opor.', 'https://images.unsplash.com/photo-1615486171434-601f6004df9f?auto=format&fit=crop&q=80&w=400', 'Makan Malam', 3),
  ('culinary', 'Tahu Pong Karangturi', 'Tahu pong gurih yang disajikan hangat dengan cocolan kecap pedas manis.', 'https://images.unsplash.com/photo-1546833999-b9f581a1996d?auto=format&fit=crop&q=80&w=400', 'Cemilan', 4)
ON CONFLICT DO NOTHING;

INSERT INTO public.explore_items (category, title, description, date_text, location_text, sort_order) VALUES
  ('event', 'Semarang Night Carnival', 'Pawai budaya tahunan terbesar di Semarang dengan kostum-kostum meriah.', '15 Agustus 2026', 'Kawasan Simpang Lima', 1),
  ('event', 'Festival Kota Lama', 'Festival seni, budaya, dan kuliner tempo dulu di tengah gemerlap lampu malam.', '10-12 September 2026', 'Kawasan Kota Lama', 2),
  ('event', 'Pasar Semawis', 'Pusat jajanan kaki lima terpanjang dengan ragam kuliner halal dan non-halal.', 'Setiap Akhir Pekan (Jumat-Minggu)', 'Kawasan Pecinan Semarang', 3)
ON CONFLICT DO NOTHING;

INSERT INTO public.explore_items (category, title, description, date_text, sort_order) VALUES
  ('news', 'Revitalisasi Taman Budaya Raden Saleh Selesai', 'Kawasan Taman Budaya Raden Saleh kini tampil lebih modern dan siap menjadi pusat kesenian warga Semarang.', '10 Mei 2026', 1),
  ('news', 'Rute Bus Trans Semarang Baru Resmi Dibuka', 'Pemerintah Kota Semarang membuka koridor baru untuk mempermudah akses pariwisata hingga ke pinggiran kota.', '05 Mei 2026', 2)
ON CONFLICT DO NOTHING;
