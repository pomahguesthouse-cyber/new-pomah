const EXTRA_BED_TERM = "(?:extra\\s*bed|extrabed|kasur\\s+tambahan|bed\\s+tambahan)";
const REMOVE_EXTRA_BED_RE = new RegExp(
  "\\b(?:tanpa|hapus|hilangkan|batalkan|tidak\\s+(?:jadi|perlu|pakai)|nggak\\s+(?:jadi|perlu|pakai)|ga\\s+(?:jadi|perlu|pakai))\\s+" +
    EXTRA_BED_TERM +
    "\\b",
  "i",
);
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

/**
 * Extract an explicitly requested extra-bed quantity.
 *
 * Returns undefined for informational questions so "harga extra bed berapa?"
 * never mutates booking data. An affirmative request without a count defaults
 * to one unit.
 */
export function extractRequestedExtraBeds(message: string): number | undefined {
  const text = message.trim();
  if (!new RegExp(EXTRA_BED_TERM, "i").test(text)) return undefined;
  if (REMOVE_EXTRA_BED_RE.test(text)) return 0;

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
