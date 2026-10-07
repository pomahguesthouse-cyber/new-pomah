/**
 * Jumlah kamar tidur / kamar mandi pada tipe kamar.
 *
 * Kolom `room_types.bedrooms` dan `room_types.bathrooms` ditambahkan
 * lewat migration yang dijalankan manual. Sampai migration itu ada,
 * PostgREST menolak select/tulis yang menyebut kolom tersebut.
 * Query publik harus tetap jalan: coba dengan kolomnya, dan bila
 * kolom belum ada ulangi tanpa kolom itu. UI memakai fallback 1.
 */

export const PUBLIC_LISTED_ROOM_TYPE_COLUMNS =
  "id, name, slug, description, base_rate, extrabed_rate, extrabed_capacity, capacity, bed_type, floor_info, size_sqm, amenities, hero_image_url, images, bedrooms, bathrooms, rooms(id)";

export type PostgrestErrorLike = {
  message?: string;
  code?: string;
  details?: string;
  hint?: string;
} | null;

type QueryResult = { data: any; error: PostgrestErrorLike };

let warnedMissingRoomLayout = false;

/** Angka kamar yang aman untuk kartu publik. Kosong, 0, atau bukan angka → 1. */
export function roomLayoutCount(value: unknown): number {
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.trunc(n);
}

export function kamarTidurLabel(value: unknown): string {
  return `${roomLayoutCount(value)} K. Tidur`;
}

export function kamarMandiLabel(value: unknown): string {
  return `${roomLayoutCount(value)} K. Mandi`;
}

export function isMissingRoomLayoutColumnError(error: PostgrestErrorLike): boolean {
  if (!error) return false;
  const blob = `${error.code ?? ""} ${error.message ?? ""} ${error.details ?? ""} ${error.hint ?? ""}`.toLowerCase();
  const mentionsLayout = blob.includes("bedroom") || blob.includes("bathroom");
  if (!mentionsLayout) return false;
  return (
    blob.includes("42703") ||
    blob.includes("pgrst204") ||
    blob.includes("does not exist") ||
    blob.includes("schema cache") ||
    blob.includes("could not find")
  );
}

/** Hapus bedrooms/bathrooms dari daftar kolom PostgREST. Embed seperti rooms(id) dibiarkan. */
export function omitRoomLayoutColumns(select: string): string {
  return select
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part !== "bedrooms" && part !== "bathrooms")
    .join(", ");
}

export function omitRoomLayoutFields<T extends Record<string, unknown>>(row: T): Omit<T, "bedrooms" | "bathrooms"> {
  const { bedrooms: _bedrooms, bathrooms: _bathrooms, ...rest } = row;
  return rest;
}

/**
 * `.select()` Supabase hanya menerima string literal di tipe yang di-generate.
 * Daftar kolom di sini dipilih saat runtime (dengan atau tanpa bedrooms/bathrooms).
 */
export function selectColumns(query: object, columns: string): any {
  return (query as { select: (columns: string) => any }).select(columns);
}

/**
 * Jalankan select yang menyertakan bedrooms/bathrooms.
 * Bila kolom belum ada, ulangi query yang sama tanpa kedua kolom itu
 * supaya halaman publik tidak kosong sebelum migration diterapkan.
 */
export async function queryWithOptionalRoomLayout(
  columns: string,
  run: (columns: string) => PromiseLike<QueryResult>,
): Promise<QueryResult> {
  const first = await run(columns);
  if (!first.error || !isMissingRoomLayoutColumnError(first.error)) return first;
  const fallbackColumns = omitRoomLayoutColumns(columns);
  if (fallbackColumns === columns) return first;
  if (!warnedMissingRoomLayout) {
    warnedMissingRoomLayout = true;
    console.warn(
      "[room_types] Kolom bedrooms/bathrooms belum ada. Query diulang tanpa kolom itu sampai migration dijalankan manual.",
    );
  }
  return run(fallbackColumns);
}
