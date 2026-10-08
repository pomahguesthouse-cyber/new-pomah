const EXTRA_BED_TERM =
  "(?:extra\\s*bed(?:\\s*nya)?|extrabed(?:nya)?|kasur\\s+tambahan|bed\\s+tambahan|\\beb\\b)";

/**
 * Penolakan bisa di depan atau di belakang istilah extra bed.
 * "ga usah pakai extra bed" harus kalah dari pola permintaan "pakai extra bed".
 */
const DECLINE =
  "(?:tanpa|hapus(?:kan)?|hilangkan|batalkan|" +
  "gausah|nggausah|ngausah|gakusah|" +
  "(?:tidak|tak|nggak|ngga|enggak|engga|ndak|gak|ga|gk)\\s+(?:usah|jadi|perlu|pakai|pake))";

const DECLINE_BEFORE_RE = new RegExp(
  "\\b(?:" + DECLINE + ")\\b(?:\\s+\\w+){0,4}?\\s+" + EXTRA_BED_TERM + "\\b",
  "i",
);
const DECLINE_AFTER_RE = new RegExp(
  "\\b" + EXTRA_BED_TERM + "\\b(?:\\s+\\w+){0,4}?\\s+\\b(?:" + DECLINE + ")\\b",
  "i",
);
const EXTRA_BED_MENTION_RE = new RegExp("\\b" + EXTRA_BED_TERM + "\\b", "i");
const EXTRA_BED_QUESTION_RE =
  /\?|\b(?:berapa|harga|tarif|biaya|apakah|ada|tersedia|bisa)\b/i;

const WORD_NUMBERS: Record<string, number> = {
  satu: 1,
  sebuah: 1,
  dua: 2,
  tiga: 3,
  empat: 4,
  lima: 5,
  enam: 6,
  tujuh: 7,
  delapan: 8,
  sembilan: 9,
  sepuluh: 10,
};

function parseCount(raw: string): number | undefined {
  const normalized = raw.toLowerCase();
  const value = /^\d+$/.test(normalized) ? Number(normalized) : WORD_NUMBERS[normalized];
  return value !== undefined && value >= 0 && value <= 10 ? value : undefined;
}

export function messageMentionsExtraBed(message: string): boolean {
  return EXTRA_BED_MENTION_RE.test(message);
}

/** Kalimat tawaran extra bed yang opsional, untuk tool availability dan balasan tamu. */
export function formatOptionalExtraBedOffer(count: number, ratePerNight: number): string {
  const n = Math.max(0, Math.floor(count));
  const label = n > 1 ? `${n} extra bed` : "extra bed";
  if (ratePerNight > 0) {
    const rp = `Rp${Math.round(ratePerNight).toLocaleString("id-ID")}`;
    return `bisa tambah ${label} ${rp}/malam, opsional`;
  }
  return `bisa tambah ${label}, opsional`;
}

/**
 * Extract an explicitly requested extra-bed quantity.
 *
 * Returns 0 when the guest declines (hapus / gausah / tanpa / tidak usah, di
 * depan atau di belakang "extra bed"). Returns undefined for informational
 * questions so "harga extra bed berapa?" never mutates booking data. An
 * affirmative request without a count defaults to one unit.
 *
 * Decline is checked before request patterns so "ga usah pakai extra bed"
 * is 0, not 1.
 */
export function extractRequestedExtraBeds(message: string): number | undefined {
  const text = message.trim().replace(/\s+/g, " ");
  if (!EXTRA_BED_MENTION_RE.test(text)) return undefined;
  if (DECLINE_BEFORE_RE.test(text) || DECLINE_AFTER_RE.test(text)) return 0;

  const countToken = "(\\d{1,2}|satu|sebuah|dua|tiga|empat|lima|enam|tujuh|delapan|sembilan|sepuluh)";
  const before = text.match(new RegExp(countToken + "\\s*(?:x|unit)?\\s*" + EXTRA_BED_TERM, "i"));
  if (before) return parseCount(before[1]);

  const after = text.match(new RegExp(EXTRA_BED_TERM + "\\s*(?::|x)?\\s*" + countToken, "i"));
  if (after) return parseCount(after[1]);

  if (EXTRA_BED_QUESTION_RE.test(text)) return undefined;

  if (
    new RegExp(
      "\\b(?:tambah|tambahkan|pakai|gunakan|minta|pesan|booking|dengan|plus|butuh|perlu)\\b.{0,30}" +
        EXTRA_BED_TERM +
        "|" +
        EXTRA_BED_TERM +
        ".{0,20}\\b(?:ya|dong|juga|sekalian)\\b",
      "i",
    ).test(text)
  ) {
    return 1;
  }

  return undefined;
}
