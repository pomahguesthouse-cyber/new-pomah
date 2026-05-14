import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");

export const getCalendarData = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({ from: isoDate, to: isoDate }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;

    const [roomTypesRes, roomsRes, bookingsRes] = await Promise.all([
      supabase.from("room_types").select("id, name, base_rate, capacity").order("name"),
      supabase.from("rooms").select("id, number, room_type_id, status").order("number"),
      // Bookings overlapping the window: check_in < to AND check_out > from
      supabase
        .from("bookings")
        .select(
          "id, check_in, check_out, status, source, room_id, room_type_id, adults, children, nightly_rate, total_amount, special_requests, guests(id, full_name, email, phone)",
        )
        .lt("check_in", data.to)
        .gt("check_out", data.from)
        .neq("status", "cancelled"),
    ]);

    if (roomTypesRes.error) throw roomTypesRes.error;
    if (roomsRes.error) throw roomsRes.error;
    if (bookingsRes.error) throw bookingsRes.error;

    return {
      roomTypes: roomTypesRes.data ?? [],
      rooms: roomsRes.data ?? [],
      bookings: bookingsRes.data ?? [],
    };
  });

export const createBookingFromAdmin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        roomId: z.string().uuid(),
        checkIn: isoDate,
        checkOut: isoDate,
        guestName: z.string().min(1).max(120),
        guestEmail: z.string().email().optional().or(z.literal("")),
        guestPhone: z.string().max(40).optional().or(z.literal("")),
        adults: z.number().int().min(1).max(20),
        children: z.number().int().min(0).max(20),
        nightlyRate: z.number().min(0),
        status: z.enum(["pending", "confirmed", "checked_in"]).default("confirmed"),
        notes: z.string().max(2000).optional().or(z.literal("")),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;

    if (data.checkOut <= data.checkIn) {
      throw new Error("Check-out must be after check-in");
    }

    // Resolve property + room_type from room
    const { data: room, error: roomErr } = await supabase
      .from("rooms")
      .select("id, room_type_id, room_types(property_id)")
      .eq("id", data.roomId)
      .single();
    if (roomErr || !room) throw new Error("Room not found");
    const propertyId = (room as any).room_types?.property_id;
    if (!propertyId) throw new Error("Property not found for room");

    // Conflict check: any non-cancelled booking on same room overlapping window
    const { data: conflicts } = await supabase
      .from("bookings")
      .select("id")
      .eq("room_id", data.roomId)
      .neq("status", "cancelled")
      .lt("check_in", data.checkOut)
      .gt("check_out", data.checkIn)
      .limit(1);
    if (conflicts && conflicts.length > 0) {
      throw new Error("Room already booked for those dates");
    }

    // Find or create guest by email/phone
    let guestId: string | null = null;
    if (data.guestEmail) {
      const { data: g } = await supabase
        .from("guests")
        .select("id")
        .eq("email", data.guestEmail)
        .maybeSingle();
      if (g) guestId = g.id;
    }
    if (!guestId && data.guestPhone) {
      const { data: g } = await supabase
        .from("guests")
        .select("id")
        .eq("phone", data.guestPhone)
        .maybeSingle();
      if (g) guestId = g.id;
    }
    if (!guestId) {
      const { data: g, error: gErr } = await supabase
        .from("guests")
        .insert({
          full_name: data.guestName,
          email: data.guestEmail || null,
          phone: data.guestPhone || null,
        })
        .select("id")
        .single();
      if (gErr || !g) throw new Error(gErr?.message ?? "Failed to create guest");
      guestId = g.id;
    }

    const nights = Math.max(
      1,
      Math.round(
        (new Date(data.checkOut).getTime() - new Date(data.checkIn).getTime()) /
          (1000 * 60 * 60 * 24),
      ),
    );
    const total = Number((data.nightlyRate * nights).toFixed(2));

    const { data: booking, error: bErr } = await supabase
      .from("bookings")
      .insert({
        property_id: propertyId,
        room_type_id: room.room_type_id,
        room_id: data.roomId,
        guest_id: guestId,
        check_in: data.checkIn,
        check_out: data.checkOut,
        adults: data.adults,
        children: data.children,
        nightly_rate: data.nightlyRate,
        total_amount: total,
        status: data.status,
        source: "direct",
        special_requests: data.notes || null,
      })
      .select("id")
      .single();

    if (bErr || !booking) throw new Error(bErr?.message ?? "Failed to create booking");

    await supabase.from("booking_events").insert({
      booking_id: booking.id,
      type: "created_from_calendar",
      payload: { source: "admin_calendar" },
    });

    return { id: booking.id };
  });

export const updateBookingFromAdmin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        id: z.string().uuid(),
        checkIn: isoDate,
        checkOut: isoDate,
        roomId: z.string().uuid(),
        status: z.enum(["pending", "confirmed", "checked_in", "checked_out", "cancelled"]),
        nightlyRate: z.number().min(0),
        notes: z.string().max(2000).optional().or(z.literal("")),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    if (data.checkOut <= data.checkIn) throw new Error("Check-out must be after check-in");

    if (data.status !== "cancelled") {
      const { data: conflicts } = await supabase
        .from("bookings")
        .select("id")
        .eq("room_id", data.roomId)
        .neq("status", "cancelled")
        .neq("id", data.id)
        .lt("check_in", data.checkOut)
        .gt("check_out", data.checkIn)
        .limit(1);
      if (conflicts && conflicts.length > 0) {
        throw new Error("Room already booked for those dates");
      }
    }

    const { data: room } = await supabase
      .from("rooms")
      .select("room_type_id")
      .eq("id", data.roomId)
      .single();

    const nights = Math.max(
      1,
      Math.round(
        (new Date(data.checkOut).getTime() - new Date(data.checkIn).getTime()) /
          (1000 * 60 * 60 * 24),
      ),
    );
    const total = Number((data.nightlyRate * nights).toFixed(2));

    const { error } = await supabase
      .from("bookings")
      .update({
        check_in: data.checkIn,
        check_out: data.checkOut,
        room_id: data.roomId,
        room_type_id: room?.room_type_id ?? undefined,
        status: data.status,
        nightly_rate: data.nightlyRate,
        total_amount: total,
        special_requests: data.notes || null,
      })
      .eq("id", data.id);
    if (error) throw error;

    await supabase.from("booking_events").insert({
      booking_id: data.id,
      type: "updated_from_calendar",
      payload: { status: data.status },
    });

    return { ok: true };
  });
