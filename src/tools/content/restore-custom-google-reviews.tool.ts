/**
 * Tool: restore_custom_google_reviews
 *
 * Daftar / restore snapshot ulasan kustom dari tabel audit
 * `custom_google_reviews_audit`.
 *
 *   - Tanpa argumen → list 10 snapshot terakhir (untuk dipilih manajer).
 *   - dengan `audit_id` → restore: tulis kembali prev_* dari snapshot itu
 *     ke kolom properties.custom_google_*. Insert audit row baru juga
 *     (sehingga restore-pun bisa diundo).
 *   - dengan `index` (1-based dari list terbaru) → restore snapshot ke-N.
 *
 * Guard: ctx.isManager === true.
 */

import type { ToolContext, ToolHandler } from "@/tools/types";

interface AuditRow {
  id:           string;
  property_id:  string;
  prev_rating:  number | null;
  prev_total:   number | null;
  prev_reviews: unknown;
  next_rating:  number | null;
  next_total:   number | null;
  mode:         string;
  actor:        string | null;
  created_at:   string;
}

function safeReviewArray(raw: unknown): Array<{ author: string; text: string; rating: number }> {
  const parsed = typeof raw === "string" ? JSON.parse(raw || "[]") : raw;
  if (!Array.isArray(parsed)) return [];
  return parsed.map((it: any) => ({
    author: String(it?.author ?? it?.author_name ?? "Tamu"),
    text:   String(it?.text ?? ""),
    rating: Number.isFinite(Number(it?.rating)) ? Number(it?.rating) : 5,
  })).filter((r) => r.text.length > 0);
}

export const restoreCustomGoogleReviews: ToolHandler = async (
  args: Record<string, unknown>,
  ctx:  ToolContext,
): Promise<string> => {
  if (ctx.isManager !== true) {
    return JSON.stringify({
      ok: false,
      error: "Hanya manajer/super admin yang boleh restore ulasan kustom.",
    });
  }

  const propertyId = (ctx.property?.id as string | undefined);
  if (!propertyId) {
    return JSON.stringify({ ok: false, error: "property.id tidak tersedia di konteks." });
  }

  const { data: rows, error: listErr } = await (ctx.supabaseAdmin as any)
    .from("custom_google_reviews_audit")
    .select("id, property_id, prev_rating, prev_total, prev_reviews, next_rating, next_total, mode, actor, created_at")
    .eq("property_id", propertyId)
    .order("created_at", { ascending: false })
    .limit(10);

  if (listErr) {
    return JSON.stringify({
      ok:    false,
      error: listErr.message,
      hint:  "Bila error 'relation does not exist', jalankan migration " +
             "20260602000000_custom_google_reviews_audit.sql.",
    });
  }

  const audits = (rows ?? []) as AuditRow[];
  if (audits.length === 0) {
    return JSON.stringify({
      ok:      false,
      error:   "Belum ada snapshot tersimpan. Audit baru mulai berjalan setelah " +
               "migration audit di-apply dan tool save_custom_google_reviews dipanggil " +
               "minimal sekali setelah itu.",
    });
  }

  const auditId = typeof args.audit_id === "string" ? args.audit_id.trim() : "";
  const idxArg  = typeof args.index === "number" ? Math.floor(args.index) : null;

  // ── LIST mode ──────────────────────────────────────────────────────────
  if (!auditId && (idxArg == null || idxArg < 1)) {
    return JSON.stringify({
      ok: true,
      mode: "list",
      count: audits.length,
      snapshots: audits.map((a, i) => {
        const prev = safeReviewArray(a.prev_reviews);
        return {
          index:           i + 1,
          audit_id:        a.id,
          created_at:      a.created_at,
          mode_that_wrote: a.mode,
          actor:           a.actor,
          previous_state:  {
            rating:        a.prev_rating,
            total:         a.prev_total,
            reviews_count: prev.length,
            // Tampilkan 1 contoh saja agar output ringkas — manajer cukup
            // melihat cuplikan untuk memilih snapshot.
            sample_first:  prev[0]?.text?.slice(0, 120) ?? null,
          },
          next_state_was: {
            rating: a.next_rating,
            total:  a.next_total,
          },
        };
      }),
      next_step:
        "Sebutkan snapshot mana yang ingin di-restore: panggil tool lagi dengan " +
        "`audit_id: '<id>'` atau `index: <1-N>`. Restore akan mengembalikan kolom " +
        "custom_google_* ke nilai 'previous_state' snapshot terpilih.",
    });
  }

  // ── RESTORE mode ───────────────────────────────────────────────────────
  const target = auditId
    ? audits.find((a) => a.id === auditId)
    : (idxArg != null && idxArg >= 1 && idxArg <= audits.length ? audits[idxArg - 1] : null);

  if (!target) {
    return JSON.stringify({
      ok: false,
      error: auditId
        ? `Snapshot dengan audit_id '${auditId}' tidak ditemukan untuk properti ini.`
        : `Index ${idxArg} di luar jangkauan (tersedia 1..${audits.length}).`,
    });
  }

  const restoredReviews = safeReviewArray(target.prev_reviews);

  // Read current state for the new audit row (this restore becomes a new mutation
  // that's itself recorded so the manager can undo the restore if needed).
  let currentRating: number | null = null;
  let currentTotal:  number | null = null;
  let currentReviews: ReturnType<typeof safeReviewArray> = [];
  try {
    const { data } = await (ctx.supabaseAdmin as any)
      .from("properties")
      .select("custom_google_rating, custom_google_reviews_total, custom_google_reviews_json")
      .eq("id", propertyId)
      .maybeSingle();
    if (data) {
      currentRating  = data.custom_google_rating != null ? Number(data.custom_google_rating) : null;
      currentTotal   = data.custom_google_reviews_total != null ? Number(data.custom_google_reviews_total) : null;
      currentReviews = safeReviewArray(data.custom_google_reviews_json);
    }
  } catch (e) {
    console.warn("[restore_custom_google_reviews] read current failed:", e);
  }

  try {
    await (ctx.supabaseAdmin as any)
      .from("custom_google_reviews_audit")
      .insert({
        property_id:  propertyId,
        prev_rating:  currentRating,
        prev_total:   currentTotal,
        prev_reviews: currentReviews,
        next_rating:  target.prev_rating,
        next_total:   target.prev_total,
        next_reviews: restoredReviews,
        mode:         "replace",
        actor:        ((ctx as any).managerName ?? "system") + " (restore)",
      });

    const { error } = await (ctx.supabaseAdmin as any)
      .from("properties")
      .update({
        custom_google_rating:        target.prev_rating,
        custom_google_reviews_total: target.prev_total,
        custom_google_reviews_json:  restoredReviews,
      })
      .eq("id", propertyId);
    if (error) throw error;

    return JSON.stringify({
      ok:   true,
      mode: "restore",
      restored_from: {
        audit_id:   target.id,
        created_at: target.created_at,
        actor:      target.actor,
      },
      now: {
        rating:        target.prev_rating,
        total:         target.prev_total,
        reviews_count: restoredReviews.length,
      },
      message:
        `Restore selesai. Kolom custom_google_* dikembalikan ke snapshot ` +
        `${new Date(target.created_at).toISOString()} (${restoredReviews.length} ulasan, ` +
        `rating ${target.prev_rating ?? "—"}). Restore ini juga tercatat — bisa diundo.`,
    });
  } catch (e) {
    return JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) });
  }
};
