-- Copy City Guide Nasi Ayam Bu Wido yang disetujui 6 Oktober 2026.
-- Deploy tidak menjalankan file ini. Jalankan seluruh skrip sekali di
-- SQL editor Supabase setelah deploy.
-- Hanya mengubah item explore_config bernama persis 'Nasi Ayam Bu Wido'
-- pada property 00000000-0000-0000-0000-000000000001:
--   desc            = intro kartu
--   metaDescription = meta halaman
--   address         = alamat tanpa Plus Code di depan
-- Rating, gambar, nearby_distance, dan item explore lain tidak diubah.
-- Geo beranda tidak diubah.
-- Aman dijalankan ulang: baris tidak ditulis lagi bila nilainya sudah sama.

CREATE OR REPLACE FUNCTION pg_temp.patch_nasi_ayam_bu_wido(config jsonb)
RETURNS jsonb
LANGUAGE plpgsql
AS $fn$
DECLARE
  result jsonb := coalesce(config, '{}'::jsonb);
  key text;
  item jsonb;
  built jsonb;
  label text;
  card text := $card$Nasi ayam legendaris Semarang yang diracik di pincuk daun pisang: nasi, ayam suwir, telur, tahu bacem, sayur labu siam, dan krecek, lalu disiram kuah opor. Warungnya di Jl. Melati Selatan dekat Simpang Lima, buka setiap hari sekitar pukul 15.30–22.30 WIB.$card$;
  meta text := $meta$Nasi Ayam Bu Wido di Jl. Melati Selatan dekat Simpang Lima, buka 15.30–22.30. Nasi pincuk, ayam suwir, kuah opor & aneka sate. 8 km dari Pomah.$meta$;
  street text := $street$Jl. Melati Selatan, Brumbungan, Kec. Semarang Tengah, Kota Semarang, Jawa Tengah 50135$street$;
BEGIN
  FOREACH key IN ARRAY ARRAY['destinations', 'culinary']
  LOOP
    IF jsonb_typeof(result -> key) IS DISTINCT FROM 'array' THEN
      CONTINUE;
    END IF;
    built := '[]'::jsonb;
    FOR item IN SELECT value FROM jsonb_array_elements(result -> key)
    LOOP
      label := btrim(coalesce(item->>'name', ''));
      IF label = 'Nasi Ayam Bu Wido' THEN
        item := jsonb_set(item, '{desc}', to_jsonb(card), true);
        item := jsonb_set(item, '{metaDescription}', to_jsonb(meta), true);
        item := jsonb_set(item, '{address}', to_jsonb(street), true);
      END IF;
      built := built || jsonb_build_array(item);
    END LOOP;
    result := jsonb_set(result, ARRAY[key], built, true);
  END LOOP;
  RETURN result;
END;
$fn$;

UPDATE public.properties AS p
SET explore_config = pg_temp.patch_nasi_ayam_bu_wido(p.explore_config)
WHERE p.id = '00000000-0000-0000-0000-000000000001'
  AND p.explore_config IS DISTINCT FROM pg_temp.patch_nasi_ayam_bu_wido(p.explore_config);
