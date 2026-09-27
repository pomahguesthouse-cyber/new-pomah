-- Approved public copy, 27 Sep 2026.
-- Lovable deploy does not run this file. Run the whole script once in the
-- Supabase SQL editor after deploy. It only updates SEO and content columns.
-- It does not change prices, availability, bookings, or publish flags.
-- Safe to run again: room SEO is set to the same sentences, the Family Suite
-- sentence is replaced only while the old wording is still present, and the
-- UNNES Sampangan row is inserted only when it is missing.
-- Running it again resets homepage and landing SEO fields to this copy.

ALTER TABLE public.explore_items
  ADD COLUMN IF NOT EXISTS meta_description text;

CREATE OR REPLACE FUNCTION pg_temp.patch_seo_json(node jsonb)
RETURNS jsonb
LANGUAGE plpgsql
AS $fn$
DECLARE
  key text;
  val jsonb;
  result jsonb := '{}'::jsonb;
  item jsonb;
  built jsonb := '[]'::jsonb;
  name text;
  text_val text;
  has_sampangan boolean := false;
  sekaran_idx int := -1;
  i int := 0;
  entry jsonb;
  src jsonb;
BEGIN
  IF node IS NULL OR jsonb_typeof(node) = 'null' THEN
    RETURN node;
  ELSIF jsonb_typeof(node) = 'array' THEN
    FOR val IN SELECT value FROM jsonb_array_elements(node)
    LOOP
      built := built || jsonb_build_array(pg_temp.patch_seo_json(val));
    END LOOP;
    RETURN built;
  ELSIF jsonb_typeof(node) = 'object' THEN
    FOR key, val IN SELECT * FROM jsonb_each(node)
    LOOP
      result := result || jsonb_build_object(key, pg_temp.patch_seo_json(val));
    END LOOP;
    name := coalesce(result->>'name', '');
    IF name ~* 'unnes' AND name ~* 'sekaran' THEN
      result := jsonb_set(result, '{distance}', to_jsonb('4,7 km'::text), true);
      result := jsonb_set(result, '{time}', to_jsonb('~10–12 menit'::text), true);
    END IF;
    IF result ? 'nearby' AND jsonb_typeof(result->'nearby') = 'array' THEN
      src := result->'nearby';
      has_sampangan := false;
      sekaran_idx := -1;
      i := 0;
      FOR item IN SELECT value FROM jsonb_array_elements(src)
      LOOP
        name := coalesce(item->>'name', '');
        IF name ~* 'unnes' AND name ~* 'sampangan' THEN
          has_sampangan := true;
        END IF;
        IF name ~* 'unnes' AND name ~* 'sekaran' AND sekaran_idx < 0 THEN
          sekaran_idx := i;
        END IF;
        i := i + 1;
      END LOOP;
      IF NOT has_sampangan THEN
        entry := jsonb_build_object(
          'name', 'Unnes Sampangan (Kelud Utara III)',
          'type', 'Universitas',
          'distance', '3,5 km',
          'time', '~8–10 menit'
        );
        built := '[]'::jsonb;
        i := 0;
        FOR item IN SELECT value FROM jsonb_array_elements(src)
        LOOP
          built := built || jsonb_build_array(item);
          IF i = sekaran_idx THEN
            built := built || jsonb_build_array(entry);
          END IF;
          i := i + 1;
        END LOOP;
        IF sekaran_idx < 0 THEN
          built := jsonb_build_array(entry) || src;
        END IF;
        result := jsonb_set(result, '{nearby}', built, true);
      END IF;
    END IF;
    RETURN result;
  ELSIF jsonb_typeof(node) = 'string' THEN
    text_val := node #>> '{}';
    IF text_val ~* 'unnes sekaran' AND text_val ~* '8[[:space:]]*km' THEN
      text_val := regexp_replace(text_val, '~[[:space:]]*13[[:space:]]*menit', '~10–12 menit', 'gi');
      text_val := regexp_replace(text_val, '~[[:space:]]*10[[:space:]]*menit(?!–|-)', '~10–12 menit', 'gi');
      text_val := regexp_replace(text_val, '8[[:space:]]*km', '4,7 km', 'gi');
    END IF;
    text_val := replace(text_val, 'Pomah Guesthouse — Gunungpati, Semarang', 'Pomah Guesthouse — Jl. Dewi Sartika IV No. 71, Sampangan, Semarang 50232');
    text_val := replace(text_val, 'Pomah Guesthouse – Gunungpati, Semarang', 'Pomah Guesthouse — Jl. Dewi Sartika IV No. 71, Sampangan, Semarang 50232');
    text_val := replace(text_val, 'Pomah Guesthouse - Gunungpati, Semarang', 'Pomah Guesthouse — Jl. Dewi Sartika IV No. 71, Sampangan, Semarang 50232');
    text_val := replace(text_val, 'Penginapan nyaman & terjangkau di Gunungpati, Semarang.', 'Penginapan keluarga yang nyaman & terjangkau di Sampangan, Semarang.');
    text_val := replace(text_val, 'Gunungpati, Semarang, Jawa Tengah', 'Jl. Dewi Sartika IV No. 71, Sampangan, Semarang, Jawa Tengah');
    RETURN to_jsonb(text_val);
  ELSE
    RETURN node;
  END IF;
END;
$fn$;

CREATE OR REPLACE FUNCTION pg_temp.guide_copy(label text, OUT card text, OUT meta text)
LANGUAGE plpgsql
AS $fn$
BEGIN
  card := NULL;
  meta := NULL;
  IF label IS NULL OR label ~* 'festival|loff|short film|eksplorasi sejarah' THEN
    RETURN;
  ELSIF label ~* 'lawang sewu' THEN
    card := $t$Gedung "seribu pintu" di Tugu Muda ini dulu kantor perusahaan kereta api zaman Belanda, sekarang jadi museum yang selalu ramai pengunjung. Dari Pomah cukup sekali jalan lewat pusat kota, dan paling enak didatangi pagi atau menjelang sore.$t$;
    meta := $t$Panduan ke Lawang Sewu dari Pomah Guesthouse Sampangan: rute, perkiraan waktu tempuh, harga tiket, jam buka, dan tips berkunjung bersama keluarga.$t$;
  ELSIF label ~* 'kota lama' THEN
    card := $t$Deretan gedung kolonial, jalan berbatu, dan kafe di bangunan tua membuat Kota Lama terasa seperti mundur ke masa lalu. Paling seru dijelajahi dengan jalan kaki santai, pagi hari atau saat lampu-lampunya mulai menyala di sore hari.$t$;
    meta := $t$Jelajah Kota Lama Semarang dari Pomah Guesthouse: rute dari Sampangan, spot wajib, info museum dan tiket, serta tips jalan kaki santai bersama keluarga.$t$;
  ELSIF label ~* 'sam poo' THEN
    card := $t$Kompleks klenteng merah menyala di Simongan ini menyimpan kisah persinggahan armada Laksamana Cheng Ho di Semarang. Letaknya paling dekat dari Pomah di antara destinasi wisata utama kota, cocok untuk setengah hari santai bersama keluarga.$t$;
    meta := $t$Panduan ke Klenteng Sam Poo Kong dari Pomah Guesthouse: sekitar 4–5 km dari Sampangan. Info tiket, jam buka, dan tips berkunjung bersama keluarga.$t$;
  ELSIF label ~* 'masjid agung jawa tengah' OR label ~* '(^|[^[:alnum:]])majt([^[:alnum:]]|$)' THEN
    card := $t$Payung-payung raksasa di pelataran dan menara setinggi 99 meter membuat MAJT mudah dikenali dari kejauhan. Tempat ini cocok untuk ibadah, wisata religi, sekaligus melihat Semarang dari ketinggian.$t$;
    meta := $t$Panduan ke MAJT Semarang dari Pomah Guesthouse: rute dari Sampangan, info Menara Al Husna, jam operasional, dan tips berkunjung bersama keluarga.$t$;
  ELSIF label ~* 'goa kreo' OR label ~* 'gua kreo' THEN
    card := $t$Jembatan di atas Waduk Jatibarang, gua yang dikaitkan dengan kisah Sunan Kalijaga, dan kawanan kera ekor panjang jadi daya tarik Goa Kreo. Pilihan wisata alam yang dekat untuk keluarga, tanpa harus ke pusat kota.$t$;
    meta := $t$Panduan ke Goa Kreo dari Pomah Guesthouse: sekitar 7 km dari Sampangan. Info tiket, jam buka, legenda Sunan Kalijaga, dan tips aman bersama anak.$t$;
  END IF;
END;
$fn$;

CREATE OR REPLACE FUNCTION pg_temp.apply_guide_cards(config jsonb)
RETURNS jsonb
LANGUAGE plpgsql
AS $fn$
DECLARE
  result jsonb := coalesce(config, '{}'::jsonb);
  key text;
  item jsonb;
  built jsonb;
  label text;
  copy record;
BEGIN
  FOREACH key IN ARRAY ARRAY['destinations', 'culinary', 'events', 'news']
  LOOP
    IF jsonb_typeof(result -> key) IS DISTINCT FROM 'array' THEN
      CONTINUE;
    END IF;
    built := '[]'::jsonb;
    FOR item IN SELECT value FROM jsonb_array_elements(result -> key)
    LOOP
      label := coalesce(item->>'name', item->>'title', '');
      SELECT * INTO copy FROM pg_temp.guide_copy(label);
      IF copy.card IS NOT NULL THEN
        item := jsonb_set(item, '{desc}', to_jsonb(copy.card), true);
        item := jsonb_set(item, '{metaDescription}', to_jsonb(copy.meta), true);
      END IF;
      built := built || jsonb_build_array(item);
    END LOOP;
    result := jsonb_set(result, ARRAY[key], built, true);
  END LOOP;
  RETURN result;
END;
$fn$;

UPDATE public.room_types
SET
  seo_h1 = 'Kamar Single untuk Solo Traveler di Semarang',
  seo_title = 'Kamar Single Semarang Mulai Rp175.000 | Pomah Guesthouse',
  meta_description = 'Kamar Single 15 m² di Pomah Guesthouse Sampangan, Semarang. Praktis untuk solo traveler dan peserta tes: AC, WiFi, dapur bersama. Mulai Rp175.000.'
WHERE slug = 'kamar-single';

UPDATE public.room_types
SET
  seo_h1 = 'Kamar Deluxe dengan View Taman untuk Dua Orang',
  seo_title = 'Kamar Deluxe untuk Berdua di Semarang | Pomah Guesthouse',
  meta_description = 'Kamar Deluxe 18 m² dengan kasur queen, shower, dan view taman di Pomah Guesthouse Sampangan, Semarang. Nyaman untuk dua orang, mulai Rp230.000.'
WHERE slug = 'deluxe';

UPDATE public.room_types
SET
  seo_h1 = 'Grand Deluxe: Kamar Lebih Lega di Lantai Satu',
  seo_title = 'Grand Deluxe Lantai 1 dengan Air Panas | Pomah Semarang',
  meta_description = 'Grand Deluxe 20 m² di lantai 1 Pomah Guesthouse Semarang: kasur double, air panas, AC, dan WiFi. Kamar lebih lega untuk berdua, mulai Rp300.000/malam.'
WHERE slug = 'grand-deluxe';

UPDATE public.room_types
SET
  seo_h1 = 'Family Suite 100: Suite Dua Kamar di Guesthouse Keluarga Semarang',
  seo_title = 'Family Suite 100 – Guesthouse Keluarga Semarang | Pomah',
  meta_description = 'Suite 60 m² di guesthouse keluarga Semarang: 2 kamar tidur dengan kamar mandi dalam, ruang tamu, dapur, dan teras pribadi. Untuk 4 tamu, mulai Rp500.000.',
  description = replace(
    description,
    'Kamar luas dengan 2 kamar tidur dan 2 kamar mandi ini sangat cocok untuk keluarga atau kelompok besar yang mencari tempat menginap nyaman di pusat kota.',
    'Kamar luas dengan 2 kamar tidur dan 2 kamar mandi ini sangat cocok untuk keluarga atau rombongan kecil hingga empat tamu yang mencari tempat menginap nyaman dan tenang di kawasan Sampangan, Semarang.'
  )
WHERE slug = 'family-suite-100';

UPDATE public.room_types
SET
  seo_h1 = 'Family Room 222: Family Room Semarang dengan Dua Kamar Tidur',
  seo_title = 'Family Room Semarang 2 Kamar Tidur – Family Room 222 | Pomah',
  meta_description = 'Family room di Semarang seluas 50 m²: 2 kamar tidur, 2 kamar mandi, dan ruang keluarga untuk 4 tamu. Pomah Guesthouse Sampangan, mulai Rp500.000.'
WHERE slug = 'family-room-222';

UPDATE public.properties
SET homepage_config = pg_temp.patch_seo_json(
  jsonb_set(
    jsonb_set(
      jsonb_set(
        jsonb_set(
          jsonb_set(
            coalesce(homepage_config, '{}'::jsonb),
            '{seo,h1}',
            to_jsonb('Guesthouse Keluarga di Semarang yang Terasa Seperti Rumah'::text),
            true
          ),
          '{seo,metaTitle}',
          to_jsonb('Pomah Guesthouse – Guesthouse Keluarga & Penginapan Semarang'::text),
          true
        ),
        '{seo,metaDescription}',
        to_jsonb('Guesthouse keluarga di Sampangan, Semarang. Kamar bersih mulai Rp175.000, family room 2 kamar tidur, WiFi & parkir gratis. Dekat kampus UNNES.'::text),
        true
      ),
      '{seo,twitterTitle}',
      to_jsonb('Pomah Guesthouse – Guesthouse Keluarga & Penginapan Semarang'::text),
      true
    ),
    '{seo,twitterDescription}',
    to_jsonb('Guesthouse keluarga di Sampangan, Semarang. Kamar bersih mulai Rp175.000, family room 2 kamar tidur, WiFi & parkir gratis. Dekat kampus UNNES.'::text),
    true
  )
);

UPDATE public.properties
SET explore_config = pg_temp.apply_guide_cards(explore_config)
WHERE explore_config IS NOT NULL;

DO $do$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'properties'
      AND column_name = 'global_config'
  ) THEN
    EXECUTE $sql$
      UPDATE public.properties
      SET global_config = pg_temp.patch_seo_json(global_config)
      WHERE global_config IS NOT NULL
    $sql$;
  END IF;
END
$do$;

UPDATE public.seo_landing_pages
SET
  title = 'Penginapan Dekat UNNES Semarang – Pomah Guesthouse',
  meta_title = 'Penginapan Dekat UNNES Semarang – Pomah Guesthouse',
  meta_description = 'Penginapan & homestay dekat UNNES di Sampangan, Semarang. Cocok untuk wisuda, tes masuk, dan keluarga. Kamar mulai Rp175.000/malam. Pesan langsung.',
  hero_headline = 'Penginapan Dekat UNNES untuk Orang Tua, Wisudawan & Peserta Tes',
  hero_subheadline = 'Penginapan keluarga di Sampangan, sekitar 4,7 km dari kampus UNNES Sekaran. Pilihan tepat untuk orang tua wisudawan, peserta tes, dan keluarga yang ingin menginap tenang dekat kampus.',
  target_keyword = NULL,
  body_content = $html$
<p>Datang ke Semarang untuk wisuda anak, mengantar tes masuk, atau urusan kampus lainnya? Pomah Guesthouse adalah penginapan keluarga di Jl. Dewi Sartika IV No. 71, Sampangan, Semarang, yang bisa dijangkau dengan mudah dari kampus UNNES di Sekaran maupun Sampangan. "Pomah" dalam bahasa Jawa berarti rumah, dan suasana itulah yang ingin kami hadirkan: tenang, bersih, dan hangat, seperti menginap di rumah keluarga sendiri.</p>
<h2>Kenapa memilih Pomah sebagai penginapan dekat UNNES</h2>
<p><strong>Untuk orang tua wisudawan.</strong> Hari wisuda biasanya dimulai pagi-pagi sekali. Menginap dekat kampus membuat Anda tidak perlu berangkat subuh dari luar kota, dan masih sempat sarapan serta berdandan dengan tenang. Setelah acara, keluarga bisa kembali beristirahat di kamar yang nyaman sebelum makan malam bersama.</p>
<p><strong>Untuk peserta tes dan pendamping.</strong> Malam sebelum tes adalah waktu untuk tidur cukup, bukan terjebak di jalan. Kamar yang tenang, AC, dan WiFi membantu peserta mengulang materi dan beristirahat. Pendamping pun bisa menunggu dengan nyaman.</p>
<p><strong>Untuk keluarga dan rombongan kecil.</strong> Kami punya dua tipe kamar keluarga dengan dua kamar tidur, jadi satu keluarga bisa tetap dalam satu unit tanpa berdesakan. Buat Anda yang mencari suasana homestay dekat UNNES, dengan ruang keluarga dan dapur, pilihan ini terasa lebih akrab daripada kamar hotel biasa.</p>
<h2>Jarak ke kampus UNNES Sekaran &amp; Sampangan</h2>
<p>Pomah berada di kawasan Sampangan, jalur yang biasa dilewati menuju Gunungpati dan Sekaran. Perkiraan jarak dari Pomah:</p>
<ul>
<li><strong>Kampus UNNES Sekaran (Gunungpati):</strong> sekitar 4,7 km, kurang lebih 10–12 menit berkendara.</li>
<li><strong>Kampus UNNES Sampangan (Jl. Kelud Utara III):</strong> sekitar 3,5 km, kurang lebih 8–10 menit.</li>
<li><strong>Universitas Wahid Hasyim (Kampus Menoreh):</strong> sekitar 1,5 km, kurang lebih 5 menit.</li>
<li><strong>GOR Jatidiri:</strong> sekitar 4 km, kurang lebih 10 menit.</li>
<li><strong>Pintu Tol Jatingaleh:</strong> sekitar 5 km, kurang lebih 12 menit.</li>
</ul>
<p>Pada hari wisuda atau hari tes, jalan menuju kampus biasanya lebih padat dari biasanya. Kami sarankan berangkat lebih awal dan menggunakan taksi atau ojek online supaya tidak perlu mencari parkir di kampus.</p>
<h2>Tipe kamar &amp; harga mulai dari</h2>
<table>
<thead><tr><th>Kamar</th><th>Kapasitas</th><th>Ukuran</th><th>Harga mulai dari</th></tr></thead>
<tbody>
<tr><td><a href="/rooms/kamar-single">Single</a></td><td>1 tamu</td><td>15 m²</td><td>Rp175.000/malam</td></tr>
<tr><td><a href="/rooms/deluxe">Deluxe</a></td><td>2 tamu</td><td>18 m²</td><td>Rp230.000/malam</td></tr>
<tr><td><a href="/rooms/grand-deluxe">Grand Deluxe</a></td><td>2 tamu</td><td>20 m²</td><td>Rp300.000/malam</td></tr>
<tr><td><a href="/rooms/family-room-222">Family Room 222</a></td><td>hingga 4 tamu</td><td>50 m²</td><td>Rp500.000/malam</td></tr>
<tr><td><a href="/rooms/family-suite-100">Family Suite 100</a></td><td>hingga 4 tamu</td><td>60 m²</td><td>Rp500.000/malam</td></tr>
</tbody>
</table>
<ul>
<li><a href="/rooms/kamar-single">Single</a>: praktis untuk peserta tes atau tamu yang datang sendiri. Ada AC, WiFi, dan akses dapur bersama.</li>
<li><a href="/rooms/deluxe">Deluxe</a>: kamar di lantai dua dengan kasur queen, shower, dan pemandangan taman. Cocok untuk orang tua yang datang berdua.</li>
<li><a href="/rooms/grand-deluxe">Grand Deluxe</a>: kamar di lantai satu dengan kasur double dan air panas, untuk yang ingin sedikit lebih lega.</li>
<li><a href="/rooms/family-room-222">Family Room 222</a>: dua kamar tidur, dua kamar mandi, dan ruang keluarga di lantai dua. Favorit keluarga wisudawan.</li>
<li><a href="/rooms/family-suite-100">Family Suite 100</a>: dua kamar tidur dengan kamar mandi dalam, toilet tamu, ruang tamu dengan smart TV, area makan mini, dapur, dan teras pribadi di lantai satu.</li>
</ul>
<p>Harga bisa berbeda di tanggal tertentu. Untuk harga pasti, pilih tanggal di <a href="/book">halaman pemesanan</a>.</p>
<h2>Fasilitas</h2>
<ul>
<li>WiFi gratis</li>
<li>AC di kamar</li>
<li>Parkir gratis tersedia</li>
<li>Dapur bersama (untuk tipe kamar tertentu) dan mini kitchen di Family Suite</li>
<li>Balkon dan mini cafe</li>
<li>Check-in mulai pukul 14.00 WIB, check-out paling lambat pukul 12.00 WIB</li>
</ul>
<h2>Cara booking</h2>
<ol>
<li>Buka <a href="/book">halaman pemesanan</a> Pomah, pilih tanggal check-in/check-out dan jumlah tamu.</li>
<li>Pilih kamar yang tersedia, lalu isi data pemesan.</li>
<li>Ada pertanyaan soal tanggal wisuda atau kamar keluarga? Chat kami lewat WhatsApp di +62 851-9098-6169.</li>
</ol>
<p>Musim wisuda dan jadwal tes biasanya membuat kamar di sekitar kampus cepat penuh. Kalau tanggal sudah pasti, sebaiknya pesan jauh-jauh hari.</p>
<h2>Pertanyaan yang sering ditanyakan</h2>
<h3>Di mana alamat Pomah Guesthouse?</h3>
<p>Jl. Dewi Sartika IV No. 71, Sampangan, Semarang, Jawa Tengah 50232.</p>
<h3>Berapa jauh Pomah dari UNNES Sekaran?</h3>
<p>Sekitar 4,7 km, kurang lebih 10–12 menit berkendara, tergantung lalu lintas.</p>
<h3>Apakah Pomah cocok untuk keluarga yang datang saat wisuda UNNES?</h3>
<p>Cocok. Family Room 222 dan Family Suite 100 masing-masing punya dua kamar tidur untuk hingga empat tamu, jadi satu keluarga bisa menginap bersama dengan leluasa.</p>
<h3>Apakah tersedia parkir?</h3>
<p>Ya, tersedia parkir gratis untuk tamu.</p>
<h3>Berapa harga kamar termurah?</h3>
<p>Kamar Single mulai Rp175.000 per malam.</p>
$html$,
  homepage_config = pg_temp.patch_seo_json(homepage_config),
  sections = pg_temp.patch_seo_json(sections)
WHERE slug = 'penginapan-dekat-unnes';

DO $do$
DECLARE
  row public.explore_items%ROWTYPE;
  copy record;
BEGIN
  FOR row IN SELECT * FROM public.explore_items
  LOOP
    SELECT * INTO copy FROM pg_temp.guide_copy(row.title);
    IF copy.card IS NULL THEN
      CONTINUE;
    END IF;
    UPDATE public.explore_items
    SET
      description = copy.card,
      meta_description = copy.meta
    WHERE id = row.id;
  END LOOP;
END
$do$;

DROP FUNCTION pg_temp.apply_guide_cards(jsonb);
DROP FUNCTION pg_temp.guide_copy(text);
DROP FUNCTION pg_temp.patch_seo_json(jsonb);
