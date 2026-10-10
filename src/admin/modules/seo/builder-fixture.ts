import type { LandingBrief, LandmarkRow } from "@/admin/modules/seo/landing-briefs.functions";
import type { LPSectionsData, SeoLandingPage } from "@/admin/modules/seo/landing-page.functions";
import type { QualityReport } from "@/public/lib/lp-quality";

const now = "2026-10-10T00:00:00.000Z";

export const FIXTURE_LP_ID = "fixture-lp";

export const FIXTURE_PAGES: SeoLandingPage[] = [
  {
    id: FIXTURE_LP_ID,
    property_id: null,
    title: "Penginapan Dekat UNNES",
    slug: "penginapan-dekat-unnes",
    target_keyword: "penginapan dekat unnes semarang",
    hero_headline: "Penginapan dekat UNNES Semarang",
    hero_subheadline: "Untuk wisuda dan keluarga",
    hero_cta_text: "Pesan Sekarang",
    hero_cta_url: "/book",
    body_content: null,
    meta_title: "Penginapan Dekat UNNES Semarang",
    meta_description: "Guesthouse dekat kampus dengan parkir luas.",
    og_image_url: null,
    published: false,
    sections: [],
    homepage_config: null,
    custom_head: null,
    custom_robots: null,
    json_ld_enabled: true,
    custom_json_ld: null,
    noindex: true,
    created_at: now,
    updated_at: now,
  },
  {
    id: "fixture-lp-2",
    property_id: null,
    title: "Kamar Keluarga Semarang",
    slug: "kamar-keluarga-semarang",
    target_keyword: null,
    hero_headline: null,
    hero_subheadline: null,
    hero_cta_text: "Pesan Sekarang",
    hero_cta_url: "/book",
    body_content: null,
    meta_title: null,
    meta_description: null,
    og_image_url: null,
    published: true,
    sections: [],
    homepage_config: null,
    custom_head: null,
    custom_robots: null,
    json_ld_enabled: true,
    custom_json_ld: null,
    noindex: false,
    created_at: now,
    updated_at: now,
  },
];

export const FIXTURE_SECTIONS: LPSectionsData = [
  {
    id: "fx-hero",
    type: "hero",
    headline: "Penginapan dekat UNNES",
    subheadline: "Untuk wisuda dan keluarga",
    cta_text: "Pesan Sekarang",
    cta_url: "/book",
    overlay: 40,
  },
  {
    id: "fx-text",
    type: "text",
    title: "Mengapa Pomah",
    content: "<p>Parkir luas dan dekat kampus.</p>",
    align: "left",
  },
  {
    id: "fx-faq",
    type: "faq",
    title: "Pertanyaan umum",
    items: [{ question: "Ada parkir?", answer: "Ya, lahan parkir luas." }],
  },
];

export const FIXTURE_BRIEFS: LandingBrief[] = [
  {
    id: "00000000-0000-4000-8000-000000000001",
    primary_keyword: "penginapan dekat unnes semarang",
    secondary_keywords: ["wisuda unnes", "guesthouse semarang"],
    intent: "menginap keluarga",
    slug: "penginapan-dekat-unnes",
    target_audience: "Keluarga wisudawan",
    unique_angle: "Dekat kampus, parkir luas",
    landmark_ids: [],
    faq_seeds: ["Apakah ada sarapan?"],
    review_keywords: ["wisuda", "keluarga"],
    explore_slugs: [],
    room_type_ids: [],
    min_capacity: 2,
    status: "approved",
    landing_page_id: null,
  },
  {
    id: "00000000-0000-4000-8000-000000000002",
    primary_keyword: "penginapan murah semarang selatan",
    secondary_keywords: ["guesthouse murah"],
    intent: "menginap hemat",
    slug: "penginapan-murah-semarang-selatan",
    target_audience: "Wisatawan",
    unique_angle: "Harga mulai dari kamar standar",
    landmark_ids: [],
    faq_seeds: [],
    review_keywords: ["keluarga"],
    explore_slugs: [],
    room_type_ids: [],
    min_capacity: null,
    status: "draft",
    landing_page_id: null,
  },
];

export const FIXTURE_LANDMARKS: LandmarkRow[] = [
  {
    id: "00000000-0000-4000-8000-000000000011",
    name: "UNNES Sekaran",
    category: "kampus",
    lat: -7.05,
    lng: 110.39,
    road_distance_km: 1.2,
    travel_minutes: 5,
    verified: true,
    notes: "Gerbang utama",
    sort_order: 1,
  },
  {
    id: "00000000-0000-4000-8000-000000000012",
    name: "RSUP Dr. Kariadi",
    category: "rs",
    lat: null,
    lng: null,
    road_distance_km: null,
    travel_minutes: null,
    verified: false,
    notes: null,
    sort_order: 2,
  },
];

export const FIXTURE_QUALITY: QualityReport = {
  pass: false,
  words: 420,
  similarity: 0.12,
  checks: [
    { id: "words", label: "Panjang konten", pass: true, detail: "420 kata, cukup untuk halaman ini." },
    { id: "keyword", label: "Keyword utama", pass: false, detail: "Keyword belum muncul di judul H1." },
    { id: "landmark", label: "Landmark terverifikasi", pass: true, detail: "Minimal satu landmark berstatus verified." },
    { id: "faq", label: "FAQ", pass: false, detail: "Tambahkan minimal dua pertanyaan." },
  ],
};

export const FIXTURE_PREVIEW_HTML = `<!doctype html><html><head><meta charset="utf-8"><style>
  body{margin:0;font-family:Georgia,serif;background:#faf7f2;color:#1c1917}
  header{padding:28px 32px;background:#0f766e;color:#fff;font-family:system-ui,sans-serif}
  section{padding:48px 32px}
  h1{font-size:42px;line-height:1.15;margin:0 0 12px}
  p{font-size:18px;line-height:1.5;max-width:40rem}
  .card{margin-top:24px;padding:20px;background:#fff;border:1px solid #e7e5e4;border-radius:12px}
</style></head><body>
  <header>Pomah Guesthouse</header>
  <section>
    <h1>Pratinjau kanvas</h1>
    <p>Iframe ini memakai lebar desktop 1280 atau ponsel 390, lalu diskalakan agar muat di kanvas.</p>
    <div class="card">Section contoh — tidak ada scroll horizontal pada halaman admin.</div>
  </section>
</body></html>`;
