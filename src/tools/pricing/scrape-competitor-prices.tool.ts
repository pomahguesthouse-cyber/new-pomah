/**
 * Tool: scrape_competitor_prices
 *
 * Searches public OTA / hotel-aggregator results for Semarang hotel
 * rates, parses snippet text into structured rows, and inserts them
 * into `competitor_prices` for trend analysis.
 *
 * Why two-pass:
 *   1. webSearch → returns titles+snippets like
 *      "Hotel ABC Semarang from Rp 350.000/night..."
 *   2. Heuristic regex extraction of price ranges (Rp X — Rp Y, or
 *      "mulai Rp X"). LLM parsing would be more accurate but adds
 *      token cost on every scrape — we keep it deterministic and
 *      log raw snippets in `notes` so admin can audit.
 *
 * Returns a summary the Pricing Agent can mention to staff.
 */

import { loadSearchKeysFromDb, webSearch, type SearchSnippet } from "@/services/web-search.service";
import type { ToolContext, ToolHandler } from "@/tools/types";

function parseRupiah(text: string): number | null {
  // Match "Rp 350.000", "Rp350,000", "350000", "Rp 350 ribu"
  const m = text.match(/Rp\s*([\d.,]+)(?:\s*(rb|ribu|k|jt|juta))?/i);
  if (!m) return null;
  const numStr = m[1].replace(/[.,]/g, "");
  const n = parseInt(numStr, 10);
  if (!Number.isFinite(n)) return null;
  const unit = m[2]?.toLowerCase() ?? "";
  if (unit === "rb" || unit === "ribu" || unit === "k") return n * 1000;
  if (unit === "jt" || unit === "juta") return n * 1_000_000;
  return n;
}

function extractPriceRange(text: string): { min: number | null; max: number | null } {
  // Range patterns: "Rp X - Rp Y" / "Rp X sampai Rp Y" / "mulai Rp X"
  const range = text.match(/Rp\s*[\d.,]+\s*(?:-|—|–|sampai|hingga|s\/d)\s*Rp\s*[\d.,]+/i);
  if (range) {
    const both = [...range[0].matchAll(/Rp\s*([\d.,]+)/gi)].map((m) => parseRupiah(m[0]));
    if (both.length >= 2 && both[0] != null && both[1] != null) {
      return { min: Math.min(both[0], both[1]), max: Math.max(both[0], both[1]) };
    }
  }
  // Single price → treat as min
  const single = parseRupiah(text);
  return { min: single, max: null };
}

/** Extract hotel name from a snippet title — strip OTA suffixes. */
function extractHotelName(title: string): string {
  return title
    .replace(/\s*[\|\-–—]\s*(traveloka|tiket\.com|booking\.com|agoda|trivago|pegipegi|airy).*$/i, "")
    .replace(/\s*(hotel\s+(murah|terbaik|terdekat).*)/i, "")
    .trim();
}

function extractStarRating(text: string): number | null {
  const m = text.match(/(\d)\s*(?:bintang|star)/i);
  if (m) {
    const n = Number(m[1]);
    if (n >= 1 && n <= 5) return n;
  }
  return null;
}

interface ParsedRow {
  hotel_name:  string;
  room_type:   string | null;
  price_min:   number | null;
  price_max:   number | null;
  star_rating: number | null;
  source_url:  string;
  notes:       string;
}

function snippetToRow(s: SearchSnippet): ParsedRow | null {
  const combined = `${s.title} ${s.snippet}`;
  const { min, max } = extractPriceRange(combined);
  if (min == null) return null; // skip rows with no price detected
  return {
    hotel_name:  extractHotelName(s.title),
    room_type:   null,
    price_min:   min,
    price_max:   max,
    star_rating: extractStarRating(combined),
    source_url:  s.url,
    notes:       s.snippet.slice(0, 400),
  };
}

export const scrapeCompetitorPrices: ToolHandler = async (
  args: Record<string, unknown>,
  ctx:  ToolContext,
): Promise<string> => {
  const cityArg = (typeof args.city === "string" ? args.city.trim() : "") || "Semarang";
  const extra   = typeof args.extra_keywords === "string" ? args.extra_keywords.trim() : "";
  const limit   = Math.min(20, Math.max(1, Number(args.limit) || 8));

  const keys = await loadSearchKeysFromDb(ctx.supabaseAdmin as any);
  if (!keys.tavily && !keys.serper && !process.env.TAVILY_API_KEY && !process.env.SERPER_API_KEY) {
    return JSON.stringify({ ok: false, error: "Web search belum dikonfigurasi." });
  }

  const query = `harga kamar hotel ${cityArg} ${extra} per malam Rp`.trim();
  const res = await webSearch(query, keys, {
    curatedDomains: ["traveloka.com", "tiket.com", "booking.com", "agoda.com"],
    maxResults: limit,
  });

  const rows = res.snippets
    .map(snippetToRow)
    .filter((r): r is ParsedRow => r !== null);

  if (rows.length === 0) {
    return JSON.stringify({
      ok: false,
      error: "Tidak ada harga terbaca dari hasil pencarian.",
      provider: res.provider,
    });
  }

  // Insert all rows
  const insertPayload = rows.map((r) => ({
    ...r,
    city: cityArg,
    source_provider: res.provider,
    currency: "IDR",
    fetched_at: new Date().toISOString(),
  }));

  const { data, error } = await (ctx.supabaseAdmin as any)
    .from("competitor_prices")
    .insert(insertPayload)
    .select("id, hotel_name, price_min, price_max");

  if (error) {
    return JSON.stringify({ ok: false, error: `DB insert gagal: ${error.message}` });
  }

  return JSON.stringify({
    ok: true,
    inserted_count: data?.length ?? 0,
    provider: res.provider,
    query,
    sample: (data ?? []).slice(0, 5),
  });
};
