/**
 * Tool: get_room_specifications
 *
 * Retrieves static room specs (description, amenities, floor_info, extra beds)
 * from the pre-loaded context, saving system prompt tokens.
 */

import type { ToolContext, ToolHandler } from "./types";

function normalizeRoomName(value: unknown): string {
  return String(value ?? "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ");
}

/**
 * Resolve a room type without letting a short name hijack a longer one.
 * Example: input "deluxe" must resolve to the exact room "Deluxe", not
 * "Grand Deluxe" merely because the latter also contains the word deluxe.
 */
function resolveRoomType(roomType: unknown, rooms: ToolContext["rooms"]) {
  const input = normalizeRoomName(roomType);
  if (!input) return null;

  // 1. Exact normalized name always wins.
  const exact = rooms.find((room) => normalizeRoomName(room.name) === input);
  if (exact) return exact;

  // 2. Allow a full room name inside a longer natural-language argument,
  // checking longest names first so "Grand Deluxe" wins only when explicitly
  // present in the input.
  const fullNameMatch = [...rooms]
    .sort((a, b) => normalizeRoomName(b.name).length - normalizeRoomName(a.name).length)
    .find((room) => {
      const name = normalizeRoomName(room.name);
      return name.length >= 3 && input.includes(name);
    });
  if (fullNameMatch) return fullNameMatch;

  // 3. A single-word alias is accepted only when it identifies exactly one
  // room type. Shared aliases such as "deluxe" are intentionally rejected.
  const aliasMatches = rooms.filter((room) => {
    const words = normalizeRoomName(room.name).split(" ").filter(Boolean);
    return words.includes(input);
  });
  return aliasMatches.length === 1 ? aliasMatches[0] : null;
}

export const getRoomSpecifications: ToolHandler = async (
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<string> => {
  const roomTypeName = typeof args.room_type === "string" ? args.room_type.trim() : null;

  if (roomTypeName) {
    const matched = resolveRoomType(roomTypeName, ctx.rooms);
    if (matched) {
      const extrabedCap = Number(matched.extrabed_capacity ?? 0);
      const extrabedRate = Number(matched.extrabed_rate ?? 0);
      return JSON.stringify({
        nama: matched.name,
        harga_dasar_per_malam: Number(matched.base_rate ?? 0),
        kapasitas_tamu: matched.capacity ?? null,
        tipe_tempat_tidur: matched.bed_type ?? null,
        ukuran_tempat_tidur: matched.bed_size ?? null,
        lokasi_lantai: matched.floor_info ?? null,
        deskripsi: matched.description ?? null,
        fasilitas: matched.amenities ?? [],
        kapasitas_extra_bed: extrabedCap,
        tarif_extra_bed_per_malam: extrabedRate,
      });
    }
    return JSON.stringify({ error: `Tipe kamar '${args.room_type}' tidak ditemukan secara unik.` });
  }

  // Return all specifications
  const specs = ctx.rooms.map((r) => {
    const extrabedCap = Number(r.extrabed_capacity ?? 0);
    const extrabedRate = Number(r.extrabed_rate ?? 0);
    return {
      nama: r.name,
      harga_dasar_per_malam: Number(r.base_rate ?? 0),
      kapasitas_tamu: r.capacity ?? null,
      tipe_tempat_tidur: r.bed_type ?? null,
      ukuran_tempat_tidur: r.bed_size ?? null,
      lokasi_lantai: r.floor_info ?? null,
      deskripsi: r.description ?? null,
      fasilitas: r.amenities ?? [],
      kapasitas_extra_bed: extrabedCap,
      tarif_extra_bed_per_malam: extrabedRate,
    };
  });

  return JSON.stringify({ room_specifications: specs });
};