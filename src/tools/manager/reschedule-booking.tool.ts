/**
 * Tool: reschedule_booking
 *
 * Mengubah tanggal check-in / check-out sebuah booking. Menghitung ulang
 * nights dan total_amount berdasarkan nightly_rate yang sudah tersimpan
 * di booking_rooms (tidak me-recalculate seasonal / dynamic pricing —
 * itu keputusan revenue manajer). Menggunakan alur two-step confirmation
 * yang sama seperti update_booking_status / delete_booking.
 */

import type { ToolContext, ToolHandler } from "../types";

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function daysBetween(inIso: string, outIso: string): number {
  const a = new Date(inIso + "T00:00:00Z").getTime();
  const b = new Date(outIso + "T00:00:00Z").getTime();
  return Math.max(1, Math.round((b - a) / (24 * 3600 * 1000)));
}

export const rescheduleBooking: ToolHandler = async (
  args: Record<string, unknown>,
  ctx:  ToolContext,
): Promise<string> => {
  if (ctx.isManager !== true) {
    return JSON.stringify({
      ok: false,
      error: "Hanya manajer/staf internal yang boleh mereschedule booking.",
    });
  }

  const refCode  = str(args.reference_code);
  const newIn    = str(args.new_check_in);
  const newOut   = str(args.new_check_out);
  const confirmed = args.confirmed === true;

  if (!refCode || !newIn) {
    return JSON.stringify({
      ok: false,
      error: "reference_code dan new_check_in wajib diisi (YYYY-MM-DD).",
    });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(newIn) || (newOut && !/^\d{4}-\d{2}-\d{2}$/.test(newOut))) {
    return JSON.stringify({ ok: false, error: "Format tanggal harus YYYY-MM-DD." });
  }

  const { data: booking, error: findErr } = await (ctx.supabaseAdmin as any)
    .from("bookings")
    .select("id, reference_code, status, check_in, check_out, nights, total_amount, guests(full_name), booking_rooms(id, nightly_rate)")
    .eq("reference_code", refCode)
    .maybeSingle();

  if (findErr || !booking) {
    return JSON.stringify({ ok: false, error: `Booking ${refCode} tidak ditemukan.` });
  }

  const effectiveOut = newOut || (() => {
    const d = new Date(newIn + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() + Number(booking.nights || 1));
    return d.toISOString().slice(0, 10);
  })();

  const nights = daysBetween(newIn, effectiveOut);
  const rooms = Array.isArray(booking.booking_rooms) ? booking.booking_rooms : [];
  const nightlySum = rooms.reduce((sum: number, br: any) => sum + Number(br.nightly_rate || 0), 0);
  const newTotal = nightlySum * nights;

  if (!confirmed) {
    const guest = Array.isArray(booking.guests) ? booking.guests[0] : booking.guests;
    return JSON.stringify({
      ok: false,
      needs_confirmation: true,
      action: "reschedule_booking",
      target: {
        reference_code: booking.reference_code,
        guest_name: guest?.full_name ?? null,
        old_check_in: booking.check_in,
        old_check_out: booking.check_out,
        old_nights: booking.nights,
        old_total: booking.total_amount,
        new_check_in: newIn,
        new_check_out: effectiveOut,
        new_nights: nights,
        new_total: newTotal,
      },
      error:
        `Konfirmasi reschedule ${refCode}: ${booking.check_in} → ${newIn} s/d ${effectiveOut} ` +
        `(${nights} malam, total Rp${newTotal.toLocaleString("id-ID")}). ` +
        `Balas "ya" atau panggil ulang tool dengan confirmed=true.`,
    });
  }

  const { error: updErr } = await (ctx.supabaseAdmin as any)
    .from("bookings")
    .update({
      check_in:     newIn,
      check_out:    effectiveOut,
      nights,
      total_amount: newTotal,
    })
    .eq("id", booking.id);

  if (updErr) {
    return JSON.stringify({ ok: false, error: `Gagal update: ${updErr.message}` });
  }

  return JSON.stringify({
    ok: true,
    reference_code: booking.reference_code,
    check_in:  newIn,
    check_out: effectiveOut,
    nights,
    total_amount: newTotal,
    message: `Booking ${refCode} berhasil di-reschedule ke ${newIn} → ${effectiveOut} (${nights} malam).`,
  });
};
