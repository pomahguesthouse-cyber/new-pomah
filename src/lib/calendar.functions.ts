import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");

export const getCalendarData = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ from: isoDate, to: isoDate }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const [roomTypesRes, roomsRes, bookingsRes] = await Promise.all([
      supabase.from("room_types").select("*").order("name"),
      supabase.from("rooms").select("*").order("number"),
      supabase.from("bookings")
        .select("*, guests(*)") // Baris ini memastikan data tamu ikut terbawa
        .lt("check_in", data.to)
        .gt("check_out", data.from)
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
    
    // Logika Conflict: Check-in 14:00 & Check-out 12:00
    // (NewIn < OldOut) AND (NewOut > OldIn)
    const { data: conflicts } = await supabase.from("bookings")
      .select("id")
      .eq("room_id", data.roomId)
      .neq("status", "cancelled")
      .lt("check_in", data.checkOut)
      .gt("check_out", data.checkIn)
      .limit(1);

    if (conflicts && conflicts.length > 0) throw new Error("Conflict: Room already booked for these dates");

    // Cari atau buat guest baru
    let guestId: string | null = null;
    const { data: existingGuest } = await supabase.from("guests")
      .select("id")
      .or(`email.eq.${data.guestEmail},phone.eq.${data.guestPhone}`)
      .maybeSingle();

    if (existingGuest) {
      guestId = existingGuest.id;
    } else {
      const { data: newGuest, error: gErr } = await supabase.from("guests")
        .insert({ full_name: data.guestName, email: data.guestEmail || null, phone: data.guestPhone || null })
        .select("id").single();
      if (gErr) throw gErr;
      guestId = newGuest.id;
    }

    // Resolve room type & property
    const { data: room } = await supabase.from("rooms").select("room_type_id, room_types(property_id)").eq("id", data.roomId).single();

    // Insert booking
    const { error: bErr } = await supabase.from("bookings").insert({
      property_id: (room as any).room_types.property_id,
      room_type_id: room?.room_type_id,
      room_id: data.roomId,
      guest_id: guestId,
      check_in: data.checkIn,
      check_out: data.checkOut,
      status: data.status,
      nightly_rate: data.nightlyRate,
      total_amount: data.nightlyRate, // Sederhanakan untuk contoh
      source: "direct",
      special_requests: data.notes || null
    });

    if (bErr) throw bErr;
    return { ok: true };
  });

export const updateBookingFromAdmin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }: any) => {
    const { supabase } = context;
    const { error } = await supabase.from("bookings").update({
      check_in: data.checkIn,
      check_out: data.checkOut,
      room_id: data.roomId,
      status: data.status,
      special_requests: data.notes || null
    }).eq("id", data.id);
    if (error) throw error;
    return { ok: true };
  });