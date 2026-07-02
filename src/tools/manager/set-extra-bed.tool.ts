import type { ToolContext, ToolHandler } from "../types";

/**
 * Manager-only. Set/add/remove extra beds on a booking.
 *
 * Contoh perintah manajer:
 *   "di booking PMH-002 tambahkan extrabed di kamar Family Suite 100"
 *   "set extra bed 2 di booking PMH-003 kamar Deluxe"
 *   "hapus extra bed di booking PMH-002 kamar 100"
 *
 * Kamar boleh disebutkan lewat nomor kamar ("100") atau nama tipe ("Family Suite").
 * Extra bed dipasang pada BARIS booking_rooms yang cocok (nomor kamar diprioritaskan
 * di atas nama tipe untuk menghindari ambigu bila 1 booking punya beberapa kamar
 * dari tipe yang sama).
 */
export const setExtraBed: ToolHandler = async (
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<string> => {
  if (ctx.isManager !== true) {
    return JSON.stringify({
      ok: false,
      error: "Hanya manajer/staf internal yang boleh mengubah extra bed booking.",
    });
  }

  const referenceCode =
    typeof args.reference_code === "string" ? args.reference_code.trim() : null;
  const roomNumber =
    typeof args.room_number === "string" ? args.room_number.trim() : null;
  const roomTypeName =
    typeof args.room_type === "string" ? args.room_type.trim() : null;
  const rawMode = typeof args.mode === "string" ? args.mode.toLowerCase().trim() : "add";
  // Accept Indonesian & English aliases from the LLM:
  //   add / tambah / plus         → add
  //   set                          → set
  //   remove / kurangi / minus     → remove
  //   clear / reset / zero / hapus / hapus semua → set count=0
  let mode: "set" | "add" | "remove";
  let count: number;
  if (["clear", "reset", "zero", "hapus", "hapus semua", "kosongkan"].includes(rawMode)) {
    mode = "set";
    count = 0;
  } else if (["remove", "kurangi", "minus", "kurang"].includes(rawMode)) {
    mode = "remove";
    count = Math.max(
      0,
      Math.floor(typeof args.count === "number" ? args.count : 1),
    );
  } else if (rawMode === "set") {
    mode = "set";
    count = Math.max(0, Math.floor(typeof args.count === "number" ? args.count : 0));
  } else {
    mode = "add";
    count = Math.max(
      1,
      Math.floor(typeof args.count === "number" ? args.count : 1),
    );
  }
  const confirmed = args.confirmed === true;

  if (!referenceCode) {
    return JSON.stringify({ ok: false, error: "reference_code wajib diisi." });
  }
  if (!roomNumber && !roomTypeName) {
    return JSON.stringify({
      ok: false,
      error: "Sebutkan room_number ATAU room_type kamar yang akan dipasangi extra bed.",
    });
  }

  const supabase = ctx.supabaseAdmin as any;

  // 1. Resolve booking
  const { data: booking, error: bookingErr } = await supabase
    .from("bookings")
    .select("id, reference_code, status, check_in, check_out")
    .eq("reference_code", referenceCode)
    .maybeSingle();
  if (bookingErr || !booking) {
    return JSON.stringify({ ok: false, error: `Booking ${referenceCode} tidak ditemukan.` });
  }

  // 2. Load booking_rooms
  const { data: rows, error: brErr } = await supabase
    .from("booking_rooms")
    .select(
      "id, extra_bed_count, extra_bed_rate, rooms(number), room_types(id,name,extrabed_capacity,extrabed_rate)",
    )
    .eq("booking_id", booking.id);
  if (brErr || !rows || rows.length === 0) {
    return JSON.stringify({ ok: false, error: "Kamar booking tidak ditemukan." });
  }

  type Row = {
    id: string;
    extra_bed_count: number | null;
    extra_bed_rate: number | null;
    rooms: { number?: string } | { number?: string }[] | null;
    room_types:
      | {
          id: string;
          name: string;
          extrabed_capacity?: number | null;
          extrabed_rate?: number | null;
        }
      | {
          id: string;
          name: string;
          extrabed_capacity?: number | null;
          extrabed_rate?: number | null;
        }[]
      | null;
  };
  const list = rows as Row[];
  const one = <T,>(v: T | T[] | null | undefined): T | null =>
    Array.isArray(v) ? v[0] ?? null : v ?? null;

  // 3. Match target row
  const matches = list.filter((r) => {
    const room = one(r.rooms);
    const type = one(r.room_types);
    const nMatch =
      !!roomNumber && !!room?.number && room.number.toLowerCase() === roomNumber.toLowerCase();
    const tMatch =
      !!roomTypeName &&
      !!type?.name &&
      type.name.toLowerCase().includes(roomTypeName.toLowerCase());
    return roomNumber ? nMatch : tMatch;
  });

  if (matches.length === 0) {
    return JSON.stringify({
      ok: false,
      error: `Tidak menemukan kamar '${roomNumber ?? roomTypeName}' di booking ${referenceCode}.`,
    });
  }
  if (matches.length > 1) {
    return JSON.stringify({
      ok: false,
      error:
        `Ada ${matches.length} kamar cocok di booking ${referenceCode}. ` +
        "Sebutkan room_number spesifik (mis. '100') untuk kejelasan.",
      candidates: matches.map((m) => ({
        room_number: one(m.rooms)?.number ?? null,
        room_type: one(m.room_types)?.name ?? null,
      })),
    });
  }

  const target = matches[0];
  const type = one(target.room_types);
  const room = one(target.rooms);
  const capPerRoom = Number(type?.extrabed_capacity ?? 0);
  const rate = Number(type?.extrabed_rate ?? target.extra_bed_rate ?? 0);
  const current = Number(target.extra_bed_count ?? 0);

  const nextCount =
    mode === "set" ? count : mode === "add" ? current + count : Math.max(0, current - count);

  if (capPerRoom > 0 && nextCount > capPerRoom) {
    return JSON.stringify({
      ok: false,
      error:
        `Extra bed maksimum untuk ${type?.name ?? "kamar ini"} adalah ${capPerRoom} unit ` +
        `per kamar. Diminta: ${nextCount}.`,
    });
  }
  if (nextCount > 0 && rate <= 0) {
    return JSON.stringify({
      ok: false,
      error: `Tipe kamar ${type?.name ?? ""} belum punya tarif extra bed. Set dulu di Rooms.`,
    });
  }

  // 4. Confirmation gate (only for meaningful changes)
  if (!confirmed && nextCount !== current) {
    return JSON.stringify({
      ok: false,
      needs_confirmation: true,
      action: "set_extra_bed",
      target: {
        reference_code: booking.reference_code,
        room_number: room?.number ?? null,
        room_type: type?.name ?? null,
        current_extra_beds: current,
        new_extra_beds: nextCount,
        extra_bed_rate: rate,
      },
      error:
        `Konfirmasi ubah extra bed di booking ${referenceCode} kamar ${room?.number ?? type?.name} ` +
        `dari ${current} → ${nextCount} (Rp ${rate.toLocaleString("id-ID")}/malam). ` +
        `Panggil ulang tool dengan confirmed=true jika benar.`,
    });
  }

  if (nextCount === current) {
    return JSON.stringify({
      ok: true,
      message: `Extra bed di booking ${referenceCode} sudah ${current}. Tidak ada perubahan.`,
    });
  }

  // 5. Snapshot for notifier
  const { snapshotBookingForDiff, notifyBookingUpdated } = await import(
    "@/services/manager-notifier.service"
  );
  const beforeSnap = await snapshotBookingForDiff(supabase, booking.id);

  // 6. Update booking_rooms + recompute booking total
  const { error: updRowErr } = await supabase
    .from("booking_rooms")
    .update({ extra_bed_count: nextCount, extra_bed_rate: rate })
    .eq("id", target.id);
  if (updRowErr) {
    return JSON.stringify({ ok: false, error: updRowErr.message });
  }

  // Recalculate total (base rate × nights + extra_bed_rate × count × nights) using
  // fresh booking_rooms after the update.
  const nights = Math.max(
    1,
    Math.round(
      (new Date(booking.check_out).getTime() - new Date(booking.check_in).getTime()) /
        86_400_000,
    ),
  );
  const { data: freshRows } = await supabase
    .from("booking_rooms")
    .select("nightly_rate, extra_bed_count, extra_bed_rate")
    .eq("booking_id", booking.id);
  const newTotal = (freshRows ?? []).reduce(
    (s: number, r: { nightly_rate: number; extra_bed_count: number; extra_bed_rate: number }) =>
      s +
      Number(r.nightly_rate) * nights +
      Number(r.extra_bed_rate ?? 0) * Number(r.extra_bed_count ?? 0) * nights,
    0,
  );
  await supabase.from("bookings").update({ total_amount: newTotal }).eq("id", booking.id);

  try {
    const afterSnap = await snapshotBookingForDiff(supabase, booking.id);
    await notifyBookingUpdated(supabase, booking.id, beforeSnap, afterSnap, "Manager (chat)");
  } catch (e) {
    console.error(`[set_extra_bed] notifyBookingUpdated gagal ${booking.id}:`, e);
  }

  const delta = nextCount - current;
  const verb = delta > 0 ? `menambahkan ${delta}` : `mengurangi ${Math.abs(delta)}`;
  return JSON.stringify({
    ok: true,
    message:
      `Booking ${referenceCode}: ${verb} extra bed di kamar ${room?.number ?? type?.name}. ` +
      `Total extra bed sekarang ${nextCount} × ${nights} malam (Rp ${rate.toLocaleString("id-ID")}/malam). ` +
      `Total booking baru: Rp ${newTotal.toLocaleString("id-ID")}.`,
    booking: {
      reference_code: booking.reference_code,
      room_number: room?.number ?? null,
      extra_beds: nextCount,
      extra_bed_rate: rate,
      nights,
      total_amount: newTotal,
    },
  });
};
