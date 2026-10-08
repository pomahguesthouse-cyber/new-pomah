/**
 * Flat booking rows for CSV and the daftar-booking PDF.
 * The PDF itself is built in booking-list-pdf.tsx and saved as a real file
 * (download or the Android share sheet).
 */

export interface ExportRow {
  reference_code: string;
  guest_name:     string;
  guest_email:    string;
  guest_phone:    string;
  check_in:       string;
  check_out:      string;
  nights:         number;
  rooms:          string;
  /** Room type names, separate from room numbers. Optional for older callers. */
  room_types?:    string;
  /** Room numbers, separate from room types. Optional for older callers. */
  room_numbers?:  string;
  room_count:     number;
  adults:         number;
  children:       number;
  status:         string;
  source:         string;
  payment_status: string;
  total_amount:   number;
  paid_amount:    number;
  outstanding:    number;
  nightly_rate_min: number;
  nightly_rate_max: number;
  created_at:     string;
}

const CSV_HEADERS: Array<[keyof ExportRow, string]> = [
  ["reference_code", "Kode Booking"],
  ["guest_name",     "Nama Tamu"],
  ["guest_phone",    "No. HP"],
  ["guest_email",    "Email"],
  ["check_in",       "Check-in"],
  ["check_out",      "Check-out"],
  ["nights",         "Malam"],
  ["rooms",          "Kamar"],
  ["adults",         "Dewasa"],
  ["children",       "Anak"],
  ["status",         "Status"],
  ["source",         "Sumber"],
  ["payment_status", "Pembayaran"],
  ["total_amount",   "Total"],
  ["paid_amount",    "Dibayar"],
  ["outstanding",    "Sisa"],
  ["created_at",     "Tgl Pemesanan"],
];

function escapeCsvCell(v: unknown): string {
  const s = v == null ? "" : String(v);
  // Quote when contains comma, quote, newline.
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function rowsToCsv(rows: ExportRow[]): string {
  const head = CSV_HEADERS.map(([, label]) => escapeCsvCell(label)).join(",");
  const body = rows.map((r) =>
    CSV_HEADERS.map(([k]) => escapeCsvCell(r[k])).join(","),
  ).join("\n");
  // BOM so Excel renders UTF-8 (rupiah currency safe, even though we
  // emit plain numbers, but guest names may have diacritics).
  return "﻿" + head + "\n" + body;
}

export function downloadCsv(rows: ExportRow[], filenameStem: string) {
  const csv = rowsToCsv(rows);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${filenameStem}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Defer revoke so Safari finishes the download.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Read every filtered row, not just one response page.
 * PostgREST often caps a single response at 1000 rows even when `.limit(5000)` is set.
 */
export async function collectPages<T>(
  fetchPage: (from: number, to: number) => Promise<readonly T[]>,
  pageSize = 1000,
  maxRows = 5000,
): Promise<{ rows: T[]; capped: boolean }> {
  if (pageSize < 1 || maxRows < 1) throw new Error("Ukuran halaman export tidak valid.");
  const rows: T[] = [];
  for (let from = 0; from < maxRows; from += pageSize) {
    const to = Math.min(from + pageSize, maxRows) - 1;
    const room = to - from + 1;
    const batch = (await fetchPage(from, to)).slice(0, room);
    rows.push(...batch);
    if (batch.length < room) return { rows, capped: false };
  }
  return { rows, capped: true };
}
