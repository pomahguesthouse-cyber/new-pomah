import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { generateAndSendInvoiceNotification } from "@/services/invoice-notification.service";

/* eslint-disable @typescript-eslint/no-explicit-any */

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Tanggal harus dalam format YYYY-MM-DD");
const bookingStatusSchema = z.enum(["pending", "confirmed", "checked_in", "checked_out", "cancelled", "expired"]);

/**
 * Ubah error Postgres/PostgREST menjadi pesan yang bisa ditindaklanjuti admin.
 *
 * Sebelumnya error dilempar mentah dan UI hanya menampilkan "Gagal menyimpan
 * booking." — admin tidak tahu apakah kamarnya bentrok, migrasinya belum
 * dijalankan, atau izinnya kurang. Pesan RPC sendiri sudah berbahasa Indonesia
 * dan informatif, jadi untuk error yang kita raise sendiri cukup diteruskan.
 */
function describeBookingRpcError(error: unknown): string {
  const err = (error ?? {}) as { code?: string; message?: string; details?: string; hint?: string };
  const raw = (err.message ?? "").trim();

  switch (err.code) {
    case "23P01": // exclusion_violation — kamar bentrok (di-raise RPC atau constraint)
      return raw || "Kamar sudah terpakai pada rentang tanggal itu. Pilih kamar atau tanggal lain.";
    case "22023": // invalid_parameter_value — validasi di dalam RPC
    case "P0002": // no_data_found — kamar/property tidak ketemu
      return raw || "Data booking tidak valid. Periksa kamar dan tanggalnya.";
    case "42883":
      return (
        "Fungsi database `create_admin_booking_with_lock` tidak ditemukan. " +
        "Migrasi Supabase kemungkinan belum dijalankan di environment ini."
      );
    case "42501":
      return (
        "Akun ini tidak punya izin menjalankan pembuatan booking. " +
        "Periksa GRANT EXECUTE pada fungsi `create_admin_booking_with_lock`."
      );
    case "23502": // not_null_violation
      return `Ada kolom wajib yang kosong saat menyimpan booking${err.details ? ` (${err.details})` : ""}.`;
    case "23503": // foreign_key_violation
      return "Kamar atau properti yang dipilih tidak ditemukan di database.";
    default:
      break;
  }

  if (raw) return raw;
  return "Gagal menyimpan booking — database tidak memberikan detail error.";
}

const createBookingFromAdminSchema = z.object({
  guestName: z.string().trim().min(2, "Nama tamu wajib diisi").max(120),
  roomId: z.string().uuid("Room ID tidak valid"),
  checkIn: dateSchema,
  checkOut: dateSchema,
  nightlyRate: z.coerce.number().min(0, "Harga kamar tidak boleh negatif"),
  status: bookingStatusSchema,
});

const updateBookingFromAdminSchema = z.object({
  id: z.string().uuid("Booking ID tidak valid"),
  bookingRoomId: z.string().uuid("Booking room ID tidak valid").optional().nullable(),
  roomId: z.string().uuid("Room ID tidak valid").optional().nullable(),
  status: bookingStatusSchema,
});

const bookingIdSchema = z.object({
  id: z.string().uuid("Booking ID tidak valid"),
});

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

async function updateBookingStatusWithLock({
  supabase,
  bookingId,
  bookingRoomId = null,
  roomId = null,
  status,
}: {
  supabase: any;
  bookingId: string;
  bookingRoomId?: string | null;
  roomId?: string | null;
  status: z.infer<typeof bookingStatusSchema>;
}) {
  const { error } = await supabase.rpc("update_booking_room_with_lock", {
    p_booking_id: bookingId,
    p_booking_room_id: bookingRoomId,
    p_room_id: roomId,
    p_status: status,
  });

  if (error) throw error;
}

export const getCalendarData = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: any) => d)
  .handler(async ({ context, data }: any) => {
    const { supabase } = context;
    // Rentang tanggal diteruskan oleh pemanggil (from/to YYYY-MM-DD). Ambil
    // stop_sell harian dalam rentang ini supaya kalender bisa menampilkan
    // bar "Blokir" per tipe kamar — sumber yang sama dengan chatbot WA/Telegram.
    const from = data?.from as string | undefined;
    const to = data?.to as string | undefined;

    const [roomTypesRes, roomsRes, bookingsRes, blocksRes] = await Promise.all([
      supabase.from("room_types").select("*").order("name"),
      supabase.from("rooms").select("*").order("number"),
      supabase
        .from("bookings")
        .select("*, guests(*), booking_rooms(id, room_id, room_type_id, nightly_rate)")
        .neq("status", "cancelled"),
      from && to
        ? supabase
            .from("room_daily_rates")
            .select("room_type_id, date, note")
            .eq("stop_sell", true)
            .gte("date", from)
            .lte("date", to)
        : Promise.resolve({ data: [], error: null }),
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
      // Bar stop_sell untuk ditampilkan sebagai "Blokir" di kalender.
      blocks: (blocksRes.data ?? []) as Array<{
        room_type_id: string;
        date: string;
        note: string | null;
      }>,
    };
  });

export const createBookingFromAdmin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => createBookingFromAdminSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    calculateNights(data.checkIn, data.checkOut);

    const { data: bookingId, error } = (await (supabase as any).rpc("create_admin_booking_with_lock", {
      p_guest_name: data.guestName,
      p_room_id: data.roomId,
      p_check_in: data.checkIn,
      p_check_out: data.checkOut,
      p_nightly_rate: data.nightlyRate,
      p_status: data.status,
    })) as { data: string | null; error: any };

    if (error) {
      console.error("[createBookingFromAdmin] RPC gagal:", {
        code: error?.code,
        message: error?.message,
        details: error?.details,
        hint: error?.hint,
        payload: { roomId: data.roomId, checkIn: data.checkIn, checkOut: data.checkOut },
      });
      throw new Error(describeBookingRpcError(error));
    }
    if (!bookingId) throw new Error("Booking gagal dibuat. Database tidak mengembalikan booking ID.");

    // Kirim invoice + link konfirmasi ke tamu via WhatsApp secara otomatis
    void generateAndSendInvoiceNotification({
      supabase,
      bookingId,
      skipWhatsApp: false,
    }).catch((err) =>
      console.warn("[createBookingFromAdmin] Notifikasi invoice gagal (non-fatal):", err),
    );

    // Beritahu manager — pakai waitUntil agar tetap jalan setelah response dikirim.
    const { runDeferred } = await import("@/lib/cf-context");
    runDeferred("createBookingFromAdmin.notifyNewBooking", async () => {
      const { notifyNewBooking } = await import("@/services/manager-notifier.service");
      await notifyNewBooking(supabase, bookingId);
    });

    return { ok: true, bookingId };
  });

export const updateBookingFromAdmin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => updateBookingFromAdminSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { snapshotBookingForDiff, notifyBookingUpdated } = await import(
      "@/services/manager-notifier.service"
    );
    const beforeSnap = data.roomId
      ? await snapshotBookingForDiff(context.supabase, data.id)
      : null;

    await updateBookingStatusWithLock({
      supabase: context.supabase,
      bookingId: data.id,
      bookingRoomId: data.bookingRoomId ?? null,
      roomId: data.roomId ?? null,
      status: data.status,
    });

    // Status changes punya flow notifikasinya sendiri; di sini hanya alert
    // bila terjadi reassignment kamar.
    if (data.roomId) {
      const { runDeferred } = await import("@/lib/cf-context");
      runDeferred("updateBookingFromAdmin.notifyBookingUpdated", async () => {
        const afterSnap = await snapshotBookingForDiff(context.supabase, data.id);
        await notifyBookingUpdated(
          context.supabase,
          data.id,
          beforeSnap,
          afterSnap,
          "Admin (Calendar)",
        );
      });
    }

    return { ok: true };
  });

export const cancelBookingFromAdmin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => bookingIdSchema.parse(d))
  .handler(async ({ data, context }) => {
    await updateBookingStatusWithLock({
      supabase: context.supabase,
      bookingId: data.id,
      status: "cancelled",
    });

    return { ok: true };
  });

export const checkInBookingFromAdmin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => bookingIdSchema.parse(d))
  .handler(async ({ data, context }) => {
    await updateBookingStatusWithLock({
      supabase: context.supabase,
      bookingId: data.id,
      status: "checked_in",
    });

    return { ok: true };
  });

export const checkOutBookingFromAdmin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => bookingIdSchema.parse(d))
  .handler(async ({ data, context }) => {
    await updateBookingStatusWithLock({
      supabase: context.supabase,
      bookingId: data.id,
      status: "checked_out",
    });

    return { ok: true };
  });
