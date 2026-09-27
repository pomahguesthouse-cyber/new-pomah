import { createServerFn } from "@tanstack/react-start";
import { supabaseAdmin, supabasePublic } from "@/integrations/supabase/client.server";

export interface GoogleReview {
  author: string;
  text: string;
  rating: number;
}

export interface GoogleReviewsResult {
  rating: number | null;
  total: number | null;
  reviews: GoogleReview[];
  status: string;
}

const empty = (status: string): GoogleReviewsResult => ({
  rating: null,
  total: null,
  reviews: [],
  status,
});

const REVIEWS_OK_TTL_MS = 10 * 60_000;
const REVIEWS_ERROR_TTL_MS = 30_000;
let reviewsCache: { at: number; ttl: number; value: GoogleReviewsResult } | null = null;
let reviewsPending: Promise<GoogleReviewsResult> | null = null;

async function loadGoogleReviews(): Promise<GoogleReviewsResult> {
  const now = Date.now();
  if (reviewsCache && now - reviewsCache.at < reviewsCache.ttl) return reviewsCache.value;
  if (reviewsPending) return reviewsPending;
  reviewsPending = fetchGoogleReviews()
    .then((value) => {
      reviewsCache = {
        at: Date.now(),
        ttl: value.status === "OK" ? REVIEWS_OK_TTL_MS : REVIEWS_ERROR_TTL_MS,
        value,
      };
      return value;
    })
    .finally(() => {
      reviewsPending = null;
    });
  return reviewsPending;
}

export const getGoogleReviews = createServerFn({ method: "GET" }).handler(async () => loadGoogleReviews());

async function lookupPlacesApiKey(): Promise<string> {
  let key = process.env.GOOGLE_PLACES_API_KEY?.trim() || "";
  try {
    const { data: secretRow } = await supabaseAdmin
      .from("properties")
      .select("google_places_api_key")
      .limit(1)
      .maybeSingle();
    const fromDb = secretRow?.google_places_api_key?.trim();
    if (fromDb) key = fromDb;
  } catch (error) {
    console.warn(
      "[GoogleReviews] service-role key lookup failed:",
      error instanceof Error ? error.message : error,
    );
  }
  return key;
}

async function fetchGoogleReviews(): Promise<GoogleReviewsResult> {
  // Config and the places key are independent. Start both so a live Places
  // lookup does not wait on a second round-trip after the config returns.
  // The custom-rating path returns without awaiting the key.
  const configPromise = supabasePublic.rpc("get_google_reviews_config" as never);
  const keyPromise = lookupPlacesApiKey();
  const { data: prop } = await configPromise;
  const row = ((Array.isArray(prop) ? prop[0] : prop) as Record<string, unknown> | null) ?? {};

  const customRating = row.custom_google_rating !== null && row.custom_google_rating !== undefined ? Number(row.custom_google_rating) : null;
  const customTotal = row.custom_google_reviews_total !== null && row.custom_google_reviews_total !== undefined ? Number(row.custom_google_reviews_total) : null;
  let customReviews: GoogleReview[] = [];
  if (row.custom_google_reviews_json) {
    try {
      const parsed = typeof row.custom_google_reviews_json === "string"
        ? JSON.parse(row.custom_google_reviews_json)
        : row.custom_google_reviews_json;
      if (Array.isArray(parsed)) {
        customReviews = parsed.map((item: any) => ({
          author: String(item.author || item.author_name || "Tamu"),
          text: String(item.text || ""),
          rating: Number(item.rating ?? 5),
        }));
      }
    } catch (e) {
      console.error("Error parsing custom google reviews JSON:", e);
    }
  }

  if (customRating !== null) {
    return {
      rating: customRating,
      total: customTotal,
      reviews: customReviews,
      status: "OK",
    } satisfies GoogleReviewsResult;
  }

  const placeId = (row.google_place_id as string | undefined)?.trim();
  // The public RPC must not be the source of the key. The service-role read
  // was started with the config query above.
  const key = await keyPromise;

  if (!key) return empty("NO_API_KEY");
  if (!placeId) return empty("NO_PLACE_ID");

  try {
    const url =
      "https://maps.googleapis.com/maps/api/place/details/json" +
      `?place_id=${encodeURIComponent(placeId)}` +
      "&fields=rating,user_ratings_total,reviews&language=id" +
      `&key=${encodeURIComponent(key)}`;
    const res = await fetch(url);
    const json = (await res.json()) as {
      status?: string;
      error_message?: string;
      result?: {
        rating?: number;
        user_ratings_total?: number;
        reviews?: { author_name?: string; text?: string; rating?: number }[];
      };
    };

    if (json.status !== "OK") {
      return empty(
        json.status ? `${json.status}: ${json.error_message ?? ""}`.trim() : "API_ERROR",
      );
    }

    const result = json.result ?? {};
    const reviews: GoogleReview[] = Array.isArray(result.reviews)
      ? result.reviews
          .slice(0, 6)
          .map((review) => ({
            author: String(review.author_name ?? "Tamu"),
            text: String(review.text ?? ""),
            rating: Number(review.rating ?? 0),
          }))
          .filter((review) => review.text.length > 0)
      : [];

    return {
      rating: typeof result.rating === "number" ? result.rating : null,
      total: typeof result.user_ratings_total === "number" ? result.user_ratings_total : null,
      reviews,
      status: "OK",
    } satisfies GoogleReviewsResult;
  } catch (error) {
    return empty(`FETCH_ERROR: ${error instanceof Error ? error.message : "unknown"}`);
  }
}