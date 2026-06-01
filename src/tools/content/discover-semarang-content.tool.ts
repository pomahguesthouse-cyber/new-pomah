/**
 * Tool: discover_semarang_content
 *
 * Used by Content Manager Agent to surface fresh, structured candidate
 * entries for the city guide (`explore_items` table). Calls the shared
 * web-search service against curated Indonesian tourism / event sources
 * and returns raw snippets. The agent then synthesizes them into draft
 * `explore_items` rows via `upsert_explore_item`.
 *
 * `category` mirrors the explore_items enum so the agent narrows search
 * intent: 'event' fetches agenda Semarang; 'destinasi' fetches wisata;
 * 'kuliner' fetches food; 'tips' is a generic Semarang fallback.
 */

import { loadSearchKeysFromDb, webSearch } from "@/services/web-search.service";
import type { ToolContext, ToolHandler } from "@/tools/types";

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

const QUERY_TEMPLATES: Record<string, (extra: string) => string> = {
  event:     (e) => `agenda event festival Semarang ${e} ${new Date().getFullYear()}`.trim(),
  destinasi: (e) => `tempat wisata destinasi Semarang ${e}`.trim(),
  kuliner:   (e) => `kuliner makanan khas Semarang ${e}`.trim(),
  tips:      (e) => `tips wisata Semarang ${e}`.trim(),
};

const CURATED_DOMAINS_BY_CATEGORY: Record<string, string[]> = {
  event:     ["ppid.semarangkota.go.id", "semarangkota.go.id"],
  destinasi: ["indonesia.travel", "semarangkota.go.id"],
  kuliner:   [],
  tips:      [],
};

export const discoverSemarangContent: ToolHandler = async (
  args: Record<string, unknown>,
  ctx:  ToolContext,
): Promise<string> => {
  const categoryRaw = str(args.category).toLowerCase();
  const category = (QUERY_TEMPLATES[categoryRaw] ? categoryRaw : "tips") as keyof typeof QUERY_TEMPLATES;
  const extra = str(args.extra_keywords);

  const keys = await loadSearchKeysFromDb(ctx.supabaseAdmin as any);
  if (!keys.tavily && !keys.serper && !process.env.TAVILY_API_KEY && !process.env.SERPER_API_KEY) {
    return JSON.stringify({
      ok: false,
      error: "Web search belum dikonfigurasi (set tavily_api_key atau serper_api_key di Settings).",
    });
  }

  const query = QUERY_TEMPLATES[category](extra);
  const res = await webSearch(query, keys, {
    curatedDomains: CURATED_DOMAINS_BY_CATEGORY[category],
    maxResults: 8,
  });

  return JSON.stringify({
    ok: true,
    category,
    query,
    provider: res.provider,
    snippets: res.snippets.map((s, i) => ({
      idx:     i + 1,
      title:   s.title,
      url:     s.url,
      snippet: s.snippet.slice(0, 800),
    })),
  });
};
