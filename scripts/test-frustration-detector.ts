/**
 * Regresi detector frustrasi/trust — Puteri Indah 15 Nov 2026:
 * "Halo ka, mau tanya apa ini benar dengan guest house?" harus diverifikasi
 * sebagai nomor resmi, bukan di-handoff dengan "prosesnya jadi membingungkan".
 */
import assert from "node:assert/strict";
import {
  detectFrustration,
  buildFrustrationReply,
  scoreFrustration,
  shouldSkipForHumanHandoff,
} from "../src/services/frustration-detector";

const CONFUSED_APOLOGY = /prosesnya jadi membingungkan/;

// Puteri Indah 15 Nov 2026 — sapaan verifikasi nomor, bukan frustrasi.
const puteri = "Halo ka, mau tanya apa ini benar dengan guest house?";
assert.equal(detectFrustration(puteri), "trust_question", puteri);
{
  const r = buildFrustrationReply("trust_question", {});
  assert.equal(r.shouldHandoff, false);
  assert.match(r.reply, /WhatsApp resmi Pomah Guesthouse/);
  assert.doesNotMatch(r.reply, CONFUSED_APOLOGY);
  assert.match(r.reply, /pomahguesthouse\.com/);
  assert.match(r.reply, /admin/i);
}

for (const t of [
  "ini benar?",
  "Ini benar dengan guest house?",
  "apa ini benar nomor pomah?",
  "beneran guesthouse?",
  "nomor ini benar kan",
  "ini wa asli pomah?",
  "benar gak ini hotel?",
  "ini penipuan?",
  "apakah ini AI?",
  "amankah booking di sini?",
]) {
  assert.equal(detectFrustration(t), "trust_question", t);
  const r = buildFrustrationReply("trust_question", {});
  assert.equal(r.shouldHandoff, false, t);
  assert.doesNotMatch(r.reply, CONFUSED_APOLOGY);
}

// Frustrasi sungguhan tetap handoff.
for (const t of [
  "saya pusing",
  "pusing deh kak",
  "saya gak ngerti",
  "saya tidak paham",
  "saya bingung",
  "ribet banget",
  "capek deh",
]) {
  assert.equal(detectFrustration(t), "frustrated", t);
  const r = buildFrustrationReply("frustrated", {});
  assert.equal(r.shouldHandoff, true, t);
  assert.match(r.reply, CONFUSED_APOLOGY);
}

// Campuran: kata frustrasi tetap menang (dicek lebih dulu).
assert.equal(detectFrustration("saya bingung, ini benar dengan guest house?"), "frustrated");

// Bukan trust dan bukan frustrasi.
for (const t of [
  "Halo kak",
  "Ada kamar tanggal 20?",
  "Harga deluxe berapa?",
  "Mau booking 2 malam",
]) {
  assert.equal(detectFrustration(t), null, t);
}

assert.ok(scoreFrustration("saya pusing ini penipuan!!!") > scoreFrustration("ini benar?"));

// Guard: flag usang setelah staf mengembalikan ke AI tidak boleh mematikan bot.
assert.equal(shouldSkipForHumanHandoff({ handoffFlag: false }), false);
assert.equal(shouldSkipForHumanHandoff({ handoffFlag: true, hasOpenTicket: true }), true);
assert.equal(
  shouldSkipForHumanHandoff({
    handoffFlag: true,
    hasOpenTicket: false,
    aiPausedUntil: "2026-11-15T10:00:00+07:00",
    now: new Date("2026-11-15T09:00:00+07:00"),
  }),
  true,
);
assert.equal(
  shouldSkipForHumanHandoff({
    handoffFlag: true,
    hasOpenTicket: false,
    aiPausedUntil: null,
    now: new Date("2026-11-15T10:22:00+07:00"),
  }),
  false,
  "tiket sudah resolved + tanpa jeda: bot harus menjawab lagi",
);
assert.equal(
  shouldSkipForHumanHandoff({
    handoffFlag: true,
    hasOpenTicket: false,
    aiPausedUntil: "2026-11-15T09:00:00+07:00",
    now: new Date("2026-11-15T10:22:00+07:00"),
  }),
  false,
  "jeda sudah lewat: bot harus menjawab lagi",
);

console.log("test-frustration-detector: ok");
