import type { ToolContext, ToolHandler } from "../types";

export const updateBookingStatus: ToolHandler = async (
  args: Record<string, unknown>,
  ctx:  ToolContext,
): Promise<string> => {
  const referenceCode = typeof args.reference_code === "string" ? args.reference_code : null;
  const newStatus = typeof args.status === "string" ? args.status : null;

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
    .select("id, status")
    .eq("reference_code", referenceCode)
    .maybeSingle();

  if (findErr || !booking) {
    return JSON.stringify({ ok: false, error: "Booking tidak ditemukan." });
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
