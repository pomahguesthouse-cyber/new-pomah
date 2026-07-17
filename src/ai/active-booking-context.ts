/**
 * Booking-aware context helper.
 *
 * Fetches bookings for a guest phone that are close to check-in (within
 * -1 day .. +7 days) and formats them as a high-priority block for the
 * agent system prompt. This bypasses the rolling history window so the
 * bot always remembers a booking that is about to happen.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { fmtDateID } from "@/lib/date";

interface RawBooking {
  id: string;
  reference_code: string | null;
  check_in: string;
  check_out: string;
  status: string;
  payment_status: string | null;
  total_amount: number | null;
  paid_amount: number | null;
  adults: number | null;
  children: number | null;
  room_type_id: string | null;
  special_requests: string | null;
}

const WINDOW_BEFORE_DAYS = 1;
const WINDOW_AFTER_DAYS = 7;

function shiftDate(base: Date, days: number): string {
  const d = new Date(base);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export async function resolveActiveBookingContext(
  client: SupabaseClient<any, any, any>,
  phone: string,
): Promise<{ block: string; bookings: RawBooking[] } | null> {
  if (!phone) return null;

  // Cari guest via phone_normalized (fungsi Postgres tersedia).
  const { data: guests } = await client
    .from("guests")
    .select("id")
    .filter("phone_normalized", "eq", phone.replace(/[^0-9]/g, "").replace(/^0/, "62"))
    .is("merged_into", null)
    .limit(1);

  const guestId = (guests?.[0] as { id?: string } | undefined)?.id;
  if (!guestId) return null;

  const now = new Date();
  const from = shiftDate(now, -WINDOW_BEFORE_DAYS);
  const to = shiftDate(now, WINDOW_AFTER_DAYS);

  const { data: bookings } = await client
    .from("bookings")
    .select(
      "id, reference_code, check_in, check_out, status, payment_status, total_amount, paid_amount, adults, children, room_type_id, special_requests",
    )
    .eq("guest_id", guestId)
    .gte("check_in", from)
    .lte("check_in", to)
    .neq("status", "cancelled")
    .order("check_in", { ascending: true })
    .limit(3);

  const rows = (bookings ?? []) as RawBooking[];
  if (rows.length === 0) return null;

  // Ambil nama room type sekali (opsional, best-effort)
  const roomTypeIds = [...new Set(rows.map((r) => r.room_type_id).filter(Boolean))] as string[];
  const roomTypeMap = new Map<string, string>();
  if (roomTypeIds.length > 0) {
    const { data: rts } = await client
      .from("room_types")
      .select("id, name")
      .in("id", roomTypeIds);
    for (const rt of (rts ?? []) as Array<{ id: string; name: string }>) {
      roomTypeMap.set(rt.id, rt.name);
    }
  }

  const lines = rows.map((b) => {
    const roomName = b.room_type_id ? (roomTypeMap.get(b.room_type_id) ?? "kamar") : "kamar";
    const ci = fmtDateID(new Date(b.check_in));
    const co = fmtDateID(new Date(b.check_out));
    const total = Number(b.total_amount ?? 0);
    const paid = Number(b.paid_amount ?? 0);
    const outstanding = Math.max(0, total - paid);
    const pax = `${b.adults ?? 1}${b.children ? `+${b.children} anak` : ""}`;
    const paymentInfo =
      outstanding > 0
        ? `belum lunas (sisa Rp ${outstanding.toLocaleString("id-ID")})`
        : `LUNAS`;
    return (
      `• Booking ${b.reference_code ?? b.id.slice(0, 8)} — ${roomName}, ${ci} → ${co}, ${pax} tamu. ` +
      `Status: ${b.status}, pembayaran: ${paymentInfo}` +
      (b.special_requests ? `. Permintaan khusus: ${b.special_requests}` : "")
    );
  });

  const block =
    `⚠️ TAMU INI SUDAH PUNYA BOOKING AKTIF (menjelang check-in). ` +
    `JANGAN tanya ulang tanggal/kamar/nama — pakai data ini sebagai fakta:\n` +
    lines.join("\n");

  return { block, bookings: rows };
}
