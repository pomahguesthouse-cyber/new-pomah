/**
 * Tool: save_custom_google_reviews
 *
 * Tulis/tambah ulasan + rating ke kolom custom_google_* di tabel `properties`.
 * Setelah ini, public site (`getGoogleReviews`) pakai branch custom — Google
 * Places API tidak di-hit.
 *
 * MODE DEFAULT: APPEND.
 *   - Baca ulasan yang sudah ada di custom_google_reviews_json, gabungkan
 *     dengan yang baru, dedupe (author+awal-text), CAP total max 30 entry.
 *   - Rating overall: bila `rating` di args di-set, pakai itu. Bila TIDAK
 *     di-set, hitung weighted-average dari existing rating × existing count
 *     + new rating × new count. Bila existing tidak ada, pakai new.
 *   - Total ulasan publik: bila `total` di args di-set, pakai itu. Bila
 *     tidak, pertahankan existing.
 *   - Hasil: ulasan lama TIDAK pernah hilang kecuali Anda set replace_all=true.
 *
 * MODE REPLACE: kirim `replace_all: true` untuk overwrite total.
 *
 * GUARDS:
 *  - Wajib `ctx.isManager === true` (managerial channel).
 *  - reviews input 1..12; tiap text max 1000 char; rating 1..5.
 *  - Total tersimpan setelah merge dibatasi 30 (FIFO drop yang paling lama).
 */

import type { ToolContext, ToolHandler } from "@/tools/types";

interface InputReview {
  author?: unknown;
  text?:   unknown;
  rating?: unknown;
}

interface StoredReview {
  author: string;
  text:   string;
  rating: number;
}

const MAX_STORED = 30;

function clampReviewRating(v: unknown, fallback = 5): number {
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

/** Normalize for dedupe — lowercase, strip whitespace, take first 80 chars of text. */
function dedupeKey(r: { author: string; text: string }): string {
  const author = r.author.trim().toLowerCase();
  const text   = r.text.trim().toLowerCase().replace(/\s+/g, " ").slice(0, 80);
  return `${author}|${text}`;
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

  const replaceAll = args.replace_all === true;
  const newRatingArg = clampOverallRating(args.rating);
  const newTotalArg = args.total != null && Number.isFinite(Number(args.total))
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
      error: `Maksimal 12 ulasan per panggilan (Anda mengirim ${rawReviews.length}). ` +
             "Pecah jadi beberapa panggilan atau pilih yang paling representatif.",
    });
  }

  // Sanitize new reviews
  const newReviews: StoredReview[] = rawReviews.map((r) => ({
    author: String(r.author ?? "Tamu").trim().slice(0, 80) || "Tamu",
    text:   String(r.text ?? "").trim().slice(0, 1000),
    rating: clampReviewRating(r.rating, newRatingArg != null ? Math.round(newRatingArg) : 5),
  })).filter((r) => r.text.length > 0);

  if (newReviews.length === 0) {
    return JSON.stringify({
      ok: false,
      error: "Setelah filter, tidak ada ulasan yang punya teks. Periksa kembali input.",
    });
  }

  const propertyId = (ctx.property?.id as string | undefined);
  if (!propertyId) {
    return JSON.stringify({ ok: false, error: "property.id tidak tersedia di konteks." });
  }

  // ── Read existing (always — needed for dedupe + rating math) ────────────
  let existingReviews: StoredReview[] = [];
  let existingRating:  number | null  = null;
  let existingTotal:   number | null  = null;
  try {
    const { data } = await (ctx.supabaseAdmin as any)
      .from("properties")
      .select("custom_google_rating, custom_google_reviews_total, custom_google_reviews_json")
      .eq("id", propertyId)
      .maybeSingle();
    if (data) {
      existingRating = data.custom_google_rating != null ? Number(data.custom_google_rating) : null;
      existingTotal  = data.custom_google_reviews_total != null ? Number(data.custom_google_reviews_total) : null;
      const raw = data.custom_google_reviews_json;
      const parsed = typeof raw === "string" ? JSON.parse(raw || "[]") : raw;
      if (Array.isArray(parsed)) {
        existingReviews = parsed.map((it: any) => ({
          author: String(it?.author ?? it?.author_name ?? "Tamu"),
          text:   String(it?.text ?? ""),
          rating: clampReviewRating(it?.rating, 5),
        })).filter((r) => r.text.length > 0);
      }
    }
  } catch (e) {
    console.warn("[save_custom_google_reviews] read existing failed:", e);
  }

  // ── Merge ─────────────────────────────────────────────────────────────
  let finalReviews: StoredReview[];
  let addedCount   = 0;
  let dupeCount    = 0;

  if (replaceAll) {
    finalReviews = newReviews;
    addedCount   = newReviews.length;
  } else {
    const seen = new Set(existingReviews.map(dedupeKey));
    const additions: StoredReview[] = [];
    for (const r of newReviews) {
      if (seen.has(dedupeKey(r))) { dupeCount++; continue; }
      seen.add(dedupeKey(r));
      additions.push(r);
    }
    addedCount   = additions.length;
    // Prepend the new ones so the freshest reviews sit at the top of the
    // array — easier for the manager to spot when editing the SEO admin
    // form, and matches "newest first" expectation on the public page.
    finalReviews = [...additions, ...existingReviews];
    // Cap at MAX_STORED — drop OLDEST (now at the bottom).
    if (finalReviews.length > MAX_STORED) {
      finalReviews = finalReviews.slice(0, MAX_STORED);
    }
  }

  // ── Resolve overall rating ────────────────────────────────────────────
  let finalRating: number;
  if (replaceAll) {
    finalRating = newRatingArg ?? clampReviewRating(
      newReviews.reduce((s, r) => s + r.rating, 0) / newReviews.length,
    );
  } else if (newRatingArg != null) {
    // Manager explicitly provided a new overall rating → use it.
    finalRating = newRatingArg;
  } else if (existingRating != null) {
    // Weighted average between existing (weighted by existing total or existing review count)
    // and the new reviews batch (weighted by new addedCount).
    const existingWeight = existingTotal ?? existingReviews.length ?? 0;
    const newWeight      = addedCount;
    if (existingWeight + newWeight === 0) {
      finalRating = existingRating;
    } else {
      const newAvg = newReviews.reduce((s, r) => s + r.rating, 0) / Math.max(1, newReviews.length);
      const merged =
        (existingRating * existingWeight + newAvg * newWeight) /
        (existingWeight + newWeight);
      finalRating = clampOverallRating(merged) ?? existingRating;
    }
  } else {
    finalRating = clampReviewRating(
      newReviews.reduce((s, r) => s + r.rating, 0) / newReviews.length,
    );
  }

  // ── Resolve total ─────────────────────────────────────────────────────
  let finalTotal: number | null;
  if (replaceAll) {
    finalTotal = newTotalArg;
  } else if (newTotalArg != null) {
    finalTotal = newTotalArg;
  } else if (existingTotal != null) {
    // Bump existing total by the number of ACTUALLY added reviews (skip dupes).
    finalTotal = existingTotal + addedCount;
  } else {
    finalTotal = null;
  }

  try {
    // Audit FIRST — capture the "before" snapshot so accidental overwrite
    // can be restored via restore_custom_google_reviews. Non-fatal if the
    // audit table is missing (older deploys without the migration).
    try {
      await (ctx.supabaseAdmin as any)
        .from("custom_google_reviews_audit")
        .insert({
          property_id:  propertyId,
          prev_rating:  existingRating,
          prev_total:   existingTotal,
          prev_reviews: existingReviews,
          next_rating:  finalRating,
          next_total:   finalTotal,
          next_reviews: finalReviews,
          mode:         replaceAll ? "replace" : "append",
          actor:        (ctx as any).managerName ?? "system",
        });
    } catch (auditErr) {
      console.warn("[save_custom_google_reviews] audit insert failed:", auditErr);
    }

    const { error } = await (ctx.supabaseAdmin as any)
      .from("properties")
      .update({
        custom_google_rating:        finalRating,
        custom_google_reviews_total: finalTotal,
        custom_google_reviews_json:  finalReviews,
      })
      .eq("id", propertyId);
    if (error) throw error;
    return JSON.stringify({
      ok: true,
      mode: replaceAll ? "replace" : "append",
      saved: {
        rating: finalRating,
        total:  finalTotal,
        reviews_count: finalReviews.length,
        added:  addedCount,
        skipped_duplicates: dupeCount,
      },
      message:
        replaceAll
          ? `Ulasan lama DIHAPUS. Sekarang: rating ${finalRating.toFixed(1)}, ` +
            `${finalReviews.length} ulasan.`
          : `Tambah ${addedCount} ulasan baru` +
            (dupeCount > 0 ? ` (${dupeCount} duplikat dilewati)` : "") +
            `. Total sekarang ${finalReviews.length} ulasan tersimpan, rating ${finalRating.toFixed(1)}` +
            (finalTotal != null ? `, total ulasan publik ${finalTotal}` : "") +
            ". Ulasan lama Anda tetap aman.",
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
