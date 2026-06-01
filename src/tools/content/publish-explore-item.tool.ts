/**
 * Tool: publish_explore_item
 *
 * Single-purpose toggle for explore_items.is_published. Designed for
 * conversational flows where the manager says "publish saja" after
 * Content Manager Agent already added draft entries — the agent only
 * needs the id (which it can get from list_explore_items) and the
 * boolean, not the full upsert payload.
 *
 * Accepts:
 *   - id (UUID) — exact target
 *   - OR title_substring — best-effort lookup of the most recent
 *     unpublished entry whose title contains the substring
 */

import type { ToolContext, ToolHandler } from "@/tools/types";

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

export const publishExploreItem: ToolHandler = async (
  args: Record<string, unknown>,
  ctx:  ToolContext,
): Promise<string> => {
  const id = str(args.id);
  const titleSubstring = str(args.title_substring);
  const publish = args.publish !== false; // default true

  let targetId = id;

  if (!targetId && titleSubstring) {
    const { data } = await (ctx.supabaseAdmin as any)
      .from("explore_items")
      .select("id, title")
      .ilike("title", `%${titleSubstring}%`)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (data?.id) targetId = data.id as string;
  }

  if (!targetId) {
    return JSON.stringify({
      ok: false,
      error: "Tidak ada id atau title_substring yang cocok. " +
        "Panggil list_explore_items dulu untuk dapatkan id, atau pass title_substring.",
    });
  }

  try {
    const { data, error } = await (ctx.supabaseAdmin as any)
      .from("explore_items")
      .update({ is_published: publish })
      .eq("id", targetId)
      .select("id, title, category, is_published")
      .single();
    if (error) return JSON.stringify({ ok: false, error: error.message });
    return JSON.stringify({
      ok: true,
      item: data,
      action: publish ? "published" : "unpublished",
    });
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    return JSON.stringify({ ok: false, error: m });
  }
};

/**
 * Bulk variant: publish ALL unpublished entries of a category (e.g.
 * after a discovery run, "publish saja semua event").
 */
export const publishExploreItemsByCategory: ToolHandler = async (
  args: Record<string, unknown>,
  ctx:  ToolContext,
): Promise<string> => {
  const category = str(args.category).toLowerCase();
  const publish = args.publish !== false;
  if (!["event", "destinasi", "kuliner", "tips"].includes(category)) {
    return JSON.stringify({
      ok: false,
      error: "category harus salah satu: event, destinasi, kuliner, tips.",
    });
  }

  try {
    const { data: targets } = await (ctx.supabaseAdmin as any)
      .from("explore_items")
      .select("id, title")
      .eq("category", category)
      .eq("is_published", !publish);
    const ids = (targets ?? []).map((r: any) => r.id);
    if (ids.length === 0) {
      return JSON.stringify({ ok: true, count: 0, note: `Tidak ada entri ${category} yang perlu di-${publish ? "publish" : "unpublish"}.` });
    }

    const { error } = await (ctx.supabaseAdmin as any)
      .from("explore_items")
      .update({ is_published: publish })
      .in("id", ids);
    if (error) return JSON.stringify({ ok: false, error: error.message });

    return JSON.stringify({
      ok: true,
      count: ids.length,
      titles: (targets ?? []).map((r: any) => r.title),
      action: publish ? "published" : "unpublished",
    });
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    return JSON.stringify({ ok: false, error: m });
  }
};
