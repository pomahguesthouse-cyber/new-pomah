/**
 * Tool: list_explore_items
 *
 * Returns existing city-guide entries so the Content Manager Agent can
 * detect duplicates / staleness before inserting new ones.
 */

import type { ToolContext, ToolHandler } from "@/tools/types";

export const listExploreItems: ToolHandler = async (
  args: Record<string, unknown>,
  ctx:  ToolContext,
): Promise<string> => {
  const cat = typeof args.category === "string" ? args.category.trim().toLowerCase() : "";
  let q = (ctx.supabaseAdmin as any)
    .from("explore_items")
    .select("id, title, category, date_text, location_text, is_published, updated_at")
    .order("updated_at", { ascending: false })
    .limit(50);
  if (cat) q = q.eq("category", cat);
  const { data, error } = await q;
  if (error) return JSON.stringify({ ok: false, error: error.message });
  return JSON.stringify({ ok: true, items: data ?? [] });
};
