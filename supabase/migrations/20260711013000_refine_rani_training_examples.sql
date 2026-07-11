-- Refine Rani training examples: anti-monthly-rental and tool-first availability.
-- Uses UPDATE + INSERT WHERE NOT EXISTS because some deployments do not have
-- a UNIQUE/PK constraint compatible with ON CONFLICT (id/name).

BEGIN;

-- Replace the earlier value-first example. Availability must remain tool-first;
-- sales value is added only after/alongside a real availability result.
UPDATE public.chatbot_training_examples
SET
  user_message = 'Kamarnya masih ada kak? Buat besok.',
  ideal_assistant_response = 'Baik Kak, saya cek ketersediaan untuk besok dengan asumsi 1 malam ya. Setelah hasil pengecekan tersedia, sampaikan hasil stok terlebih dahulu. Jika kamar tersedia, boleh tambahkan singkat bahwa Pomah Guesthouse strategis untuk akses ke UNNES, lalu tanyakan jumlah tamu. Jangan menanyakan jumlah tamu sebelum pengecekan awal dan jangan menyebut stok tanpa hasil tool.',
  intent = 'availability_check',
  stage = 'availability',
  training_type = 'curated',
  language = 'id-ID',
  is_active = true,
  embedding = NULL,
  embedding_updated_at = NULL,
  updated_at = now()
WHERE id = 'tr-value-unnes-20260710';

INSERT INTO public.chatbot_training_examples (
  id, user_message, ideal_assistant_response, intent, stage,
  training_type, language, is_active
)
SELECT
  'tr-value-unnes-20260710',
  'Kamarnya masih ada kak? Buat besok.',
  'Baik Kak, saya cek ketersediaan untuk besok dengan asumsi 1 malam ya. Setelah hasil pengecekan tersedia, sampaikan hasil stok terlebih dahulu. Jika kamar tersedia, boleh tambahkan singkat bahwa Pomah Guesthouse strategis untuk akses ke UNNES, lalu tanyakan jumlah tamu. Jangan menanyakan jumlah tamu sebelum pengecekan awal dan jangan menyebut stok tanpa hasil tool.',
  'availability_check',
  'availability',
  'curated',
  'id-ID',
  true
WHERE NOT EXISTS (
  SELECT 1 FROM public.chatbot_training_examples
  WHERE id = 'tr-value-unnes-20260710'
);

-- Canonical monthly-rental rejection.
UPDATE public.chatbot_training_examples
SET
  user_message = 'Bisa sewa bulanan nggak kak? Buat mahasiswa.',
  ideal_assistant_response = 'Mohon maaf ya Kak, Pomah Guesthouse saat ini hanya melayani sewa harian dan belum tersedia untuk sewa mingguan, bulanan, atau kost. Jika Kakak membutuhkan penginapan harian untuk kunjungan atau kegiatan di sekitar UNNES, boleh informasikan tanggal menginapnya.',
  intent = 'inquiry_monthly_rental',
  stage = 'front-office',
  training_type = 'curated',
  language = 'id-ID',
  is_active = true,
  embedding = NULL,
  embedding_updated_at = NULL,
  updated_at = now()
WHERE id = 'tr-deny-monthly-20260710';

INSERT INTO public.chatbot_training_examples (
  id, user_message, ideal_assistant_response, intent, stage,
  training_type, language, is_active
)
SELECT
  'tr-deny-monthly-20260710',
  'Bisa sewa bulanan nggak kak? Buat mahasiswa.',
  'Mohon maaf ya Kak, Pomah Guesthouse saat ini hanya melayani sewa harian dan belum tersedia untuk sewa mingguan, bulanan, atau kost. Jika Kakak membutuhkan penginapan harian untuk kunjungan atau kegiatan di sekitar UNNES, boleh informasikan tanggal menginapnya.',
  'inquiry_monthly_rental',
  'front-office',
  'curated',
  'id-ID',
  true
WHERE NOT EXISTS (
  SELECT 1 FROM public.chatbot_training_examples
  WHERE id = 'tr-deny-monthly-20260710'
);

-- Linguistic variants. Keep replies policy-focused and free of dynamic facts.
WITH variants(id, user_message, ideal_response) AS (
  VALUES
    (
      'tr-deny-monthly-kost-20260711',
      'Ada harga kost bulanan?',
      'Mohon maaf ya Kak, Pomah Guesthouse belum melayani kost atau sewa bulanan. Saat ini pemesanan hanya tersedia untuk sewa harian. Jika Kakak memerlukan penginapan harian, boleh kirim tanggal menginapnya.'
    ),
    (
      'tr-deny-monthly-contract-20260711',
      'Bisa kontrak satu bulan kak?',
      'Mohon maaf Kak, saat ini kami belum menerima kontrak satu bulan, sewa mingguan, atau kost. Pomah Guesthouse hanya melayani pemesanan harian.'
    ),
    (
      'tr-deny-monthly-three-weeks-20260711',
      'Kalau tinggal 3 minggu bisa?',
      'Mohon maaf ya Kak, untuk saat ini kami belum menyediakan paket mingguan atau bulanan. Pemesanan Pomah Guesthouse hanya tersedia dengan skema sewa harian.'
    ),
    (
      'tr-deny-monthly-student-package-20260711',
      'Ada paket mahasiswa?',
      'Mohon maaf Kak, kami belum memiliki paket kost atau sewa bulanan untuk mahasiswa. Pomah Guesthouse saat ini melayani penginapan harian.'
    ),
    (
      'tr-deny-monthly-semester-20260711',
      'Bisa sewa satu semester?',
      'Mohon maaf ya Kak, kami tidak melayani sewa semester, bulanan, mingguan, atau kost. Saat ini Pomah Guesthouse hanya menerima pemesanan harian.'
    ),
    (
      'tr-deny-monthly-long-stay-20260711',
      'Saya mau tinggal sekitar 20 hari.',
      'Mohon maaf Kak, kami belum menyediakan paket long stay mingguan atau bulanan. Pemesanan tetap menggunakan tarif dan skema sewa harian, sesuai ketersediaan pada tanggal yang diminta.'
    )
)
INSERT INTO public.chatbot_training_examples (
  id, user_message, ideal_assistant_response, intent, stage,
  training_type, language, is_active
)
SELECT
  v.id,
  v.user_message,
  v.ideal_response,
  'inquiry_monthly_rental',
  'front-office',
  'curated',
  'id-ID',
  true
FROM variants v
WHERE NOT EXISTS (
  SELECT 1 FROM public.chatbot_training_examples e WHERE e.id = v.id
);

COMMIT;

-- After deployment, run the existing Admin > Chatbot Training > Backfill
-- Embedding action so rows with embedding IS NULL enter semantic retrieval.
