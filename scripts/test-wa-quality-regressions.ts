/**
 * Regresi kualitas jawaban WA — transcript produksi 16, 25–28 Sep 2026.
 * `bun run test:wa-quality`
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  isBookingProcessQuestion,
  isExplicitRoomCountRequirement,
  isNonAvailabilityFollowup,
  isPriceCalculationRequest,
  looksLikeBookingInquiry,
  parseGuestCountFollowup,
  shouldUseDeterministicAvailability,
} from "../src/services/wa-autoreply/message-parsers";
import { repeatsLastBotReply } from "../src/services/wa-autoreply/availability-formatters";
import {
  MEDIA_FAST_PATH_PHOTO_REPLY,
  MEDIA_SLOT_QUESTION,
  adaptMediaSlotQuestion,
} from "../src/services/wa-autoreply/media-fast-path";

// ── A. 16 Sep: follow-up bukan pertanyaan ketersediaan ──────────────────────
const notAvailability = [
  "Kak, ini klo duluxe 2 kamar 2 malam harganya berapa?",
  "Klo booking disini nanti bisa pake ruang tamu nya ga kak?",
  "Baik kak, untuk booking nya sistem nya gmn ya?",
  "Kalau duluxe itu per kamar brpa tempat tidur ya kak?",
  "totalnya jadi berapa kak?",
  "cara pesannya gimana kak?",
];
for (const m of notAvailability) {
  assert.equal(looksLikeBookingInquiry(m), false, `looksLikeBookingInquiry harus false: ${m}`);
}
assert.equal(isBookingProcessQuestion("Baik kak, untuk booking nya sistem nya gmn ya?"), true);
assert.equal(isBookingProcessQuestion("gimana kak masih ada kamar?"), false);
assert.equal(isPriceCalculationRequest("deluxe 2 kamar 2 malam harganya berapa"), true);
assert.equal(isPriceCalculationRequest("harga per malam berapa?"), false);
assert.equal(isNonAvailabilityFollowup("masih ada kamar kak?"), false);
// Pilihan jumlah kamar = kebutuhan booking, bukan daftar ulang.
assert.equal(isExplicitRoomCountRequirement("yang duluxe kak, rencana nya 2 kamar"), true);
assert.equal(looksLikeBookingInquiry("Yang duluxe kak, rencana nya 2 kamar"), false);
// Jalur tanggal eksplisit juga direm.
assert.equal(shouldUseDeterministicAvailability("cara booking untuk tgl 5-6 gimana kak?"), false);
assert.equal(shouldUseDeterministicAvailability("tgl 5-6 masih ada kamar?"), true);

// Pertanyaan ketersediaan murni tetap lewat fast-path.
for (const m of ["Masih ada kamar?", "Harga per malam berapa?", "kalo deluxe masih ada kak?"]) {
  assert.equal(looksLikeBookingInquiry(m), true, `looksLikeBookingInquiry harus true: ${m}`);
}

// ── B. Fast-path tidak boleh mengulang balasan terakhir ─────────────────────
const list =
  "Untuk tanggal 21 November 2026 – 22 November 2026, masih tersedia:\n- Single: 1 kamar tersedia, Rp175.000/malam\n- Deluxe: 4 kamar tersedia, Rp250.000/malam\n\nKakak rencana untuk berapa orang?";
const history = [
  { direction: "in", body: "Halo kak, booking tgl 21 November?" },
  { direction: "out", body: `Halo Kak, u${list.slice(1)}` },
  { direction: "in", body: "Yang duluxe kak" },
];
assert.equal(repeatsLastBotReply(list, history), true, "beda sapaan tetap dianggap ulangan");
assert.equal(repeatsLastBotReply(list, [...history, { direction: "out", body: "Baik Kak." }]), false);
assert.equal(repeatsLastBotReply("Baik Kak.", [{ direction: "out", body: "Baik Kak." }]), false, "balasan pendek tidak diblok");

// ── C. 28 Sep: parser jumlah tamu gaya label-dulu ───────────────────────────
assert.deepEqual(parseGuestCountFollowup("Dewasa 5 anak 2"), { adults: 5, children: 2, total: 7 });
assert.deepEqual(parseGuestCountFollowup("5 dewasa 2 anak"), { adults: 5, children: 2, total: 7 });
assert.deepEqual(parseGuestCountFollowup("dewasa: 4, anak: 1"), { adults: 4, children: 1, total: 5 });
assert.deepEqual(parseGuestCountFollowup("3 orang dewasa 1 anak"), { adults: 3, children: 1, total: 4 });

// ── D. 28 Sep: balasan media tidak menanyakan ulang slot yang sudah ada ─────
assert.ok(MEDIA_FAST_PATH_PHOTO_REPLY.includes(MEDIA_SLOT_QUESTION));
const both = adaptMediaSlotQuestion(MEDIA_FAST_PATH_PHOTO_REPLY, { hasDates: true, hasGuests: true });
assert.ok(!/tanggal berapa|berapa orang/i.test(both), both);
assert.match(adaptMediaSlotQuestion(MEDIA_FAST_PATH_PHOTO_REPLY, { hasDates: true, hasGuests: false }), /berapa orang/);
assert.match(adaptMediaSlotQuestion(MEDIA_FAST_PATH_PHOTO_REPLY, { hasDates: false, hasGuests: true }), /tanggal berapa/);
assert.equal(
  adaptMediaSlotQuestion(MEDIA_FAST_PATH_PHOTO_REPLY, { hasDates: false, hasGuests: false }),
  MEDIA_FAST_PATH_PHOTO_REPLY,
);

// ── E. 16 Sep: wa_queue_upsert idempoten per pesan ─────────────────────────
const migration = readFileSync(
  new URL("../drizzle/migrations/0002_wa_queue_upsert_idempotent_message.sql", import.meta.url),
  "utf8",
);
const lockAt = migration.indexOf("pg_advisory_xact_lock");
const guardAt = migration.indexOf("q.last_message_id = p_message_id");
const burstAt = migration.indexOf("q.status IN ('pending', 'waiting')");
assert.ok(lockAt > 0 && guardAt > lockAt && guardAt < burstAt, "guard last_message_id harus setelah lock, sebelum burst");

console.log("✓ WA quality regressions passed");
