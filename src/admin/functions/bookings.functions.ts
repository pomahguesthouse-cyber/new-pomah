import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** Untyped client view — for columns absent from the generated types. */
function db(client: unknown): SupabaseClient {
  return client as SupabaseClient;
}

const listBookingsSchema = z.object({
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(20),
  status: z.enum(["pending", "confirmed", "checked_in", "checked_out", "cancelled"]).optional(),
  source: z.enum(["direct", "whatsapp", "walk_in", "website"]).optional(),
  search: z.string().trim().max(120).optional(),
});

const ZERO_UUID = "00000000-0000-0000-0000-000000000000";
/** Rooms of a booking, via the booking_rooms child table. */
const BOOKING_ROOMS_SELECT =
  "booking_rooms(id, room_id, nightly_rate, room_types(id, name), rooms(id, number))";
const FULL_BOOKING_SELECT = `id, reference_code, check_in, check_out, status, source, total_amount, adults, children, payment_status, paid_amount, internal_notes, special_requests, guests(id, full_name, email, phone, country), ${BOOKING_ROOMS_SELECT}`;
const BASE_BOOKING_SELECT = `id, check_in, check_out, status, source, total_amount, adults, children, special_requests, guests(id, full_name, email, phone), ${BOOKING_ROOMS_SELECT}`;

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
      if (data.source) q = q.eq("source", data.source);
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
      if (data.source) q = q.eq("source", data.source);
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
      .select("id, number, status, notes, room_types(id, name, base_rate, capacity)")
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

    // Resolve room_type per selected room (single batched query)
    const roomIds = data.rooms.map((r) => r.room_id);
    const { data: roomRows, error: roomsErr } = await context.supabase
      .from("rooms")
      .select("id, room_type_id")
      .in("id", roomIds);
    if (roomsErr) throw roomsErr;
    const roomTypeById = new Map<string, string>();
    for (const r of roomRows ?? []) roomTypeById.set(r.id, r.room_type_id);

    let grandTotal = data.rooms.reduce((sum, r) => sum + Number(r.nightly_rate) * nights, 0);
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
      };
    });
    const { error: brErr } = await context.supabase.from("booking_rooms").insert(roomInserts);
    if (brErr) throw brErr;

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
      }),
    )
    .min(1, "Pilih minimal 1 kamar")
    .max(20),
});

export const updateBookingFull = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => updateBookingFullSchema.parse(d))
  .handler(async ({ data, context }) => {
    const nights =
      (Date.parse(`${data.check_out}T00:00:00Z`) - Date.parse(`${data.check_in}T00:00:00Z`)) /
      86_400_000;
    if (!Number.isFinite(nights) || nights < 1) {
      throw new Error("Tanggal check-out harus setelah check-in");
    }
    let total_amount = data.rooms.reduce((s, r) => s + Number(r.nightly_rate) * nights, 0);
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
      .select("id, room_type_id")
      .in("id", roomIds);
    if (rErr) throw rErr;
    const roomTypeById = new Map<string, string>();
    for (const r of roomRows ?? []) roomTypeById.set(r.id, r.room_type_id);

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
      };
    });
    const { error: insErr } = await context.supabase.from("booking_rooms").insert(roomInserts);
    if (insErr) throw insErr;

    return { ok: true, total_amount, nights };
  });

export const listRoomTypes = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await db(context.supabase)
      .from("room_types")
      .select(
        "id, name, slug, description, bed_type, size_sqm, capacity, base_rate, amenities, hero_image_url, images",
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
  size_sqm: z.number().int().min(0).max(10000).nullable().optional(),
  capacity: z.number().int().min(1).max(20),
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
    size_sqm: d.size_sqm ?? null,
    capacity: d.capacity,
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
