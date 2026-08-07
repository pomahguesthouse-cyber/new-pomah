/**
 * Regression: perbaikan audit 7 Agustus 2026 (S1, S2, B1, S4).
 *
 * Fokus pada bagian yang bisa diuji tanpa DB/jaringan:
 *   S1 — validasi bentuk identifier booking di lookup invoice publik
 *   S2 — otorisasi update_payment_status (manager vs tamu tanpa bukti OCR)
 *   B1 — formatter TIDAK boleh bilang "penuh" saat status tidak diketahui
 *   S4 — webhook Evolution fail-closed saat token env kosong
 */

import assert from "node:assert/strict";

import {
  formatAvailabilityForGuestCount,
  formatAvailabilityReply,
} from "../src/services/wa-autoreply/availability-formatters";
import { updatePaymentStatus } from "../src/tools/finance/update-payment-status.tool";
import type { ToolContext } from "../src/tools/types";

// ── S1: bentuk identifier booking ────────────────────────────────────────────
// Regex yang sama dipakai di getBookingInvoice (public.functions.ts) dan di
// migrasi 20260807090000. Wildcard ILIKE harus ditolak SEBELUM menyentuh DB.
const BOOKING_LOOKUP_ID_RE =
  /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[A-Za-z0-9-]{3,20})$/i;

assert.equal(BOOKING_LOOKUP_ID_RE.test("PG-9J6Y2"), true);
assert.equal(BOOKING_LOOKUP_ID_RE.test("pg-9j6y2"), true);
assert.equal(BOOKING_LOOKUP_ID_RE.test("3f1a2b3c-4d5e-6f70-8192-a3b4c5d6e7f8"), true);
// Payload serangan yang dulu mengembalikan invoice tamu acak:
assert.equal(BOOKING_LOOKUP_ID_RE.test("%"), false);
assert.equal(BOOKING_LOOKUP_ID_RE.test("PG-%"), false);
assert.equal(BOOKING_LOOKUP_ID_RE.test("PG-_____"), false);
assert.equal(BOOKING_LOOKUP_ID_RE.test("%%"), false);
assert.equal(BOOKING_LOOKUP_ID_RE.test("PG A"), false);
assert.equal(BOOKING_LOOKUP_ID_RE.test(""), false);

// ── S4: fail-closed ──────────────────────────────────────────────────────────
// Replika logika authorize() di src/routes/api.evolution.ts.
function authorizeStatus(expected: string | undefined, providedToken: string | null): number {
  if (!expected) return 503;
  return providedToken === expected ? 200 : 403;
}
assert.equal(authorizeStatus(undefined, "apa-saja"), 503, "token env kosong harus menolak");
assert.equal(authorizeStatus(undefined, null), 503);
assert.equal(authorizeStatus("rahasia", "rahasia"), 200);
assert.equal(authorizeStatus("rahasia", "salah"), 403);
assert.equal(authorizeStatus("rahasia", null), 403);

// ── B1: status tidak diketahui ≠ penuh ───────────────────────────────────────
const failedToolOutput = JSON.stringify({
  ok: false,
  availability_unknown: true,
  error: "Gagal mengecek ketersediaan kamar: timeout",
  reply_to_guest: "Mohon maaf Kak, sistem ketersediaan kami sedang tersendat sebentar.",
});
const unknownReply = formatAvailabilityReply(failedToolOutput);
assert.ok(unknownReply, "payload availability_unknown harus menghasilkan balasan");
assert.equal(unknownReply!.intent, "deterministic_availability_unknown");
assert.doesNotMatch(unknownReply!.reply, /penuh/i, "jangan pernah bilang penuh saat status tak diketahui");

// Semua tipe kamar tanpa angka ketersediaan (RPC balik kosong) → juga bukan "penuh".
const allNullRooms = JSON.stringify({
  periode: "8 Agustus 2026 – 9 Agustus 2026",
  kamar: [
    { nama: "Deluxe", kamar_tersedia: null, harga_per_malam: 300000 },
    { nama: "Family", kamar_tersedia: null, harga_per_malam: 500000 },
  ],
});
const allNullReply = formatAvailabilityReply(allNullRooms);
assert.ok(allNullReply);
assert.equal(allNullReply!.intent, "deterministic_availability_unknown");
assert.doesNotMatch(allNullReply!.reply, /penuh/i);

const allNullForGuestCount = formatAvailabilityForGuestCount(allNullRooms, {
  adults: 2,
  children: 0,
  total: 2,
});
assert.ok(allNullForGuestCount);
assert.equal(allNullForGuestCount!.intent, "deterministic_availability_unknown");

// Kamar yang BENAR-BENAR nol tetap harus dilaporkan penuh (jangan over-correct).
const genuinelyFull = JSON.stringify({
  periode: "18 September 2026 – 19 September 2026",
  kamar: [
    { nama: "Deluxe", kamar_tersedia: 0, harga_per_malam: 300000 },
    { nama: "Family", kamar_tersedia: 0, harga_per_malam: 500000 },
  ],
});
const fullReply = formatAvailabilityReply(genuinelyFull);
assert.ok(fullReply);
assert.equal(fullReply!.intent, "deterministic_availability_full");
assert.match(fullReply!.reply, /penuh/i);

// Ada stok → tetap normal.
const hasStock = JSON.stringify({
  periode: "8 Agustus 2026 – 9 Agustus 2026",
  kamar: [{ nama: "Deluxe", kamar_tersedia: 2, harga_per_malam: 300000 }],
});
assert.equal(formatAvailabilityReply(hasStock)!.intent, "deterministic_availability");

// ── S2: otorisasi update_payment_status ──────────────────────────────────────
type QueryResult = { data: unknown; error: unknown };

/**
 * Stub Supabase minimal: builder berantai yang bisa di-`await` di titik mana
 * pun (thenable) dan mendukung `.maybeSingle()` setelah `.limit()`.
 */
function makeBuilder(result: QueryResult, onUpdate?: () => void) {
  const builder: any = {
    select: () => builder,
    eq: () => builder,
    gte: () => builder,
    in: () => builder,
    order: () => builder,
    limit: () => builder,
    update: () => {
      onUpdate?.();
      return builder;
    },
    maybeSingle: () =>
      Promise.resolve({
        data: Array.isArray(result.data) ? ((result.data as any[])[0] ?? null) : result.data,
        error: result.error,
      }),
    then: (resolve: (v: QueryResult) => unknown) => Promise.resolve(result).then(resolve),
  };
  return builder;
}

function stubDb(handlers: Record<string, () => QueryResult>, onUpdate?: () => void) {
  return {
    from(table: string) {
      const result = handlers[table] ? handlers[table]() : { data: [], error: null };
      return makeBuilder(result, onUpdate);
    },
  };
}

const baseCtx = (over: Partial<ToolContext>): ToolContext =>
  ({
    supabaseAdmin: stubDb({}),
    supabasePublic: stubDb({}),
    rooms: [],
    property: {},
    today: "2026-08-07",
    ...over,
  }) as unknown as ToolContext;

// (a) Tamu tanpa bukti OCR → DITOLAK, dan tidak ada update yang dijalankan.
{
  let updateCalled = false;
  const db = stubDb(
    {
      // Thread tamu ada, tapi tidak ada pesan masuk ber-OCR yang cocok.
      whatsapp_threads: () => ({ data: [{ id: "thread-1" }], error: null }),
      whatsapp_messages: () => ({ data: [], error: null }),
    },
    () => {
      updateCalled = true;
    },
  );
  const out = JSON.parse(
    await updatePaymentStatus(
      { reference_code: "PG-9J6Y2", new_status: "lunas" },
      baseCtx({ supabaseAdmin: db as any, phone: "6281234567890", isManager: false }),
    ),
  );
  assert.equal(out.ok, false, "tamu tanpa bukti OCR tidak boleh bisa menandai lunas");
  assert.match(String(out.error), /bukti transfer/i);
  assert.equal(updateCalled, false, "tidak boleh ada UPDATE ke bookings");
}

// (b) Wildcard pada reference_code → ditolak sebelum menyentuh DB.
{
  const out = JSON.parse(
    await updatePaymentStatus(
      { reference_code: "PG-%", new_status: "paid" },
      baseCtx({ phone: "6281234567890", isManager: false }),
    ),
  );
  assert.equal(out.ok, false);
  assert.match(String(out.error), /tidak valid/i);
}

// (c) Simulator/OCR cocok → lolos gate otorisasi (gagal setelahnya karena stub
//     tidak menyediakan booking, tapi pesan errornya BUKAN soal otorisasi).
{
  const out = JSON.parse(
    await updatePaymentStatus(
      { reference_code: "PG-9J6Y2", new_status: "paid" },
      baseCtx({
        phone: "6281234567890",
        isManager: false,
        recentOcrResult: {
          ocr: {},
          match: { status: "matched", booking_code: "PG-9J6Y2" },
        },
      } as Partial<ToolContext>),
    ),
  );
  assert.equal(out.ok, false);
  assert.doesNotMatch(String(out.error), /bukti transfer/i);
  assert.match(String(out.error), /tidak ditemukan/i);
}

console.log("✓ Security hardening regressions (S1, S2, B1, S4) passed");
