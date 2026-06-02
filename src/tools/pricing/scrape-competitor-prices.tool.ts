/**
 * Tool: scrape_competitor_prices
 *
 * Dua mode:
 *
 *  1. CURATED (preferred): admin menyimpan daftar nama hotel kompetitor
 *     di `properties.competitor_hotels` (jsonb array of strings). Tool
 *     iterasi tiap nama, query OTA dengan frasa kutip ("<nama>" semarang),
 *     dan HANYA terima baris yang title-nya cocok ke salah satu nama
 *     kompetitor — tidak akan menyimpan halaman SEO generik.
 *
 *  2. FREE-TEXT fallback: dipakai bila daftar kompetitor kosong. Query
 *     bebas seperti versi lama, TAPI dengan junk-filter yang menolak
 *     judul khas landing aggregator ("Hotel Dekat …", "Hotel Murah …",
 *     "Hotel di X mulai Rp …", dll.).
 *
 * Argumen LLM:
 *   - city            (default Semarang)
 *   - hotels          string[] opsional → override daftar admin
 *   - extra_keywords  string opsional → ditambah ke setiap query
 *   - limit           per-hotel cap (default 6, max 20)
 *
 * Sumber tetap Tavily/Serper via webSearch (cheap, sudah terkonfigurasi).
 */

import { loadSearchKeysFromDb, webSearch, type SearchSnippet } from "@/services/web-search.service";
import type { ToolContext, ToolHandler } from "@/tools/types";

// ─── Price parsing ─────────────────────────────────────────────────────────

function parseRupiah(text: string): number | null {
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
  const range = text.match(/Rp\s*[\d.,]+\s*(?:-|—|–|sampai|hingga|s\/d)\s*Rp\s*[\d.,]+/i);
  if (range) {
    const both = [...range[0].matchAll(/Rp\s*([\d.,]+)/gi)].map((m) => parseRupiah(m[0]));
    if (both.length >= 2 && both[0] != null && both[1] != null) {
      return { min: Math.min(both[0], both[1]), max: Math.max(both[0], both[1]) };
    }
  }
  const single = parseRupiah(text);
  return { min: single, max: null };
}

function extractStarRating(text: string): number | null {
  const m = text.match(/(\d)\s*(?:bintang|star)/i);
  if (m) {
    const n = Number(m[1]);
    if (n >= 1 && n <= 5) return n;
  }
  return null;
}

// ─── Junk filter (aggregator / landing-page detection) ─────────────────────

/**
 * Reject snippet titles that are clearly NOT a single-hotel listing.
 * These are mostly SEO aggregator pages: "Hotel Dekat Mall X", "Hotel Murah
 * Semarang Mulai Rp 60rb", "Hotel di Y — Telusuri di KAYAK", etc.
 */
function looksLikeAggregatorTitle(title: string): boolean {
  const t = title.trim();
  // Starts with "Hotel " + generic descriptor that's not a brand.
  const aggregatorPatterns = [
    /^Hotel\s+(Dekat|Murah|Terdekat|Terbaik|Terbaru|Bintang|Sekitar|di\s+\S+\s+(?:Mulai|Harga|Murah|Terdekat))\b/i,
    /^Hotel\s+di\s+\S+,?\s+Mulai\s+Rp/i,
    /^Hotel\s+(Dekat|di)\s+.+(Mulai\s+Rp|Diskon|Promo)/i,
    /^(Top\s+\d+|Daftar\s+\d+)\s+Hotel/i,
    /Telusuri\s+di\s+(KAYAK|Trivago|Google)/i,
    /\b(Mulai|Hanya|Diskon)\s+Rp\s*\d/i,        // "Mulai Rp Xrb" without a clear brand
  ];
  return aggregatorPatterns.some((p) => p.test(t));
}

/** Hotel-name normalize for fuzzy matching against curated list. */
function normalizeForMatch(s: string): string {
  return s.toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function titleMatchesAnyHotel(title: string, hotels: string[]): string | null {
  const t = normalizeForMatch(title);
  for (const h of hotels) {
    const n = normalizeForMatch(h);
    if (!n) continue;
    // Match if all tokens of hotel name appear contiguously OR all tokens appear in order.
    if (t.includes(n)) return h;
    // Fallback: every token of hotel name must be present in title.
    const tokens = n.split(" ").filter((x) => x.length >= 2);
    if (tokens.length > 0 && tokens.every((tok) => t.includes(tok))) return h;
  }
  return null;
}

// ─── Row shape ──────────────────────────────────────────────────────────────

interface ParsedRow {
  hotel_name:  string;
  room_type:   string | null;
  price_min:   number | null;
  price_max:   number | null;
  star_rating: number | null;
  source_url:  string;
  notes:       string;
}

function snippetToRow(
  s: SearchSnippet,
  overrideHotelName?: string,
): ParsedRow | null {
  const combined = `${s.title} ${s.snippet}`;
  const { min, max } = extractPriceRange(combined);
  if (min == null) return null;
  const fallbackName = s.title
    .replace(/\s*[\|\-–—]\s*(traveloka|tiket\.com|booking\.com|agoda|trivago|pegipegi|airy).*$/i, "")
    .replace(/\s*(hotel\s+(murah|terbaik|terdekat).*)/i, "")
    .trim();
  return {
    hotel_name:  overrideHotelName ?? fallbackName,
    room_type:   null,
    price_min:   min,
    price_max:   max,
    star_rating: extractStarRating(combined),
    source_url:  s.url,
    notes:       s.snippet.slice(0, 400),
  };
}

// ─── Handler ────────────────────────────────────────────────────────────────

const CURATED_DOMAINS = ["traveloka.com", "tiket.com", "booking.com", "agoda.com", "trip.com", "pegipegi.com"];

export const scrapeCompetitorPrices: ToolHandler = async (
  args: Record<string, unknown>,
  ctx:  ToolContext,
): Promise<string> => {
  const cityArg = (typeof args.city === "string" ? args.city.trim() : "") || "Semarang";
  const extra   = typeof args.extra_keywords === "string" ? args.extra_keywords.trim() : "";
  const perHotelLimit = Math.min(20, Math.max(1, Number(args.limit) || 6));

  // Resolve curated competitor list: arg override → property config.
  const argHotels = Array.isArray(args.hotels)
    ? (args.hotels as unknown[]).filter((h): h is string => typeof h === "string" && h.trim().length > 0)
    : null;
  let curated: string[] = argHotels ?? [];
  if (curated.length === 0) {
    const raw = (ctx.property as Record<string, unknown>)?.competitor_hotels;
    const parsed = typeof raw === "string" ? JSON.parse(raw || "[]") : raw;
    if (Array.isArray(parsed)) {
      curated = parsed.filter((h): h is string => typeof h === "string" && h.trim().length > 0);
    }
  }

  const keys = await loadSearchKeysFromDb(ctx.supabaseAdmin as any);
  if (!keys.tavily && !keys.serper && !process.env.TAVILY_API_KEY && !process.env.SERPER_API_KEY) {
    return JSON.stringify({ ok: false, error: "Web search belum dikonfigurasi." });
  }

  const rowsToInsert: ParsedRow[] = [];
  let providerUsed: string | null = null;
  const queriesRan: string[] = [];

  // ── CURATED mode ─────────────────────────────────────────────────────────
  if (curated.length > 0) {
    for (const hotelName of curated) {
      const query = `"${hotelName}" ${cityArg} harga kamar Rp ${extra}`.trim();
      queriesRan.push(query);
      const res = await webSearch(query, keys, {
        curatedDomains: CURATED_DOMAINS,
        maxResults: perHotelLimit,
      });
      if (!providerUsed) providerUsed = res.provider;
      for (const s of res.snippets) {
        // Must match THIS hotel (not just any in the list — query was specific).
        const matched = titleMatchesAnyHotel(s.title, [hotelName])
          ?? titleMatchesAnyHotel(`${s.title} ${s.snippet}`, [hotelName]);
        if (!matched) continue;
        if (looksLikeAggregatorTitle(s.title)) continue;
        const row = snippetToRow(s, hotelName);
        if (row) rowsToInsert.push(row);
      }
    }
  }

  // ── FREE-TEXT fallback ───────────────────────────────────────────────────
  if (rowsToInsert.length === 0 && curated.length === 0) {
    const query = `harga kamar hotel ${cityArg} ${extra} per malam Rp`.trim();
    queriesRan.push(query);
    const res = await webSearch(query, keys, {
      curatedDomains: CURATED_DOMAINS,
      maxResults: perHotelLimit,
    });
    providerUsed = res.provider;
    for (const s of res.snippets) {
      if (looksLikeAggregatorTitle(s.title)) continue;
      const row = snippetToRow(s);
      if (row) rowsToInsert.push(row);
    }
  }

  if (rowsToInsert.length === 0) {
    return JSON.stringify({
      ok: false,
      error: curated.length > 0
        ? `Tidak ada listing kompetitor (${curated.join(", ")}) yang ditemukan di OTA. ` +
          "Pastikan nama hotel akurat seperti yang muncul di Traveloka/Booking."
        : "Tidak ada harga terbaca. Daftar kompetitor di Settings kosong — tambahkan nama hotel " +
          "kompetitor untuk hasil lebih akurat.",
      provider: providerUsed,
      queries:  queriesRan,
    });
  }

  const insertPayload = rowsToInsert.map((r) => ({
    ...r,
    city: cityArg,
    source_provider: providerUsed,
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
    mode: curated.length > 0 ? "curated" : "free_text",
    competitors: curated.length > 0 ? curated : undefined,
    inserted_count: data?.length ?? 0,
    provider: providerUsed,
    queries: queriesRan,
    sample: (data ?? []).slice(0, 5),
  });
};
