/**
 * Tool: create_booking
 *
 * Creates a full booking record (guest → booking → booking_room) in a single
 * logical transaction.  All validation happens here so the LLM cannot create
 * invalid data by passing incomplete arguments.
 */

import { isDateString, fmtDateID } from "@/lib/date";
import type { ToolContext, ToolHandler } from "./types";

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

/**
 * Look up a booking already created for this idempotency key and rebuild the
 * success payload. Returns null if none exists. Used to make create_booking
 * safe under webhook retries of the same inbound message.
 */
async function findBookingByIdemKey(
  ctx:     ToolContext,
  idemKey: string,
): Promise<string | null> {
  const { data: b } = await (ctx.supabaseAdmin as any)
    .from("bookings")
    .select(
      "id, reference_code, check_in, check_out, nights, total_amount, " +
      "guests(full_name, email, phone), booking_rooms(room_type_id, nightly_rate)",
    )
    .eq("idempotency_key", idemKey)
    .maybeSingle();

  if (!b) return null;

  const br = Array.isArray(b.booking_rooms) ? b.booking_rooms[0] : b.booking_rooms;
  const g  = Array.isArray(b.guests)        ? b.guests[0]        : b.guests;
  const rt = ctx.rooms.find((r) => r.id === br?.room_type_id);

  return JSON.stringify({
    ok:               true,
    reference_code:   b.reference_code,
    room_type:        rt?.name ?? "",
    check_in:         b.check_in,
    check_out:        b.check_out,
    check_in_tampil:  fmtDateID(b.check_in),
    check_out_tampil: fmtDateID(b.check_out),
    nights:           b.nights,
    nightly_rate:     Number(br?.nightly_rate ?? 0),
    total:            Number(b.total_amount ?? 0),
    guest:            { full_name: g?.full_name, email: g?.email, phone: g?.phone },
    pembayaran: {
      bank:        ctx.property.payment_bank_name      ?? null,
      no_rekening: ctx.property.payment_account_number ?? null,
      atas_nama:   ctx.property.payment_account_holder  ?? null,
    },
    invoice_url: ctx.origin
      ? `${ctx.origin}/book/confirmation/${b.id}`
      : `https://pomahguesthouse.com/book/confirmation/${b.id}`,
    idempotent_replay: true,
  });
}

// ─── Tool handler ─────────────────────────────────────────────────────────────

export const createBooking: ToolHandler = async (
  args: Record<string, unknown>,
  ctx:  ToolContext,
): Promise<string> => {
  // ── Idempotency short-circuit ────────────────────────────────────────────────
  // If a prior webhook retry already created this booking, return it as-is
  // instead of creating a duplicate.
  const idemKey = ctx.idempotencyKey?.trim();
  if (idemKey) {
    const existing = await findBookingByIdemKey(ctx, idemKey);
    if (existing) return existing;
  }

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

  // ── Pick a concrete free room BEFORE any write ───────────────────────────────
  // Fail fast if no physical room is free: avoids creating an orphan guest/booking
  // and prevents silently inserting a booking_room with room_id = null.
  const assignedRoomId = await pickAvailableRoom(ctx, rt.id, checkIn, checkOut);
  if (!assignedRoomId) {
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
      idempotency_key: idemKey ?? null,
    })
    .select("id, reference_code")
    .single();

  if (bErr || !booking) {
    // Unique-violation on idempotency_key = a concurrent retry won the race.
    // Return the booking it created instead of erroring.
    if (idemKey && (bErr as any)?.code === "23505") {
      const existing = await findBookingByIdemKey(ctx, idemKey);
      if (existing) return existing;
    }
    return JSON.stringify({
      ok:    false,
      error: `Gagal membuat booking: ${bErr?.message ?? "tidak diketahui"}`,
    });
  }

  // ── Assign room (resolved above, guaranteed non-null) ────────────────────────
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

  // ── Send the invoice notification (link to the confirmation page) ────────────
  // We don't render a PDF server-side (unreliable on Cloudflare Workers); the
  // guest gets a WhatsApp message with the confirmation-page link, which renders
  // the invoice client-side. We hand it to the Worker's `waitUntil` — the same
  // background mechanism the webhook and public-booking paths use — so it runs
  // independently of the AI reply turn. Best-effort: booking success never
  // depends on it.
  const sendInvoice = async () => {
    try {
      const { generateAndSendInvoiceNotification } = await import(
        "@/services/invoice-notification.service"
      );
      const res = await generateAndSendInvoiceNotification({
        supabase:  ctx.supabaseAdmin as any,
        bookingId: booking.id,
        origin:    ctx.origin,
      });
      if (!res.ok) {
        console.error(`[create_booking] invoice generation failed for ${booking.id}: ${res.error}`);
      } else if (!res.wa_sent) {
        console.warn(`[create_booking] invoice PDF generated but WhatsApp not sent for ${booking.id}`);
      } else {
        console.log(`[create_booking] invoice PDF sent for ${booking.id}`);
      }
    } catch (e) {
      console.error(`[create_booking] invoice PDF send threw for ${booking.id}:`, e);
    }
  };

  const { getWaitUntil } = await import("@/lib/cf-context");
  const waitUntil = getWaitUntil();
  if (waitUntil) waitUntil(sendInvoice());
  else await sendInvoice();
  // Same mechanism the public booking form uses; sends the PDF (not just a link)
  // directly to the guest. Best-effort — booking success does not depend on it.
  let invoicePdfSent = false;
  let pdfUrl: string | null = null;
  try {
    const { generateAndSendInvoiceNotification } = await import(
      "@/services/invoice-notification.service"
    );
    const res = await generateAndSendInvoiceNotification({
      supabase:  ctx.supabaseAdmin as any,
      bookingId: booking.id,
      origin:    ctx.origin,
      skipWhatsApp: true, // Let the AI chatbot attach the PDF directly instead
    });
    invoicePdfSent = res.wa_sent;
    pdfUrl = res.pdf_url;
  } catch (e) {
    console.error("[create_booking] invoice PDF send failed:", e);
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
    invoice_pdf_sent: invoicePdfSent,
    invoice_pdf_url: pdfUrl,
    invoice_url: ctx.origin
      ? `${ctx.origin}/book/confirmation/${booking.id}`
      : `https://pomahguesthouse.com/book/confirmation/${booking.id}`,
  });
};
