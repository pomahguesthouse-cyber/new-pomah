/**
 * Tool: check_keyword_ranking
 *
 * Query Google via Serper for `keyword`, locate Pomah's domain in the
 * first 30 organic results, and persist the position to seo_keywords.
 *
 * Used by Content Manager Agent for "cek posisi kita di Google untuk
 * keyword X". Returns position (1-30 or null), top 5 competitor URLs,
 * and the position delta vs. the previously stored value.
 */

import type { ToolContext, ToolHandler } from "@/tools/types";
import { loadSearchKeysFromDb } from "@/services/web-search.service";

const SERPER_TIMEOUT_MS = 15_000;
const SERP_DEPTH = 30;

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function normalizeHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

interface SerperOrganic {
  title?:    string;
  link?:     string;
  snippet?:  string;
  position?: number;
}

async function serperSearch(
  apiKey: string,
  query:  string,
): Promise<SerperOrganic[]> {
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), SERPER_TIMEOUT_MS);
  try {
    const res = await fetch("https://google.serper.dev/search", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-KEY": apiKey },
      signal: ctrl.signal,
      body: JSON.stringify({ q: query, num: SERP_DEPTH, gl: "id", hl: "id" }),
    });
    if (!res.ok) {
      console.warn("[check_keyword_ranking] Serper non-200:", res.status);
      return [];
    }
    const j = (await res.json()) as { organic?: SerperOrganic[] };
    return j.organic ?? [];
  } catch (e) {
    console.error("[check_keyword_ranking] Serper failed:", e);
    return [];
  } finally {
    clearTimeout(to);
  }
}

export const checkKeywordRanking: ToolHandler = async (
  args: Record<string, unknown>,
  ctx:  ToolContext,
): Promise<string> => {
  if (ctx.isManager !== true) {
    return JSON.stringify({
      ok: false,
      error: "Hanya manajer/super admin yang boleh menjalankan cek ranking SEO.",
    });
  }

  const keyword = str(args.keyword);
  if (!keyword) {
    return JSON.stringify({ ok: false, error: "Parameter `keyword` wajib diisi." });
  }

  // Resolve target domain from properties (fallback to current default).
  const { data: prop } = await (ctx.supabaseAdmin as any)
    .from("properties")
    .select("public_domain")
    .limit(1)
    .maybeSingle();
  const targetDomain = normalizeHost(
    `https://${(prop?.public_domain as string | null) || "pomahguesthouse.com"}`,
  );
  if (!targetDomain) {
    return JSON.stringify({ ok: false, error: "Domain properti tidak terkonfigurasi." });
  }

  // Get Serper key (DB first, env fallback).
  const dbKeys = await loadSearchKeysFromDb(ctx.supabaseAdmin as any);
  const serperKey = dbKeys.serper || process.env.SERPER_API_KEY?.trim() || null;
  if (!serperKey) {
    return JSON.stringify({
      ok: false,
      error: "Serper API key belum terkonfigurasi (cek Settings → SEO atau env SERPER_API_KEY).",
    });
  }

  const organic = await serperSearch(serperKey, keyword);
  if (organic.length === 0) {
    return JSON.stringify({
      ok: false,
      error: "Serper tidak mengembalikan hasil — coba lagi atau cek kuota API.",
    });
  }

  // Find first result whose host matches the target domain.
  let position: number | null = null;
  let matchedUrl: string | null = null;
  for (let i = 0; i < organic.length; i++) {
    const link = organic[i].link ?? "";
    const host = normalizeHost(link);
    if (host && (host === targetDomain || host.endsWith("." + targetDomain))) {
      position = organic[i].position ?? i + 1;
      matchedUrl = link;
      break;
    }
  }

  // Top 5 competitors (regardless of whether Pomah ranked).
  const topCompetitors = organic.slice(0, 5).map((r, i) => ({
    position: r.position ?? i + 1,
    title:    r.title ?? "",
    url:      r.link ?? "",
    snippet:  (r.snippet ?? "").slice(0, 160),
  }));

  // Read previous position for delta, then upsert.
  const { data: existing } = await (ctx.supabaseAdmin as any)
    .from("seo_keywords")
    .select("id, ranking_position")
    .eq("keyword", keyword)
    .maybeSingle();
  const previousPosition =
    typeof existing?.ranking_position === "number" ? existing.ranking_position : null;

  const upsertPayload: Record<string, unknown> = {
    keyword,
    ranking_position: position,
    updated_at: new Date().toISOString(),
  };
  if (!existing) {
    upsertPayload.intent = "informational";
    upsertPayload.priority = "medium";
  }
  await (ctx.supabaseAdmin as any)
    .from("seo_keywords")
    .upsert(upsertPayload, { onConflict: "keyword" });

  // Audit-log this run.
  await (ctx.supabaseAdmin as any).from("seo_agent_logs").insert({
    agent_key: "content",
    task_description: `Cek posisi Google untuk "${keyword}"`,
    status: "completed",
    details:
      position === null
        ? `Tidak ditemukan di top ${SERP_DEPTH}.`
        : `Posisi ${position}${previousPosition !== null ? ` (sebelumnya ${previousPosition})` : ""}.`,
  });

  return JSON.stringify({
    ok: true,
    keyword,
    domain: targetDomain,
    position,                              // 1-30 or null (not in top SERP_DEPTH)
    previous_position: previousPosition,
    delta:
      position !== null && previousPosition !== null
        ? previousPosition - position      // +ve = improved, -ve = declined
        : null,
    matched_url: matchedUrl,
    serp_depth_checked: SERP_DEPTH,
    top_competitors: topCompetitors,
  });
};
