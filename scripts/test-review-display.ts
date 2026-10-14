/** Ulasan tamu di situs publik: sumber, tanggal, badge, angka Google live. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  formatReviewDate,
  googleAggregate,
  liveReviewCountDesc,
  normalizeReviewSource,
  parseSourceBadges,
  parseStoredReviews,
  reviewSourceLabel,
} from "../src/public/lib/review-display";
import { homepageLodgingGraph } from "../src/public/lib/structured-data";

assert.equal(normalizeReviewSource(undefined), "google", "data lama = Google");
assert.equal(normalizeReviewSource("Booking.com"), "booking");
assert.equal(normalizeReviewSource("trip.com"), "tripcom");
assert.equal(reviewSourceLabel("tripcom"), "Trip.com");

const reviews = parseStoredReviews([
  { author: "Irza A.", text: "Bersih sekali.", rating: 5, source: "google", date: "2025-11-02" },
  { author: "Rizal H.", text: "Dekat kampus.", rating: 5, source: "booking", date: "2024-08" },
  { author: "Lama", text: "Tanpa sumber" },
  { author: "Kosong", text: "  " },
  { author: "X", text: "y", date: "kemarin" },
]);
assert.equal(reviews.length, 4);
assert.equal(reviews[1].source, "booking");
assert.equal(reviews[2].source, "google");
assert.equal(reviews[3].date, null);
assert.deepEqual(parseStoredReviews("bukan json"), []);

const badges = parseSourceBadges([
  { source: "booking", score: 10, scale: 10, count: 2, url: "https://www.booking.com/x" },
  { source: "tripcom", score: 10, scale: 10, count: 3, url: "javascript:alert(1)" },
  { source: "google", score: 4.8, scale: 5, count: 78 },
  { source: "booking", score: 0, count: 2 },
]);
assert.equal(badges.length, 2);
assert.equal(badges[1].url, null, "hanya https");

assert.equal(formatReviewDate("2026-10-14"), "14 Okt 2026");
assert.equal(formatReviewDate("2026-10-14T00:00:00+00:00"), "14 Okt 2026");
assert.equal(formatReviewDate("2025-12"), "Des 2025");
assert.equal(formatReviewDate(null), null);

assert.deepEqual(googleAggregate(4.8, 78), { rating: 4.8, total: 78 });
assert.equal(googleAggregate(null, 78), null);
assert.equal(googleAggregate(9.8, 12), null, "skala 10 bukan Google");

assert.equal(liveReviewCountDesc("76 ulasan", 78), "78 ulasan");
assert.equal(liveReviewCountDesc("{jumlah} ulasan", 78), "78 ulasan");
assert.equal(liveReviewCountDesc("76 ulasan", null), "Ulasan tamu");
assert.equal(liveReviewCountDesc("Nyaman & terawat", 78), "Nyaman & terawat");

// JSON-LD: aggregateRating hanya dari angka Google; tanpa angka → tidak ada.
const withRating = JSON.stringify(homepageLodgingGraph({ rooms: [], reviews: { rating: 4.8, total: 78 } } as never));
assert.ok(withRating.includes('"reviewCount":78'));
assert.ok(!withRating.includes('"@type":"Review"'), "tanpa ulasan pihak ketiga");
const noRating = JSON.stringify(homepageLodgingGraph({ rooms: [], reviews: null } as never));
assert.ok(!noRating.includes("aggregateRating"));

const home = readFileSync("src/routes/index.tsx", "utf8");
assert.ok(!/76 ulasan/.test(home), "tidak ada angka ulasan hardcoded");
assert.ok(!/\?\? 76\b|\?\? 4\.8\b/.test(home), "tidak ada fallback rating palsu");
assert.ok(!/REVIEWS\.map/.test(home), "fallback ulasan statis dihapus");

console.log("test-review-display: OK");
