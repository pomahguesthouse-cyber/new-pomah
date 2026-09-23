/**
 * Gerbang murah (tanpa LLM / embedding) untuk pesan sosial yang tidak
 * membutuhkan retrieval berat atau fallback klasifikasi.
 *
 * Dipakai bersama oleh:
 *   - autoreply        → jangan embed SOP / training untuk sapaan & media kosong
 *   - orchestrator     → jangan embed training kedua kalinya
 *   - intent classifier → jangan panggil LLM untuk pesan yang sudah jelas
 */

const GREETING_WORD =
  "(?:halo+|hai+|hi+|hey+|hello+|hei+|selamat\\s+(?:pagi|siang|sore|malam)|pagi|siang|sore|malam|ass?alamu?alaikum|salam|permisi)";

const FILLER_WORD =
  "(?:kak|kakak|ka|min|admin|pak|bu|mas|mbak|gan|bro|sis|ya+|yah|yuk|dong|deh|nih|loh|lho|banget|banyak)";

const THANKS_WORD =
  "(?:makasih+|makasi+|terima\\s*kasih|terimakasih|t(?:e)?rima?\\s*kasih|trims?|trimakasih|thanks|thank\\s*you|thx|tq|ty|nuhun|suwun|matur\\s*nuwun)";

const LEAD_INTERJECTION_RE =
  /^(?:(?:y+a+h*|wah|waduh|aduh|hmm+|oh+|nah|deh|dong|ya\s?udah?|yaudah|baik(?:lah)?|ok|oke?y?|okay|kak|kakak|ka|min|admin|pak|bu)[\s,!.…~-]+)+/i;

/** Kata yang membuat pesan bukan sapaan/terima-kasih murni. */
const SUBSTANTIVE_RE =
  /\b(kamar|room|harga|tarif|rate|booking|pesan|reservasi|bayar|transfer|refund|dp|invoice|komplain|rusak|wifi|lokasi|alamat|check-?in|check-?out|menginap|nginap|kosong|tersedia)\b/i;

function normalize(text: string): string {
  return (text ?? "").replace(/\s+/g, " ").trim();
}

function coreMessage(text: string): string {
  return normalize(text).replace(LEAD_INTERJECTION_RE, "").trim();
}

function stripPieces(text: string, piece: RegExp): string {
  let rest = text.trim();
  for (let i = 0; i < 10 && rest; i++) {
    const next = rest.replace(piece, "").trim();
    if (next === rest) break;
    rest = next;
  }
  return rest;
}

const GREETING_PIECE_RE = new RegExp(
  `^(?:${GREETING_WORD}|${FILLER_WORD}|\\p{Extended_Pictographic})[\\s,!.…~]*`,
  "iu",
);
const THANKS_PIECE_RE = new RegExp(
  `^(?:${THANKS_WORD}|${FILLER_WORD}|oke?y?|ok|sip|siap|\\p{Extended_Pictographic})[\\s,!.…~]*`,
  "iu",
);

/**
 * Sapaan jelas tanpa permintaan lain ("halo", "halo kak", "selamat pagi").
 * "halo, ada kamar?" bukan sapaan murni — harus tetap masuk jalur ketersediaan.
 */
export function isClearGreeting(text: string): boolean {
  const raw = normalize(text);
  if (!raw || raw.length > 80 || SUBSTANTIVE_RE.test(raw) || /\d/.test(raw)) return false;
  const core = coreMessage(raw);
  const greetRe = new RegExp(`^${GREETING_WORD}\\b`, "i");
  if (!greetRe.test(core) && !greetRe.test(raw)) return false;
  return stripPieces(core || raw, GREETING_PIECE_RE).length === 0;
}

/**
 * Ucapan terima kasih / penutup tanpa permintaan baru.
 * "makasih, mau booking" bukan thanks murni.
 */
export function isClearThanks(text: string): boolean {
  const raw = normalize(text);
  if (!raw || raw.length > 80 || SUBSTANTIVE_RE.test(raw)) return false;
  const core = coreMessage(raw);
  const thanksRe = new RegExp(`^${THANKS_WORD}\\b`, "i");
  if (!thanksRe.test(core) && !thanksRe.test(raw)) return false;
  return stripPieces(core || raw, THANKS_PIECE_RE).length === 0;
}

/** Pesan yang isinya hanya emoji / simbol, tanpa kata. */
export function isEmojiOnly(text: string): boolean {
  const raw = normalize(text);
  if (!raw || raw.length > 48) return false;
  const stripped = raw
    .replace(/\p{Extended_Pictographic}/gu, "")
    .replace(/\u200d/g, "")
    .replace(/\uFE0F/g, "")
    .replace(/\u20E3/g, "")
    .replace(/[\s.!?~…,]+/gu, "");
  return stripped.length === 0;
}

/**
 * Lampiran tanpa caption bermakna.
 *
 * Placeholder bukti transfer (`[Tamu mengirim lampiran bukti transfer pembayaran]`)
 * BUKAN media kosong — kata pembayaran di dalamnya wajib tetap mengarah ke finance.
 */
export function isMediaOnlyWithoutText(text: string): boolean {
  const raw = normalize(text);
  if (!raw) return false;
  const brackets = [...raw.matchAll(/\[([^\[\]]+)\]/g)].map((m) => m[1] ?? "");
  if (brackets.length === 0) return false;
  const looksLikeAttachment = brackets.some((b) => /lampiran|attachment|mengirim/i.test(b));
  if (!looksLikeAttachment) return false;
  if (brackets.some((b) => /bukti|bayar|pembayaran|transfer|invoice|\bdp\b/i.test(b))) return false;
  const rest = raw
    .replace(/\[[^\[\]]+\]/g, " ")
    .replace(/[\s\p{P}\p{Extended_Pictographic}\uFE0F\u200d]+/gu, "");
  return rest.length === 0;
}

/** Sapaan, terima kasih, emoji, atau media tanpa teks — tidak perlu embedding. */
export function isTrivialSocialMessage(text: string): boolean {
  return (
    isClearGreeting(text) ||
    isClearThanks(text) ||
    isEmojiOnly(text) ||
    isMediaOnlyWithoutText(text)
  );
}

/** Jangan panggil embedding SOP untuk pesan sosial / media kosong. */
export function shouldSkipSopRetrieval(text: string): boolean {
  return isTrivialSocialMessage(text);
}

/**
 * Pesan sangat pendek: fallback LLM intent hampir selalu lebih mahal daripada
 * manfaatnya. Aturan deterministik (atau general) sudah cukup.
 */
export function isVeryShortMessage(text: string): boolean {
  const t = normalize(text);
  if (!t) return true;
  if (t.length <= 12) return true;
  const words = t.split(" ").filter(Boolean);
  return words.length <= 2 && t.length <= 20;
}

/**
 * Pertanyaan panjang yang tidak kena aturan sama sekali. Hanya kasus ini yang
 * boleh menjatuhkan `general` ke LLM — bukan setiap pesan general.
 */
export function isLongAmbiguousGeneral(text: string): boolean {
  const t = normalize(text);
  if (t.length < 70) return false;
  if (t.split(" ").filter(Boolean).length < 10) return false;
  return /[?]/.test(t) || /\b(bagaimana|gimana|kenapa|mengapa|apakah)\b/i.test(t);
}

/**
 * Orchestrator tidak boleh memanggil `retrieveTrainingExamples` bila retrieval
 * training untuk pesan ini sudah dicoba (termasuk hasil kosong / gagal), contoh
 * sudah disuntik, atau pesannya sosial sehingga embedding tidak berguna.
 */
export function shouldSkipOrchestratorTrainingRetrieval(input: {
  trainingRetrievalAttempted?: boolean;
  trainingExampleCount?: number;
  bookingInProgress?: boolean;
  lastUserMessage: string;
}): boolean {
  if (input.trainingRetrievalAttempted) return true;
  if ((input.trainingExampleCount ?? 0) > 0) return true;
  if (input.bookingInProgress) return true;
  if (!normalize(input.lastUserMessage)) return true;
  if (isTrivialSocialMessage(input.lastUserMessage)) return true;
  return false;
}
