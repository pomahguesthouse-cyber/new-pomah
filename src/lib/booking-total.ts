/**
 * Satu-satunya sumber hitungan total booking (integer rupiah).
 *
 * Dipakai oleh ringkasan konfirmasi di state machine DAN oleh `create_booking`
 * supaya angka yang dikonfirmasi tamu == angka yang ditulis ke DB. Tidak ada
 * hitungan total di tempat lain / oleh LLM. Semua hasil dibulatkan ke integer
 * rupiah SATU KALI di sini — rata-rata tarif per malam (total/nights) bisa
 * pecahan, jadi pembulatan harus di titik yang sama untuk semua pemanggil.
 */

/** Bulatkan ke integer rupiah; nilai tidak valid/negatif → 0. */
export function toRupiah(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.round(n);
}

export interface GrandTotalInput {
  /** Subtotal kamar seluruh malam & seluruh kamar (boleh pecahan; dibulatkan di sini). */
  roomSubtotal: number;
  extraBeds?: number;
  /** Tarif extra bed per malam. 0 = belum dikonfigurasi (tidak dihitung). */
  extraBedRate?: number;
  nights: number;
}

export function computeExtraBedTotal(extraBeds: number, extraBedRate: number, nights: number): number {
  if (!(extraBeds > 0) || !(extraBedRate > 0) || !(nights > 0)) return 0;
  return toRupiah(extraBeds * extraBedRate * nights);
}

export function computeGrandTotal(input: GrandTotalInput): number {
  return (
    toRupiah(input.roomSubtotal) +
    computeExtraBedTotal(input.extraBeds ?? 0, input.extraBedRate ?? 0, input.nights)
  );
}

/** Total yang dikonfirmasi tamu sama persis dengan hitungan server (integer rupiah)? */
export function totalsMatch(quoted: unknown, server: unknown): boolean {
  return toRupiah(quoted) === toRupiah(server);
}
