import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const getCalendarData = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }: any) => {
    const { supabase } = context;
    const [roomTypesRes, roomsRes, bookingsRes] = await Promise.all([
      supabase.from("room_types").select("*").order("name"),
      supabase.from("rooms").select("*").order("number"),
      supabase.from("bookings").select("*, guests(*)").neq("status", "cancelled"),
    ]);
    return {
      roomTypes: roomTypesRes.data ?? [],
      rooms: roomsRes.data ?? [],
      bookings: bookingsRes.data ?? [],
    };
  });

export const createBookingFromAdmin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }: any) => {
    const { supabase } = context;
    // Otomatis buat guest sederhana
    const { data: g } = await supabase.from("guests").insert({ full_name: data.guestName }).select("id").single();
    const { data: r } = await supabase.from("rooms").select("room_type_id, room_types(property_id)").eq("id", data.roomId).single();

    await supabase.from("bookings").insert({
      property_id: (r as any).room_types.property_id,
      room_type_id: r?.room_type_id,
      room_id: data.roomId,
      guest_id: g?.id,
      check_in: data.checkIn,
      check_out: data.checkOut,
      status: data.status,
      nightly_rate: data.nightlyRate,
      total_amount: data.nightlyRate,
      source: "direct"
    });
    return { ok: true };
  });

export const updateBookingFromAdmin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }: any) => {
    await context.supabase.from("bookings").update({ status: data.status }).eq("id", data.id);
    return { ok: true };
  });