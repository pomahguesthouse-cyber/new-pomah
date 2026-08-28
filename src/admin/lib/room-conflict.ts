/**
 * Guard bentrok kamar untuk alur admin (buat/edit booking).
 * Logika deteksi ada di `@/lib/room-availability` supaya sama dengan
 * precheck di sisi orkestrator/AI.
 */
import {
  describeRoomConflicts,
  findRoomConflicts,
  type RoomConflictParams,
} from "@/lib/room-availability";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

/**
 * Melempar error berbahasa Indonesia bila salah satu kamar sudah terisi
 * booking aktif lain pada rentang tanggal yang diminta.
 */
export async function assertRoomsFree(supabase: Db, params: RoomConflictParams): Promise<void> {
  const conflicts = await findRoomConflicts(supabase, params);
  if (conflicts.length === 0) return;

  throw new Error(
    `Kamar sudah terisi pada ${params.checkIn} – ${params.checkOut}: ` +
      `${describeRoomConflicts(conflicts)}. Pilih kamar/unit lain atau ubah tanggalnya.`,
  );
}
