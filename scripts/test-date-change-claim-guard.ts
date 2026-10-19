import assert from "node:assert/strict";
import {
  buildHonestDateChangeReply,
  claimsDateUpdated,
  shouldReplaceDateUpdateClaim,
} from "../src/services/wa-autoreply/date-change-claim-guard";

// Khodijah PG-Y3E3N, 10 Okt 15:01:58 — klaim palsu dari jalur AI ("Booking Slots")
const fake =
  "Baik Kak, saya sudah perbarui tanggal check-in-nya menjadi 20 November 2026.\n\n" +
  "Untuk booking PG-Y3E3N, sekarang menjadi menginap dari tanggal 20 November 2026 sampai 22 November 2026.";
assert.equal(claimsDateUpdated(fake), true);
assert.equal(shouldReplaceDateUpdateClaim({ reply: fake, hasRecordedBooking: true, toolsUsed: ["Booking Slots"] }), true);
// State machine (draft, sudah cek ulang ketersediaan) tidak diganti
assert.equal(shouldReplaceDateUpdateClaim({ reply: fake, hasRecordedBooking: true, toolsUsed: ["booking_state_machine"] }), false);
// Tanpa booking tercatat (masih draft lewat AI) tidak diganti di sini
assert.equal(shouldReplaceDateUpdateClaim({ reply: fake, hasRecordedBooking: false, toolsUsed: [] }), false);
// Bukan klaim perubahan tanggal
assert.equal(claimsDateUpdated("Check-in mulai pukul 14:00, Kak."), false);
assert.equal(claimsDateUpdated("Data kamar sudah kami catat ya Kak."), false);

const honest = buildHonestDateChangeReply("PG-Y3E3N");
assert.match(honest, /PG-Y3E3N/);
assert.match(honest, /belum berubah/);
assert.ok(!claimsDateUpdated(honest), "balasan jujur tidak boleh terbaca sebagai klaim");
assert.ok(!/\d+\s*(menit|jam)|segera/i.test(honest));

console.log("✓ date-change claim guard: tidak ada lagi 'sudah diperbarui' palsu untuk booking tercatat");
