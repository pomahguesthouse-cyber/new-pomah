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

function buildAliases(rooms: GuardRoom[]): Alias[] {
  const aliases: Alias[] = [];
  const firstWordCount = new Map<string, number>();
  for (const room of rooms) {
    const first = room.name.toLowerCase().split(/\s+/)[0] ?? "";
    firstWordCount.set(first, (firstWordCount.get(first) ?? 0) + 1);
  }
  for (const room of rooms) {
    const lower = room.name.toLowerCase().trim();
    aliases.push({ alias: lower, room });
    const withoutRoom = lower.replace(/\broom\b/g, "").replace(/\s+/g, " ").trim();
    if (withoutRoom && withoutRoom !== lower) aliases.push({ alias: withoutRoom, room });
    const first = lower.split(/\s+/)[0] ?? "";
    if (first && !GENERIC_WORDS.has(first) && firstWordCount.get(first) === 1) {
      aliases.push({ alias: first, room });
    }
  }
  // Alias terpanjang dicocokkan lebih dulu supaya "family room 222" menang atas "family".
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
