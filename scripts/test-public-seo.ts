/**
 * Public SEO wiring: homepage, /explore, room pages, and sitemap
 * must render the seeded copy (not invented strings) and must not
 * leak "Gunungpati" on those public routes.
 */
import assert from "node:assert/strict";

import { DEFAULT_HOMEPAGE_CONFIG, mergeHomepageConfig } from "../src/admin/modules/homepage/homepage.config";
import { DEFAULT_EXPLORE_CONFIG, mergeExploreConfig } from "../src/admin/modules/explore/explore.config";
import { buildStorageImageUrl } from "../src/lib/storage-image";
import { cityGuideGraph, faqPageGraph, homepageLodgingGraph, roomPageGraph } from "../src/public/lib/structured-data";
import { buildGuideTextLinks } from "../src/public/components/guide-links";
import { rewritePublicHref } from "../src/public/lib/public-href";
import {
  canonicalHeadTags,
  canonicalUrlForPath,
  collectSitemapPaths,
  EXPLORE_SEO,
  HOME_SEO,
  preferredOgImage,
  publicSeoMeta,
  resolveHomepageH1,
  resolveHomepageMeta,
  resolveHomepageTitle,
  resolveRoomPublicSeo,
  sitemapLastmodForPath,
} from "../src/public/lib/public-seo";
import {
  APPROVED_HOME,
  APPROVED_ROOMS,
  CITY_GUIDE_ARTICLES,
  FAMILY_SUITE_DESCRIPTION_NEW,
  FAMILY_SUITE_DESCRIPTION_OLD,
  cardIntroForName,
  cityGuideArticleForSlug,
  patchUnnesDistance,
  publicRoomBlurb,
} from "../src/public/content/approved-seo";

assert.equal(
  preferredOgImage(
    "https://images.unsplash.com/photo-1",
    "https://example.supabase.co/storage/v1/object/public/rooms/hero.png",
  ),
  "https://example.supabase.co/storage/v1/object/public/rooms/hero.png",
);
assert.equal(preferredOgImage("https://images.unsplash.com/photo-1"), "");

assert.equal(HOME_SEO.h1, APPROVED_HOME.h1);
assert.equal(resolveHomepageH1("Penginapan Dekat UNNES Semarang"), HOME_SEO.h1);
assert.equal(resolveHomepageH1("Guesthouse Keluarga di Semarang, Dekat UNNES"), HOME_SEO.h1);
assert.equal(resolveHomepageH1(""), HOME_SEO.h1);
assert.equal(resolveHomepageH1("Judul kustom Dewi"), "Judul kustom Dewi");
assert.equal(HOME_SEO.title, APPROVED_HOME.title);
assert.equal(HOME_SEO.description, APPROVED_HOME.meta);
assert.equal(
  resolveHomepageTitle("Pomah Guesthouse | Penginapan Dekat UNNES Semarang"),
  HOME_SEO.title,
);
assert.equal(resolveHomepageTitle("Judul kustom Dewi"), "Judul kustom Dewi");
assert.equal(
  resolveHomepageMeta(
    "Penginapan dekat UNNES Semarang di Sampangan. Pomah Guesthouse: family room, WiFi, parkir, suasana tenang. Pesan di situs resmi.",
  ),
  HOME_SEO.description,
);
assert.equal(resolveHomepageMeta("Meta kustom Dewi"), "Meta kustom Dewi");

assert.equal(DEFAULT_HOMEPAGE_CONFIG.seo.h1, HOME_SEO.h1);
assert.equal(DEFAULT_HOMEPAGE_CONFIG.seo.metaTitle, HOME_SEO.title);
assert.equal(DEFAULT_HOMEPAGE_CONFIG.seo.metaDescription, HOME_SEO.description);
assert.equal(DEFAULT_HOMEPAGE_CONFIG.seo.twitterTitle, HOME_SEO.title);
assert.equal(DEFAULT_HOMEPAGE_CONFIG.seo.twitterDescription, HOME_SEO.description);

assert.equal(EXPLORE_SEO.h1, "Jelajahi Semarang");
assert.equal(EXPLORE_SEO.title, "Jelajahi Semarang | Panduan Tamu Penginapan Dekat UNNES");
assert.equal(
  EXPLORE_SEO.description,
  "Panduan wisata dan kuliner Semarang untuk tamu penginapan dekat UNNES. Destinasi, tempat makan, dan event dari Pomah Guesthouse.",
);
assert.equal(DEFAULT_EXPLORE_CONFIG.seo.h1, EXPLORE_SEO.h1);
assert.equal(DEFAULT_EXPLORE_CONFIG.seo.metaTitle, EXPLORE_SEO.title);
assert.equal(DEFAULT_EXPLORE_CONFIG.seo.metaDescription, EXPLORE_SEO.description);
assert.equal(DEFAULT_EXPLORE_CONFIG.seo.twitterTitle, EXPLORE_SEO.title);
assert.equal(DEFAULT_EXPLORE_CONFIG.seo.twitterDescription, EXPLORE_SEO.description);

const homeMeta = publicSeoMeta(
  {
    title: DEFAULT_HOMEPAGE_CONFIG.seo.metaTitle,
    description: DEFAULT_HOMEPAGE_CONFIG.seo.metaDescription,
    twitterTitle: DEFAULT_HOMEPAGE_CONFIG.seo.twitterTitle,
    twitterDescription: DEFAULT_HOMEPAGE_CONFIG.seo.twitterDescription,
  },
  HOME_SEO,
);
assert.deepEqual(
  homeMeta.find((t) => "title" in t),
  { title: HOME_SEO.title },
);
assert.deepEqual(
  homeMeta.find((t) => "name" in t && t.name === "description"),
  { name: "description", content: HOME_SEO.description },
);
assert.deepEqual(
  homeMeta.find((t) => "name" in t && t.name === "twitter:title"),
  { name: "twitter:title", content: HOME_SEO.title },
);
assert.deepEqual(
  homeMeta.find((t) => "name" in t && t.name === "twitter:description"),
  { name: "twitter:description", content: HOME_SEO.description },
);

const exploreFromSeed = mergeExploreConfig({
  seo: {
    h1: EXPLORE_SEO.h1,
    metaTitle: EXPLORE_SEO.title,
    metaDescription: EXPLORE_SEO.description,
    twitterTitle: EXPLORE_SEO.title,
    twitterDescription: EXPLORE_SEO.description,
  },
});
assert.equal(exploreFromSeed.seo.h1, EXPLORE_SEO.h1);
assert.equal(exploreFromSeed.seo.metaTitle, EXPLORE_SEO.title);

const homeFromSeed = mergeHomepageConfig({
  seo: {
    h1: HOME_SEO.h1,
    metaTitle: HOME_SEO.title,
    metaDescription: HOME_SEO.description,
    twitterTitle: HOME_SEO.title,
    twitterDescription: HOME_SEO.description,
  },
});
assert.equal(homeFromSeed.seo.h1, HOME_SEO.h1);
assert.equal(homeFromSeed.seo.twitterTitle, HOME_SEO.title);

const legacy = resolveRoomPublicSeo({
  name: "Kamar Single",
  slug: "kamar-single",
  seo_h1: "Kamar Single, Penginapan Dekat UNNES",
  seo_title: "Kamar Single | Penginapan Dekat UNNES Semarang",
  meta_description: "Deskripsi kustom yang tetap dipakai.",
});
assert.equal(legacy.h1, APPROVED_ROOMS["kamar-single"].h1);
assert.equal(legacy.title, APPROVED_ROOMS["kamar-single"].title);
assert.equal(legacy.description, "Deskripsi kustom yang tetap dipakai.");
assert.doesNotMatch(legacy.title + legacy.h1, /Penginapan Dekat UNNES/);

const emptyRoom = resolveRoomPublicSeo({ name: "Family Suite 100", slug: "family-suite-100" });
assert.equal(emptyRoom.title, APPROVED_ROOMS["family-suite-100"].title);
assert.equal(emptyRoom.h1, APPROVED_ROOMS["family-suite-100"].h1);
assert.equal(emptyRoom.description, APPROVED_ROOMS["family-suite-100"].meta);

const rooms: Array<{ slug: string; name: string; h1: string; title: string; description: string }> = [
  {
    slug: "kamar-single",
    name: "Kamar Single",
    h1: "Kamar Single",
    title: "Kamar Single – Pomah Guesthouse Semarang",
    description:
      "Kamar single di penginapan dekat UNNES Semarang. Praktis untuk solo traveler: bersih, WiFi, AC. Pomah Guesthouse, Sampangan.",
  },
  {
    slug: "deluxe",
    name: "Kamar Deluxe",
    h1: "Kamar Deluxe",
    title: "Kamar Deluxe – Pomah Guesthouse Semarang",
    description:
      "Kamar Deluxe di Pomah Guesthouse, penginapan dekat UNNES Semarang. Nyaman untuk dua orang, WiFi, AC, dan parkir.",
  },
  {
    slug: "grand-deluxe",
    name: "Grand Deluxe",
    h1: "Grand Deluxe",
    title: "Grand Deluxe – Pomah Guesthouse Semarang",
    description:
      "Grand Deluxe Pomah Guesthouse: kamar lebih lega di penginapan dekat UNNES Semarang. Tenang, WiFi, AC, parkir tersedia.",
  },
  {
    slug: "family-suite-100",
    name: "Family Suite 100",
    h1: "Family Suite 100",
    title: "Family Suite 100 – Pomah Guesthouse Semarang",
    description:
      "Family Suite 100 di penginapan dekat UNNES Semarang. Suite luas, 2 kamar tidur, 2 kamar mandi, nyaman untuk keluarga.",
  },
  {
    slug: "family-room-222",
    name: "Family Room 222",
    h1: "Family Room 222",
    title: "Family Room 222 – Pomah Guesthouse Semarang",
    description:
      "Family Room 222, kamar andalan Pomah Guesthouse. Penginapan dekat UNNES Semarang untuk keluarga, terasa seperti di rumah.",
  },
];

for (const room of rooms) {
  const seo = resolveRoomPublicSeo({
    name: room.name,
    slug: room.slug,
    seo_h1: room.h1,
    seo_title: room.title,
    meta_description: room.description,
  });
  assert.equal(seo.h1, room.h1, room.slug);
  assert.equal(seo.title, room.title, room.slug);
  assert.equal(seo.description, room.description, room.slug);
  assert.equal(seo.twitterTitle, room.title, room.slug);
  assert.equal(seo.twitterDescription, room.description, room.slug);
  assert.doesNotMatch(seo.title + seo.description + seo.h1, /Gunungpati/i, room.slug);
}

const paths = collectSitemapPaths({
  pageSlugs: [
    "/",
    "/rooms",
    "rooms",
    "/book",
    "/explore-semarang",
    "/explore-semarang/sam-poo-kong",
    "https://www.pomahguesthouse.com/rooms/deluxe",
    "https://pomahguesthouse.com/rooms/deluxe-ocean-view",
    "/explore/eksplorasi-sejarah-kota-lama-semarang",
    "http://pomahguesthouse.com/explore",
  ],
  roomSlugs: rooms.map((r) => r.slug),
  landingSlugs: ["penginapan-dekat-unnes", "/lp/should-not-duplicate"],
});
assert.ok(paths.includes("/"));
assert.ok(paths.includes("/book"));
assert.ok(paths.includes("/explore"), "sitemap must list /explore");
assert.ok(paths.includes("/lp/penginapan-dekat-unnes"));
assert.ok(!paths.includes("/rooms"), "bare /rooms 404s and must not be listed");
assert.ok(!paths.includes("/rooms/"), "trailing-slash /rooms must not be listed");
assert.ok(!paths.includes("/explore-semarang"));
assert.ok(!paths.includes("/explore-semarang/sam-poo-kong"));
assert.ok(!paths.includes("/rooms/deluxe-ocean-view"));
assert.ok(!paths.includes("/explore/eksplorasi-sejarah-kota-lama-semarang"));
for (const room of rooms) {
  assert.ok(paths.includes(`/rooms/${room.slug}`), room.slug);
}
for (const path of paths) {
  const loc = canonicalUrlForPath(path);
  assert.match(loc, /^https:\/\/pomahguesthouse\.com(\/|$)/);
  assert.doesNotMatch(loc, /www\.|http:\/\/|explore-semarang|deluxe-ocean-view/);
}
const stamps = {
  propertyUpdatedAt: "2026-08-01T00:00:00.000Z",
  rooms: [{ slug: "deluxe", updated_at: "2026-07-02T03:04:05.000Z" }],
  landings: [{ slug: "penginapan-dekat-unnes", updated_at: "2026-06-01T00:00:00.000Z" }],
  pages: [],
};
assert.equal(sitemapLastmodForPath("/", stamps), "2026-08-01T00:00:00.000Z");
assert.equal(sitemapLastmodForPath("/rooms/deluxe", stamps), "2026-07-02T03:04:05.000Z");
assert.equal(
  sitemapLastmodForPath("/lp/penginapan-dekat-unnes", stamps),
  "2026-06-01T00:00:00.000Z",
);
assert.equal(sitemapLastmodForPath("/rooms/missing", stamps), undefined);

assert.equal(canonicalUrlForPath("/"), "https://pomahguesthouse.com/");
assert.equal(canonicalUrlForPath("/explore?utm=1"), "https://pomahguesthouse.com/explore");
assert.equal(canonicalUrlForPath("/rooms/deluxe/"), "https://pomahguesthouse.com/rooms/deluxe");
const homeCanonical = canonicalHeadTags("/");
assert.equal(homeCanonical.links[0]?.href, "https://pomahguesthouse.com/");
assert.equal(homeCanonical.meta[0]?.content, "https://pomahguesthouse.com/");

const homeBlob = JSON.stringify(DEFAULT_HOMEPAGE_CONFIG.seo);
const exploreBlob = JSON.stringify(DEFAULT_EXPLORE_CONFIG.seo);
assert.doesNotMatch(homeBlob, /Gunungpati/i);
assert.doesNotMatch(exploreBlob, /Gunungpati/i);

assert.equal(rewritePublicHref("/rooms"), "/#rooms");
assert.equal(rewritePublicHref("/rooms/"), "/#rooms");
assert.equal(rewritePublicHref("/rooms/deluxe"), "/rooms/deluxe");

const guideLinks = buildGuideTextLinks(
  [
    { slug: "lawang-sewu-semarang", name: "Lawang Sewu Semarang" },
    { slug: "kota-lama-semarang", name: "Kota Lama Semarang" },
  ],
  8,
);
assert.ok(guideLinks.some((link) => link.href === "/explore/lawang-sewu-semarang"));
assert.ok(guideLinks.some((link) => link.href === "/explore/gedongsongo-festival"));
assert.ok(guideLinks.some((link) => link.href === "/explore/lawang-sewu-short-film-festival-loff-2026"));
assert.ok(guideLinks.some((link) => link.href === "/explore/rute-bus-trans-semarang-baru-resmi-dibuka"));
assert.ok(guideLinks.some((link) => link.href === "/lp/penginapan-dekat-unnes"));

const transformed = buildStorageImageUrl(
  "https://example.supabase.co/storage/v1/object/public/room-images/hero.png",
  { width: 768, quality: 60 },
);
assert.match(transformed, /\/storage\/v1\/render\/image\/public\//);
assert.match(transformed, /format=webp/);
assert.match(transformed, /width=768/);
assert.doesNotMatch(transformed, /format=origin/);
assert.equal(
  buildStorageImageUrl("https://images.unsplash.com/photo-1", { width: 640 }),
  "https://images.unsplash.com/photo-1",
);

const lodging = homepageLodgingGraph({
  rooms: [
    { name: "Kamar Single", slug: "kamar-single", base_rate: 175000, capacity: 1 },
    { name: "Kamar Deluxe", slug: "deluxe", base_rate: 230000, capacity: 2 },
    { name: "Family Suite 100", slug: "family-suite-100", base_rate: 450000, capacity: 4 },
  ],
  reviews: { rating: 4.8, total: 77 },
  faqs: [{ question: "Di mana?", answer: "Sampangan" }],
});
const lodgingJson = JSON.stringify(lodging);
assert.match(lodgingJson, /"reviewCount":77/);
assert.match(lodgingJson, /"price":175000/);
assert.match(lodgingJson, /"price":230000/);
assert.match(lodgingJson, /family-suite-100/);
assert.doesNotMatch(lodgingJson, /UNDIP|Simpang Lima|200000|300000/);
assert.match(lodgingJson, /FAQPage/);
assert.match(lodgingJson, /"latitude":-6.9936/);

const roomSchema = JSON.stringify(
  roomPageGraph({ name: "Kamar Single", slug: "kamar-single", base_rate: 175000, capacity: 1 }),
);
assert.match(roomSchema, /HotelRoom/);
assert.match(roomSchema, /BreadcrumbList/);
assert.match(roomSchema, /"price":175000/);
assert.doesNotMatch(roomSchema, /FAQPage/);

const culinary = JSON.stringify(
  cityGuideGraph({ slug: "soto-pak-wito-trangkil", name: "Soto Pak Wito", category: "kuliner" }),
);
assert.match(culinary, /Restaurant/);
assert.match(culinary, /BreadcrumbList/);
const eventSchema = JSON.stringify(
  cityGuideGraph({
    slug: "gedongsongo-festival",
    name: "Gedongsongo Festival",
    category: "event",
    dateText: "22 Oktober 2026",
    location: "Gedong Songo",
  }),
);
assert.match(eventSchema, /"@type":"Event"/);
const placeSchema = JSON.stringify(
  cityGuideGraph({ slug: "lawang-sewu-semarang", name: "Lawang Sewu", category: "destinasi" }),
);
assert.match(placeSchema, /TouristAttraction/);
assert.doesNotMatch(placeSchema, /FAQPage/);

const faqOnly = JSON.stringify(
  faqPageGraph("https://pomahguesthouse.com/explore/lawang-sewu-semarang", [
    { question: "Berapa harga tiket Lawang Sewu?", answer: "Rp20.000" },
  ]),
);
assert.match(faqOnly, /FAQPage/);
assert.match(faqOnly, /lawang-sewu-semarang#faq/);

for (const article of CITY_GUIDE_ARTICLES) {
  const firstParagraph = article.sections.flatMap((section) => section.paragraphs).find(Boolean) ?? "";
  assert.notEqual(article.cardIntro, firstParagraph, article.canonicalSlug);
  assert.equal(cardIntroForName(article.names[0], "fallback"), article.cardIntro);
  assert.equal(cityGuideArticleForSlug(article.canonicalSlug)?.h1, article.h1);
  assert.ok(article.meta.length > 0 && article.meta.length <= 160, article.canonicalSlug);
}
assert.equal(cityGuideArticleForSlug("lawang-sewu")?.canonicalSlug, "lawang-sewu-semarang");
assert.equal(cityGuideArticleForSlug("lawang-sewu-short-film-festival-loff-2026"), null);
assert.equal(
  publicRoomBlurb("family-suite-100", FAMILY_SUITE_DESCRIPTION_OLD),
  FAMILY_SUITE_DESCRIPTION_NEW,
);
assert.doesNotMatch(FAMILY_SUITE_DESCRIPTION_NEW, /di pusat kota|kelompok besar/);

const nearby = mergeHomepageConfig({
  lokasi: {
    heading: "Lokasi",
    subheading: "",
    nearbyTitle: "Dekat",
    nearby: [
      { name: "Unnes Sekaran", type: "Universitas", distance: "8 km", time: "~13 menit" },
      { name: "Undip Tembalang", type: "Universitas", distance: "8 km", time: "~20 menit" },
    ],
  },
}).lokasi.nearby;
assert.equal(nearby[0]?.distance, "4,7 km");
assert.equal(nearby[0]?.time, "~10–12 menit");
assert.equal(nearby[1]?.name, "Unnes Sampangan (Kelud Utara III)");
assert.equal(nearby[2]?.distance, "8 km");
assert.equal(nearby[2]?.time, "~20 menit");

const lpNearby = patchUnnesDistance({
  name: "Unnes Sekaran",
  type: "Universitas",
  distance: "8 km",
  time: "~10 menit",
});
assert.equal(lpNearby.distance, "4,7 km");
assert.equal(lpNearby.time, "~10–12 menit");
assert.equal(
  DEFAULT_HOMEPAGE_CONFIG.lokasi.nearby.find((item) => item.name === "Undip Tembalang")?.distance,
  "8 km",
);

console.log("test-public-seo: ok");
