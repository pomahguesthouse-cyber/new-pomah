/**
 * Parser nominal rupiah dari bahasa manajer.
 *
 * Satu implementasi dipakai parser perintah Telegram DAN tool pricing —
 * sebelumnya ada dua salinan yang sudah menyimpang, dan keduanya salah untuk
 * "1.2jt" (satuan ditempel ke bagian desimal → NaN).
 *
 * Diterima: "350000", "350.000", "350,000", "350rb", "350 rb", "350 ribu",
 *           "350k", "1.2jt", "1,2 juta", "Rp 350.000".
 */
export function parseIDRAmount(v: string): number | null {
  const cleaned = String(v ?? "").replace(/rp/gi, "").replace(/\s+/g, "").trim();
  const m = cleaned.match(/^([\d.,]+)(rb|ribu|k|jt|juta|m)?$/i);
  if (!m) return null;

  const unit = (m[2] ?? "").toLowerCase();
  const multiplier =
    unit === "" ? 1
    : unit === "jt" || unit === "juta" || unit === "m" ? 1_000_000
    : 1_000;

  let digits = m[1];
  if (multiplier === 1) {
    // Tanpa satuan: titik/koma = pemisah ribuan ("350.000", "350,000").
    digits = digits.replace(/[.,]/g, "");
  } else {
    // Dengan satuan: separator biasanya DESIMAL ("1.2jt" = 1.200.000), kecuali
    // setiap gugus setelahnya tepat 3 digit ("1.200rb" = pemisah ribuan).
    const parts = digits.replace(/,/g, ".").split(".");
    digits =
      parts.length > 1 && parts.slice(1).every((p) => p.length === 3)
        ? parts.join("")
        : parts.length > 2
          ? parts.join("")
          : parts.join(".");
  }

  const n = Number(digits) * multiplier;
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}
