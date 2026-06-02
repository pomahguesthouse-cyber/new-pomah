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

async function pickAvailableRooms(
  ctx:        ToolContext,
  roomTypeId: string,
  checkIn:    string,
  checkOut:   string,
  needed:     number,
): Promise<Array<{ id: string; number: string }>> {
  if (needed <= 0) return [];
  const { data: rooms } = await (ctx.supabaseAdmin as any)
    .from("rooms")
    .select("id, number")
    .eq("room_type_id", roomTypeId)
    .order("number");

  const roomRows = (rooms ?? []) as Array<{ id: string; number: string }>;
  if (roomRows.length === 0) return [];

  const { data: activeBookings } = await (ctx.supabaseAdmin as any)
    .from("bookings")
    .select("id")
    .in("status", ["pending", "confirmed", "checked_in"])
    .lt("check_in",  checkOut)
    .gt("check_out", checkIn);

  const activeIds = ((activeBookings ?? []) as Array<{ id: string }>).map((b) => b.id);
  if (activeIds.length === 0) return roomRows.slice(0, needed);

  const { data: occ } = await (ctx.supabaseAdmin as any)
    .from("booking_rooms")
    .select("room_id")
    .not("room_id", "is", null)
    .in("booking_id", activeIds);

  const taken = new Set(((occ ?? []) as Array<{ room_id: string }>).map((r) => r.room_id));
  return roomRows.filter((r) => !taken.has(r.id)).slice(0, needed);
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
      ? `${ctx.origin}/book/confirmation/${b.reference_code ?? b.id}`
      : `https://pomahguesthouse.com/book/confirmation/${b.reference_code ?? b.id}`,
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
  const emailRaw      = str(args.email);
  const phoneRaw      = str(args.phone);
  const checkIn       = isDateString(args.check_in)  ? args.check_in  : "";
  // Default check_out = check_in + 1 day (1 malam) when omitted — useful for
  // managerial direct entry where staff says "Faizal, Single, hari ini, 1 malam".
  let checkOut        = isDateString(args.check_out) ? args.check_out : "";
  if (!checkOut && checkIn) {
    checkOut = new Date(new Date(checkIn).getTime() + 86_400_000).toISOString().slice(0, 10);
  }
  const adults        = Math.max(1, Math.min(8, Number(args.adults)   || 1));
  const children      = Math.max(0, Math.min(8, Number(args.children) || 0));

  // Managerial direct entry: nama wajib, email/HP opsional (staff isi belakangan
  // via admin UI). Guest WA flow tetap strict — semua data wajib karena harus
  // bisa kirim invoice + konfirmasi.
  const managerialDirect = ctx.isManager === true;

  if (!fullName) {
    return JSON.stringify({ ok: false, error: "Nama tamu wajib diisi." });
  }
  if (!managerialDirect && (!emailRaw || !phoneRaw)) {
    return JSON.stringify({ ok: false, error: "Data tamu belum lengkap (nama, email, HP)." });
  }
  if (emailRaw && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(emailRaw)) {
    return JSON.stringify({ ok: false, error: "Format email tidak valid." });
  }
  if (!checkIn || !checkOut || checkOut <= checkIn) {
    return JSON.stringify({ ok: false, error: "Tanggal check-in/check-out tidak valid." });
  }

  const email = emailRaw || null;
  const phone = phoneRaw || null;

  // ── Resolve room items: single (`room_type`) or multi (`rooms` array) ─────
  // Multi shape (managerial direct entry, mis. "deluxe 2 kamar, single 1"):
  //   args.rooms = [ { room_type: "Deluxe", quantity: 2 }, { room_type: "Single", quantity: 1 } ]
  // Single shape (existing guest flow): args.room_type = "Deluxe".
  interface RawItem { name: string; quantity: number }
  let rawItems: RawItem[] = [];
  if (Array.isArray(args.rooms) && (args.rooms as unknown[]).length > 0) {
    rawItems = (args.rooms as unknown[]).map((it) => {
      const obj = (it ?? {}) as Record<string, unknown>;
      return {
        name:     str(obj.room_type),
        quantity: Math.max(1, Math.min(20, Number(obj.quantity) || 1)),
      };
    }).filter((it) => it.name.length > 0);
  } else if (str(args.room_type)) {
    rawItems = [{ name: str(args.room_type), quantity: 1 }];
  }
  if (rawItems.length === 0) {
    return JSON.stringify({
      ok:    false,
      error: "Sebutkan tipe kamar (pakai `room_type` untuk satu kamar, atau `rooms: " +
             "[{room_type, quantity}]` untuk multi-kamar).",
    });
  }

  // Resolve each item to a real room_type row.
  interface ResolvedItem { rt: typeof ctx.rooms[number]; quantity: number }
  const resolved: ResolvedItem[] = [];
  for (const item of rawItems) {
    const needle = item.name.toLowerCase().trim();
    const rt =
      ctx.rooms.find((r) => r.name.toLowerCase().trim() === needle) ??
      ctx.rooms.find((r) => r.name.toLowerCase().includes(needle) || needle.includes(r.name.toLowerCase()));
    if (!rt) {
      return JSON.stringify({
        ok:    false,
        error: `Tipe kamar "${item.name}" tidak ditemukan. Pilihan: ${ctx.rooms.map((r) => r.name).join(", ")}.`,
      });
    }
    // Merge duplicates (mis. user kirim Deluxe 2x dalam dua item).
    const existing = resolved.find((x) => x.rt.id === rt.id);
    if (existing) existing.quantity += item.quantity;
    else resolved.push({ rt, quantity: item.quantity });
  }

  // ── Check availability per type AND allocate concrete rooms ──────────────
  // We do this BEFORE any write so a partial booking can't land.
  const { data: availRows } = await (ctx.supabasePublic as any).rpc(
    "room_type_availability_detail",
    { p_check_in: checkIn, p_check_out: checkOut },
  );
  const availMap = new Map<string, number>();
  for (const row of ((availRows ?? []) as Array<{ room_type_id: string; available: number }>)) {
    availMap.set(row.room_type_id, row.available);
  }

  interface Allocation {
    rt:         typeof ctx.rooms[number];
    quantity:   number;
    rooms:      Array<{ id: string; number: string }>;
    rate:       number;
    subtotal:   number;
  }
  const allocations: Allocation[] = [];
  for (const r of resolved) {
    const have = availMap.get(r.rt.id);
    if (have != null && have < r.quantity) {
      return JSON.stringify({
        ok:    false,
        error: `${r.rt.name}: diminta ${r.quantity} kamar, tersedia ${have} untuk tanggal tersebut.`,
      });
    }
    const picked = await pickAvailableRooms(ctx, r.rt.id, checkIn, checkOut, r.quantity);
    if (picked.length < r.quantity) {
      return JSON.stringify({
        ok:    false,
        error: `${r.rt.name}: hanya ${picked.length} kamar fisik kosong, butuh ${r.quantity}.`,
      });
    }
    allocations.push({
      rt:       r.rt,
      quantity: r.quantity,
      rooms:    picked,
      rate:     Number(r.rt.base_rate ?? 0),
      subtotal: 0, // computed below
    });
  }

  // ── Create guest record ────────────────────────────────────────────────────
  const propId = (ctx.property as Record<string, unknown>).id as string | undefined;
  if (!propId) return JSON.stringify({ ok: false, error: "Properti belum dikonfigurasi." });

  const nights = Math.round(
    (new Date(checkOut).getTime() - new Date(checkIn).getTime()) / 86400000,
  );
  for (const a of allocations) {
    a.subtotal = a.rate * a.quantity * nights;
  }
  const total = allocations.reduce((sum, a) => sum + a.subtotal, 0);

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
  // Source attribution: managerial direct entry vs guest WA chat. Web/walk-in
  // bookings don't come through this tool — they go through the website
  // checkout flow (public.functions.ts) which sets source='direct' itself.
  const desiredSource: "manager_chat" | "whatsapp" = managerialDirect ? "manager_chat" : "whatsapp";

  async function insertBooking(srcValue: string) {
    return await (ctx.supabaseAdmin as any)
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
        source:       srcValue,
        status:       "pending",
        idempotency_key: idemKey ?? null,
      })
      .select("id, reference_code")
      .single();
  }

  let { data: booking, error: bErr } = await insertBooking(desiredSource);

  // Graceful fallback: a DB that hasn't been migrated yet won't know
  // 'manager_chat' as a booking_source enum value (22P02 invalid_text_representation).
  // Retry once with 'direct' so the booking still lands, and log a warning.
  if (bErr && desiredSource === "manager_chat" && (bErr as any)?.code === "22P02") {
    console.warn("[create_booking] enum 'manager_chat' not in DB — apply migration 20260602010000_booking_source_manager_chat.sql. Falling back to 'direct'.");
    ({ data: booking, error: bErr } = await insertBooking("direct"));
  }

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

  // ── Assign rooms — one booking_rooms row per physical unit ─────────────────
  const brRows = allocations.flatMap((a) =>
    a.rooms.map((room) => ({
      booking_id:   booking.id,
      room_id:      room.id,
      room_type_id: a.rt.id,
      nightly_rate: a.rate,
    })),
  );
  const { error: brErr } = await (ctx.supabaseAdmin as any)
    .from("booking_rooms")
    .insert(brRows);
  if (brErr) {
    return JSON.stringify({
      ok:    false,
      error: `Gagal menyimpan detail kamar: ${brErr.message}`,
    });
  }

  // ── Upsert the invoice record (no WhatsApp send) ────────────────────────────
  // The Finance Agent now owns the in-chat invoice delivery via the
  // `send_invoice` tool, so this call passes skipWhatsApp:true. We still need
  // it to keep the `invoices` table in sync (admin reporting, snapshot,
  // future email channel) — only the duplicate WA message is suppressed.
  const upsertInvoiceRecord = async () => {
    try {
      const { generateAndSendInvoiceNotification } = await import(
        "@/services/invoice-notification.service"
      );
      const res = await generateAndSendInvoiceNotification({
        supabase:     ctx.supabaseAdmin as any,
        bookingId:    booking.id,
        origin:       ctx.origin,
        skipWhatsApp: true,
      });
      if (!res.ok) {
        console.error(`[create_booking] invoice record upsert failed for ${booking.id}: ${res.error}`);
      }
    } catch (e) {
      console.error(`[create_booking] invoice record upsert threw for ${booking.id}:`, e);
    }
  };

  const { getWaitUntil } = await import("@/lib/cf-context");
  const waitUntil = getWaitUntil();
  if (waitUntil) waitUntil(upsertInvoiceRecord());
  else await upsertInvoiceRecord();

  // Notifikasi manager (fire-and-forget, tidak memblokir balasan AI).
  const notifyManager = async () => {
    try {
      const { notifyNewBooking } = await import("@/services/manager-notifier.service");
      await notifyNewBooking(ctx.supabaseAdmin as any, booking.id);
    } catch (e) {
      console.error(`[create_booking] notifyNewBooking gagal untuk ${booking.id}:`, e);
    }
  };
  if (waitUntil) waitUntil(notifyManager());
  else void notifyManager();

  // ── Return success payload ─────────────────────────────────────────────────
  // Backwards-compat: single-room callers still get `room_type` and
  // `nightly_rate`. Multi-room callers get `rooms` array.
  const firstAlloc = allocations[0];
  const totalUnits = allocations.reduce((sum, a) => sum + a.quantity, 0);
  return JSON.stringify({
    ok:               true,
    reference_code:   booking.reference_code,
    // Single-room legacy fields (point to first allocation).
    room_type:        firstAlloc.rt.name,
    nightly_rate:     firstAlloc.rate,
    // Multi-room shape — always present, so callers can prefer this.
    rooms:            allocations.map((a) => ({
      room_type:    a.rt.name,
      quantity:     a.quantity,
      rate_per_night: a.rate,
      subtotal:     a.subtotal,
      room_numbers: a.rooms.map((r) => r.number),
    })),
    room_count:       totalUnits,
    check_in:         checkIn,
    check_out:        checkOut,
    check_in_tampil:  fmtDateID(checkIn),
    check_out_tampil: fmtDateID(checkOut),
    nights,
    total,
    guest:            { full_name: fullName, email, phone },
    pembayaran: {
      bank:       ctx.property.payment_bank_name      ?? null,
      no_rekening: ctx.property.payment_account_number ?? null,
      atas_nama:  ctx.property.payment_account_holder  ?? null,
    },
    invoice_url: ctx.origin
      ? `${ctx.origin}/book/confirmation/${booking.reference_code ?? booking.id}`
      : `https://pomahguesthouse.com/book/confirmation/${booking.reference_code ?? booking.id}`,
  });
};
