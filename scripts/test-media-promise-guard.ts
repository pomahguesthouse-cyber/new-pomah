/**
 * Insiden Azairul …8868, 16 Okt 2026 23:02–23:03: fast path sudah mengirim brosur,
 * lalu balasan AI turn berikutnya menjanjikan "foto kamarnya langsung kami kirimkan ya"
 * + "Sambil menunggu fotonya" → teks dobel. Janji media tanpa kiriman di turn ini dibuang.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  emptyMediaDelivery,
  guardUnverifiedMediaClaims,
  hasUnverifiedMediaClaim,
} from "../src/services/reply-postprocess";
import { decideBrochureRepeat } from "../src/services/wa-autoreply/media-fast-path";

const none = emptyMediaDelivery();
const withBrochure = { ...emptyMediaDelivery(), brochureSent: true };

const azairul =
  "Dengan senang hati Kak 😊 Untuk foto kamarnya langsung kami kirimkan ya 📸\n\n" +
  "Sambil menunggu fotonya, Kak, bisa kami bantu untuk proses pembayaran booking PG-HJ5MF yang tersisa Rp 230.000? " +
  "Pembayaran bisa via transfer ke BCA 0095584379 a.n. Faizal Abdurachman.";

assert.equal(hasUnverifiedMediaClaim(azairul, none), true, "janji foto tanpa kiriman = klaim tak berdasar (memicu rescue/strip)");
const cleaned = guardUnverifiedMediaClaims(azairul, none);
assert.doesNotMatch(cleaned, /foto|📸|menunggu/i);
assert.match(cleaned, /^Bisa kami bantu untuk proses pembayaran booking PG-HJ5MF yang tersisa Rp 230\.000\?/);
assert.match(cleaned, /BCA 0095584379/);

// Other promise phrasings.
for (const t of [
  "Brosurnya segera saya kirim ya Kak.",
  "Nanti kami kirimkan foto kamarnya ya Kak.",
  "Foto Deluxe akan Rani kirimkan sebentar lagi.",
]) {
  assert.equal(hasUnverifiedMediaClaim(t, none), true, t);
}
// Whole reply was only a media promise → neutral fallback, never an empty message.
assert.ok(guardUnverifiedMediaClaims("Fotonya langsung kami kirimkan ya Kak 📸", none).length > 0);
assert.match(guardUnverifiedMediaClaims("Fotonya langsung kami kirimkan ya Kak 📸", withBrochure), /Fotonya langsung kami kirimkan/);

// Backed by a real send in the same turn (e.g. PR #99 rescue) → kept.
assert.equal(guardUnverifiedMediaClaims(azairul, withBrochure), azairul.trim());

// Non-media "kirim" untouched.
const invoice = "Invoice-nya langsung kami kirimkan ya Kak. Total Rp230.000.";
assert.equal(guardUnverifiedMediaClaims(invoice, none), invoice);
assert.equal(hasUnverifiedMediaClaim("Sambil menunggu konfirmasi staf, ada lagi yang bisa dibantu?", none), false);

// PR #99 past-tense claim guard unchanged.
assert.equal(hasUnverifiedMediaClaim("Baik Kak, foto-fotonya sudah Rani kirimkan ke chat Kakak ya.", none), true);
assert.equal(hasUnverifiedMediaClaim("Baik Kak, foto-fotonya sudah Rani kirimkan ke chat Kakak ya.", withBrochure), false);

// Resend cap: brochure sent 1 min ago → no rescue send (text is stripped instead).
const now = Date.parse("2026-10-16T16:03:21Z");
const sentAt = Date.parse("2026-10-16T16:02:09Z");
assert.equal(decideBrochureRepeat({ text: "", rooms: [], now, threadSendAts: [sentAt] }).action, "already_sent");
assert.equal(decideBrochureRepeat({ text: "", rooms: [], now: sentAt + 31 * 60_000, threadSendAts: [sentAt] }).action, "send");
const three = [sentAt - 5 * 3600_000, sentAt - 3 * 3600_000, sentAt - 2 * 3600_000];
assert.equal(decideBrochureRepeat({ text: "", rooms: [], now: sentAt, threadSendAts: three }).action, "already_sent");

// Wiring: rescue still gated by the cap, guard still applied to non-fast-path replies.
const svc = readFileSync("src/services/wa-autoreply.service.ts", "utf8");
assert.match(svc, /hasUnverifiedMediaClaim\(finalReply, delivery\)/);
assert.match(svc, /decideBrochureRepeat\(\{ text: "", rooms: \[\], now: Date\.now\(\), threadSendAts: sends \}\)/);
assert.match(svc, /finalReply = guardUnverifiedMediaClaims\(finalReply, delivery\)/);

console.log("test-media-promise-guard: OK");
