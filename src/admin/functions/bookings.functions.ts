import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { generateAndSendInvoiceNotification } from "@/services/invoice-notification.service";

/** Untyped client view — for columns absent from the generated types. */
function db(client: unknown): SupabaseClient {
  return client as SupabaseClient;
}

const listBookingsSchema = z.object({
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(20),
  status: z.enum(["pending", "confirmed", "checked_in", "checked_out", "cancelled"]).optional(),
  source: z.enum(["direct", "whatsapp", "walk_in", "website", "manager_chat"]).optional(),
  search: z.string().trim().max(120).optional(),
});

const exportBookingsSchema = z.object({
  status: z.enum(["pending", "confirmed", "checked_in", "checked_out", "cancelled"]).optional(),
  source: z.enum(["direct", "whatsapp", "walk_in", "website", "manager_chat"]).optional(),
  search: z.string().trim().max(120).optional(),
  // Optional date-range filter on check_in.
  from:   z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to:     z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

const ZERO_UUID = "00000000-0000-0000-0000-000000000000";
/** Rooms of a booking, via the booking_rooms child table. */
const BOOKING_ROOMS_SELECT =
  "booking_rooms(id, room_id, nightly_rate, extra_bed_count, extra_bed_rate, room_types(id, name), rooms(id, number))";
const FULL_BOOKING_SELECT = `id, reference_code, check_in, check_out, created_at, status, source, total_amount, adults, children, payment_status, paid_amount, internal_notes, special_requests, guests(id, full_name, email, phone, country), ${BOOKING_ROOMS_SELECT}`;
const BASE_BOOKING_SELECT = `id, check_in, check_out, created_at, status, source, total_amount, adults, children, special_requests, guests(id, full_name, email, phone), ${BOOKING_ROOMS_SELECT}`;

export const listBookings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => listBookingsSchema.parse(d ?? {}))
  .handler(async ({ data, context }) => {
    // Tries the full select (columns from the 20260515130000 payment
    // migration). If those columns aren't present yet (42703) it falls
    // back to the base shape so the page still renders.
    const from = (data.page - 1) * data.pageSize;
    const to = from + data.pageSize - 1;

    // For a text search, resolve matching guest ids first (works in any
    // migration state); reference_code is matched too when available.
    const search = data.search?.replace(/[,()*:%]/g, " ").trim() || "";
    let guestIds: string[] = [];
    if (search) {
      const { data: guests } = await context.supabase
        .from("guests")
        .select("id")
        .ilike("full_name", `%${search}%`)
        .limit(500);
      guestIds = (guests ?? []).map((g) => g.id);
    }

    /** PostgREST `or=` expression for the search term, or null. */
    const searchOr = (includeRef: boolean): string | null => {
      if (!search) return null;
      const ors: string[] = [];
      if (includeRef) ors.push(`reference_code.ilike.*${search}*`);
      if (guestIds.length) ors.push(`guest_id.in.(${guestIds.join(",")})`);
      return ors.length ? ors.join(",") : null;
    };

    // ---- attempt 1: full select ----
    {
      let q = context.supabase.from("bookings").select(FULL_BOOKING_SELECT, { count: "exact" });
      if (data.status) q = q.eq("status", data.status);
      if (data.source) q = q.eq("source", data.source as never);
      if (search) {
        const or = searchOr(true);
        q = or ? q.or(or) : q.eq("id", ZERO_UUID);
      }
      const res = await q.order("check_in", { ascending: false }).range(from, to);
      if (!res.error) {
        return {
          bookings: res.data ?? [],
          total: res.count ?? 0,
          page: data.page,
          pageSize: data.pageSize,
          degraded: false,
        };
      }
      if ((res.error as { code?: string }).code !== "42703") throw res.error;
    }

    // ---- attempt 2: base select (no payment / reference columns) ----
    {
      let q = context.supabase.from("bookings").select(BASE_BOOKING_SELECT, { count: "exact" });
      if (data.status) q = q.eq("status", data.status);
      if (data.source) q = q.eq("source", data.source as never);
      if (search) {
        const or = searchOr(false);
        q = or ? q.or(or) : q.eq("id", ZERO_UUID);
      }
      const res = await q.order("check_in", { ascending: false }).range(from, to);
      if (res.error) throw res.error;
      return {
        bookings: res.data ?? [],
        total: res.count ?? 0,
        page: data.page,
        pageSize: data.pageSize,
        degraded: true,
      };
    }
  });

/**
 * Export bookings matching the given filters, no pagination, capped at
 * 5000 rows. Returns flat rows suitable for CSV/PDF rendering on the
 * client. Same filter shape as listBookings + optional check_in range.
 */
export const exportBookings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => exportBookingsSchema.parse(d ?? {}))
  .handler(async ({ data, context }) => {
    const MAX_ROWS = 5000;

    const search = data.search?.replace(/[,()*:%]/g, " ").trim() || "";
    let guestIds: string[] = [];
    if (search) {
      const { data: guests } = await context.supabase
        .from("guests")
        .select("id")
        .ilike("full_name", `%${search}%`)
        .limit(500);
      guestIds = (guests ?? []).map((g) => g.id);
    }
    const searchOr = (): string | null => {
      if (!search) return null;
      const ors: string[] = [`reference_code.ilike.*${search}*`];
      if (guestIds.length) ors.push(`guest_id.in.(${guestIds.join(",")})`);
      return ors.join(",");
    };

    let q = context.supabase.from("bookings").select(FULL_BOOKING_SELECT);
    if (data.status) q = q.eq("status", data.status);
    if (data.source) q = q.eq("source", data.source as never);
    if (data.from)   q = q.gte("check_in", data.from);
    if (data.to)     q = q.lte("check_in", data.to);
    if (search) {
      const or = searchOr();
      q = or ? q.or(or) : q.eq("id", ZERO_UUID);
    }
    const res = await q
      .order("check_in", { ascending: false })
      .limit(MAX_ROWS);
    if (res.error) throw res.error;

    // Flatten to a stable export shape — no nested objects, no nulls turning into "[object]".
    const rows = (res.data ?? []).map((b: any) => {
      const brs: any[] = Array.isArray(b.booking_rooms) ? b.booking_rooms : [];
      const roomLabels = brs.map((br) => {
        const name = br?.room_types?.name ?? "?";
        const num  = br?.rooms?.number;
        return num ? `${name} (${num})` : name;
      });
      const nightlyRates = brs.map((br) => Number(br?.nightly_rate ?? 0));
      const checkIn = b.check_in as string;
      const checkOut = b.check_out as string;
      const nights = checkIn && checkOut
        ? Math.max(0, Math.round((Date.parse(checkOut + "T00:00:00Z") - Date.parse(checkIn + "T00:00:00Z")) / 86_400_000))
        : 0;
      const total = Number(b.total_amount ?? 0);
      const paid  = Number(b.paid_amount  ?? 0);
      return {
        reference_code: b.reference_code ?? "",
        guest_name:     b.guests?.full_name ?? "",
        guest_email:    b.guests?.email ?? "",
        guest_phone:    b.guests?.phone ?? "",
        check_in:       checkIn ?? "",
        check_out:      checkOut ?? "",
        nights,
        rooms:          roomLabels.join("; "),
        room_count:     brs.length,
        adults:         Number(b.adults ?? 0),
        children:       Number(b.children ?? 0),
        status:         b.status,
        source:         b.source ?? "",
        payment_status: b.payment_status ?? "",
        total_amount:   total,
        paid_amount:    paid,
        outstanding:    Math.max(0, total - paid),
        nightly_rate_min: nightlyRates.length ? Math.min(...nightlyRates) : 0,
        nightly_rate_max: nightlyRates.length ? Math.max(...nightlyRates) : 0,
        created_at:     b.created_at ?? "",
      };
    });

    return {
      rows,
      count:    rows.length,
      capped:   rows.length >= MAX_ROWS,
      filters:  { status: data.status, source: data.source, search: search || null, from: data.from ?? null, to: data.to ?? null },
    };
  });

export const updateBookingStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        id: z.string().uuid(),
        status: z.enum(["pending", "confirmed", "checked_in", "checked_out", "cancelled"]),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("bookings")
      .update({ status: data.status })
      .eq("id", data.id);
    if (error) throw error;
    return { ok: true };
  });

export const deleteBooking = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("bookings").delete().eq("id", data.id);
    if (error) {
      if ((error as { code?: string }).code === "23503") {
        throw new Error("Tidak bisa hapus: booking masih direferensikan data lain.");
      }
      throw error;
    }
    return { ok: true };
  });

export const listRooms = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("rooms")
      .select("id, number, status, notes, room_types(id, name, base_rate, capacity, extrabed_capacity, extrabed_rate)")
      .order("number");
    if (error) throw error;
    return { rooms: data ?? [] };
  });

export const updateRoomStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        id: z.string().uuid(),
        status: z.enum(["clean", "dirty", "maintenance", "out_of_order"]),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("rooms")
      .update({ status: data.status })
      .eq("id", data.id);
    if (error) throw error;
    return { ok: true };
  });

const BOOKING_STATUS = z.enum(["pending", "confirmed", "checked_in", "checked_out", "cancelled"]);
const BOOKING_SOURCE = z.enum(["direct", "whatsapp", "walk_in", "website"]);
const PAYMENT_STATUS = z.enum(["unpaid", "partial", "paid"]);

/**
 * Kebijakan usia tamu Pomah: anak SD/SMP/SMA/mahasiswa dihitung sebagai
 * dewasa untuk kapasitas & extra bed. Hanya balita ≤5 thn yang TIDAK
 * dihitung. Field `children_under_5` bersifat opsional & backward-compatible
 * (default 0), sehingga request lama tetap valid tetapi tidak bisa
 * memanipulasi kapasitas dengan mengaku semua "children" berumur ≤5.
 */
type RoomCapMeta = { capacity: number; extrabedCap: number; name: string };

function assertGuestCapacity(
  adults: number,
  children: number,
  childrenUnder5: number,
  rooms: Array<{ room_id: string; extra_bed_count?: number | null }>,
  roomTypeById: Map<string, string>,
  typeMetaById: Map<string, RoomCapMeta>,
): void {
  const under5 = Math.min(Math.max(0, childrenUnder5), children);
  const countedGuests = adults + Math.max(0, children - under5);

  let baseCapacity = 0;
  let extraBedTotal = 0;
  for (const r of rooms) {
    const tid = roomTypeById.get(r.room_id);
    if (!tid) throw new Error(`Kamar ${r.room_id} tidak ditemukan`);
    const meta = typeMetaById.get(tid);
    if (!meta) throw new Error(`Metadata tipe kamar tidak ditemukan untuk ${r.room_id}`);
    baseCapacity += meta.capacity;
    extraBedTotal += Number(r.extra_bed_count ?? 0);
  }
  const totalCapacity = baseCapacity + extraBedTotal;
  if (countedGuests > totalCapacity) {
    throw new Error(
      `Jumlah tamu (${countedGuests} orang; balita ≤5 thn tidak dihitung) ` +
        `melebihi kapasitas kamar (${totalCapacity} = ${baseCapacity} dasar + ${extraBedTotal} extra bed). ` +
        `Tambah kamar/extra bed atau kurangi jumlah tamu.`,
    );
  }
}

const createMultiRoomBookingSchema = z.object({
  guest: z.object({
    id: z.string().uuid().optional().nullable(),
    full_name: z.string().trim().min(1).max(120),
    email: z.string().trim().max(200).optional().nullable(),
    phone: z.string().trim().max(40).optional().nullable(),
    country: z.string().trim().max(60).optional().nullable(),
  }),
  check_in: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  check_out: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  adults: z.number().int().min(1).max(20),
  children: z.number().int().min(0).max(20),
  children_under_5: z.number().int().min(0).max(20).optional().default(0),
  status: BOOKING_STATUS,
  source: BOOKING_SOURCE,
  payment_status: PAYMENT_STATUS,
  paid_amount: z.number().min(0),
  special_requests: z.string().max(2000).optional().nullable(),
  internal_notes: z.string().max(2000).optional().nullable(),
  rooms: z
    .array(
      z.object({
        room_id: z.string().uuid(),
        nightly_rate: z.number().min(0).max(100_000_000),
        extra_bed_count: z.number().int().min(0).max(10).default(0),
        extra_bed_rate: z.number().min(0).max(100_000_000).default(0),
      }),
    )
    .min(1, "Pilih minimal 1 kamar")
    .max(20),
});


export const createMultiRoomBooking = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => createMultiRoomBookingSchema.parse(d))
  .handler(async ({ data, context }) => {
    const nights =
      (Date.parse(`${data.check_out}T00:00:00Z`) - Date.parse(`${data.check_in}T00:00:00Z`)) /
      86_400_000;
    if (!Number.isFinite(nights) || nights < 1) {
      throw new Error("Tanggal check-out harus setelah check-in");
    }

    // Resolve property (single-property assumption used elsewhere)
    const { data: property, error: propErr } = await context.supabase
      .from("properties")
      .select("id")
      .limit(1)
      .single();
    if (propErr || !property) throw new Error("Property belum dikonfigurasi");

    // Resolve / create guest
    let guestId = data.guest.id ?? null;
    if (!guestId) {
      const { data: g, error: gErr } = await context.supabase
        .from("guests")
        .insert({
          full_name: data.guest.full_name,
          email: data.guest.email || null,
          phone: data.guest.phone || null,
          country: data.guest.country || null,
        })
        .select("id")
        .single();
      if (gErr || !g) throw gErr ?? new Error("Gagal menyimpan data tamu");
      guestId = g.id;
    } else {
      // Update existing guest's contact info if provided
      await context.supabase
        .from("guests")
        .update({
          full_name: data.guest.full_name,
          email: data.guest.email || null,
          phone: data.guest.phone || null,
          country: data.guest.country || null,
        })
        .eq("id", guestId);
    }

    // Resolve room_type + capacity per selected room (single batched query)
    const roomIds = data.rooms.map((r) => r.room_id);
    const { data: roomRows, error: roomsErr } = await context.supabase
      .from("rooms")
      .select("id, room_type_id, room_types(capacity, extrabed_capacity, name)")
      .in("id", roomIds);
    if (roomsErr) throw roomsErr;
    const roomTypeById = new Map<string, string>();
    const typeMetaById = new Map<string, RoomCapMeta>();
    for (const r of (roomRows ?? []) as any[]) {
      roomTypeById.set(r.id, r.room_type_id);
      const rt = Array.isArray(r.room_types) ? r.room_types[0] : r.room_types;
      if (rt && r.room_type_id && !typeMetaById.has(r.room_type_id)) {
        typeMetaById.set(r.room_type_id, {
          capacity: Number(rt.capacity ?? 0),
          extrabedCap: Number(rt.extrabed_capacity ?? 0),
          name: String(rt.name ?? "Kamar"),
        });
      }
    }

    // ── Extra bed capacity guard (per tipe kamar) ────────────────────────
    const perTypeReq = new Map<string, { requested: number; rooms: number }>();
    for (const r of data.rooms) {
      const tid = roomTypeById.get(r.room_id);
      if (!tid) throw new Error(`Kamar ${r.room_id} tidak ditemukan`);
      const cur = perTypeReq.get(tid) ?? { requested: 0, rooms: 0 };
      cur.requested += Number(r.extra_bed_count ?? 0);
      cur.rooms += 1;
      perTypeReq.set(tid, cur);
    }
    for (const [tid, agg] of perTypeReq) {
      const meta = typeMetaById.get(tid);
      if (!meta) continue;
      const maxAllowed = meta.extrabedCap * agg.rooms;
      if (agg.requested > 0 && meta.extrabedCap === 0) {
        throw new Error(`Tipe ${meta.name} tidak mendukung extra bed.`);
      }
      if (agg.requested > maxAllowed) {
        throw new Error(
          `Extra bed ${meta.name} melebihi kapasitas: diminta ${agg.requested}, ` +
            `maksimum ${maxAllowed} (${meta.extrabedCap}/kamar × ${agg.rooms} kamar).`,
        );
      }
    }

    // ── Guest capacity guard (usia policy: balita ≤5 thn tidak dihitung) ─
    assertGuestCapacity(
      data.adults,
      data.children,
      data.children_under_5 ?? 0,
      data.rooms,
      roomTypeById,
      typeMetaById,
    );


    let grandTotal = data.rooms.reduce(
      (sum, r) =>
        sum +
        Number(r.nightly_rate) * nights +
        Number(r.extra_bed_rate) * Number(r.extra_bed_count) * nights,
      0,
    );
    let finalPaidAmount = data.paid_amount;

    if (data.payment_status === "paid") {
      grandTotal = data.paid_amount;
      finalPaidAmount = data.paid_amount;
    } else if (data.payment_status === "unpaid") {
      finalPaidAmount = 0;
    }

    // 1 booking header covers every room in this reservation.
    const { data: booking, error: bookErr } = await context.supabase
      .from("bookings")
      .insert({
        property_id: property.id,
        guest_id: guestId,
        check_in: data.check_in,
        check_out: data.check_out,
        nights: Math.round(nights),
        adults: data.adults,
        children: data.children,
        total_amount: grandTotal,
        status: data.status,
        source: data.source,
        payment_status: data.payment_status,
        paid_amount: finalPaidAmount,
        special_requests: data.special_requests || null,
        internal_notes: data.internal_notes || null,
      })
      .select("id, reference_code")
      .single();
    if (bookErr || !booking) throw bookErr ?? new Error("Gagal membuat booking");

    // One booking_rooms row per room.
    const roomInserts = data.rooms.map((r) => {
      const room_type_id = roomTypeById.get(r.room_id);
      if (!room_type_id) throw new Error(`Kamar ${r.room_id} tidak ditemukan`);
      return {
        booking_id: booking.id,
        room_id: r.room_id,
        room_type_id,
        nightly_rate: r.nightly_rate,
        extra_bed_count: r.extra_bed_count ?? 0,
        extra_bed_rate: r.extra_bed_rate ?? 0,
      };
    });
    const { error: brErr } = await context.supabase.from("booking_rooms").insert(roomInserts);
    if (brErr) throw brErr;

    // Kirim invoice + link konfirmasi ke tamu via WhatsApp secara otomatis
    void generateAndSendInvoiceNotification({
      supabase: context.supabase,
      bookingId: booking.id,
      skipWhatsApp: false,
    }).catch((err) =>
      console.warn("[createMultiRoomBooking] Notifikasi invoice gagal (non-fatal):", err),
    );

    // Alert ke manager (WhatsApp + Telegram) — sama seperti booking via web/admin calendar
    const { runDeferred } = await import("@/lib/cf-context");
    runDeferred("createMultiRoomBooking.notifyNewBooking", async () => {
      const { notifyNewBooking } = await import("@/services/manager-notifier.service");
      await notifyNewBooking(context.supabase, booking.id);
    });

    return { guest_id: guestId, booking, nights, grand_total: grandTotal };
  });

const updateBookingFullSchema = z.object({
  id: z.string().uuid(),
  guest: z.object({
    id: z.string().uuid(),
    full_name: z.string().trim().min(1).max(120),
    email: z.string().trim().max(200).optional().nullable(),
    phone: z.string().trim().max(40).optional().nullable(),
    country: z.string().trim().max(60).optional().nullable(),
  }),
  check_in: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  check_out: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  adults: z.number().int().min(1).max(20),
  children: z.number().int().min(0).max(20),
  children_under_5: z.number().int().min(0).max(20).optional().default(0),
  status: BOOKING_STATUS,
  source: BOOKING_SOURCE,
  payment_status: PAYMENT_STATUS,
  paid_amount: z.number().min(0),
  special_requests: z.string().max(2000).optional().nullable(),
  internal_notes: z.string().max(2000).optional().nullable(),
  rooms: z
    .array(
      z.object({
        room_id: z.string().uuid(),
        nightly_rate: z.number().min(0).max(100_000_000),
        extra_bed_count: z.number().int().min(0).max(10).default(0),
        extra_bed_rate: z.number().min(0).max(100_000_000).default(0),
      }),
    )
    .min(1, "Pilih minimal 1 kamar")
    .max(20),
});

export const updateBookingFull = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => updateBookingFullSchema.parse(d))
  .handler(async ({ data, context }) => {
    // Snapshot sebelum mutasi untuk diff alert booking_updated.
    const { snapshotBookingForDiff, notifyBookingUpdated } = await import(
      "@/services/manager-notifier.service"
    );
    const beforeSnap = await snapshotBookingForDiff(context.supabase, data.id);

    const nights =
      (Date.parse(`${data.check_out}T00:00:00Z`) - Date.parse(`${data.check_in}T00:00:00Z`)) /
      86_400_000;
    if (!Number.isFinite(nights) || nights < 1) {
      throw new Error("Tanggal check-out harus setelah check-in");
    }
    let total_amount = data.rooms.reduce(
      (s, r) =>
        s +
        Number(r.nightly_rate) * nights +
        Number(r.extra_bed_rate ?? 0) * Number(r.extra_bed_count ?? 0) * nights,
      0,
    );
    let final_paid_amount = data.paid_amount;

    if (data.payment_status === "paid") {
      total_amount = data.paid_amount;
      final_paid_amount = data.paid_amount;
    } else if (data.payment_status === "unpaid") {
      final_paid_amount = 0;
    }

    // Update guest contact info
    const { error: gErr } = await context.supabase
      .from("guests")
      .update({
        full_name: data.guest.full_name,
        email: data.guest.email || null,
        phone: data.guest.phone || null,
        country: data.guest.country || null,
      })
      .eq("id", data.guest.id);
    if (gErr) throw gErr;

    // Resolve room types for the (possibly changed) room set
    const roomIds = data.rooms.map((r) => r.room_id);
    const { data: roomRows, error: rErr } = await context.supabase
      .from("rooms")
      .select("id, room_type_id, room_types(extrabed_capacity, name)")
      .in("id", roomIds);
    if (rErr) throw rErr;
    const roomTypeById = new Map<string, string>();
    const typeMetaById = new Map<string, { capPerRoom: number; name: string }>();
    for (const r of (roomRows ?? []) as any[]) {
      roomTypeById.set(r.id, r.room_type_id);
      const rt = Array.isArray(r.room_types) ? r.room_types[0] : r.room_types;
      if (rt && r.room_type_id && !typeMetaById.has(r.room_type_id)) {
        typeMetaById.set(r.room_type_id, {
          capPerRoom: Number(rt.extrabed_capacity ?? 0),
          name: String(rt.name ?? "Kamar"),
        });
      }
    }

    // ── Extra bed capacity guard ─────────────────────────────────────────
    const perTypeReq = new Map<string, { requested: number; rooms: number }>();
    for (const r of data.rooms) {
      const tid = roomTypeById.get(r.room_id);
      if (!tid) throw new Error(`Kamar ${r.room_id} tidak ditemukan`);
      const cur = perTypeReq.get(tid) ?? { requested: 0, rooms: 0 };
      cur.requested += Number(r.extra_bed_count ?? 0);
      cur.rooms += 1;
      perTypeReq.set(tid, cur);
    }
    for (const [tid, agg] of perTypeReq) {
      const meta = typeMetaById.get(tid);
      if (!meta) continue;
      const maxAllowed = meta.capPerRoom * agg.rooms;
      if (agg.requested > 0 && meta.capPerRoom === 0) {
        throw new Error(`Tipe ${meta.name} tidak mendukung extra bed.`);
      }
      if (agg.requested > maxAllowed) {
        throw new Error(
          `Extra bed ${meta.name} melebihi kapasitas: diminta ${agg.requested}, ` +
            `maksimum ${maxAllowed} (${meta.capPerRoom}/kamar × ${agg.rooms} kamar).`,
        );
      }
    }

    // Snapshot extra bed totals BEFORE mutation to detect changes for WA notify.
    const { data: beforeBrs } = await context.supabase
      .from("booking_rooms")
      .select("extra_bed_count")
      .eq("booking_id", data.id);
    const beforeExtraBedTotal = ((beforeBrs as any[]) ?? []).reduce(
      (s: number, r: any) => s + Number(r?.extra_bed_count ?? 0),
      0,
    );
    const afterExtraBedTotal = data.rooms.reduce(
      (s, r) => s + Number(r.extra_bed_count ?? 0),
      0,
    );

    const patch = {
      check_in: data.check_in,
      check_out: data.check_out,
      adults: data.adults,
      children: data.children,
      status: data.status,
      source: data.source,
      payment_status: data.payment_status,
      paid_amount: final_paid_amount,
      special_requests: data.special_requests ?? null,
      internal_notes: data.internal_notes ?? null,
      total_amount,
      nights,
    };
    const { error: bErr } = await context.supabase
      .from("bookings")
      .update(patch as never)
      .eq("id", data.id);
    if (bErr) throw bErr;

    // Replace the room set wholesale.
    const { error: delErr } = await context.supabase
      .from("booking_rooms")
      .delete()
      .eq("booking_id", data.id);
    if (delErr) throw delErr;

    const roomInserts = data.rooms.map((r) => {
      const room_type_id = roomTypeById.get(r.room_id);
      if (!room_type_id) throw new Error(`Kamar ${r.room_id} tidak ditemukan`);
      return {
        booking_id: data.id,
        room_id: r.room_id,
        room_type_id,
        nightly_rate: r.nightly_rate,
        extra_bed_count: r.extra_bed_count ?? 0,
        extra_bed_rate: r.extra_bed_rate ?? 0,
      };
    });
    const { error: insErr } = await context.supabase.from("booking_rooms").insert(roomInserts);
    if (insErr) throw insErr;

    // Fix 2: Silently regenerate the stored PDF so the invoice record stays
    // in sync with the latest payment status. We do NOT re-send WhatsApp here
    // to avoid flooding the guest — admin can do that explicitly via resendInvoice.
    void generateAndSendInvoiceNotification({
      supabase: context.supabase,
      bookingId: data.id,
      skipWhatsApp: true,
    }).catch((err) =>
      console.warn("[bookings] PDF regen failed (non-fatal):", err),
    );

    // Alert ke manager bila tanggal / jumlah tamu / kamar berubah.
    const { runDeferred } = await import("@/lib/cf-context");
    runDeferred("updateBookingFull.notifyBookingUpdated", async () => {
      const afterSnap = await snapshotBookingForDiff(context.supabase, data.id);
      await notifyBookingUpdated(context.supabase, data.id, beforeSnap, afterSnap, "Admin");
    });

    // Kirim ringkasan WhatsApp ke tamu bila konfigurasi extra bed berubah.
    if (beforeExtraBedTotal !== afterExtraBedTotal) {
      runDeferred("updateBookingFull.extraBedSummary", async () => {
        const { sendExtraBedUpdateSummary } = await import(
          "@/services/invoice-notification.service"
        );
        await sendExtraBedUpdateSummary({
          supabase: context.supabase,
          bookingId: data.id,
          changedBy: "Admin",
        });
      });
    }

    return { ok: true, total_amount, nights };
  });

/**
 * Regenerate the invoice PDF and send it via WhatsApp.
 * Called explicitly by admin (e.g. "Kirim Ulang Invoice" button).
 */
export const resendInvoice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ bookingId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const result = await generateAndSendInvoiceNotification({
      supabase: context.supabase,
      bookingId: data.bookingId,
      skipWhatsApp: false,
    });
    if (!result.ok) throw new Error(result.error ?? "Gagal generate invoice");
    return { ok: true, pdf_url: result.pdf_url, wa_sent: result.wa_sent };
  });

export const listRoomTypes = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await db(context.supabase)
      .from("room_types")
      .select(
        "id, name, slug, description, bed_type, floor_info, size_sqm, capacity, extrabed_capacity, extrabed_rate, base_rate, amenities, hero_image_url, images",
      )
      .order("name");
    if (error) throw error;
    return { roomTypes: data ?? [] };
  });

const ROOM_STATUS = z.enum(["clean", "dirty", "maintenance", "out_of_order"]);

const roomInputSchema = z.object({
  room_type_id: z.string().uuid(),
  number: z.string().trim().min(1, "Nomor kamar wajib diisi").max(20),
  status: ROOM_STATUS,
  notes: z.string().max(500).optional().nullable(),
});

export const createRoom = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => roomInputSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase
      .from("rooms")
      .insert({
        room_type_id: data.room_type_id,
        number: data.number,
        status: data.status,
        notes: data.notes ?? null,
      })
      .select("id")
      .single();
    if (error) {
      // 23505 = unique_violation (room_type_id, number) UNIQUE constraint
      if ((error as { code?: string }).code === "23505") {
        throw new Error(`Nomor kamar "${data.number}" sudah ada untuk tipe ini.`);
      }
      throw error;
    }
    return { id: row?.id };
  });

export const updateRoom = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => roomInputSchema.extend({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("rooms")
      .update({
        room_type_id: data.room_type_id,
        number: data.number,
        status: data.status,
        notes: data.notes ?? null,
      })
      .eq("id", data.id);
    if (error) {
      if ((error as { code?: string }).code === "23505") {
        throw new Error(`Nomor kamar "${data.number}" sudah ada untuk tipe ini.`);
      }
      throw error;
    }
    return { ok: true };
  });

/** Shared editable fields of a room type (used by create + update). */
const roomTypeFieldsSchema = z.object({
  name: z.string().trim().min(1).max(120),
  slug: z
    .string()
    .trim()
    .min(1)
    .max(140)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Slug hanya boleh huruf kecil, angka, dan tanda hubung"),
  description: z.string().max(2000).nullable().optional(),
  bed_type: z.string().max(60).nullable().optional(),
  floor_info: z.string().max(120).nullable().optional(),
  size_sqm: z.number().int().min(0).max(10000).nullable().optional(),
  capacity: z.number().int().min(1).max(20),
  extrabed_capacity: z.number().int().min(0).max(10).default(0),
  extrabed_rate: z.number().min(0).max(100_000_000).default(0),
  base_rate: z.number().min(0).max(100_000_000),
  amenities: z.array(z.string().min(1).max(60)).max(40).nullable().optional(),
  hero_image_url: z.string().url().max(500).nullable().optional().or(z.literal("")),
  images: z.array(z.string().url().max(500)).max(30).nullable().optional(),
});

/** Map a validated room-type payload to a DB row patch. */
function roomTypeRow(d: z.infer<typeof roomTypeFieldsSchema>) {
  return {
    name: d.name,
    slug: d.slug,
    description: d.description ?? null,
    bed_type: d.bed_type ?? null,
    floor_info: d.floor_info ?? null,
    size_sqm: d.size_sqm ?? null,
    capacity: d.capacity,
    extrabed_capacity: d.extrabed_capacity,
    extrabed_rate: d.extrabed_rate,
    base_rate: d.base_rate,
    amenities: d.amenities ?? [],
    images: d.images ?? [],
    // The first gallery image is the cover; keep hero_image_url synced.
    hero_image_url: d.images?.[0] ?? (d.hero_image_url || null),
  };
}

export const createRoomType = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => roomTypeFieldsSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { data: property, error: propErr } = await context.supabase
      .from("properties")
      .select("id")
      .limit(1)
      .single();
    if (propErr || !property) throw new Error("Property belum dikonfigurasi");

    const { data: row, error } = await db(context.supabase)
      .from("room_types")
      .insert({ property_id: property.id, ...roomTypeRow(data) })
      .select("id")
      .single();
    if (error) {
      if ((error as { code?: string }).code === "23505") {
        throw new Error(`Slug "${data.slug}" sudah dipakai tipe kamar lain.`);
      }
      throw error;
    }
    return { id: row?.id };
  });

export const updateRoomType = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => roomTypeFieldsSchema.extend({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { id, ...fields } = data;
    const { error } = await db(context.supabase)
      .from("room_types")
      .update(roomTypeRow(fields))
      .eq("id", id);
    if (error) {
      if ((error as { code?: string }).code === "23505") {
        throw new Error(`Slug "${data.slug}" sudah dipakai tipe kamar lain.`);
      }
      throw error;
    }
    return { ok: true };
  });

/** List the room numbers belonging to a room type. */
export const listRoomNumbers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ room_type_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("rooms")
      .select("number")
      .eq("room_type_id", data.room_type_id)
      .order("number");
    if (error) throw error;
    return { numbers: (rows ?? []).map((r) => r.number as string) };
  });

/**
 * Sync the room numbers of a room type: create the new ones, delete the
 * removed ones. Rooms still referenced by bookings cannot be deleted.
 */
export const setRoomNumbers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        room_type_id: z.string().uuid(),
        numbers: z.array(z.string().trim().min(1).max(20)).max(200),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const wanted = [...new Set(data.numbers.map((n) => n.trim()).filter(Boolean))];
    const { data: existing, error: e1 } = await context.supabase
      .from("rooms")
      .select("id, number")
      .eq("room_type_id", data.room_type_id);
    if (e1) throw e1;

    const rows = existing ?? [];
    const have = new Set(rows.map((r) => r.number as string));
    const toAdd = wanted.filter((n) => !have.has(n));
    const toDelete = rows.filter((r) => !wanted.includes(r.number as string));

    if (toAdd.length) {
      const { error } = await context.supabase.from("rooms").insert(
        toAdd.map((number) => ({
          room_type_id: data.room_type_id,
          number,
          status: "clean" as const,
        })),
      );
      if (error) {
        if ((error as { code?: string }).code === "23505") {
          throw new Error("Ada nomor kamar yang sudah dipakai tipe lain.");
        }
        throw error;
      }
    }
    if (toDelete.length) {
      const { error } = await context.supabase
        .from("rooms")
        .delete()
        .in(
          "id",
          toDelete.map((r) => r.id),
        );
      if (error) {
        if ((error as { code?: string }).code === "23503") {
          throw new Error("Sebagian nomor kamar masih dipakai booking dan tidak bisa dihapus.");
        }
        throw error;
      }
    }
    return { ok: true, added: toAdd.length, removed: toDelete.length };
  });

export const deleteRoomType = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    // Refuse if any room still uses this type (the FK cascades, so a
    // silent delete would wipe those rooms — guard explicitly instead).
    const { count: roomCount, error: rErr } = await context.supabase
      .from("rooms")
      .select("id", { count: "exact", head: true })
      .eq("room_type_id", data.id);
    if (rErr) throw rErr;
    if ((roomCount ?? 0) > 0) {
      throw new Error(
        `Tidak bisa hapus: masih ada ${roomCount} kamar bertipe ini. Hapus kamarnya dulu.`,
      );
    }

    // Refuse if any booking references this type.
    const { count: bookingCount, error: bErr } = await context.supabase
      .from("bookings")
      .select("id", { count: "exact", head: true })
      .eq("room_type_id", data.id);
    if (bErr) throw bErr;
    if ((bookingCount ?? 0) > 0) {
      throw new Error(`Tidak bisa hapus: masih ada ${bookingCount} booking bertipe ini.`);
    }

    const { error } = await context.supabase.from("room_types").delete().eq("id", data.id);
    if (error) {
      if ((error as { code?: string }).code === "23503") {
        throw new Error("Tidak bisa hapus: tipe kamar masih direferensikan data lain.");
      }
      throw error;
    }
    return { ok: true };
  });

export const deleteRoom = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    // Cek apakah masih ada booking (non-cancelled) di kamar ini
    const { count, error: countErr } = await context.supabase
      .from("bookings")
      .select("id", { count: "exact", head: true })
      .eq("room_id", data.id)
      .neq("status", "cancelled");
    if (countErr) throw countErr;
    if ((count ?? 0) > 0) {
      throw new Error(
        `Tidak bisa hapus: kamar masih punya ${count} booking aktif. Batalkan atau pindahkan dulu.`,
      );
    }

    const { error } = await context.supabase.from("rooms").delete().eq("id", data.id);
    if (error) {
      if ((error as { code?: string }).code === "23503") {
        throw new Error("Tidak bisa hapus: kamar masih direferensikan oleh data lain.");
      }
      throw error;
    }
    return { ok: true };
  });
