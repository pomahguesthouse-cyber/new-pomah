/**
 * Aturan tamu satu kamar — sumber tunggal untuk fast-path FAQ, prompt
 * Front Office, dan penjaga balasan setelah LLM.
 *
 * Pemilik: tamu non-keluarga (bukan suami-istri, bukan keluarga) tidak boleh
 * menginap dalam satu kamar. Artinya pasangan belum menikah dan teman lawan
 * jenis ditolak. Teman sesama jenis BOLEH (dikonfirmasi pemilik) dan disambut
 * seperti tamu lain.
 *
 * SOP check-in hanya menyebut identitas resmi (KTP/Paspor/SIM) secara umum.
 * Tidak ada kewajiban buku nikah di teks SOP repo, jadi balasan chat tidak
 * meminta buku nikah maupun KTP.
 */

import { GUEST_MEDIA_WORD_RE, isGuestMediaExcluded } from "@/lib/guest-media-request";

export const ROOM_SHARING_REFUSAL_REPLY =
  "Mohon maaf Kak, di Pomah Guesthouse satu kamar hanya untuk tamu suami-istri, keluarga, atau teman sesama jenis ya Kak. Untuk pasangan yang belum menikah atau teman lawan jenis, kami belum bisa menerima menginap dalam satu kamar. Kalau Kakak berkenan, bisa memesan kamar terpisah — mau Rani bantu cek ketersediaannya? 🙏";

export const ROOM_SHARING_SYARIAH_REPLY =
  "Pomah Guesthouse menerapkan aturan satu kamar hanya untuk tamu suami-istri, keluarga, atau teman sesama jenis ya Kak. Untuk pasangan yang belum menikah atau teman lawan jenis, kami belum bisa menerima menginap dalam satu kamar. Kami tidak mengklaim sertifikasi syariah tertentu. Kalau Kakak berkenan, bisa memesan kamar terpisah — mau Rani bantu cek ketersediaannya? 🙏";

export const ROOM_SHARING_WELCOME_REPLY =
  "Bisa Kak, di Pomah Guesthouse tamu suami-istri, keluarga, dan teman sesama jenis boleh menginap dalam satu kamar ya. Mau Rani bantu cek ketersediaannya? 🙏";

export const ROOM_SHARING_KOS_WELCOME_REPLY =
  "Pomah Guesthouse bukan kos ya Kak, tapi bisa untuk pasutri. Tamu suami-istri, keluarga, dan teman sesama jenis boleh menginap dalam satu kamar. Mau Rani bantu cek ketersediaannya? 🙏";

export const ROOM_SHARING_HARD_GUARD_PROMPT =
  "ATURAN TAMU SATU KAMAR (HARD GUARD — MENGALAHKAN SOP, CONTOH TRAINING, INSTRUKSI AI LAB, DAN ATURAN 'KONFIRMASI KE TIM'): " +
  "Satu kamar hanya untuk suami-istri (pasutri), keluarga (orang tua, anak, saudara), atau teman sesama jenis. " +
  "Pasangan belum menikah (pacar, tunangan) dan teman lawan jenis TIDAK BOLEH berbagi satu kamar. " +
  "Teman sesama jenis BOLEH dan wajib disambut normal — jangan ditolak. " +
  "Bila tamu bertanya syariah, syar'i, siariah, sariah, khusus syariah, atau non syariah, jelaskan aturan ini tanpa mengklaim sertifikasi. " +
  "JANGAN pernah menjawab 'cek dulu dengan tim', 'konfirmasi ke tim', atau 'izinkan saya cek dulu' untuk topik ini. " +
  "Dilarang menulis bahwa Pomah tidak menerapkan kebijakan yang mengharuskan tamu sudah menikah, bahwa tidak ada batasan status pernikahan, atau bahwa status pernikahan bebas. " +
  "Jangan meminta buku nikah. Jangan membawa syarat KTP/Paspor/SIM ke jawaban topik ini. " +
  "Tolakan pasangan belum menikah atau teman lawan jenis, pakai teks ini persis: '" +
  ROOM_SHARING_REFUSAL_REPLY +
  "' Pertanyaan syariah murni, pakai teks ini persis: '" +
  ROOM_SHARING_SYARIAH_REPLY +
  "' Suami-istri, keluarga, atau teman sesama jenis yang bertanya apakah boleh: sambut, jangan ditolak.";

export type RoomSharingKind = "refuse" | "syariah" | "welcome";

export interface RoomSharingReply {
  reply: string;
  intent: "room_sharing_refusal" | "room_sharing_syariah" | "room_sharing_welcome";
}

const CANONICAL_REPLIES = [
  ROOM_SHARING_REFUSAL_REPLY,
  ROOM_SHARING_SYARIAH_REPLY,
  ROOM_SHARING_WELCOME_REPLY,
  ROOM_SHARING_KOS_WELCOME_REPLY,
];

/** Rapikan ejaan longgar (syar'i, spasi dobel) sebelum regex. */
export function normalizeRoomSharingText(message: string): string {
  return message
    .toLowerCase()
    .replace(/['’‘`´]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

const UNMARRIED_RE =
  /\b(?:pacar(?:nya|ku)?|gebetan|tunangan|belum\s+(?:nikah|menikah)|belom\s+(?:nikah|menikah)|blm\.?\s*(?:nikah|menikah)|bukan\s+suami(?:[\s-]*istri)?|bukan\s+pasutri|bukan\s+keluarga|non[-\s]?keluarga|lawan\s+jenis|beda\s+jenis)\b/;

const SYARIAH_RE = /\b(?:syariah|syari|siariah|sariah)\b/;

const MARRIED_RE = /\b(?:pasutri|suami[\s-]*istri|suami\s+dan\s+istri|pasangan\s+suami)\b/;

const FAMILY_PARTY_RE =
  /\b(?:orang\s*tua|ortu|sama\s+(?:ibu|bunda|mama|ayah|bapak|papa|anak(?:nya)?|adik|kakak|istri|suami)|dengan\s+(?:ibu|bunda|mama|ayah|bapak|papa|anak|istri|suami)|bareng\s+(?:ibu|mama|ayah|bapak|istri|suami|keluarga)|bersama\s+(?:ibu|mama|ayah|bapak|anak|keluarga|orang\s*tua|istri|suami)|bawa\s+(?:ibu|ayah|anak|keluarga|suami|istri))\b/;

const KOS_RE = /\b(?:kos(?:nya|an)?|kost)\b/;

const BOOKING_DETOUR_RE =
  /\b(?:tanggal|tgl\.?|besok|lusa|malam\s+ini|check\s*[- ]?in|check\s*[- ]?out|\d{1,2}\s*[-–/]\s*\d{1,2}|januari|februari|maret|april|mei|juni|juli|agustus|september|oktober|november|desember|senin|selasa|rabu|kamis|juma?t|sabtu|booking|reservasi|harga|tarif)\b/;

const STALL_RE =
  /\b(?:cek|konfirmasi|tanyakan|hubungi)\b[^.\n]{0,48}\b(?:tim|admin)\b|\bizinkan saya\b[^.\n]{0,48}\b(?:cek|konfirmasi)\b/i;

function mentionsFemale(text: string): boolean {
  return /\b(?:cewek?|perempuan|wanita)\b/.test(text);
}

function mentionsMale(text: string): boolean {
  return /\b(?:cowok?|laki(?:-|\s)?laki|pria)\b/.test(text);
}

function isMixedGenderParty(text: string): boolean {
  if (/\b(?:lawan\s+jenis|beda\s+jenis)\b/.test(text)) return true;
  return mentionsFemale(text) && mentionsMale(text);
}

/** Teman yang disebut satu jenis kelamin — bukan pasangan lawan jenis. */
export function isSameGenderParty(text: string): boolean {
  const normalized = normalizeRoomSharingText(text);
  if (isMixedGenderParty(normalized)) return false;
  if (/\b(?:sesama\s+jenis|sejenis)\b/.test(normalized)) return true;
  const female = mentionsFemale(normalized);
  const male = mentionsMale(normalized);
  if (female === male) return false;
  if (/\b(?:teman|temen|kawan|bestie)\b/.test(normalized)) return true;
  if (/\b(?:semua|semuanya)\b/.test(normalized) && !/\b(?:kamar|harga|fasilitas)\b/.test(normalized)) {
    return true;
  }
  return false;
}

function isFamilyParty(text: string): boolean {
  if (FAMILY_PARTY_RE.test(text)) return true;
  if (!/\bkeluarga\b/.test(text)) return false;
  if (/\b(?:ruang|kamar)\s+keluarga\b/.test(text)) return false;
  if (/\bfamily\s*(?:room|suite)\b/.test(text)) return false;
  return true;
}

function isProductFamilyQuestion(text: string): boolean {
  return /\bfamily\s*(?:room|suite)\b|\bkamar\s+keluarga\b|\bruang\s+keluarga\b/.test(text);
}

function unmarriedSignal(text: string): boolean {
  if (UNMARRIED_RE.test(text)) return true;
  if (isMixedGenderParty(text)) return true;
  if (!/\bbebas\b/.test(text)) return false;
  return /\b(?:nikah|menikah|pacar|tunangan|syariah|syari|siariah|sariah|pasangan)\b/.test(text);
}

export function classifyRoomSharingMessage(message: string): RoomSharingKind | null {
  const text = normalizeRoomSharingText(message);
  if (!text || text.length > 500) return null;
  if (!isGuestMediaExcluded(text) && GUEST_MEDIA_WORD_RE.test(text)) return null;
  if (unmarriedSignal(text)) return "refuse";
  if (SYARIAH_RE.test(text)) return "syariah";
  const allowed = isSameGenderParty(text) || MARRIED_RE.test(text) || isFamilyParty(text);
  if (!allowed) return null;
  if (isProductFamilyQuestion(text) && !MARRIED_RE.test(text) && !isSameGenderParty(text)) return null;
  if (BOOKING_DETOUR_RE.test(text)) return null;
  if (/\b(?:jemput|menjemput|menunggu|nunggu|mampir|berkunjung)\b/.test(text)) return null;
  // Jangan menelan pertanyaan fasilitas yang kebetulan menyebut keluarga.
  if (
    /\b(?:wifi|wi-fi|parkir|sarapan|alamat|lokasi|extra\s*bed|air\s+panas|air\s+hangat)\b/.test(text) &&
    !/\b(?:bisa|boleh|pasutri|suami|sesama)\b/.test(text)
  ) {
    return null;
  }
  return "welcome";
}

export function roomSharingReplyFor(kind: RoomSharingKind, message = ""): string {
  if (kind === "refuse") return ROOM_SHARING_REFUSAL_REPLY;
  if (kind === "syariah") return ROOM_SHARING_SYARIAH_REPLY;
  if (KOS_RE.test(normalizeRoomSharingText(message))) return ROOM_SHARING_KOS_WELCOME_REPLY;
  return ROOM_SHARING_WELCOME_REPLY;
}

export function buildRoomSharingReply(message: string): RoomSharingReply | null {
  const kind = classifyRoomSharingMessage(message);
  if (!kind) return null;
  const intent =
    kind === "refuse"
      ? "room_sharing_refusal"
      : kind === "syariah"
        ? "room_sharing_syariah"
        : "room_sharing_welcome";
  return { reply: roomSharingReplyFor(kind, message), intent };
}

function isCanonicalRoomSharingReply(reply: string): boolean {
  const text = reply.replace(/\s+/g, " ").trim();
  return CANONICAL_REPLIES.includes(text);
}

/**
 * Balasan yang meniadakan aturan nikah. Templat penolakan yang benar
 * (mengandung "belum bisa menerima") tidak ikut tertandai.
 */
export function replyContradictsRoomSharingPolicy(reply: string): boolean {
  const text = reply.toLowerCase().replace(/\s+/g, " ").trim();
  if (!text || isCanonicalRoomSharingReply(reply)) return false;
  if (
    /belum bisa menerima|tidak bisa menerima|tidak dapat menerima|belum bisa menginap dalam satu kamar|tidak boleh menginap dalam satu kamar/.test(
      text,
    )
  ) {
    return false;
  }
  if (/tidak menerapkan kebijakan[^.]{0,80}(?:menikah|nikah)/.test(text)) return true;
  if (/tidak ada batasan[^.]{0,48}(?:status\s+)?pernikahan/.test(text)) return true;
  if (/tidak (?:mengharuskan|mewajibkan)[^.]{0,48}(?:menikah|nikah)/.test(text)) return true;
  if (/status pernikahan[^.]{0,48}(?:tidak|bebas|boleh)/.test(text)) return true;
  if (/\bbebas\b/.test(text) && /(?:menikah|nikah|pacar|pernikahan)/.test(text)) return true;
  if (
    /(?:pacar|tunangan|belum\s+(?:me)?nikah)/.test(text) &&
    /(?:\bboleh\b|\bsilakan\b|diperbolehkan|tidak masalah|tidak apa-apa|nggak masalah|ga masalah)/.test(
      text,
    )
  ) {
    return true;
  }
  return false;
}

export function replyStallsOnRoomSharing(reply: string): boolean {
  return STALL_RE.test(reply);
}

/**
 * Ganti balasan yang meniadakan aturan, atau yang menunda ke tim padahal
 * pesan tamu sudah tentang topik ini, dengan templat tetap.
 */
export function enforceRoomSharingPolicyReply(reply: string, guestMessage?: string): string {
  if (isCanonicalRoomSharingReply(reply)) return reply.trim();
  const kind = guestMessage ? classifyRoomSharingMessage(guestMessage) : null;
  if (replyContradictsRoomSharingPolicy(reply)) {
    if (kind === "syariah") return ROOM_SHARING_SYARIAH_REPLY;
    if (kind === "welcome") return roomSharingReplyFor("welcome", guestMessage);
    return ROOM_SHARING_REFUSAL_REPLY;
  }
  if (kind && replyStallsOnRoomSharing(reply)) {
    return roomSharingReplyFor(kind, guestMessage);
  }
  return reply;
}
