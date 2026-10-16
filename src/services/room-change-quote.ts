/**
 * Room-change quote for a guest's EXISTING booking (owner rule 16 Oct 2026):
 * when a guest switches room type, tell them the new total, the extra cost,
 * what they already paid and what they still need to transfer
 * (new total − paid; never just the nightly-rate difference).
 *
 * Read-only: this module never modifies a booking. The bot hands the quote to
 * staff; staff apply the change (change_booking_room recalculates totals).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { getDailyRatesForRange, resolveRoomNightlyRates } from "@/services/pricing/daily-rate.service";
import { capAvailabilityWithStopSell } from "@/services/pricing/stop-sell-availability";
import { allowsDeposit, requiredDepositAmount, requiresFullPayment } from "@/lib/deposit-policy";
import type { RoomTypeRow } from "@/ai/context-builder";

/* eslint-disable @typescript-eslint/no-explicit-any */
type AnyClient = SupabaseClient<any> | any;

export interface ActiveBookingRoom {
  bookingRoomId: string | null;
  roomTypeId: string | null;
  roomTypeName: string | null;
  roomId: string | null;
  nightlyRate: number;
  extraBedCount: number;
}

export interface ActiveBookingSnapshot {
  id: string;
  referenceCode: string;
  checkIn: string;
  checkOut: string;
  nights: number;
  status: string;
  paymentStatus: string | null;
  totalAmount: number;
  paidAmount: number;
  adults: number | null;
  rooms: ActiveBookingRoom[];
}

export interface RoomChangeQuote {
  ok: boolean;
  /** Why the change cannot be quoted (ok=false). */
  reason?: "unavailable" | "stop_sell" | "multi_room" | "same_room_type" | "no_rate";
  bookingId: string;
  referenceCode: string;
  checkIn: string;
  checkOut: string;
  nights: number;
  oldRoomTypeId: string | null;
  oldRoomTypeName: string | null;
  newRoomTypeId: string;
  newRoomTypeName: string;
  oldTotal: number;
  newTotal: number;
  /** Average nightly rate of the new room type for the stay. */
  newNightlyRate: number;
  /** newTotal − oldTotal (can be negative for a downgrade). */
  extra: number;
  paid: number;
  /** newTotal − paid, floored at 0: what the guest still owes overall. */
  amountDue: number;
  /** Minimum to transfer now under the deposit rule (1–2 nights: full). */
  requiredNow: number;
  fullPaymentRequired: boolean;
  /** paid − newTotal when the guest has overpaid after a downgrade. */
  refundDue: number;
  stopSellDates?: string[];
}

const rp = (n: number) => `Rp${Math.round(n).toLocaleString("id-ID")}`;

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** Pure figure computation — the single source of the money maths. */
export function buildRoomChangeQuote(input: {
  booking: ActiveBookingSnapshot;
  newRoomType: { id: string; name: string };
  newTotal: number;
  available: number;
  stopSellDates?: string[];
}): RoomChangeQuote {
  const b = input.booking;
  const current = b.rooms[0] ?? null;
  const nights = b.nights > 0 ? b.nights : 1;
  const newTotal = Math.max(0, Math.round(input.newTotal));
  const oldTotal = Math.max(0, Math.round(b.totalAmount));
  const paid = Math.max(0, Math.round(b.paidAmount));
  const amountDue = Math.max(0, newTotal - paid);
  const required = requiredDepositAmount(nights, newTotal);
  const base: RoomChangeQuote = {
    ok: true,
    bookingId: b.id,
    referenceCode: b.referenceCode,
    checkIn: b.checkIn,
    checkOut: b.checkOut,
    nights,
    oldRoomTypeId: current?.roomTypeId ?? null,
    oldRoomTypeName: current?.roomTypeName ?? null,
    newRoomTypeId: input.newRoomType.id,
    newRoomTypeName: input.newRoomType.name,
    oldTotal,
    newTotal,
    newNightlyRate: Math.round(newTotal / nights),
    extra: newTotal - oldTotal,
    paid,
    amountDue,
    requiredNow: Math.max(0, required - paid),
    fullPaymentRequired: requiresFullPayment(nights) || !allowsDeposit(nights),
    refundDue: Math.max(0, paid - newTotal),
  };
  if (b.rooms.length > 1) return { ...base, ok: false, reason: "multi_room" };
  if (current?.roomTypeId && current.roomTypeId === input.newRoomType.id) {
    return { ...base, ok: false, reason: "same_room_type" };
  }
  if ((input.stopSellDates?.length ?? 0) > 0) {
    return { ...base, ok: false, reason: "stop_sell", stopSellDates: input.stopSellDates };
  }
  if (!(input.available > 0)) return { ...base, ok: false, reason: "unavailable" };
  if (newTotal <= 0) return { ...base, ok: false, reason: "no_rate" };
  return base;
}

/** Guest-facing quote text (fixed figures, no LLM maths). */
export function formatRoomChangeQuoteReply(q: RoomChangeQuote, fmtDate: (d: string) => string = (d) => d): string {
  const stay = `${fmtDate(q.checkIn)}–${fmtDate(q.checkOut)} (${q.nights} malam)`;
  const from = q.oldRoomTypeName ?? "kamar sebelumnya";
  if (!q.ok) {
    if (q.reason === "unavailable" || q.reason === "stop_sell") {
      return (
        `Mohon maaf Kak, kamar ${q.newRoomTypeName} untuk ${stay} tidak tersedia. ` +
        `Booking ${q.referenceCode} (${from}) tetap seperti semula ya.`
      );
    }
    if (q.reason === "same_room_type") {
      return `Booking ${q.referenceCode} Kakak sudah memakai kamar ${q.newRoomTypeName} untuk ${stay} ya, Kak.`;
    }
    return (
      `Untuk perubahan kamar booking ${q.referenceCode}, Rani teruskan ke staf kami dulu ya, Kak, ` +
      `supaya rincian biayanya dihitung dengan tepat.`
    );
  }
  const lines = [
    `Baik Kak, berikut rincian perubahan booking ${q.referenceCode} (${stay}):`,
    `• Kamar: ${from} → ${q.newRoomTypeName}`,
    `• Total: ${rp(q.oldTotal)} → ${rp(q.newTotal)}`,
    q.extra >= 0 ? `• Tambahan biaya: ${rp(q.extra)}` : `• Selisih lebih murah: ${rp(-q.extra)}`,
    `• Sudah dibayar: ${rp(q.paid)}`,
  ];
  if (q.refundDue > 0) {
    lines.push(`• Kelebihan bayar: ${rp(q.refundDue)} (akan dibantu staf)`);
  } else if (q.fullPaymentRequired) {
    lines.push(`• Sisa yang perlu ditransfer: ${rp(q.amountDue)} (pemesanan 1–2 malam wajib lunas sebelum kedatangan)`);
  } else if (q.requiredNow > 0 && q.requiredNow < q.amountDue) {
    lines.push(`• Minimal transfer sekarang (DP 50%): ${rp(q.requiredNow)}; sisa tagihan total ${rp(q.amountDue)}`);
  } else {
    lines.push(`• Sisa yang perlu dibayar: ${rp(q.amountDue)}`);
  }
  return (
    lines.join("\n") +
    `\n\nKalau setuju, balas *ya* — perubahan akan Rani teruskan ke staf untuk diproses. ` +
    `Booking belum berubah sebelum staf mengonfirmasi.`
  );
}

/** One-line summary for the staff handoff ticket / push. */
export function formatRoomChangeStaffSummary(q: RoomChangeQuote): string {
  return (
    `Permintaan pindah kamar ${q.referenceCode} ${q.checkIn}→${q.checkOut}: ` +
    `${q.oldRoomTypeName ?? "?"} → ${q.newRoomTypeName}. Total ${rp(q.oldTotal)} → ${rp(q.newTotal)} ` +
    `(tambahan ${rp(q.extra)}), sudah dibayar ${rp(q.paid)}, sisa ${rp(q.amountDue)}. ` +
    `Ubah via change_booking_room (menghitung ulang total).`
  );
}

function phoneTails(phones: Array<string | null | undefined>): string[] {
  const out = new Set<string>();
  for (const p of phones) {
    const d = String(p ?? "").replace(/\D/g, "");
    if (d.length >= 9) out.add(d.slice(-9));
  }
  return [...out];
}

/**
 * Active (pending/confirmed) bookings whose stay has not ended, for this
 * WhatsApp number. Matches guests on the last 9 digits (08… vs 62…).
 */
export async function loadActiveUpcomingBookings(
  supabase: AnyClient,
  phones: Array<string | null | undefined>,
  today: string,
): Promise<ActiveBookingSnapshot[]> {
  const tails = phoneTails(phones);
  if (tails.length === 0) return [];
  const { data, error } = await supabase
    .from("bookings")
    .select(
      "id, reference_code, check_in, check_out, nights, status, payment_status, total_amount, paid_amount, adults, " +
        "guests(phone), booking_rooms(id, room_id, room_type_id, nightly_rate, extra_bed_count, room_types(name))",
    )
    .in("status", ["pending", "confirmed"])
    .gt("check_out", today)
    .order("check_in", { ascending: true })
    .limit(50);
  if (error) throw new Error(error.message ?? "bookings query failed");
  const rows = (Array.isArray(data) ? data : []) as any[];
  return rows
    .filter((b) => {
      const g = Array.isArray(b.guests) ? b.guests[0] : b.guests;
      const d = String(g?.phone ?? "").replace(/\D/g, "");
      return d.length >= 9 && tails.includes(d.slice(-9));
    })
    .map((b) => toSnapshot(b));
}

export function toSnapshot(b: any): ActiveBookingSnapshot {
  const brs = (Array.isArray(b.booking_rooms) ? b.booking_rooms : []) as any[];
  const nights =
    num(b.nights) > 0
      ? Math.round(num(b.nights))
      : Math.max(1, Math.round((Date.parse(`${b.check_out}T00:00:00Z`) - Date.parse(`${b.check_in}T00:00:00Z`)) / 86400000));
  return {
    id: String(b.id),
    referenceCode: String(b.reference_code ?? ""),
    checkIn: String(b.check_in),
    checkOut: String(b.check_out),
    nights,
    status: String(b.status ?? ""),
    paymentStatus: b.payment_status ?? null,
    totalAmount: num(b.total_amount),
    paidAmount: num(b.paid_amount),
    adults: b.adults == null ? null : num(b.adults),
    rooms: brs.map((r) => {
      const rt = Array.isArray(r.room_types) ? r.room_types[0] : r.room_types;
      return {
        bookingRoomId: r.id ?? null,
        roomTypeId: r.room_type_id ?? null,
        roomTypeName: rt?.name ?? null,
        roomId: r.room_id ?? null,
        nightlyRate: num(r.nightly_rate),
        extraBedCount: num(r.extra_bed_count),
      };
    }),
  };
}

/** Bookings overlapping [checkIn, checkOut) (check-out exclusive). */
export function findOverlappingBooking(
  bookings: ActiveBookingSnapshot[],
  checkIn: string,
  checkOut: string,
): ActiveBookingSnapshot | null {
  return bookings.find((b) => b.checkIn < checkOut && b.checkOut > checkIn) ?? null;
}

/**
 * Full quote: live availability (RPC + stop-sell) and daily rates for the
 * new room type over the booking's existing dates. Extra beds on the booking
 * are re-priced at the new type's extra-bed rate.
 */
export async function computeRoomChangeQuote(
  supabase: AnyClient,
  booking: ActiveBookingSnapshot,
  newRoomType: RoomTypeRow,
): Promise<RoomChangeQuote> {
  const { checkIn, checkOut } = booking;
  const [{ data: availRows }, overrides] = await Promise.all([
    supabase.rpc("room_type_availability_detail", { p_check_in: checkIn, p_check_out: checkOut }),
    getDailyRatesForRange(supabase, [newRoomType.id], checkIn, checkOut),
  ]);
  const row = (Array.isArray(availRows) ? availRows : []).find((r: any) => r.room_type_id === newRoomType.id);
  const resolved = resolveRoomNightlyRates(newRoomType, checkIn, checkOut, overrides.get(newRoomType.id));
  const capped = capAvailabilityWithStopSell(num(row?.available), checkIn, checkOut, overrides.get(newRoomType.id));
  const extraBeds = booking.rooms[0]?.extraBedCount ?? 0;
  const extraBedTotal = extraBeds > 0 ? resolved.nightly.reduce((s, n) => s + n.extrabed_rate, 0) * extraBeds : 0;
  return buildRoomChangeQuote({
    booking,
    newRoomType: { id: newRoomType.id, name: newRoomType.name },
    newTotal: resolved.total + extraBedTotal,
    available: capped.available,
    stopSellDates: capped.stop_sell_dates,
  });
}
