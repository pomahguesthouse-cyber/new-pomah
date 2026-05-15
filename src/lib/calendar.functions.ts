import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const getCalendarData = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }: any) => {
    const { supabase } = context;
    const [roomTypesRes, roomsRes, bookingsRes] = await Promise.all([
      supabase.from("room_types").select("*").order("name"),
      supabase.from("rooms").select("*").order("number"),
      supabase.from("bookings")
        .select("*, guests(*)")
        .neq("status", "cancelled"),
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
    
    // Logic: Tidak dianggap bentrok jika Check-in baru == Check-out lama (14:00 vs 12:00)
    const { data: conflicts } = await supabase.from("bookings")
      .select("id")
      .eq("room_id", data.roomId)
      .neq("status", "cancelled")
      .lt("check_in", data.checkOut)
      .gt("check_out", data.checkIn);

    if (conflicts && conflicts.length > 0) throw new Error("Kamar sudah terisi pada tanggal tersebut");

    // Pembuatan tamu otomatis
    const { data: guest } = await supabase.from("guests")
      .insert({ full_name: data.guestName }).select("id").single();

    const { data: room } = await supabase.from("rooms").select("room_type_id, room_types(property_id)")
      .eq("id", data.roomId).single();

    await supabase.from("bookings").insert({
      property_id: (room as any).room_types.property_id,
      room_type_id: room?.room_type_id,
      room_id: data.roomId,
      guest_id: guest?.id,
      check_in: data.checkIn,
      check_out: data.checkOut,
      status: "confirmed",
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