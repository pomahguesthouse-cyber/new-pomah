/**
 * Harga kamar publik hanya dari DB (today_rate ?? base_rate); tidak ada literal harga di kode.
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
  fillRoomPrices,
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

// Harga fixture (bukan harga DB): copy harus memakai angka yang diberikan.
const FIXTURE_RATES: Record<string, number> = {
  "kamar-single": 123000,
  deluxe: 234000,
  "grand-deluxe": 345000,
  "family-room-222": 456000,
  "family-suite-100": 567000,
};
const ROOM_PRICE_LITERAL_RE = /Rp\s?(?:150|175|230|300|450|500)[.,]000|\b(?:150|175|230|300|450|500)000\b/;

// 1) Tidak ada literal harga kamar di approved-seo.ts / konten publik / SEO admin.
assert.equal(formatRupiah(150000), "Rp150.000");
assert.equal(formatRupiah(1500000), "Rp1.500.000");
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(n) ? [p] : [];
  });
}
const publicFiles = [
  ...walk("src/public"),
  ...walk("src/routes").filter((f) => !f.includes("/admin") && !f.endsWith("routeTree.gen.ts") && !/api[.]/.test(f)),
  "src/admin/modules/seo/seo.functions.ts",
];
for (const file of publicFiles) {
  assert.doesNotMatch(readFileSync(file, "utf8"), ROOM_PRICE_LITERAL_RE, `literal harga kamar di ${file}`);
}
const approvedSource = readFileSync("src/public/content/approved-seo.ts", "utf8");
assert.doesNotMatch(approvedSource, /ROOM_FROM_RATES/);
assert.doesNotMatch(approvedSource, /mulai Rp\d/i);

// 2) Homepage/LP copy tanpa harga statis.
assert.doesNotMatch(APPROVED_HOME.meta, /Rp/);
assert.doesNotMatch(APPROVED_HOME.title, /Rp/);
assert.doesNotMatch(APPROVED_HOME.h1, /Rp/);
assert.doesNotMatch(APPROVED_HOME.intro, /Rp/);
assert.doesNotMatch(APPROVED_LP.meta, /Rp\d|mulai Rp/i);
assert.doesNotMatch(APPROVED_LP.title, /Rp\d/);
assert.doesNotMatch(APPROVED_LP.h1, /Rp\d/);
assert.doesNotMatch(APPROVED_LP.intro, /Rp\d/);

// 3) Copy approved memakai angka yang diberikan; tanpa harga -> frasa harga hilang rapi.
const lookup = (slug: string) => FIXTURE_RATES[slug];
for (const [slug, seo] of Object.entries(APPROVED_ROOMS)) {
  for (const text of [seo.title, seo.meta]) {
    const filled = fillRoomPrices(text, lookup);
    for (const m of filled.matchAll(/Rp\d{1,3}(?:\.\d{3})+/g)) assert.equal(m[0], formatRupiah(FIXTURE_RATES[slug]!), `${slug}: ${filled}`);
    const stripped = fillRoomPrices(text, () => null);
    assert.doesNotMatch(stripped, /Rp|\{harga|[Mm]ulai\s*[.|/]|\s[.,]|\.\./, `${slug}: ${stripped}`);
  }
}
const lpFaq = APPROVED_LP.faq.find((f) => /termurah/i.test(f.question));
assert.equal(fillRoomPrices(lpFaq!.answer, lookup), "Kamar termurah adalah Kamar Single, mulai Rp123.000 per malam.");
assert.equal(fillRoomPrices(lpFaq!.answer, () => null), "Kamar termurah adalah Kamar Single.");
assert.equal(
  fillRoomPrices(APPROVED_ROOMS["kamar-single"]!.title, () => undefined),
  "Kamar Single Semarang | Pomah Guesthouse",
);
assert.match(
  fillRoomPrices(APPROVED_ROOMS["kamar-single"]!.meta, () => null),
  /dapur bersama\.$/,
);
assert.match(fillRoomPrices(APPROVED_ROOMS.deluxe!.meta, () => null), /untuk dua orang\.$/);

// 4) Runtime: copy tersimpan dengan harga lama mengikuti harga live; tanpa harga -> dihapus.
const single = {
  name: "Single",
  slug: "kamar-single",
  base_rate: "123000.00",
  capacity: 1,
  seo_title: "Kamar Single Semarang Mulai Rp175.000 | Pomah Guesthouse",
  meta_description: "Kamar Single 15 m² ... dapur bersama. Mulai Rp175.000.",
};
const seo = resolveRoomPublicSeo(single);
assert.equal(seo.title, "Kamar Single Semarang Mulai Rp123.000 | Pomah Guesthouse");
assert.match(seo.description, /Mulai Rp123\.000\.$/);
const approvedOnly = resolveRoomPublicSeo({ name: "Single", slug: "kamar-single", base_rate: 99000, today_rate: 88000 } as never);
assert.equal(approvedOnly.title, "Kamar Single Semarang Mulai Rp88.000 | Pomah Guesthouse");
const noRate = resolveRoomPublicSeo({ name: "Single", slug: "kamar-single", base_rate: null } as never);
assert.equal(noRate.title, "Kamar Single Semarang | Pomah Guesthouse");
assert.doesNotMatch(noRate.description, /Rp|\{harga/);
const graph = JSON.stringify(roomPageGraph({ ...single, base_rate: 123000 } as never));
const offer = graph.match(/"price":"?(\d+)/);
assert.equal(Number(offer?.[1]), 123000);
assert.ok(seo.title.includes(formatRupiah(Number(offer?.[1]))));
assert.equal(syncFromPrice("Tanpa harga.", 123000), "Tanpa harga.");
assert.equal(syncFromPrice("mulai Rp1.234.000/malam", 456000), "mulai Rp456.000/malam");
assert.equal(syncFromPrice("Kamar lega, mulai Rp175.000.", null), "Kamar lega.");

// Homepage stored meta (DB homepage_config) that still carries "mulai RpX" is legacy:
// replaced in full by the approved price-free meta, not just re-synced.
const stored = "Guesthouse keluarga di Sampangan, Semarang. Kamar bersih mulai Rp175.000, family room 2 kamar tidur.";
const rooms = Object.values(FIXTURE_RATES).map((base_rate) => ({ base_rate }));
assert.equal(minRoomBaseRate(rooms), 123000);
assert.equal(resolveHomepageMeta(stored, minRoomBaseRate(rooms)), APPROVED_HOME.meta);
assert.doesNotMatch(resolveHomepageMeta(stored, minRoomBaseRate(rooms)), /Rp/);
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
