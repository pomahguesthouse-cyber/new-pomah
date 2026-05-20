import type { ToolContext, ToolHandler } from "../types";

export const changeBookingRoom: ToolHandler = async (
  args: Record<string, unknown>,
  ctx:  ToolContext,
): Promise<string> => {
  const referenceCode = typeof args.reference_code === "string" ? args.reference_code : null;
  const newRoomNumber = typeof args.new_room_number === "string" ? args.new_room_number : null;

  if (!referenceCode || !newRoomNumber) {
    return JSON.stringify({ ok: false, error: "reference_code dan new_room_number wajib diisi." });
  }

  // Find booking
  const { data: booking, error: findErr } = await (ctx.supabaseAdmin as any)
    .from("bookings")
    .select("id")
    .eq("reference_code", referenceCode)
    .maybeSingle();

  if (findErr || !booking) {
    return JSON.stringify({ ok: false, error: "Booking tidak ditemukan." });
  }

  // Find new room
  const { data: room, error: roomErr } = await (ctx.supabaseAdmin as any)
    .from("rooms")
    .select("id, room_type_id")
    .eq("number", newRoomNumber)
    .maybeSingle();

  if (roomErr || !room) {
    return JSON.stringify({ ok: false, error: `Kamar nomor ${newRoomNumber} tidak ditemukan.` });
  }

  // Update booking_rooms (assuming 1 room per booking for simplicity in chat)
  const { data: br, error: brFindErr } = await (ctx.supabaseAdmin as any)
    .from("booking_rooms")
    .select("id")
    .eq("booking_id", booking.id)
    .limit(1)
    .maybeSingle();

  if (brFindErr || !br) {
    return JSON.stringify({ ok: false, error: "Detail kamar booking tidak ditemukan." });
  }

  const { error: updateErr } = await (ctx.supabaseAdmin as any)
    .from("booking_rooms")
    .update({ room_id: room.id, room_type_id: room.room_type_id })
    .eq("id", br.id);

  if (updateErr) {
    return JSON.stringify({ ok: false, error: updateErr.message });
  }

  return JSON.stringify({
    ok: true,
    message: `Booking ${referenceCode} berhasil dipindahkan ke kamar ${newRoomNumber}.`,
  });
};
