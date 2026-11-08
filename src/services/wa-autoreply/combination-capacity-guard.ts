/**
 * Guard kapasitas kombinasi kamar pada balasan LLM (kasus Sofiah, 8 Nov 2026).
 *
 * LLM sempat menawarkan "Family + Single + 1 extra bed" dan "Family + Deluxe"
 * untuk 7 tamu padahal kapasitasnya hanya 6. Modul ini menghitung ulang
 * kapasitas tiap opsi kombinasi dari data tipe kamar (capacity +
 * extrabed_capacity) dengan rumus yang sama dengan jalur deterministik:
 * kapasitas standar unit + extra bed yang disebut (dibatasi slot extra bed).
 * Fail-closed: bila tidak tersisa opsi valid, seluruh balasan diganti teks
 * aman tanpa harga dan tanpa ajakan booking.
 */

import { parseGuestCountFollowup } from "@/services/wa-autoreply/message-parsers";
import { formatStayEcho } from "@/lib/id-date";
import { fmtDateID } from "@/lib/date";

export type GuardRoom = {
  name: string;
  capacity: number;
  extraBedCapacity: number;
};

type Alias = { alias: string; room: GuardRoom };

const GENERIC_WORDS = new Set(["room", "kamar", "suite", "tipe", "type"]);

function sameCapacity(a: GuardRoom, b: GuardRoom): boolean {
  return a.capacity === b.capacity && a.extraBedCapacity === b.extraBedCapacity;
}

function buildAliases(rooms: GuardRoom[]): Alias[] {
  // Kandidat alias per tipe: nama lengkap, tanpa "room", tanpa nomor, kata pertama.
  const candidates = new Map<string, GuardRoom[]>();
  const add = (alias: string, room: GuardRoom) => {
    const key = alias.replace(/\s+/g, " ").trim();
    if (!key || GENERIC_WORDS.has(key)) return;
    const list = candidates.get(key) ?? [];
    if (!list.includes(room)) list.push(room);
    candidates.set(key, list);
  };
  for (const room of rooms) {
    const lower = room.name.toLowerCase().trim();
    const noRoom = lower.replace(/\broom\b/g, " ");
    add(lower, room);
    add(noRoom, room);
    add(lower.replace(/\b\d+\b/g, " "), room);
    add(noRoom.replace(/\b\d+\b/g, " "), room);
    add(lower.split(/\s+/)[0] ?? "", room);
  }
  // Alias ambigu (mis. "family" → Family Room 222 & Family Suite 100) tetap
  // dipakai bila semua tipe yang cocok punya kapasitas identik.
  const aliases: Alias[] = [];
  for (const [alias, list] of candidates) {
    if (list.every((room) => sameCapacity(room, list[0]!))) aliases.push({ alias, room: list[0]! });
  }
  // Alias terpanjang dicocokkan lebih dulu ("grand deluxe" menang atas "deluxe").
  return aliases.sort((a, b) => b.alias.length - a.alias.length);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

type SegmentAnalysis = {
  units: number;
  standard: number;
  offered: number;
  extraBeds: number;
  claimedCapacity: number | null;
};

export function analyzeCombinationLine(line: string, rooms: GuardRoom[]): SegmentAnalysis | null {
  let text = ` ${line.toLowerCase()} `;
  // Extra bed dihitung & dihapus dulu supaya angkanya tidak terbaca sebagai jumlah kamar.
  let extraBeds = 0;
  text = text.replace(/(\d+)?\s*(?:unit\s+)?extra\s*-?\s*bed/g, (_m, qty: string | undefined) => {
    extraBeds += qty ? Math.max(1, Number(qty)) : 1;
    return " ";
  });
  let units = 0;
  let standard = 0;
  let extraSlots = 0;
  for (const { alias, room } of buildAliases(rooms)) {
    const re = new RegExp(`(?:(\\d+)\\s*(?:x\\s*)?(?:kamar\\s+|unit\\s+)?)?\\b${escapeRegExp(alias)}\\b`, "g");
    text = text.replace(re, (_match, qty: string | undefined) => {
      const quantity = qty ? Math.max(1, Number(qty)) : 1;
      units += quantity;
      standard += quantity * room.capacity;
      extraSlots += quantity * room.extraBedCapacity;
      return " ";
    });
  }
  // Hanya opsi yang benar-benar kombinasi (≥2 unit kamar, atau kamar + extra bed).
  if (units < 2 && !(units >= 1 && extraBeds > 0)) return null;
  const claim =
    /kapasitas(?:\s+(?:sampai|hingga|maks(?:imal)?|total))?\s*(\d+)|(?:cukup|muat)\s+(?:untuk\s+)?(\d+)\s*(?:orang|tamu)/.exec(text);
  const claimedCapacity = claim ? Number(claim[1] ?? claim[2]) : null;
  return {
    units,
    standard,
    offered: standard + Math.min(extraBeds, extraSlots),
    extraBeds,
    claimedCapacity,
  };
}

function splitOptions(line: string): string[] {
  return line.split(/\batau\b|;|\balternatif(?:nya)?\b/i);
}

function segmentInvalid(segment: string, rooms: GuardRoom[], guestTotal: number): boolean {
  const analysis = analyzeCombinationLine(segment, rooms);
  if (!analysis) return false;
  if (analysis.offered < guestTotal) return true;
  return analysis.claimedCapacity != null && analysis.claimedCapacity !== analysis.offered;
}

export function isInvalidCombinationLine(line: string, rooms: GuardRoom[], guestTotal: number): boolean {
  return splitOptions(line).some((segment) => segmentInvalid(segment, rooms, guestTotal));
}

function hasValidCombination(line: string, rooms: GuardRoom[], guestTotal: number): boolean {
  return splitOptions(line).some((segment) => {
    const analysis = analyzeCombinationLine(segment, rooms);
    return analysis != null && !segmentInvalid(segment, rooms, guestTotal);
  });
}

export type GuardStayContext = {
  /** Tanggal stay yang sudah diketahui (slot/summary). */
  checkIn?: string | null;
  checkOut?: string | null;
  /** true bila checkout hanya diasumsikan +1 malam. */
  checkoutAssumed?: boolean;
  /** Pesan tamu terakhir — dipakai untuk membaca kombinasi yang ia pilih. */
  lastInbound?: string;
};

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Teks fallback guard. Kasus Sofiah 8 Nov 2026: tanggal 11–12 Des sudah ada di
 * slot, tetapi fallback lama SELALU menanyakan check-in & check-out lagi.
 * Sekarang hanya slot yang kosong/ambigu yang ditanyakan, dan pilihan kamar
 * tamu dijawab dengan kebutuhan extra bed yang sebenarnya.
 */
export function capacityGuardFallbackReply(
  guestTotal: number,
  stay?: GuardStayContext,
  rooms: GuardRoom[] = [],
): string {
  const hasIn = !!stay?.checkIn && ISO.test(stay.checkIn);
  const hasOut = hasIn && !!stay?.checkOut && ISO.test(stay.checkOut) && stay.checkOut! > stay.checkIn!;
  if (!hasIn) {
    return (
      `Mohon maaf Kak, untuk ${guestTotal} tamu saya cek ulang dulu kombinasi kamar yang kapasitasnya pas di sistem. ` +
      "Boleh dikonfirmasi tanggal check-in dan check-out-nya, Kak?"
    );
  }
  const period = hasOut ? formatStayEcho(stay!.checkIn!, stay!.checkOut!) : fmtDateID(stay!.checkIn!);
  const sel = stay?.lastInbound ? analyzeCombinationLine(stay.lastInbound, rooms) : null;
  let body: string;
  if (sel && sel.standard >= guestTotal) {
    body = `pilihan kamar Kakak sudah cukup untuk ${guestTotal} tamu (kapasitas standar ${sel.standard} orang).`;
  } else if (sel && sel.standard + extraSlotsOf(stay!.lastInbound!, rooms) >= guestTotal) {
    const need = guestTotal - sel.standard;
    body =
      `pilihan kamar Kakak kapasitas standarnya ${sel.standard} orang, jadi perlu tambahan ${need} extra bed ` +
      `agar cukup untuk ${guestTotal} tamu. Apakah mau dilanjutkan dengan tambahan ${need} extra bed, Kak?`;
  } else if (sel) {
    body =
      `pilihan kamar Kakak maksimal ${sel.standard + extraSlotsOf(stay!.lastInbound!, rooms)} orang meski ditambah extra bed, ` +
      `belum cukup untuk ${guestTotal} tamu. Boleh pilih kombinasi kamar lain, Kak?`;
  } else {
    body = `boleh disebutkan kombinasi kamar yang Kakak inginkan? Nanti kami hitungkan kapasitasnya.`;
  }
  const checkoutAsk =
    !hasOut
      ? " Check-out-nya tanggal berapa, Kak?"
      : stay?.checkoutAssumed
        ? ` Check-out-nya tanggal ${fmtDateID(stay!.checkOut!)} (1 malam) ya, Kak?`
        : "";
  return `Untuk ${guestTotal} tamu pada ${period}, ${body}${checkoutAsk}`;
}

function extraSlotsOf(line: string, rooms: GuardRoom[]): number {
  let text = ` ${line.toLowerCase()} `.replace(/(\d+)?\s*(?:unit\s+)?extra\s*-?\s*bed/g, " ");
  let slots = 0;
  for (const { alias, room } of buildAliases(rooms)) {
    const re = new RegExp(`(?:(\\d+)\\s*(?:x\\s*)?(?:kamar\\s+|unit\\s+)?)?\\b${escapeRegExp(alias)}\\b`, "g");
    text = text.replace(re, (_m, qty: string | undefined) => {
      slots += (qty ? Math.max(1, Number(qty)) : 1) * room.extraBedCapacity;
      return " ";
    });
  }
  return slots;
}


/**
 * Buang opsi kombinasi yang tidak cukup untuk `guestTotal` atau yang
 * mengklaim kapasitas berbeda. Fail-closed: bila setelah itu tidak ada opsi
 * kombinasi valid tersisa, kembalikan teks fallback aman.
 */
export function guardCombinationCapacity(
  reply: string,
  rooms: GuardRoom[],
  guestTotal: number,
  stay?: GuardStayContext,
): { text: string; removed: number; fallback: boolean } {
  if (guestTotal <= 0 || rooms.length === 0) return { text: reply, removed: 0, fallback: false };
  const lines = reply.split("\n");
  const kept = lines.filter((line) => !isInvalidCombinationLine(line, rooms, guestTotal));
  const removed = lines.length - kept.length;
  if (removed === 0) return { text: reply, removed: 0, fallback: false };
  const text = kept.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  if (!text || !kept.some((line) => hasValidCombination(line, rooms, guestTotal))) {
    return { text: capacityGuardFallbackReply(guestTotal, stay, rooms), removed, fallback: true };
  }
  return { text, removed, fallback: false };
}

/** Jumlah tamu dari slot (adults/partialAdults/guestCount + children) atau pesan tamu terakhir. */
export function resolveGuardGuestTotal(
  slots: Record<string, unknown>,
  inboundBodies: string[],
): number {
  const adults = Number(slots.adults ?? slots.partialAdults ?? slots.guestCount ?? 0) || 0;
  const children = Number(slots.children ?? slots.partialChildren ?? 0) || 0;
  if (adults > 0) return adults + children;
  const parsed = inboundBodies
    .map((body) => parseGuestCountFollowup(body)?.total ?? 0)
    .filter((n) => n > 0);
  return parsed.length > 0 ? parsed[parsed.length - 1]! : 0;
}

/**
 * Titik integrasi yang dipanggil wa-autoreply.service untuk finalReply LLM.
 * `rooms` = baris room_types (name, capacity, extrabed_capacity).
 */
export function applyCombinationGuardToReply(params: {
  reply: string;
  rooms: Array<Record<string, unknown>>;
  slots: Record<string, unknown>;
  inboundBodies: string[];
  stay?: GuardStayContext;
}): { text: string; removed: number; fallback: boolean } {
  const guestTotal = resolveGuardGuestTotal(params.slots, params.inboundBodies);
  const guardRooms = params.rooms
    .map((r) => ({
      name: String(r.name ?? ""),
      capacity: Math.max(1, Number(r.capacity ?? 1) || 1),
      extraBedCapacity: Math.max(0, Number(r.extrabed_capacity ?? 0) || 0),
    }))
    .filter((r) => r.name);
  return guardCombinationCapacity(params.reply, guardRooms, guestTotal, params.stay);
}

/** Pesan tamu yang memilih ≥2 unit kamar / kamar + extra bed (bukan bertanya). */
export function isRoomSelectionMessage(message: string, rooms: Array<Record<string, unknown>>): boolean {
  if (!message || /\?\s*$/.test(message.trim())) return false;
  if (!/\b(boleh|ambil|pilih|mau|jadi|oke|ok|iya+|ya|deal|fix)\b/i.test(message)) return false;
  const guardRooms = rooms
    .map((r) => ({
      name: String(r.name ?? ""),
      capacity: Math.max(1, Number(r.capacity ?? 1) || 1),
      extraBedCapacity: Math.max(0, Number(r.extrabed_capacity ?? 0) || 0),
    }))
    .filter((r) => r.name);
  return analyzeCombinationLine(message, guardRooms) !== null;
}
