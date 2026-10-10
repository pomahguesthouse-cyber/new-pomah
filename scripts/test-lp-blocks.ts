/**
 * Server markup for the new landing blocks.
 */
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { AreaNeedsSection } from "../src/public/components/area-needs";
import {
  FilteredReviewsBlock,
  FilteredRoomsBlock,
  LocationBlock,
  RelatedExploreBlock,
  StartingPriceBlock,
} from "../src/public/components/lp-dynamic-blocks";
import { filterReviews, matchLandingForExplore, startingRate } from "../src/public/lib/lp-dynamic";

const landmarks = [
  {
    id: "ok",
    name: "RSUP Kariadi",
    category: "rumah sakit",
    lat: -6.99,
    lng: 110.4,
    road_distance_km: 5,
    travel_minutes: 12,
    verified: true,
  },
  {
    id: "no",
    name: "Goa Kreo",
    category: "wisata",
    lat: -7.03,
    lng: 110.34,
    road_distance_km: 6.5,
    travel_minutes: 16,
    verified: false,
  },
];

const verifiedHtml = renderToStaticMarkup(
  createElement(LocationBlock, { title: "Jarak", landmarkIds: ["ok", "no"], landmarks }),
);
assert.match(verifiedHtml, /5 km/);
assert.match(verifiedHtml, /12 menit/);
assert.equal(verifiedHtml.includes("Goa Kreo"), false);
assert.match(verifiedHtml, /loading="lazy"/);

const previewHtml = renderToStaticMarkup(
  createElement(LocationBlock, {
    title: "Jarak",
    landmarkIds: ["no"],
    landmarks,
    showUnverified: true,
  }),
);
assert.match(previewHtml, /Goa Kreo/);
assert.match(previewHtml, /belum diverifikasi/i);
assert.equal(previewHtml.includes("6.5 km"), false);

const rooms = [
  { id: "a", name: "Deluxe", slug: "deluxe", capacity: 2, base_rate: 250000 },
  { id: "b", name: "Family", slug: "family", capacity: 4, base_rate: 175000 },
];
const roomsHtml = renderToStaticMarkup(
  createElement(FilteredRoomsBlock, { title: "Kamar", rooms, roomTypeIds: ["b"], minCapacity: 3 }),
);
assert.match(roomsHtml, /\/rooms\/family/);
assert.match(roomsHtml, /175/);
assert.equal(roomsHtml.includes("/rooms/deluxe"), false);

const priceHtml = renderToStaticMarkup(createElement(StartingPriceBlock, { title: "Mulai dari", rooms }));
assert.equal(startingRate(rooms), 175000);
assert.match(priceHtml, /175/);
assert.match(priceHtml, /Mulai dari/);

const reviews = [
  { author: "A", text: "Nyaman untuk wisuda", rating: 5 },
  { author: "B", text: "Kamar bersih", rating: 5 },
  { author: "C", text: "Pelayanan ramah", rating: 4 },
];
const reviewHtml = renderToStaticMarkup(
  createElement(FilteredReviewsBlock, { title: "Ulasan", reviews, keywords: ["wisuda"], limit: 2 }),
);
assert.match(reviewHtml, /wisuda/);
assert.equal(reviewHtml.includes("Kamar bersih"), false);
const fallback = filterReviews(reviews, ["tidak-ada"], 2);
assert.equal(fallback[0]?.author, "A");
assert.equal(fallback.length, 2);

const exploreHtml = renderToStaticMarkup(
  createElement(RelatedExploreBlock, {
    title: "Baca juga",
    places: [{ slug: "lawang-sewu-semarang", name: "Lawang Sewu", category: "destinasi" }],
    slugs: ["lawang-sewu-semarang"],
  }),
);
assert.match(exploreHtml, /\/explore\/lawang-sewu-semarang/);

assert.equal(AreaNeedsSection({ pages: [] }), null);
assert.deepEqual(
  matchLandingForExplore("lawang-sewu-semarang", [
    { slug: "dekat-lawang", title: "Dekat Lawang Sewu", exploreSlugs: ["lawang-sewu-semarang"] },
  ]),
  { slug: "dekat-lawang", title: "Dekat Lawang Sewu" },
);

console.log("lp blocks ok");
