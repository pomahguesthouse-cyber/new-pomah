import type { ToolContext, ToolHandler } from "../types";
import { getDailyRatesForRange, resolveRoomNightlyRates } from "@/services/pricing/daily-rate.service";
import { requiredDepositAmount } from "@/lib/deposit-policy";

const rp = (n: number) => `Rp${Math.round(n).toLocaleString("id-ID")}`;

/** Status pembayaran dari paid vs total (sumber tunggal untuk tool ini). */
export function paymentStatusFor(paid: number, total: number): "paid" | "partial" | "unpaid" {
  if (total > 0 && paid >= total - 0.5) return "paid";
  return paid > 0 ? "partial" : "unpaid";
}

/**
 * Hitung ulang satu baris booking_rooms saat tipe kamar berubah, lalu total
 * booking = Σ(nightly_rate × nights + extra_bed_rate × count × nights).
 */
export function recalcBookingAfterRoomChange(input: {
  nights: number;
  paid: number;
  oldTotal: number;
  rows: Array<{ id: string; nightly_rate: number; extra_bed_rate: number | null; extra_bed_count: number | null }>;
  changedRowId: string;
  newNightlyRate: number;
  newExtraBedRate: number | null;
}) {
  const nights = Math.max(1, Math.round(input.nights));
  const rows = input.rows.map((r) =>
    r.id === input.changedRowId
      ? { ...r, nightly_rate: input.newNightlyRate, extra_bed_rate: input.newExtraBedRate ?? r.extra_bed_rate }
      : r,
  );
  const newTotal = Math.round(
    rows.reduce(
      (s, r) => s + Number(r.nightly_rate) * nights + Number(r.extra_bed_rate ?? 0) * Number(r.extra_bed_count ?? 0) * nights,
      0,
    ),
  );
  const paid = Math.max(0, Math.round(input.paid));
  return {
    newTotal,
    oldTotal: Math.round(input.oldTotal),
    extra: newTotal - Math.round(input.oldTotal),
    paid,
    amountDue: Math.max(0, newTotal - paid),
    requiredNow: Math.max(0, requiredDepositAmount(nights, newTotal) - paid),
    paymentStatus: paymentStatusFor(paid, newTotal),
  };
}

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
    .select("id, reference_code, status, check_in, check_out, nights, total_amount, paid_amount, payment_status, guests(full_name)")
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
    .select("id, room_type_id, nightly_rate, extra_bed_rate, extra_bed_count, rooms(number), room_types(name)")
    .eq("booking_id", booking.id)
    .limit(1)
    .maybeSingle();

  if (brFindErr || !br) {
    return JSON.stringify({ ok: false, error: "Detail kamar booking tidak ditemukan." });
  }

  // Kamar tujuan tidak boleh sedang dipakai booking aktif lain di tanggal itu.
  const { data: clashRows } = await (ctx.supabaseAdmin as any)
    .from("booking_rooms")
    .select("booking_id, bookings!inner(status, check_in, check_out)")
    .eq("room_id", room.id)
    .neq("booking_id", booking.id)
    .in("bookings.status", ["pending", "confirmed", "checked_in"])
    .lt("bookings.check_in", booking.check_out)
    .gt("bookings.check_out", booking.check_in);
  if (Array.isArray(clashRows) && clashRows.length > 0) {
    return JSON.stringify({ ok: false, error: `Kamar ${newRoomNumber} sudah terpakai booking lain di tanggal tersebut.` });
  }

  // Harga dihitung ulang hanya bila TIPE kamar berubah.
  const typeChanged = !!room.room_type_id && room.room_type_id !== br.room_type_id;
  const nights = Math.max(
    1,
    Number(booking.nights) ||
      Math.round((Date.parse(`${booking.check_out}T00:00:00Z`) - Date.parse(`${booking.check_in}T00:00:00Z`)) / 86400000),
  );
  let pricing: ReturnType<typeof recalcBookingAfterRoomChange> | null = null;
  let newNightlyRate = Number(br.nightly_rate ?? 0);
  let newExtraBedRate: number | null = br.extra_bed_rate == null ? null : Number(br.extra_bed_rate);
  if (typeChanged) {
    const rt = (ctx.rooms ?? []).find((r) => r.id === room.room_type_id);
    if (!rt) {
      return JSON.stringify({ ok: false, error: "Tipe kamar tujuan tidak ditemukan untuk menghitung harga." });
    }
    const overrides = await getDailyRatesForRange(ctx.supabaseAdmin as any, [rt.id], booking.check_in, booking.check_out);
    const resolved = resolveRoomNightlyRates(rt, booking.check_in, booking.check_out, overrides.get(rt.id));
    if (resolved.has_stop_sell) {
      return JSON.stringify({
        ok: false,
        error: `${rt.name} stop-sell pada ${resolved.stop_sell_dates.join(", ")}. Buka stop-sell dulu bila tetap ingin dipindah.`,
      });
    }
    newNightlyRate = Math.round(resolved.total / Math.max(1, resolved.nights));
    const ebr = resolved.nightly.reduce((sum, n) => sum + n.extrabed_rate, 0) / Math.max(1, resolved.nights);
    newExtraBedRate = Number(br.extra_bed_count ?? 0) > 0 || br.extra_bed_rate != null ? Math.round(ebr) : null;
    const { data: allRows } = await (ctx.supabaseAdmin as any)
      .from("booking_rooms")
      .select("id, nightly_rate, extra_bed_rate, extra_bed_count")
      .eq("booking_id", booking.id);
    pricing = recalcBookingAfterRoomChange({
      nights,
      paid: Number(booking.paid_amount ?? 0),
      oldTotal: Number(booking.total_amount ?? 0),
      rows: (Array.isArray(allRows) && allRows.length ? allRows : [br]) as any[],
      changedRowId: br.id,
      newNightlyRate,
      newExtraBedRate,
    });
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
      pricing,
      error:
        `Konfirmasi ubah assignment kamar booking ${referenceCode} ke kamar ${newRoomNumber}. ` +
        (pricing
          ? `Tipe kamar berubah: total ${rp(pricing.oldTotal)} → ${rp(pricing.newTotal)} ` +
            `(tambahan ${rp(pricing.extra)}), sudah dibayar ${rp(pricing.paid)}, sisa ${rp(pricing.amountDue)}. `
          : "") +
        `Jika sudah benar, panggil ulang tool dengan confirmed=true.`,
    });
  }

  const { snapshotBookingForDiff, notifyBookingUpdated } = await import(
    "@/services/manager-notifier.service"
  );
  const beforeSnap = await snapshotBookingForDiff(ctx.supabaseAdmin as any, booking.id);

  const { error: updateErr } = await (ctx.supabaseAdmin as any)
    .from("booking_rooms")
    .update(
      typeChanged
        ? { room_id: room.id, room_type_id: room.room_type_id, nightly_rate: newNightlyRate, extra_bed_rate: newExtraBedRate }
        : { room_id: room.id, room_type_id: room.room_type_id },
    )
    .eq("id", br.id);

  if (updateErr) {
    return JSON.stringify({ ok: false, error: updateErr.message });
  }

  if (pricing) {
    const { error: totErr } = await (ctx.supabaseAdmin as any)
      .from("bookings")
      .update({ total_amount: pricing.newTotal, payment_status: pricing.paymentStatus })
      .eq("id", booking.id);
    if (totErr) {
      return JSON.stringify({
        ok: false,
        error: `Kamar sudah dipindah tapi total gagal diperbarui: ${totErr.message}. Perbarui total manual ke ${rp(pricing.newTotal)}.`,
      });
    }
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
    message:
      `Booking ${referenceCode} berhasil diubah ke kamar ${newRoomNumber}.` +
      (pricing
        ? ` Total ${rp(pricing.oldTotal)} → ${rp(pricing.newTotal)} (tambahan ${rp(pricing.extra)}), ` +
          `sudah dibayar ${rp(pricing.paid)}, sisa yang perlu dibayar tamu ${rp(pricing.amountDue)}. ` +
          `Status pembayaran: ${pricing.paymentStatus}. Kirim ulang invoice & info sisa ke tamu bila perlu.`
        : ""),
    pricing,
  });
};
