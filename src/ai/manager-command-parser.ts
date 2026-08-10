import { fmtDateID } from "@/lib/date";
import { parseIDRAmount } from "@/lib/idr";
import { stripRoomNoise } from "@/lib/room-name";

export type ManagerCommandToolName =
  | "get_bookings"
  | "update_room_rate"
  | "set_daily_room_rate"
  | "list_room_rates";

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

// ─── IDR price parser (mirrors num() in pricing tools) ──────────────────────

// Implementasi tinggal di @/lib/idr supaya tool pricing memakai parser yang SAMA.
export { parseIDRAmount } from "@/lib/idr";

// ─── Price-command regex patterns ───────────────────────────────────────────
//
// Dibangun dari fragmen bersama supaya semua varian perintah harga menerima
// kosakata manajer yang sama. Insiden 10 Agu 2026: "rubah harga single 250 rb"
// tidak tertangkap (verba "rubah" tak terdaftar, dan harga bersepasi "250 rb"
// tak cocok), jatuh ke jalur LLM → delegasi ask_agent → balasan "kendala
// teknis". Pola di bawah dibuat toleran terhadap:
//   • verba: set/setel/atur/ubah/rubah/robah/ganti/update/perbarui/revisi
//   • prefix: "kamar ", "tipe kamar ", "room "
//   • konektor: "menjadi" / "jadi" / "ke" / "=" / ":"
//   • harga bersepasi: "250 rb", "Rp 250 ribu", "1.2 jt"
//   • urutan terbalik: "kamar deluxe saja ganti harga menjadi 250rb"

/** Verba perubahan yang bersifat ABSOLUT (bukan delta seperti "naikkan 50rb"). */
const VERB = "set|setel|atur|ubah|rubah|robah|ganti|gantikan|update|perbarui|revisi";
/** Konektor opsional antara nama kamar dan nominal. */
const CONNECTOR = "(?:\\s+(?:menjadi|jadi|ke|=|:))?";
/** Prefix opsional sebelum nama kamar. */
const ROOM_PREFIX = "(?:kamar|tipe\\s+kamar|tipe|room)\\s+";
/** Nominal rupiah — unit boleh dipisah spasi ("250 rb"). */
const PRICE = "(?:rp\\s*)?[\\d.,]+\\s*(?:rb|ribu|jt|juta|k)?";

// "set harga deluxe 350rb", "rubah harga single 250 rb", "ganti tarif family jadi 1.2jt"
const RE_SET_BASE_RATE = new RegExp(
  `^(?:${VERB})\\s+(?:harga|tarif)(?:nya)?\\s+(?:${ROOM_PREFIX})?(.+?)${CONNECTOR}\\s+(${PRICE})\\s*$`,
  "i",
);

// Urutan terbalik: "kamar deluxe saja ganti harga menjadi 250 rb", "single ubah tarifnya jadi 300rb"
const RE_SET_BASE_RATE_ROOM_FIRST = new RegExp(
  `^(?:${ROOM_PREFIX})?(.+?)\\s+(?:saja\\s+)?(?:${VERB})\\s+(?:harga|tarif)(?:nya)?${CONNECTOR}\\s+(${PRICE})\\s*$`,
  "i",
);

// "set extrabed deluxe 100rb", "ubah extra bed family jadi 150000"
const RE_SET_EXTRABED = new RegExp(
  `^(?:${VERB})\\s+(?:harga\\s+|tarif\\s+)?extra\\s?bed\\s+(?:${ROOM_PREFIX})?(.+?)${CONNECTOR}\\s+(${PRICE})\\s*$`,
  "i",
);

// "harga harian deluxe 2025-06-15 400rb", "set harga harian family 15/06/2025 350 rb"
const RE_SET_DAILY_RATE = new RegExp(
  `^(?:(?:${VERB})\\s+)?harga\\s+harian\\s+(?:${ROOM_PREFIX})?(.+?)\\s+(\\d{4}-\\d{2}-\\d{2}|\\d{1,2}\\/\\d{1,2}\\/\\d{2,4})${CONNECTOR}\\s+(${PRICE})\\s*$`,
  "i",
);

// "lihat harga", "daftar harga", "cek tarif", "list harga"
const RE_VIEW_RATES = /^(?:lihat|daftar|cek|list)\s+(?:harga|tarif)\s*$/i;

// `stripRoomNoise` tinggal di @/lib/room-name supaya resolver tool pricing bisa
// memakai definisi yang SAMA tanpa tools/ mengimpor ai/.
export { stripRoomNoise } from "@/lib/room-name";

/**
 * Convert DD/MM/YYYY or DD/MM/YY to YYYY-MM-DD.
 * Returns null if already YYYY-MM-DD or invalid.
 */
function normalizeDateArg(raw: string): string | null {
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const m = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!m) return null;
  const day = m[1].padStart(2, "0");
  const month = m[2].padStart(2, "0");
  let year = m[3];
  if (year.length === 2) year = `20${year}`;
  const result = `${year}-${month}-${day}`;
  // Basic validity check
  const d = new Date(result);
  if (Number.isNaN(d.getTime())) return null;
  return result;
}

export function parseManagerCommand(message: string): ParsedManagerCommand | null {
  const text = normalizeText(message);
  if (!text) return null;

  const limit = parseLimit(text) ?? 10;

  // ── Booking commands ───────────────────────────────────────────────

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

  // ── Pricing commands ───────────────────────────────────────────────
  // These run against the ORIGINAL message (not normalizeText'd) so
  // regex can capture mixed-case room names and price tokens properly.
  const trimmed = message.trim();

  // 1. "lihat harga" / "daftar harga" / "cek tarif" (must check before set)
  if (RE_VIEW_RATES.test(trimmed)) {
    return {
      toolName: "list_room_rates",
      rawArgs: "{}",
      label: "manager_command:lihat_harga",
    };
  }

  // 2. "set extrabed <room> <price>" (check before generic set harga)
  const extrabedMatch = trimmed.match(RE_SET_EXTRABED);
  if (extrabedMatch) {
    const roomName = stripRoomNoise(extrabedMatch[1]);
    const price = parseIDRAmount(extrabedMatch[2]);
    if (roomName && price != null) {
      return {
        toolName: "update_room_rate",
        rawArgs: JSON.stringify({
          room_type: roomName,
          extrabed_rate: price,
          confirmed: true,
        }),
        label: "manager_command:set_extrabed",
      };
    }
  }

  // 3. "harga harian <room> <date> <price>" (daily override)
  const dailyMatch = trimmed.match(RE_SET_DAILY_RATE);
  if (dailyMatch) {
    const roomName = stripRoomNoise(dailyMatch[1]);
    const dateStr = normalizeDateArg(dailyMatch[2]);
    const price = parseIDRAmount(dailyMatch[3]);
    if (roomName && dateStr && price != null) {
      return {
        toolName: "set_daily_room_rate",
        rawArgs: JSON.stringify({
          room_type: roomName,
          from_date: dateStr,
          rate: price,
        }),
        label: "manager_command:set_harga_harian",
      };
    }
  }

  // 4. "set harga <room> <price>" (base rate — most generic, check last).
  //    Dua bentuk: verba di depan, atau nama kamar di depan
  //    ("kamar deluxe saja ganti harga menjadi 250 rb").
  for (const [re, label] of [
    [RE_SET_BASE_RATE, "manager_command:set_harga"],
    [RE_SET_BASE_RATE_ROOM_FIRST, "manager_command:set_harga_room_first"],
  ] as const) {
    const baseMatch = trimmed.match(re);
    if (!baseMatch) continue;
    const roomName = stripRoomNoise(baseMatch[1]);
    const price = parseIDRAmount(baseMatch[2]);
    if (roomName && price != null) {
      return {
        toolName: "update_room_rate",
        rawArgs: JSON.stringify({
          room_type: roomName,
          base_rate: price,
          confirmed: true,
        }),
        label,
      };
    }
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

  const payload = asRecord(parsed);
  if (!payload) return output;
  if (payload.ok === false) return asString(payload.error) || "Perintah gagal diproses.";

  // ── Pricing: update_room_rate ─────────────────────────────────────
  if (command.toolName === "update_room_rate") {
    return formatUpdateRoomRateResult(payload);
  }

  // ── Pricing: set_daily_room_rate ──────────────────────────────────
  if (command.toolName === "set_daily_room_rate") {
    return formatSetDailyRateResult(payload);
  }

  // ── Pricing: list_room_rates (handled in-parser, no tool call) ────
  // This shouldn't normally reach here because list_room_rates is
  // handled before executeTool. Fallback just in case.
  if (command.toolName === "list_room_rates") {
    return asString(payload.message) || output;
  }

  // ── Booking commands ──────────────────────────────────────────────
  const bookingPayload = payload as BookingToolPayload;
  const bookings = Array.isArray(bookingPayload.bookings) ? bookingPayload.bookings : [];
  if (bookings.length === 0) return "Tidak ada booking yang cocok.";

  const body = bookings.map(formatBookingItem).join("\n\n━━━━━━━━━━━━━\n\n");
  const reportType = asString(bookingPayload.report_type);
  const totalOutstanding = asNumber(bookingPayload.total_outstanding);

  if (reportType === "unpaid") {
    return `${body}\n\nTotal ${bookings.length} booking, outstanding ${formatCurrency(totalOutstanding)}.`;
  }

  return body;
}

// ─── Pricing result formatters ──────────────────────────────────────────────

function formatUpdateRoomRateResult(payload: Record<string, unknown>): string {
  const roomType = asRecord(payload.room_type);
  const before = asRecord(payload.before);
  const after = asRecord(payload.after);
  const roomName = roomType ? asString(roomType.name) || "Kamar" : "Kamar";

  const lines: string[] = [`✅ Tarif ${roomName} berhasil diperbarui!`, ""];

  if (before && after) {
    const oldBase = asNumber(before.base_rate);
    const newBase = asNumber(after.base_rate);
    const oldExtra = asNumber(before.extrabed_rate);
    const newExtra = asNumber(after.extrabed_rate);

    if (oldBase !== newBase) {
      lines.push(`🏷 Base rate: ${formatCurrency(oldBase)} → ${formatCurrency(newBase)}`);
    }
    if (oldExtra !== newExtra) {
      lines.push(`🛏 Extrabed: ${formatCurrency(oldExtra)} → ${formatCurrency(newExtra)}`);
    }
    // If nothing visibly changed, show current values
    if (oldBase === newBase && oldExtra === newExtra) {
      lines.push(`🏷 Base rate: ${formatCurrency(newBase)}`);
      lines.push(`🛏 Extrabed: ${formatCurrency(newExtra)}`);
      lines.push("", "ℹ️ Tarif tidak berubah (sudah sama dengan sebelumnya).");
    }
  } else {
    const msg = asString(payload.message);
    if (msg) lines.push(msg);
  }

  return lines.join("\n");
}

function formatSetDailyRateResult(payload: Record<string, unknown>): string {
  const roomType = asRecord(payload.room_type);
  const roomName = roomType ? asString(roomType.name) || "Kamar" : "Kamar";
  const fromDate = asString(payload.from_date);
  const toDate = asString(payload.to_date);
  const days = asNumber(payload.days);
  const applied = asRecord(payload.applied);

  const isSingle = fromDate === toDate;
  const dateStr = isSingle
    ? (fromDate ? fmtDateID(fromDate) : "")
    : (fromDate && toDate ? `${fmtDateID(fromDate)} – ${fmtDateID(toDate)}` : "");

  const lines: string[] = [
    `✅ Harga harian ${roomName} berhasil di-set!`,
    "",
    `📅 ${dateStr}${days > 1 ? ` (${days} hari)` : ""}`,
  ];

  if (applied) {
    const rate = applied.rate;
    const extrabed = applied.extrabed_rate;
    const stopSell = applied.stop_sell;
    if (rate != null) lines.push(`💰 Rate: ${formatCurrency(rate)}`);
    if (extrabed != null) lines.push(`🛏 Extrabed: ${formatCurrency(extrabed)}`);
    if (stopSell === true) lines.push(`🚫 Stop sell: Ya`);
  }

  return lines.join("\n");
}

/**
 * Format room rates list from ctx.rooms data.
 * Called directly (not via executeTool) when command is list_room_rates.
 */
export function formatRoomRatesList(
  rooms: Array<{ name: string; base_rate?: unknown; extrabed_rate?: unknown; capacity?: unknown }>,
): string {
  if (!rooms || rooms.length === 0) return "Tidak ada data kamar.";

  const lines: string[] = ["📋 Daftar Harga Kamar", ""];

  for (const room of rooms) {
    const baseRate = asNumber(room.base_rate);
    const extrabedRate = asNumber(room.extrabed_rate);
    const capacity = asNumber(room.capacity);

    lines.push(`🏷 ${room.name}`);
    lines.push(`   💰 Base rate: ${formatCurrency(baseRate)}`);
    if (extrabedRate > 0) {
      lines.push(`   🛏 Extrabed: ${formatCurrency(extrabedRate)}`);
    }
    if (capacity > 0) {
      lines.push(`   👥 Kapasitas: ${capacity} tamu`);
    }
    lines.push("");
  }

  return lines.join("\n").trimEnd();
}
