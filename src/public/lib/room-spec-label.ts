/**
 * Label spesifikasi kamar untuk kartu & halaman publik.
 * Unit dengan ≥2 kamar tidur tidak menampilkan satu jenis kasur, karena
 * belum ada data kasur per kamar tidur (jangan mengarang konfigurasi).
 */
import { roomLayoutCount } from "@/lib/room-layout";

export type RoomSpecInput = {
  capacity?: number | null;
  size_sqm?: number | null;
  bed_type?: string | null;
  bedrooms?: number | null;
  bathrooms?: number | null;
};

export const MULTI_BEDROOM_BED_NOTE = "Konfigurasi kasur per kamar tidur: tanyakan via WhatsApp";

export function isMultiBedroom(room: RoomSpecInput): boolean {
  return roomLayoutCount(room.bedrooms) >= 2;
}

/** Bagian spesifikasi, mis. ["4 tamu", "50 m²", "2 kamar tidur", "2 kamar mandi"]. */
export function roomSpecParts(room: RoomSpecInput): string[] {
  const parts: string[] = [];
  if (room.capacity) parts.push(`${room.capacity} tamu`);
  if (room.size_sqm) parts.push(`${room.size_sqm} m²`);
  if (isMultiBedroom(room)) {
    parts.push(`${roomLayoutCount(room.bedrooms)} kamar tidur`);
    if (room.bathrooms != null && roomLayoutCount(room.bathrooms) >= 1) {
      parts.push(`${roomLayoutCount(room.bathrooms)} kamar mandi`);
    }
  } else {
    const bed = typeof room.bed_type === "string" ? room.bed_type.trim() : "";
    if (bed) parts.push(bed);
  }
  return parts;
}

export function roomSpecLabel(room: RoomSpecInput): string {
  return roomSpecParts(room).join(" · ");
}

/** Baris kasur untuk halaman detail; null bila tidak ada data untuk kamar 1 kamar tidur. */
export function roomBedLine(room: RoomSpecInput): string | null {
  if (isMultiBedroom(room)) return MULTI_BEDROOM_BED_NOTE;
  const bed = typeof room.bed_type === "string" ? room.bed_type.trim() : "";
  return bed || null;
}
