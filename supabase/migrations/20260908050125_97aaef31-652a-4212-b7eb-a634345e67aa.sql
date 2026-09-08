ALTER TABLE public.room_types
  ADD COLUMN IF NOT EXISTS seo_title text,
  ADD COLUMN IF NOT EXISTS meta_description text,
  ADD COLUMN IF NOT EXISTS seo_h1 text;

UPDATE public.room_types SET
  seo_h1 = 'Kamar Single, Penginapan Dekat UNNES',
  seo_title = 'Kamar Single | Penginapan Dekat UNNES Semarang',
  meta_description = 'Kamar single di penginapan dekat UNNES Semarang. Praktis untuk solo traveler: bersih, WiFi, AC. Pomah Guesthouse, Sampangan.'
WHERE slug = 'kamar-single';

UPDATE public.room_types SET
  seo_h1 = 'Kamar Deluxe, Penginapan Dekat UNNES',
  seo_title = 'Kamar Deluxe | Penginapan Dekat UNNES Semarang',
  meta_description = 'Kamar Deluxe di Pomah Guesthouse, penginapan dekat UNNES Semarang. Nyaman untuk dua orang, WiFi, AC, dan parkir.'
WHERE slug = 'deluxe';

UPDATE public.room_types SET
  seo_h1 = 'Grand Deluxe, Penginapan Dekat UNNES',
  seo_title = 'Grand Deluxe | Penginapan Dekat UNNES Semarang',
  meta_description = 'Grand Deluxe Pomah Guesthouse: kamar lebih lega di penginapan dekat UNNES Semarang. Tenang, WiFi, AC, parkir tersedia.'
WHERE slug = 'grand-deluxe';

UPDATE public.room_types SET
  seo_h1 = 'Family Suite 100, Penginapan Dekat UNNES',
  seo_title = 'Family Suite 100 | Penginapan Dekat UNNES Semarang',
  meta_description = 'Family Suite 100 di penginapan dekat UNNES Semarang. Suite luas, 2 kamar tidur, 2 kamar mandi, nyaman untuk keluarga.'
WHERE slug = 'family-suite-100';

UPDATE public.room_types SET
  seo_h1 = 'Family Room 222, Penginapan Dekat UNNES',
  seo_title = 'Family Room 222 | Penginapan Dekat UNNES Semarang',
  meta_description = 'Family Room 222, kamar andalan Pomah Guesthouse. Penginapan dekat UNNES Semarang untuk keluarga, terasa seperti di rumah.'
WHERE slug = 'family-room-222';

UPDATE public.properties SET
  homepage_config = coalesce(homepage_config, '{}'::jsonb)
    || jsonb_build_object(
      'seo',
      coalesce(homepage_config -> 'seo', '{}'::jsonb) || jsonb_build_object(
        'h1', 'Penginapan Dekat UNNES Semarang',
        'metaTitle', 'Pomah Guesthouse | Penginapan Dekat UNNES Semarang',
        'metaDescription', 'Penginapan dekat UNNES Semarang di Sampangan. Pomah Guesthouse: family room, WiFi, parkir, suasana tenang. Pesan di situs resmi.',
        'twitterTitle', 'Pomah Guesthouse | Penginapan Dekat UNNES Semarang',
        'twitterDescription', 'Penginapan dekat UNNES Semarang di Sampangan. Pomah Guesthouse: family room, WiFi, parkir, suasana tenang. Pesan di situs resmi.'
      )
    ),
  explore_config = coalesce(explore_config, '{}'::jsonb)
    || jsonb_build_object(
      'seo',
      coalesce(explore_config -> 'seo', '{}'::jsonb) || jsonb_build_object(
        'h1', 'Jelajahi Semarang',
        'metaTitle', 'Jelajahi Semarang | Panduan Tamu Penginapan Dekat UNNES',
        'metaDescription', 'Panduan wisata dan kuliner Semarang untuk tamu penginapan dekat UNNES. Destinasi, tempat makan, dan event dari Pomah Guesthouse.',
        'twitterTitle', 'Jelajahi Semarang | Panduan Tamu Penginapan Dekat UNNES',
        'twitterDescription', 'Panduan wisata dan kuliner Semarang untuk tamu penginapan dekat UNNES. Destinasi, tempat makan, dan event dari Pomah Guesthouse.'
      )
    );