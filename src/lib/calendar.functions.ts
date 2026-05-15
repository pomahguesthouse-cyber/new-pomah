import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const getCalendarData = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }: any) => {
    const { supabase } = context;
    const [roomTypesRes, roomsRes, bookingsRes] = await Promise.all([
      supabase.from("room_types").select("*").order("name"),
      supabase.from("rooms").select("*").order("number"),
      supabase.from("bookings")
        .select("*, guests(*)") // Penting: Ambil detail tamu
        .neq("status", "cancelled"),
    ]);
    return {
      roomTypes: roomTypesRes.data ?? [],
      rooms: roomsRes.data ?? [],
      bookings: bookingsRes.data ?? [],
    };
  });