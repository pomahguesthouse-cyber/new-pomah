-- Hapus klaim publik "air panas / air hangat" dari data SEO yang sudah tersimpan.
-- Migrasi 20260927153000 tidak diubah (sudah dijalankan). File ini idempoten:
-- baris yang tidak lagi mengandung klaim tidak di-UPDATE.
-- Teks yang menyatakan air hangat BELUM tersedia dibiarkan.

CREATE OR REPLACE FUNCTION pg_temp.replace_public_hot_water_claim(input text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $fn$
DECLARE
  result text := input;
  claim text := '(air[[:space:]]*panas|air[[:space:]]*hangat|hot[[:space:]]*water|hot[[:space:]]*shower|water[[:space:]]*heater|pemanas[[:space:]]*air)';
  denial text := '(belum[[:space:]]+(menyediakan|ada|tersedia)|tidak[[:space:]]+(menyediakan|tersedia)|jangan[[:space:]]+(pernah|mengklaim|laporkan|menyimpulkan|klaim))';
BEGIN
  IF result IS NULL OR result !~* claim THEN
    RETURN result;
  END IF;

  -- Baris SOP yang menganggap air panas sebagai fasilitas yang bisa rusak.
  result := replace(result, 'Komplain sedang (AC, air panas):', 'Komplain sedang (AC):');
  result := regexp_replace(
    result,
    'Komplain sedang \(AC,[[:space:]]*air[[:space:]]*panas\):',
    'Komplain sedang (AC):',
    'gi'
  );
  result := regexp_replace(
    result,
    '(^|\n)[[:space:]]*-[[:space:]]*air[[:space:]]*panas[[:space:]]+tidak[[:space:]]+berfungsi[[:space:]]*',
    E'\\1',
    'gi'
  );

  -- Pernyataan "belum tersedia" (termasuk prompt bot PR #60) tidak dipotong.
  IF result ~* denial THEN
    RETURN result;
  END IF;

  result := replace(
    result,
    'Grand Deluxe Lantai 1 dengan Air Panas | Pomah Semarang',
    'Grand Deluxe Lantai 1 Lebih Lega | Pomah Semarang'
  );
  result := regexp_replace(
    result,
    'Grand Deluxe Lantai 1 dengan air[[:space:]]*panas \| Pomah Semarang',
    'Grand Deluxe Lantai 1 Lebih Lega | Pomah Semarang',
    'gi'
  );
  result := replace(
    result,
    'Grand Deluxe 20 m² di lantai 1 Pomah Guesthouse Semarang: kasur double, air panas, AC, dan WiFi. Kamar lebih lega untuk berdua, mulai Rp300.000/malam.',
    'Grand Deluxe 20 m² di lantai 1 Pomah Guesthouse Semarang: kasur double, AC, dan WiFi. Kamar lebih lega untuk berdua, mulai Rp300.000/malam.'
  );
  result := regexp_replace(
    result,
    'kasur double,[[:space:]]*air[[:space:]]*panas,[[:space:]]*AC, dan WiFi',
    'kasur double, AC, dan WiFi',
    'gi'
  );
  result := replace(
    result,
    'Kamar di lantai satu dengan kasur double dan air panas, untuk yang ingin sedikit lebih lega.',
    'kamar di lantai satu dengan kasur double dan ruang yang sedikit lebih lega.'
  );
  result := replace(
    result,
    'kamar di lantai satu dengan kasur double dan air panas, untuk yang ingin sedikit lebih lega.',
    'kamar di lantai satu dengan kasur double dan ruang yang sedikit lebih lega.'
  );
  result := regexp_replace(
    result,
    'kamar di lantai satu dengan kasur double dan air[[:space:]]*panas, untuk yang ingin sedikit lebih lega\.',
    'kamar di lantai satu dengan kasur double dan ruang yang sedikit lebih lega.',
    'gi'
  );

  IF result !~* claim THEN
    RETURN result;
  END IF;

  result := regexp_replace(result, '[[:space:]]+(dan|dengan)[[:space:]]+' || claim, '', 'gi');
  result := regexp_replace(result, '[[:space:]]*,[[:space:]]*' || claim, '', 'gi');
  result := regexp_replace(result, claim || '[[:space:]]*,[[:space:]]*', '', 'gi');
  result := regexp_replace(result, claim, '', 'gi');
  result := regexp_replace(result, '[[:space:]]{2,}', ' ', 'g');
  result := regexp_replace(result, '[[:space:]]+([,.;])', '\1', 'g');
  result := regexp_replace(result, '([,.;])[[:space:]]*[,.;]+', '\1', 'g');
  RETURN btrim(result);
END;
$fn$;

CREATE OR REPLACE FUNCTION pg_temp.patch_json_claims(node jsonb)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
AS $fn$
DECLARE
  key text;
  val jsonb;
  elem jsonb;
  built jsonb;
  result jsonb;
  item_text text;
  claim text := '(air[[:space:]]*panas|air[[:space:]]*hangat|hot[[:space:]]*water|hot[[:space:]]*shower|water[[:space:]]*heater|pemanas[[:space:]]*air)';
BEGIN
  IF node IS NULL OR jsonb_typeof(node) IS NULL OR jsonb_typeof(node) = 'null' THEN
    RETURN node;
  END IF;

  -- Tanpa klaim, kembalikan node yang sama supaya UPDATE tidak menulis ulang JSON.
  IF node::text !~* '(air[[:space:]]*panas|air[[:space:]]*hangat|hot[[:space:]]*water|hot[[:space:]]*shower|water[[:space:]]*heater|pemanas[[:space:]]*air)' THEN
    RETURN node;
  END IF;

  IF jsonb_typeof(node) = 'string' THEN
    RETURN to_jsonb(pg_temp.replace_public_hot_water_claim(node #>> '{}'));
  END IF;

  IF jsonb_typeof(node) = 'array' THEN
    built := '[]'::jsonb;
    FOR elem IN SELECT value FROM jsonb_array_elements(node)
    LOOP
      built := built || jsonb_build_array(pg_temp.patch_json_claims(elem));
    END LOOP;
    RETURN built;
  END IF;

  IF jsonb_typeof(node) <> 'object' THEN
    RETURN node;
  END IF;

  result := node;
  FOR key, val IN SELECT * FROM jsonb_each(node)
  LOOP
    IF key IN ('amenityFeature', 'amenities') AND jsonb_typeof(val) = 'array' THEN
      built := '[]'::jsonb;
      FOR elem IN SELECT value FROM jsonb_array_elements(val)
      LOOP
        item_text := CASE
          WHEN jsonb_typeof(elem) = 'string' THEN elem #>> '{}'
          WHEN jsonb_typeof(elem) = 'object' THEN coalesce(elem->>'name', '') || ' ' || coalesce(elem->>'value', '')
          ELSE ''
        END;
        IF item_text ~* claim THEN
          CONTINUE;
        END IF;
        built := built || jsonb_build_array(pg_temp.patch_json_claims(elem));
      END LOOP;
      result := jsonb_set(result, ARRAY[key], built, true);
    ELSE
      result := jsonb_set(result, ARRAY[key], pg_temp.patch_json_claims(val), true);
    END IF;
  END LOOP;
  RETURN result;
END;
$fn$;

CREATE OR REPLACE FUNCTION pg_temp.rewrite_json_text(input text)
RETURNS text
LANGUAGE plpgsql
AS $fn$
DECLARE
  parsed jsonb;
BEGIN
  IF input IS NULL OR btrim(input) = '' THEN
    RETURN input;
  END IF;
  IF left(btrim(input), 1) NOT IN ('{', '[') THEN
    RETURN pg_temp.replace_public_hot_water_claim(input);
  END IF;
  BEGIN
    parsed := input::jsonb;
  EXCEPTION WHEN others THEN
    RETURN pg_temp.replace_public_hot_water_claim(input);
  END;
  RETURN pg_temp.patch_json_claims(parsed)::text;
END;
$fn$;

UPDATE public.room_types
SET
  seo_title = pg_temp.replace_public_hot_water_claim(seo_title),
  meta_description = pg_temp.replace_public_hot_water_claim(meta_description),
  description = pg_temp.replace_public_hot_water_claim(description),
  short_description = pg_temp.replace_public_hot_water_claim(short_description),
  seo_h1 = pg_temp.replace_public_hot_water_claim(seo_h1)
WHERE seo_title IS DISTINCT FROM pg_temp.replace_public_hot_water_claim(seo_title)
   OR meta_description IS DISTINCT FROM pg_temp.replace_public_hot_water_claim(meta_description)
   OR description IS DISTINCT FROM pg_temp.replace_public_hot_water_claim(description)
   OR short_description IS DISTINCT FROM pg_temp.replace_public_hot_water_claim(short_description)
   OR seo_h1 IS DISTINCT FROM pg_temp.replace_public_hot_water_claim(seo_h1);

UPDATE public.room_types AS rt
SET amenities = COALESCE((
  SELECT array_agg(item ORDER BY ord)
  FROM unnest(rt.amenities) WITH ORDINALITY AS listed(item, ord)
  WHERE item !~* '(air[[:space:]]*panas|air[[:space:]]*hangat|hot[[:space:]]*water|hot[[:space:]]*shower|water[[:space:]]*heater|pemanas[[:space:]]*air)'
), '{}'::text[])
WHERE rt.amenities IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM unnest(rt.amenities) AS item
    WHERE item ~* '(air[[:space:]]*panas|air[[:space:]]*hangat|hot[[:space:]]*water|hot[[:space:]]*shower|water[[:space:]]*heater|pemanas[[:space:]]*air)'
  );

UPDATE public.seo_landing_pages
SET
  title = pg_temp.replace_public_hot_water_claim(title),
  meta_title = pg_temp.replace_public_hot_water_claim(meta_title),
  meta_description = pg_temp.replace_public_hot_water_claim(meta_description),
  hero_headline = pg_temp.replace_public_hot_water_claim(hero_headline),
  hero_subheadline = pg_temp.replace_public_hot_water_claim(hero_subheadline),
  body_content = pg_temp.replace_public_hot_water_claim(body_content),
  custom_head = pg_temp.replace_public_hot_water_claim(custom_head),
  custom_json_ld = pg_temp.rewrite_json_text(custom_json_ld),
  homepage_config = CASE
    WHEN homepage_config IS NULL THEN NULL
    ELSE pg_temp.patch_json_claims(homepage_config)
  END,
  sections = CASE
    WHEN sections IS NULL THEN NULL
    ELSE pg_temp.patch_json_claims(sections)
  END
WHERE title IS DISTINCT FROM pg_temp.replace_public_hot_water_claim(title)
   OR meta_title IS DISTINCT FROM pg_temp.replace_public_hot_water_claim(meta_title)
   OR meta_description IS DISTINCT FROM pg_temp.replace_public_hot_water_claim(meta_description)
   OR hero_headline IS DISTINCT FROM pg_temp.replace_public_hot_water_claim(hero_headline)
   OR hero_subheadline IS DISTINCT FROM pg_temp.replace_public_hot_water_claim(hero_subheadline)
   OR body_content IS DISTINCT FROM pg_temp.replace_public_hot_water_claim(body_content)
   OR custom_head IS DISTINCT FROM pg_temp.replace_public_hot_water_claim(custom_head)
   OR custom_json_ld IS DISTINCT FROM pg_temp.rewrite_json_text(custom_json_ld)
   OR homepage_config IS DISTINCT FROM (
     CASE WHEN homepage_config IS NULL THEN NULL ELSE pg_temp.patch_json_claims(homepage_config) END
   )
   OR sections IS DISTINCT FROM (
     CASE WHEN sections IS NULL THEN NULL ELSE pg_temp.patch_json_claims(sections) END
   );

UPDATE public.properties
SET
  description = pg_temp.replace_public_hot_water_claim(description),
  tagline = pg_temp.replace_public_hot_water_claim(tagline),
  hotel_policy = pg_temp.replace_public_hot_water_claim(hotel_policy),
  homepage_config = pg_temp.patch_json_claims(homepage_config),
  explore_config = pg_temp.patch_json_claims(explore_config),
  ai_lab_config = pg_temp.patch_json_claims(ai_lab_config)
WHERE description IS DISTINCT FROM pg_temp.replace_public_hot_water_claim(description)
   OR tagline IS DISTINCT FROM pg_temp.replace_public_hot_water_claim(tagline)
   OR hotel_policy IS DISTINCT FROM pg_temp.replace_public_hot_water_claim(hotel_policy)
   OR homepage_config IS DISTINCT FROM pg_temp.patch_json_claims(homepage_config)
   OR explore_config IS DISTINCT FROM pg_temp.patch_json_claims(explore_config)
   OR ai_lab_config IS DISTINCT FROM pg_temp.patch_json_claims(ai_lab_config);

UPDATE public.explore_items
SET
  title = pg_temp.replace_public_hot_water_claim(title),
  description = pg_temp.replace_public_hot_water_claim(description),
  meta_description = pg_temp.replace_public_hot_water_claim(meta_description)
WHERE title IS DISTINCT FROM pg_temp.replace_public_hot_water_claim(title)
   OR description IS DISTINCT FROM pg_temp.replace_public_hot_water_claim(description)
   OR meta_description IS DISTINCT FROM pg_temp.replace_public_hot_water_claim(meta_description);

UPDATE public.seo_generated_pages
SET
  title = pg_temp.replace_public_hot_water_claim(title),
  meta_title = pg_temp.replace_public_hot_water_claim(meta_title),
  meta_description = pg_temp.replace_public_hot_water_claim(meta_description),
  content = pg_temp.replace_public_hot_water_claim(content),
  schema_markup = pg_temp.patch_json_claims(schema_markup)
WHERE title IS DISTINCT FROM pg_temp.replace_public_hot_water_claim(title)
   OR meta_title IS DISTINCT FROM pg_temp.replace_public_hot_water_claim(meta_title)
   OR meta_description IS DISTINCT FROM pg_temp.replace_public_hot_water_claim(meta_description)
   OR content IS DISTINCT FROM pg_temp.replace_public_hot_water_claim(content)
   OR schema_markup IS DISTINCT FROM pg_temp.patch_json_claims(schema_markup);

UPDATE public.seo_generated_articles
SET
  title = pg_temp.replace_public_hot_water_claim(title),
  meta_description = pg_temp.replace_public_hot_water_claim(meta_description),
  paragraphs = pg_temp.patch_json_claims(paragraphs)
WHERE title IS DISTINCT FROM pg_temp.replace_public_hot_water_claim(title)
   OR meta_description IS DISTINCT FROM pg_temp.replace_public_hot_water_claim(meta_description)
   OR paragraphs IS DISTINCT FROM pg_temp.patch_json_claims(paragraphs);

UPDATE public.seo_schema_registry
SET json_ld = pg_temp.patch_json_claims(json_ld)
WHERE json_ld IS DISTINCT FROM pg_temp.patch_json_claims(json_ld);

UPDATE public.page_elements
SET content = pg_temp.patch_json_claims(content)
WHERE content IS DISTINCT FROM pg_temp.patch_json_claims(content);

UPDATE public.sop_documents
SET content = pg_temp.replace_public_hot_water_claim(content)
WHERE content IS DISTINCT FROM pg_temp.replace_public_hot_water_claim(content);

UPDATE public.sop_chunks
SET content = pg_temp.replace_public_hot_water_claim(content)
WHERE btrim(pg_temp.replace_public_hot_water_claim(content)) <> ''
  AND content IS DISTINCT FROM pg_temp.replace_public_hot_water_claim(content);

DELETE FROM public.sop_chunks
WHERE btrim(pg_temp.replace_public_hot_water_claim(content)) = ''
  AND content ~* '(air[[:space:]]*panas|air[[:space:]]*hangat|hot[[:space:]]*water|hot[[:space:]]*shower|water[[:space:]]*heater|pemanas[[:space:]]*air)';

UPDATE public.chatbot_training_examples
SET ideal_assistant_response = pg_temp.replace_public_hot_water_claim(ideal_assistant_response)
WHERE ideal_assistant_response IS DISTINCT FROM pg_temp.replace_public_hot_water_claim(ideal_assistant_response);
