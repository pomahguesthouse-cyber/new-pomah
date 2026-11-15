/**
 * Revisi SEO /lp/penginapan-dekat-unnes, disetujui 15 Nov 2026.
 * Title/meta/H1/intro/FAQ dari kode (APPROVED_LP), bukan dari DB.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  APPROVED_LP,
  CITY_GUIDE_ARTICLES,
  UNNES_HOME_ANCHOR,
  UNNES_LP_PATH,
  UNNES_ROOM_ANCHOR,
  UNNES_ROOM_LINK_SLUGS,
  UNNES_WISUDA_GUIDE_SENTENCE,
  cityGuideArticleForSlug,
} from "../src/public/content/approved-seo";
import { buildGuideTextLinks } from "../src/public/components/guide-links";
import { faqPageGraph } from "../src/public/lib/structured-data";

const TITLE = "Homestay & Penginapan Dekat UNNES Semarang | Pomah";
const META =
  "Penginapan keluarga di Sampangan, sekitar 4,5 km dari UNNES Sekaran (±10–15 menit). Cocok untuk wisuda & tes masuk. Cek kamar dan pesan via WhatsApp.";
const H1 = "Homestay & Penginapan Dekat UNNES untuk Orang Tua dan Wisudawan";
const INTRO =
  "Pomah Guesthouse adalah penginapan keluarga di Sampangan, Semarang, sekitar 4,5 km atau kurang lebih 10–15 menit berkendara dari kampus UNNES Sekaran. Banyak orang tua memilih menginap di sini saat wisuda, tes masuk, atau mengantar putra-putrinya kuliah.";
const FAQ_Q = "Apakah Pomah termasuk hotel dekat UNNES?";
const FAQ_A =
  "Pomah adalah guesthouse keluarga di Sampangan, sekitar 4,5 km dari UNNES Sekaran (±10–15 menit berkendara). Pilihan kamarnya mulai dari Single sampai Family Room dengan 2 kamar tidur untuk maksimal 4 tamu.";

assert.equal(APPROVED_LP.slug, "penginapan-dekat-unnes");
assert.equal(APPROVED_LP.title, TITLE);
assert.equal(APPROVED_LP.meta, META);
assert.equal(APPROVED_LP.h1, H1);
assert.equal(APPROVED_LP.intro, INTRO);
assert.doesNotMatch(APPROVED_LP.meta, /Rp\s?\d|mulai Rp150/i);
assert.doesNotMatch(APPROVED_LP.title + APPROVED_LP.h1 + APPROVED_LP.intro, /Rp\s?\d/);

const hotelFaq = APPROVED_LP.faq.find((item) => item.question === FAQ_Q);
assert.ok(hotelFaq, "FAQ hotel dekat UNNES harus ada");
assert.equal(hotelFaq!.answer, FAQ_A);

const graph = JSON.stringify(faqPageGraph("https://pomahguesthouse.com/lp/penginapan-dekat-unnes", APPROVED_LP.faq));
assert.match(graph, /FAQPage/);
assert.match(graph, /Apakah Pomah termasuk hotel dekat UNNES\?/);
assert.match(graph, /guesthouse keluarga di Sampangan/);

const homeLinks = buildGuideTextLinks([], 8);
assert.ok(
  homeLinks.some((link) => link.href === UNNES_LP_PATH && link.label === UNNES_HOME_ANCHOR),
  "Beranda harus menaut ke landing UNNES dengan anchor yang disetujui",
);

assert.deepEqual([...UNNES_ROOM_LINK_SLUGS], ["deluxe", "family-room-222"]);
const roomsSrc = readFileSync(new URL("../src/routes/rooms.$slug.tsx", import.meta.url), "utf8");
assert.match(roomsSrc, /UNNES_ROOM_LINK_SLUGS/);
assert.match(roomsSrc, /UNNES_ROOM_ANCHOR/);
assert.match(roomsSrc, /UNNES_LP_PATH/);
assert.equal(UNNES_ROOM_ANCHOR, "menginap dekat UNNES Sekaran");

for (const slug of ["lawang-sewu-semarang", "nasi-ayam-bu-wido"] as const) {
  const article = cityGuideArticleForSlug(slug);
  assert.ok(article, slug);
  const body = article!.sections.flatMap((section) => section.paragraphs).join("\n");
  assert.match(body, /Datang untuk wisuda UNNES\? Lihat \[penginapan dekat UNNES\]\(\/lp\/penginapan-dekat-unnes\)\./);
  assert.ok(body.includes(UNNES_WISUDA_GUIDE_SENTENCE.split("Lihat ")[0]));
}

const articles = CITY_GUIDE_ARTICLES.filter((article) =>
  ["lawang-sewu-semarang", "nasi-ayam-bu-wido"].includes(article.canonicalSlug),
);
assert.equal(articles.length, 2);

const guideSrc = readFileSync(new URL("../src/public/components/city-guide-article.tsx", import.meta.url), "utf8");
assert.match(guideSrc, /href=\{link\[2\]\}/);

console.log("test-unnes-lp-wisuda-seo: ok");
