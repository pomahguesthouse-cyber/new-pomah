/**
 * Tool: save_custom_google_reviews
 *
 * Tulis ulasan + rating yang sudah dikurasi agent ke kolom custom_google_*
 * di tabel `properties`. Setelah ini, public site (`getGoogleReviews`)
 * akan pakai branch custom — Google Places API tidak di-hit.
 *
 * GUARDS:
 *  - Wajib `ctx.isManager === true` (managerial channel). Tidak boleh
 *    dipanggil dari WhatsApp tamu — ini operasi konten publik.
 *  - rating 0..5; reviews max 12 entry; tiap text max 1000 char.
 */

import type { ToolContext, ToolHandler } from "@/tools/types";

interface InputReview {
  author?: unknown;
  text?:   unknown;
  rating?: unknown;
}

function clampRating(v: unknown, fallback = 5): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(1, Math.min(5, Math.round(n * 10) / 10));
}

function clampOverallRating(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(5, Math.round(n * 100) / 100));
}

export const saveCustomGoogleReviews: ToolHandler = async (
  args: Record<string, unknown>,
  ctx:  ToolContext,
): Promise<string> => {
  if (ctx.isManager !== true) {
    return JSON.stringify({
      ok: false,
      error: "Hanya manajer/super admin yang boleh menyimpan ulasan kustom. " +
             "Tool ini hanya tersedia di kanal internal (Telegram bot agent atau " +
             "nomor WhatsApp manajer terdaftar).",
    });
  }

  const rating = clampOverallRating(args.rating);
  if (rating == null) {
    return JSON.stringify({
      ok: false,
      error: "Field `rating` (overall, 0..5) wajib diisi dan numerik.",
    });
  }

  const total = args.total != null && Number.isFinite(Number(args.total))
    ? Math.max(0, Math.floor(Number(args.total)))
    : null;

  const rawReviews = Array.isArray(args.reviews) ? args.reviews as InputReview[] : [];
  if (rawReviews.length === 0) {
    return JSON.stringify({
      ok: false,
      error: "Sertakan minimal 1 ulasan dalam field `reviews` (array of " +
             "{author, text, rating}).",
    });
  }
  if (rawReviews.length > 12) {
    return JSON.stringify({
      ok: false,
      error: `Maksimal 12 ulasan per simpan (Anda mengirim ${rawReviews.length}). ` +
             "Pilih yang paling representatif.",
    });
  }

  const reviews = rawReviews.map((r): { author: string; text: string; rating: number } => ({
    author: String(r.author ?? "Tamu").trim().slice(0, 80) || "Tamu",
    text:   String(r.text ?? "").trim().slice(0, 1000),
    rating: clampRating(r.rating, Math.round(rating)),
  })).filter((r) => r.text.length > 0);

  if (reviews.length === 0) {
    return JSON.stringify({
      ok: false,
      error: "Setelah filter, tidak ada ulasan yang punya teks. Periksa kembali input.",
    });
  }

  const propertyId = (ctx.property?.id as string | undefined);
  if (!propertyId) {
    return JSON.stringify({ ok: false, error: "property.id tidak tersedia di konteks." });
  }

  try {
    const { error } = await (ctx.supabaseAdmin as any)
      .from("properties")
      .update({
        custom_google_rating:        rating,
        custom_google_reviews_total: total,
        custom_google_reviews_json:  reviews,
      })
      .eq("id", propertyId);
    if (error) throw error;
    return JSON.stringify({
      ok: true,
      saved: {
        rating,
        total,
        reviews_count: reviews.length,
      },
      message:
        `Tersimpan: rating ${rating.toFixed(1)}, ${reviews.length} ulasan` +
        (total != null ? `, total ulasan publik ${total}` : "") +
        ". Halaman publik sekarang menampilkan ulasan kustom (Google Places API skip).",
    });
  } catch (e) {
    return JSON.stringify({
      ok: false,
      error: e instanceof Error ? e.message : String(e),
      hint:
        "Bila error 'column not found', pastikan migration " +
        "20260529120000_add_custom_google_reviews.sql sudah di-apply ke DB.",
    });
  }
};
