/**
 * Precheck bentrok kamar — sumber tunggal untuk semua kanal
 * (admin UI, tool AI create_booking, Telegram/WhatsApp manager).
 *
 * Database punya jaring terakhir berupa exclusion constraint
 * `booking_rooms_no_overlap`. Precheck ini mencegah constraint itu sering
 * terpicu (yang berujung insert + rollback dan pesan error mentah).
 */

// Klien Supabase (generated types berbeda antar konteks) — cukup minimal di sini.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

const ACTIVE_STATUSES = ["pending", "confirmed", "checked_in"];

export interface RoomConflict {
  roomId: string;
  roomNumber: string | null;
  bookingId: string;
  referenceCode: string | null;
  checkIn: string;
  checkOut: string;
}

export interface RoomConflictParams {
  roomIds: string[];
  checkIn: string;
  checkOut: string;
  excludeBookingId?: string;
}

/**
 * Mengembalikan daftar bentrok kamar pada rentang tanggal yang diminta.
 * Array kosong = aman disimpan. Bila query gagal, array kosong juga
 * dikembalikan (constraint DB tetap menjaga integritas).
 */
export async function findRoomConflicts(
  supabase: Db,
  params: RoomConflictParams,
): Promise<RoomConflict[]> {
  const roomIds = params.roomIds.filter(Boolean);
  if (roomIds.length === 0) return [];

  let query = supabase
    .from("booking_rooms")
    .select(
      "room_id, check_in, check_out, booking_id, rooms(number), bookings(reference_code)",
    )
    .in("room_id", roomIds)
    .in("booking_status", ACTIVE_STATUSES)
    .lt("check_in", params.checkOut)
    .gt("check_out", params.checkIn);

  if (params.excludeBookingId) query = query.neq("booking_id", params.excludeBookingId);

  const { data, error } = await query;
  if (error) {
    console.warn("[room-availability] gagal cek bentrok kamar:", error.message);
    return [];
  }

  return ((data ?? []) as Array<Record<string, any>>).map((r) => ({
    roomId: String(r.room_id),
    roomNumber: r.rooms?.number ?? null,
    bookingId: String(r.booking_id),
    referenceCode: r.bookings?.reference_code ?? null,
    checkIn: String(r.check_in),
    checkOut: String(r.check_out),
  }));
}

/** Ringkasan bentrok yang siap ditampilkan ke admin/agent. */
export function describeRoomConflicts(conflicts: RoomConflict[]): string {
  return conflicts
    .map((c) => `${c.roomNumber ?? "kamar"} (dipakai ${c.referenceCode ?? "booking lain"})`)
    .filter((v, i, arr) => arr.indexOf(v) === i)
    .join(", ");
}
