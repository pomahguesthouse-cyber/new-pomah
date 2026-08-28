/**
 * Guard bentrok kamar (exclusion constraint `booking_rooms_no_overlap`).
 *
 * Tanpa guard ini, admin mendapat pesan mentah dari database
 * ("conflicting key value violates exclusion constraint ...") saat memilih
 * kamar yang sudah dipakai booking lain pada tanggal yang sama.
 */

// Klien Supabase dari server fn context; tipenya di-generate, cukup minimal di sini.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

const ACTIVE_STATUSES = ["pending", "confirmed", "checked_in"];

export interface RoomConflictParams {
  roomIds: string[];
  checkIn: string;
  checkOut: string;
  excludeBookingId?: string;
}

/**
 * Melempar error berbahasa Indonesia bila salah satu kamar sudah terisi
 * booking aktif lain pada rentang tanggal yang diminta.
 */
export async function assertRoomsFree(supabase: Db, params: RoomConflictParams): Promise<void> {
  const roomIds = params.roomIds.filter(Boolean);
  if (roomIds.length === 0) return;

  let query = supabase
    .from("booking_rooms")
    .select("room_id, check_in, check_out, booking_id, rooms(number), bookings(reference_code)")
    .in("room_id", roomIds)
    .in("booking_status", ACTIVE_STATUSES)
    .lt("check_in", params.checkOut)
    .gt("check_out", params.checkIn);

  if (params.excludeBookingId) query = query.neq("booking_id", params.excludeBookingId);

  const { data, error } = await query;
  // Kegagalan query tidak boleh memblokir penyimpanan — constraint DB tetap
  // menjadi jaring terakhir.
  if (error) {
    console.warn("[room-conflict] gagal cek bentrok kamar:", error.message);
    return;
  }

  const rows = (data ?? []) as Array<{
    rooms?: { number?: string | null } | null;
    bookings?: { reference_code?: string | null } | null;
  }>;
  if (rows.length === 0) return;

  const details = rows
    .map((r) => {
      const number = r.rooms?.number ?? "kamar ini";
      const ref = r.bookings?.reference_code ?? "booking lain";
      return `${number} (dipakai ${ref})`;
    })
    .filter((v, i, arr) => arr.indexOf(v) === i);

  throw new Error(
    `Kamar sudah terisi pada ${params.checkIn} – ${params.checkOut}: ${details.join(", ")}. ` +
      "Pilih kamar/unit lain atau ubah tanggalnya.",
  );
}
