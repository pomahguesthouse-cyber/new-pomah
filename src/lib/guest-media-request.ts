/**
 * Satu pola permintaan foto/brosur kamar.
 *
 * Bentuk berimbuhan ("difotokan", "fotoin", "poto", "pap") harus dikenali
 * di fast-path, router, dan detektor media — bukan tiga regex yang saling
 * tertinggal. Pertanyaan tentang ISI brosur dan izin memotret area properti
 * bukan permintaan kirim media.
 */

/** Kata foto/gambar, termasuk imbuhan di-/ -in/-kan dan slang poto/pap. */
export const GUEST_PHOTO_WORD_RE =
  /\b(?:di)?(?:foto|poto|photo)(?:in|kan|kin|2|nya|s)?\b|\bfoto[- ]foto\b|\bpoto[- ]poto\b|\bfoto2\b|\bpap\b|\b(?:gambar|pict?ures?|pics?|images?|penampakan|nampakan)(?:nya|2)?\b/i;

export const GUEST_BROCHURE_WORD_RE =
  /\b(?:(?:brosur|brochure|katalog|catalog|catalogue)(?:nya)?|pricelist|price list|daftar harga bergambar)\b/i;

/** Foto, brosur, atau video/tour — untuk router dan `isMediaRequest`. */
export const GUEST_MEDIA_WORD_RE =
  /\b(?:di)?(?:foto|poto|photo)(?:in|kan|kin|2|nya|s)?\b|\bfoto[- ]foto\b|\bpoto[- ]poto\b|\bfoto2\b|\bpap\b|\b(?:gambar|pict?ures?|pics?|images?|penampakan|nampakan)(?:nya|2)?\b|\b(?:brosur|brochure|katalog|catalog|catalogue|pricelist)(?:nya)?\b|\b(?:video|videonya|reels?)\b|\b(?:virtual\s+tour|tour\s+360|tur\s+360|walkthrough)\b/i;

const BROCHURE_CONTENT_RE =
  /\b(?:kenapa|kok|mengapa|knapa|knp|why)\b[\s\S]{0,80}\b(?:brosur|brochure|katalog)\b|\b(?:gak|ga|tidak|nggak|ngga|gada)\s+ada\b[\s\S]{0,60}\b(?:brosur|brochure|katalog)\b|\b(?:brosur|brochure|katalog)\b[\s\S]{0,50}\b(?:gak|ga|tidak|nggak|ngga)\s+ada\b/i;

/**
 * Tamu minta izin memotret sendiri di area properti, bukan minta foto kamar.
 * "boleh foto-foto di area taman?" ≠ "boleh difotokan kamarnya?".
 */
const OWN_PHOTO_PERMISSION_RE =
  /\b(?:boleh|bisa|izin|diizinkan|dibolehkan)\b[\s\S]{0,50}\b(?:foto(?:\s*[-]?\s*foto|2)?|poto(?:\s*[-]?\s*poto|2)?|photos?)\b[\s\S]{0,40}\b(?:di|ke|pada|dalam)\b[\s\S]{0,24}\b(?:area\s+)?(?:taman|halaman|kolam|lobby|lobi|sekitar|lokasi|depan|parkir|kebun|outdoor)\b/i;

export function isGuestMediaExcluded(text: string): boolean {
  const raw = text ?? "";
  if (!raw.trim()) return false;
  return BROCHURE_CONTENT_RE.test(raw) || OWN_PHOTO_PERMISSION_RE.test(raw);
}

export function mentionsGuestPhotoWord(text: string): boolean {
  return GUEST_PHOTO_WORD_RE.test(text ?? "");
}
