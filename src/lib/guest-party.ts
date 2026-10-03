/**
 * Pembacaan jumlah tamu dari pesan bebas, dengan usia anak dipisah dari jumlah.
 *
 * Insiden 3 Okt 2026: bot (CONFIRMING_BOOKING) menanyakan usia anak, tamu
 * menjawab "Usia anak 14 dan 6 th". Parser lama membaca 14 sebagai JUMLAH
 * anak ("3 dewasa, 14 anak") lalu menolak karena kapasitas. Angka 6 hilang.
 *
 * Aturan:
 * - Kalimat yang memuat usia/umur, atau angka anak yang diikuti th/thn/tahun,
 *   adalah USIA, bukan jumlah.
 * - Pesan usia saja tidak mengubah jumlah anak yang sudah diketahui.
 * - Bila jumlah anak belum diketahui, jumlah anak = banyaknya usia yang disebut.
 */

export type GuestCountReading = {
  /** Jumlah dewasa yang benar-benar disebut. Tidak diisi bila tidak ada. */
  adults?: number;
  /** Jumlah anak yang benar-benar disebut sebagai hitungan, bukan usia. */
  children?: number;
  /** Usia anak yang disebut, berurutan. */
  childAges?: number[];
};

const AGE_UNIT = "(?:tahun|thn|th|yo|years?)";
// Angka yang langsung diikuti label jumlah ("3 dewasa", "1 anak", "2 kamar")
// bukan usia, walaupun berada di ekor klausa umur.
const NOT_COUNT_LABEL =
  "(?!\\s*(?:orang\\s+)?(?:dewasa|adults?|anak(?:nya)?|bocil|bocah|balita|kamar|malam|tamu|pax|orang|guests?)\\b)";
const AGE_NUM = `\\b\\d{1,2}\\b${NOT_COUNT_LABEL}(?:\\s*${AGE_UNIT}\\b)?`;
const AGE_SEP = "(?:\\s*,\\s*(?:dan|and|&)?\\s*|\\s+(?:dan|and|&)\\s+)";
const AGE_LIST = `${AGE_NUM}(?:${AGE_SEP}${AGE_NUM})*`;

const CHILD_WORD = "(?:anak(?:nya)?|bocil|bocah|balita|child(?:ren)?|kids?)";

/** usia/umur [anak] 14 dan 6 th */
const AGE_LEAD_RE = new RegExp(
  `\\b(?:usia|umur)(?:nya)?\\s*(?:${CHILD_WORD})?\\s*:?\\s*(${AGE_LIST})`,
  "gi",
);
/** anak umur/usia 7 */
const AGE_AFTER_CHILD_RE = new RegExp(
  `\\b${CHILD_WORD}\\s*(?:yang\\s+)?(?:usia|umur)(?:nya)?\\s*:?\\s*(${AGE_LIST})`,
  "gi",
);
/** anaknya 4 th dan 9 th — satuan wajib pada angka pertama agar "2 anak" tetap jumlah */
const AGE_WITH_UNIT_RE = new RegExp(
  `\\b${CHILD_WORD}\\s*(?:yang\\s+)?(\\d{1,2}\\s*${AGE_UNIT}\\b(?:${AGE_SEP}${AGE_NUM})*)`,
  "gi",
);

const ADULT = "(?:dewasa|adults?|pax|tamu|guests?)";
const CHILD = CHILD_WORD;

function normalizeGuestText(message: string): string {
  return message.toLowerCase().replace(/\s+/g, " ").trim();
}

function agesInList(list: string): number[] | null {
  const ages: number[] = [];
  for (const m of list.matchAll(/\b(\d{1,2})\b/g)) {
    const n = Number(m[1]);
    if (!Number.isInteger(n) || n < 0 || n > 20) return null;
    ages.push(n);
  }
  if (ages.length < 1 || ages.length > 10) return null;
  return ages;
}

type AgeSpan = { start: number; end: number; ages: number[] };

function collectAgeSpans(text: string, re: RegExp, spans: AgeSpan[]): void {
  re.lastIndex = 0;
  for (const m of text.matchAll(re)) {
    const list = m[1];
    if (!list || m.index === undefined) continue;
    const ages = agesInList(list);
    if (!ages) continue;
    const start = m.index + m[0].length - list.length;
    const end = start + list.length;
    if (spans.some((s) => start < s.end && end > s.start)) continue;
    spans.push({ start, end, ages });
  }
}

/**
 * Ambil usia anak dan teks yang angka usianya sudah dihapus, supaya parser
 * jumlah tidak melihat angka itu.
 */
export function extractChildAges(message: string): { ages: number[]; masked: string } {
  const text = normalizeGuestText(message);
  if (!text) return { ages: [], masked: "" };

  const spans: AgeSpan[] = [];
  collectAgeSpans(text, AGE_LEAD_RE, spans);
  collectAgeSpans(text, AGE_AFTER_CHILD_RE, spans);
  collectAgeSpans(text, AGE_WITH_UNIT_RE, spans);
  spans.sort((a, b) => a.start - b.start);

  const ages = spans.flatMap((s) => s.ages);
  let masked = text;
  for (const span of [...spans].sort((a, b) => b.start - a.start)) {
    masked =
      masked.slice(0, span.start) + " ".repeat(span.end - span.start) + masked.slice(span.end);
  }
  return { ages, masked };
}

type CountHit = { adults: number; children: number; adultFound: boolean; childFound: boolean };

function readExplicitCounts(text: string): CountHit | null {
  if (
    !text ||
    !/\b(orang|dewasa|adults?|anak(?:nya)?|bocil|bocah|balita|child(?:ren)?|kids?|pax|tamu|guests?)\b/i.test(
      text,
    )
  ) {
    return null;
  }

  // Satu gaya per pesan: "5 dewasa 2 anak" (angka dulu) atau "dewasa 5 anak 2"
  // (label dulu). Insiden 28 Sep 2026: regex gabungan mengambil pasangan
  // pertama, sehingga "Dewasa 5 anak 2" terbaca anak = 5.
  const firstPair = text.match(
    new RegExp(
      `(\\d{1,2})\\s*(?:orang\\s+)?(?:${ADULT}|${CHILD})\\b|(?:${ADULT}|${CHILD})\\s*:?\\s*(\\d{1,2})`,
      "i",
    ),
  );
  const labelFirst = !!firstPair && firstPair[1] === undefined;
  const pick = (label: string): { value: number; found: boolean } => {
    const numFirst = text.match(new RegExp(`(\\d{1,2})\\s*(?:orang\\s+)?${label}\\b`, "i"));
    const lblFirst = text.match(new RegExp(`\\b${label}\\s*:?\\s*(\\d{1,2})`, "i"));
    const primary = labelFirst ? lblFirst : numFirst;
    const secondary = labelFirst ? numFirst : lblFirst;
    const m = primary ?? secondary;
    return m ? { value: Number(m[1]), found: true } : { value: 0, found: false };
  };

  const adultHit = pick(ADULT);
  const childHit = pick(CHILD);
  let adults = adultHit.value;
  const children = childHit.value;
  const genericMatch = text.match(/\b(\d{1,2})\s*(?:orang|pax|tamu)\b/i);
  let adultFound = adultHit.found;

  if (!adults && !children && genericMatch) {
    adults = Number(genericMatch[1]);
    adultFound = true;
  }

  if (!adultFound && !childHit.found) return null;
  if (!Number.isFinite(adults) || !Number.isFinite(children)) return null;
  if (adults < 0 || adults > 20 || children < 0 || children > 20) return null;

  return { adults, children, adultFound, childFound: childHit.found };
}

/**
 * "4 (1 anak kecil)" = total 4, anak 1, dewasa 3.
 * "dewasa 5 (1 anak)" tidak ikut: angka di depan sudah berlabel dewasa/anak.
 */
const PAREN_PARTY_RE = new RegExp(
  `\\b(\\d{1,2})\\s*(?:orang\\s*)?\\(\\s*(\\d{1,2})\\s*(?:orang\\s+)?${CHILD}\\b[^)]*\\)`,
  "gi",
);

export function readParentheticalParty(text: string): { adults: number; children: number } | null {
  if (!text) return null;
  PAREN_PARTY_RE.lastIndex = 0;
  for (const match of text.matchAll(PAREN_PARTY_RE)) {
    const index = match.index ?? 0;
    const before = text.slice(Math.max(0, index - 24), index);
    if (new RegExp(`(?:${ADULT}|${CHILD})\\s*$`, "i").test(before)) continue;
    const total = Number(match[1]);
    const children = Number(match[2]);
    if (!Number.isInteger(total) || !Number.isInteger(children)) continue;
    if (total < 1 || total > 20 || children < 0 || children > total) continue;
    return { adults: total - children, children };
  }
  return null;
}

/**
 * Baca jumlah tamu dan usia anak dari satu pesan. Jumlah anak hanya terisi
 * bila tamu menyebut hitungan ("1 anak"), bukan usia.
 */
export function readGuestCount(message: string): GuestCountReading | null {
  const { ages, masked } = extractChildAges(message);
  const counts = readExplicitCounts(masked);
  const reading: GuestCountReading = {};
  if (counts?.adultFound && counts.adults > 0) reading.adults = counts.adults;
  if (counts?.childFound) reading.children = counts.children;
  // Total di depan kurung menimpa hitungan "1 anak" di dalam kurung.
  const parenthetical = readParentheticalParty(masked);
  if (parenthetical) {
    reading.adults = parenthetical.adults;
    reading.children = parenthetical.children;
  }
  if (ages.length > 0) reading.childAges = ages;
  if (reading.adults === undefined && reading.children === undefined && !reading.childAges)
    return null;
  return reading;
}

/**
 * Gabungkan pembacaan pesan ke slot yang sudah ada.
 * Pesan usia saja tidak menimpa jumlah anak yang sudah diketahui.
 * Bila jumlah anak belum ada, jumlah anak = banyaknya usia.
 */
export function mergeGuestCountReading<
  T extends { adults?: number; children?: number; childAges?: number[] },
>(current: T, reading: GuestCountReading): T {
  const next: T = { ...current };
  if (reading.adults !== undefined) next.adults = reading.adults;
  if (reading.childAges && reading.childAges.length > 0) next.childAges = reading.childAges;
  if (reading.children !== undefined) next.children = reading.children;
  else if (reading.childAges && reading.childAges.length > 0 && next.children === undefined) {
    next.children = reading.childAges.length;
  }
  return next;
}
