import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/* eslint-disable @typescript-eslint/no-explicit-any */

export const getCalendarData = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: any) => d)
  .handler(async ({ context }: any) => {
    const { supabase } = context;
    const [roomTypesRes, roomsRes, bookingsRes] = await Promise.all([
      supabase.from("room_types").select("*").order("name"),
      supabase.from("rooms").select("*").order("number"),
      supabase
        .from("bookings")
        .select("*, guests(*), booking_rooms(id, room_id, room_type_id, nightly_rate)")
        .neq("status", "cancelled"),
    ]);

    // The calendar grid is per-room. A booking now spans several rooms,
    // so flatten each booking into one entry per room — the entries keep
    // the parent booking's id, dates, status and guest.
    const bookings: any[] = [];
    for (const b of bookingsRes.data ?? []) {
      const rooms = (b as any).booking_rooms ?? [];
      if (rooms.length === 0) {
        // Fallback for legacy bookings or bookings imported without booking_rooms
        bookings.push({
          ...b,
          booking_rooms: undefined,
          booking_room_id: null,
          room_id: null,
          // b.room_type_id should be present on the booking table if it was used
          nightly_rate: b.nightly_rate || (b.total_amount ? b.total_amount / Math.max(1, b.nights || 1) : 0),
        });
      } else {
        for (const br of rooms) {
          bookings.push({
            ...b,
            booking_rooms: undefined,
            booking_room_id: br.id,
            room_id: br.room_id,
            room_type_id: br.room_type_id,
            nightly_rate: br.nightly_rate,
          });
        }
      }
    }

    return {
      roomTypes: roomTypesRes.data ?? [],
      rooms: roomsRes.data ?? [],
      bookings,
    };
  });

export const createBookingFromAdmin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: any) => d)
  .handler(async ({ data, context }: any) => {
    const { supabase } = context;
    const { data: g } = await supabase
      .from("guests")
      .insert({ full_name: data.guestName })
      .select("id")
      .single();
    const { data: r } = await supabase
      .from("rooms")
      .select("room_type_id, room_types(property_id)")
      .eq("id", data.roomId)
      .single();

    const nights = Math.max(
      1,
      Math.round(
        (Date.parse(`${data.checkOut}T00:00:00Z`) - Date.parse(`${data.checkIn}T00:00:00Z`)) /
          86_400_000,
      ),
    );

    const { data: booking } = await supabase
      .from("bookings")
      .insert({
        property_id: (r as any).room_types.property_id,
        guest_id: g?.id,
        check_in: data.checkIn,
        check_out: data.checkOut,
        nights,
        status: data.status,
        total_amount: data.nightlyRate * nights,
        source: "direct",
      })
      .select("id")
      .single();

    await supabase.from("booking_rooms").insert({
      booking_id: booking?.id,
      room_id: data.roomId,
      room_type_id: r?.room_type_id,
      nightly_rate: data.nightlyRate,
    });
    return { ok: true };
  });

export const updateBookingFromAdmin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: any) => d)
  .handler(async ({ data, context }: any) => {
    const { supabase } = context;
    await supabase.from("bookings").update({ status: data.status }).eq("id", data.id);
    // Assign (or clear) the physical room on the booking_rooms line.
    if (data.bookingRoomId) {
      await supabase
        .from("booking_rooms")
        .update({ room_id: data.roomId || null })
        .eq("id", data.bookingRoomId);
    }
    return { ok: true };
  });
