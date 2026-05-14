import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const listBookings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("bookings")
      .select(
        "id, check_in, check_out, status, source, total_amount, nightly_rate, adults, children, guests(id, full_name, email, phone), room_types(id, name)",
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
