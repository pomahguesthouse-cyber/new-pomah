/**
 * Tool: upsert_explore_item
 *
 * Insert OR update one city-guide entry (explore_items table). Used by
 * Content Manager Agent after `discover_semarang_content` produced
 * snippets — agent picks the best one, paraphrases into a description,
 * and calls this tool to persist.
 *
 * Defaults to is_published=false so admin reviews before it goes live
 * on the public city-guide page.
 */

import type { ToolContext, ToolHandler } from "@/tools/types";

function str(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length ? t : null;
}

const ALLOWED_CATEGORIES = new Set(["event", "destinasi", "kuliner", "tips"]);

export const upsertExploreItem: ToolHandler = async (
  args: Record<string, unknown>,
  ctx:  ToolContext,
): Promise<string> => {
  if (ctx.isManager !== true) {
    return JSON.stringify({
      ok: false,
      error: "Hanya manajer/super admin yang boleh membuat atau mengubah entri city guide.",
    });
  }

  const title       = str(args.title);
  const category    = str(args.category)?.toLowerCase();
  const description = str(args.description);
  const dateText    = str(args.date_text);
  const locationText = str(args.location_text);
  const imageUrl    = str(args.image_url);
  const badge       = str(args.badge);
  const idArg       = str(args.id);
  const publish     = args.publish === true;

  if (!title) return JSON.stringify({ ok: false, error: "title wajib diisi." });
  if (!category || !ALLOWED_CATEGORIES.has(category)) {
    return JSON.stringify({
      ok: false,
      error: `category harus salah satu: ${[...ALLOWED_CATEGORIES].join(", ")}.`,
    });
  }

  const payload: Record<string, unknown> = {
    title,
    category,
    description,
    date_text:     dateText,
    location_text: locationText,
    image_url:     imageUrl,
    badge,
    is_published:  publish,
  };

  try {
    if (idArg) {
      const { data, error } = await (ctx.supabaseAdmin as any)
        .from("explore_items")
        .update(payload)
        .eq("id", idArg)
        .select("id, title, category, is_published")
        .single();
      if (error) throw error;
      return JSON.stringify({ ok: true, mode: "update", item: data });
    }

    const { data, error } = await (ctx.supabaseAdmin as any)
      .from("explore_items")
      .insert(payload)
      .select("id, title, category, is_published")
      .single();
    if (error) throw error;
    return JSON.stringify({ ok: true, mode: "insert", item: data });
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    return JSON.stringify({ ok: false, error: m });
  }
};
