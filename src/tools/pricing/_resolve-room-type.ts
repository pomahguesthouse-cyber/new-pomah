/**
 * Shared room-type resolver for pricing tools.
 *
 * Manager biasanya menyebut nama pendek ("Deluxe", "Single") atau UUID.
 * Resolusi tiered supaya "Deluxe" tidak ambigu cocok ke "Grand Deluxe":
 *
 *   1. UUID exact match.
 *   2. Case-insensitive exact name match.
 *   3. Word-boundary match — needle berdiri sebagai kata utuh.
 *   4. Substring fallback — multi-hit → error disambiguation.
 *
 * Pattern dipertahankan agar konsisten dengan `update_room_rate`.
 */

import type { RoomTypeRow } from "@/ai/context-builder";

export type ResolveResult =
  | { ok: true;  room: RoomTypeRow }
  | { ok: false; error: string };

export function resolveRoomType(
  needle: string,
  rooms:  RoomTypeRow[],
): ResolveResult {
  const trimmed = needle.trim();
  if (!trimmed) {
    return {
      ok: false,
      error: "Sebutkan tipe kamar (mis. 'Deluxe').",
    };
  }
  const lower  = trimmed.toLowerCase();
  const isUuid = /^[0-9a-f-]{32,}$/i.test(trimmed);

  let candidates: RoomTypeRow[];
  if (isUuid) {
    candidates = rooms.filter((r) => r.id === trimmed);
  } else {
    const exact = rooms.filter((r) => r.name.toLowerCase().trim() === lower);
    if (exact.length === 1) {
      candidates = exact;
    } else {
      const escaped = lower.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const wordRe  = new RegExp(`(?:^|\\s)${escaped}(?:\\s|$)`, "i");
      const wordHits = rooms.filter((r) => wordRe.test(r.name));
      candidates = wordHits.length > 0
        ? wordHits
        : rooms.filter((r) => r.name.toLowerCase().includes(lower));
    }
  }

  if (candidates.length === 0) {
    return {
      ok: false,
      error:
        `Tipe kamar "${trimmed}" tidak ditemukan. Pilihan tersedia: ` +
        rooms.map((r) => r.name).join(", ") + ".",
    };
  }
  if (candidates.length > 1) {
    return {
      ok: false,
      error:
        `Tipe "${trimmed}" cocok ke beberapa kamar: ` +
        candidates.map((r) => r.name).join(", ") +
        ". Sebutkan nama yang lebih spesifik.",
    };
  }
  return { ok: true, room: candidates[0] };
}
