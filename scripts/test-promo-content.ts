// Tes konten promo: tanpa angka harga, lima promo, S&K, dan /promo di sitemap.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PROMOS, PROMO_TERMS_NOTE, promoWhatsAppHref } from "../src/public/content/promos";
import { collectSitemapPaths } from "../src/public/lib/public-seo";

const source = readFileSync("src/public/content/promos.ts", "utf8");
assert.ok(!/Rp/i.test(source), "tanpa Rp");
assert.ok(!source.includes("%"), "tanpa persen");
// Nama kamar resmi boleh memuat angka; selain itu tidak boleh ada angka nominal.
const withoutRoomNames = source.replace(/Family Room 222|Family Suite 100/g, "");
assert.ok(!/\d/.test(withoutRoomNames), "tanpa angka nominal");
for (const promo of PROMOS) {
  assert.ok(!/\d/.test(`${promo.title} ${promo.description}`.replace(/Family Room 222|Family Suite 100/g, "")));
}

assert.equal(PROMOS.length, 5);
assert.equal(new Set(PROMOS.map((p) => p.id)).size, 5);
assert.equal(PROMO_TERMS_NOTE, "Syarat & ketentuan berlaku, harga final mengikuti sistem.");
for (const file of ["src/public/components/promo-section.tsx", "src/routes/promo.tsx"]) {
  assert.ok(readFileSync(file, "utf8").includes("PROMO_TERMS_NOTE"), `${file} menampilkan catatan S&K`);
}

assert.ok(collectSitemapPaths({}).includes("/promo"), "sitemap memuat /promo");

assert.equal(promoWhatsAppHref("", PROMOS[0]), null, "nomor kosong → tombol disembunyikan");
const href = promoWhatsAppHref("+62 851-9098-6169", PROMOS[0]) ?? "";
assert.ok(href.startsWith("https://wa.me/6285190986169?text="));
assert.ok(decodeURIComponent(href).includes(PROMOS[0].title));

console.log("test-promo-content: ok");
