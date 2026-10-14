/**
 * Tampilan ulasan tamu di situs publik: sumber per ulasan (Google /
 * Booking.com / Trip.com), tanggal cek rating, dan badge rating situs lain.
 * Murni (tanpa I/O) supaya bisa dites.
 */

export type ReviewSource = "google" | "booking" | "tripcom" | "other";

export interface DisplayReview {
  author: string;
  text: string;
  rating: number;
  source: ReviewSource;
  /** YYYY-MM atau YYYY-MM-DD, bila diketahui. */
  date: string | null;
}

export interface SourceBadge {
  source: ReviewSource;
  label: string;
  score: number;
  scale: number;
  count: number;
  url: string | null;
}

export function normalizeReviewSource(raw: unknown): ReviewSource {
  const s = String(raw ?? "").toLowerCase().replace(/[^a-z]/g, "");
  if (!s || s.startsWith("google")) return "google";
  if (s.startsWith("booking")) return "booking";
  if (s.startsWith("trip")) return "tripcom";
  return "other";
}

export function reviewSourceLabel(source: ReviewSource): string {
  switch (source) {
    case "google":
      return "Google";
    case "booking":
      return "Booking.com";
    case "tripcom":
      return "Trip.com";
    default:
      return "Tamu";
  }
}

function cleanDate(raw: unknown): string | null {
  const s = String(raw ?? "").trim();
  return /^\d{4}-\d{2}(-\d{2})?$/.test(s) ? s : null;
}

/** Baca daftar ulasan tersimpan (format lama tanpa source = Google). */
export function parseStoredReviews(raw: unknown): DisplayReview[] {
  let list: unknown = raw;
  if (typeof raw === "string") {
    try {
      list = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(list)) return [];
  return list
    .map((item: any) => ({
      author: String(item?.author ?? item?.author_name ?? "Tamu").trim() || "Tamu",
      text: String(item?.text ?? "").trim(),
      rating: Number(item?.rating ?? 5) || 5,
      source: normalizeReviewSource(item?.source),
      date: cleanDate(item?.date),
    }))
    .filter((r) => r.text.length > 0);
}

export function parseSourceBadges(raw: unknown): SourceBadge[] {
  if (!Array.isArray(raw)) return [];
  const out: SourceBadge[] = [];
  for (const item of raw as any[]) {
    const source = normalizeReviewSource(item?.source);
    const score = Number(item?.score);
    const scale = Number(item?.scale ?? 10);
    const count = Number(item?.count);
    if (source === "google" || !(score > 0) || !(scale > 0) || !(count > 0)) continue;
    const url = typeof item?.url === "string" && /^https:\/\//.test(item.url) ? item.url : null;
    out.push({ source, label: reviewSourceLabel(source), score, scale, count, url });
  }
  return out;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];

/** "2026-10-14" → "14 Okt 2026"; "2025-12" → "Des 2025". */
export function formatReviewDate(raw: string | null | undefined): string | null {
  const s = (raw ?? "").slice(0, 10);
  const m = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(s);
  if (!m) return null;
  const month = MONTHS[Number(m[2]) - 1];
  if (!month) return null;
  return m[3] ? `${Number(m[3])} ${month} ${m[1]}` : `${month} ${m[1]}`;
}

/** Angka Google untuk JSON-LD aggregateRating — hanya bila keduanya valid. */
export function googleAggregate(
  rating: number | null | undefined,
  total: number | null | undefined,
): { rating: number; total: number } | null {
  const r = Number(rating);
  const t = Number(total);
  if (!Number.isFinite(r) || r <= 0 || r > 5 || !Number.isFinite(t) || t <= 0) return null;
  return { rating: r, total: Math.round(t) };
}

/**
 * Teks badge "76 ulasan" / "{jumlah} ulasan" di homepage memakai jumlah ulasan
 * Google live. Tanpa angka live, placeholder disembunyikan.
 */
export function liveReviewCountDesc(desc: string | null | undefined, total: number | null): string {
  const d = String(desc ?? "");
  if (/^\s*(\d+|\{jumlah\})\s+ulasan\s*$/i.test(d)) {
    return total && total > 0 ? `${total} ulasan` : "Ulasan tamu";
  }
  return d;
}
