/**
 * Tool: discover_property_reviews
 *
 * Cari ulasan publik tentang properti — TIDAK memakai Google Places API
 * (mahal & rate-limited). Strategi bertingkat:
 *
 *   1. Bila Serper API key tersedia → coba Serper `/places` untuk dapat
 *      `cid` properti di Google Maps, lalu Serper `/reviews` untuk daftar
 *      review beneran dari Google Maps (≈ $0.001/call). Ini cara paling
 *      akurat karena returnnya struktur: author, rating, text.
 *   2. Bila step 1 gagal / tidak ada Serper → fallback general web search
 *      (Tavily/Serper `/search`) ke domain review umum (TripAdvisor,
 *      Traveloka, Tiket, Agoda, Booking). Snippet di sini lebih kasar
 *      tapi tetap bisa dipakai.
 *
 * Mengembalikan kumpulan snippet/review; agent Content Manager curate
 * lalu panggil `save_custom_google_reviews` untuk persist.
 */

import type { ToolContext, ToolHandler } from "@/tools/types";
import { loadSearchKeysFromDb, webSearch, type SearchSnippet } from "@/services/web-search.service";

const REVIEW_DOMAINS = [
  "tripadvisor.com",
  "tripadvisor.co.id",
  "traveloka.com",
  "tiket.com",
  "agoda.com",
  "booking.com",
];

interface SerperPlaceResult {
  position?: number;
  title?: string;
  address?: string;
  rating?: number;
  ratingCount?: number;
  cid?: string;
  fid?: string;
  placeId?: string;
}

interface SerperReview {
  rating?: number;
  user?: string;
  date?: string;
  snippet?: string;
  link?: string;
  isLocalGuide?: boolean;
}

async function serperPlacesLookup(
  serperKey: string,
  query: string,
): Promise<SerperPlaceResult | null> {
  try {
    const res = await fetch("https://google.serper.dev/places", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-KEY": serperKey },
      body: JSON.stringify({ q: query, gl: "id", hl: "id" }),
    });
    if (!res.ok) return null;
    const j = (await res.json()) as { places?: SerperPlaceResult[] };
    return j.places?.[0] ?? null;
  } catch (e) {
    console.error("[discover_property_reviews] Serper /places failed:", e);
    return null;
  }
}

async function serperReviewsLookup(
  serperKey: string,
  place: SerperPlaceResult,
): Promise<{ reviews: SerperReview[]; rating: number | null; ratingCount: number | null }> {
  // Serper /reviews accepts either `cid` or `placeId` (or `q` as fallback).
  // Build the most specific body we can.
  const body: Record<string, unknown> = { gl: "id", hl: "id" };
  if (place.cid)            body.cid     = place.cid;
  else if (place.placeId)   body.placeId = place.placeId;
  else if (place.fid)       body.fid     = place.fid;
  else if (place.title)     body.q       = place.title;
  else return { reviews: [], rating: null, ratingCount: null };

  try {
    const res = await fetch("https://google.serper.dev/reviews", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-KEY": serperKey },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      console.error("[discover_property_reviews] Serper /reviews HTTP", res.status);
      return { reviews: [], rating: null, ratingCount: null };
    }
    const j = (await res.json()) as {
      reviews?: SerperReview[];
      rating?: number;
      ratingCount?: number;
    };
    return {
      reviews:     Array.isArray(j.reviews) ? j.reviews : [],
      rating:      typeof j.rating === "number" ? j.rating : (place.rating ?? null),
      ratingCount: typeof j.ratingCount === "number" ? j.ratingCount : (place.ratingCount ?? null),
    };
  } catch (e) {
    console.error("[discover_property_reviews] Serper /reviews failed:", e);
    return { reviews: [], rating: null, ratingCount: null };
  }
}

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
  const serperKey = keys.serper || process.env.SERPER_API_KEY?.trim() || null;
  const tavilyKey = keys.tavily || process.env.TAVILY_API_KEY?.trim() || null;
  if (!serperKey && !tavilyKey) {
    return JSON.stringify({
      ok: false,
      error: "Tidak ada API key web search (Tavily/Serper) yang tersimpan. " +
             "Set lebih dulu di Settings → Web Search API keys.",
    });
  }

  const cityHint = (ctx.property?.city as string | undefined) ?? "Semarang";
  const placeQuery = `${propertyName} ${cityHint}`.trim();

  // ── Tier 1: Serper /places + /reviews (Google Maps direct) ────────────────
  if (serperKey) {
    const place = await serperPlacesLookup(serperKey, placeQuery);
    if (place) {
      const { reviews, rating, ratingCount } = await serperReviewsLookup(serperKey, place);
      if (reviews.length > 0) {
        const filtered = reviews
          .filter((r) => (r.snippet ?? "").trim().length > 0)
          // Bila user spesifik "bintang 5" / "bintang 4" via extra_keywords,
          // bot LLM akan filter di sisinya — di sini kembalikan apa adanya.
          .slice(0, limit)
          .map((r) => ({
            author: r.user ?? "Tamu",
            rating: typeof r.rating === "number" ? r.rating : null,
            date:   r.date ?? null,
            text:   (r.snippet ?? "").trim(),
            source: "google_maps",
            url:    r.link ?? null,
          }));
        return JSON.stringify({
          ok: true,
          provider:    "serper-google-maps",
          source:      "google_maps_direct",
          place:       { title: place.title, address: place.address, cid: place.cid ?? null },
          overall:     { rating, total: ratingCount },
          count:       filtered.length,
          reviews:     filtered,
          next_step:
            "Ulasan ini DIAMBIL LANGSUNG dari Google Maps via Serper. Pilih 3–6 yang " +
            "paling representatif (atau ikuti filter yang manajer minta — mis. " +
            "'bintang 5' = rating === 5). Parafrase tiap text 1–2 kalimat, lalu panggil " +
            "`save_custom_google_reviews` dengan rating overall yang dikembalikan di " +
            "field `overall.rating` dan total dari `overall.total`.",
        });
      }
      // Place ditemukan tapi reviews kosong → biar manajer tahu.
      if (rating != null || ratingCount != null) {
        return JSON.stringify({
          ok: false,
          error:
            `Properti ditemukan di Google Maps (${place.title ?? propertyName}) dengan ` +
            `rating ${rating ?? "—"} dari ${ratingCount ?? "—"} ulasan, tapi Serper tidak ` +
            "mengembalikan teks review individual. Coba sumber lain via fallback search.",
          place: { title: place.title, rating, ratingCount },
        });
      }
    }
  }

  // ── Tier 2: general web search fallback (TripAdvisor, Traveloka, dst.) ────
  const query = `${propertyName} ulasan review ${extraKeywords}`.trim();
  const { snippets, provider } = await webSearch(query, keys, {
    curatedDomains: REVIEW_DOMAINS,
    maxResults: limit,
  });

  if (!snippets.length) {
    return JSON.stringify({
      ok: false,
      error: `Tidak menemukan ulasan untuk "${propertyName}" baik via Google Maps (Serper) ` +
             "maupun fallback web search. Coba beri extra_keywords lain atau cek Google Place " +
             "ID & SEO listing properti.",
      provider,
    });
  }

  return JSON.stringify({
    ok: true,
    provider,
    source: "fallback_web_search",
    note:
      "TIDAK ada ulasan langsung dari Google Maps yang ditemukan (Serper /reviews kosong " +
      "atau Serper key tidak tersedia). Snippet di bawah dari sumber sekunder (TripAdvisor, " +
      "Traveloka, dll.) — gunakan dengan hati-hati, jangan klaim sebagai 'Google review' " +
      "kalau bukan.",
    query,
    count: snippets.length,
    snippets: snippets.map((s: SearchSnippet) => ({ title: s.title, url: s.url, snippet: s.snippet })),
    next_step:
      "Bila manajer eksplisit minta GOOGLE review dan source di sini bukan google_maps, " +
      "tanya konfirmasi dulu sebelum simpan — apakah OK pakai sumber sekunder atau lebih " +
      "baik dilewati.",
  });
};
