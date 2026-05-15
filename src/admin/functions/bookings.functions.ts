import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const listBookings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    // Try the full select (including the columns added by the
    // 20260515130000 payment migration). If those columns aren't
    // present yet (42703 = undefined_column) fall back to the base
    // shape so the page still renders. Same applies to reference_code
    // from the 20260515120000 migration.
    const FULL =
      "id, reference_code, check_in, check_out, status, source, total_amount, nightly_rate, adults, children, payment_status, paid_amount, internal_notes, special_requests, room_id, guests(id, full_name, email, phone, country), room_types(id, name), rooms(id, number)";
    const BASE =
      "id, check_in, check_out, status, source, total_amount, nightly_rate, adults, children, special_requests, room_id, guests(id, full_name, email, phone), room_types(id, name), rooms(id, number)";

    const tryFull = await context.supabase
      .from("bookings")
      .select(FULL)
      .order("check_in", { ascending: false })
      .limit(100);

    if (!tryFull.error) {
      return { bookings: tryFull.data ?? [], degraded: false };
    }
    if ((tryFull.error as any).code !== "42703") {
      throw tryFull.error;
    }

    const fallback = await context.supabase
      .from("bookings")
      .select(BASE)
      .order("check_in", { ascending: false })
      .limit(100);
    if (fallback.error) throw fallback.error;
    return { bookings: fallback.data ?? [], degraded: true };
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

    // Resolve room_type per room (single batched query)
    const roomIds = data.rooms.map((r) => r.room_id);
    const { data: roomRows, error: roomsErr } = await context.supabase
      .from("rooms")
      .select("id, room_type_id")
      .in("id", roomIds);
    if (roomsErr) throw roomsErr;
    const roomTypeById = new Map<string, string>();
    for (const r of roomRows ?? []) roomTypeById.set(r.id, r.room_type_id);

    // Compute per-row total + paid distribution
    const totalsPerRoom = data.rooms.map((r) => Number(r.nightly_rate) * nights);
    const grandTotal = totalsPerRoom.reduce((a, b) => a + b, 0);

    function paidForIdx(i: number): number {
      if (data.payment_status === "unpaid") return 0;
      if (data.payment_status === "paid") return totalsPerRoom[i];
      // partial: distribute pro-rata, last row absorbs rounding
      if (grandTotal === 0) return 0;
      if (i < data.rooms.length - 1) {
        return Math.round((totalsPerRoom[i] / grandTotal) * data.paid_amount);
      }
      const sumPrev = data.rooms
        .slice(0, -1)
        .reduce(
          (acc, _r, j) => acc + Math.round((totalsPerRoom[j] / grandTotal) * data.paid_amount),
          0,
        );
      return Math.max(0, data.paid_amount - sumPrev);
    }

    const inserts = data.rooms.map((r, i) => {
      const room_type_id = roomTypeById.get(r.room_id);
      if (!room_type_id) throw new Error(`Kamar ${r.room_id} tidak ditemukan`);
      return {
        property_id: property.id,
        room_id: r.room_id,
        room_type_id,
        guest_id: guestId!,
        check_in: data.check_in,
        check_out: data.check_out,
        adults: data.adults,
        children: data.children,
        nightly_rate: r.nightly_rate,
        total_amount: totalsPerRoom[i],
        status: data.status,
        source: data.source,
        payment_status: data.payment_status,
        paid_amount: paidForIdx(i),
        special_requests: data.special_requests || null,
        internal_notes: data.internal_notes || null,
      };
    });

    const { data: createdRows, error: insertErr } = await context.supabase
      .from("bookings")
      .insert(inserts)
      .select("id, reference_code, room_id");
    if (insertErr) throw insertErr;

    return {
      guest_id: guestId,
      bookings: createdRows ?? [],
      nights,
      grand_total: grandTotal,
    };
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
  room_id: z.string().uuid().optional().nullable(),
  check_in: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  check_out: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  adults: z.number().int().min(1).max(20),
  children: z.number().int().min(0).max(20),
  status: BOOKING_STATUS,
  source: BOOKING_SOURCE,
  payment_status: PAYMENT_STATUS,
  paid_amount: z.number().min(0),
  nightly_rate: z.number().min(0).max(100_000_000),
  special_requests: z.string().max(2000).optional().nullable(),
  internal_notes: z.string().max(2000).optional().nullable(),
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
    const total_amount = data.nightly_rate * nights;

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

    // Resolve room_type from new room (kalau diganti)
    let room_type_id: string | undefined;
    if (data.room_id) {
      const { data: roomRow, error: rErr } = await context.supabase
        .from("rooms")
        .select("room_type_id")
        .eq("id", data.room_id)
        .single();
      if (rErr) throw rErr;
      room_type_id = roomRow?.room_type_id;
    }

    const patch: Record<string, unknown> = {
      check_in: data.check_in,
      check_out: data.check_out,
      adults: data.adults,
      children: data.children,
      status: data.status,
      source: data.source,
      payment_status: data.payment_status,
      paid_amount: data.payment_status === "paid" ? total_amount : data.paid_amount,
      nightly_rate: data.nightly_rate,
      total_amount,
      room_id: data.room_id ?? null,
      special_requests: data.special_requests || null,
      internal_notes: data.internal_notes || null,
    };
    if (room_type_id) patch.room_type_id = room_type_id;

    const { error: bErr } = await context.supabase.from("bookings").update(patch).eq("id", data.id);
    if (bErr) throw bErr;

    return { ok: true, total_amount, nights };
  });

export const listRoomTypes = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("room_types")
      .select("id, name, base_rate, capacity")
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
      if ((error as any).code === "23505") {
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
      if ((error as any).code === "23505") {
        throw new Error(`Nomor kamar "${data.number}" sudah ada untuk tipe ini.`);
      }
      throw error;
    }
    return { ok: true };
  });

const roomTypeUpdateSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(120),
  description: z.string().max(2000).nullable().optional(),
  bed_type: z.string().max(60).nullable().optional(),
  size_sqm: z.number().int().min(0).max(10000).nullable().optional(),
  capacity: z.number().int().min(1).max(20),
  base_rate: z.number().min(0).max(100_000_000),
  amenities: z.array(z.string().min(1).max(60)).max(40).nullable().optional(),
  hero_image_url: z.string().url().max(500).nullable().optional(),
});

export const updateRoomType = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => roomTypeUpdateSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { id, ...patch } = data;
    const { error } = await context.supabase
      .from("room_types")
      .update({
        name: patch.name,
        description: patch.description ?? null,
        bed_type: patch.bed_type ?? null,
        size_sqm: patch.size_sqm ?? null,
        capacity: patch.capacity,
        base_rate: patch.base_rate,
        amenities: patch.amenities ?? null,
        hero_image_url: patch.hero_image_url ?? null,
      })
      .eq("id", id);
    if (error) throw error;
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
      if ((error as any).code === "23503") {
        throw new Error("Tidak bisa hapus: kamar masih direferensikan oleh data lain.");
      }
      throw error;
    }
    return { ok: true };
  });
