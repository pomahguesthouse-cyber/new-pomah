import { MONTHS_ID, clockWIB, fmtDateID, nextDay, todayWIB } from "@/lib/date";

/**
 * Primitif parsing tanggal Bahasa Indonesia — SATU sumber kebenaran.
 *
 * Latar (audit 7 Agu 2026 — B6). Sebelum modul ini ada empat implementasi
 * terpisah yang saling tidak tahu:
 *   1. `services/wa-autoreply/message-parsers.ts` — paling lengkap
 *   2. `tools/availability.tool.ts` (`coerceDate`) — tanpa rollover tahun,
 *      tanpa validasi tanggal nyata
 *   3. `ai/state-machine/flexible-slot-extractor.ts` — alternation bulan sendiri,
 *      tanpa toleransi typo
 *   4. `ai/multi-agent-orchestrator.ts` (`hasExplicitDateSignal`) — regex
 *      deteksi sinyal tanggal versi ketiga
 *
 * Akibatnya satu pesan tamu bisa dibaca berbeda tergantung jalur mana yang
 * kebetulan menanganinya. Insiden 7 Agu 2026 ("masih ada 1 kamar untuk tanggal
 * 8 Agustus 2026" dibalas ketersediaan 18 September) adalah gejala langsung:
 * satu parser gagal, jalur lain memakai tanggal sesi lama, dan tidak ada yang
 * saling mengoreksi.
 *
 * Semua jalur sekarang memanggil fungsi di file ini.
 */

/** Nama & singkatan bulan → nomor bulan (1–12). */
export const ID_MONTHS: Record<string, number> = {
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
  ags: 8,
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
 * Ubah sebuah kata menjadi nomor bulan (1–12). Exact-match dulu, lalu toleransi
 * typo ringan terhadap nama bulan lengkap (insiden 2 Agu 2026: "tgl 18
 * sepember" gagal di-parse sehingga bot memakai tanggal sesi lama).
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

/** Bentuk YYYY-MM-DD, atau `null` bila tanggalnya tidak nyata (mis. 31 Feb). */
export function makeIsoDate(day: number, month: number, year: number): string | null {
  if (!Number.isInteger(day) || !Number.isInteger(month) || !Number.isInteger(year)) return null;
  if (day < 1 || day > 31 || month < 1 || month > 12 || year < 2000 || year > 2100) return null;
  const iso = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const d = new Date(`${iso}T00:00:00Z`);
  if (d.getUTCFullYear() !== year || d.getUTCMonth() + 1 !== month || d.getUTCDate() !== day)
    return null;
  return iso;
}

/**
 * Tentukan tahun untuk sebuah bulan yang disebut tanpa tahun.
 * Bulan yang sudah lewat tahun ini dianggap tahun depan — tamu yang bilang
 * "3 Januari" pada bulan Agustus jelas memaksudkan Januari berikutnya.
 */
export function resolveYear(
  month: number,
  explicitYear: string | undefined,
  today: string,
): number {
  if (explicitYear) {
    return Number(explicitYear.length === 2 ? `20${explicitYear}` : explicitYear);
  }
  const currentYear = Number(today.slice(0, 4));
  const currentMonth = Number(today.slice(5, 7));
  return month < currentMonth ? currentYear + 1 : currentYear;
}

/**
 * Gabungan lengkap: "8", "agustus", "2026" → "2026-08-08".
 * Menangani nama bulan bertipo, tahun 2 digit, tahun implisit (rollover), dan
 * menolak tanggal yang tidak nyata.
 */
export function resolveIdDate(
  day: number,
  monthName: string,
  yearRaw: string | undefined,
  today: string,
): string | null {
  const month = resolveMonthName(monthName);
  if (!month) return null;
  return makeIsoDate(day, month, resolveYear(month, yearRaw, today));
}

/**
 * True bila pesan MENYEBUT tanggal secara eksplisit (nama bulan, "tgl 18",
 * "8/9", atau kata relatif seperti "besok").
 *
 * Dipakai sebagai rem di beberapa tempat: bila sinyal ini ada tetapi parser
 * gagal, jalur cepat TIDAK boleh meminjam tanggal dari sesi lama — tanggal
 * lama hampir pasti bukan yang dimaksud tamu.
 */
export function mentionsExplicitDateSignal(message: string): boolean {
  const text = message.toLowerCase().replace(/\s+/g, " ").trim();
  if (!text) return false;
  if (/\b(hari ini|malam ini|nanti malam|besok|tomorrow|lusa|today)\b/i.test(text)) return true;
  if (/\b(?:tanggal|tangga|tgl)\.?\s*\d{1,2}\b/i.test(text)) return true;
  if (/\b\d{1,2}\s*[/.]\s*\d{1,2}\b/i.test(text)) return true;
  if ((text.match(/[a-z]{4,}/gi) ?? []).some((token) => resolveMonthName(token) !== null)) return true;
  // Nama hari, weekend, malming — sinyal tanggal meski parser butuh konfirmasi.
  return resolveRelativeDayRange(text, "2026-06-15T12:00:00+07:00") !== null;
}

const ID_WEEKDAYS = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"] as const;
const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"] as const;

/** Nama hari Indonesia → indeks JS (0 = Minggu). */
const DAY_NAME_SRC = "senin|selasa|rabu|kamis|juma+t|jum'?at|sabtu|minggu|ahad";
const DAY_NAME_RE = new RegExp(`\\b(?:hari\\s+)?(${DAY_NAME_SRC})\\b`, "gi");

const UNIT_WORD_RE =
  /^(?:kamar|kamarnya|orang|dewasa|anak|bocil|bocah|balita|malam|hari|jam|ribu|rb|juta|jt|unit|th|thn|tahun|pax|tamu|kg|meter|rp)$/i;

export interface ResolvedStayRange {
  checkIn: string;
  checkOut: string;
  /** Bot harus mengonfirmasi, bukan memakai tanggal ini sebagai fakta. */
  needsConfirm?: boolean;
  /**
   * Check-out = check-in + 1 hari karena tamu hanya menyebut satu tanggal.
   * Lookup ketersediaan untuk malam itu boleh. Ringkasan/booking belum boleh
   * sebelum tamu mengiyakan ("Check-in 21 Nov, check-out 22 Nov (1 malam) ya Kak?").
   */
  checkoutAssumed?: boolean;
  reason?: string;
  /** Label untuk tamu, mis. "Sabtu–Minggu, 10–11 Oktober 2026". */
  echo: string;
}

export interface WibClock {
  date: string;
  hour: number;
  minute: number;
}

function weekdayIndex(iso: string): number {
  return new Date(`${iso}T00:00:00Z`).getUTCDay();
}

function addDaysIso(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function canonicalDay(raw: string): { name: string; dow: number } | null {
  const name = raw.toLowerCase().replace(/[^a-z]/g, "");
  if (/^juma+t$/.test(name) || name === "jumat") return { name: "jumat", dow: 5 };
  if (name === "ahad" || name === "minggu") return { name: "minggu", dow: 0 };
  const map: Record<string, number> = {
    senin: 1,
    selasa: 2,
    rabu: 3,
    kamis: 4,
    sabtu: 6,
  };
  const dow = map[name];
  if (dow === undefined) return null;
  return { name, dow };
}

/** "YYYY-MM-DD", "YYYY-MM-DDTHH:MM", atau Date (dibaca sebagai WIB). Tanpa jam → 12:00. */
export function parseWibClock(now: Date | string | WibClock): WibClock {
  if (typeof now === "object" && !(now instanceof Date) && "date" in now) {
    return { date: now.date, hour: now.hour ?? 12, minute: now.minute ?? 0 };
  }
  if (now instanceof Date) {
    const shifted = new Date(now.getTime() + 7 * 3600 * 1000);
    return {
      date: shifted.toISOString().slice(0, 10),
      hour: shifted.getUTCHours(),
      minute: shifted.getUTCMinutes(),
    };
  }
  const s = String(now).trim();
  const dateOnly = /^(\d{4}-\d{2}-\d{2})$/.exec(s);
  if (dateOnly) return { date: dateOnly[1]!, hour: 12, minute: 0 };
  const clock = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})/.exec(s);
  if (clock) return { date: clock[1]!, hour: Number(clock[2]), minute: Number(clock[3]) };
  const parsed = new Date(s);
  if (!Number.isNaN(parsed.getTime())) return parseWibClock(parsed);
  return { date: todayWIB(), hour: 12, minute: 0 };
}

/**
 * Jam hidup hanya bila `today` memang hari ini di WIB. Tanggal historis
 * (test) dianggap siang supaya cutoff 21:00 tidak bergantung pada jam mesin.
 */
export function nowForStayParsing(today?: string, now?: Date | string | WibClock): Date | string | WibClock {
  if (now) return now;
  const date = today && /^\d{4}-\d{2}-\d{2}$/.test(today) ? today : todayWIB();
  if (date === todayWIB()) return `${date}T${clockWIB()}:00+07:00`;
  return `${date}T12:00:00+07:00`;
}

export function formatStayEcho(checkIn: string, checkOut: string): string {
  const inDow = ID_WEEKDAYS[weekdayIndex(checkIn)] ?? "";
  const outDow = ID_WEEKDAYS[weekdayIndex(checkOut)] ?? "";
  const d1 = Number(checkIn.slice(8, 10));
  const m1 = Number(checkIn.slice(5, 7));
  const y1 = checkIn.slice(0, 4);
  const d2 = Number(checkOut.slice(8, 10));
  const m2 = Number(checkOut.slice(5, 7));
  const y2 = checkOut.slice(0, 4);
  const month1 = MONTHS_ID[m1 - 1] ?? "";
  const month2 = MONTHS_ID[m2 - 1] ?? "";
  if (y1 === y2 && m1 === m2) return `${inDow}–${outDow}, ${d1}–${d2} ${month1} ${y1}`;
  if (y1 === y2) return `${inDow}–${outDow}, ${d1} ${month1}–${d2} ${month2} ${y1}`;
  return `${inDow}–${outDow}, ${d1} ${month1} ${y1}–${d2} ${month2} ${y2}`;
}

/** Baris "hari ini" + kalender 7 hari untuk prompt agent. */
export function formatTodayLine(todayIso: string): string {
  const dow = ID_WEEKDAYS[weekdayIndex(todayIso)] ?? "";
  const upcoming: string[] = [];
  let cursor = todayIso;
  for (let i = 0; i < 7; i += 1) {
    cursor = nextDay(cursor);
    const day = Number(cursor.slice(8, 10));
    const month = Number(cursor.slice(5, 7));
    upcoming.push(`${ID_WEEKDAYS[weekdayIndex(cursor)]} ${day} ${MONTHS_SHORT[month - 1]}`);
  }
  return `Hari ini ${dow}, ${fmtDateID(todayIso)} (WIB). Kalender 7 hari: ${upcoming.join(", ")}. Format YYYY-MM-DD: ${todayIso}.`;
}

export function isRelativeDayResolution(reason?: string): boolean {
  if (!reason) return false;
  return /^(day-name|day-range|malam-day|malam-before|malming|weekend|sabtu-depan|minggu-depan|day-depan|weekend-depan)$/.test(
    reason,
  );
}

function nearestWeekday(today: string, targetDow: number, hour: number, minute: number): string {
  const todayDow = weekdayIndex(today);
  let delta = (targetDow - todayDow + 7) % 7;
  if (delta === 0 && hour * 60 + minute >= 21 * 60) delta = 7;
  return addDaysIso(today, delta);
}

function rangeFromDows(
  today: string,
  dowIn: number,
  dowOut: number,
  hour: number,
  minute: number,
): { checkIn: string; checkOut: string } {
  const checkIn = nearestWeekday(today, dowIn, hour, minute);
  let checkOut = nearestWeekday(checkIn, dowOut, 12, 0);
  if (checkOut <= checkIn) checkOut = addDaysIso(checkOut, 7);
  return { checkIn, checkOut };
}

function nightBeforeDay(
  today: string,
  targetDow: number,
  hour: number,
  minute: number,
): { checkIn: string; checkOut: string } {
  const named = nearestWeekday(today, targetDow, hour, minute);
  let checkOut = named;
  let checkIn = addDaysIso(checkOut, -1);
  if (checkIn < today) {
    checkOut = addDaysIso(checkOut, 7);
    checkIn = addDaysIso(checkIn, 7);
  }
  return { checkIn, checkOut };
}

interface DayHit {
  dow: number;
  name: string;
  index: number;
  end: number;
  raw: string;
}

function findDayHits(text: string): DayHit[] {
  const hits: DayHit[] = [];
  for (const match of text.matchAll(DAY_NAME_RE)) {
    const raw = match[1] ?? "";
    const day = canonicalDay(raw);
    if (!day || match.index === undefined) continue;
    const index = match.index;
    const end = index + match[0].length;
    if (day.name === "minggu") {
      const before = text.slice(Math.max(0, index - 16), index);
      if (/(?:akhir|tiap|setiap|\d+)\s+$/i.test(before)) continue;
    }
    hits.push({ dow: day.dow, name: day.name, index, end, raw: match[0] });
  }
  return hits;
}

function hasDepanAfter(text: string, end: number): boolean {
  return /^\s+depan\b/i.test(text.slice(end));
}

function nightCount(text: string): number | null {
  const match = text.match(
    new RegExp(`\\b(\\d{1,2})\\s*malam\\b(?!\\s+(?:hari\\s+)?(?:${DAY_NAME_SRC})\\b)`, "i"),
  );
  if (!match) return null;
  const n = Number(match[1]);
  if (!Number.isInteger(n) || n < 1 || n > 30) return null;
  return n;
}

function bareDayInMonth(day: number, month: number, year: number, today: string): string | null {
  let checkIn = makeIsoDate(day, month, year);
  if (!checkIn) return null;
  if (checkIn < today) {
    let nextMonth = month + 1;
    let nextYear = year;
    if (nextMonth > 12) {
      nextMonth = 1;
      nextYear += 1;
    }
    checkIn = makeIsoDate(day, nextMonth, nextYear);
  }
  return checkIn;
}

function bareDayRange(startDay: number, endDay: number, today: string): { checkIn: string; checkOut: string } | null {
  if (startDay < 1 || startDay > 31 || endDay < 1 || endDay > 31 || startDay === endDay) return null;
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  const checkIn = bareDayInMonth(startDay, month, year, today);
  if (!checkIn) return null;
  const inYear = Number(checkIn.slice(0, 4));
  const inMonth = Number(checkIn.slice(5, 7));
  let checkOut = makeIsoDate(endDay, inMonth, inYear);
  if (!checkOut || checkOut <= checkIn) {
    let nextMonth = inMonth + 1;
    let nextYear = inYear;
    if (nextMonth > 12) {
      nextMonth = 1;
      nextYear += 1;
    }
    checkOut = makeIsoDate(endDay, nextMonth, nextYear);
  }
  if (!checkOut || checkOut <= checkIn) return null;
  return { checkIn, checkOut };
}

function followingWord(text: string, end: number): string {
  return /^[\s,.:;!?-]*([a-z]+)/i.exec(text.slice(end))?.[1]?.toLowerCase() ?? "";
}

type ExplicitStay = { checkIn: string; checkOut: string; checkoutAssumed?: boolean };

function assumedOneNight(checkIn: string): ExplicitStay {
  return { checkIn, checkOut: nextDay(checkIn), checkoutAssumed: true };
}

function precededByCheckoutLabel(text: string, index: number): boolean {
  const before = text.slice(Math.max(0, index - 32), index);
  return /(?:check[\s-]*out|cek[\s-]*out|checkout|cekout)\s+(?:nya\s+)?(?:tanggal\s+|tgl\s+)?$/i.test(before);
}

function labeledStayDate(text: string, label: RegExp, today: string): string | null {
  const re = new RegExp(
    `(?:${label.source})(?:\\s*(?:nya|tanggal|tgl|pada|di|:|jadi|ke|menjadi))*\\s*(\\d{1,2})(?:\\s+([a-z]{3,}))?(?:\\s+(\\d{2,4}))?`,
    "i",
  );
  const match = text.match(re);
  if (!match) return null;
  const month = resolveMonthName(match[2] ?? "");
  if (!month) return null;
  return makeIsoDate(Number(match[1]), month, resolveYear(month, match[3], today));
}

function tryExplicitStay(text: string, today: string): ExplicitStay | null {
  const labeledIn = labeledStayDate(text, /check[\s-]*in|cek[\s-]*in|checkin|cekin/i, today);
  const labeledOut = labeledStayDate(text, /check[\s-]*out|cek[\s-]*out|checkout|cekout/i, today);
  if (labeledIn && labeledOut && labeledOut > labeledIn) {
    return { checkIn: labeledIn, checkOut: labeledOut };
  }
  // Hanya check-out: jangan jadikan tanggal itu check-in + 1 malam.
  if (labeledOut && !labeledIn) return null;
  if (labeledIn && !labeledOut) return assumedOneNight(labeledIn);

  const monthRange =
    /\b(\d{1,2})(?:\s*(?:-|–|—|sampai|sd|s\/d|to|dan)\s*|\s+)(\d{1,2})\s+([a-z]+)\s*(\d{2,4})?\b/gi;
  for (const match of text.matchAll(monthRange)) {
    const month = resolveMonthName(match[3] ?? "");
    if (!month) continue;
    const year = resolveYear(month, match[4], today);
    const checkIn = makeIsoDate(Number(match[1]), month, year);
    const checkOut = makeIsoDate(Number(match[2]), month, year);
    if (checkIn && checkOut && checkOut > checkIn) return { checkIn, checkOut };
  }

  const monthFirst =
    /\b([a-z]+)\s+(?:tanggal|tangga|tgl\.?)?\s*(\d{1,2})(?:\s*(?:-|–|—|sampai|sd|s\/d|to|dan)\s*(\d{1,2}))?\b/gi;
  for (const match of text.matchAll(monthFirst)) {
    const month = resolveMonthName(match[1] ?? "");
    if (!month) continue;
    const year = resolveYear(month, undefined, today);
    const checkIn = makeIsoDate(Number(match[2]), month, year);
    if (!checkIn) continue;
    if (match[3]) {
      const checkOut = makeIsoDate(Number(match[3]), month, year);
      if (checkOut && checkOut > checkIn) return { checkIn, checkOut };
      continue;
    }
    return assumedOneNight(checkIn);
  }

  const dayMonth = /\b(\d{1,2})\s+([a-z]+)\s*(\d{2,4})?\b/gi;
  for (const match of text.matchAll(dayMonth)) {
    if (match.index !== undefined && precededByCheckoutLabel(text, match.index)) continue;
    const month = resolveMonthName(match[2] ?? "");
    if (!month) continue;
    const checkIn = makeIsoDate(Number(match[1]), month, resolveYear(month, match[3], today));
    if (checkIn) return assumedOneNight(checkIn);
  }

  const slash = /\b(\d{1,2})[/.](\d{1,2})(?:[/.](\d{2,4}))?\b/gi;
  for (const match of text.matchAll(slash)) {
    const month = Number(match[2]);
    if (month < 1 || month > 12) continue;
    const checkIn = makeIsoDate(Number(match[1]), month, resolveYear(month, match[3], today));
    if (checkIn) return assumedOneNight(checkIn);
  }

  const labeled =
    /\b(?:tanggal|tangga|tgl)\.?\s*(\d{1,2})(?:\s*(?:-|–|—|sampai|sd|s\/d|to|dan)\s*|\s+)(\d{1,2})\b/gi;
  for (const match of text.matchAll(labeled)) {
    if (match.index === undefined) continue;
    const end = match.index + match[0].length;
    const after = followingWord(text, end);
    if (UNIT_WORD_RE.test(after)) continue;
    const month = after ? resolveMonthName(after) : null;
    if (month) {
      const year = resolveYear(month, undefined, today);
      const checkIn = makeIsoDate(Number(match[1]), month, year);
      const checkOut = makeIsoDate(Number(match[2]), month, year);
      if (checkIn && checkOut && checkOut > checkIn) return { checkIn, checkOut };
      continue;
    }
    const range = bareDayRange(Number(match[1]), Number(match[2]), today);
    if (range) return range;
  }

  const separated =
    /\b(\d{1,2})\s*(?:-|–|—|sampai|sd|s\/d|to|dan)\s*(\d{1,2})\b/gi;
  for (const match of text.matchAll(separated)) {
    if (match.index === undefined) continue;
    const after = followingWord(text, match.index + match[0].length);
    if (UNIT_WORD_RE.test(after) || resolveMonthName(after)) continue;
    const range = bareDayRange(Number(match[1]), Number(match[2]), today);
    if (range) return range;
  }

  const barePair = /\b(\d{1,2})\s+(\d{1,2})\b/gi;
  for (const match of text.matchAll(barePair)) {
    if (match.index === undefined) continue;
    const end = match.index + match[0].length;
    const after = followingWord(text, end);
    if (UNIT_WORD_RE.test(after) || resolveMonthName(after)) continue;
    const before = text.slice(0, match.index).match(/([a-z]+)\s*$/i)?.[1]?.toLowerCase() ?? "";
    if (UNIT_WORD_RE.test(before) || before === "tgl" || before === "tanggal" || before === "tangga") continue;
    const range = bareDayRange(Number(match[1]), Number(match[2]), today);
    if (range) return range;
  }

  const iso = text.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  if (iso && makeIsoDate(Number(iso[1]!.slice(8, 10)), Number(iso[1]!.slice(5, 7)), Number(iso[1]!.slice(0, 4)))) {
    return assumedOneNight(iso[1]!);
  }

  return null;
}

/**
 * Resolver deterministik tanggal relatif Bahasa Indonesia (Asia/Jakarta).
 * Tanggal angka selalu menang atas kata relatif. `needsConfirm` berarti
 * jangan menebak — bot harus mengonfirmasi ke tamu.
 */
export function resolveRelativeDayRange(
  message: string,
  nowWIB: Date | string | WibClock,
): ResolvedStayRange | null {
  const text = message.toLowerCase().replace(/\s+/g, " ").trim();
  if (!text) return null;
  const clock = parseWibClock(nowWIB);
  const today = clock.date;

  const done = (
    checkIn: string,
    checkOut: string,
    reason: string,
    opts?: { needsConfirm?: boolean; nights?: boolean; checkoutAssumed?: boolean },
  ): ResolvedStayRange => {
    let out = checkOut;
    let assumed = opts?.checkoutAssumed === true;
    if (opts?.nights || assumed) {
      const nights = nightCount(text);
      if (nights && nights !== 1) {
        out = addDaysIso(checkIn, nights);
        assumed = false;
      }
    }
    return {
      checkIn,
      checkOut: out,
      needsConfirm: opts?.needsConfirm || undefined,
      checkoutAssumed: assumed || undefined,
      reason,
      echo: formatStayEcho(checkIn, out),
    };
  };

  const explicit = tryExplicitStay(text, today);
  if (explicit) {
    return done(explicit.checkIn, explicit.checkOut, "explicit", {
      checkoutAssumed: explicit.checkoutAssumed,
      nights: explicit.checkoutAssumed === true,
    });
  }

  if (/\bmalming\b/i.test(text)) {
    const span = rangeFromDows(today, 6, 0, clock.hour, clock.minute);
    return done(span.checkIn, span.checkOut, "malming");
  }

  const pair = text.match(
    new RegExp(`\\b(?:hari\\s+)?(${DAY_NAME_SRC})\\s+malam\\s+(?:hari\\s+)?(${DAY_NAME_SRC})\\b`, "i"),
  );
  if (pair) {
    const start = canonicalDay(pair[1] ?? "");
    const end = canonicalDay(pair[2] ?? "");
    if (start && end) {
      const span = rangeFromDows(today, start.dow, end.dow, clock.hour, clock.minute);
      return done(span.checkIn, span.checkOut, "malam-day");
    }
  }

  const nightOf = text.match(new RegExp(`\\bmalam\\s+(?:hari\\s+)?(${DAY_NAME_SRC})\\b`, "i"));
  if (nightOf && nightOf.index !== undefined) {
    const before = text.slice(0, nightOf.index);
    const precededByDay = new RegExp(`(?:${DAY_NAME_SRC})\\s+$`, "i").test(before);
    if (!precededByDay) {
      const day = canonicalDay(nightOf[1] ?? "");
      if (day) {
        const span = nightBeforeDay(today, day.dow, clock.hour, clock.minute);
        const reason = day.name === "minggu" ? "malming" : "malam-before";
        return done(span.checkIn, span.checkOut, reason);
      }
    }
  }

  const hits = findDayHits(text);
  const weekend = /\b(?:weekend|akhir\s+pekan|akhir\s+minggu)(?:\s+ini)?\b/i.test(text);
  if (weekend && hits.length === 0) {
    if (/\b(?:weekend|akhir\s+pekan|akhir\s+minggu)\s+depan\b/i.test(text)) {
      const span = rangeFromDows(today, 6, 0, clock.hour, clock.minute);
      const later = { checkIn: addDaysIso(span.checkIn, 7), checkOut: addDaysIso(span.checkOut, 7) };
      return done(later.checkIn, later.checkOut, "weekend-depan", { needsConfirm: true });
    }
    const span = rangeFromDows(today, 6, 0, clock.hour, clock.minute);
    return done(span.checkIn, span.checkOut, "weekend");
  }

  if (hits.length === 1 && hasDepanAfter(text, hits[0]!.end)) {
    const hit = hits[0]!;
    // "Sabtu depan" / "minggu depan" ambigu: hari terdekat vs minggu berikutnya.
    const nearest = nearestWeekday(today, hit.dow, clock.hour, clock.minute);
    const proposedIn = addDaysIso(nearest, 7);
    const reason = hit.name === "sabtu" ? "sabtu-depan" : hit.name === "minggu" ? "minggu-depan" : "day-depan";
    return done(proposedIn, nextDay(proposedIn), reason, { needsConfirm: true });
  }

  // "minggu depan" tanpa nama hari lain (kata "minggu" = minggu kalender).
  if (hits.length === 0 && /\bminggu\s+depan\b/i.test(text)) {
    const checkIn = addDaysIso(today, 7);
    return done(checkIn, nextDay(checkIn), "minggu-depan", { needsConfirm: true });
  }

  if (hits.length >= 2) {
    const start = hits[0]!;
    const end = hits[1]!;
    if (hasDepanAfter(text, start.end) && end.index > start.end) {
      const reason = start.name === "sabtu" ? "sabtu-depan" : "day-depan";
      const span = rangeFromDows(today, start.dow, end.dow, clock.hour, clock.minute);
      return done(addDaysIso(span.checkIn, 7), addDaysIso(span.checkOut, 7), reason, { needsConfirm: true });
    }
    const between = text.slice(start.end, end.index);
    const cue =
      /\b(?:malam|pagi|siang|sore|sampai|sd|hingga|dan|check\s*-?out|checkout|ceck)\b/i.test(between) ||
      /\b(?:check\s*-?in|checkin|ceck\s*-?in|cek\s*in|ceck\s+in)\b/i.test(text);
    if (cue || hits.length === 2) {
      const span = rangeFromDows(today, start.dow, end.dow, clock.hour, clock.minute);
      return done(span.checkIn, span.checkOut, "day-range");
    }
  }

  if (hits.length === 1) {
    const hit = hits[0]!;
    const checkIn = nearestWeekday(today, hit.dow, clock.hour, clock.minute);
    return done(checkIn, nextDay(checkIn), "day-name", { nights: true });
  }

  if (/\b(malam ini|nanti malam|hari ini|today)\b/i.test(text)) {
    return done(today, nextDay(today), "today", { nights: true });
  }
  if (/\blusa\b/i.test(text)) {
    const checkIn = addDaysIso(today, 2);
    return done(checkIn, nextDay(checkIn), "lusa", { nights: true });
  }
  if (/\b(besok|tomorrow)\b/i.test(text)) {
    const checkIn = nextDay(today);
    const early = clock.hour < 5;
    return done(checkIn, nextDay(checkIn), early ? "besok-early" : "besok", {
      needsConfirm: early,
      nights: true,
    });
  }

  return null;
}
