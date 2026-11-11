import { parseManagerCommand } from "@/ai/manager-command-parser";
import { parseAvailabilityDateRange } from "@/services/wa-autoreply/message-parsers";
import { normalizePhone } from "@/services/wa-autoreply/identity";

export type ManagerChatCommand = {
  toolName: string;
  rawArgs: string;
  label: string;
};

function normalizeText(message: string): string {
  return message
    .toLowerCase()
    .replace(/[._*#`~()[\]{}:;!?]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseLimit(text: string): number {
  const match = text.match(/\b(?:top|limit|ambil|tampilkan)?\s*(\d{1,2})\s*(?:booking|reservasi|data)?\b/);
  const value = match ? Number(match[1]) : 10;
  if (!Number.isFinite(value) || value <= 0) return 10;
  return Math.min(value, 30);
}

const CODE_RE = /\b(PG|PMH|PGS)[- ]?[A-Z0-9]{3,}\b/i;

export function extractBookingCode(message: string): string | null {
  const match = String(message ?? "").toUpperCase().match(CODE_RE);
  if (!match) return null;
  return match[0].replace(/\s+/g, "").replace(/^(PG|PMH|PGS)-?/, (full, prefix) => `${prefix}-`);
}

/**
 * Perintah deterministik tambahan di atas parser harga/daftar yang sudah ada.
 * Mengembalikan null bila harus diteruskan ke LLM (buat booking bebas, dll).
 */
export function parseManagerChatCommand(message: string, today: string): ManagerChatCommand | null {
  const text = normalizeText(message);
  if (!text) return null;
  const limit = parseLimit(text);

  if (/^(bantuan|help|menu|perintah|cmd)$/.test(text) || text === "?" ) {
    return { toolName: "help", rawArgs: "{}", label: "manager_command:help" };
  }

  if (/\b(okupansi|occupancy|kamar terisi|kamar kosong hari ini|ringkasan hunian)\b/.test(text)) {
    const range = parseAvailabilityDateRange(message, today);
    return {
      toolName: "get_occupancy_summary",
      rawArgs: JSON.stringify({ date: range?.checkIn ?? today }),
      label: "manager_command:occupancy",
    };
  }

  const code = extractBookingCode(message);
  if (code && /\b(detail|lihat|cek)\b/.test(text) && !/\b(lunas|dp|invoice|brosur|batal|cancel|check[-\s]?in|check[-\s]?out|kirim|tandai)\b/.test(text)) {
    return {
      toolName: "get_bookings",
      rawArgs: JSON.stringify({ report_type: "detail", reference_code: code, limit: 5 }),
      label: "manager_command:detail",
    };
  }

  if (code && /\b(tandai|set|ubah status)?\s*(lunas|sudah lunas)\b/.test(text)) {
    return {
      toolName: "update_payment_status",
      rawArgs: JSON.stringify({ reference_code: code, new_status: "paid" }),
      label: "manager_command:mark_paid",
    };
  }
  if (code && /\b(tandai|set)?\s*(dp|sudah dp|partial|dibayar sebagian)\b/.test(text)) {
    return {
      toolName: "update_payment_status",
      rawArgs: JSON.stringify({ reference_code: code, new_status: "partial" }),
      label: "manager_command:mark_partial",
    };
  }
  if (code && /\b(kirim(?:\s*ulang)?\s*invoice|invoice(?:nya)?(?:\s*ke\s*tamu)?)\b/.test(text)) {
    return {
      toolName: "send_invoice",
      rawArgs: JSON.stringify({ reference_code: code, send_to_guest: true }),
      label: "manager_command:send_invoice",
    };
  }
  if (/\b(kirim(?:\s*ulang)?\s*brosur)\b/.test(text)) {
    const digits = message.replace(/[^\d]/g, "");
    const phone = digits.length >= 8 ? normalizePhone(digits) : "";
    return {
      toolName: "send_brochure_to_guest",
      rawArgs: JSON.stringify({ guest_phone: phone }),
      label: "manager_command:send_brochure",
    };
  }
  if (code && /\b(check[-\s]?in|masukkan tamu)\b/.test(text)) {
    return {
      toolName: "update_booking_status",
      rawArgs: JSON.stringify({ reference_code: code, status: "checked_in" }),
      label: "manager_command:checkin",
    };
  }
  if (code && /\b(check[-\s]?out|keluarkan tamu)\b/.test(text)) {
    return {
      toolName: "update_booking_status",
      rawArgs: JSON.stringify({ reference_code: code, status: "checked_out" }),
      label: "manager_command:checkout",
    };
  }
  if (code && /\b(batalkan|batal(?:kan)? booking|cancel)\b/.test(text) && !/\bhapus permanen|delete data\b/.test(text)) {
    return {
      toolName: "delete_booking",
      rawArgs: JSON.stringify({ reference_code: code, mode: "cancel" }),
      label: "manager_command:cancel_booking",
    };
  }

  if (/\b(check[-\s]?in besok|tamu masuk besok)\b/.test(text)) {
    return {
      toolName: "get_bookings",
      rawArgs: JSON.stringify({ report_type: "tomorrow_checkin", limit }),
      label: "manager_command:checkin_besok",
    };
  }
  if (/\b(check[-\s]?out besok|tamu keluar besok)\b/.test(text)) {
    return {
      toolName: "get_bookings",
      rawArgs: JSON.stringify({ report_type: "tomorrow_checkout", limit }),
      label: "manager_command:checkout_besok",
    };
  }
  if (/\b(booking hari ini|daftar booking hari ini)\b/.test(text)) {
    return {
      toolName: "get_bookings",
      rawArgs: JSON.stringify({ report_type: "date_range", date_from: today, date_to: today, limit }),
      label: "manager_command:today_bookings",
    };
  }

  const searchMatch = text.match(/^(?:cari|cari booking|cari tamu)\s+(.+)$/);
  if (searchMatch) {
    return {
      toolName: "get_bookings",
      rawArgs: JSON.stringify({ report_type: "search", search: searchMatch[1].trim(), limit }),
      label: "manager_command:search",
    };
  }

  if (code && /^(detail|lihat)\s+/.test(text)) {
    return {
      toolName: "get_bookings",
      rawArgs: JSON.stringify({ report_type: "detail", reference_code: code, limit: 5 }),
      label: "manager_command:detail",
    };
  }

  // booking 11-14 des / daftar booking 11–14 Desember
  if (/\b(booking|reservasi|jadwal)\b/.test(text) && !/\b(buat|buatkan|bikin)\b/.test(text)) {
    const range = parseAvailabilityDateRange(message, today);
    if (range && !/\b(terbaru|terakhir|mendatang|hari ini|besok|belum lunas|batal)\b/.test(text)) {
      const mentionsMonthOrDate = /\b(\d{1,2}|jan|feb|mar|apr|mei|jun|jul|agu|agt|sep|okt|nov|des)\b/i.test(text);
      if (mentionsMonthOrDate) {
        return {
          toolName: "get_bookings",
          rawArgs: JSON.stringify({
            report_type: "date_range",
            date_from: range.checkIn,
            date_to: range.checkOut,
            limit,
          }),
          label: "manager_command:date_range",
        };
      }
    }
  }

  const existing = parseManagerCommand(message);
  if (existing) return existing;
  return null;
}
