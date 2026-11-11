import { fmtDateID } from "@/lib/date";
import type { ToolContext, ToolHandler } from "../types";
import { roleCanUseTool, unauthorizedToolMessage } from "@/services/manager-chat/rbac";

/**
 * Ringkasan okupansi harian: kamar terisi vs kosong, check-in/out, % hunian.
 */
export const getOccupancySummary: ToolHandler = async (args, ctx): Promise<string> => {
  if (ctx.isManager !== true) {
    return JSON.stringify({ ok: false, error: "Hanya staf terdaftar yang boleh melihat okupansi." });
  }
  if (!roleCanUseTool(ctx.managerRole, "get_occupancy_summary")) {
    return JSON.stringify({ ok: false, error: unauthorizedToolMessage(ctx.managerRole, "get_occupancy_summary") });
  }

  const today = typeof ctx.today === "string" ? ctx.today : new Date().toISOString().slice(0, 10);
  const date = typeof args.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(args.date) ? args.date : today;

  const { data: rooms, error: roomsErr } = await (ctx.supabaseAdmin as any)
    .from("rooms")
    .select("id, number, room_type_id, room_types(name)")
    .order("number");
  if (roomsErr) return JSON.stringify({ ok: false, error: roomsErr.message });

  const roomRows = (rooms ?? []) as Array<{
    id: string;
    number: string;
    room_type_id: string;
    room_types?: { name?: string } | Array<{ name?: string }>;
  }>;

  const { data: bookings, error: bookErr } = await (ctx.supabaseAdmin as any)
    .from("bookings")
    .select(`
      id, reference_code, check_in, check_out, status,
      guests ( full_name ),
      booking_rooms ( room_id, room_types ( name ), rooms ( number ) )
    `)
    .in("status", ["pending", "confirmed", "checked_in"])
    .lte("check_in", date)
    .gt("check_out", date);
  if (bookErr) return JSON.stringify({ ok: false, error: bookErr.message });

  const occupiedIds = new Set<string>();
  const occupied: Array<{ room: string; guest: string; ref: string; stay: string }> = [];
  for (const booking of bookings ?? []) {
    const guest = Array.isArray(booking.guests) ? booking.guests[0] : booking.guests;
    for (const br of booking.booking_rooms ?? []) {
      if (br.room_id) occupiedIds.add(br.room_id);
      const roomName = br.rooms?.number ?? br.room_types?.name ?? "Kamar";
      occupied.push({
        room: String(roomName),
        guest: guest?.full_name ?? "Tamu",
        ref: booking.reference_code,
        stay: `${fmtDateID(booking.check_in)} – ${fmtDateID(booking.check_out)}`,
      });
    }
  }

  const vacant = roomRows
    .filter((room) => !occupiedIds.has(room.id))
    .map((room) => {
      const type = Array.isArray(room.room_types) ? room.room_types[0] : room.room_types;
      return { number: room.number, room_type: type?.name ?? "Kamar" };
    });

  const { data: arrivals } = await (ctx.supabaseAdmin as any)
    .from("bookings")
    .select("id")
    .eq("check_in", date)
    .not("status", "in", "(cancelled,expired)");
  const { data: departures } = await (ctx.supabaseAdmin as any)
    .from("bookings")
    .select("id")
    .eq("check_out", date)
    .not("status", "in", "(cancelled)");

  const totalRooms = roomRows.length;
  const occupiedCount = occupiedIds.size;
  const pct = totalRooms > 0 ? Math.round((occupiedCount / totalRooms) * 100) : 0;

  return JSON.stringify({
    ok: true,
    date,
    date_label: fmtDateID(date),
    total_rooms: totalRooms,
    occupied_count: occupiedCount,
    vacant_count: vacant.length,
    occupancy_pct: pct,
    arrivals: (arrivals ?? []).length,
    departures: (departures ?? []).length,
    occupied,
    vacant,
  });
};
