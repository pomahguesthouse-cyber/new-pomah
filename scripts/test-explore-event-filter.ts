/**
 * Public /explore must hide past dated City Guide events (WIB) while
 * keeping recurring labels like "Tiap Hari".
 */
import assert from "node:assert/strict";

import {
  filterPublicExploreEvents,
  isPublicExploreEventVisible,
  isRecurringExploreDate,
  parseExploreEventEndIso,
  stripPastEventsFromExploreConfig,
} from "../src/lib/explore-event-date";

const today = "2026-09-08";

assert.equal(isRecurringExploreDate("Tiap Hari"), true);
assert.equal(isRecurringExploreDate("Setiap Akhir Pekan (Jumat-Minggu Malam)"), true);
assert.equal(isRecurringExploreDate("31/05/2026"), false);

assert.equal(parseExploreEventEndIso("31/05/2026"), "2026-05-31");
assert.equal(parseExploreEventEndIso("29/05/2026"), "2026-05-29");
assert.equal(parseExploreEventEndIso("15 Agustus 2026"), "2026-08-15");
assert.equal(parseExploreEventEndIso("10-12 September 2026"), "2026-09-12");
assert.equal(parseExploreEventEndIso("29–31 Mei 2026"), "2026-05-31");
assert.equal(parseExploreEventEndIso("Sepanjang Oktober 2026"), "2026-10-31");
assert.equal(parseExploreEventEndIso("Tiap Hari"), null);

assert.equal(isPublicExploreEventVisible("31/05/2026", today), false);
assert.equal(isPublicExploreEventVisible("29/05/2026", today), false);
assert.equal(isPublicExploreEventVisible("15 Agustus 2026", today), false);
assert.equal(isPublicExploreEventVisible("10-12 September 2026", today), true);
assert.equal(isPublicExploreEventVisible("Tiap Hari", today), true);
assert.equal(
  isPublicExploreEventVisible("Setiap Akhir Pekan (Jumat-Minggu Malam)", today),
  true,
);
assert.equal(isPublicExploreEventVisible("08/09/2026", today), true, "today is still visible");
assert.equal(isPublicExploreEventVisible("Tanggal menyusul", today), true);

const liveEvents = [
  {
    title: "Kirab Api Dharma Waisak ke Candi Borobudur",
    date: "31/05/2026",
  },
  {
    title: "Prosesi Pengambilan Api Dharma Waisak di Api Abadi Mrapen",
    date: "29/05/2026",
  },
  {
    title: "Eksplorasi Sejarah Kota Lama Semarang",
    date: "Tiap Hari",
  },
  {
    title: "Wisata Kuliner Malam Pasar Semawis",
    date: "Setiap Akhir Pekan (Jumat-Minggu Malam)",
  },
];

const kept = filterPublicExploreEvents(liveEvents, today);
assert.deepEqual(
  kept.map((e) => e.title),
  ["Eksplorasi Sejarah Kota Lama Semarang", "Wisata Kuliner Malam Pasar Semawis"],
);

const stripped = stripPastEventsFromExploreConfig(
  { events: liveEvents, news: [{ title: "keep-news", date: "10 Mei 2026" }] },
  today,
);
assert.equal(stripped.events.length, 2);
assert.equal(stripped.news.length, 1);
assert.ok(!JSON.stringify(stripped.events).includes("Kirab Api Dharma Waisak"));
assert.ok(!JSON.stringify(stripped.events).includes("Api Abadi Mrapen"));

console.log("test-explore-event-filter: ok");
