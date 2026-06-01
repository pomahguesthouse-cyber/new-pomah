/**
 * Tool: check_room_availability
 *
 * Queries real-time room availability from the database and returns a
 * structured JSON payload the LLM formats into a human-readable reply.
 */

import { isDateString, nextDay, fmtDateID } from "@/lib/date";
import type { ToolContext, ToolHandler } from "./types";

interface AvailabilityRow {
  room_type_id: string;
  total:        number;
  taken:        number;
  available:    number;
}

export const checkRoomAvailability: ToolHandler = async (
  args: Record<string, unknown>,
  ctx:  ToolContext,
): Promise<string> => {
  if (!isDateString(args.check_in)) {
    // Jangan fallback ke "hari ini" jika tamu belum pernah menyebut tanggal.
    // Minta agen mengonfirmasi tanggal lebih dulu agar booking tidak salah tanggal.
    return JSON.stringify({
      ok: false,
      need_dates: true,
      error:
        "Tanggal check-in belum diketahui. Tanyakan dulu kepada tamu: " +
        "'Untuk tanggal berapa Kak rencana menginap, dan sampai tanggal berapa?' " +
        "Jangan asumsikan hari ini. Setelah tamu menjawab, panggil ulang tool ini dengan tanggal yang benar.",
    });
  }

  const checkIn  = args.check_in as string;
  let   checkOut = isDateString(args.check_out) ? (args.check_out as string) : nextDay(checkIn);
  if (checkOut <= checkIn) checkOut = nextDay(checkIn);

  // Catat tanggal yang dipakai supaya orchestrator bisa menyimpannya ke slots
  // — turn berikutnya tidak akan kehilangan konteks tanggal.
  ctx.lastDates = { checkIn, checkOut };

  const { data: rows } = await (ctx.supabasePublic as any).rpc(
    "room_type_availability_detail",
    { p_check_in: checkIn, p_check_out: checkOut },
  );

  const byId = new Map<string, AvailabilityRow>(
    ((rows ?? []) as AvailabilityRow[]).map((r) => [r.room_type_id, r]),
  );

  const kamar = ctx.rooms.map((r) => {
    const d = byId.get(r.id);
    return {
      nama:             r.name,
      harga_per_malam:  Number(r.base_rate ?? 0),
      kamar_tersedia:   d ? d.available : null,
      total_kamar:      d ? d.total    : null,
      catatan:          d ? undefined  : "jumlah kamar belum diatur di sistem",
    };
  });

  return JSON.stringify({
    check_in:  checkIn,
    check_out: checkOut,
    tanggal:   fmtDateID(checkIn),
    periode:   `${fmtDateID(checkIn)} – ${fmtDateID(checkOut)}`,
    kamar,
  });
};
