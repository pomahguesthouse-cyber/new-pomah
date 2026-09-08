/**
 * Public SEO wiring: homepage, /explore, room pages, and sitemap
 * must render the seeded copy (not invented strings) and must not
 * leak "Gunungpati" on those public routes.
 */
import assert from "node:assert/strict";

import { DEFAULT_HOMEPAGE_CONFIG, mergeHomepageConfig } from "../src/admin/modules/homepage/homepage.config";
import { DEFAULT_EXPLORE_CONFIG, mergeExploreConfig } from "../src/admin/modules/explore/explore.config";
import {
  collectSitemapPaths,
  EXPLORE_SEO,
  HOME_SEO,
  publicSeoMeta,
  resolveRoomPublicSeo,
} from "../src/public/lib/public-seo";

assert.equal(HOME_SEO.h1, "Penginapan Dekat UNNES Semarang");
assert.equal(HOME_SEO.title, "Pomah Guesthouse | Penginapan Dekat UNNES Semarang");
assert.equal(
  HOME_SEO.description,
  "Penginapan dekat UNNES Semarang di Sampangan. Pomah Guesthouse: family room, WiFi, parkir, suasana tenang. Pesan di situs resmi.",
);

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

const rooms: Array<{ slug: string; name: string; h1: string; title: string; description: string }> = [
  {
    slug: "kamar-single",
    name: "Kamar Single",
    h1: "Kamar Single, Penginapan Dekat UNNES",
    title: "Kamar Single | Penginapan Dekat UNNES Semarang",
    description:
      "Kamar single di penginapan dekat UNNES Semarang. Praktis untuk solo traveler: bersih, WiFi, AC. Pomah Guesthouse, Sampangan.",
  },
  {
    slug: "deluxe",
    name: "Kamar Deluxe",
    h1: "Kamar Deluxe, Penginapan Dekat UNNES",
    title: "Kamar Deluxe | Penginapan Dekat UNNES Semarang",
    description:
      "Kamar Deluxe di Pomah Guesthouse, penginapan dekat UNNES Semarang. Nyaman untuk dua orang, WiFi, AC, dan parkir.",
  },
  {
    slug: "grand-deluxe",
    name: "Grand Deluxe",
    h1: "Grand Deluxe, Penginapan Dekat UNNES",
    title: "Grand Deluxe | Penginapan Dekat UNNES Semarang",
    description:
      "Grand Deluxe Pomah Guesthouse: kamar lebih lega di penginapan dekat UNNES Semarang. Tenang, WiFi, AC, parkir tersedia.",
  },
  {
    slug: "family-suite-100",
    name: "Family Suite 100",
    h1: "Family Suite 100, Penginapan Dekat UNNES",
    title: "Family Suite 100 | Penginapan Dekat UNNES Semarang",
    description:
      "Family Suite 100 di penginapan dekat UNNES Semarang. Suite luas, 2 kamar tidur, 2 kamar mandi, nyaman untuk keluarga.",
  },
  {
    slug: "family-room-222",
    name: "Family Room 222",
    h1: "Family Room 222, Penginapan Dekat UNNES",
    title: "Family Room 222 | Penginapan Dekat UNNES Semarang",
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
  pageSlugs: ["/", "/rooms", "rooms", "/book"],
  roomSlugs: rooms.map((r) => r.slug),
});
assert.ok(paths.includes("/"));
assert.ok(paths.includes("/book"));
assert.ok(paths.includes("/explore"), "sitemap must list /explore");
assert.ok(!paths.includes("/rooms"), "bare /rooms 404s and must not be listed");
assert.ok(!paths.includes("/rooms/"), "trailing-slash /rooms must not be listed");
for (const room of rooms) {
  assert.ok(paths.includes(`/rooms/${room.slug}`), room.slug);
}

const homeBlob = JSON.stringify(DEFAULT_HOMEPAGE_CONFIG.seo);
const exploreBlob = JSON.stringify(DEFAULT_EXPLORE_CONFIG.seo);
assert.doesNotMatch(homeBlob, /Gunungpati/i);
assert.doesNotMatch(exploreBlob, /Gunungpati/i);

console.log("test-public-seo: ok");
