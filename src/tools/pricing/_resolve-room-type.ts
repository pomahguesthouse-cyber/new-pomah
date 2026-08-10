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
import { roomNameTokens, stripRoomNoise } from "@/lib/room-name";

export type ResolveResult =
  | { ok: true;  room: RoomTypeRow }
  | { ok: false; error: string };

export function resolveRoomType(
  needle: string,
  rooms:  RoomTypeRow[],
): ResolveResult {
  const original = String(needle ?? "").trim();
  if (!original) {
    return {
      ok: false,
      error:
        "Sebutkan tipe kamar yang harganya diubah. Pilihan: " +
        rooms.map((r) => r.name).join(", ") + ".",
    };
  }

  const isUuid = /^[0-9a-f-]{32,}$/i.test(original);
  if (isUuid) {
    const hit = rooms.find((r) => r.id === original);
    return hit
      ? { ok: true, room: hit }
      : {
          ok: false,
          error:
            `Tipe kamar dengan id "${original}" tidak ada. Pilihan: ` +
            rooms.map((r) => r.name).join(", ") + ".",
        };
  }

  // Buang kata pengisi ("kamar Single menjadi" → "Single") SEBELUM mencocokkan.
  // Tanpa ini, argumen yang diteruskan LLM gagal resolve dan percakapan berputar.
  const trimmed = stripRoomNoise(original);
  const lower = trimmed.toLowerCase();

  let candidates: RoomTypeRow[];
  const exact = rooms.filter((r) => r.name.toLowerCase().trim() === lower);
  if (exact.length === 1) {
    candidates = exact;
  } else {
    const escaped = lower.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const wordRe  = new RegExp(`(?:^|\\s)${escaped}(?:\\s|$)`, "i");
    const wordHits = rooms.filter((r) => wordRe.test(r.name));
    if (wordHits.length > 0) {
      candidates = wordHits;
    } else {
      const substrHits = rooms.filter((r) => r.name.toLowerCase().includes(lower));
      // Fallback terakhir: cocokkan per-token, sehingga urutan kata yang beda
      // ("suite family 100") atau sisa kata pengisi tetap menemukan kamarnya.
      candidates = substrHits.length > 0 ? substrHits : matchByTokens(trimmed, rooms);
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

/**
 * Cocokkan per-token, dengan syarat KETAT: SETIAP token needle harus ada di
 * nama kamar. Tanpa syarat ini fallback jadi berbahaya — "Suite Presidential"
 * akan menyambar "Family Suite 100" hanya karena berbagi kata "suite", lalu
 * diam-diam mengubah tarif kamar yang salah.
 *
 * Bila lebih dari satu kamar memenuhi, semuanya dikembalikan supaya pemanggil
 * meminta disambiguasi alih-alih menebak.
 */
function matchByTokens(needle: string, rooms: RoomTypeRow[]): RoomTypeRow[] {
  const needleTokens = roomNameTokens(needle);
  if (needleTokens.length === 0) return [];

  return rooms.filter((room) => {
    const tokens = new Set(roomNameTokens(room.name));
    return tokens.size > 0 && needleTokens.every((t) => tokens.has(t));
  });
}
