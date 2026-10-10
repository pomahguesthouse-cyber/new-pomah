/**
 * Penjaga tanggal & ringkasan booking.
 *
 * Insiden 10 Okt 2026 (thread 6287773522112, PG-Y3E3N):
 * koreksi "check-in 20 / check-out 21" hanya mengubah teks balasan.
 * State draft tetap 21–22, ketersediaan tidak dicek ulang, dan
 * create_booking menulis tanggal lama. Satu tanggal ("21 nov") juga
 * langsung dianggap 1 malam tanpa ditanya.
 *
 * Modul ini murni: tanpa I/O. State machine dan create_booking yang
 * memakainya sebagai sumber keputusan.
 */

import { makeIsoDate, resolveIdDate, resolveMonthName, resolveYear } from "@/lib/id-date";

const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"] as const;

const CHECK_IN_LABEL = /check[\s-]*in|cek[\s-]*in|checkin|cekin/i;
const CHECK_OUT_LABEL = /check[\s-]*out|cek[\s-]*out|checkout|cekout/i;

export interface BookingSummarySnapshot {
  checkIn: string;
  checkOut: string;
  rooms: Array<{ roomTypeId: string; quantity: number }>;
  adults: number;
  children: number;
  total: number;
}

export interface StayCorrectionPlan {
  checkIn: string;
  checkOut: string;
  /** Tamu menyebut check-in dan check-out (atau hanya check-out yang tetap sah). */
  explicit: boolean;
  /** Jangan tampilkan ringkasan final sebelum tamu mengiyakan rentang ini. */
  needsConfirm: boolean;
  /** Mempertahankan checkout lama akan memperpanjang menginap. */
  wouldLengthen: boolean;
}

export function countStayNights(checkIn: string, checkOut: string): number {
  const d1 = new Date(`${checkIn}T00:00:00Z`).getTime();
  const d2 = new Date(`${checkOut}T00:00:00Z`).getTime();
  const diff = Math.round((d2 - d1) / 86_400_000);
  return diff > 0 ? diff : 0;
}

export function addStayDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** "2026-11-21" → "21 Nov". */
export function formatDayMon(iso: string): string {
  const day = Number(iso.slice(8, 10));
  const month = Number(iso.slice(5, 7));
  const label = MONTHS_SHORT[month - 1] ?? iso.slice(5, 7);
  return `${day} ${label}`;
}

export function formatStayConfirmQuestion(checkIn: string, checkOut: string): string {
  const nights = Math.max(1, countStayNights(checkIn, checkOut));
  return `Check-in ${formatDayMon(checkIn)}, check-out ${formatDayMon(checkOut)} (${nights} malam) ya Kak?`;
}

export function stripLeadingQuantity(name: string): string {
  return name.replace(/^(?:\d+\s*x\s+)+/i, "").trim();
}

/** "2" + "2x Deluxe" → "2x Deluxe", bukan "2x 2x Deluxe". */
export function formatRoomQuantityLabel(quantity: number, name: string): string {
  const clean = stripLeadingQuantity(name) || name.trim();
  const qty = Math.max(1, Math.floor(Number(quantity) || 1));
  return `${qty}x ${clean}`;
}

export function formatRoomsDisplay(
  rooms: Array<{ quantity: number; roomTypeName: string }> | undefined,
  roomName?: string | null,
): string {
  if (rooms && rooms.length > 0) {
    return rooms.map((room) => formatRoomQuantityLabel(room.quantity, room.roomTypeName)).join(", ");
  }
  const fallback = (roomName ?? "").trim();
  if (!fallback) return "—";
  return fallback.replace(/(\d+\s*x\s+)(?=\d+\s*x\s+)/gi, "");
}

function isoFromDay(day: number, monthName: string | undefined, yearRaw: string | undefined, today: string, fallbackIso?: string): string | null {
  if (monthName && resolveMonthName(monthName)) {
    return resolveIdDate(day, monthName, yearRaw, today);
  }
  if (!fallbackIso || !/^\d{4}-\d{2}-\d{2}$/.test(fallbackIso)) return null;
  return makeIsoDate(day, Number(fallbackIso.slice(5, 7)), Number(fallbackIso.slice(0, 4)));
}

function labeledDay(text: string, label: RegExp, today: string, fallbackIso?: string): string | null {
  const re = new RegExp(
    `(?:${label.source})(?:\\s*(?:nya|tanggal|tgl|pada|di|:|jadi|ke|menjadi))*\\s*(\\d{1,2})(?:\\s+([a-z]{3,}))?(?:\\s+(\\d{2,4}))?`,
    "i",
  );
  const match = text.match(re);
  if (!match) return null;
  const day = Number(match[1]);
  if (!Number.isInteger(day) || day < 1 || day > 31) return null;
  const monthToken = match[2];
  if (monthToken && !resolveMonthName(monthToken)) {
    return isoFromDay(day, undefined, undefined, today, fallbackIso);
  }
  return isoFromDay(day, monthToken, match[3], today, fallbackIso);
}

/**
 * Koreksi tanggal dari pesan tamu terhadap draft yang sudah ada.
 * Hanya check-in tidak pernah diam-diam memperpanjang menginap
 * (20 + checkout lama 22 → 2 malam). Malam lama dipertahankan, lalu ditanya.
 */
export function planStayCorrection(
  message: string,
  current: { checkIn?: string; checkOut?: string },
  today: string,
): StayCorrectionPlan | null {
  const text = message.toLowerCase().replace(/\s+/g, " ").trim();
  if (!text) return null;

  const fallbackIn = current.checkIn;
  const fallbackOut = current.checkOut ?? current.checkIn;
  const checkIn = labeledDay(text, CHECK_IN_LABEL, today, fallbackIn);
  const checkOut = labeledDay(text, CHECK_OUT_LABEL, today, fallbackOut);
  if (!checkIn && !checkOut) return null;

  const oldNights =
    current.checkIn && current.checkOut ? Math.max(1, countStayNights(current.checkIn, current.checkOut)) : 1;

  if (checkIn && checkOut) {
    if (checkOut > checkIn) {
      return { checkIn, checkOut, explicit: true, needsConfirm: false, wouldLengthen: false };
    }
    const proposedOut = addStayDays(checkIn, oldNights);
    return { checkIn, checkOut: proposedOut, explicit: false, needsConfirm: true, wouldLengthen: false };
  }

  if (checkIn && !checkOut) {
    const preservedOut = addStayDays(checkIn, oldNights);
    const keptOldOut = current.checkOut && current.checkOut > checkIn ? current.checkOut : null;
    const wouldLengthen = !!keptOldOut && countStayNights(checkIn, keptOldOut) > oldNights;
    return {
      checkIn,
      checkOut: preservedOut,
      explicit: false,
      needsConfirm: true,
      wouldLengthen,
    };
  }

  if (checkOut && current.checkIn && checkOut > current.checkIn) {
    return { checkIn: current.checkIn, checkOut, explicit: true, needsConfirm: false, wouldLengthen: false };
  }

  if (checkOut) {
    const proposedIn = addStayDays(checkOut, -oldNights);
    if (!proposedIn || proposedIn >= checkOut) return null;
    return { checkIn: proposedIn, checkOut, explicit: false, needsConfirm: true, wouldLengthen: false };
  }

  return null;
}

export function displayedGuestCounts(context: { adults?: number; children?: number }): { adults: number; children: number } {
  const children = Math.max(0, Math.floor(Number(context.children ?? 0) || 0));
  const adults =
    context.adults != null && Number.isFinite(Number(context.adults))
      ? Math.max(0, Math.floor(Number(context.adults)))
      : children > 0
        ? 0
        : 1;
  return { adults, children };
}

export function snapshotFromStay(input: {
  checkIn?: string;
  checkOut?: string;
  rooms?: Array<{ roomTypeId: string; quantity: number }>;
  adults?: number;
  children?: number;
  total: number;
}): BookingSummarySnapshot | null {
  if (!input.checkIn || !input.checkOut) return null;
  const guests = displayedGuestCounts(input);
  const rooms = (input.rooms ?? [])
    .map((room) => ({
      roomTypeId: room.roomTypeId,
      quantity: Math.max(1, Math.floor(Number(room.quantity) || 1)),
    }))
    .sort((a, b) => a.roomTypeId.localeCompare(b.roomTypeId) || a.quantity - b.quantity);
  return {
    checkIn: input.checkIn,
    checkOut: input.checkOut,
    rooms,
    adults: guests.adults,
    children: guests.children,
    total: Math.round(Number(input.total) || 0),
  };
}

function roomKey(rooms: Array<{ roomTypeId: string; quantity: number }>): string {
  const merged = new Map<string, number>();
  for (const room of rooms) {
    merged.set(room.roomTypeId, (merged.get(room.roomTypeId) ?? 0) + room.quantity);
  }
  return [...merged.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([id, qty]) => `${id}:${qty}`)
    .join(",");
}

export function staySnapshotsMatch(shown: BookingSummarySnapshot, latest: BookingSummarySnapshot): boolean {
  return (
    shown.checkIn === latest.checkIn &&
    shown.checkOut === latest.checkOut &&
    shown.adults === latest.adults &&
    shown.children === latest.children &&
    shown.total === latest.total &&
    roomKey(shown.rooms) === roomKey(latest.rooms)
  );
}

export function buildBookingChangeHandoffReply(input: {
  bookingCode: string;
  recordedCheckIn?: string;
  recordedCheckOut?: string;
}): string {
  const dates =
    input.recordedCheckIn && input.recordedCheckOut
      ? ` Check-in ${formatDayMon(input.recordedCheckIn)}, check-out ${formatDayMon(input.recordedCheckOut)}.`
      : "";
  return (
    `Pemesanan ${input.bookingCode} sudah tercatat dan belum saya ubah.${dates} ` +
    `Perubahan tanggal perlu dibantu staf ya Kak — saya sudah teruskan permintaannya ke tim kami.`
  );
}

/** Tahun untuk tanggal berlabel yang sudah punya nama bulan. Dipakai parser bersama. */
export function yearForMonthToken(monthName: string, yearRaw: string | undefined, today: string): number | null {
  const month = resolveMonthName(monthName);
  if (!month) return null;
  return resolveYear(month, yearRaw, today);
}
