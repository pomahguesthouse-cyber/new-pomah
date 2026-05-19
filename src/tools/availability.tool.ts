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
  const checkIn  = isDateString(args.check_in)  ? args.check_in  : ctx.today;
  let   checkOut = isDateString(args.check_out) ? args.check_out : nextDay(checkIn);
  if (checkOut <= checkIn) checkOut = nextDay(checkIn);

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
