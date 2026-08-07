/**
 * Default jumlah tamu berdasarkan kapasitas kamar yang dipilih.
 *
 * Permintaan operasional 7 Agu 2026: invoice harus mencerminkan kapasitas kamar
 * ketika tamu tidak menyebut jumlah orang — Deluxe (kapasitas 2) → 2 tamu,
 * Family Room (kapasitas 4) → 4 tamu. Sebelumnya semua booking tanpa jumlah
 * tamu jatuh ke `adults = 1`, sehingga invoice Family Room pun tertulis 1 tamu.
 *
 * ATURAN: kapasitas hanya menjadi DEFAULT. Kalau tamu (atau staf) menyebut
 * jumlah tamu secara eksplisit, angka itu yang dipakai — termasuk bila lebih
 * kecil dari kapasitas. Extra bed TIDAK ikut dihitung di sini; kapasitas yang
 * dipakai adalah kapasitas standar kamar.
 */

/** Satu baris pilihan kamar pada sebuah booking. */
export type RoomSelection = {
  roomTypeId?: string | null;
  /** Jumlah kamar dari tipe ini. Kosong dianggap 1. */
  quantity?: number | null;
};

export type RoomCapacityRow = {
  id: string;
  /** Kapasitas standar, TANPA extra bed. */
  capacity?: number | null;
};

/**
 * Jumlahkan kapasitas standar dari seluruh kamar yang dipilih.
 * Return `null` bila tidak ada satu pun kamar dengan kapasitas yang diketahui —
 * pemanggil harus jatuh ke default lamanya, bukan menebak.
 */
export function capacityForSelection(
  selections: RoomSelection[],
  rooms: RoomCapacityRow[],
): number | null {
  if (!Array.isArray(selections) || selections.length === 0) return null;

  let total = 0;
  let known = false;

  for (const selection of selections) {
    const roomTypeId = selection?.roomTypeId;
    if (!roomTypeId) continue;
    const room = rooms.find((r) => r.id === roomTypeId);
    const capacity = Math.floor(Number(room?.capacity ?? 0));
    if (!Number.isFinite(capacity) || capacity <= 0) continue;
    const quantity = Math.max(1, Math.floor(Number(selection?.quantity ?? 1) || 1));
    total += capacity * quantity;
    known = true;
  }

  if (!known || total <= 0) return null;
  return Math.min(total, 20);
}

/**
 * True bila nilai jumlah tamu benar-benar DISEBUTKAN (bukan sekadar default
 * yang terlanjur terisi). `0`, string kosong, `null`, `undefined`, dan nilai
 * non-numerik dianggap tidak disebut.
 */
export function guestCountWasStated(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "string" && value.trim() === "") return false;
  const n = Number(value);
  return Number.isFinite(n) && n >= 1;
}

/**
 * Tentukan `adults` final untuk sebuah booking.
 *
 * @param statedAdults  Nilai yang disebut tamu/staf (boleh undefined).
 * @param selections    Kamar yang dipesan (untuk menghitung kapasitas).
 * @param rooms         Katalog tipe kamar (butuh `id` + `capacity`).
 * @param children      Jumlah anak — ikut dihitung agar total tamu tidak
 *                      melebihi kapasitas saat memakai default.
 */
export function resolveAdultsForBooking(
  statedAdults: unknown,
  selections: RoomSelection[],
  rooms: RoomCapacityRow[],
  children = 0,
): number {
  if (guestCountWasStated(statedAdults)) {
    return Math.max(1, Math.min(20, Math.floor(Number(statedAdults))));
  }

  const capacity = capacityForSelection(selections, rooms);
  if (capacity === null) return 1;

  // Anak yang sudah disebut ikut memakai kapasitas — jangan sampai default
  // dewasa + anak melebihi daya tampung kamar.
  const kids = Math.max(0, Math.floor(Number(children) || 0));
  return Math.max(1, Math.min(20, capacity - kids));
}
