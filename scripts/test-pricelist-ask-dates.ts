/** Regresi "lihat pricelist" (Okt–Nov 2026): bot harus tanya tanggal, bukan kirim brosur / diam. */
import assert from "node:assert/strict";
import { buildPricelistAskDatesReply, isPricelistAsk, PRICELIST_ASK_DATES_REPLY } from "../src/services/wa-autoreply/pricelist-ask";
import { planMediaFastPath } from "../src/services/wa-autoreply/media-fast-path";
import { GUEST_BROCHURE_WORD_RE, GUEST_MEDIA_WORD_RE } from "../src/lib/guest-media-request";

const asks = [
  "Pagi kak, boleh liat pricelist kamarnya lagi",
  "halo ka permisi, mau tanya terkait pricelist kamarnya boleh ka?",
  "malam kak , boleh minta price list?",
  "Untuk daftar harganya ada ga ya kak",
  "Untuk pricelistnya kak?",
  "price list nya kak",
  "minta harga kamar kak",
  "lihat pricelist",
];
for (const m of asks) {
  assert.ok(isPricelistAsk(m), `pricelist: ${m}`);
  assert.equal(buildPricelistAskDatesReply({ message: m, hasKnownDates: false, mentionsDate: false }), PRICELIST_ASK_DATES_REPLY, m);
  assert.equal(buildPricelistAskDatesReply({ message: m, hasKnownDates: true, mentionsDate: false }), null, `known dates: ${m}`);
  assert.equal(buildPricelistAskDatesReply({ message: m, hasKnownDates: false, mentionsDate: true }), null, `date in msg: ${m}`);
  assert.ok(!GUEST_BROCHURE_WORD_RE.test(m.toLowerCase()), `not brochure: ${m}`);
  assert.ok(!GUEST_MEDIA_WORD_RE.test(m.toLowerCase()), `not media: ${m}`);
  assert.equal(planMediaFastPath([{ direction: "in", body: m } as any], []), null, `no media plan: ${m}`);
}
assert.match(PRICELIST_ASK_DATES_REPLY, /Kak/);
assert.match(PRICELIST_ASK_DATES_REPLY, /tanggal/);
// Brosur tetap brosur
for (const m of ["minta brosurnya kak", "pricelist beserta gambar kamarnya", "kirim katalog dong"]) {
  assert.ok(!isPricelistAsk(m), `media stays media: ${m}`);
}
assert.ok(GUEST_BROCHURE_WORD_RE.test("minta brosurnya kak"));
assert.ok(!isPricelistAsk("halo kak"));
console.log("pricelist-ask-dates: OK");
