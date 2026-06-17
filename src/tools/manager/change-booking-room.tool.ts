import type { ToolContext, ToolHandler } from "../types";

export const changeBookingRoom: ToolHandler = async (
  args: Record<string, unknown>,
  ctx:  ToolContext,
): Promise<string> => {
  if (ctx.isManager !== true) {
    return JSON.stringify({
      ok: false,
      error: "Hanya manajer/staf internal yang boleh mengubah assignment kamar booking.",
    });
  }

  const referenceCode = typeof args.reference_code === "string" ? args.reference_code : null;
  const newRoomNumber = typeof args.new_room_number === "string" ? args.new_room_number : null;
  const confirmed = args.confirmed === true;

  if (!referenceCode || !newRoomNumber) {
    return JSON.stringify({ ok: false, error: "reference_code dan new_room_number wajib diisi." });
  }

  const { data: booking, error: findErr } = await (ctx.supabaseAdmin as any)
    .from("bookings")
    .select("id, reference_code, status, check_in, check_out, guests(full_name)")
    .eq("reference_code", referenceCode)
    .maybeSingle();

  if (findErr || !booking) {
    return JSON.stringify({ ok: false, error: "Booking tidak ditemukan." });
  }

  const { data: room, error: roomErr } = await (ctx.supabaseAdmin as any)
    .from("rooms")
    .select("id, room_type_id, number")
    .eq("number", newRoomNumber)
    .maybeSingle();

  if (roomErr || !room) {
    return JSON.stringify({ ok: false, error: `Kamar nomor ${newRoomNumber} tidak ditemukan.` });
  }

  const { data: br, error: brFindErr } = await (ctx.supabaseAdmin as any)
    .from("booking_rooms")
    .select("id, rooms(number), room_types(name)")
    .eq("booking_id", booking.id)
    .limit(1)
    .maybeSingle();

  if (brFindErr || !br) {
    return JSON.stringify({ ok: false, error: "Detail kamar booking tidak ditemukan." });
  }

  if (!confirmed) {
    const guest = Array.isArray(booking.guests) ? booking.guests[0] : booking.guests;
    const currentRoom = Array.isArray(br.rooms) ? br.rooms[0] : br.rooms;
    const currentRoomType = Array.isArray(br.room_types) ? br.room_types[0] : br.room_types;
    return JSON.stringify({
      ok: false,
      needs_confirmation: true,
      action: "change_booking_room",
      target: {
        reference_code: booking.reference_code,
        guest_name: guest?.full_name ?? null,
        check_in: booking.check_in,
        check_out: booking.check_out,
        current_room: currentRoom?.number ?? null,
        current_room_type: currentRoomType?.name ?? null,
        new_room_number: newRoomNumber,
      },
      error:
        `Konfirmasi ubah assignment kamar booking ${referenceCode} ke kamar ${newRoomNumber}. ` +
        `Jika sudah benar, panggil ulang tool dengan confirmed=true.`,
    });
  }

  const { snapshotBookingForDiff, notifyBookingUpdated } = await import(
    "@/services/manager-notifier.service"
  );
  const beforeSnap = await snapshotBookingForDiff(ctx.supabaseAdmin as any, booking.id);

  const { error: updateErr } = await (ctx.supabaseAdmin as any)
    .from("booking_rooms")
    .update({ room_id: room.id, room_type_id: room.room_type_id })
    .eq("id", br.id);

  if (updateErr) {
    return JSON.stringify({ ok: false, error: updateErr.message });
  }

  try {
    const afterSnap = await snapshotBookingForDiff(ctx.supabaseAdmin as any, booking.id);
    await notifyBookingUpdated(
      ctx.supabaseAdmin as any,
      booking.id,
      beforeSnap,
      afterSnap,
      "Manager (chat)",
    );
  } catch (e) {
    console.error(`[change_booking_room] notifyBookingUpdated gagal untuk ${booking.id}:`, e);
  }

  return JSON.stringify({
    ok: true,
    message: `Booking ${referenceCode} berhasil diubah ke kamar ${newRoomNumber}.`,
  });
};
