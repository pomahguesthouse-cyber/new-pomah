/**
 * Tool: delete_booking
 *
 * Hapus/batalkan booking dari kanal manajerial. Manajer cukup sebut nama
 * tamu atau kode booking; tool resolve sendiri.
 *
 * Default `mode = 'cancel'` (soft): set bookings.status = 'cancelled'.
 * Aman, masih terlihat di laporan, slot kamar dibebaskan otomatis karena
 * query availability hanya menghitung status pending/confirmed/checked_in.
 *
 * Mode `'hard'`: benar-benar DELETE row bookings (dan booking_rooms cascade).
 * Hanya pakai bila manajer eksplisit minta "hapus permanen" / "delete data".
 *
 * Resolusi:
 *  - reference_code → exact match, paling akurat.
 *  - guest_name → cari di guests.full_name (ilike). Bila 0 atau >1 cocok,
 *    return daftar untuk manajer pilih.
 *
 * Guards:
 *  - ctx.isManager === true.
 *  - Booking yang sudah checked_out ditolak (jangan ubah riwayat).
 */

import type { ToolContext, ToolHandler } from "@/tools/types";

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

interface BookingHit {
  id:             string;
  reference_code: string;
  status:         string;
  check_in:       string;
  check_out:      string;
  guest_name:     string;
}

async function lookupByRef(
  ctx: ToolContext,
  refCode: string,
): Promise<BookingHit | null> {
  const { data } = await (ctx.supabaseAdmin as any)
    .from("bookings")
    .select("id, reference_code, status, check_in, check_out, guests(full_name)")
    .eq("reference_code", refCode)
    .maybeSingle();
  if (!data) return null;
  const guest = Array.isArray(data.guests) ? data.guests[0] : data.guests;
  return {
    id:             data.id,
    reference_code: data.reference_code,
    status:         data.status,
    check_in:       data.check_in,
    check_out:      data.check_out,
    guest_name:     guest?.full_name ?? "",
  };
}

async function lookupByName(
  ctx: ToolContext,
  name: string,
): Promise<BookingHit[]> {
  // Step 1: find guests matching the name.
  const { data: guests } = await (ctx.supabaseAdmin as any)
    .from("guests")
    .select("id, full_name")
    .ilike("full_name", `%${name}%`)
    .limit(20);
  const guestRows = (guests ?? []) as Array<{ id: string; full_name: string }>;
  if (guestRows.length === 0) return [];

  // Step 2: their non-final bookings (exclude checked_out + cancelled by default).
  const guestIds = guestRows.map((g) => g.id);
  const { data: bookings } = await (ctx.supabaseAdmin as any)
    .from("bookings")
    .select("id, reference_code, status, check_in, check_out, guest_id")
    .in("guest_id", guestIds)
    .in("status", ["pending", "confirmed", "checked_in"])
    .order("created_at", { ascending: false });

  const bookingRows = (bookings ?? []) as Array<{
    id: string; reference_code: string; status: string;
    check_in: string; check_out: string; guest_id: string;
  }>;
  const guestName = (id: string) => guestRows.find((g) => g.id === id)?.full_name ?? "";
  return bookingRows.map((b) => ({
    id:             b.id,
    reference_code: b.reference_code,
    status:         b.status,
    check_in:       b.check_in,
    check_out:      b.check_out,
    guest_name:     guestName(b.guest_id),
  }));
}

export const deleteBooking: ToolHandler = async (
  args: Record<string, unknown>,
  ctx:  ToolContext,
): Promise<string> => {
  if (ctx.isManager !== true) {
    return JSON.stringify({
      ok: false,
      error: "Hanya manajer/super admin yang boleh menghapus/membatalkan booking.",
    });
  }

  const refCode    = str(args.reference_code);
  const guestName  = str(args.guest_name);
  const modeRaw    = str(args.mode).toLowerCase();
  const mode: "cancel" | "hard" = modeRaw === "hard" ? "hard" : "cancel";
  const confirmed  = args.confirmed === true;

  if (!refCode && !guestName) {
    return JSON.stringify({
      ok: false,
      error: "Sebutkan reference_code atau guest_name booking yang mau dihapus.",
    });
  }

  // ── Resolve target booking(s) ────────────────────────────────────────────
  let target: BookingHit | null = null;
  if (refCode) {
    target = await lookupByRef(ctx, refCode);
    if (!target) {
      return JSON.stringify({
        ok:    false,
        error: `Booking dengan kode "${refCode}" tidak ditemukan.`,
      });
    }
  } else {
    const hits = await lookupByName(ctx, guestName);
    if (hits.length === 0) {
      return JSON.stringify({
        ok:    false,
        error: `Tidak ada booking aktif (pending/confirmed/checked_in) untuk tamu yang ` +
               `cocok dengan "${guestName}". Bila booking sudah cancelled atau checked_out, ` +
               `cari pakai reference_code spesifik.`,
      });
    }
    if (hits.length > 1) {
      return JSON.stringify({
        ok:                false,
        needs_disambiguation: true,
        candidates:        hits.map((h) => ({
          reference_code: h.reference_code,
          guest_name:     h.guest_name,
          status:         h.status,
          check_in:       h.check_in,
          check_out:      h.check_out,
        })),
        error:
          `Ada ${hits.length} booking aktif yang cocok dengan "${guestName}". ` +
          `Sebutkan reference_code yang spesifik atau tambah detail (tanggal/tipe kamar).`,
      });
    }
    target = hits[0];
  }

  // ── Refuse final-state bookings ──────────────────────────────────────────
  if (target.status === "checked_out") {
    return JSON.stringify({
      ok:    false,
      error: `Booking ${target.reference_code} (${target.guest_name}) sudah checked_out. ` +
             `JANGAN dihapus — itu data historis. Bila perlu koreksi, pakai admin UI.`,
    });
  }
  if (target.status === "cancelled" && mode === "cancel") {
    return JSON.stringify({
      ok:    false,
      error: `Booking ${target.reference_code} sudah berstatus cancelled. ` +
             `Pakai mode='hard' untuk hapus permanen.`,
    });
  }

  // ── Two-step confirm for HARD delete ─────────────────────────────────────
  if (mode === "hard" && !confirmed) {
    return JSON.stringify({
      ok:                false,
      needs_confirmation: true,
      target: {
        reference_code: target.reference_code,
        guest_name:     target.guest_name,
        status:         target.status,
        check_in:       target.check_in,
        check_out:      target.check_out,
      },
      error:
        `Mode 'hard' menghapus row DB permanen — tidak bisa diundo. ` +
        `Tampilkan detail target ke manajer dan minta konfirmasi eksplisit ('ya/lanjut'). ` +
        `Lalu panggil tool lagi dengan confirmed=true.`,
    });
  }

  // ── Execute ──────────────────────────────────────────────────────────────
  try {
    if (mode === "hard") {
      // booking_rooms cascades via FK ON DELETE CASCADE (verify in schema).
      const { error } = await (ctx.supabaseAdmin as any)
        .from("bookings")
        .delete()
        .eq("id", target.id);
      if (error) throw error;
      return JSON.stringify({
        ok:   true,
        mode: "hard",
        deleted: {
          reference_code: target.reference_code,
          guest_name:     target.guest_name,
        },
        message:
          `Booking ${target.reference_code} (${target.guest_name}) DIHAPUS PERMANEN ` +
          `dari DB. Slot kamar dibebaskan.`,
      });
    } else {
      const { error } = await (ctx.supabaseAdmin as any)
        .from("bookings")
        .update({ status: "cancelled" })
        .eq("id", target.id);
      if (error) throw error;
      return JSON.stringify({
        ok:   true,
        mode: "cancel",
        cancelled: {
          reference_code: target.reference_code,
          guest_name:     target.guest_name,
          prev_status:    target.status,
        },
        message:
          `Booking ${target.reference_code} (${target.guest_name}) dibatalkan ` +
          `(status: ${target.status} → cancelled). Slot kamar dibebaskan. ` +
          `Data tetap tersimpan; pakai mode='hard' bila perlu hapus permanen.`,
      });
    }
  } catch (e) {
    return JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) });
  }
};
