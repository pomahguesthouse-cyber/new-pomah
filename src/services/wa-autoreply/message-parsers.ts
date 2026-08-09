import { nextDay } from "@/lib/date";
// Primitif tanggal Indonesia hidup di @/lib/id-date — satu sumber kebenaran
// yang juga dipakai availability.tool, orchestrator, dan slot extractor
// (audit 7 Agu 2026 — B6). Di-re-export supaya pemanggil lama tidak berubah.
import {
  makeIsoDate,
  mentionsExplicitDateSignal,
  resolveMonthName,
  resolveYear,
} from "@/lib/id-date";

export { mentionsExplicitDateSignal, resolveMonthName };

export type ParsedGuestCount = {
  adults: number;
  children: number;
  total: number;
};

export function parseAvailabilityDateRange(
  message: string,
  today: string,
): { checkIn: string; checkOut: string } | null {
  const text = message.toLowerCase().replace(/\s+/g, " ").trim();
  if (!text) return null;

  const todayMatch = /\b(malam ini|nanti malam|hari ini|today)\b/i.test(text);
  if (todayMatch) return { checkIn: today, checkOut: nextDay(today) };
  if (/\b(besok|tomorrow)\b/i.test(text)) {
    const checkIn = nextDay(today);
    return { checkIn, checkOut: nextDay(checkIn) };
  }
  if (/\blusa\b/i.test(text)) {
    const checkIn = nextDay(nextDay(today));
    return { checkIn, checkOut: nextDay(checkIn) };
  }

  // CATATAN: semua pola di bawah memakai `matchAll` (global) dan `continue`,
  // BUKAN `match` + bail-out. Insiden 7 Agu 2026: "masih ada 1 kamar untuk
  // tanggal 8 Agustus 2026" gagal di-parse karena kandidat pertama "1 kamar"
  // bukan bulan lalu parser langsung menyerah — bot akhirnya memakai tanggal
  // sesi lama (18–19 September) dan menjawab tanggal yang salah.

  // Hari(-hari) diikuti nama bulan, mis. "18-19 September" atau "5 Oktober".
  for (const m of text.matchAll(
    /\b(\d{1,2})\s*(?:-|–|—|sampai|sd|s\/d|to)\s*(\d{1,2})\s+([a-z]+)\s*(\d{2,4})?\b/gi,
  )) {
    const [, d1Raw, d2Raw, monthName, yearRaw] = m;
    const month = resolveMonthName(monthName);
    if (!month) continue;
    const year = resolveYear(month, yearRaw, today);
    const checkIn = makeIsoDate(Number(d1Raw), month, year);
    const checkOut = makeIsoDate(Number(d2Raw), month, year);
    if (checkIn && checkOut && checkOut > checkIn) return { checkIn, checkOut };
  }

  // Nama bulan diikuti hari(-hari), mis. "september tanggal 18-19" atau
  // "bulan september tangga 18-19" (termasuk typo "tangga" tanpa 'l').
  for (const m of text.matchAll(
    /\b([a-z]+)\s+(?:tanggal|tangga|tgl\.?)?\s*(\d{1,2})\s*(?:(?:-|–|—|sampai|sd|s\/d|to)\s*(\d{1,2}))?\b/gi,
  )) {
    const [, monthName, d1Raw, d2Raw] = m;
    const month = resolveMonthName(monthName);
    if (!month) continue;
    const year = resolveYear(month, undefined, today);
    const checkIn = makeIsoDate(Number(d1Raw), month, year);
    if (!checkIn) continue;
    if (d2Raw) {
      const checkOut = makeIsoDate(Number(d2Raw), month, year);
      if (checkOut && checkOut > checkIn) return { checkIn, checkOut };
      continue;
    }
    return { checkIn, checkOut: nextDay(checkIn) };
  }

  // Hari diikuti nama bulan, mis. "8 Agustus 2026".
  for (const m of text.matchAll(/\b(\d{1,2})\s+([a-z]+)\s*(\d{2,4})?\b/gi)) {
    const [, dayRaw, monthName, yearRaw] = m;
    const month = resolveMonthName(monthName);
    if (!month) continue;
    const checkIn = makeIsoDate(Number(dayRaw), month, resolveYear(month, yearRaw, today));
    if (checkIn) return { checkIn, checkOut: nextDay(checkIn) };
  }

  for (const m of text.matchAll(/\b(\d{1,2})[/.](\d{1,2})(?:[/.](\d{2,4}))?\b/gi)) {
    const [, dayRaw, monthRaw, yearRaw] = m;
    const month = Number(monthRaw);
    const checkIn = makeIsoDate(Number(dayRaw), month, resolveYear(month, yearRaw, today));
    if (checkIn) return { checkIn, checkOut: nextDay(checkIn) };
  }

  return null;
}

export function shouldUseDeterministicAvailability(message: string): boolean {
  const text = message.toLowerCase();
  const asksAvailability =
    /\b(ready|tersedia|available|avail|kosong|ada kamar|ada yg|ada yang|ada untuk|masih ada|sisa kamar|kamar.*ada|ada\s+\d{1,2}\s*kamar|cek.*kamar|booking|pesan kamar|menginap)\b/i.test(
      text,
    );
  const hasDateSignal =
    mentionsExplicitDateSignal(text) ||
    /\b\d{1,2}\s*(?:-|–|—|sampai|sd|s\/d|to)\s*\d{1,2}\b/i.test(text);
  return asksAvailability && hasDateSignal;
}

export function looksLikeAvailabilityQuestion(message: string): boolean {
  const text = message.toLowerCase().replace(/\s+/g, " ").trim();
  if (!text) return false;
  if (
    /\b(ready|tersedia|available|availability|avail|kosong|ada kamar|ada room|cek kamar|booking|pesan kamar|menginap)\b/i.test(
      text,
    )
  ) {
    return true;
  }
  return (
    /\b(kamar|room|guesthouse|guest house|penginapan)\b/i.test(text) &&
    /\b(available|availability|avail|tersedia|kosong|ready)\b/i.test(text)
  );
}

export function isPerRoomRentalClarification(message: string): boolean {
  const text = message.toLowerCase().replace(/\s+/g, " ").trim();
  if (!text || text.length > 180) return false;
  if (!/\b(kamar|room)\b/i.test(text) || !/\brumah\b/i.test(text)) return false;
  return (
    /\b(bukan|bkn|tidak)\s+(?:satu\s+)?rumah\b/i.test(text) ||
    /\bper\s+(kamar|room)\b/i.test(text) ||
    /\b(h?itungannya|sistemnya|berarti)\b/i.test(text)
  );
}

export function isAvailabilityNeedDatesQuestion(message: string, today: string): boolean {
  return looksLikeAvailabilityQuestion(message) && !parseAvailabilityDateRange(message, today);
}

export function isAvailabilitySourceContext(message: string): boolean {
  const text = message.toLowerCase().replace(/\s+/g, " ").trim();
  if (!text) return false;
  return (
    /^\[lampiran\b/i.test(text) ||
    /\b(tiktok|tik tok|instagram|ig|facebook|fb|google|maps?|iklan|promo|dapat|dapet|lihat|nemu)\b/i.test(
      text,
    )
  );
}

export function parseGuestCountFollowup(message: string): ParsedGuestCount | null {
  const text = message.toLowerCase().replace(/\s+/g, " ").trim();
  // "bocil"/"bocah" = slang lazim untuk anak — insiden 4 Jul 2026: "2 dewasa
  // dan 2 bocil" terhitung 2 tamu sehingga filter kapasitas salah.
  if (
    !text ||
    !/\b(orang|dewasa|adult|anak|bocil|bocah|balita|child|children|kids?|pax|tamu)\b/i.test(text)
  )
    return null;

  const adultMatch = text.match(
    /(?:dewasa|adult|pax|tamu)\s*(?::?\s*)?(\d{1,2})|(\d{1,2})\s*(?:orang\s+)?(?:dewasa|adult|pax|tamu)\b/i,
  );
  const childMatch = text.match(
    /(?:anak|bocil|bocah|balita|child(?:ren)?|kids?)\s*(?::?\s*)?(\d{1,2})|(\d{1,2})\s*(?:orang\s+)?(?:anak|bocil|bocah|balita|child(?:ren)?|kids?)\b/i,
  );
  const genericMatch = text.match(/\b(\d{1,2})\s*(?:orang|pax|tamu)\b/i);

  let adults = adultMatch ? Number(adultMatch[1] ?? adultMatch[2]) : 0;
  const children = childMatch ? Number(childMatch[1] ?? childMatch[2]) : 0;

  if (!adults && !children && genericMatch) {
    adults = Number(genericMatch[1]);
  }

  if (!Number.isFinite(adults) || !Number.isFinite(children)) return null;
  if (adults < 0 || adults > 20 || children < 0 || children > 20) return null;
  const total = adults + children;
  if (total < 1 || total > 20) return null;

  return { adults, children, total };
}

/** Ambil jumlah kamar eksplisit dari pesan, tanpa menganggapnya sebagai jumlah tamu. */
export function parseRequestedRoomCount(message: string): number | null {
  const text = message.toLowerCase().replace(/\s+/g, " ").trim();
  if (!text) return null;
  const match =
    text.match(/\b(\d{1,2})\s*(?:kamar|rooms?)\b/i) ??
    text.match(/\b(?:kamar|rooms?)\s*(?::?\s*)?(\d{1,2})\b/i);
  if (!match) return null;
  const count = Number(match[1]);
  if (!Number.isInteger(count) || count < 1 || count > 20) return null;
  return count;
}

/**
 * Permintaan kuantitas kamar seperti "mau 3 kamar" adalah kebutuhan booking,
 * bukan pertanyaan availability biasa. Pesan ini harus diteruskan ke agent agar
 * agent membandingkan kebutuhan dengan stok dan menawarkan kombinasi/alternatif,
 * alih-alih fast-path mengulang daftar lalu menanyakan jumlah tamu lagi.
 */
export function isExplicitRoomCountRequirement(message: string): boolean {
  const text = message.toLowerCase().replace(/\s+/g, " ").trim();
  if (!text || text.length > 180 || parseRequestedRoomCount(text) === null) return false;
  if (/\b(hanya|cuma|tinggal|tersedia|available|ada)\b/i.test(text)) return false;
  return (
    /\b(mau|ingin|butuh|perlu|memerlukan|cari|ambil|pesan|booking|book|reserve)\b/i.test(text) ||
    /^\d{1,2}\s*(?:kamar|rooms?)\b/i.test(text)
  );
}

/** True bila pesan tamu DIBUKA dengan sapaan — agar bot membalas sapaan
 *  hanya saat tepat (turn pembuka), tidak mengulang di tengah percakapan. */
export function messageOpensWithGreeting(message: string): boolean {
  return /^\s*(halo|hai|hi|hei|hey|hello|assalam|selamat\s+(pagi|siang|sore|malam)|pagi|siang|sore|malam)\b/i.test(
    message,
  );
}

const ORDER_VERB_RE =
  /\b(pesan|pesankan|booking|bookingkan|book|ambil|fix(?:kan)?|deal|jadi\s+(?:pesan|booking|ambil))\b/i;
export function isExplicitBookingOrder(message: string, rooms: Array<{ name?: unknown }>): boolean {
  const text = message.toLowerCase();
  if (!ORDER_VERB_RE.test(text)) return false;
  const mentionsRoom = (rooms ?? []).some((r) => {
    const nm = String(r?.name ?? "")
      .toLowerCase()
      .trim();
    return nm.length >= 3 && text.includes(nm);
  });
  return mentionsRoom || /\b(extra\s*-?\s*bed|extrabed|atas\s+nama)\b/i.test(text);
}

export function looksLikeBookingInquiry(message: string): boolean {
  const text = message.toLowerCase().replace(/\s+/g, " ").trim();
  if (!text || text.length > 240) return false;
  if (isPerRoomRentalClarification(text)) return false;
  if (isExplicitRoomCountRequirement(text)) return false;
  if (
    /\b(ukuran|kasur|bed|fasilitas|sarapan|breakfast|wifi|ac\b|tv\b|air panas|handuk|kamar mandi|toilet|shower|luas|meter|m2|lantai|view|pemandangan|smoking|merokok|parkir|kolam|balkon|bersih|kebersihan|berisik|bising|tenang|aman|keamanan)\b/i.test(
      text,
    )
  ) {
    return false;
  }
  if (
    /\b(ready|tersedia|available|avail|kosong|ada kamar|cek kamar|cek ketersediaan|booking|pesan kamar|menginap|masih ada|masih available|harga|rate|tarif|per malam|permalam)\b/i.test(
      text,
    )
  ) {
    return true;
  }
  return /\b(kamar|room|guesthouse|guest house|penginapan)\b/i.test(text);
}

/**
 * Satu sumber kebenaran untuk "tamu minta media" (foto / gambar / video /
 * brosur / katalog / virtual tour).
 *
 * Dipakai bersama oleh:
 *   - wa-autoreply.service  → mematikan fast-path deterministik supaya turn
 *     ini sampai ke agent yang bisa memanggil `send_room_photos`.
 *   - multi-agent-orchestrator → memaksa routing ke Front Office, satu-satunya
 *     agent yang memegang tool media.
 *
 * Insiden 9 Agu 2026: definisi ini sebelumnya hanya hidup sebagai regex lokal
 * di service dan tidak dikenal router, sehingga permintaan foto bisa mendarat
 * di Pricing Agent dan dijawab "kami belum bisa menampilkan gambar kamar".
 */
const MEDIA_REQUEST_RE =
  /\b(foto|photo|fotonya|gambar|gambarnya|pic|pics|picture|image|brosur|brochure|katalog|catalog|video|videonya|reels?|penampakan|nampakan|virtual tour|tour 360|tur 360|walkthrough)\b/i;

export function isMediaRequest(message: string): boolean {
  return MEDIA_REQUEST_RE.test(message ?? "");
}

/**
 * Versi burst: benar bila SALAH SATU pesan tamu yang belum terjawab meminta
 * media. Memakai hanya pesan terakhir tidak cukup — pada insiden 9 Agu 2026
 * tamu menulis "apakah ada gambarnya kak?" lalu "harganya berapa ya ka",
 * sehingga pemeriksaan pesan-terakhir kehilangan permintaan fotonya dan turn
 * itu dirutekan sebagai pertanyaan harga.
 */
export function burstWantsMedia(messages: Array<{ direction: string; body?: string }>): boolean {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.direction !== "in") break;
    if (isMediaRequest(m.body ?? "")) return true;
  }
  return false;
}

export function isTonightReply(message: string): boolean {
  return /\b(malam ini|nanti malam|hari ini|today)\b/i.test(message);
}

export function hasRecentPriceContext(
  messages: Array<{ direction: string; body: string }>,
): boolean {
  const recent = messages
    .slice(-6)
    .map((m) => m.body)
    .join("\n")
    .toLowerCase();
  return /\b(harga|rate|tarif|kamar|guest house|guesthouse|tanggal spesifik|check-in|check.?in|ketersediaan)\b/i.test(
    recent,
  );
}
