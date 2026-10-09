import type { ExportRow } from "@/admin/lib/booking-export";
import { dayFilterScopeLabel, type BookingDayChip } from "@/admin/lib/booking-day-filter";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"] as const;

const STATUS_LABELS: Record<string, string> = {
  pending: "Menunggu",
  confirmed: "Konfirmasi",
  checked_in: "Check-in",
  checked_out: "Check-out",
  cancelled: "Batal",
  expired: "Kedaluwarsa",
};

const SOURCE_LABELS: Record<string, string> = {
  direct: "Direct",
  whatsapp: "WhatsApp",
  walk_in: "Walk-in",
  website: "Website",
  manager_chat: "Manager Chat",
};

export type BookingListSummary = {
  count: number;
  nights: number;
  total: number;
  paid: number;
};

export type BookingListFilterInput = {
  status?: string | null;
  source?: string | null;
  search?: string | null;
  from?: string | null;
  to?: string | null;
  /** Active quick-date chip. `all` and empty keep the previous header. */
  day?: BookingDayChip | null;
  /** WIB calendar date printed with the chip (today, or tomorrow for Besok). */
  on?: string | null;
};

/** Rupiah with Indonesian thousands separators, independent of ICU currency symbols. */
export function formatIdr(value: number): string {
  const amount = Number.isFinite(value) ? Math.round(value) : 0;
  const sign = amount < 0 ? "-" : "";
  const body = Math.abs(amount)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `Rp ${sign}${body}`;
}

export function formatDateId(iso?: string | null): string {
  if (!iso) return "—";
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!match) return iso;
  const month = MONTHS[Number(match[2]) - 1];
  if (!month) return iso;
  return `${Number(match[3])} ${month} ${match[1]}`;
}

export function formatPrintedAt(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Jakarta",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const pick = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return `${formatDateId(`${pick("year")}-${pick("month")}-${pick("day")}`)}, ${pick("hour")}.${pick("minute")} WIB`;
}

export function bookingListPdfFileName(date = new Date()): string {
  const stamp = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
  return `Daftar-Booking-${stamp}.pdf`;
}

export function labelBookingStatus(status?: string | null): string {
  if (!status) return "—";
  return STATUS_LABELS[status] ?? status;
}

export function labelBookingSource(source?: string | null): string {
  if (!source) return "—";
  return SOURCE_LABELS[source] ?? source;
}

export function describeBookingListFilters(filters: BookingListFilterInput): string {
  const parts: string[] = [];
  if (filters.day && filters.day !== "all" && filters.on) {
    const scope = dayFilterScopeLabel(filters.day);
    if (scope) parts.push(`Filter: ${scope} – ${formatDateId(filters.on)}`);
  }
  parts.push(
    filters.status && filters.status !== "all" ? `Status: ${labelBookingStatus(filters.status)}` : "Status: semua",
  );
  parts.push(
    filters.source && filters.source !== "all" ? `Sumber: ${labelBookingSource(filters.source)}` : "Sumber: semua",
  );
  if (filters.from || filters.to) {
    const from = filters.from ? formatDateId(filters.from) : "awal";
    const to = filters.to ? formatDateId(filters.to) : "akhir";
    parts.push(`Check-in: ${from} s/d ${to}`);
  }
  const search = (filters.search ?? "").replace(/\s+/g, " ").trim();
  if (search) {
    const shown = search.length > 80 ? `${search.slice(0, 77)}...` : search;
    parts.push(`Cari: ${shown}`);
  }
  return parts.join(" · ");
}

export function summarizeBookingRows(rows: readonly ExportRow[]): BookingListSummary {
  let nights = 0;
  let total = 0;
  let paid = 0;
  for (const row of rows) {
    nights += Number.isFinite(row.nights) ? row.nights : 0;
    total += Number.isFinite(row.total_amount) ? row.total_amount : 0;
    paid += Number.isFinite(row.paid_amount) ? row.paid_amount : 0;
  }
  return { count: rows.length, nights, total, paid };
}

export function bookingRoomColumns(
  row: Pick<ExportRow, "rooms"> & Partial<Pick<ExportRow, "room_types" | "room_numbers">>,
): { types: string; numbers: string } {
  const types = row.room_types?.trim() ?? "";
  const numbers = row.room_numbers?.trim() ?? "";
  if (types || numbers) return { types: types || "—", numbers: numbers || "—" };

  const rooms = row.rooms?.trim() ?? "";
  if (!rooms) return { types: "—", numbers: "—" };
  const typeParts: string[] = [];
  const numberParts: string[] = [];
  for (const part of rooms.split(";")) {
    const piece = part.trim();
    if (!piece) continue;
    const match = /^(.*?)\s*\(([^)]+)\)\s*$/.exec(piece);
    if (match) {
      typeParts.push(match[1].trim() || "—");
      numberParts.push(match[2].trim() || "—");
    } else {
      typeParts.push(piece);
      numberParts.push("—");
    }
  }
  return {
    types: typeParts.join(", ") || "—",
    numbers: numberParts.join(", ") || "—",
  };
}

export function bookingListPdfMessage(
  result: { method: string; cancelled?: boolean },
  count: number,
): string | null {
  if (result.cancelled) return null;
  if (result.method === "native-share" || result.method === "web-share") {
    return `PDF daftar booking siap — ${count} booking. Pilih aplikasi untuk menyimpan.`;
  }
  if (result.method === "open") return `PDF dibuka — ${count} booking.`;
  if (result.method === "print") return `Dialog cetak terbuka — ${count} booking.`;
  return `PDF diunduh — ${count} booking.`;
}
