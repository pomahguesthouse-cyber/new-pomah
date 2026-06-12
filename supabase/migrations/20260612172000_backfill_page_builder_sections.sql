update seo_landing_pages
set sections = jsonb_build_array(
  jsonb_build_object(
    'id', 'header-' || substr(md5(id::text), 1, 8),
    'type', 'header',
    'brand', 'Pomah Guesthouse',
    'sticky', true,
    'cta_text', coalesce(nullif(hero_cta_text, ''), 'Pesan Sekarang'),
    'cta_url', coalesce(nullif(hero_cta_url, ''), '/book'),
    'links', jsonb_build_array(
      jsonb_build_object('label', 'Home', 'url', '/'),
      jsonb_build_object('label', 'Facilities', 'url', '/#facilities'),
      jsonb_build_object('label', 'Lokasi', 'url', '/#lokasi'),
      jsonb_build_object('label', 'Jelajah Semarang', 'url', '/explore')
    )
  ),
  jsonb_build_object(
    'id', 'hero-' || substr(md5(id::text), 1, 8),
    'type', 'hero',
    'headline', coalesce(nullif(hero_headline, ''), title),
    'subheadline', coalesce(nullif(hero_subheadline, ''), target_keyword, 'Penginapan nyaman di Semarang'),
    'image_url', og_image_url,
    'overlay', 42,
    'cta_text', coalesce(nullif(hero_cta_text, ''), 'Pesan Sekarang'),
    'cta_url', coalesce(nullif(hero_cta_url, ''), '/book')
  ),
  jsonb_build_object(
    'id', 'content-' || substr(md5(id::text), 1, 8),
    'type', 'text',
    'title', title,
    'content', coalesce(nullif(body_content, ''), '<p>Tulis konten halaman ini di sini.</p>'),
    'align', 'left'
  ),
  jsonb_build_object(
    'id', 'cta-' || substr(md5(id::text), 1, 8),
    'type', 'cta_banner',
    'headline', 'Siap menginap di Pomah Guesthouse?',
    'subheadline', coalesce(nullif(target_keyword, ''), 'Booking cepat lewat WhatsApp atau halaman booking.'),
    'cta_text', coalesce(nullif(hero_cta_text, ''), 'Pesan Sekarang'),
    'cta_url', coalesce(nullif(hero_cta_url, ''), '/book'),
    'style', 'teal'
  )
)
where sections is null
   or sections = '[]'::jsonb
   or sections = '{}'::jsonb;
