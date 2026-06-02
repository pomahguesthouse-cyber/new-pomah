/**
 * Tool: discover_property_reviews
 *
 * Cari snippet ulasan publik tentang properti dari web (Google Maps profile,
 * TripAdvisor, Traveloka, Tiket.com, dll.) memakai Tavily/Serper — TIDAK
 * memanggil Google Places API (mahal & rate-limited).
 *
 * Mengembalikan kumpulan snippet mentah; agent Content Manager bertugas
 * memparafrase / memilih yang terbaik, lalu memanggil `save_custom_google_reviews`
 * untuk menyimpan ke kolom custom_google_reviews_json di tabel properties.
 */

import type { ToolContext, ToolHandler } from "@/tools/types";
import { loadSearchKeysFromDb, webSearch } from "@/services/web-search.service";

const REVIEW_DOMAINS = [
  "google.com",
  "maps.google.com",
  "tripadvisor.com",
  "tripadvisor.co.id",
  "traveloka.com",
  "tiket.com",
  "agoda.com",
  "booking.com",
];

export const discoverPropertyReviews: ToolHandler = async (
  args: Record<string, unknown>,
  ctx:  ToolContext,
): Promise<string> => {
  const limit = typeof args.limit === "number"
    ? Math.max(3, Math.min(20, args.limit))
    : 10;
  const extraKeywords = typeof args.extra_keywords === "string"
    ? args.extra_keywords.trim()
    : "";

  const propertyName = (ctx.property?.name as string | undefined)?.trim();
  if (!propertyName) {
    return JSON.stringify({
      ok: false,
      error: "Nama properti tidak tersedia di konteks; tidak bisa membuat query.",
    });
  }

  const keys = await loadSearchKeysFromDb(ctx.supabaseAdmin);
  if (!keys.tavily && !keys.serper && !process.env.TAVILY_API_KEY && !process.env.SERPER_API_KEY) {
    return JSON.stringify({
      ok: false,
      error: "Tidak ada API key web search (Tavily/Serper) yang tersimpan. " +
             "Set lebih dulu di Settings → Web Search API keys.",
    });
  }

  const query = `${propertyName} ulasan review google maps ${extraKeywords}`.trim();
  const { snippets, provider } = await webSearch(query, keys, {
    curatedDomains: REVIEW_DOMAINS,
    maxResults: limit,
  });

  if (!snippets.length) {
    return JSON.stringify({
      ok: false,
      error: `Tidak menemukan snippet ulasan untuk "${propertyName}". Coba beri extra_keywords ` +
             "(mis. 'bagus', 'pelayanan') atau cek Google Place ID & SEO listing properti.",
      provider,
    });
  }

  return JSON.stringify({
    ok: true,
    provider,
    query,
    count: snippets.length,
    snippets: snippets.map((s) => ({ title: s.title, url: s.url, snippet: s.snippet })),
    next_step:
      "Pilih 3–6 snippet TERBAIK (yang jelas merupakan ulasan tamu, bukan iklan/listing). " +
      "Parafrase jadi {author, text, rating}, lalu panggil `save_custom_google_reviews` " +
      "dengan rating rata-rata (estimasi 4.0–5.0 berdasarkan tone), total perkiraan, " +
      "dan array reviews.",
  });
};
