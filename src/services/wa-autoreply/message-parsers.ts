import { nextDay } from "@/lib/date";

export type ParsedGuestCount = {
  adults: number;
  children: number;
  total: number;
};

const ID_MONTHS: Record<string, number> = {
  jan: 1,
  januari: 1,
  feb: 2,
  februari: 2,
  pebruari: 2,
  mar: 3,
  maret: 3,
  apr: 4,
  april: 4,
  mei: 5,
  jun: 6,
  juni: 6,
  jul: 7,
  juli: 7,
  agu: 8,
  agt: 8,
  agustus: 8,
  sep: 9,
  sept: 9,
  september: 9,
  okt: 10,
  oktober: 10,
  nov: 11,
  november: 11,
  des: 12,
  desember: 12,
};

/** Nama bulan lengkap — dipakai untuk toleransi typo (mis. "sepember"). */
const ID_MONTH_FULL_NAMES = Object.keys(ID_MONTHS).filter((name) => name.length >= 5);

/**
 * Kata yang lazim muncul sebagai "<angka> <kata>" tetapi BUKAN nama bulan
 * (mis. "1 kamar", "2 orang", "3 malam"). Tanpa daftar ini, kandidat pertama
 * seperti "1 kamar" bisa menutup kandidat tanggal asli di belakangnya.
 */
const NON_MONTH_WORDS =
  /^(kamar|kamarnya|room|rooms|orang|dewasa|anak|bocil|bocah|balita|pax|tamu|malam|hari|minggu|bulan|tahun|jam|unit|buah|ribu|rb|juta|jt|k)$/i;

function editDistance(a: string, b: string): number {
  const rows = a.length + 1;
  const cols = b.length + 1;
  let prev = Array.from({ length: cols }, (_, i) => i);
  for (let i = 1; i < rows; i += 1) {
    const curr = [i, ...new Array(cols - 1).fill(0)];
    for (let j = 1; j < cols; j += 1) {
      curr[j] = Math.min(
        prev[j] + 1,
        curr[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = curr;
  }
  return prev[cols - 1];
}

/**
 * Ubah sebuah kata menjadi nomor bulan. Exact-match dulu, lalu toleransi typo
 * ringan terhadap nama bulan lengkap (insiden 2 Agu 2026: "tgl 18 sepember"
 * gagal di-parse sehingga bot memakai tanggal sesi lama).
 * Return `null` bila kata jelas bukan bulan.
 */
export function resolveMonthName(raw: string): number | null {
  const name = raw.toLowerCase().replace(/[^a-z]/g, "");
  if (!name) return null;
  const exact = ID_MONTHS[name];
  if (exact) return exact;
  if (name.length < 4 || NON_MONTH_WORDS.test(name)) return null;

  for (const candidate of ID_MONTH_FULL_NAMES) {
    if (Math.abs(candidate.length - name.length) > 1) continue;
    const maxDistance = candidate.length >= 7 ? 2 : 1;
    if (editDistance(name, candidate) <= maxDistance) return ID_MONTHS[candidate];
  }
  return null;
}

function makeIsoDate(day: number, month: number, year: number): string | null {
  if (!Number.isInteger(day) || !Number.isInteger(month) || !Number.isInteger(year)) return null;
  if (day < 1 || day > 31 || month < 1 || month > 12 || year < 2000 || year > 2100) return null;
  const iso = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const d = new Date(`${iso}T00:00:00Z`);
  if (d.getUTCFullYear() !== year || d.getUTCMonth() + 1 !== month || d.getUTCDate() !== day)
    return null;
  return iso;
}

function resolveYear(month: number, explicitYear: string | undefined, today: string): number {
  if (explicitYear) {
    return Number(explicitYear.length === 2 ? `20${explicitYear}` : explicitYear);
  }
  const currentYear = Number(today.slice(0, 4));
  const currentMonth = Number(today.slice(5, 7));
  return month < currentMonth ? currentYear + 1 : currentYear;
}

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

/**
 * True bila pesan MENYEBUT tanggal secara eksplisit (nama bulan, "tgl 18",
 * "8/9", atau kata relatif). Dipakai sebagai rem: bila sinyal ini ada tetapi
 * `parseAvailabilityDateRange` gagal, fast-path TIDAK boleh meminjam tanggal
 * dari sesi lama — tanggal lama hampir pasti bukan yang dimaksud tamu.
 */
export function mentionsExplicitDateSignal(message: string): boolean {
  const text = message.toLowerCase().replace(/\s+/g, " ").trim();
  if (!text) return false;
  if (/\b(hari ini|malam ini|nanti malam|besok|tomorrow|lusa|today)\b/i.test(text)) return true;
  if (/\b(?:tanggal|tangga|tgl)\.?\s*\d{1,2}\b/i.test(text)) return true;
  if (/\b\d{1,2}\s*[/.]\s*\d{1,2}\b/i.test(text)) return true;
  return (text.match(/[a-z]{4,}/gi) ?? []).some((token) => resolveMonthName(token) !== null);
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
