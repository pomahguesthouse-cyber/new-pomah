/**
 * Replay kasus Sofiah 8 Nov 2026 (PII disamarkan): tanggal 11–12 Des sudah di
 * slot, tetapi bot menanyakan tanggal lagi (fallback guard) dan tidak bisa
 * membaca "chek-in nya tanggal 11 cek-out nya tgl 12 kk".
 * Slot store di-mock (pola merge update_conversation_topic: patch ⊕ slot lama).
 */
import assert from "node:assert/strict";
import { resolveLabeledDaysAgainstKnownStay, resolveRelativeDayRange, resolveMonthOnlyCorrection } from "@/lib/id-date";
import {
  applyCombinationGuardToReply,
  capacityGuardFallbackReply,
  isRoomSelectionMessage,
} from "@/services/wa-autoreply/combination-capacity-guard";

const rooms = [
  { name: "Family Room 222", capacity: 4, extrabed_capacity: 2 },
  { name: "Family Suite 100", capacity: 4, extrabed_capacity: 2 },
  { name: "Deluxe", capacity: 2, extrabed_capacity: 1 },
  { name: "Grand Deluxe", capacity: 2, extrabed_capacity: 1 },
  { name: "Single", capacity: 1, extrabed_capacity: 1 },
];
const guardRooms = rooms.map((r) => ({ name: r.name, capacity: r.capacity, extraBedCapacity: r.extrabed_capacity }));

// Slot store mock (persist → media/FAQ → booking hydration).
let slots: Record<string, unknown> = {};
const persist = (patch: Record<string, unknown>) => (slots = { ...slots, ...patch });

// 06:09 "permisi kak ... masih tersedia untuk 11 desember?" → 1 malam diasumsikan.
const first = resolveRelativeDayRange("permisi kak, untuk homestay nya apakah masih tersedia untuk 11 desember?", "2026-11-08T06:09:00+07:00")!;
assert.equal(first.checkIn, "2026-12-11");
assert.equal(first.checkoutAssumed, true);
persist({ checkIn: first.checkIn, checkOut: first.checkOut, checkoutAssumed: true });
// 06:10 "untuk 7 orang kk" ; 06:11 FAQ family room ; "boleh kak" (brosur) → slot TIDAK hilang.
persist({ partialAdults: 7, partialChildren: 0, roomLabel: "Family" });
assert.deepEqual([slots.checkIn, slots.partialAdults], ["2026-12-11", 7], "slot bertahan lintas media/FAQ");
// Persetujuan brosur bukan pilihan kamar/booking.
assert.equal(isRoomSelectionMessage("boleh kak", rooms), false);

// 14:10 "iyaa kak, yang 1 family room + 1 kamar deluxe boleh kak" → seleksi (bukan tanya ulang daftar).
const pick = "iyaa kak, yang 1 family room + 1 kamar deluxe boleh kak";
assert.equal(isRoomSelectionMessage(pick, rooms), true);
assert.equal(isRoomSelectionMessage("kalo yg family room itu gmn ya kak kamarnya", rooms), false);

// LLM menawarkan Family + Deluxe tanpa extra bed (kapasitas 6) → guard fail-closed.
const llm = "Baik Kak, 1 Family Room 222 + 1 Deluxe (kapasitas 6 orang) Rp730.000/malam.";
const stay = { checkIn: slots.checkIn as string, checkOut: slots.checkOut as string, checkoutAssumed: true, lastInbound: pick };
const g = applyCombinationGuardToReply({ reply: llm, rooms, slots, inboundBodies: [pick], stay });
assert.equal(g.fallback, true);
assert.doesNotMatch(g.text, /check-in dan check-out/i, "check-in yang sudah diketahui TIDAK ditanya ulang");
assert.match(g.text, /11–12 Desember 2026|11.{1,3}12 Des/);
assert.match(g.text, /perlu tambahan 1 extra bed/);
assert.match(g.text, /Check-out-nya tanggal 12 Desember 2026 \(1 malam\) ya/, "hanya checkout asumsi yang dikonfirmasi");
assert.doesNotMatch(g.text, /Rp/, "fallback tanpa harga");

// 14:15 "chek-in nya tanggal 11 cek-out nya tgl 12 kk" → dijangkarkan ke Desember (bukan November).
const msg = "chek-in nya tanggal 11 cek-out nya tgl 12 kk";
const anchored = resolveLabeledDaysAgainstKnownStay(msg, slots.checkIn as string);
assert.deepEqual(anchored, { checkIn: "2026-12-11", checkOut: "2026-12-12" });
persist({ ...anchored!, checkoutAssumed: false });
// Setelah konfirmasi: fallback tidak menanyakan tanggal apapun.
const g2 = capacityGuardFallbackReply(7, { checkIn: "2026-12-11", checkOut: "2026-12-12", checkoutAssumed: false, lastInbound: pick }, guardRooms);
assert.doesNotMatch(g2, /tanggal berapa|check-in dan check-out|Check-out-nya/);
// Typo label juga dibaca parser umum bila bulan disebut.
assert.deepEqual(
  (({ checkIn, checkOut }) => ({ checkIn, checkOut }))(resolveRelativeDayRange("chek-in 11 des cek-out 13 des", "2026-11-08T14:15:00+07:00")!),
  { checkIn: "2026-12-11", checkOut: "2026-12-13" },
);

// Koreksi eksplisit terbaru menang (bulan disebut → helper jangkar mundur).
assert.equal(resolveLabeledDaysAgainstKnownStay("checkin 20 jan checkout 22 jan", "2026-12-11"), null);
assert.equal(resolveRelativeDayRange("checkin 20 jan checkout 22 jan", "2026-11-08T14:15:00+07:00")!.checkIn, "2027-01-20");
// Koreksi hari dalam bulan yang sama.
assert.deepEqual(resolveLabeledDaysAgainstKnownStay("cek in tgl 12 cek out tgl 14", "2026-12-11"), { checkIn: "2026-12-12", checkOut: "2026-12-14" });
// Lintas bulan: out < in → bulan berikut.
assert.deepEqual(resolveLabeledDaysAgainstKnownStay("check in 30 check out 2", "2026-12-11"), { checkIn: "2026-12-30", checkOut: "2027-01-02" });
// Tanpa stay diketahui → tidak menebak (stale/unknown tidak dihidupkan).
assert.equal(resolveLabeledDaysAgainstKnownStay(msg, null), null);
assert.equal(resolveLabeledDaysAgainstKnownStay(msg, "bukan-tanggal"), null);
// Hanya satu label → tidak dijangkarkan.
assert.equal(resolveLabeledDaysAgainstKnownStay("check-in nya tanggal 11", "2026-12-11"), null);

// Tanggal belum diketahui → tetap tanyakan check-in & check-out (perilaku lama).
assert.match(capacityGuardFallbackReply(7, {}, guardRooms), /check-in dan check-out/);
assert.match(capacityGuardFallbackReply(7), /check-in dan check-out/);
// Pilihan yang tak cukup meski extra bed.
assert.match(capacityGuardFallbackReply(7, { checkIn: "2026-12-11", checkOut: "2026-12-12", lastInbound: "ambil 1 deluxe + 1 single" }, guardRooms), /belum cukup/);

// Regresi PR140 tetap: "Des" setelah "tgl 11 - 14".
assert.ok(resolveMonthOnlyCorrection("Des", ["Rencana kami ditgl 11 - 14"], "2026-11-08"));
console.log("✓ Sofiah date-context replay passed");
