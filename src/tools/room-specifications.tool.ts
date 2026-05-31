/**
 * Tool: get_room_specifications
 *
 * Retrieves static room specs (description, amenities, floor_info, extra beds)
 * from the pre-loaded context, saving system prompt tokens.
 */

import type { ToolContext, ToolHandler } from "./types";

export const getRoomSpecifications: ToolHandler = async (
  args: Record<string, unknown>,
  ctx:  ToolContext,
): Promise<string> => {
  const roomTypeName = typeof args.room_type === "string" ? args.room_type.trim().toLowerCase() : null;

  if (roomTypeName) {
    const matched = ctx.rooms.find((r) => r.name.toLowerCase().includes(roomTypeName));
    if (matched) {
      const extrabedCap = Number(matched.extrabed_capacity ?? 0);
      const extrabedRate = Number(matched.extrabed_rate ?? 0);
      return JSON.stringify({
        nama: matched.name,
        harga_dasar_per_malam: Number(matched.base_rate ?? 0),
        kapasitas_tamu: matched.capacity ?? null,
        tipe_tempat_tidur: matched.bed_type ?? null,
        lokasi_lantai: matched.floor_info ?? null,
        deskripsi: matched.description ?? null,
        fasilitas: matched.amenities ?? [],
        kapasitas_extra_bed: extrabedCap,
        tarif_extra_bed_per_malam: extrabedRate,
      });
    }
    return JSON.stringify({ error: `Tipe kamar '${args.room_type}' tidak ditemukan.` });
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
      lokasi_lantai: r.floor_info ?? null,
      deskripsi: r.description ?? null,
      fasilitas: r.amenities ?? [],
      kapasitas_extra_bed: extrabedCap,
      tarif_extra_bed_per_malam: extrabedRate,
    };
  });

  return JSON.stringify({ room_specifications: specs });
};
