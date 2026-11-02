/**
 * Regresi thread Andika (6285229587291), 2 Nov 2026:
 * tanggal survei "besok" (3 Nov) menimpa tanggal menginap 9–10 Nov, lalu
 * fallback "jawabannya sedang kami siapkan" tidak pernah ditindaklanjuti.
 */
import assert from "node:assert/strict";
import { extractAllSlots, isVisitOnlyDateMention } from "../src/ai/state-machine/flexible-slot-extractor";
import { FALLBACK_MESSAGE, TERMINAL_FALLBACK_MESSAGE } from "../src/services/wa-autoreply/runtime-policy";
import { ADMIN_HANDOFF_KIND_LABEL } from "../src/services/wa-autoreply/admin-handoff";

const today = "2026-11-02";
const rooms = [
  { id: "10000000-0000-0000-0000-000000000001", name: "Family Suite 100", base_rate: 500000 },
  { id: "r222", name: "Family Room 222", base_rate: 500000 },
];

// Survei saja → tidak ada tanggal menginap.
for (const msg of [
  "soalnya pengen survey dulu besok kak",
  "besok selasa jam 08.00 pagi mau survei kak",
  "kalau mau suvey dulu bole kak? besok",
  "besok saya mampir lihat lokasi dulu",
  "besok saya datang ke lokasi kak",
]) {
  const s = extractAllSlots(msg, rooms, "6285229587291", today);
  assert.equal(s.check_in, undefined, `visit-only harus tanpa check_in: ${msg}`);
  assert.equal(s.check_out, undefined, msg);
}
assert.ok(isVisitOnlyDateMention("soalnya pengen survey dulu besok kak"));

// Tanggal menginap tetap diambil, walau survei ikut disebut.
const booking = extractAllSlots("Booking family suite 100, Andika tanggal 09-10 November, 5 Dewasa", rooms, "6285229587291", today);
assert.equal(booking.check_in, "2026-11-09");
assert.equal(booking.check_out, "2026-11-10");
assert.equal(booking.room_type, "Family Suite 100");

const both = extractAllSlots("survei besok kak, nginepnya tanggal 9-10 november", rooms, "6285229587291", today);
assert.equal(both.check_in, "2026-11-09");
assert.equal(both.check_out, "2026-11-10");
assert.equal(isVisitOnlyDateMention("survei besok kak, nginepnya tanggal 9-10 november"), false);

// Menginap besok (bukan survei) tetap terbaca.
const stayTomorrow = extractAllSlots("mau nginep besok 1 malam kak", rooms, "6285229587291", today);
assert.equal(stayTomorrow.check_in, "2026-11-03");

// Fallback terminal tidak berjanji "segera kami kirim" dan menyebut admin.
assert.ok(!/segera kami kirim/i.test(TERMINAL_FALLBACK_MESSAGE));
assert.ok(/admin/i.test(TERMINAL_FALLBACK_MESSAGE));
assert.notEqual(TERMINAL_FALLBACK_MESSAGE, FALLBACK_MESSAGE);
assert.ok(ADMIN_HANDOFF_KIND_LABEL.ai_unavailable);

console.log("✓ survey-vs-stay-dates: semua lulus");
