/**
 * Satu pola permintaan foto/brosur kamar.
 *
 * Bentuk berimbuhan ("difotokan", "fotoin", "poto", "pap") harus dikenali
 * di fast-path, router, dan detektor media — bukan tiga regex yang saling
 * tertinggal. Pertanyaan tentang ISI brosur dan izin memotret area properti
 * bukan permintaan kirim media.
 */

/**
 * Rapikan vokal yang diulang di akhir kata sebelum regex:
 * fotonyaa → fotonya, fotoo → foto, kamarnyaa → kamarnya, kaa → ka.
 * Huruf dobel di tengah ("hello", "book") dan kata Inggris "see" tidak diubah.
 */
export function normalizeGuestMediaText(text: string): string {
  return (text ?? "")
    .replace(/([aiuoAIUO])\1+(?=\b)/g, "$1")
    .replace(/\b([A-Za-z]*?)([b-df-hj-np-tv-zB-DF-HJ-NP-TV-Z])\2+\b/g, (word, _stem, _c) =>
      DOUBLE_CONSONANT_KEEP.has(word.toLowerCase()) ? word : word.replace(/(.)\1+$/, "$1"),
    );
}

/**
 * Konsonan dobel di akhir kata diketik berlebih oleh tamu ("liatt", "kakk").
 * Kata Inggris/umum yang memang berakhiran huruf dobel tidak diubah.
 */
const DOUBLE_CONSONANT_KEEP = new Set([
  "all", "mall", "full", "will", "still", "well", "call", "small", "tall", "hall", "ball", "wall",
  "fall", "bill", "fill", "kill", "skill", "pill", "hill", "till", "sell", "tell", "bell", "cell",
  "shell", "spell", "smell", "dull", "pull", "null", "add", "odd", "egg", "off", "staff", "stuff",
  "cliff", "buzz", "jazz", "fizz", "pass", "class", "glass", "grass", "mass", "boss", "loss", "less",
  "kiss", "miss", "press", "dress", "guess", "access", "express", "success", "business", "process",
  "inn", "err", "putt", "watt", "mitt", "butt", "app", "nett", "bass", "cross",
]);

/** Kata foto/gambar, termasuk imbuhan di-/ -in/-kan, slang poto/pap, dan pict/pic. */
export const GUEST_PHOTO_WORD_RE =
  /\b(?:di)?(?:foto|poto|photo)(?:in|kan|kin|2|nya|s)?\b|\bfoto[- ]foto\b|\bpoto[- ]poto\b|\bfoto2\b|\bpap\b|\b(?:gambar|pict?ures?|picts?|pics?|images?|penampakan|nampakan)(?:nya|2)?\b/i;

export const GUEST_BROCHURE_WORD_RE =
  /\b(?:(?:brosur|brochure|katalog|catalog|catalogue)(?:nya)?|pricelist|price list|daftar harga bergambar)\b/i;

/** Foto, brosur, atau video/tour — untuk router dan `isMediaRequest`. */
export const GUEST_MEDIA_WORD_RE =
  /\b(?:di)?(?:foto|poto|photo)(?:in|kan|kin|2|nya|s)?\b|\bfoto[- ]foto\b|\bpoto[- ]poto\b|\bfoto2\b|\bpap\b|\b(?:gambar|pict?ures?|picts?|pics?|images?|penampakan|nampakan)(?:nya|2)?\b|\b(?:brosur|brochure|katalog|catalog|catalogue|pricelist)(?:nya)?\b|\b(?:video|videonya|reels?)\b|\b(?:virtual\s+tour|tour\s+360|tur\s+360|walkthrough)\b/i;

/** "kaya/kayak apa", "kayak gimana", "seperti apa" — hanya bila kamar/tipe/harga disebut. */
const ROOM_LOOK_RE =
  /\b(?:kaya|kayak)\s+apa\b|\bkayak\s+gimana\b|\bkaya\s+gimana\b|\bseperti\s+apa\b/i;
const ROOM_OR_PRICE_RE =
  /\b(?:kamar(?:nya)?|rooms?|deluxe|family|suite|single|twin|superior|standard|standar|grand|vip|executive|harga|tarif|price|rate)\b|\b\d{2,3}\s*k\b/i;

export function isRoomLookAsk(text: string): boolean {
  const n = normalizeGuestMediaText(text ?? "");
  if (!ROOM_LOOK_RE.test(n)) return false;
  return ROOM_OR_PRICE_RE.test(n);
}

const SINGLE_AMENITY_YESNO_RE =
  /^(?:(?:halo|hai|hi|kak|min|permisi|pagi|siang|sore|malam)[,\s]*)?(?:(?:apakah|apa|ada|punya|tersedia|include|termasuk)\s+)?(?:parkir(?:an)?(?:nya)?|parking|dapur(?:nya)?|kulkas(?:nya)?|sarapan(?:nya)?|breakfast)(?:\s+(?:ada|tersedia|luas|gak|ga|nggak|tidak|ngga|kan|ya|kak|dong))*\s*\??$/i;

/**
 * Pertanyaan ya/tidak satu fasilitas (parkir, dapur, kulkas, sarapan).
 * Tetap jawaban teks — bukan pemicu brosur.
 */
export function isSingleAmenityYesNo(text: string): boolean {
  const n = normalizeGuestMediaText(text ?? "")
    .replace(/\s+/g, " ")
    .trim();
  if (!n || n.length > 80) return false;
  if (/\b(?:apa saja|apa aja|rincian|semua tipe|perbandingan)\b/i.test(n)) return false;
  if (/\b(?:single|deluxe|family|suite|superior|twin|grand)\b/i.test(n)) return false;
  const core = n
    .replace(/^(?:halo|hai|hi|kak|min|permisi)[,\s]+/i, "")
    .replace(/(?:\s+(?:kak|ka|min|ya|dong))+\s*\??$/i, "")
    .trim();
  if (SINGLE_AMENITY_YESNO_RE.test(core) || SINGLE_AMENITY_YESNO_RE.test(n)) return true;
  if (/\bfasilitas(?:nya)?\b/i.test(n)) {
    const amenities = n.match(/\b(?:parkir(?:an)?|parking|dapur|kulkas|sarapan|breakfast)\b/gi) ?? [];
    if (amenities.length === 1 && !/\b(?:dan|sama|atau|dengan)\b/i.test(n)) return true;
  }
  return false;
}

/** Daftar fasilitas umum (bukan ya/tidak satu item) — kirim brosur + teks singkat. */
export function isGeneralFacilityQuestion(text: string): boolean {
  if (isSingleAmenityYesNo(text)) return false;
  const n = normalizeGuestMediaText(text ?? "");
  return (
    /\b(?:fasilitas(?:nya)?|amenities)\b/i.test(n) ||
    /\bada\s+apa\s+(?:saja|aja)\b/i.test(n) ||
    /\brincian\s+fasilitas\b/i.test(n)
  );
}

const BROCHURE_CONTENT_RE =
  /\b(?:kenapa|kok|mengapa|knapa|knp|why)\b[\s\S]{0,80}\b(?:brosur|brochure|katalog)\b|\b(?:gak|ga|tidak|nggak|ngga|gada)\s+ada\b[\s\S]{0,60}\b(?:brosur|brochure|katalog)\b|\b(?:brosur|brochure|katalog)\b[\s\S]{0,50}\b(?:gak|ga|tidak|nggak|ngga)\s+ada\b/i;

/**
 * Tamu minta izin memotret sendiri di area properti, bukan minta foto kamar.
 * "boleh foto-foto di area taman?" ≠ "boleh difotokan kamarnya?".
 */
const OWN_PHOTO_PERMISSION_RE =
  /\b(?:boleh|bisa|izin|diizinkan|dibolehkan)\b[\s\S]{0,50}\b(?:foto(?:\s*[-]?\s*foto|2)?|poto(?:\s*[-]?\s*poto|2)?|photos?)\b[\s\S]{0,40}\b(?:di|ke|pada|dalam)\b[\s\S]{0,24}\b(?:area\s+)?(?:taman|halaman|kolam|lobby|lobi|sekitar|lokasi|depan|parkir|kebun|outdoor)\b/i;

export function isGuestMediaExcluded(text: string): boolean {
  const raw = normalizeGuestMediaText(text ?? "");
  if (!raw.trim()) return false;
  return BROCHURE_CONTENT_RE.test(raw) || OWN_PHOTO_PERMISSION_RE.test(raw);
}

export function mentionsGuestPhotoWord(text: string): boolean {
  const n = normalizeGuestMediaText(text ?? "");
  return GUEST_PHOTO_WORD_RE.test(n) || isRoomLookAsk(n);
}
