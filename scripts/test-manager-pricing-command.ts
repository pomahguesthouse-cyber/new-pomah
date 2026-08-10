/**
 * Regresi: perintah harga dari manajer (Telegram) harus tertangkap parser
 * DETERMINISTIK, bukan jatuh ke rantai LLM → ask_agent → sub-agent pricing.
 *
 * Insiden 10 Agu 2026 (agen Juminten):
 *   manajer: "rubah harga single 250 rb"
 *   bot    : 'Tipe kamar "kamar Single menjadi" tidak ditemukan…'
 *   manajer: "single"
 *   bot    : "saya masih mengalami kendala teknis saat berkomunikasi dengan
 *             agen pricing"
 *
 * Tiga cacat sekaligus: verba "rubah" tidak dikenal, harga bersepasi "250 rb"
 * tidak cocok, dan nama kamar kotor tidak dibersihkan resolver.
 */

import assert from "node:assert/strict";
import { parseManagerCommand } from "../src/ai/manager-command-parser";
import { parseIDRAmount } from "../src/lib/idr";
import { stripRoomNoise } from "../src/lib/room-name";
import { resolveRoomType } from "../src/tools/pricing/_resolve-room-type";

const rooms = [
  { id: "r1", name: "Single", base_rate: 200000 },
  { id: "r2", name: "Grand Deluxe", base_rate: 500000 },
  { id: "r3", name: "Deluxe", base_rate: 350000 },
  { id: "r4", name: "Family Suite 100", base_rate: 700000 },
  { id: "r5", name: "Family Room 222", base_rate: 650000 },
] as any[];

let checks = 0;
function args(message: string): Record<string, unknown> | null {
  const parsed = parseManagerCommand(message);
  return parsed ? JSON.parse(parsed.rawArgs) : null;
}
function expectBaseRate(message: string, room: string, rate: number): void {
  const a = args(message);
  assert.ok(a, `tidak tertangkap parser: "${message}"`);
  assert.equal(a!.room_type, room, `room_type salah untuk "${message}"`);
  assert.equal(a!.base_rate, rate, `base_rate salah untuk "${message}"`);
  checks++;
}

// ── 1. parseIDRAmount ───────────────────────────────────────────────────────
assert.equal(parseIDRAmount("250 rb"), 250_000);      // insiden: harga bersepasi
assert.equal(parseIDRAmount("250rb"), 250_000);
assert.equal(parseIDRAmount("250 ribu"), 250_000);
assert.equal(parseIDRAmount("250k"), 250_000);
assert.equal(parseIDRAmount("350.000"), 350_000);
assert.equal(parseIDRAmount("350,000"), 350_000);
assert.equal(parseIDRAmount("Rp 350.000"), 350_000);
assert.equal(parseIDRAmount("1.2jt"), 1_200_000);      // dulu NaN
assert.equal(parseIDRAmount("1,2 juta"), 1_200_000);
assert.equal(parseIDRAmount("1.200rb"), 1_200_000);
assert.equal(parseIDRAmount("abc"), null);
assert.equal(parseIDRAmount("0"), null);
checks += 12;

// ── 2. stripRoomNoise ───────────────────────────────────────────────────────
assert.equal(stripRoomNoise("kamar Single menjadi"), "Single"); // insiden persis
assert.equal(stripRoomNoise("tipe kamar deluxe saja"), "deluxe");
assert.equal(stripRoomNoise("  Deluxe  "), "Deluxe");
assert.equal(stripRoomNoise("Family Suite 100"), "Family Suite 100"); // jangan dirusak
assert.equal(stripRoomNoise("kamar"), "kamar"); // jangan jadi string kosong
checks += 5;

// ── 3. Parser perintah — bentuk yang gagal di insiden ───────────────────────
expectBaseRate("rubah harga single 250 rb", "single", 250_000);
expectBaseRate("rubah harga kamar Single menjadi 250 rb", "Single", 250_000);
expectBaseRate("kamar deluxe saja ganti harga menjadi 250 rb", "deluxe", 250_000);
expectBaseRate("robah tarif Deluxe jadi 300rb", "Deluxe", 300_000);
expectBaseRate("update harga Grand Deluxe = 600.000", "Grand Deluxe", 600_000);
expectBaseRate("atur harga tipe kamar Deluxe ke Rp 275 ribu", "Deluxe", 275_000);

// ── 4. Bentuk lama tetap jalan (tidak boleh regresi) ────────────────────────
expectBaseRate("set harga deluxe 350rb", "deluxe", 350_000);
expectBaseRate("ubah tarif Single 220000", "Single", 220_000);
expectBaseRate("ganti harga Family Suite 100 1.2jt", "Family Suite 100", 1_200_000);

// Nama kamar berangka tidak boleh terpotong oleh nominal di belakangnya.
expectBaseRate("set harga Family Room 222 650rb", "Family Room 222", 650_000);

// ── 5. Extrabed & harga harian ──────────────────────────────────────────────
const extrabed = args("rubah extrabed kamar Deluxe menjadi 100 rb");
assert.ok(extrabed, "perintah extrabed tidak tertangkap");
assert.equal(extrabed!.room_type, "Deluxe");
assert.equal(extrabed!.extrabed_rate, 100_000);
assert.equal(extrabed!.base_rate, undefined, "extrabed tidak boleh menyentuh base_rate");
checks += 4;

const daily = args("set harga harian kamar Deluxe 2026-08-17 400 rb");
assert.ok(daily, "perintah harga harian tidak tertangkap");
assert.equal(daily!.room_type, "Deluxe");
assert.equal(daily!.from_date, "2026-08-17");
assert.equal(daily!.rate, 400_000);
checks += 4;

// ── 6. Bukan perintah harga → jangan diintersepsi ───────────────────────────
for (const notACommand of [
  "single",                       // jawaban disambiguasi, bukan perintah
  "berapa harga deluxe?",
  "naikkan harga deluxe 50rb",    // DELTA ambigu — harus ditanyakan LLM, bukan dieksekusi
  "besok ada kamar kosong?",
  "lihat harga",                  // ditangani cabang list_room_rates, bukan update
]) {
  const parsed = parseManagerCommand(notACommand);
  const isUpdate = parsed?.toolName === "update_room_rate";
  assert.equal(isUpdate, false, `tidak boleh dianggap perintah ubah harga: "${notACommand}"`);
  checks++;
}

// ── 7. Resolver menerima argumen kotor dari LLM ─────────────────────────────
for (const dirty of ["kamar Single menjadi", "Single", "single", " tipe kamar single "]) {
  const r = resolveRoomType(dirty, rooms);
  assert.equal(r.ok, true, `resolver gagal untuk "${dirty}": ${r.ok ? "" : r.error}`);
  assert.equal(r.ok && r.room.name, "Single");
  checks++;
}

// "Deluxe" tidak boleh ambigu menyambar "Grand Deluxe" (perilaku lama dipertahankan).
const deluxe = resolveRoomType("kamar Deluxe menjadi", rooms);
assert.equal(deluxe.ok, true);
assert.equal(deluxe.ok && deluxe.room.name, "Deluxe");
checks++;

// Urutan kata beda tetap ketemu lewat fallback token.
const reordered = resolveRoomType("suite family 100", rooms);
assert.equal(reordered.ok, true);
assert.equal(reordered.ok && reordered.room.name, "Family Suite 100");
checks += 2;

// Nama tak dikenal → error HARUS menyebut daftar pilihan agar manajer bisa lanjut.
// Penting: "Suite Presidential" TIDAK boleh menyambar "Family Suite 100" hanya
// karena berbagi kata "suite" — itu akan mengubah tarif kamar yang salah.
const unknown = resolveRoomType("Suite Presidential", rooms);
assert.equal(unknown.ok, false);
assert.match(unknown.ok ? "" : unknown.error, /Single/);
assert.match(unknown.ok ? "" : unknown.error, /Grand Deluxe/);
checks += 3;

// Kosong → tetap error, tapi tetap menyertakan pilihan.
const empty = resolveRoomType("", rooms);
assert.equal(empty.ok, false);
assert.match(empty.ok ? "" : empty.error, /Single/);
checks += 2;

console.log(`✅ test-manager-pricing-command: ${checks} assertions passed`);
