/**
 * Public SEO wiring: homepage, /explore, room pages, and sitemap
 * must render the seeded copy (not invented strings) and must not
 * leak "Gunungpati" on those public routes.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { DEFAULT_HOMEPAGE_CONFIG, mergeHomepageConfig } from "../src/admin/modules/homepage/homepage.config";
import { DEFAULT_EXPLORE_CONFIG, mergeExploreConfig } from "../src/admin/modules/explore/explore.config";
import { buildStorageImageUrl, heroImageSrcSet, heroImageUrlForViewport, heroImageVariants, heroPreloadLinks } from "../src/lib/storage-image";
import { isAnalyticsSnippet } from "../src/public/lib/defer-analytics";
import { approvedCityGuidePlace } from "../src/public/lib/city-guide";
import { cityGuideGraph, cityGuidePageGraph, faqPageGraph, homepageLodgingGraph, postalAddress, roomPageGraph, unnesLandingGraph } from "../src/public/lib/structured-data";
import { CityGuideArticleBody } from "../src/public/components/city-guide-article";
import { POMAH_NAP_ADDRESS, POMAH_NAP_LINE, POMAH_POSTAL_CODE } from "../src/public/lib/site-identity";
import { PUBLIC_HTML_CACHE_CONTROL, publicHtmlCacheControl } from "../src/public/lib/public-cache";
import { buildLogoImageUrl } from "../src/lib/storage-image";
import { buildGuideTextLinks } from "../src/public/components/guide-links";
import { rewritePublicHref } from "../src/public/lib/public-href";
import {
  canonicalHeadTags,
  canonicalUrlForPath,
  collectSitemapPaths,
  EXPLORE_SEO,
  HOME_SEO,
  isUnoptimizedSharePng,
  preferredOgImage,
  explorePlaceSeoMeta,
  publicSeoMeta,
  SHARE_OG_IMAGE,
  shareOgImageTags,
  resolveBookH1,
  resolveHomepageH1,
  resolveHomepageMeta,
  resolveHomepageTitle,
  resolveRoomPublicSeo,
  sitemapLastmodForPath,
} from "../src/public/lib/public-seo";
import {
  APPROVED_HOME,
  APPROVED_LP,
  APPROVED_ROOMS,
  CITY_GUIDE_ARTICLES,
  FAMILY_SUITE_DESCRIPTION_NEW,
  FAMILY_SUITE_DESCRIPTION_OLD,
  applyGuideCardIntros,
  cardIntroForName,
  cityGuideArticleForSlug,
  omitPublicHotWaterAmenities,
  patchUnnesDistance,
  publicRoomBlurb,
  stripPublicHotWaterClaim,
  stripPublicHotWaterJsonText,
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

const grandDeluxe = APPROVED_ROOMS["grand-deluxe"];
const grandDeluxeNote = APPROVED_LP.rooms.find((room) => room.href === "/rooms/grand-deluxe")?.note;
assert.equal(grandDeluxe.title, "Grand Deluxe Lantai 1 Lebih Lega | Pomah Semarang");
assert.equal(
  grandDeluxe.meta,
  "Grand Deluxe 20 m² di lantai 1 Pomah Guesthouse Semarang: kasur double, AC, dan WiFi. Kamar lebih lega untuk berdua, mulai Rp300.000/malam.",
);
assert.equal(grandDeluxeNote, "kamar di lantai satu dengan kasur double dan ruang yang sedikit lebih lega.");
assert.equal(
  `Grand Deluxe: ${grandDeluxeNote}`,
  "Grand Deluxe: kamar di lantai satu dengan kasur double dan ruang yang sedikit lebih lega.",
);
assert.doesNotMatch(
  `${grandDeluxe.title} ${grandDeluxe.meta} ${APPROVED_LP.rooms.map((room) => room.note).join(" ")}`,
  /air panas|air hangat|hot water|hot shower|water heater/i,
);

const storedHotWater = resolveRoomPublicSeo({
  name: "Grand Deluxe",
  slug: "grand-deluxe",
  seo_h1: "Grand Deluxe: Kamar Lebih Lega di Lantai Satu",
  seo_title: "Grand Deluxe Lantai 1 dengan Air Panas | Pomah Semarang",
  meta_description:
    "Grand Deluxe 20 m² di lantai 1 Pomah Guesthouse Semarang: kasur double, air panas, AC, dan WiFi. Kamar lebih lega untuk berdua, mulai Rp300.000/malam.",
  description: "Kamar lantai 1 dengan air panas",
});
assert.equal(storedHotWater.title, grandDeluxe.title);
assert.equal(storedHotWater.description, grandDeluxe.meta);
assert.equal(storedHotWater.h1, "Grand Deluxe: Kamar Lebih Lega di Lantai Satu");
const storedOg = publicSeoMeta(
  { title: storedHotWater.title, description: storedHotWater.description, twitterTitle: storedHotWater.twitterTitle, twitterDescription: storedHotWater.twitterDescription },
  { title: "fallback", description: "fallback" },
);
assert.deepEqual(storedOg.find((tag) => "property" in tag && tag.property === "og:title"), {
  property: "og:title",
  content: grandDeluxe.title,
});
assert.deepEqual(storedOg.find((tag) => "property" in tag && tag.property === "og:description"), {
  property: "og:description",
  content: grandDeluxe.meta,
});
assert.equal(
  stripPublicHotWaterClaim(
    "Mohon maaf Kak, saat ini Pomah belum menyediakan air hangat atau air panas di kamar mana pun.",
  ),
  "Mohon maaf Kak, saat ini Pomah belum menyediakan air hangat atau air panas di kamar mana pun.",
);
assert.equal(
  publicRoomBlurb(
    "grand-deluxe",
    "Kamar di lantai satu dengan kasur double dan air panas, untuk yang ingin sedikit lebih lega.",
  ),
  "kamar di lantai satu dengan kasur double dan ruang yang sedikit lebih lega.",
);
assert.deepEqual(omitPublicHotWaterAmenities(["AC", "Air Panas", "Hot Water", "WiFi"]), ["AC", "WiFi"]);
const strippedJsonLd = stripPublicHotWaterJsonText(JSON.stringify({
  "@type": "HotelRoom",
  amenityFeature: [
    { "@type": "LocationFeatureSpecification", name: "Air Panas", value: true },
    { "@type": "LocationFeatureSpecification", name: "WiFi", value: true },
  ],
}));
assert.doesNotMatch(strippedJsonLd, /air panas|hot water|water heater/i);
assert.match(strippedJsonLd, /WiFi/);
const hotWaterRoomSchema = JSON.stringify(
  roomPageGraph({
    name: "Grand Deluxe",
    slug: "grand-deluxe",
    description: "Kamar lantai 1 dengan air panas",
  }),
);
assert.doesNotMatch(hotWaterRoomSchema, /air panas|air hangat|hot water|hot shower|water heater|amenityFeature/i);

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
assert.ok(!paths.includes("/connect"), "/connect must not be listed in the sitemap");
const connectBlocked = collectSitemapPaths({
  pageSlugs: ["/connect", "connect", "https://pomahguesthouse.com/connect"],
});
assert.ok(!connectBlocked.includes("/connect"));
assert.ok(!connectBlocked.some((path) => path === "/connect" || path.startsWith("/connect/")));
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

const heroUrl = "https://example.supabase.co/storage/v1/object/public/room-images/hero.png";
const heroVariants = heroImageVariants(heroUrl);
assert.ok(heroVariants);
assert.deepEqual(
  heroVariants!.map((variant) => variant.width),
  [480, 768, 1080],
);
assert.match(heroVariants![0].url, /width=480/);
assert.match(heroVariants![0].url, /quality=30/);
assert.match(heroVariants![0].url, /format=webp/);
assert.match(heroVariants![1].url, /quality=70/);
assert.match(heroVariants![2].url, /quality=70/);
assert.match(heroVariants![0].media, /max-width: 767px/);
const heroSet = heroImageSrcSet(heroUrl) || "";
assert.match(heroSet, /480w/);
assert.match(heroSet, /quality=30/);
assert.match(heroSet, /768w/);
assert.match(heroSet, /quality=70/);
assert.match(heroSet, /1080w/);
assert.equal(heroImageUrlForViewport(heroUrl, 360), heroVariants![0].url);
assert.equal(heroImageUrlForViewport(heroUrl, 800), heroVariants![1].url);
assert.equal(heroImageUrlForViewport(heroUrl, 1400), heroVariants![2].url);
const heroPreloads = heroPreloadLinks(heroUrl);
assert.equal(heroPreloads.length, 3);
assert.equal(heroPreloads[0].imageSrcSet, `${heroVariants![0].url} 480w`);
assert.equal(
  isUnoptimizedSharePng(
    "https://example.supabase.co/storage/v1/object/public/room-images/media/share.png",
  ),
  true,
);
assert.equal(
  isUnoptimizedSharePng(
    "https://example.supabase.co/storage/v1/render/image/public/room-images/media/share.png?width=1200",
  ),
  false,
);
assert.equal(SHARE_OG_IMAGE.width, "1200");
assert.equal(SHARE_OG_IMAGE.height, "630");
assert.equal(SHARE_OG_IMAGE.type, "image/jpeg");
assert.match(SHARE_OG_IMAGE.url, /^https:\/\/pomahguesthouse\.com\/og\/pomah-1200x630\.jpg$/);
const shareTags = shareOgImageTags();
assert.equal(shareTags.filter((tag) => "property" in tag && tag.property === "og:image").length, 1);
assert.ok(shareTags.some((tag) => "name" in tag && tag.name === "twitter:image"));
assert.equal(heroPreloads[0].imageSizes, "100vw");
assert.equal(isAnalyticsSnippet("https://www.googletagmanager.com/gtag/js?id=G-TEST", ""), true);
assert.equal(isAnalyticsSnippet("", "function gtag(){dataLayer.push(arguments);}"), true);
assert.equal(isAnalyticsSnippet("", "<meta name=\"google-site-verification\" content=\"abc\">"), false);

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
assert.match(lodgingJson, /"latitude":-7.0209/);
assert.match(lodgingJson, /"longitude":110.3881/);

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

assert.equal(POMAH_POSTAL_CODE, "50221");
assert.equal(POMAH_NAP_ADDRESS, "Jl. Dewi Sartika IV No. 71, Sampangan, Semarang 50221");
assert.equal(
  POMAH_NAP_LINE,
  "Pomah Guesthouse, Jl. Dewi Sartika IV No. 71, Sampangan, Semarang 50221",
);
assert.equal(postalAddress().postalCode, "50221");

assert.equal(resolveBookH1("", "Pesan kamar dengan mudah"), "Pesan kamar dengan mudah");
assert.equal(resolveBookH1("   ", null), "Pesan kamar dengan mudah");
assert.equal(resolveBookH1("Judul booking", "Slide"), "Judul booking");
assert.equal(DEFAULT_HOMEPAGE_CONFIG.bookingSeo.h1, "Pesan kamar dengan mudah");

const lpSchema = JSON.stringify(
  unnesLandingGraph({
    rooms: [{ name: "Kamar Single", slug: "kamar-single", base_rate: 175000, capacity: 1 }],
    faqs: [{ question: "Di mana lokasinya?", answer: "Sampangan" }],
  }),
);
assert.match(lpSchema, /LodgingBusiness/);
assert.match(lpSchema, /BreadcrumbList/);
assert.match(lpSchema, /FAQPage/);
assert.match(lpSchema, /penginapan-dekat-unnes/);
assert.match(lpSchema, /"postalCode":"50221"/);
assert.match(lpSchema, /"price":175000/);

const logoUrl = buildLogoImageUrl(
  "https://example.supabase.co/storage/v1/object/public/room-images/branding/logo.png",
  60,
);
assert.match(logoUrl, /format=webp/);
assert.match(logoUrl, /resize=contain/);
assert.doesNotMatch(logoUrl, /\/object\/public\//);
assert.doesNotMatch(logoUrl, /format=origin/);

assert.equal(
  publicHtmlCacheControl({
    method: "GET",
    pathname: "/",
    status: 200,
    contentType: "text/html; charset=utf-8",
  }),
  PUBLIC_HTML_CACHE_CONTROL,
);
assert.equal(
  publicHtmlCacheControl({
    method: "GET",
    pathname: "/lp/penginapan-dekat-unnes",
    status: 200,
    contentType: "text/html",
  }),
  PUBLIC_HTML_CACHE_CONTROL,
);
assert.equal(
  publicHtmlCacheControl({
    method: "GET",
    pathname: "/login",
    status: 200,
    contentType: "text/html",
  }),
  null,
);
assert.equal(
  publicHtmlCacheControl({
    method: "GET",
    pathname: "/admin/settings",
    status: 200,
    contentType: "text/html",
  }),
  null,
);
assert.equal(
  publicHtmlCacheControl({
    method: "GET",
    pathname: "/book/confirmation/ABC",
    status: 200,
    contentType: "text/html",
  }),
  null,
);
assert.equal(
  publicHtmlCacheControl({
    method: "POST",
    pathname: "/",
    status: 200,
    contentType: "text/html",
  }),
  null,
);

const LAWANG_TITLE = "Lawang Sewu: Jam Buka & Harga Tiket 2026 | Pomah";
const LAWANG_META =
  "Lawang Sewu umumnya buka 08.00–20.00 WIB, Sabtu sampai 22.00. Tiket dewasa Rp20.000, anak Rp10.000. Plus rute 6 km dari Pomah Guesthouse Sampangan.";
const LAWANG_H1 = "Lawang Sewu Semarang: Jam Buka, Harga Tiket 2026 & Rute dari Pomah";
const STALE_LAWANG_HOURS = /07\.00|21\.00|07:00|21:00/;

function decodeHtml(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

const lawangArticle = cityGuideArticleForSlug("lawang-sewu-semarang");
assert.ok(lawangArticle);
assert.equal(lawangArticle.title, LAWANG_TITLE);
assert.equal(lawangArticle.title.length, 48);
assert.equal(lawangArticle.meta, LAWANG_META);
assert.equal(lawangArticle.meta.length, 147);
assert.equal(lawangArticle.h1, LAWANG_H1);
assert.equal(
  lawangArticle.cardIntro,
  'Gedung "seribu pintu" di Tugu Muda ini dulu kantor perusahaan kereta api zaman Belanda, sekarang jadi museum yang selalu ramai pengunjung. Dari Pomah cukup sekali jalan lewat pusat kota, dan paling enak didatangi pagi atau menjelang sore.',
);
assert.deepEqual(
  lawangArticle.sections.map((section) => section.heading),
  [
    "Info praktis Lawang Sewu",
    "Sekilas tentang Lawang Sewu",
    "Cara ke sana dari Pomah Guesthouse",
    "Jam buka & harga tiket Lawang Sewu 2026",
    "Tips berkunjung bersama keluarga",
    "Menginap di Pomah setelah ke Lawang Sewu",
  ],
);
assert.equal(lawangArticle.faq.length, 3);
assert.equal(
  lawangArticle.links.find((link) => link.href === "/rooms/kamar-single")?.anchor,
  "Kamar Single",
);
assert.doesNotMatch(JSON.stringify(lawangArticle), STALE_LAWANG_HOURS);
assert.doesNotMatch(
  JSON.stringify(lawangArticle),
  /openingHoursSpecification|LOFF|\bSenin\b|Rp15\.000/,
);
assert.doesNotMatch(JSON.stringify(lawangArticle), /air panas|air hangat/i);

const lawangHtml = renderToStaticMarkup(
  createElement(CityGuideArticleBody, { article: lawangArticle }),
);
const lawangVisible = decodeHtml(
  lawangHtml.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<[^>]+>/g, ""),
);
const lawangOrder = [
  "Info praktis Lawang Sewu",
  "Jam buka: umumnya 08.00–20.00 WIB, Sabtu sampai 22.00 WIB (menurut KAI).",
  "Sekilas tentang Lawang Sewu",
  "Rutenya mudah: dari Jl. Dewi Sartika lewat Jl. Menoreh Raya",
  "Kalau tidak membawa kendaraan, taksi atau ojek online",
  "Jam buka & harga tiket Lawang Sewu 2026",
  "Menurut KAI selaku pemilik gedung, jam buka Lawang Sewu umumnya:",
  "Hari biasa: 08.00–20.00 WIB",
  "Sabtu: 08.00–22.00 WIB",
  "Jadi umumnya Lawang Sewu tutup pukul 20.00 WIB",
  "Harga tiket masuk gedung:",
  "Dewasa & mahasiswa: Rp20.000/orang",
  "Area immersive memakai tiket terpisah. Jam dan harga bisa berbeda saat Ramadan",
  "Tips berkunjung bersama keluarga",
  "Menginap di Pomah setelah ke Lawang Sewu",
  "Kamar Single",
];
let lawangCursor = -1;
for (const marker of lawangOrder) {
  const at = lawangVisible.indexOf(marker);
  assert.ok(at > lawangCursor, marker);
  lawangCursor = at;
}
assert.doesNotMatch(lawangHtml, STALE_LAWANG_HOURS);
assert.doesNotMatch(lawangVisible, /Menginap dekat sini/);

const lawangFaqScript = lawangHtml.match(
  /<script type="application\/ld\+json">([\s\S]*?)<\/script>/,
);
assert.ok(lawangFaqScript);
const lawangFaqLd = JSON.parse(lawangFaqScript[1]) as {
  "@graph": Array<{
    "@type": string;
    mainEntity?: Array<{ name: string; acceptedAnswer: { text: string } }>;
  }>;
};
assert.deepEqual(
  lawangFaqLd,
  faqPageGraph(canonicalUrlForPath("/explore/lawang-sewu-semarang"), lawangArticle.faq),
);
const lawangFaqNode = lawangFaqLd["@graph"].find((node) => node["@type"] === "FAQPage");
assert.ok(lawangFaqNode?.mainEntity);
const lawangQuestions = [...lawangHtml.matchAll(/<dt[^>]*>([\s\S]*?)<\/dt>/g)].map((match) =>
  decodeHtml(match[1]),
);
const lawangAnswers = [...lawangHtml.matchAll(/<dd[^>]*>([\s\S]*?)<\/dd>/g)].map((match) =>
  decodeHtml(match[1]),
);
assert.equal(lawangQuestions.length, lawangArticle.faq.length);
assert.equal(lawangAnswers.length, lawangArticle.faq.length);
for (let index = 0; index < lawangArticle.faq.length; index += 1) {
  assert.equal(lawangQuestions[index], lawangArticle.faq[index]?.question);
  assert.equal(lawangAnswers[index], lawangArticle.faq[index]?.answer);
  assert.equal(lawangFaqNode.mainEntity[index]?.name, lawangQuestions[index]);
  assert.equal(lawangFaqNode.mainEntity[index]?.acceptedAnswer.text, lawangAnswers[index]);
}
assert.doesNotMatch(JSON.stringify(lawangFaqLd), STALE_LAWANG_HOURS);

const lawangGraph = JSON.parse(
  JSON.stringify(
    cityGuidePageGraph(
      {
        slug: "lawang-sewu",
        name: "Lawang Sewu Semarang",
        category: "destinasi",
        description: "Jam lama 07.00–21.00 WIB yang tidak boleh ikut ke schema.",
        location: "Jl. Pemuda No. 160",
      },
      lawangArticle,
    ),
  ),
) as { "@graph": Array<Record<string, unknown>> };
const lawangAttraction = lawangGraph["@graph"].find(
  (node) => node["@type"] === "TouristAttraction",
);
assert.ok(lawangAttraction);
assert.equal(lawangAttraction.description, LAWANG_META);
assert.equal(lawangAttraction.name, "Lawang Sewu");
assert.equal(lawangAttraction.url, "https://pomahguesthouse.com/explore/lawang-sewu-semarang");
assert.equal(JSON.stringify(lawangGraph).includes("openingHoursSpecification"), false);
assert.doesNotMatch(JSON.stringify(lawangGraph), STALE_LAWANG_HOURS);

const lawangHead = explorePlaceSeoMeta({
  title: lawangArticle.title,
  description: lawangArticle.meta,
});
function metaContent(
  tags: typeof lawangHead,
  key: "title" | "name" | "property",
  name: string,
): string | undefined {
  for (const tag of tags) {
    if (key === "title" && "title" in tag && name === "title") return tag.title;
    if (key === "name" && "name" in tag && tag.name === name) return tag.content;
    if (key === "property" && "property" in tag && tag.property === name) return tag.content;
  }
  return undefined;
}
assert.equal(metaContent(lawangHead, "title", "title"), LAWANG_TITLE);
assert.equal(metaContent(lawangHead, "name", "description"), LAWANG_META);
assert.equal(metaContent(lawangHead, "property", "og:title"), LAWANG_TITLE);
assert.equal(metaContent(lawangHead, "property", "og:description"), LAWANG_META);
assert.equal(metaContent(lawangHead, "name", "twitter:title"), LAWANG_TITLE);
assert.equal(metaContent(lawangHead, "name", "twitter:description"), LAWANG_META);

const lawangCards = applyGuideCardIntros({
  destinations: [
    { name: "Lawang Sewu", desc: "blurb lama", metaDescription: "meta lama 07.00–21.00" },
  ],
  events: [{ title: "Lawang Sewu Short Film Festival (LOFF) 2026", desc: "acara film" }],
}) as {
  destinations: Array<{ desc: string; metaDescription: string }>;
  events: Array<{ title: string; desc: string; metaDescription?: string }>;
};
assert.equal(lawangCards.destinations[0]?.desc, lawangArticle.cardIntro);
assert.equal(lawangCards.destinations[0]?.metaDescription, LAWANG_META);
assert.equal(lawangCards.events[0]?.desc, "acara film");
assert.equal(lawangCards.events[0]?.metaDescription, undefined);

const WIDO_TITLE = "Nasi Ayam Bu Wido Semarang: Lokasi, Jam Buka & Menu | Pomah";
const WIDO_META =
  "Nasi Ayam Bu Wido di Jl. Melati Selatan dekat Simpang Lima, buka 15.30–22.30. Nasi pincuk, ayam suwir, kuah opor & aneka sate. 8 km dari Pomah.";
const WIDO_H1 = "Nasi Ayam Bu Wido Semarang: Lokasi, Jam Buka & Rute dari Pomah";
const WIDO_ADDRESS =
  "Jl. Melati Selatan, Brumbungan, Kec. Semarang Tengah, Kota Semarang, Jawa Tengah 50135";
const WIDO_PLUS_CODE =
  "2C8C+MWM, Jl. Melati Selatan, Brumbungan, Kec. Semarang Tengah, Kota Semarang, Jawa Tengah 50135, Indonesia";
const WIDO_OLD_DESC =
  "Nasi Ayam Semarang adalah makanan khas Semarang yang terdiri dari nasi gurih, ayam suwir, kuah opor santan, telur pindang, dan sambal khas Jawa Tengah.";
const WIDO_FORBIDDEN_SCHEMA = [
  "priceRange",
  "telephone",
  "aggregateRating",
  "openingHoursSpecification",
] as const;

const widoArticle = cityGuideArticleForSlug("nasi-ayam-bu-wido");
assert.ok(widoArticle);
assert.equal(widoArticle.title, WIDO_TITLE);
assert.equal(widoArticle.title.length, 59);
assert.equal(widoArticle.meta, WIDO_META);
assert.equal(widoArticle.meta.length, 143);
assert.equal(widoArticle.h1, WIDO_H1);
assert.equal(widoArticle.canonicalSlug, "nasi-ayam-bu-wido");
assert.equal(widoArticle.displayAddress, WIDO_ADDRESS);
assert.doesNotMatch(JSON.stringify(widoArticle), /air panas|air hangat|\bpromo\b|telur pindang|sambal khas|2C8C|\+/i);
assert.deepEqual(
  widoArticle.sections.map((section) => section.heading),
  [
    "Info praktis Nasi Ayam Bu Wido",
    "Sekilas tentang Nasi Ayam Bu Wido",
    "Cara ke sana dari Pomah Guesthouse",
    "Jam buka & waktu terbaik datang",
    "Tips makan bersama keluarga",
    "Menginap di Pomah setelah kulineran malam",
  ],
);
assert.deepEqual(widoArticle.links, [
  { anchor: "Kamar Deluxe untuk berdua", href: "/rooms/deluxe" },
  { anchor: "Family Room 222 untuk keluarga", href: "/rooms/family-room-222" },
  { anchor: "Kamar Single", href: "/rooms/kamar-single" },
  { anchor: "kuliner malam di Pasar Semawis", href: "/explore/wisata-kuliner-malam-pasar-semawis" },
  { anchor: "lunpia untuk oleh-oleh", href: "/explore/lcm-lunpia-cik-me-me" },
]);
assert.equal(widoArticle.faq.length, 3);

const widoHtml = renderToStaticMarkup(
  createElement(CityGuideArticleBody, { article: widoArticle }),
);
const widoVisible = decodeHtml(
  widoHtml.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<[^>]+>/g, ""),
);
const widoOrder = [
  "Info praktis Nasi Ayam Bu Wido",
  "Jam buka: setiap hari sekitar 15.30–22.30 WIB (menurut Google Maps).",
  "Sekilas tentang Nasi Ayam Bu Wido",
  "Cara ke sana dari Pomah Guesthouse",
  "Jam buka & waktu terbaik datang",
  "Tips makan bersama keluarga",
  "kuliner malam di Pasar Semawis",
  "lunpia untuk oleh-oleh",
  "Menginap di Pomah setelah kulineran malam",
  "Kamar Deluxe",
  "Family Room 222",
  "Kamar Single",
  widoArticle.faq[0]!.question,
  widoArticle.faq[2]!.answer,
];
assert.match(widoHtml, /href="\/rooms\/deluxe"/);
assert.match(widoHtml, /href="\/rooms\/family-room-222"/);
assert.match(widoHtml, /href="\/rooms\/kamar-single"/);
assert.match(widoHtml, /href="\/explore\/wisata-kuliner-malam-pasar-semawis"/);
assert.match(widoHtml, /href="\/explore\/lcm-lunpia-cik-me-me"/);
let widoCursor = -1;
for (const marker of widoOrder) {
  const at = widoVisible.indexOf(marker);
  assert.ok(at > widoCursor, marker);
  widoCursor = at;
}
assert.doesNotMatch(widoVisible, /2C8C|\+|telur pindang|sambal khas|air panas|air hangat|\bpromo\b/i);

const widoFaqScript = widoHtml.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
assert.ok(widoFaqScript);
const widoFaqLd = JSON.parse(widoFaqScript[1]) as {
  "@graph": Array<{
    "@type": string;
    mainEntity?: Array<{ name: string; acceptedAnswer: { text: string } }>;
  }>;
};
assert.deepEqual(
  widoFaqLd,
  faqPageGraph(canonicalUrlForPath("/explore/nasi-ayam-bu-wido"), widoArticle.faq),
);
const widoFaqNode = widoFaqLd["@graph"].find((node) => node["@type"] === "FAQPage");
assert.ok(widoFaqNode?.mainEntity);
const widoQuestions = [...widoHtml.matchAll(/<dt[^>]*>([\s\S]*?)<\/dt>/g)].map((match) =>
  decodeHtml(match[1]),
);
const widoAnswers = [...widoHtml.matchAll(/<dd[^>]*>([\s\S]*?)<\/dd>/g)].map((match) =>
  decodeHtml(match[1]),
);
assert.equal(widoQuestions.length, widoArticle.faq.length);
assert.equal(widoAnswers.length, widoArticle.faq.length);
for (let index = 0; index < widoArticle.faq.length; index += 1) {
  assert.equal(widoQuestions[index], widoArticle.faq[index]?.question);
  assert.equal(widoAnswers[index], widoArticle.faq[index]?.answer);
  assert.equal(widoFaqNode.mainEntity[index]?.name, widoQuestions[index]);
  assert.equal(widoFaqNode.mainEntity[index]?.acceptedAnswer.text, widoAnswers[index]);
}

const widoShown = approvedCityGuidePlace(widoArticle, {
  slug: "nasi-ayam-bu-wido",
  name: "Nasi Ayam Bu Wido",
  description: WIDO_OLD_DESC,
  metaDescription: "",
  imageUrl: null,
  category: "kuliner",
  location: WIDO_PLUS_CODE,
  rating: "4.6",
  dateText: null,
  updatedAt: "2026-09-27T00:00:00.000Z",
  createdAt: null,
});
assert.equal(widoShown.location, WIDO_ADDRESS);
assert.equal(widoShown.description, widoArticle.cardIntro);
assert.equal(widoShown.metaDescription, WIDO_META);
assert.equal(widoShown.rating, "4.6");
assert.equal(widoShown.category, "kuliner");
assert.doesNotMatch(`${widoShown.location} ${widoShown.description}`, /2C8C|\+|telur pindang|sambal khas/);

const widoCards = applyGuideCardIntros({
  culinary: [
    {
      name: "Nasi Ayam Bu Wido",
      desc: WIDO_OLD_DESC,
      address: WIDO_PLUS_CODE,
      rating: "4.6",
      image: "https://example.com/wido.jpg",
    },
    { name: "Tahu Gimbal Pak Edy", desc: "tetap", address: "Jl. Sriwijaya No. 29, Semarang", rating: "4.6" },
  ],
}) as {
  culinary: Array<{ name: string; desc: string; address: string; rating: string; metaDescription?: string }>;
};
assert.equal(widoCards.culinary[0]?.desc, widoArticle.cardIntro);
assert.equal(widoCards.culinary[0]?.metaDescription, WIDO_META);
assert.equal(widoCards.culinary[0]?.address, WIDO_ADDRESS);
assert.equal(widoCards.culinary[0]?.rating, "4.6");
assert.equal(widoCards.culinary[1]?.desc, "tetap");
assert.equal(widoCards.culinary[1]?.address, "Jl. Sriwijaya No. 29, Semarang");
assert.doesNotMatch(widoCards.culinary[0]?.address ?? "", /2C8C|\+/);

const widoGraph = JSON.parse(
  JSON.stringify(
    cityGuidePageGraph(
      {
        slug: "nasi-ayam-bu-wido",
        name: "Nasi Ayam Bu Wido",
        category: "kuliner",
        description: WIDO_OLD_DESC,
        location: WIDO_PLUS_CODE,
      },
      widoArticle,
    ),
  ),
) as { "@graph": Array<Record<string, unknown>> };
const widoRestaurant = widoGraph["@graph"].find((node) => node["@type"] === "Restaurant");
assert.ok(widoRestaurant);
assert.equal(widoRestaurant.name, "Nasi Ayam Bu Wido");
assert.equal(widoRestaurant.description, WIDO_META);
assert.equal(widoRestaurant.url, "https://pomahguesthouse.com/explore/nasi-ayam-bu-wido");
assert.equal(widoRestaurant.servesCuisine, "Nasi ayam Semarang");
assert.deepEqual(widoRestaurant.address, {
  "@type": "PostalAddress",
  streetAddress: "Jl. Melati Selatan",
  addressLocality: "Semarang",
  addressRegion: "Jawa Tengah",
  postalCode: "50135",
  addressCountry: "ID",
});
const widoGeo = widoRestaurant.geo as { "@type": string; latitude: number; longitude: number };
assert.equal(widoGeo["@type"], "GeoCoordinates");
assert.equal(widoGeo.latitude.toFixed(5), "-6.98329");
assert.equal(widoGeo.longitude.toFixed(5), "110.42230");
const widoSchemaJson = JSON.stringify(widoGraph);
for (const key of WIDO_FORBIDDEN_SCHEMA) {
  assert.equal(Object.prototype.hasOwnProperty.call(widoRestaurant, key), false, key);
  assert.equal(widoSchemaJson.includes(`"${key}"`), false, key);
}
assert.doesNotMatch(widoSchemaJson, /2C8C|\+|4\.6|telur pindang|sambal khas|aggregateRating|openingHours/);

const widoHead = explorePlaceSeoMeta({
  title: widoArticle.title,
  description: widoArticle.meta,
});
assert.equal(metaContent(widoHead, "title", "title"), WIDO_TITLE);
assert.equal(metaContent(widoHead, "name", "description"), WIDO_META);
assert.equal(metaContent(widoHead, "property", "og:title"), WIDO_TITLE);
assert.equal(metaContent(widoHead, "property", "og:description"), WIDO_META);
assert.equal(metaContent(widoHead, "name", "twitter:title"), WIDO_TITLE);
assert.equal(metaContent(widoHead, "name", "twitter:description"), WIDO_META);

const widoSql = readFileSync(
  new URL("../supabase/migrations/20261006153000_nasi_ayam_bu_wido_explore_copy.sql", import.meta.url),
  "utf8",
);
assert.ok(widoSql.includes(widoArticle.cardIntro));
assert.ok(widoSql.includes(WIDO_META));
assert.ok(widoSql.includes(WIDO_ADDRESS));
assert.ok(widoSql.includes("00000000-0000-0000-0000-000000000001"));
assert.match(widoSql, /label = 'Nasi Ayam Bu Wido'/);
assert.match(widoSql, /IS DISTINCT FROM/);
assert.doesNotMatch(widoSql, /Pamularsih|2C8C|priceRange|telephone|aggregateRating|openingHoursSpecification/);

console.log("test-public-seo: ok");
