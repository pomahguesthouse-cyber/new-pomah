/**
 * Rencana balasan foto/brosur tanpa giliran LLM.
 *
 * Sejak 28 Sep 2026 (permintaan owner): permintaan foto kamar dijawab dengan
 * brosur PDF sebagai dokumen WhatsApp (berisi foto semua tipe kamar). Foto per
 * kamar hanya dipakai sebagai cadangan bila brosur tidak tersedia.
 *
 * Hanya pesan yang murni minta media (bukan harga, ketersediaan, atau booking
 * dalam burst yang sama). Permintaan campuran tetap ke Front Office supaya
 * jawaban harga tidak tertelan — insiden 9 Agu 2026.
 */

import { isMediaRequest, isViewRoomRequest } from "@/services/wa-autoreply/message-parsers";

export interface GalleryRoom {
  name: string;
  hero_image_url?: string | null;
  images?: Array<string | null> | null;
}

export const MEDIA_FAST_PATH_PHOTO_REPLY =
  "Dengan senang hati Kak 😊 Ini foto kamarnya ya. Rencana menginap tanggal berapa dan untuk berapa orang?";

export const MEDIA_FAST_PATH_ALREADY_SENT_REPLY =
  "Foto kamarnya sudah kami kirim tadi ya Kak 😊 Silakan dilihat-lihat dulu, dan kalau berkenan, boleh kami bantu cek tanggal menginapnya?";

export const MEDIA_FAST_PATH_BROCHURE_REPLY =
  "Dengan senang hati Kak 😊 Ini brosur kami ya. Rencana menginap tanggal berapa dan untuk berapa orang?";

export const MEDIA_FAST_PATH_PHOTO_BROCHURE_REPLY =
  "Dengan senang hati Kak 😊 Ini brosur kamar kami ya, di dalamnya ada foto-foto lengkap tiap tipe kamar. Rencana menginap tanggal berapa dan untuk berapa orang?";

export const MEDIA_FAST_PATH_BROCHURE_ALREADY_SENT_REPLY =
  "Brosurnya sudah kami kirim tadi ya Kak 😊 Silakan dibuka dulu, dan kalau berkenan, boleh kami bantu cek tanggal menginapnya?";

export interface RoomPhotosPlan {
  kind: "room_photos";
  roomType: string | null;
  maxPhotos: number;
  maxRooms: number;
  alsoBrochure: boolean;
  reply: string;
}

export type MediaFastPathPlan =
  | RoomPhotosPlan
  | {
      kind: "brochure";
      reply: string;
      /** Foto per kamar bila brosur PDF tidak ditemukan. `null` = serahkan ke LLM. */
      photoFallback: RoomPhotosPlan | null;
    };

const PHOTO_RE =
  /\b(foto(?:2|nya|-foto)?|photos?|gambar(?:2|nya|-gambar)?|pict?ures?|pics?|images?|penampakan|nampakan)\b/i;
const BROCHURE_RE =
  /\b(?:(?:brosur|brochure|katalog|catalog|catalogue)(?:nya)?|pricelist|price list|daftar harga bergambar)\b/i;
const TOUR_OR_VIDEO_RE = /\b(virtual tour|tour 360|tur 360|walkthrough|video|videonya|reels?)\b/i;
const MIXED_LLM_RE =
  /\b(berapa|harga|tarif|rate|biaya|kosong|tersedia|available|availability|booking|pesan(?:kan)?(?:\s+kamar)?|reservasi|check-?in|check-?out|malam ini|nanti malam|hari ini|tanggal|tgl|refund|bayar|transfer|invoice|dp)\b/i;
const GENERIC_ROOM_WORDS = new Set([
  "foto",
  "fotonya",
  "gambar",
  "gambarnya",
  "photo",
  "image",
  "kamar",
  "kamarnya",
  "room",
  "minta",
  "kirim",
  "brosur",
  "brochure",
  "katalog",
]);
const ROOM_HINT_RE =
  /\b(deluxe|family|suite|single|twin|superior|standard|standar|grand|vip|executive)\b/i;
const COMPLAINT_RE =
  /\b(rusak|mati|bocor|kotor|komplain|kecewa|wifi|ac|air mati|tidak bisa|ga bisa|gak bisa)\b/i;

function normalizeName(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function roomHasGallery(room: GalleryRoom): boolean {
  if (typeof room.hero_image_url === "string" && room.hero_image_url.trim()) return true;
  return (room.images ?? []).some((u) => typeof u === "string" && u.trim().length > 0);
}

/** Cocokkan nama tipe kamar yang disebut tamu. `null` bila tidak spesifik atau ambigu. */
export function matchGalleryRoom<T extends { name: string }>(text: string, rooms: T[]): T | null {
  const q = normalizeName(text);
  if (!q) return null;
  const exact = rooms.find((r) => normalizeName(r.name) === q);
  if (exact) return exact;
  const contains = [...rooms]
    .sort((a, b) => normalizeName(b.name).length - normalizeName(a.name).length)
    .find((r) => {
      const n = normalizeName(r.name);
      return n.length >= 3 && q.includes(n);
    });
  if (contains) return contains;
  const words = new Set(q.split(" ").filter((w) => w.length >= 4 && !GENERIC_ROOM_WORDS.has(w)));
  const alias = rooms.filter((r) =>
    normalizeName(r.name)
      .split(" ")
      .some((part) => part.length >= 4 && words.has(part)),
  );
  return alias.length === 1 ? alias[0]! : null;
}

export function roomsForPhotoPlan<T extends GalleryRoom>(
  rooms: T[],
  plan: RoomPhotosPlan,
): T[] {
  const withGallery = rooms.filter(roomHasGallery);
  if (plan.roomType) {
    const matched = matchGalleryRoom(plan.roomType, withGallery);
    return matched ? [matched] : withGallery;
  }
  return withGallery.slice(0, plan.maxRooms);
}

function pendingInbound(messages: Array<{ direction: string; body?: string }>): string[] {
  const bodies: string[] = [];
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (!m || m.direction !== "in") break;
    bodies.push(m.body ?? "");
  }
  return bodies.reverse();
}

/**
 * `null` = jangan short-circuit; biarkan Front Office (harga, tour, atau
 * galeri belum diketahui).
 */
export function planMediaFastPath(
  messages: Array<{ direction: string; body?: string }>,
  rooms: GalleryRoom[],
): MediaFastPathPlan | null {
  const burst = pendingInbound(messages);
  if (burst.length === 0) return null;
  const text = burst.join("\n").trim();
  if (!text || text.length > 280) return null;

  const wantsPhoto = PHOTO_RE.test(text);
  const wantsBrochure = BROCHURE_RE.test(text);
  const wantsView = isViewRoomRequest(text);
  if (!wantsPhoto && !wantsBrochure && !wantsView && !isMediaRequest(text)) return null;
  // Burst campuran (keluhan + minta foto) tidak boleh dijawab hanya dengan foto.
  const fillerOnly = /^(?:halo+|hai+|hi+|hey+|kak|kakak|ya+|ok|oke|permisi|min)[\s!.]*$/i;
  const mixedBurst = burst.some((body) => {
    const line = body.trim();
    if (!line) return false;
    if (PHOTO_RE.test(line) || BROCHURE_RE.test(line) || isMediaRequest(line)) return false;
    if (isViewRoomRequest(line)) return false;
    if (fillerOnly.test(line)) return false;
    return true;
  });
  if (mixedBurst) return null;
  if (COMPLAINT_RE.test(text)) return null;
  if (TOUR_OR_VIDEO_RE.test(text)) return null;
  if (MIXED_LLM_RE.test(text)) return null;

  if (!wantsPhoto && !wantsBrochure && !wantsView) return null;

  if (wantsBrochure && !wantsPhoto) {
    return { kind: "brochure", reply: MEDIA_FAST_PATH_BROCHURE_REPLY, photoFallback: null };
  }

  // Permintaan foto atau "lihat kamar" → brosur PDF.
  return {
    kind: "brochure",
    reply: wantsBrochure ? MEDIA_FAST_PATH_BROCHURE_REPLY : MEDIA_FAST_PATH_PHOTO_BROCHURE_REPLY,
    photoFallback: wantsPhoto ? planRoomPhotos(text, rooms) : null,
  };
}

/** Rencana foto per kamar (cadangan saat brosur tidak ada). */
export function planRoomPhotos(text: string, rooms: GalleryRoom[]): RoomPhotosPlan | null {
  const matched = matchGalleryRoom(text, rooms);
  if (ROOM_HINT_RE.test(text) && !matched) return null;
  if (matched && !roomHasGallery(matched)) return null;
  if (!matched && !rooms.some(roomHasGallery)) return null;

  return {
    kind: "room_photos",
    roomType: matched?.name ?? null,
    maxPhotos: matched ? 3 : 1,
    maxRooms: matched ? 1 : 4,
    alsoBrochure: false,
    reply: MEDIA_FAST_PATH_PHOTO_REPLY,
  };
}

/** Kalimat penutup baku balasan media — lihat konstanta di atas. */
export const MEDIA_SLOT_QUESTION = "Rencana menginap tanggal berapa dan untuk berapa orang?";

/**
 * Invarian #5 ("satu slot ditanya sekali"). Insiden 28 Sep 2026: tamu sudah
 * menyebut "29-30" dan "dewasa 5 anak 2", lalu minta foto — balasan media
 * tetap bertanya "tanggal berapa dan untuk berapa orang?". Ganti pertanyaan
 * baku dengan pertanyaan untuk slot yang BELUM diketahui saja.
 */
export function adaptMediaSlotQuestion(
  reply: string,
  known: { hasDates: boolean; hasGuests: boolean },
): string {
  if (!reply || !reply.includes(MEDIA_SLOT_QUESTION)) return reply;
  let question: string;
  if (known.hasDates && known.hasGuests) {
    question = "Kalau sudah cocok, mau saya lanjutkan cek kamarnya untuk tanggal yang Kakak sebut?";
  } else if (known.hasDates) {
    question = "Untuk berapa orang ya Kak?";
  } else if (known.hasGuests) {
    question = "Rencana menginap tanggal berapa ya Kak?";
  } else {
    return reply;
  }
  return reply.replace(MEDIA_SLOT_QUESTION, question);
}
