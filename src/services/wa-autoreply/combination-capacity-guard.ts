/**
 * Guard kapasitas kombinasi kamar pada balasan LLM (kasus Sofiah, 8 Nov 2026).
 *
 * LLM sempat menawarkan "Family + Single + 1 extra bed" dan "Family + Deluxe"
 * untuk 7 tamu padahal kapasitasnya hanya 6. Modul ini menghitung ulang
 * kapasitas tiap baris kombinasi dari data tipe kamar (capacity +
 * extrabed_capacity) dan membuang baris yang tidak cukup atau mengklaim
 * kapasitas yang salah.
 */

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

type LineAnalysis = {
  units: number;
  standard: number;
  offered: number;
  extraBeds: number;
  claimedCapacity: number | null;
};

export function analyzeCombinationLine(line: string, rooms: GuardRoom[]): LineAnalysis | null {
  let text = ` ${line.toLowerCase()} `;
  let units = 0;
  let standard = 0;
  let extraSlots = 0;
  for (const { alias, room } of buildAliases(rooms)) {
    const re = new RegExp(`(?:(\\d+)\\s*(?:x\\s*)?(?:kamar\\s+)?)?\\b${escapeRegExp(alias)}\\b`, "g");
    text = text.replace(re, (_match, qty: string | undefined) => {
      const quantity = qty ? Math.max(1, Number(qty)) : 1;
      units += quantity;
      standard += quantity * room.capacity;
      extraSlots += quantity * room.extraBedCapacity;
      return " ";
    });
  }
  const extraMatch = /(\d+)?\s*extra\s*bed/.exec(text);
  const extraBeds = extraMatch ? Math.max(1, Number(extraMatch[1] ?? 1)) : 0;
  // Hanya baris yang benar-benar menawarkan kombinasi (≥2 unit kamar, atau kamar + extra bed).
  if (units < 2 && !(units >= 1 && extraBeds > 0)) return null;
  const claim = /kapasitas(?:\s+(?:sampai|hingga|maks(?:imal)?|total))?\s*(\d+)|(?:cukup|muat)\s+(?:untuk\s+)?(\d+)\s*(?:orang|tamu)/.exec(text);
  const claimedCapacity = claim ? Number(claim[1] ?? claim[2]) : null;
  return {
    units,
    standard,
    offered: standard + Math.min(extraBeds, extraSlots),
    extraBeds,
    claimedCapacity,
  };
}

export function isInvalidCombinationLine(line: string, rooms: GuardRoom[], guestTotal: number): boolean {
  const analysis = analyzeCombinationLine(line, rooms);
  if (!analysis) return false;
  if (analysis.offered < guestTotal) return true;
  return analysis.claimedCapacity != null && analysis.claimedCapacity !== analysis.offered;
}

/**
 * Buang baris kombinasi yang tidak cukup untuk `guestTotal` atau yang
 * mengklaim kapasitas berbeda dari hitungan sebenarnya.
 */
export function guardCombinationCapacity(
  reply: string,
  rooms: GuardRoom[],
  guestTotal: number,
): { text: string; removed: number } {
  if (guestTotal <= 0 || rooms.length === 0) return { text: reply, removed: 0 };
  const lines = reply.split("\n");
  const kept = lines.filter((line) => !isInvalidCombinationLine(line, rooms, guestTotal));
  const removed = lines.length - kept.length;
  if (removed === 0) return { text: reply, removed: 0 };
  const text = kept.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  return { text, removed };
}
