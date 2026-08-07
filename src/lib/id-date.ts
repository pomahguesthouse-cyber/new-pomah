/**
 * Primitif parsing tanggal Bahasa Indonesia — SATU sumber kebenaran.
 *
 * Latar (audit 7 Agu 2026 — B6). Sebelum modul ini ada empat implementasi
 * terpisah yang saling tidak tahu:
 *   1. `services/wa-autoreply/message-parsers.ts` — paling lengkap
 *   2. `tools/availability.tool.ts` (`coerceDate`) — tanpa rollover tahun,
 *      tanpa validasi tanggal nyata
 *   3. `ai/state-machine/flexible-slot-extractor.ts` — alternation bulan sendiri,
 *      tanpa toleransi typo
 *   4. `ai/multi-agent-orchestrator.ts` (`hasExplicitDateSignal`) — regex
 *      deteksi sinyal tanggal versi ketiga
 *
 * Akibatnya satu pesan tamu bisa dibaca berbeda tergantung jalur mana yang
 * kebetulan menanganinya. Insiden 7 Agu 2026 ("masih ada 1 kamar untuk tanggal
 * 8 Agustus 2026" dibalas ketersediaan 18 September) adalah gejala langsung:
 * satu parser gagal, jalur lain memakai tanggal sesi lama, dan tidak ada yang
 * saling mengoreksi.
 *
 * Semua jalur sekarang memanggil fungsi di file ini.
 */

/** Nama & singkatan bulan → nomor bulan (1–12). */
export const ID_MONTHS: Record<string, number> = {
  jan: 1,
  januari: 1,
  feb: 2,
  februari: 2,
  pebruari: 2,
  mar: 3,
  maret: 3,
  apr: 4,
  april: 4,
  mei: 5,
  jun: 6,
  juni: 6,
  jul: 7,
  juli: 7,
  agu: 8,
  agt: 8,
  ags: 8,
  agustus: 8,
  sep: 9,
  sept: 9,
  september: 9,
  okt: 10,
  oktober: 10,
  nov: 11,
  november: 11,
  des: 12,
  desember: 12,
};

/** Nama bulan lengkap — dipakai untuk toleransi typo (mis. "sepember"). */
const ID_MONTH_FULL_NAMES = Object.keys(ID_MONTHS).filter((name) => name.length >= 5);

/**
 * Kata yang lazim muncul sebagai "<angka> <kata>" tetapi BUKAN nama bulan
 * (mis. "1 kamar", "2 orang", "3 malam"). Tanpa daftar ini, kandidat pertama
 * seperti "1 kamar" bisa menutup kandidat tanggal asli di belakangnya.
 */
const NON_MONTH_WORDS =
  /^(kamar|kamarnya|room|rooms|orang|dewasa|anak|bocil|bocah|balita|pax|tamu|malam|hari|minggu|bulan|tahun|jam|unit|buah|ribu|rb|juta|jt|k)$/i;

function editDistance(a: string, b: string): number {
  const rows = a.length + 1;
  const cols = b.length + 1;
  let prev = Array.from({ length: cols }, (_, i) => i);
  for (let i = 1; i < rows; i += 1) {
    const curr = [i, ...new Array(cols - 1).fill(0)];
    for (let j = 1; j < cols; j += 1) {
      curr[j] = Math.min(
        prev[j] + 1,
        curr[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = curr;
  }
  return prev[cols - 1];
}

/**
 * Ubah sebuah kata menjadi nomor bulan (1–12). Exact-match dulu, lalu toleransi
 * typo ringan terhadap nama bulan lengkap (insiden 2 Agu 2026: "tgl 18
 * sepember" gagal di-parse sehingga bot memakai tanggal sesi lama).
 * Return `null` bila kata jelas bukan bulan.
 */
export function resolveMonthName(raw: string): number | null {
  const name = raw.toLowerCase().replace(/[^a-z]/g, "");
  if (!name) return null;
  const exact = ID_MONTHS[name];
  if (exact) return exact;
  if (name.length < 4 || NON_MONTH_WORDS.test(name)) return null;

  for (const candidate of ID_MONTH_FULL_NAMES) {
    if (Math.abs(candidate.length - name.length) > 1) continue;
    const maxDistance = candidate.length >= 7 ? 2 : 1;
    if (editDistance(name, candidate) <= maxDistance) return ID_MONTHS[candidate];
  }
  return null;
}

/** Bentuk YYYY-MM-DD, atau `null` bila tanggalnya tidak nyata (mis. 31 Feb). */
export function makeIsoDate(day: number, month: number, year: number): string | null {
  if (!Number.isInteger(day) || !Number.isInteger(month) || !Number.isInteger(year)) return null;
  if (day < 1 || day > 31 || month < 1 || month > 12 || year < 2000 || year > 2100) return null;
  const iso = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const d = new Date(`${iso}T00:00:00Z`);
  if (d.getUTCFullYear() !== year || d.getUTCMonth() + 1 !== month || d.getUTCDate() !== day)
    return null;
  return iso;
}

/**
 * Tentukan tahun untuk sebuah bulan yang disebut tanpa tahun.
 * Bulan yang sudah lewat tahun ini dianggap tahun depan — tamu yang bilang
 * "3 Januari" pada bulan Agustus jelas memaksudkan Januari berikutnya.
 */
export function resolveYear(
  month: number,
  explicitYear: string | undefined,
  today: string,
): number {
  if (explicitYear) {
    return Number(explicitYear.length === 2 ? `20${explicitYear}` : explicitYear);
  }
  const currentYear = Number(today.slice(0, 4));
  const currentMonth = Number(today.slice(5, 7));
  return month < currentMonth ? currentYear + 1 : currentYear;
}

/**
 * Gabungan lengkap: "8", "agustus", "2026" → "2026-08-08".
 * Menangani nama bulan bertipo, tahun 2 digit, tahun implisit (rollover), dan
 * menolak tanggal yang tidak nyata.
 */
export function resolveIdDate(
  day: number,
  monthName: string,
  yearRaw: string | undefined,
  today: string,
): string | null {
  const month = resolveMonthName(monthName);
  if (!month) return null;
  return makeIsoDate(day, month, resolveYear(month, yearRaw, today));
}

/**
 * True bila pesan MENYEBUT tanggal secara eksplisit (nama bulan, "tgl 18",
 * "8/9", atau kata relatif seperti "besok").
 *
 * Dipakai sebagai rem di beberapa tempat: bila sinyal ini ada tetapi parser
 * gagal, jalur cepat TIDAK boleh meminjam tanggal dari sesi lama — tanggal
 * lama hampir pasti bukan yang dimaksud tamu.
 */
export function mentionsExplicitDateSignal(message: string): boolean {
  const text = message.toLowerCase().replace(/\s+/g, " ").trim();
  if (!text) return false;
  if (/\b(hari ini|malam ini|nanti malam|besok|tomorrow|lusa|today)\b/i.test(text)) return true;
  if (/\b(?:tanggal|tangga|tgl)\.?\s*\d{1,2}\b/i.test(text)) return true;
  if (/\b\d{1,2}\s*[/.]\s*\d{1,2}\b/i.test(text)) return true;
  return (text.match(/[a-z]{4,}/gi) ?? []).some((token) => resolveMonthName(token) !== null);
}
