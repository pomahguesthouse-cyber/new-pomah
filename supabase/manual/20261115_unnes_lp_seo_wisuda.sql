-- Manual SQL: sinkronkan baris CMS seo_landing_pages untuk
-- /lp/penginapan-dekat-unnes dengan salinan yang disetujui 15 Nov 2026.
--
-- JANGAN diterapkan otomatis. Backup dulu, review, baru jalankan di Lovable
-- query_database pada project dfd1db42-3838-4443-9a62-39f8c2588d38.
--
-- PENTING: Halaman live merender dari kode
-- (src/public/content/approved-seo.ts + UnnesLanding), yang menimpa
-- title, meta, H1, intro, dan FAQ dari baris ini. Setelah deploy PR,
-- pengunjung sudah melihat salinan baru tanpa SQL ini.
-- SQL hanya merapikan salinan di CMS/DB agar tidak tertinggal
-- (termasuk angka statis "mulai Rp150.000/malam" di meta_description
-- dan intro lama di body_content).
--
-- City Guide Lawang Sewu dan Nasi Ayam Bu Wido TIDAK disimpan di tabel
-- ini; tubuh artikelnya ada di kode (CITY_GUIDE_ARTICLES). Tidak ada
-- SQL untuk kedua artikel itu.
--
-- Artikel/harga di halaman kamar dan beranda juga dari kode; tidak
-- perlu UPDATE room_types atau homepage_config.

-- ── 0) Backup (jalankan lebih dulu, pastikan 1 baris masuk) ─────────────────
CREATE TABLE IF NOT EXISTS public._bak_seo_20261115_seo_landing_pages AS
SELECT * FROM public.seo_landing_pages WHERE FALSE;

INSERT INTO public._bak_seo_20261115_seo_landing_pages
SELECT s.*
FROM public.seo_landing_pages s
WHERE s.slug = 'penginapan-dekat-unnes'
  AND NOT EXISTS (
    SELECT 1
    FROM public._bak_seo_20261115_seo_landing_pages b
    WHERE b.slug = s.slug
  );

-- ── 1) Forward ──────────────────────────────────────────────────────────────
UPDATE public.seo_landing_pages
SET
  title = 'Homestay & Penginapan Dekat UNNES Semarang | Pomah',
  meta_title = 'Homestay & Penginapan Dekat UNNES Semarang | Pomah',
  meta_description = 'Penginapan keluarga di Sampangan, sekitar 4,5 km dari UNNES Sekaran (±10–15 menit). Cocok untuk wisuda & tes masuk. Cek kamar dan pesan via WhatsApp.',
  hero_headline = 'Homestay & Penginapan Dekat UNNES untuk Orang Tua dan Wisudawan',
  hero_subheadline = 'Penginapan keluarga di Sampangan, sekitar 4,5 km dari kampus UNNES Sekaran. Pilihan tepat untuk orang tua wisudawan, peserta tes, dan keluarga yang ingin menginap tenang dekat kampus.',
  body_content = replace(
    replace(
      body_content,
      $old_intro$<p>Datang ke Semarang untuk wisuda anak, mengantar tes masuk, atau urusan kampus lainnya? Pomah Guesthouse adalah penginapan keluarga di Jl. Dewi Sartika IV No. 71, Sampangan, Semarang, yang bisa dijangkau dengan mudah dari kampus UNNES di Sekaran maupun Sampangan. "Pomah" dalam bahasa Jawa berarti rumah, dan suasana itulah yang ingin kami hadirkan: tenang, bersih, dan hangat, seperti menginap di rumah keluarga sendiri.</p>$old_intro$,
      $new_intro$<p>Pomah Guesthouse adalah penginapan keluarga di Sampangan, Semarang, sekitar 4,5 km atau kurang lebih 10–15 menit berkendara dari kampus UNNES Sekaran. Banyak orang tua memilih menginap di sini saat wisuda, tes masuk, atau mengantar putra-putrinya kuliah.</p>$new_intro$
    ),
    $old_faq$<h3>Berapa harga kamar termurah?</h3>
<p>Kamar Single mulai Rp150.000 per malam.</p>
$old_faq$,
    $new_faq$<h3>Berapa harga kamar termurah?</h3>
<p>Kamar Single mulai Rp150.000 per malam.</p>
<h3>Apakah Pomah termasuk hotel dekat UNNES?</h3>
<p>Pomah adalah guesthouse keluarga di Sampangan, sekitar 4,5 km dari UNNES Sekaran (±10–15 menit berkendara). Pilihan kamarnya mulai dari Single sampai Family Room dengan 2 kamar tidur untuk maksimal 4 tamu.</p>
$new_faq$
  ),
  updated_at = now()
WHERE slug = 'penginapan-dekat-unnes';

-- ── 2) Rollback ─────────────────────────────────────────────────────────────
-- UPDATE public.seo_landing_pages AS s
-- SET
--   title = b.title,
--   meta_title = b.meta_title,
--   meta_description = b.meta_description,
--   hero_headline = b.hero_headline,
--   hero_subheadline = b.hero_subheadline,
--   body_content = b.body_content,
--   updated_at = b.updated_at
-- FROM public._bak_seo_20261115_seo_landing_pages AS b
-- WHERE s.slug = b.slug;
--
-- DROP TABLE IF EXISTS public._bak_seo_20261115_seo_landing_pages;
