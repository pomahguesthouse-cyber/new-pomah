/**
 * Tool: list_tracked_keywords
 *
 * Read-only view of the seo_keywords table — what keywords we track,
 * their last known Google position, priority, and intent. Used by
 * Content Manager Agent when manager asks "apa saja keyword kita sekarang"
 * or "mana keyword yang turun peringkatnya".
 */

import type { ToolContext, ToolHandler } from "@/tools/types";

interface KeywordRow {
  id?: string;
  keyword?: string;
  search_volume?: number | null;
  difficulty?: number | null;
  intent?: string | null;
  priority?: string | null;
  ranking_position?: number | null;
  updated_at?: string | null;
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

export const listTrackedKeywords: ToolHandler = async (
  args: Record<string, unknown>,
  ctx:  ToolContext,
): Promise<string> => {
  if (ctx.isManager !== true) {
    return JSON.stringify({
      ok: false,
      error: "Hanya manajer/super admin yang boleh melihat daftar keyword SEO.",
    });
  }

  const priorityFilter = str(args.priority).toLowerCase();
  const onlyUnranked = args.only_unranked === true;
  const orderBy = str(args.order_by).toLowerCase(); // "position" | "priority" | "" (default updated_at)

  let query = (ctx.supabaseAdmin as any)
    .from("seo_keywords")
    .select(
      "id, keyword, search_volume, difficulty, intent, priority, ranking_position, updated_at",
    );

  if (["high", "medium", "low"].includes(priorityFilter)) {
    query = query.eq("priority", priorityFilter);
  }
  if (onlyUnranked) {
    query = query.is("ranking_position", null);
  }

  if (orderBy === "position") {
    query = query.order("ranking_position", { ascending: true, nullsFirst: false });
  } else if (orderBy === "priority") {
    // Postgres sorts text alphabetically — high/low/medium. Use updated_at as
    // tiebreaker and let the agent re-sort if a strict prio order is needed.
    query = query.order("priority").order("updated_at", { ascending: false });
  } else {
    query = query.order("updated_at", { ascending: false });
  }

  const { data, error } = await query.limit(50);

  if (error) {
    return JSON.stringify({
      ok: false,
      error: `Gagal membaca seo_keywords: ${error.message}`,
    });
  }

  const rows = (data ?? []) as KeywordRow[];

  // Summary stats for the agent to use without re-iterating.
  const tracked = rows.length;
  const ranked = rows.filter((r) => typeof r.ranking_position === "number").length;
  const top10 = rows.filter(
    (r) => typeof r.ranking_position === "number" && (r.ranking_position as number) <= 10,
  ).length;
  const top3 = rows.filter(
    (r) => typeof r.ranking_position === "number" && (r.ranking_position as number) <= 3,
  ).length;

  return JSON.stringify({
    ok: true,
    summary: { tracked, ranked, top10, top3 },
    keywords: rows.map((r) => ({
      keyword:          r.keyword ?? "",
      ranking_position: r.ranking_position ?? null,
      search_volume:    r.search_volume ?? null,
      difficulty:       r.difficulty ?? null,
      intent:           r.intent ?? null,
      priority:         r.priority ?? null,
      updated_at:       r.updated_at ?? null,
    })),
  });
};
