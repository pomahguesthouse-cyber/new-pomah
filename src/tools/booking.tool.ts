/**
 * Tool: create_booking
 *
 * Creates a full booking record (guest → booking → booking_room) in a single
 * logical transaction.  All validation happens here so the LLM cannot create
 * invalid data by passing incomplete arguments.
 */

import { isDateString, fmtDateID } from "@/lib/date";
import type { ToolContext, ToolHandler } from "./types";
import { generateAndSendInvoiceNotification } from "@/services/invoice-notification.service";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

async function pickAvailableRoom(
  ctx:        ToolContext,
  roomTypeId: string,
  checkIn:    string,
  checkOut:   string,
): Promise<string | null> {
  const { data: rooms } = await (ctx.supabaseAdmin as any)
    .from("rooms")
    .select("id, number")
    .eq("room_type_id", roomTypeId)
    .order("number");

  const roomRows = (rooms ?? []) as Array<{ id: string; number: string }>;
  if (roomRows.length === 0) return null;

  const { data: activeBookings } = await (ctx.supabaseAdmin as any)
    .from("bookings")
    .select("id")
    .in("status", ["pending", "confirmed", "checked_in"])
    .lt("check_in",  checkOut)
    .gt("check_out", checkIn);

  const activeIds = ((activeBookings ?? []) as Array<{ id: string }>).map((b) => b.id);
  if (activeIds.length === 0) return roomRows[0].id;

  const { data: occ } = await (ctx.supabaseAdmin as any)
    .from("booking_rooms")
    .select("room_id")
    .not("room_id", "is", null)
    .in("booking_id", activeIds);

  const taken = new Set(((occ ?? []) as Array<{ room_id: string }>).map((r) => r.room_id));
  const free  = roomRows.find((r) => !taken.has(r.id));
  return free ? free.id : null;
}

// ─── Tool handler ─────────────────────────────────────────────────────────────

export const createBooking: ToolHandler = async (
  args: Record<string, unknown>,
  ctx:  ToolContext,
): Promise<string> => {
  // ── Validate inputs ────────────────────────────────────────────────────────
  const fullName      = str(args.full_name);
  const email         = str(args.email);
  const phone         = str(args.phone);
  const roomTypeName  = str(args.room_type).toLowerCase();
  const checkIn       = isDateString(args.check_in)  ? args.check_in  : "";
  const checkOut      = isDateString(args.check_out) ? args.check_out : "";
  const adults        = Math.max(1, Math.min(8, Number(args.adults)   || 1));
  const children      = Math.max(0, Math.min(8, Number(args.children) || 0));

  if (!fullName || !email || !phone) {
    return JSON.stringify({ ok: false, error: "Data tamu belum lengkap (nama, email, HP)." });
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return JSON.stringify({ ok: false, error: "Format email tidak valid." });
  }
  if (!checkIn || !checkOut || checkOut <= checkIn) {
    return JSON.stringify({ ok: false, error: "Tanggal check-in/check-out tidak valid." });
  }

  // ── Find room type ─────────────────────────────────────────────────────────
  const rt =
    ctx.rooms.find((r) => r.name.toLowerCase() === roomTypeName) ??
    ctx.rooms.find((r) => {
      const n = r.name.toLowerCase();
      return n.includes(roomTypeName) || roomTypeName.includes(n);
    });

  if (!rt) {
    return JSON.stringify({
      ok:    false,
      error: `Tipe kamar "${str(args.room_type)}" tidak ditemukan.`,
    });
  }

  // ── Check availability ─────────────────────────────────────────────────────
  const { data: availRows } = await (ctx.supabasePublic as any).rpc(
    "room_type_availability_detail",
    { p_check_in: checkIn, p_check_out: checkOut },
  );
  const avail = ((availRows ?? []) as Array<{ room_type_id: string; available: number }>).find(
    (r) => r.room_type_id === rt.id,
  );
  if (avail && avail.available < 1) {
    return JSON.stringify({
      ok:    false,
      error: `${rt.name} sudah penuh untuk tanggal tersebut.`,
    });
  }

  // ── Create guest record ────────────────────────────────────────────────────
  const propId = (ctx.property as Record<string, unknown>).id as string | undefined;
  if (!propId) return JSON.stringify({ ok: false, error: "Properti belum dikonfigurasi." });

  const nights = Math.round(
    (new Date(checkOut).getTime() - new Date(checkIn).getTime()) / 86400000,
  );
  const rate  = Number(rt.base_rate ?? 0);
  const total = rate * nights;

  const { data: guest, error: gErr } = await (ctx.supabaseAdmin as any)
    .from("guests")
    .insert({ full_name: fullName, email, phone })
    .select("id")
    .single();

  if (gErr || !guest) {
    return JSON.stringify({
      ok:    false,
      error: `Gagal menyimpan data tamu: ${gErr?.message ?? "tidak diketahui"}`,
    });
  }

  // ── Create booking ─────────────────────────────────────────────────────────
  const { data: booking, error: bErr } = await (ctx.supabaseAdmin as any)
    .from("bookings")
    .insert({
      property_id:  propId,
      guest_id:     guest.id,
      check_in:     checkIn,
      check_out:    checkOut,
      nights,
      adults,
      children,
      total_amount: total,
      source:       "direct",
      status:       "pending",
    })
    .select("id, reference_code")
    .single();

  if (bErr || !booking) {
    return JSON.stringify({
      ok:    false,
      error: `Gagal membuat booking: ${bErr?.message ?? "tidak diketahui"}`,
    });
  }

  // ── Assign room ────────────────────────────────────────────────────────────
  const assignedRoomId = await pickAvailableRoom(ctx, rt.id, checkIn, checkOut);
  const { error: brErr } = await (ctx.supabaseAdmin as any)
    .from("booking_rooms")
    .insert({
      booking_id:   booking.id,
      room_id:      assignedRoomId,
      room_type_id: rt.id,
      nightly_rate: rate,
    });

  if (brErr) {
    return JSON.stringify({
      ok:    false,
      error: `Gagal menyimpan detail kamar: ${brErr.message}`,
    });
  }

  // Try to generate and send the invoice PDF via WhatsApp
  try {
    void generateAndSendInvoiceNotification({
      supabase: ctx.supabaseAdmin as any,
      bookingId: booking.id,
      origin: ctx.origin,
    }).catch((err) => {
      console.error("[createBookingTool] Notification error:", err);
    });
  } catch (notificationErr) {
    console.error("[createBookingTool] Notification trigger error:", notificationErr);
  }

  // ── Return success payload ─────────────────────────────────────────────────
  return JSON.stringify({
    ok:               true,
    reference_code:   booking.reference_code,
    room_type:        rt.name,
    check_in:         checkIn,
    check_out:        checkOut,
    check_in_tampil:  fmtDateID(checkIn),
    check_out_tampil: fmtDateID(checkOut),
    nights,
    nightly_rate:     rate,
    total,
    guest:            { full_name: fullName, email, phone },
    pembayaran: {
      bank:       ctx.property.payment_bank_name      ?? null,
      no_rekening: ctx.property.payment_account_number ?? null,
      atas_nama:  ctx.property.payment_account_holder  ?? null,
    },
    invoice_url: ctx.origin 
      ? `${ctx.origin}/book/confirmation/${booking.id}` 
      : `https://pomahguesthouse.com/book/confirmation/${booking.id}`,
  });
};
