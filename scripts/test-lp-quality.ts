/**
 * Quality gates for keyword landing pages.
 */
import assert from "node:assert/strict";
import { isIndexableSitemapPath } from "../src/public/lib/public-seo";
import {
  evaluateLandingQuality,
  indexedH1Count,
  type QualityLandmark,
  type QualityPage,
  type QualityRoom,
} from "../src/public/lib/lp-quality";

const rooms: QualityRoom[] = [{ id: "room-1", slug: "deluxe", name: "Deluxe", capacity: 2 }];
const verified: QualityLandmark = {
  id: "lm-verified",
  name: "RSUP Kariadi",
  verified: true,
  road_distance_km: 5,
  travel_minutes: 15,
};
const unverified: QualityLandmark = {
  id: "lm-open",
  name: "Goa Kreo",
  verified: false,
  road_distance_km: 6.5,
  travel_minutes: 16,
};

function filler(count: number, prefix: string): string {
  return Array.from({ length: count }, (_, index) => `${prefix}${index}`).join(" ");
}

function page(overrides: Partial<QualityPage> = {}, words = 520): QualityPage {
  return {
    id: "page-1",
    slug: "penginapan-dekat-rsup-kariadi",
    title: "Penginapan dekat RSUP Kariadi",
    target_keyword: "penginapan dekat rsup kariadi",
    meta_title: "Penginapan dekat RSUP Kariadi",
    meta_description: "Kamar tamu keluarga yang berkunjung ke rumah sakit Kariadi, pesan lewat situs resmi Pomah.",
    hero_headline: "Penginapan dekat RSUP Kariadi",
    sections: [
      { id: "h", type: "hero", headline: "Penginapan dekat RSUP Kariadi", cta_url: "/book" },
      {
        id: "t",
        type: "text",
        title: "Untuk keluarga pasien",
        content: `<p>${filler(words, "kata")}</p><p><a href="/rooms/deluxe">kamar</a> <a href="/book">pesan</a> <a href="/explore/lawang-sewu-semarang">jelajah</a></p>`,
      },
      { id: "loc", type: "location", landmark_ids: ["lm-verified"] },
      { id: "rooms", type: "filtered_rooms", room_type_ids: ["room-1"] },
      {
        id: "faq",
        type: "faq",
        items: [
          { question: "Di mana parkir?", answer: "Parkir ada di dalam halaman." },
          { question: "Jam check-in?", answer: "Check-in mulai pukul 14.00." },
          { question: "Ada WiFi?", answer: "WiFi tersedia di area umum." },
          { question: "Bagaimana pesan?", answer: "Pesan lewat situs resmi." },
        ],
      },
      { id: "ex", type: "related_explore", slugs: ["lawang-sewu-semarang"] },
    ],
    ...overrides,
  };
}

const base = evaluateLandingQuality({ page: page(), landmarks: [verified, unverified], rooms });
assert.equal(base.pass, true, base.checks.filter((check) => !check.pass).map((check) => check.detail).join(" | "));

const reserved = evaluateLandingQuality({
  page: page({ target_keyword: "Penginapan Dekat UNNES" }),
  landmarks: [verified],
  rooms,
});
assert.equal(reserved.checks.find((check) => check.id === "keyword")?.pass, false);

const shortCopy = evaluateLandingQuality({
  page: page({}, 400),
  landmarks: [verified],
  rooms,
});
assert.equal(shortCopy.checks.find((check) => check.id === "words")?.pass, false);
assert.ok(shortCopy.words < 500);

const twin = page({ id: "page-2", slug: "salinan-kembar" });
const similar = evaluateLandingQuality({
  page: page(),
  otherPages: [twin],
  landmarks: [verified],
  rooms,
});
assert.equal(similar.checks.find((check) => check.id === "similarity")?.pass, false);
assert.ok(similar.similarity >= 0.6);

const blank: QualityPage = {
  slug: "kosong",
  title: "",
  meta_title: "",
  hero_headline: "",
  sections: [{ id: "t", type: "text", content: "<p>halo</p>" }],
};
assert.equal(indexedH1Count(blank), 0);
assert.equal(evaluateLandingQuality({ page: blank }).checks.find((check) => check.id === "h1")?.pass, false);

const noExplore = page();
noExplore.sections = (noExplore.sections as Array<Record<string, unknown>>).map((section) =>
  section.type === "text"
    ? { ...section, content: `<p>${filler(520, "kata")}</p><p><a href="/rooms/deluxe">kamar</a> <a href="/book">pesan</a></p>` }
    : section.type === "related_explore"
      ? { ...section, slugs: [] }
      : section,
);
const links = evaluateLandingQuality({ page: noExplore, landmarks: [verified], rooms });
assert.equal(links.checks.find((check) => check.id === "links")?.pass, false);

const openDistance = page();
openDistance.sections = (openDistance.sections as Array<Record<string, unknown>>).map((section) =>
  section.type === "location" ? { ...section, landmark_ids: ["lm-open"] } : section,
);
const distances = evaluateLandingQuality({
  page: openDistance,
  landmarks: [verified, unverified],
  rooms,
});
assert.equal(distances.checks.find((check) => check.id === "distances")?.pass, false);

const copyDistance = page();
copyDistance.sections = (copyDistance.sections as Array<Record<string, unknown>>).map((section) =>
  section.type === "text"
    ? {
        ...section,
        content: `<p>${filler(500, "kata")} Goa Kreo 6 km dari sini.</p><p><a href="/rooms/deluxe">kamar</a> <a href="/book">pesan</a> <a href="/explore/lawang-sewu-semarang">jelajah</a></p>`,
      }
    : section,
);
const distanceCopy = evaluateLandingQuality({
  page: copyDistance,
  landmarks: [verified, unverified],
  rooms,
});
assert.equal(distanceCopy.checks.find((check) => check.id === "distances")?.pass, false);

const missingAlt = page();
missingAlt.sections = (missingAlt.sections as Array<Record<string, unknown>>).map((section) =>
  section.type === "text"
    ? { ...section, content: `${section.content}<img src="/a.jpg">` }
    : section,
);
const images = evaluateLandingQuality({ page: missingAlt, landmarks: [verified], rooms });
assert.equal(images.checks.find((check) => check.id === "images")?.pass, false);

assert.equal(isIndexableSitemapPath("/dekat-akpol-semarang"), false);
assert.equal(isIndexableSitemapPath("/lp/dekat-akpol-semarang"), false);
assert.equal(isIndexableSitemapPath("/guesthouse-dekat-unnes"), false);
assert.equal(isIndexableSitemapPath("/hotel-rombongan-semarang"), false);
assert.equal(isIndexableSitemapPath("/faq/check-in"), false);

console.log("lp quality gates ok");
