import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const listBookings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("bookings")
      .select(
        "id, reference_code, check_in, check_out, status, source, total_amount, nightly_rate, adults, children, guests(id, full_name, email, phone), room_types(id, name)",
      )
      .order("check_in", { ascending: false })
      .limit(100);
    if (error) throw error;
    return { bookings: data ?? [] };
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
  .inputValidator((d) =>
    roomInputSchema.extend({ id: z.string().uuid() }).parse(d),
  )
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
