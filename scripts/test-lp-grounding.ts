/**
 * Grounding prompt and draft assembly never invent facilities, prices, or distances.
 */
import assert from "node:assert/strict";
import {
  assembleLandingDraft,
  buildGroundingPrompt,
  stripUngroundedText,
  type GroundingFacts,
} from "../src/public/lib/lp-grounding";

const facts: GroundingFacts = {
  propertyName: "Pomah Guesthouse",
  address: "Jl. Dewi Sartika IV No. 71, Semarang",
  lat: -7.0209,
  lng: 110.3881,
  whatsappDigits: "628123456789",
  checkIn: "14.00",
  checkOut: "12.00",
  rooms: [
    {
      id: "room-1",
      name: "Family",
      slug: "family",
      capacity: 4,
      baseRate: 350000,
      amenities: ["WiFi", "Parkir"],
    },
  ],
  landmarks: [
    {
      id: "ok",
      name: "UNNES Sekaran",
      roadDistanceKm: 4.7,
      travelMinutes: 11,
      verified: true,
    },
    {
      id: "no",
      name: "Lawang Sewu",
      roadDistanceKm: 9.9,
      travelMinutes: 40,
      verified: false,
    },
  ],
  explore: [{ slug: "lawang-sewu-semarang", title: "Lawang Sewu" }],
  propertyFaqs: [
    { question: "Di mana lokasi Pomah?", answer: "Di Sampangan, Semarang." },
    { question: "Jam check-in?", answer: "Mulai pukul 14.00." },
  ],
  brief: {
    primaryKeyword: "penginapan dekat rsup kariadi",
    secondaryKeywords: ["keluarga pasien"],
    intent: "menginap",
    slug: "penginapan-dekat-rsup-kariadi",
    targetAudience: "keluarga pasien",
    uniqueAngle: "dekat rumah sakit",
    faqSeeds: ["Apakah ada parkir?", "Bisa pesan untuk keluarga?"],
    reviewKeywords: ["keluarga"],
    exploreSlugs: ["lawang-sewu-semarang"],
    landmarkIds: ["ok"],
    roomTypeIds: ["room-1"],
    minCapacity: 2,
  },
};

const prompt = buildGroundingPrompt(facts);
assert.match(prompt.system, /air panas/i);
assert.match(prompt.system, /Jangan mengarang/);
assert.match(prompt.user, /4\.7/);
assert.match(prompt.user, /350000/);
assert.match(prompt.user, /Lawang Sewu/);
assert.equal(prompt.user.includes("9.9"), false);
assert.match(prompt.user, /landmarkNamesWithoutDistance/);

const stripped = stripUngroundedText(
  "Kamar punya air panas. WiFi tersedia. Tarif Rp999.000 per malam. Lawang Sewu 9.9 km dari sini.",
  facts,
);
assert.equal(/air panas/i.test(stripped), false);
assert.equal(/999/.test(stripped), false);
assert.equal(/9\.9/.test(stripped), false);
assert.match(stripped, /WiFi/);

const draft = assembleLandingDraft(facts, {
  meta_title: "judul terlalu panjang ".repeat(8),
  meta_description: "deskripsi ".repeat(40),
  sections: [
    { type: "hero", headline: "Tanpa keyword" },
    { type: "text", content: "<p>Ada air panas dan Rp999.000.</p><h1>Judul</h1>" },
    { type: "faq", items: [{ question: "Apakah ada parkir?", answer: "Parkir tersedia." }] },
  ],
});

assert.ok(draft.metaTitle.length <= 60);
assert.ok(draft.metaDescription.length <= 160);
const hero = draft.sections.find((section) => section.type === "hero");
assert.equal(hero?.type === "hero" && hero.headline.toLowerCase().includes(facts.brief.primaryKeyword), true);
const text = draft.sections.find((section) => section.type === "text");
assert.equal(text?.type === "text" && /<h1\b/i.test(text.content), false);
assert.equal(text?.type === "text" && /air panas/i.test(text.content), false);
const faq = draft.sections.find((section) => section.type === "faq");
assert.ok(faq?.type === "faq" && faq.items.length >= 4);
for (const type of ["location", "filtered_rooms", "starting_price", "datepicker", "filtered_reviews", "related_explore", "cta_banner", "button"] as const) {
  assert.ok(draft.sections.some((section) => section.type === type), type);
}
const book = draft.sections.find((section) => section.type === "cta_banner");
assert.equal(book?.type === "cta_banner" && book.cta_url, "/book");
const wa = draft.sections.find((section) => section.type === "button");
assert.equal(wa?.type === "button" && wa.url.startsWith("https://wa.me/"), true);

console.log("lp grounding ok");
