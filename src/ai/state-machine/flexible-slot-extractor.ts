/**
 * Flexible Slot Extractor.
 *
 * Mengekstrak SEMUA kemungkinan slot dari setiap pesan user sekaligus,
 * bukan hanya slot yang sedang "ditunggu" oleh state machine.
 *
 * Contoh:
 *   "dewasa 5 anak 2" → { adults: 5, children: 2 }
 *   "atas nama: Cindyaz Galuh Nialifia" → { guest_name: "Cindyaz Galuh Nialifia" }
 *   "bisa dp dulu?" → { is_payment_question: true }
 *   "minta norek" → { is_bank_account_request: true }
 *
 * Pure function — tanpa I/O, tanpa database call.
 */

import {
  findMentionedRoomType,
  normalizeRoomName,
} from "./booking-machine";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ExtractedSlots {
  guest_name?: string;
  email?: string;
  phone?: string;
  adults?: number;
  children?: number;
  check_in?: string;   // YYYY-MM-DD
  check_out?: string;  // YYYY-MM-DD
  room_type?: string;  // matched room type name
  room_type_id?: string;
  room_quantity?: number;
  special_notes?: string;
  // Signal fields — bukan data slot, tapi sinyal perilaku
  is_payment_question?: boolean;
  is_bank_account_request?: boolean;
  is_invoice_request?: boolean;
  is_checkin_policy?: boolean;
  is_room_detail_question?: boolean;
  is_skip_email?: boolean;
  is_early_arrival?: boolean;
}

// ─── Patterns ─────────────────────────────────────────────────────────────────

/** Pola nama setelah label — "atas nama:", "a/n:", "nama:", "name:" */
const NAME_LABEL_PATTERN =
  /(?:atas\s+nama|a\s*\/\s*n|nama|name)\s*:\s*(.+)/i;

/** Honorifik yang harus dibuang dari nama */
const HONORIFIC_RE = /\b(kak|kakak|mba|mbak|mas|pak|bu|bro|sis|bang|kk)\b/gi;

/** Email regex */
const EMAIL_RE = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/;

/** Pola skip email */
const SKIP_EMAIL_RE =
  /^(?:-+|lewati|skip|skipp?ed|nanti(?: saja| aja)?|tidak(?: ada| punya| usah)?|gak(?: ada| punya)?|ga(?: ada| punya)?|ngga(?: ada| punya)?|enggak|kosong|no(?:ne)?|tidak mau|tidak perlu|tanpa email)\.?$/i;

/** Nomor telepon Indonesia */
const PHONE_RE = /(?:\+62|62|0)[2-9][0-9]{7,11}/;

/** Bulan Indonesia → index (0-based) */
const BULAN_MAP: Record<string, number> = {
  januari: 0, februari: 1, maret: 2, april: 3, mei: 4, juni: 5,
  juli: 6, agustus: 7, september: 8, oktober: 9, november: 10, desember: 11,
  jan: 0, feb: 1, mar: 2, apr: 3, jun: 5, jul: 6, agu: 7, ags: 7,
  sep: 8, okt: 9, nov: 10, des: 11,
};

// ─── Signal patterns ──────────────────────────────────────────────────────────

const PAYMENT_QUESTION_RE =
  /\b(bisa dp|dp dulu|bayar berapa dulu|uang muka|down ?payment|dp minimal|dp berapa|cara bayar|metode (?:pembayaran|bayar)|bayar(?:nya)? (?:gimana|bagaimana|berapa)|kebijakan (?:pembayaran|bayar))\b/i;

const BANK_ACCOUNT_RE =
  /\b(norek|no\.?\s*rek|nomor rekening|nomer rekening|transfer (?:ke ?mana|kemana|ke bank apa)|rekening (?:apa|bank|mana)|minta.{0,10}(?:norek|rekening))\b/i;

const INVOICE_RE =
  /\b(minta invoice|kirim(?:kan)? invoice|butuh invoice|invoice(?:nya)?|kwitansi|bukti (?:booking|pemesanan|reservasi))\b/i;

const CHECKIN_POLICY_RE =
  /\b(jam check[ -]?in|check[ -]?in jam|early check[ -]?in|late check[ -]?out|jam berapa (?:check|cek)|checkout jam|bisa check[ -]?in (?:lebih awal|pagi|jam)|boleh late)\b/i;

const ROOM_DETAIL_RE =
  /\b(wifi|wi-fi|parkir|sarapan|breakfast|kolam|pool|fasilitas|amenities|lantai berapa|view|pemandangan|kamar mandi|bathroom)\b/i;

const EARLY_ARRIVAL_RE =
  /\b(datang lebih awal|sampai (?:lebih )?awal|titip (?:koper|barang|tas)|nitip (?:koper|barang)|sebelum (?:jam )?check[ -]?in|tiba (?:pagi|sebelum)|arrival (?:pagi|awal))\b/i;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function cleanName(raw: string): string {
  return raw
    .split(/\r?\n/)[0]!
    .replace(HONORIFIC_RE, " ")
    .replace(/[,.\-–—!]+$/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Validasi nama yang lebih lenient:
 * - Minimal 2 karakter
 * - Tidak mengandung @ atau digit
 * - Minimal 1 kata alfabet ≥ 2 karakter
 * - Tidak diakhiri ?
 */
function isValidName(candidate: string): boolean {
  const t = candidate.trim();
  if (t.length < 2 || t.length > 80) return false;
  if (/[@]/.test(t)) return false;
  if (t.endsWith("?")) return false;
  const tokens = t.split(/\s+/);
  if (tokens.length > 6) return false;
  // Minimal 1 kata alfabet ≥ 2 karakter
  return tokens.some((w) => /^[A-Za-zÀ-ÿ.'\-]{2,}$/.test(w));
}

/** Parse tanggal Indonesia "25 Juni" atau "25 Juni 2026" ke YYYY-MM-DD. */
function parseIndonesianDate(
  day: number,
  monthStr: string,
  yearStr?: string,
  today?: string,
): string | null {
  const monthKey = monthStr.toLowerCase().replace(/[^a-z]/g, "");
  const monthIdx = BULAN_MAP[monthKey];
  if (monthIdx === undefined) return null;

  let year: number;
  if (yearStr) {
    year = Number(yearStr);
    if (year < 100) year += 2000;
  } else {
    year = today ? Number(today.slice(0, 4)) : new Date().getFullYear();
  }

  if (day < 1 || day > 31) return null;
  const m = String(monthIdx + 1).padStart(2, "0");
  const d = String(day).padStart(2, "0");
  return `${year}-${m}-${d}`;
}

/** Tambah N hari ke tanggal YYYY-MM-DD. */
function addDays(iso: string, n: number): string {
  const d = new Date(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// ─── Main extractor ───────────────────────────────────────────────────────────

/**
 * Ekstrak semua kemungkinan slot dari sebuah pesan.
 *
 * @param message  Pesan teks dari user
 * @param rooms    Katalog tipe kamar dari DB
 * @param chatPhone  Nomor WA user (opsional, untuk fallback phone)
 * @param today    Tanggal hari ini format YYYY-MM-DD
 */
export function extractAllSlots(
  message: string,
  rooms: Array<{ id: string; name: string; base_rate?: number | null }>,
  chatPhone?: string,
  today?: string,
): ExtractedSlots {
  const result: ExtractedSlots = {};
  const text = message.trim();
  const textLower = text.toLowerCase();

  // ── 1. Nama ───────────────────────────────────────────────────────────────
  const nameMatch = text.match(NAME_LABEL_PATTERN);
  if (nameMatch) {
    const candidate = cleanName(nameMatch[1]!);
    if (candidate.length >= 2 && isValidName(candidate)) {
      result.guest_name = candidate;
    }
  }

  // ── 2. Email ──────────────────────────────────────────────────────────────
  if (SKIP_EMAIL_RE.test(text)) {
    result.is_skip_email = true;
  } else if (text.includes("@")) {
    const emailMatch = text.match(EMAIL_RE);
    if (emailMatch) {
      result.email = emailMatch[0];
    }
  }

  // ── 3. Phone ──────────────────────────────────────────────────────────────
  const phoneCleaned = text.replace(/[\s\-().]/g, "");
  const phoneMatch = phoneCleaned.match(PHONE_RE);
  if (phoneMatch) {
    result.phone = phoneMatch[0];
  }

  // ── 4. Jumlah tamu ────────────────────────────────────────────────────────
  // "dewasa 5", "5 orang dewasa", "5 dewasa", "orang dewasa 5"
  const adultsPatterns = [
    /(\d+)\s*(?:orang\s+)?(?:dewasa|adult|pax|tamu)/i,
    /(?:dewasa|adult|pax|tamu)\s*(?::?\s*)(\d+)/i,
  ];
  for (const re of adultsPatterns) {
    const m = text.match(re);
    if (m) {
      const n = Number(m[1]);
      if (n >= 1 && n <= 20) { result.adults = n; break; }
    }
  }

  // "anak 2", "2 anak", "children 3"
  const childrenPatterns = [
    /(\d+)\s*(?:anak|child(?:ren)?|kids?)/i,
    /(?:anak|child(?:ren)?|kids?)\s*(?::?\s*)(\d+)/i,
  ];
  for (const re of childrenPatterns) {
    const m = text.match(re);
    if (m) {
      const n = Number(m[1] ?? m[2]);
      if (n >= 0 && n <= 10) { result.children = n; break; }
    }
  }

  // Fallback: "5 orang" (tanpa dewasa/anak qualifier)
  if (result.adults === undefined) {
    const genericPeople = text.match(/(\d+)\s*orang\b/i);
    if (genericPeople) {
      const n = Number(genericPeople[1]);
      if (n >= 1 && n <= 20) result.adults = n;
    }
  }

  // ── 5. Tanggal ────────────────────────────────────────────────────────────
  const dates: string[] = [];

  // Pattern: "25 Juni 2026" atau "25 Juni"
  const idDateRe =
    /(\d{1,2})\s+(januari|februari|maret|april|mei|juni|juli|agustus|september|oktober|november|desember|jan|feb|mar|apr|jun|jul|agu|ags|sep|okt|nov|des)\w*(?:\s+(\d{4}|\d{2}))?/gi;
  let idMatch;
  while ((idMatch = idDateRe.exec(text)) !== null) {
    const d = parseIndonesianDate(
      Number(idMatch[1]),
      idMatch[2]!,
      idMatch[3],
      today,
    );
    if (d) dates.push(d);
  }

  // Pattern: ISO "2026-06-25"
  const isoRe = /\b(\d{4}-\d{2}-\d{2})\b/g;
  let isoMatch;
  while ((isoMatch = isoRe.exec(text)) !== null) {
    dates.push(isoMatch[1]!);
  }

  // Pattern: slash/dash "25/06/2026" or "25-06-2026" or "25/6"
  const slashRe = /\b(\d{1,2})[/\-](\d{1,2})(?:[/\-](\d{2,4}))?\b/g;
  let slashMatch;
  while ((slashMatch = slashRe.exec(text)) !== null) {
    const day = Number(slashMatch[1]);
    const month = Number(slashMatch[2]);
    let year = slashMatch[3] ? Number(slashMatch[3]) : undefined;
    if (year !== undefined && year < 100) year += 2000;
    if (day >= 1 && day <= 31 && month >= 1 && month <= 12) {
      const y = year ?? (today ? Number(today.slice(0, 4)) : new Date().getFullYear());
      dates.push(
        `${y}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
      );
    }
  }

  // Relative: "besok", "lusa", "hari ini"
  if (today) {
    if (/\b(hari ini|today)\b/i.test(textLower)) dates.push(today);
    if (/\b(besok|tomorrow)\b/i.test(textLower)) dates.push(addDays(today, 1));
    if (/\blusa\b/i.test(textLower)) dates.push(addDays(today, 2));
  }

  // Assign check_in / check_out dari tanggal yang ditemukan
  const uniqueDates = [...new Set(dates)].sort();
  if (uniqueDates.length >= 2) {
    result.check_in = uniqueDates[0];
    result.check_out = uniqueDates[1];
  } else if (uniqueDates.length === 1) {
    result.check_in = uniqueDates[0];
    // Cek pola "X malam" untuk menghitung check_out
    const nightsMatch = text.match(/(\d+)\s*malam/i);
    if (nightsMatch) {
      const nights = Number(nightsMatch[1]);
      if (nights >= 1 && nights <= 30) {
        result.check_out = addDays(uniqueDates[0]!, nights);
      }
    }
  }

  // ── 6. Tipe kamar ─────────────────────────────────────────────────────────
  if (rooms.length > 0) {
    const matched = findMentionedRoomType(text, rooms);
    if (matched) {
      result.room_type = matched.name;
      result.room_type_id = matched.id;
    }
  }

  // Room quantity: "2 kamar", "3x Deluxe"
  const qtyMatch = text.match(/(\d+)\s*(?:kamar|room|x)\b/i);
  if (qtyMatch) {
    const qty = Number(qtyMatch[1]);
    if (qty >= 1 && qty <= 10) result.room_quantity = qty;
  }

  // ── 7. Signal detection ───────────────────────────────────────────────────
  if (PAYMENT_QUESTION_RE.test(text)) result.is_payment_question = true;
  if (BANK_ACCOUNT_RE.test(text)) result.is_bank_account_request = true;
  if (INVOICE_RE.test(text)) result.is_invoice_request = true;
  if (CHECKIN_POLICY_RE.test(text)) result.is_checkin_policy = true;
  if (ROOM_DETAIL_RE.test(text)) result.is_room_detail_question = true;
  if (EARLY_ARRIVAL_RE.test(text)) result.is_early_arrival = true;

  return result;
}

/**
 * Cek slot mana yang masih kosong di BookingContext.
 * Mengembalikan array label slot yang missing (dalam bahasa Indonesia).
 */
export function getMissingSlots(context: {
  checkIn?: string;
  checkOut?: string;
  roomName?: string;
  guestName?: string;
  guestPhone?: string;
}): string[] {
  const missing: string[] = [];
  if (!context.checkIn || !context.checkOut) missing.push("tanggal check-in/check-out");
  if (!context.roomName) missing.push("tipe kamar");
  if (!context.guestName) missing.push("nama lengkap");
  if (!context.guestPhone) missing.push("nomor HP");
  return missing;
}

/**
 * Format ringkasan booking sementara untuk recovery / interrupt responses.
 */
export function formatPartialBookingSummary(context: {
  checkIn?: string;
  checkOut?: string;
  roomName?: string;
  guestName?: string;
  guestPhone?: string;
  adults?: number;
  children?: number;
}): string {
  const lines: string[] = [];
  if (context.roomName) lines.push(`Kamar: ${context.roomName}`);
  if (context.checkIn) lines.push(`Check-in: ${context.checkIn}`);
  if (context.checkOut) lines.push(`Check-out: ${context.checkOut}`);
  if (context.guestName) lines.push(`Nama: ${context.guestName}`);
  if (context.guestPhone) lines.push(`No HP: ${context.guestPhone}`);
  if (context.adults) lines.push(`Dewasa: ${context.adults}`);
  if (context.children) lines.push(`Anak: ${context.children}`);
  return lines.length > 0 ? lines.join(", ") : "(belum ada data)";
}
