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

export function capacityGuardFallbackReply(guestTotal: number): string {
  return (
    `Mohon maaf Kak, untuk ${guestTotal} tamu saya cek ulang dulu kombinasi kamar yang kapasitasnya pas di sistem. ` +
    "Boleh dikonfirmasi tanggal check-in dan check-out-nya, Kak?"
  );
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
): { text: string; removed: number; fallback: boolean } {
  if (guestTotal <= 0 || rooms.length === 0) return { text: reply, removed: 0, fallback: false };
  const lines = reply.split("\n");
  const kept = lines.filter((line) => !isInvalidCombinationLine(line, rooms, guestTotal));
  const removed = lines.length - kept.length;
  if (removed === 0) return { text: reply, removed: 0, fallback: false };
  const text = kept.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  if (!text || !kept.some((line) => hasValidCombination(line, rooms, guestTotal))) {
    return { text: capacityGuardFallbackReply(guestTotal), removed, fallback: true };
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
}): { text: string; removed: number; fallback: boolean } {
  const guestTotal = resolveGuardGuestTotal(params.slots, params.inboundBodies);
  const guardRooms = params.rooms
    .map((r) => ({
      name: String(r.name ?? ""),
      capacity: Math.max(1, Number(r.capacity ?? 1) || 1),
      extraBedCapacity: Math.max(0, Number(r.extrabed_capacity ?? 0) || 0),
    }))
    .filter((r) => r.name);
  return guardCombinationCapacity(params.reply, guardRooms, guestTotal);
}
