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
      supabase.from("room_types").select("id, name, base_rate, capacity").order("name"),
      supabase.from("rooms").select("id, number, room_type_id, status").order("number"),
      supabase
        .from("bookings")
        .select("id, check_in, check_out, status, source, room_id, room_type_id, adults, children, nightly_rate, total_amount, special_requests, guests(id, full_name, email, phone)")
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
  .inputValidator(z.object({
    roomId: z.string().uuid(),
    checkIn: isoDate,
    checkOut: isoDate,
    guestName: z.string().min(1),
    guestEmail: z.string().email().optional().or(z.literal("")),
    guestPhone: z.string().optional().or(z.literal("")),
    adults: z.number().int().min(1),
    children: z.number().int().min(0),
    nightlyRate: z.number().min(0),
    status: z.enum(["pending", "confirmed", "checked_in"]).default("confirmed"),
    notes: z.string().optional().or(z.literal("")),
  }))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    if (data.checkOut <= data.checkIn) throw new Error("Check-out must be after check-in");

    // Konflik: Hanya bentrok jika (NewIn < OldOut) AND (NewOut > OldIn)
    const { data: conflicts } = await supabase
      .from("bookings")
      .select("id")
      .eq("room_id", data.roomId)
      .neq("status", "cancelled")
      .lt("check_in", data.checkOut) // Baru masuk sebelum lama keluar
      .gt("check_out", data.checkIn) // Baru keluar setelah lama masuk
      .limit(1);

    if (conflicts && conflicts.length > 0) throw new Error("Room already booked");

    // Logika Guest & Insert tetap sama ...
    // (Tambahkan logika pencarian/pembuatan guest di sini sesuai file asli Bapak)
    
    return { ok: true };
  });