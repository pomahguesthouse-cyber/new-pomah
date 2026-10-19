/**
 * SEO P1 (19 Okt 2026): harga publik = room_types.base_rate. Kamar Single Rp150.000.
 * Snapshot DB (SELECT 19 Okt 2026) di DB_BASE_RATES; ubah bersama harga DB.
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  APPROVED_HOME,
  APPROVED_LP,
  APPROVED_ROOMS,
  CITY_GUIDE_ARTICLES,
  CITY_GUIDE_META_OVERRIDES,
  ROOM_FROM_RATES,
  formatRupiah,
} from "../src/public/content/approved-seo";
import {
  collectSitemapPaths,
  isIndexableSitemapPath,
  minRoomBaseRate,
  resolveHomepageMeta,
  resolveRoomPublicSeo,
  syncFromPrice,
} from "../src/public/lib/public-seo";
import { roomPageGraph } from "../src/public/lib/structured-data";
import { clipMeta, cityGuideMetaContent } from "../src/public/lib/city-guide";
import { isNotFoundRender, NOT_FOUND_TITLE } from "../src/public/lib/not-found-head";

const DB_BASE_RATES: Record<string, number> = {
  "kamar-single": 150000,
  deluxe: 230000,
  "grand-deluxe": 300000,
  "family-room-222": 500000,
  "family-suite-100": 500000,
};

// 1) Approved constants == DB snapshot.
assert.deepEqual({ ...ROOM_FROM_RATES }, DB_BASE_RATES);
assert.equal(formatRupiah(150000), "Rp150.000");
assert.equal(formatRupiah(1500000), "Rp1.500.000");

// 2) No stale Rp175.000 anywhere in src.
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(n) ? [p] : [];
  });
}
for (const file of walk("src")) {
  if (file.endsWith("routeTree.gen.ts")) continue;
  assert.doesNotMatch(readFileSync(file, "utf8"), /Rp\s?175[.,]000/, `stale Single price in ${file}`);
}

// 3) Every visible "Rp" price next to a room name in approved copy equals base_rate.
const NAME_TO_SLUG: Array<[RegExp, string]> = [
  [/Kamar Single|\bSingle\b/, "kamar-single"],
  [/Grand Deluxe/, "grand-deluxe"],
  [/Kamar Deluxe|\bDeluxe\b/, "deluxe"],
  [/Family Room 222/, "family-room-222"],
  [/Family Suite 100/, "family-suite-100"],
];
const minRp = formatRupiah(Math.min(...Object.values(DB_BASE_RATES)));
assert.match(APPROVED_HOME.meta, new RegExp(`mulai ${minRp}`));
assert.match(APPROVED_LP.meta, new RegExp(`mulai ${minRp}`));
for (const [slug, seo] of Object.entries(APPROVED_ROOMS)) {
  const rp = formatRupiah(DB_BASE_RATES[slug]!);
  for (const text of [seo.title, seo.meta]) {
    for (const m of text.matchAll(/Rp\d{1,3}(?:\.\d{3})+/g)) assert.equal(m[0], rp, `${slug}: ${text}`);
  }
}
for (const room of APPROVED_LP.rooms) {
  const slug = room.href.replace("/rooms/", "");
  assert.equal(room.price, `${formatRupiah(DB_BASE_RATES[slug]!)}/malam`, room.name);
}
const lpFaq = APPROVED_LP.faq.find((f) => /termurah/i.test(f.question));
assert.match(lpFaq!.answer, /Kamar Single mulai Rp150\.000/);
const articleText = JSON.stringify(CITY_GUIDE_ARTICLES);
for (const m of articleText.matchAll(/\*\*(Kamar Single|Kamar Deluxe|Family Room 222|Family Suite 100|Grand Deluxe)\*\*[^*]*?mulai (Rp\d{1,3}(?:\.\d{3})+)/g)) {
  const slug = NAME_TO_SLUG.find(([re]) => re.test(m[1]!))![1];
  assert.equal(m[2], formatRupiah(DB_BASE_RATES[slug]!), `article price for ${m[1]}`);
}

// 4) Runtime: stored room copy (still Rp175.000 in DB until SQL runs) renders the DB rate,
//    and visible title/meta price == Offer JSON-LD price.
const single = {
  name: "Single",
  slug: "kamar-single",
  base_rate: "150000.00",
  capacity: 1,
  seo_title: "Kamar Single Semarang Mulai Rp175.000 | Pomah Guesthouse",
  meta_description: "Kamar Single 15 m² ... dapur bersama. Mulai Rp175.000.",
};
const seo = resolveRoomPublicSeo(single);
assert.equal(seo.title, "Kamar Single Semarang Mulai Rp150.000 | Pomah Guesthouse");
assert.match(seo.description, /Mulai Rp150\.000\.$/);
const graph = JSON.stringify(roomPageGraph({ ...single, base_rate: 150000 } as never));
const offer = graph.match(/"price":"?(\d+)/);
assert.equal(Number(offer?.[1]), 150000);
assert.ok(seo.title.includes(formatRupiah(Number(offer?.[1]))));
assert.equal(syncFromPrice("Tanpa harga.", 150000), "Tanpa harga.");
assert.equal(syncFromPrice("mulai Rp1.234.000/malam", 500000), "mulai Rp500.000/malam");
assert.equal(syncFromPrice("mulai Rp175.000", null), "mulai Rp175.000");

// Homepage stored meta (DB homepage_config) re-synced to cheapest live rate.
const stored = "Guesthouse keluarga di Sampangan, Semarang. Kamar bersih mulai Rp175.000, family room 2 kamar tidur.";
const rooms = Object.values(DB_BASE_RATES).map((base_rate) => ({ base_rate }));
assert.equal(minRoomBaseRate(rooms), 150000);
assert.match(resolveHomepageMeta(stored, minRoomBaseRate(rooms)), /mulai Rp150\.000,/);
assert.equal(resolveHomepageMeta("Meta kustom Dewi", 150000), "Meta kustom Dewi");

// 5) /rooms index: indexable, in sitemap, breadcrumb "Kamar" points to it.
assert.equal(isIndexableSitemapPath("/rooms"), true);
assert.ok(collectSitemapPaths({ roomSlugs: ["deluxe"] }).includes("/rooms"));
assert.match(graph, /"name":"Kamar","item":"https:\/\/pomahguesthouse\.com\/rooms"/);
assert.doesNotMatch(graph, /#rooms/);

// 6) 404: one title from the root head.
assert.equal(isNotFoundRender([{ status: "success", _notFound: true }]), true);
assert.equal(isNotFoundRender([{ status: "success" }, { status: "notFound" }]), true);
assert.equal(isNotFoundRender([{ status: "success" }]), false);
assert.match(NOT_FOUND_TITLE, /^404/);
const root = readFileSync("src/routes/__root.tsx", "utf8");
assert.doesNotMatch(root, /<title>404/, "NotFoundComponent must not render its own <title>");
assert.doesNotMatch(readFileSync("src/routes/rooms.$slug.tsx", "utf8"), /Kamar Tidak Ditemukan — Pomah/);

// 7) Explore meta overrides 150–160 chars; long descriptions clipped.
assert.equal(Object.keys(CITY_GUIDE_META_OVERRIDES).length >= 6, true);
for (const [slug, meta] of Object.entries(CITY_GUIDE_META_OVERRIDES)) {
  assert.ok(meta.length >= 150 && meta.length <= 160, `${slug}: ${meta.length}`);
}
const long = "Kata ".repeat(80).trim();
const clipped = cityGuideMetaContent({ name: "X", description: long, metaDescription: null } as never);
assert.ok(clipped.length <= 155 && clipped.endsWith("…"), String(clipped.length));
assert.equal(clipMeta("pendek", 155), "pendek");

console.log("test-seo-room-prices: OK");
