/**
 * Shared web-search abstraction.
 *
 * Originally lived inside admin/modules/seo/article-generator.functions.ts
 * but Content Manager Agent (and Pricing Agent's competitor scraper) need
 * the same provider fallback (Tavily → Serper) + env-var support, so it's
 * lifted here as a single source of truth.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export interface SearchSnippet {
  title:   string;
  url:     string;
  snippet: string;
}

const SEARCH_TIMEOUT_MS = 15_000;

export async function loadSearchKeysFromDb(
  client: SupabaseClient,
): Promise<{ tavily: string | null; serper: string | null }> {
  try {
    const { data, error } = await (client as any)
      .from("properties")
      .select("tavily_api_key, serper_api_key")
      .limit(1)
      .maybeSingle();
    if (error) return { tavily: null, serper: null };
    const row = (data ?? {}) as Record<string, unknown>;
    return {
      tavily: ((row.tavily_api_key as string | null) ?? null)?.trim() || null,
      serper: ((row.serper_api_key as string | null) ?? null)?.trim() || null,
    };
  } catch {
    return { tavily: null, serper: null };
  }
}

async function singleTavilySearch(
  tavilyKey: string,
  query: string,
  includeDomains?: string[],
  maxResults = 6,
): Promise<SearchSnippet[]> {
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), SEARCH_TIMEOUT_MS);
  try {
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: ctrl.signal,
      body: JSON.stringify({
        api_key: tavilyKey,
        query,
        search_depth: "advanced",
        include_answer: false,
        max_results: maxResults,
        ...(includeDomains && includeDomains.length > 0 ? { include_domains: includeDomains } : {}),
      }),
    });
    if (!res.ok) return [];
    const j = (await res.json()) as { results?: Array<{ title: string; url: string; content: string }> };
    return (j.results ?? []).map((r) => ({
      title:   r.title,
      url:     r.url,
      snippet: r.content?.slice(0, 1500) ?? "",
    }));
  } catch (e) {
    console.error("[web-search] Tavily failed:", e);
    return [];
  } finally {
    clearTimeout(to);
  }
}

async function singleSerperSearch(
  serperKey: string,
  query: string,
  siteFilter?: string,
  num = 6,
): Promise<SearchSnippet[]> {
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), SEARCH_TIMEOUT_MS);
  try {
    const q = siteFilter ? `${query} site:${siteFilter}` : query;
    const res = await fetch("https://google.serper.dev/search", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-KEY": serperKey },
      signal: ctrl.signal,
      body: JSON.stringify({ q, num, gl: "id", hl: "id" }),
    });
    if (!res.ok) return [];
    const j = (await res.json()) as {
      organic?: Array<{ title: string; link: string; snippet: string }>;
    };
    return (j.organic ?? []).slice(0, num).map((r) => ({
      title:   r.title,
      url:     r.link,
      snippet: r.snippet?.slice(0, 600) ?? "",
    }));
  } catch (e) {
    console.error("[web-search] Serper failed:", e);
    return [];
  } finally {
    clearTimeout(to);
  }
}

function dedupeByUrl(snippets: SearchSnippet[]): SearchSnippet[] {
  const seen = new Set<string>();
  const out: SearchSnippet[] = [];
  for (const s of snippets) {
    const key = s.url.split("#")[0];
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}

export interface WebSearchOptions {
  curatedDomains?: string[];
  maxResults?:     number;
}

export async function webSearch(
  query: string,
  dbKeys: { tavily: string | null; serper: string | null },
  options: WebSearchOptions = {},
): Promise<{ snippets: SearchSnippet[]; provider: string | null }> {
  const tavilyKey = dbKeys.tavily || process.env.TAVILY_API_KEY?.trim() || null;
  const serperKey = dbKeys.serper || process.env.SERPER_API_KEY?.trim() || null;
  const curated = options.curatedDomains ?? [];
  const max = options.maxResults ?? 6;

  if (tavilyKey) {
    const calls: Promise<SearchSnippet[]>[] = [singleTavilySearch(tavilyKey, query, undefined, max)];
    for (const d of curated) calls.push(singleTavilySearch(tavilyKey, query, [d], 3));
    const [general, ...curatedResults] = await Promise.all(calls);
    const combined = dedupeByUrl([...curatedResults.flat(), ...general]);
    if (combined.length > 0) return { snippets: combined, provider: "tavily" };
  }
  if (serperKey) {
    const calls: Promise<SearchSnippet[]>[] = [singleSerperSearch(serperKey, query, undefined, max)];
    for (const d of curated) calls.push(singleSerperSearch(serperKey, query, d, 3));
    const [general, ...curatedResults] = await Promise.all(calls);
    const combined = dedupeByUrl([...curatedResults.flat(), ...general]);
    if (combined.length > 0) return { snippets: combined, provider: "serper" };
  }
  return { snippets: [], provider: null };
}
