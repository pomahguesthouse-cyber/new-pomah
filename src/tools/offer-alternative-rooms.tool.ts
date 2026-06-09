/**
 * Tool: offer_alternative_rooms
 *
 * Dipanggil oleh Front Office Agent saat `check_room_availability`
 * menunjukkan tipe kamar yang DIMINTA tamu PENUH, tapi ada alternatif
 * tipe lain yang tersedia di tanggal yang sama.
 *
 * Efek:
 *   1. Set booking state ke AWAITING_ALTERNATIVE_ROOM_TYPE.
 *   2. Simpan tanggal, jumlah tamu, requestedRoomType, dan
 *      availableAlternatives ke context — state machine akan mengambil
 *      alih turn-turn berikutnya.
 *   3. Kembalikan pesan formatted untuk dikirim VERBATIM ke tamu.
 *
 * State machine setelah ini menerima respons tamu: kalau valid alternative
 * dipilih → lanjut ke AWAITING_NAME / CONFIRMING_NAME. Kalau tamu kirim
 * nama/email/HP, simpan partial info tapi tetap minta pilih kamar.
 */

import { isDateString } from "@/lib/date";
import {
  updateBookingState,
  formatAlternativesList,
  type BookingContext,
  type AlternativeRoomOption,
} from "@/ai/state-machine/booking-machine";
import type { ToolContext, ToolHandler } from "./types";

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

export const offerAlternativeRooms: ToolHandler = async (
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<string> => {
  if (!ctx.phone) {
    return JSON.stringify({ ok: false, error: "Nomor kontak tamu tidak tersedia." });
  }

  const requestedRoomType = str(args.requested_room_type);
  const checkIn  = isDateString(args.check_in)  ? (args.check_in  as string) : "";
  const checkOut = isDateString(args.check_out) ? (args.check_out as string) : "";
  const adults   = Math.max(1, Math.min(8, Number(args.adults) || 1));
  const children = Math.max(0, Math.min(8, Number(args.children) || 0));
  const guestName = str(args.guest_name);

  if (!requestedRoomType) {
    return JSON.stringify({ ok: false, error: "requested_room_type wajib diisi." });
  }
  if (!checkIn || !checkOut) {
    return JSON.stringify({ ok: false, error: "check_in dan check_out wajib diisi." });
  }

  const rawAlts = Array.isArray(args.alternatives) ? args.alternatives : [];
  const alternatives: AlternativeRoomOption[] = [];
  for (const item of rawAlts) {
    if (!item || typeof item !== "object") continue;
    const rawName = str((item as Record<string, unknown>).room_type);
    if (!rawName) continue;
    const rt = ctx.rooms.find(
      (r) =>
        r.name.toLowerCase() === rawName.toLowerCase() ||
        r.name.toLowerCase().includes(rawName.toLowerCase()) ||
        rawName.toLowerCase().includes(r.name.toLowerCase()),
    );
    if (!rt) continue;
    const provided = Number((item as Record<string, unknown>).price_per_night);
    const price = Number.isFinite(provided) && provided > 0
      ? Math.floor(provided)
      : Number(rt.base_rate ?? 0);
    if (alternatives.some((a) => a.roomTypeId === rt.id)) continue;
    alternatives.push({
      roomTypeId:    rt.id,
      name:          rt.name,
      pricePerNight: price,
    });
  }

  if (alternatives.length === 0) {
    return JSON.stringify({
      ok: false,
      error: "Tidak ada alternatif kamar valid yang bisa ditawarkan.",
    });
  }

  const context: BookingContext = {
    checkIn,
    checkOut,
    adults,
    children,
    requestedRoomType,
    availableAlternatives: alternatives,
  };
  if (guestName.length >= 2) context.guestName = guestName;

  ctx.lastDates = { checkIn, checkOut };

  await updateBookingState(
    ctx.supabasePublic,
    ctx.phone,
    "AWAITING_ALTERNATIVE_ROOM_TYPE",
    context,
  );

  const list = formatAlternativesList(alternatives);
  const message =
    `Mohon maaf Kak, kamar ${requestedRoomType} penuh untuk tanggal tersebut. ` +
    `Kamar yang tersedia:\n${list}\n\n` +
    `Kakak bisa balas salah satu nama kamar di atas.`;

  return JSON.stringify({ ok: true, relay_verbatim: true, message });
};
