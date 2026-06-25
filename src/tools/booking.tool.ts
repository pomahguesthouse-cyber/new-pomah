/**
 * Tool: create_booking
 *
 * Creates a full booking record (guest → booking → booking_room) in a single
 * logical transaction.  All validation happens here so the LLM cannot create
 * invalid data by passing incomplete arguments.
 */

import { isDateString, fmtDateID } from "@/lib/date";
import { getDailyRatesForRange, resolveRoomNightlyRates } from "@/services/pricing/daily-rate.service";
import type { ToolContext, ToolHandler } from "./types";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

async function pickAvailableRooms(
  ctx: ToolContext,
  roomTypeId: string,
  checkIn: string,
  checkOut: string,
  skipRoomIds?: Set<string>,
): Promise<string | null> {
  const { data: rooms, error: roomsErr } = await (ctx.supabaseAdmin as any)
    .from("rooms")
    .select("id, number")
    .eq("room_type_id", roomTypeId)
    .order("number");
  if (roomsErr) throw roomsErr;

  const roomRows = (rooms ?? []) as Array<{ id: string; number: string }>;
  if (roomRows.length === 0) return null;

  const { data: activeBookings, error: activeErr } = await (ctx.supabaseAdmin as any)
    .from("bookings")
    .select("id")
    .in("status", ["pending", "confirmed", "checked_in"])
    .lt("check_in", checkOut)
    .gt("check_out", checkIn);
  if (activeErr) throw activeErr;

  const activeIds = ((activeBookings ?? []) as Array<{ id: string }>).map((b) => b.id);

  let taken = new Set<string>();
  if (activeIds.length > 0) {
    const { data: occ, error: occErr } = await (ctx.supabaseAdmin as any)
      .from("booking_rooms")
      .select("room_id")
      .not("room_id", "is", null)
      .in("booking_id", activeIds);
    if (occErr) throw occErr;
    taken = new Set(((occ ?? []) as Array<{ room_id: string }>).map((r) => r.room_id));
  }

  if (skipRoomIds) {
    for (const id of skipRoomIds) {
      taken.add(id);
    }
  }

  const free = roomRows.find((r) => !taken.has(r.id));
  return free ? free.id : null;
}

/**
 * Look up a booking already created for this idempotency key and rebuild the
 * success payload. Returns null if none exists. Used to make create_booking
 * safe under webhook retries of the same inbound message.
 *
 * Payload mirrors the success-path shape — including the structured `rooms`
 * array — so an idempotent replay of a multi-room booking doesn't degrade
 * into a single-room view (callers can format the confirmation the same way
 * either time).
 */
async function findBookingByIdemKey(ctx: ToolContext, idemKey: string): Promise<string | null> {
  const { data: b, error } = await (ctx.supabaseAdmin as any)
    .from("bookings")
    .select(
      "id, reference_code, check_in, check_out, nights, total_amount, paid_amount, payment_status, " +
        "guests(full_name, email, phone), " +
        "booking_rooms(room_type_id, nightly_rate, rooms(number), room_types(name))",
    )
    .eq("idempotency_key", idemKey)
    .maybeSingle();
  if (error) throw error;

  if (!b) return null;

  const bookingRoomsList: any[] = Array.isArray(b.booking_rooms) ? b.booking_rooms : [b.booking_rooms].filter(Boolean);
  const g = Array.isArray(b.guests) ? b.guests[0] : b.guests;
  const nights = Number(b.nights ?? 0);

  // Group by room_type_id so the response shape matches createBooking's
  // success payload: one entry per type with quantity + subtotal.
  const byType = new Map<string, { name: string; rate: number; count: number; numbers: string[] }>();
  for (const br of bookingRoomsList) {
    const tid = br?.room_type_id;
    if (!tid) continue;
    const rt = ctx.rooms.find((r) => r.id === tid);
    const num = (Array.isArray(br.rooms) ? br.rooms[0]?.number : br.rooms?.number) ?? null;
    const roomTypeName = (Array.isArray(br.room_types) ? br.room_types[0]?.name : br.room_types?.name) ?? rt?.name ?? "";
    const slot = byType.get(tid) ?? {
      name: roomTypeName,
      rate: Number(br.nightly_rate ?? 0),
      count: 0,
      numbers: [],
    };
    slot.count += 1;
    if (num) slot.numbers.push(String(num));
    byType.set(tid, slot);
  }
  const rooms = Array.from(byType.values()).map((s) => ({
    room_type: s.name,
    quantity: s.count,
    rate_per_night: s.rate,
    subtotal: s.rate * s.count * nights,
    room_numbers: s.numbers,
  }));
  const roomTypeDisplay = rooms.length > 0 ? rooms.map((r) => `${r.quantity}x ${r.room_type}`).join(", ") : "";
  const firstRate = rooms[0]?.rate_per_night ?? 0;
  const roomCount = rooms.reduce((sum, r) => sum + r.quantity, 0);
  const paidAmount = Number(b.paid_amount ?? 0);
  const paymentStatus = String(b.payment_status ?? "unpaid");

  return JSON.stringify({
    ok: true,
    reference_code: b.reference_code,
    room_type: roomTypeDisplay,
    rooms,
    room_count: roomCount,
    check_in: b.check_in,
    check_out: b.check_out,
    check_in_tampil: fmtDateID(b.check_in),
    check_out_tampil: fmtDateID(b.check_out),
    nights,
    nightly_rate: firstRate,
    total: Number(b.total_amount ?? 0),
    paid_amount: paidAmount,
    payment_status: paymentStatus,
    remaining_amount: Math.max(0, Number(b.total_amount ?? 0) - paidAmount),
    guest: { full_name: g?.full_name, email: g?.email, phone: g?.phone },
    pembayaran: {
      bank: ctx.property.payment_bank_name ?? null,
      no_rekening: ctx.property.payment_account_number ?? null,
      atas_nama: ctx.property.payment_account_holder ?? null,
    },
    invoice_url: (() => {
      const pDom = (ctx.property?.public_domain as string | undefined)?.trim();
      const base = pDom
        ? (pDom.startsWith("http") ? pDom : `https://${pDom}`).replace(/\/+$/, "")
        : ctx.origin
          ? ctx.origin.replace(/\/+$/, "")
          : "https://pomahguesthouse.com";
      return `${base}/book/confirmation/${b.reference_code ?? b.id}`;
    })(),
    idempotent_replay: true,
  });
}

// ─── Rollback helpers ──────────────────────────────────────────────────────
// create_booking writes guest → bookings → booking_rooms in three steps. We
// don't have transactional access through PostgREST, so on failure (or on a
// detected room-race) we best-effort delete what we did insert to avoid
// littering the DB with orphans. Each step swallows errors and just logs —
// missing rows on cleanup are fine, but a hard throw would mask the original
// failure we're already reporting.
async function rollbackBooking(ctx: ToolContext, refs: { bookingId?: string; guestId?: string }): Promise<void> {
  if (refs.bookingId) {
    try {
      // booking_rooms cascades via FK ON DELETE CASCADE on most schemas; if
      // the FK isn't set up that way the rows just stay orphaned. Best
      // effort — explicit delete first.
      await (ctx.supabaseAdmin as any).from("booking_rooms").delete().eq("booking_id", refs.bookingId);
      await (ctx.supabaseAdmin as any).from("bookings").delete().eq("id", refs.bookingId);
    } catch (e) {
      console.warn("[create_booking] rollback bookings failed:", e);
    }
  }
  if (refs.guestId) {
    try {
      await (ctx.supabaseAdmin as any).from("guests").delete().eq("id", refs.guestId);
    } catch (e) {
      console.warn("[create_booking] rollback guest failed:", e);
    }
  }
}

/**
 * Re-check that the rooms we just inserted into booking_rooms aren't ALSO
 * referenced by another active booking with an overlapping date range.
 *
 * After migration 20260603000000_booking_rooms_no_overlap.sql is applied,
 * Postgres enforces this directly via an EXCLUDE constraint and the insert
 * itself raises 23P01 — making this function defensive belt-and-suspenders.
 * We keep it so environments that haven't run the migration yet still get
 * race protection (just slightly weaker than the constraint).
 */
async function detectRoomConflicts(
  ctx: ToolContext,
  ourBookingId: string,
  ourRoomIds: string[],
  checkIn: string,
  checkOut: string,
): Promise<string[]> {
  if (ourRoomIds.length === 0) return [];
  // Find active bookings overlapping our date range (excluding ourselves).
  const { data: activeBookings, error: activeErr } = await (ctx.supabaseAdmin as any)
    .from("bookings")
    .select("id")
    .in("status", ["pending", "confirmed", "checked_in"])
    .neq("id", ourBookingId)
    .lt("check_in", checkOut)
    .gt("check_out", checkIn);
  if (activeErr) throw activeErr;
  const activeIds = ((activeBookings ?? []) as Array<{ id: string }>).map((b) => b.id);
  if (activeIds.length === 0) return [];

  const { data: occ, error: occErr } = await (ctx.supabaseAdmin as any)
    .from("booking_rooms")
    .select("room_id")
    .in("booking_id", activeIds)
    .in("room_id", ourRoomIds);
  if (occErr) throw occErr;
  return ((occ ?? []) as Array<{ room_id: string }>).map((r) => r.room_id);
}

// ─── Tool handler ─────────────────────────────────────────────────────────────

export const createBooking: ToolHandler = async (args: Record<string, unknown>, ctx: ToolContext): Promise<string> => {
  // ── Idempotency short-circuit ────────────────────────────────────────────────
  // If a prior webhook retry already created this booking, return it as-is
  // instead of creating a duplicate.
  const idemKey = ctx.idempotencyKey?.trim();
  if (idemKey) {
    const existing = await findBookingByIdemKey(ctx, idemKey);
    if (existing) return existing;
  }

  // ── Validate inputs ────────────────────────────────────────────────────────
  const fullName = str(args.full_name);
  const emailRaw = str(args.email);
  const phoneRaw = str(args.phone);
  const checkIn = isDateString(args.check_in) ? args.check_in : "";
  // Default check_out = check_in + 1 day (1 malam) when omitted — useful for
  // managerial direct entry where staff says "Budi, Single, hari ini, 1 malam".
  let checkOut = isDateString(args.check_out) ? args.check_out : "";
  if (!checkOut && checkIn) {
    checkOut = new Date(new Date(checkIn).getTime() + 86_400_000).toISOString().slice(0, 10);
  }
  const adults = Math.max(1, Math.min(8, Number(args.adults) || 1));
  const children = Math.max(0, Math.min(8, Number(args.children) || 0));

  // Managerial direct entry: nama wajib, email/HP opsional (staff isi belakangan
  // via admin UI). Guest WA flow tetap strict — semua data wajib karena harus
  // bisa kirim invoice + konfirmasi.
  const managerialDirect = ctx.isManager === true;

  if (!fullName) {
    return JSON.stringify({ ok: false, error: "Nama tamu wajib diisi." });
  }
  if (!managerialDirect && !phoneRaw) {
    return JSON.stringify({ ok: false, error: "Nomor HP tamu belum diisi." });
  }

  if (emailRaw && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(emailRaw)) {
    return JSON.stringify({ ok: false, error: "Format email tidak valid." });
  }
  if (!checkIn || !checkOut || checkOut <= checkIn) {
    return JSON.stringify({ ok: false, error: "Tanggal check-in/check-out tidak valid." });
  }

  const email = emailRaw || null;
  const phone = phoneRaw || null;

  // ── Check if multiple rooms are requested ──────────────────────────────────
  let roomsToBook: Array<{ roomTypeId: string; roomTypeName: string; quantity: number; pricePerNight: number }> = [];
  let rawRooms: any[] = [];
  if (Array.isArray(args.rooms)) {
    rawRooms = args.rooms;
  } else if (typeof args.rooms === "string" && args.rooms.trim().length > 0) {
    try {
      rawRooms = JSON.parse(args.rooms);
    } catch (e) {
      console.error("[createBooking] Failed to parse args.rooms:", e);
    }
  }

  if (Array.isArray(rawRooms) && rawRooms.length > 0) {
    for (const item of rawRooms) {
      if (!item) continue;
      // If it's already resolved (contains roomTypeId, roomTypeName, pricePerNight)
      if (item.roomTypeId && item.roomTypeName && item.pricePerNight !== undefined) {
        roomsToBook.push(item);
        continue;
      }
      // Otherwise resolve it from room_type
      const rName = str(item.room_type || item.roomTypeName || item.room_type_name).toLowerCase();
      const qty = Math.max(1, Number(item.quantity) || 1);
      if (!rName) continue;

      const cleanName = rName.replace(/^(kamar|room|no\.?)\s+/i, "").trim();
      let rt =
        ctx.rooms.find((r) => r.name.toLowerCase() === rName) ??
        ctx.rooms.find((r) => {
          const n = r.name.toLowerCase();
          return n.includes(rName) || rName.includes(n);
        }) ??
        ctx.rooms.find((r) => r.name.toLowerCase() === cleanName) ??
        ctx.rooms.find((r) => {
          const n = r.name.toLowerCase();
          return n.includes(cleanName) || cleanName.includes(n);
        });

      if (!rt) {
        // Fallback: Check if cleanName is a physical room number in the DB
        try {
          const { data: physicalRoom, error: physicalRoomErr } = await (ctx.supabaseAdmin as any)
            .from("rooms")
            .select("room_type_id")
            .eq("number", cleanName.toUpperCase())
            .maybeSingle();
          if (physicalRoomErr) throw physicalRoomErr;

          if (physicalRoom?.room_type_id) {
            rt = ctx.rooms.find((r) => r.id === physicalRoom.room_type_id);
          }
        } catch (dbErr) {
          console.error(`[createBooking] Failed to resolve physical room "${cleanName}":`, dbErr);
        }
      }

      if (!rt) {
        return JSON.stringify({
          ok: false,
          error: `Tipe kamar "${item.room_type || item.roomTypeName || item.room_type_name}" tidak ditemukan.`,
        });
      }

      roomsToBook.push({
        roomTypeId: rt.id,
        roomTypeName: rt.name,
        quantity: qty,
        pricePerNight: Number(rt.base_rate ?? 0),
      });
    }
  }

  const { data: availRows, error: availErr } = await (ctx.supabasePublic as any).rpc("room_type_availability_detail", {
    p_check_in: checkIn,
    p_check_out: checkOut,
  });
  if (availErr) {
    return JSON.stringify({
      ok: false,
      error: `Gagal mengecek ketersediaan kamar: ${availErr.message}`,
    });
  }
  const availMap = new Map(((availRows ?? []) as any[]).map((r) => [r.room_type_id, r.available]));

  const skipRoomIds = new Set<string>();
  const assignments: Array<{ roomTypeId: string; roomTypeName: string; roomId: string; rate: number }> = [];

  if (roomsToBook.length > 0) {
    // Group requested rooms by roomTypeId to verify total availability first
    const requestedQuantities = new Map<string, number>();
    for (const r of roomsToBook) {
      requestedQuantities.set(r.roomTypeId, (requestedQuantities.get(r.roomTypeId) ?? 0) + r.quantity);
    }

    for (const [rtId, qty] of requestedQuantities.entries()) {
      const available = availMap.get(rtId) ?? 0;
      if (available < qty) {
        const rtName = roomsToBook.find((r) => r.roomTypeId === rtId)?.roomTypeName || "Kamar";
        return JSON.stringify({
          ok: false,
          error: `${rtName} tidak cukup tersedia untuk tanggal tersebut (diminta: ${qty}, tersedia: ${available}).`,
        });
      }
    }

    // Allocate concrete rooms
    for (const r of roomsToBook) {
      for (let q = 0; q < r.quantity; q++) {
        const assignedRoomId = await pickAvailableRooms(ctx, r.roomTypeId, checkIn, checkOut, skipRoomIds);
        if (!assignedRoomId) {
          return JSON.stringify({
            ok: false,
            error: `Gagal mengalokasikan kamar fisik untuk ${r.roomTypeName}.`,
          });
        }
        skipRoomIds.add(assignedRoomId);
        assignments.push({
          roomTypeId: r.roomTypeId,
          roomTypeName: r.roomTypeName,
          roomId: assignedRoomId,
          rate: r.pricePerNight,
        });
      }
    }
  } else {
    // Single room type fallback (behavior lama)
    const roomTypeName = str(args.room_type).toLowerCase();
    const cleanTypeName = roomTypeName.replace(/^(kamar|room|no\.?)\s+/i, "").trim();
    let rt =
      ctx.rooms.find((r) => r.name.toLowerCase() === roomTypeName) ??
      ctx.rooms.find((r) => {
        const n = r.name.toLowerCase();
        return n.includes(roomTypeName) || roomTypeName.includes(n);
      }) ??
      ctx.rooms.find((r) => r.name.toLowerCase() === cleanTypeName) ??
      ctx.rooms.find((r) => {
        const n = r.name.toLowerCase();
        return n.includes(cleanTypeName) || cleanTypeName.includes(n);
      });

    if (!rt) {
      // Fallback: Check if cleanTypeName is a physical room number in the DB
      try {
        const { data: physicalRoom, error: physicalRoomErr } = await (ctx.supabaseAdmin as any)
          .from("rooms")
          .select("room_type_id")
          .eq("number", cleanTypeName.toUpperCase())
          .maybeSingle();
        if (physicalRoomErr) throw physicalRoomErr;

        if (physicalRoom?.room_type_id) {
          rt = ctx.rooms.find((r) => r.id === physicalRoom.room_type_id);
        }
      } catch (dbErr) {
        console.error(`[createBooking] Failed to resolve physical room "${cleanTypeName}":`, dbErr);
      }
    }

    if (!rt) {
      return JSON.stringify({
        ok: false,
        error: `Tipe kamar "${str(args.room_type)}" tidak ditemukan.`,
      });
    }

    const available = availMap.get(rt.id) ?? 0;
    if (available < 1) {
      return JSON.stringify({
        ok: false,
        error: `${rt.name} sudah penuh untuk tanggal tersebut.`,
      });
    }

    const assignedRoomId = await pickAvailableRooms(ctx, rt.id, checkIn, checkOut);
    if (!assignedRoomId) {
      return JSON.stringify({
        ok: false,
        error: `${rt.name} sudah penuh untuk tanggal tersebut.`,
      });
    }

    const singleRate =
      typeof args.price_per_night === "number" && args.price_per_night > 0
        ? args.price_per_night
        : Number(rt.base_rate ?? 0);

    assignments.push({
      roomTypeId: rt.id,
      roomTypeName: rt.name,
      roomId: assignedRoomId,
      rate: singleRate,
    });
  }

  // ── Create guest record ────────────────────────────────────────────────────
  const propId = (ctx.property as Record<string, unknown>).id as string | undefined;
  if (!propId) return JSON.stringify({ ok: false, error: "Properti belum dikonfigurasi." });

  const nights = Math.round((new Date(checkOut).getTime() - new Date(checkIn).getTime()) / 86400000);

  // ── Resolve dynamic daily rates ───────────────────────────────────────────
  // Bookings yang sudah ada di DB tidak disentuh (sesuai keputusan
  // "jangan ubah booking yang sudah ada"). Untuk booking BARU, resolve
  // per-malam dari room_daily_rates dan fallback ke base_rate. Stop-sell
  // di salah satu malam → tolak booking (sumber kebenaran sudah ada di
  // check_room_availability, tapi state machine bisa kelewat — defense
  // in depth di sini supaya kamar yang ditutup tidak ter-book).
  //
  // Skema booking_rooms tidak berubah: kita simpan `nightly_rate` =
  // average per malam (total/nights) supaya invariant lama (rate × nights
  // = subtotal) tetap berlaku di RPC invoice & laporan.
  const uniqueRoomTypeIds = Array.from(new Set(assignments.map((a) => a.roomTypeId)));
  const overridesByRoom = await getDailyRatesForRange(ctx.supabasePublic, uniqueRoomTypeIds, checkIn, checkOut);
  const resolvedByRoomType = new Map<string, { avgRate: number; stopSellDates: string[] }>();
  for (const rtId of uniqueRoomTypeIds) {
    const rt = ctx.rooms.find((r) => r.id === rtId);
    if (!rt) continue;
    const resolved = resolveRoomNightlyRates(rt, checkIn, checkOut, overridesByRoom.get(rtId));
    const avg = resolved.nights > 0 ? resolved.total / resolved.nights : Number(rt.base_rate ?? 0);
    resolvedByRoomType.set(rtId, {
      avgRate: avg,
      stopSellDates: resolved.stop_sell_dates,
    });
  }
  const stopSellHit = assignments
    .map((a) => ({ a, info: resolvedByRoomType.get(a.roomTypeId) }))
    .find(({ info }) => info && info.stopSellDates.length > 0);
  if (stopSellHit && stopSellHit.info) {
    return JSON.stringify({
      ok: false,
      error:
        `${stopSellHit.a.roomTypeName} tidak dijual untuk tanggal ` +
        `${stopSellHit.info.stopSellDates.map(fmtDateID).join(", ")}. ` +
        `Tawarkan tanggal lain atau tipe kamar lain.`,
    });
  }
  // Re-stamp each assignment's nightly_rate with the resolved average so
  // booking_rooms.nightly_rate × nights = subtotal stays true.
  for (const a of assignments) {
    const info = resolvedByRoomType.get(a.roomTypeId);
    if (info) {
      const rt = ctx.rooms.find((r) => r.id === a.roomTypeId);
      const baseRate = rt ? Number(rt.base_rate ?? 0) : 0;
      // If the assignment already has a custom/dynamic rate that is different from base_rate,
      // and the DB resolved rate is just the fallback base_rate, do NOT overwrite the custom rate.
      if (a.rate > 0 && a.rate !== baseRate && info.avgRate === baseRate) {
        // Keep a.rate
      } else {
        a.rate = info.avgRate;
      }
    }
  }

  const total = assignments.reduce((acc, curr) => acc + curr.rate * nights, 0);

  const { data: guest, error: gErr } = await (ctx.supabaseAdmin as any)
    .from("guests")
    .insert({ full_name: fullName, email, phone })
    .select("id")
    .single();

  if (gErr || !guest) {
    return JSON.stringify({
      ok: false,
      error: `Gagal menyimpan data tamu: ${gErr?.message ?? "tidak diketahui"}`,
    });
  }

  // ── Create booking ─────────────────────────────────────────────────────────
  // Source attribution: managerial direct entry vs guest WA chat. Web/walk-in
  // bookings don't come through this tool — they go through the website
  // checkout flow (public.functions.ts) which sets source='direct' itself.
  const desiredSource: "manager_chat" | "whatsapp" = managerialDirect ? "manager_chat" : "whatsapp";

  // Skema pembayaran DP vs lunas.
  // args.payment_type = 'dp' | 'full' (dikirim dari booking-machine via context)
  // args.dp_amount    = nominal DP (jika payment_type='dp')
  const paymentType = str(args.payment_type).toLowerCase();
  const isDP = paymentType === "dp";
  const requestedDpAmount = isDP ? Math.max(0, Number(args.dp_amount) || 0) : 0;
  const initialPaidAmount = isDP ? Math.min(requestedDpAmount, total) : 0;
  const initialPaymentStatus =
    initialPaidAmount >= total && total > 0 ? "paid" : initialPaidAmount > 0 ? "partial" : "unpaid";

  async function insertBooking(srcValue: string) {
    return await (ctx.supabaseAdmin as any)
      .from("bookings")
      .insert({
        property_id: propId,
        guest_id: guest.id,
        check_in: checkIn,
        check_out: checkOut,
        nights,
        adults,
        children,
        total_amount: total,
        paid_amount: initialPaidAmount,
        payment_status: initialPaymentStatus,
        source: srcValue,
        status: "pending",
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
    console.warn(
      "[create_booking] enum 'manager_chat' not in DB — apply migration 20260602010000_booking_source_manager_chat.sql. Falling back to 'direct'.",
    );
    ({ data: booking, error: bErr } = await insertBooking("direct"));
  }

  if (bErr || !booking) {
    // Unique-violation on idempotency_key = a concurrent retry won the race.
    // Return the booking it created instead of erroring.
    if (idemKey && (bErr as any)?.code === "23505") {
      const existing = await findBookingByIdemKey(ctx, idemKey);
      if (existing) {
        // Clean up the orphan guest we just inserted — the winning replay
        // already has its own guest row.
        await rollbackBooking(ctx, { guestId: guest.id });
        return existing;
      }
    }
    // Hard failure: roll back the guest we inserted so it doesn't sit orphaned.
    await rollbackBooking(ctx, { guestId: guest.id });
    return JSON.stringify({
      ok: false,
      error: `Gagal membuat booking: ${bErr?.message ?? "tidak diketahui"}`,
    });
  }

  // ── Assign rooms (resolved above, guaranteed non-null) ────────────────────────
  const brRows = assignments.map((a) => ({
    booking_id: booking.id,
    room_id: a.roomId,
    room_type_id: a.roomTypeId,
    nightly_rate: a.rate,
  }));
  const { error: brErr } = await (ctx.supabaseAdmin as any).from("booking_rooms").insert(brRows);

  if (brErr) {
    // Partial state: booking row landed, booking_rooms didn't. Roll back so we
    // don't leave a roomless booking sitting in the table.
    await rollbackBooking(ctx, { bookingId: booking.id, guestId: guest.id });
    // 23P01 = exclusion_violation. The DB-level booking_rooms_no_overlap
    // constraint caught a race we would have otherwise missed: another
    // booking grabbed one of these rooms for an overlapping range between
    // our pickAvailableRooms() and this insert. Surface as a retry hint.
    if ((brErr as any)?.code === "23P01") {
      return JSON.stringify({
        ok: false,
        error:
          "Kamar baru saja diambil booking lain di tanggal yang sama. " +
          "Coba ulangi — tool akan memilih kamar lain yang masih kosong.",
      });
    }
    return JSON.stringify({
      ok: false,
      error: `Gagal menyimpan detail kamar: ${brErr.message}`,
    });
  }

  // ── Race detection — see if a concurrent caller grabbed the same room ────
  // Window: between pickAvailableRooms() and the insert above, another tool
  // call could have observed the same rooms as free and inserted them too.
  // Without a DB-level exclusion constraint, we detect post-write and roll
  // back if we lost the race.
  let conflictRoomIds: string[];
  try {
    conflictRoomIds = await detectRoomConflicts(
      ctx,
      booking.id,
      assignments.map((a) => a.roomId),
      checkIn,
      checkOut,
    );
  } catch (e) {
    await rollbackBooking(ctx, { bookingId: booking.id, guestId: guest.id });
    const msg = e instanceof Error ? e.message : String(e);
    return JSON.stringify({
      ok: false,
      error: `Gagal memverifikasi konflik kamar setelah booking dibuat: ${msg}`,
    });
  }
  if (conflictRoomIds.length > 0) {
    await rollbackBooking(ctx, { bookingId: booking.id, guestId: guest.id });
    const conflictNames = assignments.filter((a) => conflictRoomIds.includes(a.roomId)).map((a) => a.roomTypeName);
    return JSON.stringify({
      ok: false,
      error:
        `Kamar ${conflictNames.join(", ")} baru saja diambil booking lain saat ` +
        `kita mau finalisasi. Coba ulangi — tool akan memilih kamar yang masih kosong.`,
    });
  }

  // ── Upsert the invoice record (no WhatsApp send) ────────────────────────────
  // The Finance Agent now owns the in-chat invoice delivery via the
  // `send_invoice` tool, so this call passes skipWhatsApp:true. We still need
  // it to keep the `invoices` table in sync (admin reporting, snapshot,
  // future email channel) — only the duplicate WA message is suppressed.
  const upsertInvoiceRecord = async () => {
    try {
      const { generateAndSendInvoiceNotification } = await import("@/services/invoice-notification.service");
      const res = await generateAndSendInvoiceNotification({
        supabase: ctx.supabaseAdmin as any,
        bookingId: booking.id,
        origin: ctx.origin,
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

  // Format room type display for returned JSON
  const finalRoomTypeDisplay =
    roomsToBook.length > 0
      ? roomsToBook.map((r) => `${r.quantity}x ${r.roomTypeName}`).join(", ")
      : assignments[0].roomTypeName;

  // ── Return success payload ─────────────────────────────────────────────────
  // Backwards-compat: single-room callers still get `room_type` (joined string)
  // and `nightly_rate` from the first allocation. Multi-room callers also get
  // a structured `rooms` array + `room_count`.
  const roomsByType = new Map<string, { name: string; rate: number; count: number }>();
  for (const a of assignments) {
    const slot = roomsByType.get(a.roomTypeId) ?? { name: a.roomTypeName, rate: a.rate, count: 0 };
    slot.count += 1;
    roomsByType.set(a.roomTypeId, slot);
  }
  const roomsPayload = Array.from(roomsByType.values()).map((s) => ({
    room_type: s.name,
    quantity: s.count,
    rate_per_night: s.rate,
    subtotal: s.rate * s.count * nights,
  }));
  const roomCount = assignments.length;

  return JSON.stringify({
    ok: true,
    reference_code: booking.reference_code,
    room_type: finalRoomTypeDisplay,
    rooms: roomsPayload,
    room_count: roomCount,
    check_in: checkIn,
    check_out: checkOut,
    check_in_tampil: fmtDateID(checkIn),
    check_out_tampil: fmtDateID(checkOut),
    nights,
    nightly_rate: assignments[0].rate,
    total,
    paid_amount: initialPaidAmount,
    payment_status: initialPaymentStatus,
    remaining_amount: Math.max(0, total - initialPaidAmount),
    guest: { full_name: fullName, email, phone },
    pembayaran: {
      bank: ctx.property.payment_bank_name ?? null,
      no_rekening: ctx.property.payment_account_number ?? null,
      atas_nama: ctx.property.payment_account_holder ?? null,
    },
    invoice_url: (() => {
      const pDom = (ctx.property?.public_domain as string | undefined)?.trim();
      const base = pDom
        ? (pDom.startsWith("http") ? pDom : `https://${pDom}`).replace(/\/+$/, "")
        : ctx.origin
          ? ctx.origin.replace(/\/+$/, "")
          : "https://pomahguesthouse.com";
      return `${base}/book/confirmation/${booking.reference_code ?? booking.id}`;
    })(),
  });
};
