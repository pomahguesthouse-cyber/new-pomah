import type { ToolContext, ToolHandler } from "../types";

export const updateBookingStatus: ToolHandler = async (
  args: Record<string, unknown>,
  ctx:  ToolContext,
): Promise<string> => {
  if (ctx.isManager !== true) {
    return JSON.stringify({
      ok: false,
      error: "Hanya manajer/staf internal yang boleh mengubah status booking.",
    });
  }

  const referenceCode = typeof args.reference_code === "string" ? args.reference_code : null;
  const newStatus = typeof args.status === "string" ? args.status : null;
  const confirmed = args.confirmed === true;

  if (!referenceCode || !newStatus) {
    return JSON.stringify({ ok: false, error: "reference_code dan status wajib diisi." });
  }

  // Allowed statuses
  const validStatuses = ["pending", "confirmed", "checked_in", "checked_out", "cancelled"];
  if (!validStatuses.includes(newStatus)) {
    return JSON.stringify({ ok: false, error: `Status tidak valid. Harus salah satu dari: ${validStatuses.join(", ")}` });
  }

  const { data: booking, error: findErr } = await (ctx.supabaseAdmin as any)
    .from("bookings")
    .select("id, reference_code, status, check_in, check_out, guests(full_name)")
    .eq("reference_code", referenceCode)
    .maybeSingle();

  if (findErr || !booking) {
    return JSON.stringify({ ok: false, error: "Booking tidak ditemukan." });
  }

  if (!confirmed) {
    const guest = Array.isArray(booking.guests) ? booking.guests[0] : booking.guests;
    return JSON.stringify({
      ok: false,
      needs_confirmation: true,
      action: "update_booking_status",
      target: {
        reference_code: booking.reference_code,
        guest_name: guest?.full_name ?? null,
        check_in: booking.check_in,
        check_out: booking.check_out,
        current_status: booking.status,
        new_status: newStatus,
      },
      error:
        `Konfirmasi perubahan status booking ${referenceCode}: ${booking.status} → ${newStatus}. ` +
        `Jika sudah benar, panggil ulang tool dengan confirmed=true.`,
    });
  }

  const { error: updateErr } = await (ctx.supabaseAdmin as any)
    .from("bookings")
    .update({ status: newStatus })
    .eq("id", booking.id);

  if (updateErr) {
    return JSON.stringify({ ok: false, error: updateErr.message });
  }

  return JSON.stringify({
    ok: true,
    message: `Booking ${referenceCode} berhasil diubah dari ${booking.status} menjadi ${newStatus}.`,
  });
};
