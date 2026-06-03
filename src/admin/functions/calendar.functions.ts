import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { generateAndSendInvoiceNotification } from "@/services/invoice-notification.service";

/* eslint-disable @typescript-eslint/no-explicit-any */

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Tanggal harus dalam format YYYY-MM-DD");

const createBookingFromAdminSchema = z.object({
  guestName: z.string().trim().min(2, "Nama tamu wajib diisi").max(120),
  roomId: z.string().uuid("Room ID tidak valid"),
  checkIn: dateSchema,
  checkOut: dateSchema,
  nightlyRate: z.coerce.number().min(0, "Harga kamar tidak boleh negatif"),
  status: z.enum(["pending", "confirmed", "checked_in", "checked_out", "cancelled"]),
});

const updateBookingFromAdminSchema = z.object({
  id: z.string().uuid("Booking ID tidak valid"),
  bookingRoomId: z.string().uuid("Booking room ID tidak valid").optional().nullable(),
  roomId: z.string().uuid("Room ID tidak valid").optional().nullable(),
  status: z.enum(["pending", "confirmed", "checked_in", "checked_out", "cancelled"]),
});

const activeBookingStatuses = ["pending", "confirmed", "checked_in"] as const;

function calculateNights(checkIn: string, checkOut: string) {
  const checkInMs = Date.parse(`${checkIn}T00:00:00Z`);
  const checkOutMs = Date.parse(`${checkOut}T00:00:00Z`);

  if (!Number.isFinite(checkInMs) || !Number.isFinite(checkOutMs)) {
    throw new Error("Tanggal booking tidak valid.");
  }

  const nights = Math.round((checkOutMs - checkInMs) / 86_400_000);

  if (nights < 1) {
    throw new Error("Tanggal check-out harus setelah tanggal check-in.");
  }

  return nights;
}

async function assertRoomIsAvailable({
  supabase,
  roomId,
  checkIn,
  checkOut,
  excludeBookingId,
}: {
  supabase: any;
  roomId: string;
  checkIn: string;
  checkOut: string;
  excludeBookingId?: string | null;
}) {
  let query = supabase
    .from("booking_rooms")
    .select("booking_id, bookings!inner(id, reference_code, check_in, check_out, status)")
    .eq("room_id", roomId)
    .in("bookings.status", activeBookingStatuses)
    .lt("bookings.check_in", checkOut)
    .gt("bookings.check_out", checkIn)
    .limit(1);

  if (excludeBookingId) {
    query = query.neq("booking_id", excludeBookingId);
  }

  const { data, error } = await query;
  if (error) throw error;

  const conflict = data?.[0]?.bookings;
  if (conflict) {
    const reference = conflict.reference_code ? ` (${conflict.reference_code})` : "";
    throw new Error(
      `Kamar sudah terpakai pada ${conflict.check_in} sampai ${conflict.check_out}${reference}. Pilih kamar atau tanggal lain.`,
    );
  }
}

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
  .inputValidator((d) => createBookingFromAdminSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    calculateNights(data.checkIn, data.checkOut);

    const { data: bookingId, error } = await supabase.rpc("create_admin_booking_with_lock", {
      p_guest_name: data.guestName,
      p_room_id: data.roomId,
      p_check_in: data.checkIn,
      p_check_out: data.checkOut,
      p_nightly_rate: data.nightlyRate,
      p_status: data.status,
    });

    if (error) throw error;
    if (!bookingId) throw new Error("Booking gagal dibuat. Database tidak mengembalikan booking ID.");

    // Kirim invoice + link konfirmasi ke tamu via WhatsApp secara otomatis
    void generateAndSendInvoiceNotification({
      supabase,
      bookingId,
      skipWhatsApp: false,
    }).catch((err) =>
      console.warn("[createBookingFromAdmin] Notifikasi invoice gagal (non-fatal):", err),
    );

    // Beritahu manager (fire-and-forget).
    void import("@/services/manager-notifier.service")
      .then(({ notifyNewBooking }) => notifyNewBooking(supabase, bookingId))
      .catch((err) =>
        console.warn("[createBookingFromAdmin] notifyNewBooking gagal (non-fatal):", err),
      );

    return { ok: true, bookingId };
  });

export const updateBookingFromAdmin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => updateBookingFromAdminSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase } = context;

    const { data: currentBooking, error: currentBookingError } = await supabase
      .from("bookings")
      .select("id, check_in, check_out")
      .eq("id", data.id)
      .single();
    if (currentBookingError) throw currentBookingError;

    if (data.roomId) {
      await assertRoomIsAvailable({
        supabase,
        roomId: data.roomId,
        checkIn: currentBooking.check_in,
        checkOut: currentBooking.check_out,
        excludeBookingId: data.id,
      });
    }

    const { error: bookingUpdateError } = await supabase
      .from("bookings")
      .update({ status: data.status })
      .eq("id", data.id);
    if (bookingUpdateError) throw bookingUpdateError;

    // Assign (or clear) the physical room on the booking_rooms line.
    if (data.bookingRoomId) {
      const { error: bookingRoomUpdateError } = await supabase
        .from("booking_rooms")
        .update({ room_id: data.roomId || null })
        .eq("id", data.bookingRoomId);
      if (bookingRoomUpdateError) throw bookingRoomUpdateError;
    }

    return { ok: true };
  });
