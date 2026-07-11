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

  let m = text.match(
    /\b(\d{1,2})\s*(?:-|–|—|sampai|sd|s\/d|to)\s*(\d{1,2})\s+([a-z]+)\s*(\d{2,4})?\b/i,
  );
  if (m) {
    const [, d1Raw, d2Raw, monthName, yearRaw] = m;
    const month = ID_MONTHS[monthName];
    if (!month) return null;
    const year = resolveYear(month, yearRaw, today);
    const checkIn = makeIsoDate(Number(d1Raw), month, year);
    const checkOut = makeIsoDate(Number(d2Raw), month, year);
    if (checkIn && checkOut && checkOut > checkIn) return { checkIn, checkOut };
  }

  m = text.match(/\b(\d{1,2})\s+([a-z]+)\s*(\d{2,4})?\b/i);
  if (m) {
    const [, dayRaw, monthName, yearRaw] = m;
    const month = ID_MONTHS[monthName];
    if (!month) return null;
    const checkIn = makeIsoDate(Number(dayRaw), month, resolveYear(month, yearRaw, today));
    if (checkIn) return { checkIn, checkOut: nextDay(checkIn) };
  }

  m = text.match(/\b(\d{1,2})[/.](\d{1,2})(?:[/.](\d{2,4}))?\b/i);
  if (m) {
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
    /\b(ready|tersedia|available|avail|kosong|ada kamar|ada yg|ada yang|ada untuk|kamar.*ada|cek.*kamar|booking|pesan kamar|menginap)\b/i.test(
      text,
    );
  const hasDateSignal =
    /\b(hari ini|malam ini|besok|lusa|januari|februari|maret|april|mei|juni|juli|agustus|september|oktober|november|desember)\b/i.test(
      text,
    ) ||
    /\b\d{1,2}\s*(?:-|–|—|sampai|sd|s\/d|to)\s*\d{1,2}\b/i.test(text) ||
    /\b\d{1,2}[/.]\d{1,2}\b/i.test(text);
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
