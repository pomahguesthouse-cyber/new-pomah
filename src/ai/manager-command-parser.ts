import { fmtDateID } from "@/lib/date";

export type ManagerCommandToolName = "get_bookings";

export interface ParsedManagerCommand {
  toolName: ManagerCommandToolName;
  rawArgs: string;
  label: string;
}

interface BookingItem {
  ref?: unknown;
  reference_code?: unknown;
  stay_dates?: unknown;
  check_in?: unknown;
  check_out?: unknown;
  guest?: unknown;
  guest_name?: unknown;
  rooms?: unknown;
  total?: unknown;
  paid?: unknown;
  outstanding?: unknown;
  status?: unknown;
  payment_status?: unknown;
  created_at?: unknown;
}

interface BookingToolPayload {
  ok?: unknown;
  count?: unknown;
  total_outstanding?: unknown;
  report_type?: unknown;
  bookings?: unknown;
  error?: unknown;
}

function normalizeText(message: string): string {
  return message
    .toLowerCase()
    .replace(/[._*#`~()[\]{}:;!?]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function hasAny(text: string, terms: string[]): boolean {
  return terms.some((term) => text.includes(term));
}

function parseLimit(text: string): number | undefined {
  const match = text.match(/\b(?:top|limit|ambil|tampilkan)?\s*(\d{1,2})\s*(?:booking|reservasi|data)?\b/);
  if (!match) return undefined;
  const value = Number(match[1]);
  if (!Number.isFinite(value) || value <= 0) return undefined;
  return Math.min(value, 30);
}

export function parseManagerCommand(message: string): ParsedManagerCommand | null {
  const text = normalizeText(message);
  if (!text) return null;

  const limit = parseLimit(text) ?? 10;

  if (
    hasAny(text, ["booking terbaru", "daftar booking terbaru", "reservasi terbaru", "booking terakhir", "reservasi terakhir"])
  ) {
    return {
      toolName: "get_bookings",
      rawArgs: JSON.stringify({ report_type: "recent_created_not_checked_in", limit }),
      label: "manager_command:booking_terbaru",
    };
  }

  if (
    hasAny(text, ["check in hari ini", "check-in hari ini", "checkin hari ini", "tamu masuk hari ini"])
  ) {
    return {
      toolName: "get_bookings",
      rawArgs: JSON.stringify({ report_type: "today_checkin", limit }),
      label: "manager_command:checkin_hari_ini",
    };
  }

  if (
    hasAny(text, ["check out hari ini", "check-out hari ini", "checkout hari ini", "tamu keluar hari ini"])
  ) {
    return {
      toolName: "get_bookings",
      rawArgs: JSON.stringify({ report_type: "today_checkout", limit }),
      label: "manager_command:checkout_hari_ini",
    };
  }

  if (
    hasAny(text, ["belum lunas", "belum bayar", "piutang", "tagihan belum", "dp belum lunas"])
  ) {
    return {
      toolName: "get_bookings",
      rawArgs: JSON.stringify({ report_type: "unpaid", limit }),
      label: "manager_command:unpaid",
    };
  }

  if (
    hasAny(text, ["tamu menginap hari ini", "sedang menginap", "in house", "inhouse", "active stay"])
  ) {
    return {
      toolName: "get_bookings",
      rawArgs: JSON.stringify({ report_type: "active_stay", limit }),
      label: "manager_command:active_stay",
    };
  }

  if (
    hasAny(text, ["booking batal", "booking cancel", "booking cancelled", "reservasi batal", "reservasi cancel"])
  ) {
    return {
      toolName: "get_bookings",
      rawArgs: JSON.stringify({ report_type: "cancelled", limit }),
      label: "manager_command:cancelled",
    };
  }

  if (
    hasAny(text, ["daftar booking", "booking mendatang", "jadwal booking", "booking berikutnya", "reservasi mendatang"])
  ) {
    return {
      toolName: "get_bookings",
      rawArgs: JSON.stringify({ report_type: "upcoming_checkin", limit }),
      label: "manager_command:upcoming_booking",
    };
  }

  return null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function formatCurrency(value: unknown): string {
  return `Rp${asNumber(value).toLocaleString("id-ID")}`;
}

function formatStatus(status: unknown, paymentStatus: unknown): string {
  const payment = asString(paymentStatus);
  if (payment === "partial") return "🟡 Partial";
  if (payment === "unpaid") return "⏳ Unpaid";

  const raw = asString(status);
  if (raw === "confirmed") return "✅ Confirmed";
  if (raw === "checked_in") return "✅ Checked_in";
  if (raw === "checked_out") return "✅ Checked_out";
  if (raw === "pending") return "⏳ Pending";
  if (raw === "cancelled") return "❌ Cancelled";
  return raw ? `• ${raw}` : "• Status belum tersedia";
}

function formatCreatedAt(value: unknown): string | null {
  const raw = asString(value);
  if (!raw) return null;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return raw;

  const date = parsed.toLocaleDateString("id-ID", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Asia/Jakarta",
  });
  const time = parsed.toLocaleTimeString("id-ID", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Jakarta",
  });
  return `${date}, ${time}`;
}

function formatStayDatesFromRaw(item: BookingItem): string {
  const stayDates = asString(item.stay_dates);
  if (stayDates) return stayDates;

  const checkIn = asString(item.check_in);
  const checkOut = asString(item.check_out);
  if (checkIn && checkOut) return `${fmtDateID(checkIn)} – ${fmtDateID(checkOut)}`;
  if (checkIn) return fmtDateID(checkIn);
  if (checkOut) return `Sampai ${fmtDateID(checkOut)}`;
  return "Tanggal menginap belum diisi";
}

function formatPayment(item: BookingItem): string {
  const total = asNumber(item.total);
  const paid = asNumber(item.paid);
  const outstanding = asNumber(item.outstanding);
  const paymentStatus = asString(item.payment_status);

  if (paymentStatus === "partial" || (paid > 0 && outstanding > 0)) {
    return `${formatCurrency(total)} — DP ${formatCurrency(paid)} — Sisa ${formatCurrency(outstanding)}`;
  }
  if (paymentStatus === "unpaid") {
    return `${formatCurrency(total)} — Belum bayar`;
  }
  return formatCurrency(total);
}

function formatBookingItem(raw: unknown): string {
  const record = asRecord(raw) ?? {};
  const item = record as BookingItem;
  const ref = asString(item.ref) || asString(item.reference_code) || "Kode booking belum tersedia";
  const guest = asString(item.guest) || asString(item.guest_name) || "Nama tamu belum tersedia";
  const rooms = asString(item.rooms) || "Kamar belum tersedia";
  const createdAt = formatCreatedAt(item.created_at);

  return [
    `🏷 ${ref}`,
    `📅 ${formatStayDatesFromRaw(item)}`,
    `👤 ${guest}`,
    `🛏 ${rooms}`,
    `💰 ${formatPayment(item)}`,
    formatStatus(item.status, item.payment_status),
    createdAt ? `🕒 Dibuat: ${createdAt}` : null,
  ].filter((line): line is string => Boolean(line)).join("\n");
}

export function formatManagerCommandResult(command: ParsedManagerCommand, output: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(output);
  } catch {
    return output;
  }

  const payload = asRecord(parsed) as BookingToolPayload | null;
  if (!payload) return output;
  if (payload.ok === false) return asString(payload.error) || "Perintah gagal diproses.";

  const bookings = Array.isArray(payload.bookings) ? payload.bookings : [];
  if (bookings.length === 0) return "Tidak ada booking yang cocok.";

  const body = bookings.map(formatBookingItem).join("\n\n━━━━━━━━━━━━━\n\n");
  const reportType = asString(payload.report_type);
  const totalOutstanding = asNumber(payload.total_outstanding);

  if (reportType === "unpaid") {
    return `${body}\n\nTotal ${bookings.length} booking, outstanding ${formatCurrency(totalOutstanding)}.`;
  }

  return body;
}
